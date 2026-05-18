/**
 * 买量大屏：爬榜单 / 找钩子 / 追热梗。
 *
 * PocketBase 集合名：`buying_videos`。请在 Admin 中创建并添加字段（均为普通 Text，除非注明 File）：
 * - userId (text)
 * - gameProfileId (text)
 * - dashboardMode (text): ranking | hooks | trending
 * - rankingSegment (text，爬榜单必填): internal_top（团队 TOP）| competitor_top（竞品 TOP）
 *   猫爪/脚本批量入库时请按目标榜单写入；前端批量上传会写入所选榜单。
 * - title, sourceType (internal|external), sourceLabel, runTimeText, runVolumeText
 * - placements (text, JSON 数组): douyin_portrait_916 | tencent_landscape_169 | tencent_portrait_916
 * - scriptTags (text, JSON 字符串数组)：上传后由 Gemini 写入 [游戏名, 视频类型, 3秒钩子×2]；可由前端或 POST /api/buying-videos/ingest 回填
 * - hookAnalysisJson (text, JSON)：找钩子模式下前 5 秒 + 首卖点分析
 * - cover (file, jpg), preview (file, mp4)
 *
 * 自动回填：PocketBase `onRecordAfterCreateSuccess` 等可对 Node 发起 POST `/api/buying-videos/ingest`，body `{ "recordId": "<id>" }`，
 * Header `X-Ingest-Secret` 与 `BUYING_VIDEO_INGEST_SECRET` 一致；需 `POCKETBASE_ADMIN_*` 以便服务端下载 preview 并 PATCH。
 * 若 scriptTags 已非空（例如浏览器已分析），ingest 会跳过。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BarChart3,
  Clapperboard,
  Flame,
  LayoutGrid,
  Loader2,
  Play,
  Plus,
  Search,
  TrendingUp,
  Upload,
  Files,
  X,
  Sparkles,
} from 'lucide-react';
import { ClientResponseError } from 'pocketbase';
import { pb } from '../lib/pb';
import { useAuth } from '../lib/AuthContext';
import { useToast } from '../lib/ToastContext';
import { useGameProfile } from '../lib/GameProfileContext';
import { gameProfileScopeFilterExpr } from '../lib/gameProfiles';
import { recordToBuyingVideo, sortBuyingVideosByRunVolumeDesc } from '../lib/buyingVideoMapper';
import type { IterationVideoPayload } from '../lib/iterationHandoff';
import { fetchUrlAsIterationVideo, readBlobAsBase64Body } from '../lib/readBlobAsBase64';
import { generateBuyingVideoMediaArtifacts, isLikelyVideoFile } from '../lib/videoCompressFfmpeg';
import {
  rankingSegmentLabel,
  RANKING_SEGMENT_OPTIONS,
  readStoredRankingSegment,
  storeRankingSegment,
  titleFromVideoFileName,
} from '../lib/buyingRankingSegment';
import { geminiService } from '../services/gemini';
import type {
  BuyingDashboardMode,
  BuyingRankingSegment,
  BuyingTrendingPlacement,
  BuyingVideoItem,
} from '../types';

const COLLECTION = 'buying_videos';

const TRENDING_PLACEMENT_META: {
  id: BuyingTrendingPlacement;
  label: string;
  aspect: '9/16' | '16/9';
}[] = [
  { id: 'douyin_portrait_916', label: '抖音竖版 9:16', aspect: '9/16' },
  { id: 'tencent_landscape_169', label: '腾讯横版 16:9', aspect: '16/9' },
  { id: 'tencent_portrait_916', label: '腾讯竖版 9:16', aspect: '9/16' },
];

function placementLabel(id: BuyingTrendingPlacement): string {
  return TRENDING_PLACEMENT_META.find((p) => p.id === id)?.label ?? id;
}

function sourceBadge(item: BuyingVideoItem) {
  if (item.sourceType === 'internal') {
    return { text: `内部 · ${item.sourceLabel || '未填昵称'}`, cls: 'bg-emerald-500/15 text-emerald-800' };
  }
  return { text: `外部 · ${item.sourceLabel || '未填游戏名'}`, cls: 'bg-amber-500/15 text-amber-900' };
}

/** 脚本标签单行展示：游戏 · 类型 · 钩子1 · 钩子2 */
function compactScriptLine(tags: string[]): string {
  if (!tags.length) return '';
  return tags.map((t) => t.trim()).filter(Boolean).join(' · ');
}

/** 与 ingest 一致：AI 吃的是 preview.mp4，文件名仍保留原片 stem 供推断游戏名 */
function previewFileNameForAi(originalName: string): string {
  const stem = originalName.replace(/\.[^.]+$/, '').trim() || 'video';
  return `${stem}.mp4`;
}

type BuyingDashboardProps = {
  canAccessWorkshop: boolean;
  onSendToIteration: (video: IterationVideoPayload) => void;
  onRequestLogin: () => void;
};

export default function BuyingDashboard({
  canAccessWorkshop,
  onSendToIteration,
  onRequestLogin,
}: BuyingDashboardProps) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { gameProfileId } = useGameProfile();

  const [mode, setMode] = useState<BuyingDashboardMode>('ranking');
  const [rankingSegment, setRankingSegmentState] = useState<BuyingRankingSegment>(
    () => readStoredRankingSegment() ?? 'competitor_top',
  );
  const setRankingSegment = useCallback((segment: BuyingRankingSegment) => {
    setRankingSegmentState(segment);
    storeRankingSegment(segment);
  }, []);
  const [trendingPlacement, setTrendingPlacement] = useState<BuyingTrendingPlacement>('douyin_portrait_916');

  const [items, setItems] = useState<BuyingVideoItem[]>([]);
  const [rawLoading, setRawLoading] = useState(true);
  const [previewItem, setPreviewItem] = useState<BuyingVideoItem | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formSourceType, setFormSourceType] = useState<'internal' | 'external'>('internal');
  const [formSourceLabel, setFormSourceLabel] = useState('');
  const [formRunTime, setFormRunTime] = useState('');
  const [formRunVolume, setFormRunVolume] = useState('');
  const [formRankingSegment, setFormRankingSegment] = useState<BuyingRankingSegment>('internal_top');
  const [formPlacements, setFormPlacements] = useState<BuyingTrendingPlacement[]>(['douyin_portrait_916']);
  const [searchQuery, setSearchQuery] = useState('');

  const [batchUploadOpen, setBatchUploadOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchRankingSegment, setBatchRankingSegment] = useState<BuyingRankingSegment>('competitor_top');
  const [batchSourceType, setBatchSourceType] = useState<'internal' | 'external'>('external');
  const [batchSourceLabel, setBatchSourceLabel] = useState('');
  const [batchRunTime, setBatchRunTime] = useState('');
  const [batchRunVolume, setBatchRunVolume] = useState('');

  const load = useCallback(async () => {
    setRawLoading(true);
    try {
      const base = `(${gameProfileScopeFilterExpr('gameProfileId', gameProfileId)}) && dashboardMode = ${JSON.stringify(mode)}`;
      const filter =
        mode === 'ranking'
          ? `${base} && rankingSegment = ${JSON.stringify(rankingSegment)}`
          : base;
      const records = await pb.collection(COLLECTION).getFullList({
        filter,
        sort: '-created',
        // 关闭该请求的自动取消（见 pocketbase js-sdk auto-cancellation）
        requestKey: null,
      });
      let mapped = records.map(recordToBuyingVideo);
      if (mode === 'trending') {
        mapped = mapped.filter((v) => v.placements.includes(trendingPlacement));
      }
      setItems(sortBuyingVideosByRunVolumeDesc(mapped));
    } catch (e) {
      if (e instanceof ClientResponseError && e.isAbort) return;
      console.error(e);
      setItems([]);
      showToast('加载买量视频失败：请确认 PocketBase 已创建 buying_videos 集合及字段', 'error');
    } finally {
      setRawLoading(false);
    }
  }, [gameProfileId, mode, rankingSegment, trendingPlacement, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matched = !q
      ? items
      : items.filter((item) => {
          const hay = [
            item.title,
            item.sourceLabel,
            item.runTimeText,
            item.runVolumeText,
            ...item.scriptTags,
            item.hookAnalysis?.firstFiveSecondsSummary,
            item.hookAnalysis?.firstSellingPoint?.method,
            item.hookAnalysis?.firstSellingPoint?.visualAnalysis,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return hay.includes(q);
        });
    return sortBuyingVideosByRunVolumeDesc(matched);
  }, [items, searchQuery]);

  const openUpload = () => {
    if (!user) {
      alert('请先登录后再上传视频');
      return;
    }
    setFormRankingSegment(mode === 'ranking' ? rankingSegment : 'internal_top');
    setFormPlacements([trendingPlacement]);
    setUploadOpen(true);
  };

  const openBatchUpload = () => {
    if (!user) {
      alert('请先登录后再批量上传');
      return;
    }
    setBatchRankingSegment(rankingSegment);
    setBatchFiles([]);
    setBatchUploadOpen(true);
  };

  const submitBatchUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || batchFiles.length === 0) return;

    setBatchBusy(true);
    let ok = 0;
    let fail = 0;
    const sourceLabelFinal =
      batchSourceType === 'internal'
        ? batchSourceLabel.trim() || user.displayName || '内部'
        : batchSourceLabel.trim() || '外部';

    try {
      for (let i = 0; i < batchFiles.length; i++) {
        const file = batchFiles[i]!;
        const title = titleFromVideoFileName(file.name);
        setBatchProgress(`处理 ${i + 1}/${batchFiles.length}：${title}`);

        const { posterJpeg, previewMp4 } = await generateBuyingVideoMediaArtifacts(file, ({ overall, phase }) => {
          const label = phase === 'load' ? '加载 FFmpeg' : phase === 'poster' ? '封面' : '预览';
          setBatchProgress(`${i + 1}/${batchFiles.length} ${title} · ${label} ${Math.round(overall * 100)}%`);
        });

        const fd = new FormData();
        fd.append('userId', user.uid);
        fd.append('gameProfileId', gameProfileId);
        fd.append('dashboardMode', 'ranking');
        fd.append('rankingSegment', batchRankingSegment);
        fd.append('title', title);
        fd.append('sourceType', batchSourceType);
        fd.append('sourceLabel', sourceLabelFinal);
        fd.append('runTimeText', batchRunTime.trim());
        fd.append('runVolumeText', batchRunVolume.trim());
        fd.append('placements', JSON.stringify([]));
        fd.append('scriptTags', JSON.stringify([]));
        fd.append('hookAnalysisJson', JSON.stringify({}));
        fd.append('cover', posterJpeg, 'cover.jpg');
        fd.append('preview', previewMp4, 'preview.mp4');

        try {
          await pb.collection(COLLECTION).create(fd);
          ok++;
        } catch (err) {
          console.error(err);
          fail++;
        }
      }

      setRankingSegment(batchRankingSegment);
      if (fail === 0) {
        showToast(`已批量录入 ${ok} 条至${rankingSegmentLabel(batchRankingSegment)}`);
      } else {
        showToast(`完成：成功 ${ok} 条，失败 ${fail} 条（${rankingSegmentLabel(batchRankingSegment)}）`, fail > 0 ? 'error' : 'success');
      }
      setBatchUploadOpen(false);
      setBatchFiles([]);
      await load();
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : '批量上传失败', 'error');
    } finally {
      setBatchBusy(false);
      setBatchProgress(null);
    }
  };

  const togglePlacement = (id: BuyingTrendingPlacement) => {
    setFormPlacements((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id].sort((a, b) => a.localeCompare(b)),
    );
  };

  const submitUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !videoFile || !formTitle.trim()) return;
    if (mode === 'trending' && formPlacements.length === 0) {
      showToast('追热梗模式请至少选择一个版位', 'error');
      return;
    }

    setUploadBusy(true);
    setUploadProgress('生成封面与预览…');
    try {
      const { posterJpeg, previewMp4 } = await generateBuyingVideoMediaArtifacts(videoFile, ({ overall, phase }) => {
        const label = phase === 'load' ? '加载 FFmpeg' : phase === 'poster' ? '生成封面 JPG' : '生成低码率预览';
        setUploadProgress(`${label} ${Math.round(overall * 100)}%`);
      });

      setUploadProgress('AI 分析视频中…');
      const base64 = await readBlobAsBase64Body(previewMp4);
      const ai = await geminiService.analyzeBuyingVideo(
        base64,
        'video/mp4',
        previewFileNameForAi(videoFile.name),
        mode === 'hooks',
        { analyticsUserId: user.uid, gameProfileId },
      );

      const h0 = ai.hook3sTags[0] ?? '钩子1';
      const h1 = ai.hook3sTags[1] ?? '钩子2';
      const scriptTags = [ai.gameName, ai.videoType, h0, h1];

      const sourceLabelFinal =
        formSourceType === 'external'
          ? (formSourceLabel.trim() || ai.gameName)
          : (formSourceLabel.trim() || user.displayName || '内部');

      const hookPayload =
        mode === 'hooks' && ai.hooksDeep
          ? {
              firstFiveSecondsSummary: ai.hooksDeep.firstFiveSecondsSummary,
              firstSellingPoint: ai.hooksDeep.firstSellingPoint,
            }
          : {};

      const fd = new FormData();
      fd.append('userId', user.uid);
      fd.append('gameProfileId', gameProfileId);
      fd.append('dashboardMode', mode);
      fd.append('rankingSegment', mode === 'ranking' ? formRankingSegment : '');
      fd.append('title', formTitle.trim());
      fd.append('sourceType', formSourceType);
      fd.append('sourceLabel', sourceLabelFinal);
      fd.append('runTimeText', formRunTime.trim());
      fd.append('runVolumeText', formRunVolume.trim());
      fd.append('placements', JSON.stringify(mode === 'trending' ? formPlacements : []));
      fd.append('scriptTags', JSON.stringify(scriptTags));
      fd.append('hookAnalysisJson', JSON.stringify(hookPayload));

      fd.append('cover', posterJpeg, 'cover.jpg');
      fd.append('preview', previewMp4, 'preview.mp4');

      await pb.collection(COLLECTION).create(fd);
      showToast('上传成功');
      setUploadOpen(false);
      setVideoFile(null);
      setFormTitle('');
      setFormSourceLabel('');
      setFormRunTime('');
      setFormRunVolume('');
      await load();
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : '上传失败', 'error');
    } finally {
      setUploadBusy(false);
      setUploadProgress(null);
    }
  };

  const trendingAspect = useMemo(() => {
    return TRENDING_PLACEMENT_META.find((p) => p.id === trendingPlacement)?.aspect ?? '9/16';
  }, [trendingPlacement]);

  return (
    <div className="w-full">
      <header className="mb-8 flex flex-col gap-6">
        <div>
          <h1 className="text-4xl font-black text-primary-blue mb-2 flex items-center gap-3">
            <BarChart3 className="h-10 w-10 text-accent-blue" />
            买量大屏
          </h1>
          <p className="text-slate-500 max-w-2xl text-sm leading-relaxed">
            上传后先在本地生成低码率预览，再由 AI 解析并写入脚本标签（游戏名、视频类型、前 3 秒双钩子）；找钩子模式额外生成前 5 秒与首卖点分析。封面与预览由 FFmpeg 在本地生成。
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="关键词检索（标题、标签、来源、跑量信息等）"
              className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm outline-none transition focus:border-accent-blue/40 focus:ring-2 focus:ring-accent-blue/10"
            />
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {mode === 'ranking' && (
              <button
                type="button"
                onClick={() => void openBatchUpload()}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-primary-blue shadow-sm transition hover:border-accent-blue/40 hover:bg-slate-50"
              >
                <Files className="h-5 w-5" />
                批量上传
              </button>
            )}
            <button
              type="button"
              onClick={() => void openUpload()}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary-blue px-6 py-3 font-bold text-white shadow-lg transition hover:bg-primary-blue/90"
            >
              <Upload className="h-5 w-5" />
              上传视频
            </button>
          </div>
        </div>
      </header>

      <div className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white/80 p-2 shadow-sm">
        {(
          [
            { id: 'ranking' as const, label: '爬榜单', icon: <TrendingUp className="h-4 w-4" /> },
            { id: 'hooks' as const, label: '找钩子', icon: <Clapperboard className="h-4 w-4" /> },
            { id: 'trending' as const, label: '追热梗', icon: <Flame className="h-4 w-4" /> },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMode(tab.id)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
              mode === tab.id
                ? 'bg-accent-blue text-white shadow-md'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {mode === 'ranking' && (
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            {RANKING_SEGMENT_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setRankingSegment(t.id)}
                className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                  rankingSegment === t.id
                    ? 'border-accent-blue bg-accent-blue/10 text-primary-blue'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-accent-blue/40'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            批量上传时可选择录入竞品 TOP 或团队 TOP，默认记住上次选择
          </p>
        </div>
      )}

      {mode === 'trending' && (
        <div className="mb-6 flex flex-wrap gap-2">
          {TRENDING_PLACEMENT_META.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setTrendingPlacement(p.id)}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                trendingPlacement === p.id
                  ? 'border-accent-blue bg-accent-blue/10 text-primary-blue'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-accent-blue/40'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {rawLoading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="h-10 w-10 animate-spin text-accent-blue" />
        </div>
      ) : items.length === 0 ? (
        <div className="glass-card border-dashed py-20 text-center text-slate-500">
          <LayoutGrid className="mx-auto mb-3 h-12 w-12 opacity-30" />
          <p className="font-bold">暂无视频</p>
          <p className="mt-1 text-sm">上传后将显示在当前模式与游戏版本下。</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="glass-card border-dashed py-16 text-center text-slate-500">
          <Search className="mx-auto mb-3 h-10 w-10 opacity-25" />
          <p className="font-bold">无匹配结果</p>
          <p className="mt-1 text-sm">尝试更换关键词或清空检索栏。</p>
        </div>
      ) : mode === 'ranking' ? (
        <RankingGrid items={filteredItems} onOpenPreview={setPreviewItem} />
      ) : mode === 'hooks' ? (
        <HooksGrid items={filteredItems} onOpenPreview={setPreviewItem} />
      ) : (
        <TrendingGrid items={filteredItems} aspect={trendingAspect} onOpenPreview={setPreviewItem} />
      )}

      <AnimatePresence>
        {previewItem && (
          <PreviewOverlay
            item={previewItem}
            layout={mode === 'ranking' ? 'split' : 'stack'}
            onClose={() => setPreviewItem(null)}
            canAccessWorkshop={canAccessWorkshop}
            isLoggedIn={Boolean(user)}
            onRequestLogin={onRequestLogin}
            onSendToIteration={onSendToIteration}
            showToast={showToast}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {uploadOpen && (
          <UploadModal
            mode={mode}
            busy={uploadBusy}
            progress={uploadProgress}
            videoFile={videoFile}
            onVideoChange={setVideoFile}
            formTitle={formTitle}
            setFormTitle={setFormTitle}
            formSourceType={formSourceType}
            setFormSourceType={setFormSourceType}
            formSourceLabel={formSourceLabel}
            setFormSourceLabel={setFormSourceLabel}
            formRunTime={formRunTime}
            setFormRunTime={setFormRunTime}
            formRunVolume={formRunVolume}
            setFormRunVolume={setFormRunVolume}
            formRankingSegment={formRankingSegment}
            setFormRankingSegment={setFormRankingSegment}
            formPlacements={formPlacements}
            togglePlacement={togglePlacement}
            onSubmit={(ev) => void submitUpload(ev)}
            onClose={() => !uploadBusy && setUploadOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {batchUploadOpen && (
          <BatchUploadModal
            busy={batchBusy}
            progress={batchProgress}
            files={batchFiles}
            onFilesChange={setBatchFiles}
            rankingSegment={batchRankingSegment}
            setRankingSegment={setBatchRankingSegment}
            sourceType={batchSourceType}
            setSourceType={setBatchSourceType}
            sourceLabel={batchSourceLabel}
            setSourceLabel={setBatchSourceLabel}
            runTime={batchRunTime}
            setRunTime={setBatchRunTime}
            runVolume={batchRunVolume}
            setRunVolume={setBatchRunVolume}
            onSubmit={(ev) => void submitBatchUpload(ev)}
            onClose={() => !batchBusy && setBatchUploadOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function RankingGrid({
  items,
  onOpenPreview,
}: {
  items: BuyingVideoItem[];
  onOpenPreview: (item: BuyingVideoItem) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => (
        <RankingCard key={item.id} item={item} onActivate={() => onOpenPreview(item)} />
      ))}
    </div>
  );
}

function RankingCard({ item, onActivate }: { item: BuyingVideoItem; onActivate: () => void }) {
  const badge = sourceBadge(item);
  return (
    <button
      type="button"
      onClick={onActivate}
      className="group flex w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:border-accent-blue/40 hover:shadow-md"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
        {item.coverUrl ? (
          <img src={item.coverUrl} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-500">无封面</div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/35">
          <Play className="h-10 w-10 text-white opacity-0 transition group-hover:opacity-100 drop-shadow-lg" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="line-clamp-2 text-xs font-bold leading-snug text-slate-800">{item.title}</div>
        {item.scriptTags.length > 0 && (
          <p className="line-clamp-1 text-[10px] leading-snug text-slate-500">{compactScriptLine(item.scriptTags)}</p>
        )}
        <span className={`w-fit rounded-lg px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.text}</span>
        <div className="text-[10px] text-slate-500">
          <div>跑量时间：{item.runTimeText || '—'}</div>
          <div className="line-clamp-2">跑量数据：{item.runVolumeText || '—'}</div>
        </div>
      </div>
    </button>
  );
}

function HooksGrid({
  items,
  onOpenPreview,
}: {
  items: BuyingVideoItem[];
  onOpenPreview: (item: BuyingVideoItem) => void;
}) {
  return (
    <div className="columns-1 gap-6 space-y-6 md:columns-2 lg:columns-3">
      {items.map((item) => (
        <div key={item.id} className="break-inside-avoid">
          <HookCard item={item} onActivate={() => onOpenPreview(item)} />
        </div>
      ))}
    </div>
  );
}

function HookCard({ item, onActivate }: { item: BuyingVideoItem; onActivate: () => void }) {
  const badge = sourceBadge(item);
  const ha = item.hookAnalysis;
  return (
    <button
      type="button"
      onClick={onActivate}
      className="group flex w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:border-accent-blue/40 hover:shadow-md"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
        {item.coverUrl ? (
          <img src={item.coverUrl} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-500">无封面</div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/35">
          <Play className="h-10 w-10 text-white opacity-0 transition group-hover:opacity-100 drop-shadow-lg" />
        </div>
      </div>
      <div className="space-y-2 p-4">
        <div className="line-clamp-1 font-bold text-slate-800">{item.title}</div>
        {item.scriptTags.length > 0 && (
          <p className="line-clamp-1 text-[10px] text-slate-500">{compactScriptLine(item.scriptTags)}</p>
        )}
        <span className={`inline-block rounded-lg px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.text}</span>
        <div className="rounded-lg border border-slate-100 bg-slate-50/90 p-2.5 text-[11px] leading-snug text-slate-600">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">前 5 秒</div>
          <p className="mt-0.5 line-clamp-2">{ha?.firstFiveSecondsSummary || '—'}</p>
          <div className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">首卖点</div>
          <p className="mt-0.5 line-clamp-2">
            {ha?.firstSellingPoint != null && Number.isFinite(ha.firstSellingPoint.approxTimeSec)
              ? `约 ${ha.firstSellingPoint.approxTimeSec}s${ha.firstSellingPoint.method ? ` · ${ha.firstSellingPoint.method}` : ''}`
              : ha?.firstSellingPoint?.method || '—'}
          </p>
          {ha?.firstSellingPoint?.visualAnalysis ? (
            <p className="mt-1 line-clamp-2 text-slate-500">{ha.firstSellingPoint.visualAnalysis}</p>
          ) : null}
        </div>
        <div className="text-[10px] text-slate-500">
          <div>跑量时间：{item.runTimeText || '—'}</div>
          <div>跑量数据：{item.runVolumeText || '—'}</div>
        </div>
      </div>
    </button>
  );
}

function TrendingGrid({
  items,
  aspect,
  onOpenPreview,
}: {
  items: BuyingVideoItem[];
  aspect: '9/16' | '16/9';
  onOpenPreview: (item: BuyingVideoItem) => void;
}) {
  const ratio = aspect === '9/16' ? 'aspect-[9/16]' : 'aspect-video';
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => (
        <TrendingCard key={item.id} item={item} frameClass={ratio} onActivate={() => onOpenPreview(item)} />
      ))}
    </div>
  );
}

function TrendingCard({
  item,
  frameClass,
  onActivate,
}: {
  item: BuyingVideoItem;
  frameClass: string;
  onActivate: () => void;
}) {
  const badge = sourceBadge(item);
  return (
    <button
      type="button"
      onClick={onActivate}
      className="group flex w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:border-accent-blue/40 hover:shadow-md"
    >
      <div className={`relative w-full overflow-hidden bg-slate-900 ${frameClass}`}>
        {item.coverUrl ? (
          <img src={item.coverUrl} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-500">无封面</div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/35">
          <Play className="h-10 w-10 text-white opacity-0 transition group-hover:opacity-100 drop-shadow-lg" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="line-clamp-2 text-xs font-bold text-slate-800">{item.title}</div>
        {item.scriptTags.length > 0 && (
          <p className="line-clamp-1 text-[10px] leading-snug text-slate-500">{compactScriptLine(item.scriptTags)}</p>
        )}
        <span className={`w-fit rounded-lg px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.text}</span>
        <div className="text-[10px] text-slate-500">
          <div>版位：{item.placements.map(placementLabel).join('、')}</div>
          <div>跑量时间：{item.runTimeText || '—'}</div>
          <div className="line-clamp-2">跑量数据：{item.runVolumeText || '—'}</div>
        </div>
      </div>
    </button>
  );
}

function PreviewOverlay({
  item,
  layout,
  onClose,
  canAccessWorkshop,
  isLoggedIn,
  onRequestLogin,
  onSendToIteration,
  showToast,
}: {
  item: BuyingVideoItem;
  layout: 'split' | 'stack';
  onClose: () => void;
  canAccessWorkshop: boolean;
  isLoggedIn: boolean;
  onRequestLogin: () => void;
  onSendToIteration: (video: IterationVideoPayload) => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
}) {
  const [preparingIteration, setPreparingIteration] = useState(false);

  const handleJumpToIteration = async () => {
    if (!isLoggedIn) {
      onRequestLogin();
      return;
    }
    if (!canAccessWorkshop) {
      showToast('当前账号无创意工坊权限', 'error');
      return;
    }
    if (!item.previewUrl) {
      showToast('该条素材无预览视频', 'error');
      return;
    }
    setPreparingIteration(true);
    try {
      const { base64, mimeType, size } = await fetchUrlAsIterationVideo(item.previewUrl);
      onSendToIteration({ base64, mimeType, size, title: item.title });
      onClose();
      showToast('已带入创意迭代，正在生成 1:1 复刻脚本…', 'success');
    } catch (e) {
      console.error(e);
      showToast(e instanceof Error ? e.message : '准备视频失败', 'error');
    } finally {
      setPreparingIteration(false);
    }
  };

  const iterationButton = (
    <button
      type="button"
      onClick={() => void handleJumpToIteration()}
      disabled={!item.previewUrl || preparingIteration}
      className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-accent-blue bg-accent-blue px-4 py-3.5 text-sm font-black text-white shadow-lg shadow-accent-blue/20 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {preparingIteration ? (
        <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
      ) : (
        <Sparkles className="h-5 w-5 shrink-0" />
      )}
      {preparingIteration ? '正在准备视频…' : '一键跳转创意迭代 · 1:1 复刻脚本'}
    </button>
  );

  return (
    <motion.div
      key="ov"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className={`relative flex max-h-[90vh] w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl ${
          layout === 'split' ? 'max-w-6xl flex-col lg:flex-row' : 'max-w-4xl flex-col'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`relative flex min-h-0 flex-1 items-center justify-center bg-black ${layout === 'split' ? 'lg:min-w-[55%]' : ''}`}>
          {item.previewUrl ? (
            <video
              key={item.id}
              className="max-h-[min(72vh,720px)] w-full object-contain"
              src={item.previewUrl}
              controls
              playsInline
              autoPlay
            />
          ) : (
            <p className="p-8 text-white">无预览文件</p>
          )}
        </div>
        {layout === 'split' ? (
          <div className="flex max-h-[50vh] w-full flex-col gap-3 overflow-y-auto border-t border-slate-200 p-6 lg:max-h-none lg:w-[320px] lg:border-l lg:border-t-0">
            <div>
              <h3 className="text-base font-black text-primary-blue">脚本标签</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                已由 AI 根据画面与文件名生成；格式为「游戏 · 类型 · 3秒钩子×2」。
              </p>
            </div>
            {item.scriptTags.length ? (
              <p className="text-sm font-medium leading-snug text-slate-800">{compactScriptLine(item.scriptTags)}</p>
            ) : (
              <p className="text-sm text-slate-400">暂无</p>
            )}
            <div className="mt-1">{iterationButton}</div>
            <div className="mt-auto border-t border-slate-100 pt-4 text-xs text-slate-500">
              <div className="font-bold text-slate-700">{item.title}</div>
              <div className="mt-1">{sourceBadge(item).text}</div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            {item.scriptTags.length > 0 ? (
              <p className="text-[13px] font-medium leading-snug">{compactScriptLine(item.scriptTags)}</p>
            ) : null}
            {iterationButton}
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-slate-600 shadow hover:bg-white"
          aria-label="关闭"
        >
          <X className="h-5 w-5" />
        </button>
      </motion.div>
    </motion.div>
  );
}

function UploadModal({
  mode,
  busy,
  progress,
  videoFile,
  onVideoChange,
  formTitle,
  setFormTitle,
  formSourceType,
  setFormSourceType,
  formSourceLabel,
  setFormSourceLabel,
  formRunTime,
  setFormRunTime,
  formRunVolume,
  setFormRunVolume,
  formRankingSegment,
  setFormRankingSegment,
  formPlacements,
  togglePlacement,
  onSubmit,
  onClose,
}: {
  mode: BuyingDashboardMode;
  busy: boolean;
  progress: string | null;
  videoFile: File | null;
  onVideoChange: (f: File | null) => void;
  formTitle: string;
  setFormTitle: (v: string) => void;
  formSourceType: 'internal' | 'external';
  setFormSourceType: (v: 'internal' | 'external') => void;
  formSourceLabel: string;
  setFormSourceLabel: (v: string) => void;
  formRunTime: string;
  setFormRunTime: (v: string) => void;
  formRunVolume: string;
  setFormRunVolume: (v: string) => void;
  formRankingSegment: BuyingRankingSegment;
  setFormRankingSegment: (v: BuyingRankingSegment) => void;
  formPlacements: BuyingTrendingPlacement[];
  togglePlacement: (id: BuyingTrendingPlacement) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <motion.div
      key="up"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <motion.form
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-slate-200 bg-white p-8 shadow-2xl"
      >
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-black text-primary-blue">上传买量视频</h2>
            <button type="button" disabled={busy} onClick={onClose} className="rounded-full p-2 hover:bg-slate-100">
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            确认上传后将先生成封面与低码率预览，再基于预览进行 AI 打标（与批量回填一致，可减轻大文件请求体积）。
          </p>
        </div>

        <div className="space-y-4">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
            视频文件
            <input
              type="file"
              accept="video/*"
              className="mt-1 w-full text-sm"
              disabled={busy}
              onChange={(ev) => {
                const f = ev.target.files?.[0] ?? null;
                if (f && !isLikelyVideoFile(f)) {
                  alert('请选择视频文件');
                  onVideoChange(null);
                  return;
                }
                onVideoChange(f);
              }}
            />
          </label>

          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
            命名
            <input
              required
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={formTitle}
              disabled={busy}
              onChange={(e) => setFormTitle(e.target.value)}
            />
          </label>

          <div className="flex gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                checked={formSourceType === 'internal'}
                disabled={busy}
                onChange={() => setFormSourceType('internal')}
              />
              内部（显示昵称）
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                checked={formSourceType === 'external'}
                disabled={busy}
                onChange={() => setFormSourceType('external')}
              />
              外部（游戏名称）
            </label>
          </div>

          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
            {formSourceType === 'internal' ? '内部昵称' : '外部游戏名'}
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={formSourceLabel}
              disabled={busy}
              onChange={(e) => setFormSourceLabel(e.target.value)}
            />
          </label>

          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
            跑量时间
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="例：2026-05-01 ~ 2026-05-07"
              value={formRunTime}
              disabled={busy}
              onChange={(e) => setFormRunTime(e.target.value)}
            />
          </label>

          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
            跑量数据
            <textarea
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              rows={2}
              placeholder="例：消耗 12w / CTR 2.3%"
              value={formRunVolume}
              disabled={busy}
              onChange={(e) => setFormRunVolume(e.target.value)}
            />
          </label>

          {mode === 'ranking' && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">榜单类型</div>
              <select
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={formRankingSegment}
                disabled={busy}
                onChange={(e) => setFormRankingSegment(e.target.value as BuyingRankingSegment)}
              >
                {RANKING_SEGMENT_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === 'trending' && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">巨量系 / 腾讯系版位（多选）</div>
              <div className="mt-2 flex flex-col gap-2">
                {TRENDING_PLACEMENT_META.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formPlacements.includes(p.id)}
                      disabled={busy}
                      onChange={() => togglePlacement(p.id)}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
          )}

        </div>

        {progress && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            {progress}
          </div>
        )}

        <div className="mt-8 flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="flex-1 rounded-2xl border border-slate-200 py-3 font-bold text-slate-600 hover:bg-slate-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy || !videoFile}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-accent-blue py-3 font-bold text-white shadow disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            确认上传
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}

function BatchUploadModal({
  busy,
  progress,
  files,
  onFilesChange,
  rankingSegment,
  setRankingSegment,
  sourceType,
  setSourceType,
  sourceLabel,
  setSourceLabel,
  runTime,
  setRunTime,
  runVolume,
  setRunVolume,
  onSubmit,
  onClose,
}: {
  busy: boolean;
  progress: string | null;
  files: File[];
  onFilesChange: (files: File[]) => void;
  rankingSegment: BuyingRankingSegment;
  setRankingSegment: (v: BuyingRankingSegment) => void;
  sourceType: 'internal' | 'external';
  setSourceType: (v: 'internal' | 'external') => void;
  sourceLabel: string;
  setSourceLabel: (v: string) => void;
  runTime: string;
  setRunTime: (v: string) => void;
  runVolume: string;
  setRunVolume: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <motion.div
      key="batch-up"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <motion.form
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-slate-200 bg-white p-8 shadow-2xl"
      >
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black text-primary-blue">批量上传（爬榜单）</h2>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              生成封面与预览后写入 PocketBase，AI 标签由服务端 ingest 回填。标题默认取文件名。
            </p>
          </div>
          <button type="button" disabled={busy} onClick={onClose} className="rounded-full p-2 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              录入榜单（本批全部视频）
            </div>
            <div className="grid grid-cols-2 gap-2">
              {RANKING_SEGMENT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={busy}
                  onClick={() => setRankingSegment(opt.id)}
                  className={`rounded-xl border px-3 py-3 text-sm font-bold transition ${
                    rankingSegment === opt.id
                      ? 'border-accent-blue bg-accent-blue/10 text-primary-blue'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-accent-blue/40'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
            视频文件（可多选）
            <input
              type="file"
              accept="video/*"
              multiple
              className="mt-1 w-full text-sm"
              disabled={busy}
              onChange={(ev) => {
                const list = Array.from(ev.target.files ?? []).filter(isLikelyVideoFile);
                if (list.length === 0 && ev.target.files?.length) {
                  alert('请选择视频文件');
                  onFilesChange([]);
                  return;
                }
                onFilesChange(list);
              }}
            />
            {files.length > 0 && (
              <p className="mt-1 text-[11px] text-slate-500">已选 {files.length} 个文件</p>
            )}
          </label>

          <div className="flex gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                checked={sourceType === 'internal'}
                disabled={busy}
                onChange={() => setSourceType('internal')}
              />
              内部
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                checked={sourceType === 'external'}
                disabled={busy}
                onChange={() => setSourceType('external')}
              />
              外部（竞品常用）
            </label>
          </div>

          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
            {sourceType === 'internal' ? '内部昵称' : '外部游戏名'}
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={sourceLabel}
              disabled={busy}
              onChange={(e) => setSourceLabel(e.target.value)}
            />
          </label>

          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
            跑量时间（本批共用，可选）
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={runTime}
              disabled={busy}
              onChange={(e) => setRunTime(e.target.value)}
            />
          </label>

          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
            跑量数据（本批共用，可选）
            <textarea
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              rows={2}
              value={runVolume}
              disabled={busy}
              onChange={(e) => setRunVolume(e.target.value)}
            />
          </label>
        </div>

        {progress && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            {progress}
          </div>
        )}

        <div className="mt-8 flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="flex-1 rounded-2xl border border-slate-200 py-3 font-bold text-slate-600 hover:bg-slate-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy || files.length === 0}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-accent-blue py-3 font-bold text-white shadow disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Files className="h-5 w-5" />}
            开始批量录入
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}
