import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, RefreshCcw, Upload, Wrench } from 'lucide-react';
import { authHeader } from '../lib/auth';

interface VideoAdminAlert {
  id: string;
  statusLabel: string;
  recordId: string;
  tenantId: string;
  platform: string;
  title: string;
  sourceUrl: string;
  reason: string;
  error: string;
  occurrences: number;
  manualUploadStatus?: 'queued' | 'analyzing' | 'analyzed' | 'failed';
  manualUploadedAt?: string;
  updatedAt: string;
  accountType: 'trial' | 'customer' | 'admin' | 'unknown';
  accountTypeLabel: string;
  tenantName: string;
  accountEmail: string;
}

interface VideoAlertSummary {
  total: number;
  trial: number;
  customer: number;
  admin: number;
  unknown: number;
}

interface VideoAlertReconciliation {
  ok: boolean;
  source: 'pocketbase' | 'snapshot' | 'alerts-only';
  scanned: number;
  synced: number;
  warning?: string;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const TARGET_UPLOAD_BYTES = 9.2 * 1024 * 1024;

const fmtDate = (value?: string | null) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
};

const fmtMb = (value: number) => `${(value / 1024 / 1024).toFixed(1)}MB`;

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('视频文件读取失败'));
  reader.readAsDataURL(file);
});

const pickRecorderMimeType = () => {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
};

async function compressVideoUnder10Mb(file: File, onStep: (message: string) => void): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES) {
    onStep(`文件已小于 10MB：${fmtMb(file.size)}`);
    return file;
  }
  if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持本地视频压缩');

  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = sourceUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('视频文件无法读取'));
    });

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 60;
    const sourceWidth = video.videoWidth || 720;
    const sourceHeight = video.videoHeight || 1280;
    const mimeType = pickRecorderMimeType();
    if (!mimeType) throw new Error('当前浏览器不支持 WebM 本地压缩');

    const attempts = [
      { maxWidth: 720, fps: 15, scale: 0.82 },
      { maxWidth: 540, fps: 12, scale: 0.60 },
      { maxWidth: 360, fps: 10, scale: 0.42 },
    ];

    for (const attempt of attempts) {
      const ratio = Math.min(1, attempt.maxWidth / sourceWidth);
      const width = Math.max(240, Math.round(sourceWidth * ratio / 2) * 2);
      const height = Math.max(240, Math.round(sourceHeight * ratio / 2) * 2);
      const targetBps = Math.max(120_000, Math.min(1_200_000, Math.floor((TARGET_UPLOAD_BYTES * 8 / duration) * attempt.scale)));
      onStep(`本地压缩中：${width}x${height} / ${Math.round(targetBps / 1000)}kbps`);

      const blob = await recordCompressedVideo(video, { width, height, fps: attempt.fps, mimeType, videoBitsPerSecond: targetBps });
      if (blob.size <= MAX_UPLOAD_BYTES) {
        return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'manual-video'}-compressed.webm`, { type: blob.type || 'video/webm' });
      }
      onStep(`压缩后仍为 ${fmtMb(blob.size)}，继续降低清晰度`);
    }
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }

  throw new Error('本地压缩后仍超过 10MB，请选择更短的视频片段。');
}

function recordCompressedVideo(
  video: HTMLVideoElement,
  options: { width: number; height: number; fps: number; mimeType: string; videoBitsPerSecond: number },
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = options.width;
  canvas.height = options.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建视频压缩画布');

  const stream = canvas.captureStream(options.fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: options.mimeType,
    videoBitsPerSecond: options.videoBitsPerSecond,
  });
  const chunks: Blob[] = [];

  return new Promise<Blob>((resolve, reject) => {
    let frame = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      stream.getTracks().forEach(track => track.stop());
      if (recorder.state !== 'inactive') recorder.stop();
    };
    const fail = (error: unknown) => {
      stream.getTracks().forEach(track => track.stop());
      reject(error instanceof Error ? error : new Error('视频压缩失败'));
    };
    const draw = () => {
      if (done || video.ended || video.paused) return;
      ctx.drawImage(video, 0, 0, options.width, options.height);
      frame = window.requestAnimationFrame(draw);
    };

    recorder.ondataavailable = event => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => fail(new Error('视频压缩录制失败'));
    recorder.onstop = () => {
      window.cancelAnimationFrame(frame);
      resolve(new Blob(chunks, { type: options.mimeType.split(';')[0] || 'video/webm' }));
    };
    video.onended = finish;
    video.onerror = () => fail(new Error('视频压缩播放失败'));

    video.currentTime = 0;
    recorder.start(1000);
    video.play()
      .then(() => {
        draw();
      })
      .catch(() => fail(new Error('浏览器阻止了本地视频压缩播放')));
  });
}

export default function AdminContentOpsAlerts() {
  const [alerts, setAlerts] = useState<VideoAdminAlert[]>([]);
  const [summary, setSummary] = useState<VideoAlertSummary>({ total: 0, trial: 0, customer: 0, admin: 0, unknown: 0 });
  const [reconciliation, setReconciliation] = useState<VideoAlertReconciliation | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File | null>>({});
  const [uploadingAlertId, setUploadingAlertId] = useState<string | null>(null);
  const [uploadSteps, setUploadSteps] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/overseas/admin/video-alerts?limit=200', { headers: authHeader() });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.error || '读取内容告警失败');
      const items = (json.items ?? []) as VideoAdminAlert[];
      setAlerts(items);
      setReconciliation(json.reconciliation ?? null);
      setSummary(json.summary ?? items.reduce((counts, item) => {
        counts.total += 1;
        counts[item.accountType] += 1;
        return counts;
      }, { total: 0, trial: 0, customer: 0, admin: 0, unknown: 0 } as VideoAlertSummary));
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取内容告警失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const setStep = (alertId: string, nextMessage: string) => {
    setUploadSteps(prev => ({ ...prev, [alertId]: nextMessage }));
  };

  const uploadManualVideo = async (alert: VideoAdminAlert) => {
    const file = selectedFiles[alert.id];
    if (!file) {
      setError('请先选择对应的视频文件');
      return;
    }
    if (!file.type.startsWith('video/')) {
      setError('只能上传视频文件');
      return;
    }

    setError('');
    setMessage('');
    setUploadingAlertId(alert.id);
    try {
      const compressed = await compressVideoUnder10Mb(file, nextMessage => setStep(alert.id, nextMessage));
      setStep(alert.id, `准备上传：${fmtMb(compressed.size)}`);
      const videoBase64 = await readFileAsDataUrl(compressed);
      const resp = await fetch(`/api/overseas/admin/video-alerts/${alert.id}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          recordId: alert.recordId,
          filename: compressed.name,
          mimeType: compressed.type || 'video/webm',
          videoBase64,
        }),
      });
      const json = await resp.json().catch(() => ({})) as { error?: string };
      if (!resp.ok) throw new Error(json.error || '上传失败');
      setSelectedFiles(prev => ({ ...prev, [alert.id]: null }));
      setStep(alert.id, '已上传，Gemini 分析排队中');
      setMessage('人工修复视频已上传并进入 Gemini 分析队列，成功后会自动从待处理列表移除并进入灵感大屏。');
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploadingAlertId(null);
    }
  };

  return (
    <section className="rounded-3xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber/10 text-amber">
            <AlertTriangle size={15} />
          </div>
          <div>
            <p className="text-sm font-black text-text-primary">内容运维</p>
            <p className="mt-0.5 text-[11px] text-text-muted">汇总试用账号与正式账号的爬取失败视频，支持人工补传修复。</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-text-secondary">
            {loading ? '读取中' : `${summary.total} 条待修复`}
          </span>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
            刷新
          </button>
        </div>
      </div>

      {!loading && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-bold">
          <span className="rounded-lg bg-amber/10 px-2.5 py-1 text-amber">试用账号 {summary.trial}</span>
          <span className="rounded-lg bg-green/10 px-2.5 py-1 text-green">正式账号 {summary.customer}</span>
          {(summary.admin > 0 || summary.unknown > 0) && (
            <span className="rounded-lg bg-surface-2 px-2.5 py-1 text-text-muted">其他 {summary.admin + summary.unknown}</span>
          )}
        </div>
      )}

      {reconciliation?.warning && (
        <p className={`mb-3 rounded-xl px-3 py-2 text-xs font-bold ${
          reconciliation.ok ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'
        }`}>
          {reconciliation.warning}
          {reconciliation.scanned > 0 ? ` 已扫描 ${reconciliation.scanned} 条视频记录。` : ''}
        </p>
      )}

      {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
      {message && <p className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{message}</p>}

      {alerts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-white px-3 py-4 text-xs text-text-muted">暂无试用账号或正式账号需要人工处理的爬取失败视频。</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-white">
          <div className="divide-y divide-border">
            {alerts.map(alert => (
              <div key={alert.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      alert.accountType === 'trial'
                        ? 'bg-amber/10 text-amber'
                        : alert.accountType === 'customer'
                          ? 'bg-green/10 text-green'
                          : 'bg-surface-2 text-text-muted'
                    }`}>
                      {alert.accountTypeLabel}
                    </span>
                    <span className="whitespace-nowrap rounded bg-amber/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber">{alert.statusLabel}</span>
                    {alert.manualUploadStatus && (
                      <span className="whitespace-nowrap rounded bg-green/10 px-1.5 py-0.5 text-[10px] font-semibold text-green">
                        {alert.manualUploadStatus === 'analyzed' ? '已入大屏' : alert.manualUploadStatus === 'failed' ? '上传分析失败' : '上传处理中'}
                      </span>
                    )}
                    <p className="truncate text-xs font-semibold text-text-primary">{alert.title}</p>
                  </div>
                  <p className="mt-1 truncate text-[10px] font-semibold text-text-secondary">
                    {alert.tenantName}{alert.accountEmail ? ` · ${alert.accountEmail}` : ''} · {alert.platform.toUpperCase()}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-text-muted">
                    tenant {alert.tenantId} · record {alert.recordId} · {alert.reason} · {fmtDate(alert.updatedAt)}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[10px] text-text-secondary">{alert.error || '无详细错误'}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <div className="flex items-center gap-1.5">
                    {alert.sourceUrl && (
                      <a
                        href={alert.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[10px] font-semibold text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                      >
                        <ExternalLink size={11} />
                        原视频
                      </a>
                    )}
                    <input
                      id={`manual-video-${alert.id}`}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={event => {
                        const file = event.currentTarget.files?.[0] ?? null;
                        setSelectedFiles(prev => ({ ...prev, [alert.id]: file }));
                        setStep(alert.id, file ? `待压缩：${file.name} · ${fmtMb(file.size)}` : '');
                      }}
                    />
                    <label
                      htmlFor={`manual-video-${alert.id}`}
                      className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-border px-2 text-[10px] font-semibold text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                    >
                      <Upload size={11} />
                      选择修复视频
                    </label>
                    <button
                      type="button"
                      onClick={() => void uploadManualVideo(alert)}
                      disabled={!selectedFiles[alert.id] || uploadingAlertId === alert.id}
                      className="inline-flex h-7 items-center gap-1 rounded-lg bg-accent px-2 text-[10px] font-semibold text-white disabled:opacity-50"
                    >
                      {uploadingAlertId === alert.id ? <Loader2 size={11} className="animate-spin" /> : <Wrench size={11} />}
                      人工修复
                    </button>
                  </div>
                  {uploadSteps[alert.id] && (
                    <span className="max-w-[300px] truncate text-[10px] text-text-muted">{uploadSteps[alert.id]}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
