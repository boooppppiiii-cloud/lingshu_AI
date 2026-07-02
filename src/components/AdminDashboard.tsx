import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, RefreshCcw, ShieldCheck, Upload } from 'lucide-react';
import { authHeader } from '../lib/auth';

interface AdminAccount {
  email: string;
  password: string;
  status: string;
  activatedAt: string | null;
  expiresAt: string | null;
  trialDay: number | null;
  trialDays: number | null;
  daysRemaining: number | null;
  tokenUsedToday: number;
  tokenUsedTotal: number;
  tokenLimit: number | null;
  aiChatToday: number;
  generationToday: number;
  renderToday: number;
  videoGenerationToday: number;
  rotatedAt: string | null;
  rotationPassword: string | null;
}

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
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const TARGET_UPLOAD_BYTES = 9.2 * 1024 * 1024;

const fmtDate = (value?: string | null) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
};

const fmtTokens = (value: number) => value.toLocaleString('en-US');
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

export default function AdminDashboard() {
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [alerts, setAlerts] = useState<VideoAdminAlert[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File | null>>({});
  const [uploadingAlertId, setUploadingAlertId] = useState<string | null>(null);
  const [uploadSteps, setUploadSteps] = useState<Record<string, string>>({});
  const [uploadMessage, setUploadMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [resp, alertResp] = await Promise.all([
        fetch('/api/overseas/admin/demo-accounts', { headers: authHeader() }),
        fetch('/api/overseas/admin/video-alerts?limit=20', { headers: authHeader() }),
      ]);
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.error || '读取失败');
      const alertJson = await alertResp.json().catch(() => ({}));
      setAccounts(json.accounts ?? []);
      setAlerts(alertResp.ok ? alertJson.items ?? [] : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const setStep = (alertId: string, message: string) => {
    setUploadSteps(prev => ({ ...prev, [alertId]: message }));
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

    setError(null);
    setUploadMessage('');
    setUploadingAlertId(alert.id);
    try {
      const compressed = await compressVideoUnder10Mb(file, message => setStep(alert.id, message));
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
      setUploadMessage('已上传并进入 Gemini 分析队列，分析成功后会自动出现在灵感大屏。');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploadingAlertId(null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="h-12 px-5 border-b border-border flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-surface-2 text-text-secondary">
            <ShieldCheck size={13} />
          </div>
          <span className="text-sm font-semibold text-text-primary">账号总控</span>
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-surface-2 disabled:opacity-60">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
          刷新
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-5">
        {error && <p className="mb-3 text-xs text-red">{error}</p>}
        {uploadMessage && <p className="mb-3 text-xs text-green">{uploadMessage}</p>}
        <div className="mb-4 rounded-lg border border-border bg-surface overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber" />
              <span className="text-xs font-semibold text-text-primary">视频级分析告警</span>
            </div>
            <span className="text-[10px] text-text-muted">{alerts.length} 条待看</span>
          </div>
          {alerts.length === 0 ? (
            <p className="px-3 py-4 text-xs text-text-muted">暂无需要人工处理的视频分析失败。</p>
          ) : (
            <div className="divide-y divide-border">
              {alerts.map(alert => (
                <div key={alert.id} className="px-3 py-2.5 grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber/10 text-amber whitespace-nowrap">{alert.statusLabel}</span>
                      {alert.manualUploadStatus && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green/10 text-green whitespace-nowrap">
                          {alert.manualUploadStatus === 'analyzed' ? '已入大屏' : alert.manualUploadStatus === 'failed' ? '上传分析失败' : '上传处理中'}
                        </span>
                      )}
                      <p className="text-xs font-semibold text-text-primary truncate">{alert.title}</p>
                    </div>
                    <p className="text-[10px] text-text-muted mt-1 truncate">
                      {alert.platform} · tenant {alert.tenantId} · record {alert.recordId} · {alert.reason} · {fmtDate(alert.updatedAt)}
                    </p>
                    <p className="text-[10px] text-text-secondary mt-1 line-clamp-2">{alert.error || '无详细错误'}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <div className="flex items-center gap-1.5">
                      {alert.sourceUrl && (
                        <a
                          href={alert.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="h-7 px-2 inline-flex items-center gap-1 rounded-lg border border-border text-[10px] font-semibold text-text-secondary hover:text-text-primary hover:bg-white"
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
                        className="h-7 px-2 inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border text-[10px] font-semibold text-text-secondary hover:text-text-primary hover:bg-white"
                      >
                        <Upload size={11} />
                        选择视频
                      </label>
                      <button
                        type="button"
                        onClick={() => void uploadManualVideo(alert)}
                        disabled={!selectedFiles[alert.id] || uploadingAlertId === alert.id}
                        className="h-7 px-2 inline-flex items-center gap-1 rounded-lg bg-accent text-[10px] font-semibold text-white disabled:opacity-50"
                      >
                        {uploadingAlertId === alert.id ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                        提交入库
                      </button>
                    </div>
                    {uploadSteps[alert.id] && (
                      <span className="max-w-[300px] truncate text-[10px] text-text-muted">{uploadSteps[alert.id]}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="overflow-auto border border-border rounded-lg">
          <table className="min-w-[1180px] w-full text-xs">
            <thead className="bg-surface-2 text-text-muted">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold">账号</th>
                <th className="px-3 py-2 font-semibold">密码</th>
                <th className="px-3 py-2 font-semibold">流转状态</th>
                <th className="px-3 py-2 font-semibold">试用进度</th>
                <th className="px-3 py-2 font-semibold">激活时间</th>
                <th className="px-3 py-2 font-semibold">到期时间</th>
                <th className="px-3 py-2 font-semibold">Token 今日/总计</th>
                <th className="px-3 py-2 font-semibold">今日功能次数</th>
                <th className="px-3 py-2 font-semibold">轮换</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-text-muted">读取中...</td></tr>
              )}
              {!loading && accounts.map(account => (
                <tr key={account.email} className="hover:bg-surface-2/60">
                  <td className="px-3 py-2 font-semibold text-text-primary whitespace-nowrap">{account.email}</td>
                  <td className="px-3 py-2 font-mono text-text-secondary whitespace-nowrap">{account.password}</td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{account.status}</td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                    {account.trialDays ? `第 ${account.trialDay ?? '-'} / ${account.trialDays} 天，剩余 ${account.daysRemaining ?? '-'} 天` : '长期有效'}
                  </td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtDate(account.activatedAt)}</td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtDate(account.expiresAt)}</td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                    {fmtTokens(account.tokenUsedToday)} / {fmtTokens(account.tokenUsedTotal)}
                    {account.tokenLimit ? ` / ${fmtTokens(account.tokenLimit)}` : ''}
                  </td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                    对话 {account.aiChatToday} · 生成 {account.generationToday} · 渲染 {account.renderToday} · 视频 {account.videoGenerationToday}
                  </td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                    {account.rotatedAt ? `${fmtDate(account.rotatedAt)} · ${account.rotationPassword ?? '-'}` : '-'}
                  </td>
                </tr>
              ))}
              {!loading && !accounts.length && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-text-muted">暂无账号</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
