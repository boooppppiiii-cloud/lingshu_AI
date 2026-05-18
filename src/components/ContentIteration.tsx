import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles, FileText, Bookmark, Copy, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import VideoUploader from './VideoUploader';
import { geminiService } from '../services/gemini';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
import { useGameProfile } from '../lib/GameProfileContext';
import { pb } from '../lib/pb';
import { createLeadingDebouncer } from '../lib/leadingDebounce';
import { logUsageEvent } from '../lib/logUsageEvent';
import { USAGE_EVENT } from '../lib/usageEvents';
import { buildAssetCreateBody } from '../lib/recordMappers';
import { getGameCreativeProfile } from '../lib/gameProfiles';
import type { IterationHandoff } from '../lib/iterationHandoff';
import { AssetType } from '../types';

const FULL_SCRIPT_SAVE_KEY = 'iteration:full_script';

type AnalyzePhase = 'read_video' | 'upload_model' | 'streaming';

const PHASE_LABEL: Record<AnalyzePhase, string> = {
  read_video: '正在读取视频…',
  upload_model: '正在上传并请求模型分析（耗时因视频大小与网络而异）…',
  streaming: '正在流式生成拆解内容…',
};

function IterationResultSkeleton() {
  return (
    <div className="space-y-4 animate-pulse p-2" aria-hidden>
      <div className="h-4 w-2/3 rounded-lg bg-slate-200/90" />
      <div className="h-3 w-full rounded-lg bg-slate-200/70" />
      <div className="h-3 w-full rounded-lg bg-slate-200/70" />
      <div className="h-3 w-5/6 rounded-lg bg-slate-200/70" />
      <div className="h-24 w-full rounded-2xl bg-slate-200/50" />
      <div className="h-3 w-full rounded-lg bg-slate-200/70" />
      <div className="h-3 w-4/5 rounded-lg bg-slate-200/70" />
    </div>
  );
}

type ContentIterationProps = {
  handoff?: IterationHandoff | null;
  onHandoffConsumed?: () => void;
};

export default function ContentIteration({
  handoff = null,
  onHandoffConsumed,
}: ContentIterationProps) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { gameProfileId } = useGameProfile();
  const creativeProfile = useMemo(() => getGameCreativeProfile(gameProfileId), [gameProfileId]);
  const [video, setVideo] = useState<{ base64: string; mimeType: string; size?: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<AnalyzePhase>('read_video');
  const [analyzeFailed, setAnalyzeFailed] = useState(false);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ [key: string]: boolean }>({});
  const [geminiRetryLabel, setGeminiRetryLabel] = useState<string | null>(null);
  const streamingStartedRef = useRef(false);

  const geminiOpts = useMemo(
    () => ({
      onRetryAttempt: (n: number, m: number) => setGeminiRetryLabel(`第 ${n} / ${m} 次请求`),
    }),
    [],
  );

  const geminiCallOpts = useMemo(
    () => ({
      ...geminiOpts,
      analyticsUserId: user?.uid,
      gameProfileId,
    }),
    [geminiOpts, user?.uid, gameProfileId],
  );

  const handoffAppliedRef = useRef<string | null>(null);

  const handleAnalyzeImpl = async (
    target?: { base64: string; mimeType: string; size?: number } | null,
  ) => {
    const payload = target ?? video;
    if (!payload) return;

    const fileSizeInMB = (payload.size || 0) / (1024 * 1024);
    if (fileSizeInMB > 200) {
      console.error('Video size exceeds 200MB limit.');
      alert('视频体积较大（超过 200MB），请处理后再上传以保证稳定性。');
      return;
    }

    setLoading(true);
    setAnalyzeFailed(false);
    setFailureMessage(null);
    setGeminiRetryLabel(null);
    setResult('');
    setIsEditing(false);
    setPhase('read_video');
    streamingStartedRef.current = false;

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    setPhase('upload_model');

    try {
      const script = await geminiService.analyzeVideoIterationStream(
        payload.base64,
        payload.mimeType,
        creativeProfile.defaultStyle,
        creativeProfile.defaultMoods,
        {
          ...geminiCallOpts,
          onDelta: (_delta, accumulated) => {
            if (!streamingStartedRef.current) {
              streamingStartedRef.current = true;
              setPhase('streaming');
            }
            setResult(accumulated);
          },
        },
      );

      const trimmed = script?.trim() ?? '';
      setResult(trimmed || '分析失败，请重试。');
      if (user?.uid && trimmed) {
        void logUsageEvent(user.uid, USAGE_EVENT.SCRIPT_GENERATED, {
          source: 'content_iteration',
          meta: { variant: 'analyze_video_iteration_stream' },
        });
      }
    } catch (error) {
      console.error(error);
      const msg =
        error instanceof Error ? error.message : '发生错误，请检查网络或 API 配置。';
      setAnalyzeFailed(true);
      setFailureMessage(msg);
      setResult(null);
    } finally {
      setGeminiRetryLabel(null);
      setLoading(false);
    }
  };

  const handleAnalyzeRef = useRef(handleAnalyzeImpl);
  handleAnalyzeRef.current = handleAnalyzeImpl;

  useEffect(() => {
    if (!handoff) {
      handoffAppliedRef.current = null;
      return;
    }
    const key = `${handoff.video.base64.slice(0, 32)}:${handoff.video.size ?? 0}`;
    if (handoffAppliedRef.current === key) return;
    handoffAppliedRef.current = key;

    setVideo(handoff.video);
    setResult(null);
    setAnalyzeFailed(false);
    setFailureMessage(null);
    onHandoffConsumed?.();

    if (handoff.autoAnalyze) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => void handleAnalyzeRef.current(handoff.video));
      });
    }
  }, [handoff, onHandoffConsumed]);

  const handleAnalyze = useMemo(
    () => createLeadingDebouncer(500)(() => void handleAnalyzeRef.current()),
    [],
  );

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleSaveAsset = async (
    type: AssetType,
    content: string,
    title: string,
    saveStatusKey: string = `${type}:${title}`,
  ) => {
    if (!user) return alert('请先登录以收藏资产');

    try {
      const record = await pb.collection('assets').create(
        buildAssetCreateBody({
          userId: user.uid,
          gameProfileId,
          type,
          title,
          content,
          tags: ['创意迭代', creativeProfile.defaultStyle, creativeProfile.defaultMoods],
          likes: 0,
          likedBy: [],
        }),
      );

      if (type === 'inspiration') {
        void logUsageEvent(user.uid, USAGE_EVENT.CREATIVE_INSPIRATION_SAVED, {
          source: 'content_iteration',
          refCollection: 'assets',
          refId: record.id,
          meta: { asset_type: type },
        });
      }

      const labelMap: Record<string, string> = {
        prompt: '提示词',
        full_script: '整篇脚本',
        storyboard: '分镜脚本',
        inspiration: '灵感卡片',
        visual_detail: '画面与口令',
      };

      showToast(`已收藏至资产卡片：${labelMap[type] || type}`, 'success');
      setSaveStatus((prev) => ({ ...prev, [saveStatusKey]: true }));
      setTimeout(() => setSaveStatus((prev) => ({ ...prev, [saveStatusKey]: false })), 2000);
    } catch (err) {
      console.error(err);
      showToast('保存失败，请检查 PocketBase 与 assets 集合配置', 'error');
    }
  };

  const showResultPanel = loading || Boolean(result && result.trim().length > 0);
  const resultTrim = result?.trim() ?? '';
  const showSkeletonInPanel = loading && !resultTrim;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-12 text-center md:text-left">
        <h1 className="text-4xl font-bold text-primary-blue mb-4">创意迭代</h1>
        <p className="text-slate-500 text-lg">
          上传参考视频，进行 1:1 脚本解析与原版复述，精准还原分镜与台词。
        </p>
      </div>

      <div className="space-y-8">
        <div className="glass-card p-8 bg-white border-slate-200 shadow-sm">
          <VideoUploader onUpload={(base64, mimeType, size) => setVideo({ base64, mimeType, size })} />

          <div className="mt-8 space-y-6">
            <div className="flex flex-col items-center pt-4 space-y-6">
              <button
                onClick={handleAnalyze}
                disabled={!video || loading}
                className="bg-accent-blue text-white px-10 py-4 rounded-xl font-bold flex items-center min-w-[200px] justify-center shadow-lg shadow-slate-200 hover:bg-slate-800 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    处理中...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 mr-2" />
                    开始 1:1 脚本复述
                  </>
                )}
              </button>

              {loading && (
                <div className="w-full max-w-md space-y-3">
                  <div className="flex justify-between items-center text-sm mb-1 w-full min-w-0 gap-2">
                    <span className="text-accent-blue font-medium shrink min-w-0">{PHASE_LABEL[phase]}</span>
                  </div>
                  <div className="relative w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                    <motion.div
                      className="absolute top-0 h-full w-1/3 rounded-full bg-accent-blue"
                      initial={false}
                      animate={{ left: ['-34%', '100%'] }}
                      transition={{ duration: 1.25, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 text-center">
                    模型返回后将逐字显示；大文件请耐心等待首段内容。
                  </p>
                  {geminiRetryLabel ? (
                    <p className="text-[10px] text-slate-500 text-center">{geminiRetryLabel}</p>
                  ) : null}
                </div>
              )}

              {analyzeFailed && !loading && (
                <div className="w-full max-w-md rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-black text-rose-700 uppercase tracking-wide text-xs">失败</span>
                    <div className="flex-1 h-2 rounded-full bg-rose-200 overflow-hidden">
                      <div className="h-full w-full bg-rose-500 rounded-full" />
                    </div>
                  </div>
                  <p className="text-rose-800/95 leading-relaxed break-words text-xs">{failureMessage}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {showResultPanel && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-10 bg-white border-slate-200 shadow-sm"
          >
            <div className="flex items-center justify-between mb-8 pb-6 border-b border-slate-100">
              <div className="flex items-center">
                <FileText className="w-6 h-6 text-accent-blue mr-3" />
                <h2 className="text-2xl font-bold text-primary-blue tracking-tight">拆解结果</h2>
              </div>
              <div className="flex items-center gap-2">
                <ActionButton
                  onClick={() => setIsEditing(!isEditing)}
                  icon={<FileText className="w-4 h-4" />}
                  label={isEditing ? '预览' : '编辑'}
                  disabled={loading || !resultTrim}
                />
                <ActionButton
                  onClick={() => result && handleCopy(result)}
                  icon={<Copy className="w-4 h-4" />}
                  label="复制"
                  disabled={loading || !resultTrim}
                />
                <ActionButton
                  onClick={() =>
                    void handleSaveAsset(
                      'full_script',
                      result ?? '',
                      '分析脚本_' + new Date().toLocaleTimeString(),
                      FULL_SCRIPT_SAVE_KEY,
                    )
                  }
                  icon={
                    saveStatus[FULL_SCRIPT_SAVE_KEY] ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <Bookmark className="w-4 h-4" />
                    )
                  }
                  label="收藏脚本"
                  active={saveStatus[FULL_SCRIPT_SAVE_KEY]}
                  disabled={loading || !resultTrim}
                />
              </div>
            </div>

            <div className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100 group relative min-h-[200px]">
              {showSkeletonInPanel ? (
                <IterationResultSkeleton />
              ) : isEditing ? (
                <textarea
                  value={result ?? ''}
                  onChange={(e) => setResult(e.target.value)}
                  className="w-full bg-transparent border-none outline-none resize-none text-slate-700 leading-relaxed font-sans min-h-[400px] text-lg"
                />
              ) : (
                <div className="markdown-body prose prose-slate prose-blue max-w-none">
                  <ReactMarkdown>{result ?? ''}</ReactMarkdown>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  icon,
  label,
  active,
  disabled,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none ${
        active
          ? 'bg-primary-blue text-white border-primary-blue'
          : 'bg-white border-slate-200 text-slate-500 hover:text-primary-blue hover:border-slate-300'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
