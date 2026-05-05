import { useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles, FileText, Bookmark, Copy, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import VideoUploader from './VideoUploader';
import { geminiService } from '../services/gemini';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
import { pb } from '../lib/pb';
import { createLeadingDebouncer } from '../lib/leadingDebounce';
import { logUsageEvent } from '../lib/logUsageEvent';
import { USAGE_EVENT } from '../lib/usageEvents';
import { buildAssetCreateBody } from '../lib/recordMappers';
import { AssetType } from '../types';

const FULL_SCRIPT_SAVE_KEY = 'iteration:full_script';
const DEFAULT_STYLE = '真人3D写实风格';
const DEFAULT_MOODS = '治愈、惊喜';

export default function ContentIteration() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [video, setVideo] = useState<{ base64: string; mimeType: string; size?: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{[key: string]: boolean}>({});
  const [geminiRetryLabel, setGeminiRetryLabel] = useState<string | null>(null);

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
    }),
    [geminiOpts, user?.uid],
  );

  /**
   * 预处理视频逻辑 - 集成 ffmpeg.wasm 占位
   */
  const preProcessVideo = async (inputBase64: string): Promise<string> => {
    return new Promise((resolve) => {
      // 阶段一：音视频分离与压制
      setProgress(20);
      
      console.log('FFMPEG Action: ffmpeg.load()');
      
      setTimeout(() => {
        console.log('FFMPEG Action: ffmpeg.FS writing input file (Original Size: ~' + (inputBase64.length * 0.75 / (1024 * 1024)).toFixed(2) + ' MB)');
        console.log('FFMPEG Action: ffmpeg.run -i input.mp4 -vf "fps=5,scale=-1:480" -c:v libx264 -crf 31 -c:a aac -b:a 64k output.mp4');
        console.log('FFMPEG Action: Compression finished. Simulated Output Size: ~' + (inputBase64.length * 0.15 / (1024 * 1024)).toFixed(2) + ' MB (Reduction: 85%)');
        
        // 阶段二：传输至创意中心
        setProgress(50);
        
        setTimeout(() => {
          // 阶段三：灵感提取中
          setProgress(80);
          
          resolve(inputBase64); // 目前直接返回原数据，模拟处理完成
        }, 1500);
      }, 2000);
    });
  };

  const handleAnalyzeImpl = async () => {
    if (!video) return;

    // 检查体积是否超过 200MB
    const fileSizeInMB = (video.size || 0) / (1024 * 1024);
    if (fileSizeInMB > 200) {
      console.error('Video size exceeds 200MB limit.');
      alert('视频体积较大（超过 200MB），请处理后再上传以保证稳定性。');
      return;
    }

    setLoading(true);
    setGeminiRetryLabel(null);
    setResult(null);
    setProgress(0);
    try {
      // 执行预处理
      const processedBase64 = await preProcessVideo(video.base64);

      // 最终提取阶段
      const script = await geminiService.analyzeVideoIteration(
        processedBase64,
        video.mimeType,
        DEFAULT_STYLE,
        DEFAULT_MOODS,
        geminiCallOpts,
      );
      setResult(script || "分析失败，请重试。");
      if (user?.uid) {
        void logUsageEvent(user.uid, USAGE_EVENT.SCRIPT_GENERATED, {
          source: 'content_iteration',
          meta: { variant: 'analyze_video_iteration' },
        });
      }
      setProgress(100);
      setIsEditing(false);
    } catch (error) {
      console.error(error);
      setResult("发生错误，请检查网络或 API 配置。");
    } finally {
      setGeminiRetryLabel(null);
      setLoading(false);
    }
  };

  const handleAnalyzeRef = useRef(handleAnalyzeImpl);
  handleAnalyzeRef.current = handleAnalyzeImpl;

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
    saveStatusKey: string = `${type}:${title}`
  ) => {
    if (!user) return alert('请先登录以收藏资产');

    try {
      const record = await pb.collection('assets').create(
        buildAssetCreateBody({
          userId: user.uid,
          type,
          title,
          content,
          tags: ['创意迭代', DEFAULT_STYLE, DEFAULT_MOODS],
          likes: 0,
          likedBy: [],
        })
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
      setTimeout(
        () => setSaveStatus((prev) => ({ ...prev, [saveStatusKey]: false })),
        2000
      );
    } catch (err) {
      console.error(err);
      showToast('保存失败，请检查 PocketBase 与 assets 集合配置', 'error');
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-12 text-center md:text-left">
        <h1 className="text-4xl font-bold text-primary-blue mb-4">创意迭代</h1>
        <p className="text-slate-500 text-lg">上传参考视频，进行 1:1 脚本解析与原版复述，精准还原分镜与台词。</p>
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
                  <div className="flex justify-between items-center text-sm mb-1 w-full min-w-0">
                    <span className="text-accent-blue font-medium animate-pulse shrink-0">当前进度</span>
                    <span className="text-slate-400 font-mono tabular-nums shrink-0">{progress}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                    <motion.div 
                      className="h-full bg-accent-blue"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 text-center">正在使用深度学习模型提取视觉灵感与核心卖点</p>
                  {geminiRetryLabel ? (
                    <p className="text-[10px] text-slate-500 text-center">{geminiRetryLabel}</p>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>

        {result && (
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
                />
                <ActionButton 
                  onClick={() => handleCopy(result)} 
                  icon={<Copy className="w-4 h-4" />} 
                  label="复制" 
                />
                <ActionButton
                  onClick={() =>
                    void handleSaveAsset(
                      'full_script',
                      result,
                      '分析脚本_' + new Date().toLocaleTimeString(),
                      FULL_SCRIPT_SAVE_KEY
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
                />
              </div>
            </div>

            <div className="p-8 bg-slate-50 rounded-[2rem] border border-slate-100 group relative">
              {isEditing ? (
                <textarea
                  value={result}
                  onChange={(e) => setResult(e.target.value)}
                  className="w-full bg-transparent border-none outline-none resize-none text-slate-700 leading-relaxed font-sans min-h-[400px] text-lg"
                />
              ) : (
                <div className="markdown-body prose prose-slate prose-blue max-w-none">
                  <ReactMarkdown>{result}</ReactMarkdown>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function ActionButton({ onClick, icon, label, active }: { onClick: () => void, icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer ${active ? 'bg-primary-blue text-white border-primary-blue' : 'bg-white border-slate-200 text-slate-500 hover:text-primary-blue hover:border-slate-300'}`}
    >
      {icon}
      {label}
    </button>
  );
}
