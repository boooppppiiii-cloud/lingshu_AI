/**
 * 买量大屏：爬榜单 / 找钩子 / 追热梗 / 素材库（投放专员）。
 *
 * PocketBase 集合名：`buying_videos`。请在 Admin 中创建并添加字段（均为普通 Text，除非注明 File）：
 * - userId (text)
 * - gameProfileId (text)
 * - dashboardMode (text): ranking | hooks | trending
 * - rankingSegment (text，爬榜单必填): internal_top（团队 TOP）| competitor_top（竞品 TOP）
 *   猫爪/脚本批量入库时请按目标榜单写入；前端批量上传会写入所选榜单。
 * - title, sourceType (internal|external), sourceLabel, runTimeText, runVolumeText
 * - bidMethodText, roiBidText, miniGameDay1RoiText, shallowBidText, ctrText,
 *   miniGameRegCostText, miniGameDay1PayCostText, day1PayArppuText（竞品 TOP 表格投放指标）
 * - runDates (text, JSON 数组)：竞品 TOP 投放日期，YYYY-MM-DD，可多选 + 手动填入
 * - placements (text, JSON 数组)：追热梗为 douyin/tencent 版位 id；竞品 TOP 为渠道版位中文名
 * - scriptTags (text, JSON 数组)：[题材标签, 主题标签×2]；可由前端或 POST /api/buying-videos/ingest 回填
 * - hookAnalysisJson (text, JSON)：7 项钩子分析字段 + fullAnalysis，存储位置与结构不变（所有模式）
 * - cover (file, jpg), preview (file, mp4)
 *
 * 自动回填：PocketBase `onRecordAfterCreateSuccess` 等可对 Node 发起 POST `/api/buying-videos/ingest`，body `{ "recordId": "<id>" }`，
 * Header `X-Ingest-Secret` 与 `BUYING_VIDEO_INGEST_SECRET` 一致；需 `POCKETBASE_ADMIN_*` 以便服务端下载 preview 并 PATCH。
 * 若 scriptTags 已非空（例如浏览器已分析），ingest 会跳过。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BarChart3,
  Clapperboard,
  Flame,
  LayoutGrid,
  LayoutList,
  Layers,
  Library,
  Loader2,
  Play,
  Plus,
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
import { buyingVideosListFilter } from '../lib/buyingVideosListFilter';
import { buildThemeTagCatalogFromItems } from '../lib/buyingThemeTagCatalog';
import { BuyingHooksRankView } from './BuyingHooksRankView';
import {
  BUYING_VIDEOS_COLLECTION,
  fetchBuyingVideosList,
} from '../lib/buyingVideosList';
import {
  readBuyingVideosListCache,
  writeBuyingVideosCache,
} from '../lib/buyingVideosListCache';
import { isLikelyVideoFile } from '../lib/isLikelyVideoFile';
import { buildCoverHashMap, dedupeBuyingVideosByCoverHash } from '../lib/buyingVideoCoverDedupe';
import {
  buyingPlacementLabel,
  mergeChannelPlacements,
  type BuyingChannelPlacement,
} from '../lib/buyingPlacements';
import { mergeRunDatesList } from '../lib/buyingRunDates';
import { compactScriptLine } from '../lib/buyingScriptTags';
import type { IterationVideoPayload } from '../lib/iterationHandoff';
import { fetchUrlAsIterationVideo, readBlobAsBase64Body } from '../lib/readBlobAsBase64';
import {
  rankingSegmentLabel,
  RANKING_SEGMENT_OPTIONS,
  readStoredRankingSegment,
  storeRankingSegment,
  titleFromVideoFileName,
} from '../lib/buyingRankingSegment';
import { triggerBuyingVideoIngest } from '../lib/buyingVideoIngest';
import { BUYING_HOOK_DISPLAY_FIELDS, buyingHookFieldText } from '../lib/buyingHookAnalysisDisplay';
import { BUYING_FIRST3S_HOOK_TYPES, isBuyingFirst3sHookType } from '../lib/buyingHookTypes';
import { geminiService } from '../services/gemini';
import BuyingVideoEmotionCurve from './BuyingVideoEmotionCurve';
import { buyingPageMetaLabel } from './BuyingPageAssistantBot';
import { useRegisterBuyingPageAssistant } from '../lib/PageAssistantContext';
import CompetitorTopTable from './CompetitorTopTable';
import type {
  BuyingDashboardMode,
  BuyingHookAnalysis,
  BuyingRankingSegment,
  BuyingTrendingPlacement,
  BuyingVideoItem,
} from '../types';

const COLLECTION = BUYING_VIDEOS_COLLECTION;

const TRENDING_PLACEMENT_META: {
  id: BuyingTrendingPlacement;
  label: string;
  aspect: '9/16' | '16/9';
}[] = [
  { id: 'douyin_portrait_916', label: '抖音竖版 9:16', aspect: '9/16' },
  { id: 'tencent_landscape_169', label: '腾讯横版 16:9', aspect: '16/9' },
  { id: 'tencent_portrait_916', label: '腾讯竖版 9:16', aspect: '9/16' },
];

function sourceBadge(item: BuyingVideoItem) {
  if (item.sourceType === 'internal') {
    return { text: `内部 · ${item.sourceLabel || '未填昵称'}`, cls: 'bg-emerald-500/15 text-emerald-800' };
  }
  return { text: `外部 · ${item.sourceLabel || '未填游戏名'}`, cls: 'bg-amber-500/15 text-amber-900' };
}

function formatUploadTime(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function authorLabel(item: BuyingVideoItem): string {
  if (item.sourceLabel.trim()) return item.sourceLabel.trim();
  return item.sourceType === 'internal' ? '内部' : '外部';
}

function HookAnalysisPanel({ ha, compact }: { ha: BuyingHookAnalysis | null; compact?: boolean }) {
  if (!ha) return <p className="text-[11px] text-slate-400">暂无开场分析</p>;
  const hasNew =
    BUYING_HOOK_DISPLAY_FIELDS.some((r) => {
      const text = buyingHookFieldText(ha, r.key, r.isHookType);
      return text !== '—';
    }) || ha.conflictOpening;
  if (!hasNew && ha.firstFiveSecondsSummary) {
    return (
      <div className="rounded-lg border border-slate-100 bg-slate-50/90 p-2.5 text-[11px] leading-snug text-slate-600">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">前 5 秒（旧版）</div>
        <p className="mt-0.5 line-clamp-3">{ha.firstFiveSecondsSummary}</p>
      </div>
    );
  }
  return (
    <div className={`space-y-2 rounded-lg border border-slate-100 bg-slate-50/90 ${compact ? 'p-2' : 'p-2.5'} text-[11px] leading-snug text-slate-600`}>
      {BUYING_HOOK_DISPLAY_FIELDS.map((row) => (
        <div key={row.key}>
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{row.label}</div>
          <p
            className={`mt-0.5 ${compact ? 'line-clamp-1' : 'line-clamp-3'} ${
              row.isHookType ? 'font-semibold text-primary-blue' : ''
            }`}
          >
            {buyingHookFieldText(ha, row.key, row.isHookType)}
          </p>
          {row.isHookType && ha.first3sHookType === '其他' && !ha.first3sHookTypeOther?.trim() ? (
            <p className="mt-0.5 text-[10px] text-amber-700">需在详情中人工补全「其他」说明</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function HookTypeManualEditor({
  item,
  onSaved,
  showToast,
}: {
  item: BuyingVideoItem;
  onSaved: (next: BuyingHookAnalysis) => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
}) {
  const ha = item.hookAnalysis;
  const [hookType, setHookType] = useState(ha?.first3sHookType ?? '其他');
  const [otherNote, setOtherNote] = useState(ha?.first3sHookTypeOther ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const type = isBuyingFirst3sHookType(hookType) ? hookType : '其他';
    const merged: BuyingHookAnalysis = {
      ...(ha ?? {}),
      first3sHookType: type,
      first3sHookTypeOther: type === '其他' ? otherNote.trim() : '',
    };
    setSaving(true);
    try {
      await pb.collection(COLLECTION).update(item.id, {
        hookAnalysisJson: JSON.stringify(merged),
      });
      onSaved(merged);
      showToast('钩子类型已保存', 'success');
    } catch (e) {
      console.error(e);
      showToast('保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-amber-200/80 bg-amber-50/60 p-3">
      <p className="text-[10px] font-bold text-amber-900">人工补全 / 修正钩子类型（选「其他」须填写说明）</p>
      <select
        value={hookType}
        onChange={(e) => setHookType(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-800"
      >
        {BUYING_FIRST3S_HOOK_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {hookType === '其他' ? (
        <input
          type="text"
          value={otherNote}
          onChange={(e) => setOtherNote(e.target.value)}
          placeholder="请填写具体钩子类型说明"
          maxLength={48}
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800"
        />
      ) : null}
      <button
        type="button"
        disabled={saving || (hookType === '其他' && !otherNote.trim())}
        onClick={() => void save()}
        className="w-full rounded-lg bg-primary-blue px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
      >
        {saving ? '保存中…' : '保存钩子类型'}
      </button>
    </div>
  );
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
  const isPlacementSpecialist = user?.role === 'placement';

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
  const [listRefreshing, setListRefreshing] = useState(false);
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
  const [coversMerged, setCoversMerged] = useState(false);
  const [coverHashById, setCoverHashById] = useState<Record<string, string>>({});
  const [coverHashBusy, setCoverHashBusy] = useState(false);
  const coverHashAbortRef = useRef<AbortController | null>(null);
  /** 切换榜单/找钩子等 filter 时递增，丢弃过期的列表请求结果 */
  const listFilterGenerationRef = useRef(0);

  const [batchUploadOpen, setBatchUploadOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState<string | null>(null);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchRankingSegment, setBatchRankingSegment] = useState<BuyingRankingSegment>('competitor_top');
  const [batchSourceType, setBatchSourceType] = useState<'internal' | 'external'>('external');
  const [batchSourceLabel, setBatchSourceLabel] = useState('');
  const [batchRunTime, setBatchRunTime] = useState('');
  const [batchRunVolume, setBatchRunVolume] = useState('');
  const [competitorRankingView, setCompetitorRankingView] = useState<'grid' | 'table'>('grid');
  const [assistantScopeItems, setAssistantScopeItems] = useState<BuyingVideoItem[] | null>(null);
  useEffect(() => {
    if (!isPlacementSpecialist && mode === 'material_library') {
      setMode('ranking');
    }
    if (isPlacementSpecialist && (mode === 'hooks' || mode === 'trending')) {
      setMode('ranking');
    }
  }, [isPlacementSpecialist, mode]);

  const dashboardModeTabs = useMemo(
    () =>
      isPlacementSpecialist
        ? [
            { id: 'ranking' as const, label: '爬榜单', icon: <TrendingUp className="h-4 w-4" /> },
            { id: 'material_library' as const, label: '素材库', icon: <Library className="h-4 w-4" /> },
          ]
        : [
            { id: 'ranking' as const, label: '爬榜单', icon: <TrendingUp className="h-4 w-4" /> },
            { id: 'hooks' as const, label: '找钩子', icon: <Clapperboard className="h-4 w-4" /> },
            { id: 'trending' as const, label: '追热梗', icon: <Flame className="h-4 w-4" /> },
          ],
    [isPlacementSpecialist],
  );

  const listFilter = useMemo(
    () => buyingVideosListFilter(gameProfileId, mode, rankingSegment),
    [gameProfileId, mode, rankingSegment],
  );

  /** 切换模式/榜单时同步缓存；无缓存则清空，避免短暂展示上一 Tab 的错数据 */
  useLayoutEffect(() => {
    listFilterGenerationRef.current += 1;
    const cached = readBuyingVideosListCache(gameProfileId, mode, rankingSegment);
    if (cached) {
      setItems(cached);
      setRawLoading(false);
    } else {
      setItems([]);
      setRawLoading(true);
    }
  }, [listFilter, gameProfileId, mode, rankingSegment]);

  const load = useCallback(
    async (options?: { background?: boolean }) => {
      const filter = listFilter;
      const loadGeneration = listFilterGenerationRef.current;
      const isStale = () => loadGeneration !== listFilterGenerationRef.current;

      const cached = readBuyingVideosListCache(gameProfileId, mode, rankingSegment);
      const background = options?.background === true;

      if (!background) {
        if (cached) {
          setItems(cached);
          setRawLoading(false);
        } else {
          setItems([]);
          setRawLoading(true);
        }
      }

      setListRefreshing(true);
      try {
        if (!background && !cached?.length) {
          try {
            const firstPage = await fetchBuyingVideosList(
              { filter, mode, trendingPlacement },
              { firstPageOnly: true },
            );
            if (isStale()) return;
            if (firstPage.length > 0) {
              setItems(firstPage);
              setRawLoading(false);
            }
          } catch (firstErr) {
            if (firstErr instanceof ClientResponseError && firstErr.isAbort) return;
            console.warn('[buying] first page load failed, falling back to full list', firstErr);
          }
        }

        const full = await fetchBuyingVideosList({ filter, mode, trendingPlacement });
        if (isStale()) return;
        writeBuyingVideosCache(filter, full);
        setItems(full);
      } catch (e) {
        if (e instanceof ClientResponseError && e.isAbort) return;
        if (isStale()) return;
        console.error(e);
        if (!cached?.length) {
          setItems([]);
          showToast('加载买量视频失败：请确认 PocketBase 已创建 buying_videos 集合及字段', 'error');
        }
      } finally {
        if (!isStale()) {
          setRawLoading(false);
          setListRefreshing(false);
        }
      }
    },
    [listFilter, mode, trendingPlacement, showToast, gameProfileId, rankingSegment],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /** PocketBase 记录变更后刷新列表（ingest / backfill PATCH 后表格无需手动刷新） */
  useEffect(() => {
    let unsubscribed = false;
    const filter = listFilter;

    pb.collection(COLLECTION)
      .subscribe(
        '*',
        () => {
          if (!unsubscribed) void load({ background: true });
        },
        { filter },
      )
      .catch((e) => console.warn('buying_videos subscribe failed', e));

    return () => {
      unsubscribed = true;
      pb.collection(COLLECTION).unsubscribe('*').catch(() => {});
    };
  }, [listFilter, load]);

  useEffect(() => {
    coverHashAbortRef.current?.abort();
    setCoversMerged(false);
    setCoverHashById({});
    setCoverHashBusy(false);
  }, [mode, rankingSegment, trendingPlacement, gameProfileId]);

  const { displayItems, hiddenDuplicateCount } = useMemo(() => {
    if (!coversMerged) {
      return { displayItems: items, hiddenDuplicateCount: 0 };
    }
    const { items: deduped, hiddenCount } = dedupeBuyingVideosByCoverHash(
      items,
      coverHashById,
    );
    return { displayItems: deduped, hiddenDuplicateCount: hiddenCount };
  }, [items, coversMerged, coverHashById]);

  const handlePlacementsSave = useCallback(
    async (item: BuyingVideoItem, channels: BuyingChannelPlacement[]) => {
      const next = mergeChannelPlacements(item.placements, channels);
      try {
        await pb.collection(COLLECTION).update(item.id, {
          placements: JSON.stringify(next),
        });
        setItems((prev) =>
          prev.map((row) => (row.id === item.id ? { ...row, placements: next } : row)),
        );
        showToast('版位已保存', 'success');
      } catch (e) {
        console.error(e);
        showToast('保存版位失败', 'error');
        throw e;
      }
    },
    [showToast],
  );

  const handleRunDatesSave = useCallback(
    async (item: BuyingVideoItem, dates: string[]) => {
      const next = mergeRunDatesList(dates);
      try {
        await pb.collection(COLLECTION).update(item.id, {
          runDates: JSON.stringify(next),
        });
        setItems((prev) =>
          prev.map((row) => (row.id === item.id ? { ...row, runDates: next } : row)),
        );
        showToast('日期已保存', 'success');
      } catch (e) {
        console.error(e);
        showToast('保存日期失败', 'error');
        throw e;
      }
    },
    [showToast],
  );

  const handleBatchRunDatesSave = useCallback(
    async (ids: string[], dates: string[]) => {
      const next = mergeRunDatesList(dates);
      if (!ids.length) return;
      try {
        await Promise.all(
          ids.map((id) =>
            pb.collection(COLLECTION).update(id, { runDates: JSON.stringify(next) }),
          ),
        );
        const idSet = new Set(ids);
        setItems((prev) =>
          prev.map((row) => (idSet.has(row.id) ? { ...row, runDates: next } : row)),
        );
        showToast(`已为 ${ids.length} 条视频设置日期`, 'success');
      } catch (e) {
        console.error(e);
        showToast('批量保存日期失败', 'error');
        throw e;
      }
    },
    [showToast],
  );

  const mergeDuplicateCovers = useCallback(async () => {
    if (coversMerged) {
      coverHashAbortRef.current?.abort();
      setCoversMerged(false);
      return;
    }
    const targets = items;
    if (!targets.some((i) => i.coverUrl.trim())) {
      showToast('当前列表没有可比对的封面', 'error');
      return;
    }
    coverHashAbortRef.current?.abort();
    const ac = new AbortController();
    coverHashAbortRef.current = ac;
    setCoverHashBusy(true);
    try {
      const map = await buildCoverHashMap(targets, { signal: ac.signal });
      if (ac.signal.aborted) return;
      setCoverHashById(map);
      setCoversMerged(true);
      const { hiddenCount } = dedupeBuyingVideosByCoverHash(targets, map);
      showToast(
        hiddenCount > 0 ? `已合并相同封面，隐藏 ${hiddenCount} 条` : '未发现相同封面',
        hiddenCount > 0 ? 'success' : 'info',
      );
    } catch (e) {
      if (!ac.signal.aborted) {
        console.error(e);
        showToast('封面比对失败，请稍后重试', 'error');
      }
    } finally {
      if (!ac.signal.aborted) setCoverHashBusy(false);
    }
  }, [coversMerged, items, showToast]);

  const openUpload = () => {
    if (!user) {
      alert('请先登录后再上传视频');
      return;
    }
    setFormRankingSegment(
      mode === 'ranking' || mode === 'material_library' ? 'competitor_top' : 'internal_top',
    );
    setFormPlacements([trendingPlacement]);
    setUploadOpen(true);
  };

  const openBatchUpload = () => {
    if (!user) {
      alert('请先登录后再批量上传');
      return;
    }
    setBatchRankingSegment(mode === 'material_library' ? 'competitor_top' : rankingSegment);
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

        const { generateBuyingVideoMediaArtifacts } = await import('../lib/videoCompressFfmpeg');
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
        fd.append('runDates', JSON.stringify([]));
        fd.append('scriptTags', JSON.stringify([]));
        fd.append('hookAnalysisJson', JSON.stringify({}));
        fd.append('cover', posterJpeg, 'cover.jpg');
        fd.append('preview', previewMp4, 'preview.mp4');

        try {
          const record = await pb.collection(COLLECTION).create(fd);
          setBatchProgress(`AI 分析 ${i + 1}/${batchFiles.length}：${title}`);
          const ingest = await triggerBuyingVideoIngest(record.id);
          if (!ingest.ok) {
            console.warn('ingest failed', record.id, ingest.error);
          }
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
    if (!user) {
      showToast('请先登录后再上传', 'error');
      return;
    }
    if (!videoFile || !formTitle.trim()) return;
    if (mode === 'trending' && formPlacements.length === 0) {
      showToast('追热梗模式请至少选择一个版位', 'error');
      return;
    }

    setUploadBusy(true);
    setUploadProgress('生成封面与预览…');
    try {
      const { generateBuyingVideoMediaArtifacts } = await import('../lib/videoCompressFfmpeg');
      const { posterJpeg, previewMp4 } = await generateBuyingVideoMediaArtifacts(videoFile, ({ overall, phase }) => {
        const label = phase === 'load' ? '加载 FFmpeg' : phase === 'poster' ? '生成封面 JPG' : '生成低码率预览';
        setUploadProgress(`${label} ${Math.round(overall * 100)}%`);
      });

      let scriptTags: [string, string, string] = ['剧情', '待分析', '待分析'];
      let hookPayload: Record<string, string> = {};
      let deferIngest = false;

      try {
        setUploadProgress('AI 分析视频中…');
        const base64 = await readBlobAsBase64Body(previewMp4);
        const existingThemeTags = buildThemeTagCatalogFromItems(items);
        const ai = await geminiService.analyzeBuyingVideo(
          base64,
          'video/mp4',
          previewFileNameForAi(videoFile.name),
          true,
          { analyticsUserId: user.uid, gameProfileId, existingThemeTags },
        );
        if (Array.isArray(ai.scriptTags) && ai.scriptTags.length >= 3) {
          scriptTags = ai.scriptTags;
        }
        hookPayload = (ai.hookAnalysis ?? {}) as Record<string, string>;
      } catch (aiErr) {
        console.warn('analyzeBuyingVideo failed, will ingest after create', aiErr);
        deferIngest = true;
        const msg = aiErr instanceof Error ? aiErr.message : String(aiErr);
        const busy = /503|繁忙|high demand|UNAVAILABLE|限流/i.test(msg);
        showToast(
          busy
            ? 'Gemini 繁忙，视频先入库，标签将在后台自动补全（约 1 分钟内）'
            : `AI 分析未完成，视频先入库：${msg.slice(0, 80)}`,
          'error',
        );
      }

      const sourceLabelFinal =
        formSourceType === 'external'
          ? (formSourceLabel.trim() || scriptTags[2] || scriptTags[1] || '外部')
          : (formSourceLabel.trim() || user.displayName || '内部');

      const fd = new FormData();
      fd.append('userId', user.uid);
      fd.append('gameProfileId', gameProfileId);
      fd.append('dashboardMode', mode === 'material_library' ? 'ranking' : mode);
      fd.append(
        'rankingSegment',
        mode === 'ranking' || mode === 'material_library' ? formRankingSegment : '',
      );
      fd.append('title', formTitle.trim());
      fd.append('sourceType', formSourceType);
      fd.append('sourceLabel', sourceLabelFinal);
      fd.append('runTimeText', formRunTime.trim());
      fd.append('runVolumeText', formRunVolume.trim());
      fd.append('placements', JSON.stringify(mode === 'trending' ? formPlacements : []));
      fd.append('runDates', JSON.stringify([]));
      fd.append('scriptTags', JSON.stringify(scriptTags));
      fd.append('hookAnalysisJson', JSON.stringify(hookPayload));

      fd.append('cover', posterJpeg, 'cover.jpg');
      fd.append('preview', previewMp4, 'preview.mp4');

      const record = await pb.collection(COLLECTION).create(fd);
      if (deferIngest) {
        setUploadProgress('后台补全 AI 标签…');
        const ingest = await triggerBuyingVideoIngest(record.id);
        if (!ingest.ok) {
          console.warn('post-upload ingest failed', ingest.error);
        }
      }
      showToast(deferIngest ? '上传成功，标签补全中' : '上传成功');
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

  useEffect(() => {
    const tableScopeActive =
      mode === 'material_library' ||
      (mode === 'ranking' && rankingSegment === 'competitor_top' && competitorRankingView === 'table');
    if (!tableScopeActive) {
      setAssistantScopeItems(null);
    }
  }, [mode, rankingSegment, competitorRankingView]);

  const assistantItems = assistantScopeItems ?? displayItems;
  const assistantPageMeta = useMemo(
    () =>
      buyingPageMetaLabel(
        mode,
        mode === 'ranking' ? rankingSegment : '',
        gameProfileId,
        assistantScopeItems
          ? mode === 'material_library'
            ? '素材库表格当前筛选结果'
            : '竞品TOP表格当前筛选结果'
          : mode === 'hooks'
            ? '竞品TOP全部素材（含开场分析）'
            : coversMerged
              ? '当前列表（已合并相同封面）'
              : '当前列表全部素材',
      ),
    [mode, rankingSegment, gameProfileId, assistantScopeItems, coversMerged],
  );

  useRegisterBuyingPageAssistant(assistantItems, assistantPageMeta, !rawLoading);

  return (
    <div className="relative w-full">
      <header className="mb-8 flex flex-col gap-6">
        <div>
          <h1 className="text-4xl font-black text-primary-blue mb-2 flex items-center gap-3">
            <BarChart3 className="h-10 w-10 text-accent-blue" />
            买量大屏
          </h1>
          <p className="text-slate-500 max-w-2xl text-sm leading-relaxed">
            上传后先在本地生成低码率预览，再由 AI 根据前 5 秒写入题材/主题标签与开场分析（首帧、运镜、音画、情绪）。封面与预览由 FFmpeg 在本地生成。
          </p>
          {listRefreshing && items.length > 0 ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent-blue">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              正在同步最新数据…
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={() => void mergeDuplicateCovers()}
            disabled={coverHashBusy || items.length === 0}
            className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
              coversMerged
                ? 'border-accent-blue bg-accent-blue/10 text-primary-blue'
                : 'border-slate-200 bg-white text-slate-700 hover:border-accent-blue/40 hover:bg-slate-50'
            }`}
          >
            {coverHashBusy ? (
              <Loader2 className="h-4 w-4 animate-spin text-accent-blue" />
            ) : (
              <Layers className="h-4 w-4" />
            )}
            {coverHashBusy ? '正在比对封面…' : coversMerged ? '显示全部封面' : '合并相同封面'}
          </button>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {(mode === 'ranking' || mode === 'material_library') && (
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
        {dashboardModeTabs.map((tab) => (
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

      {mode === 'material_library' ? (
        <p className="mb-6 text-xs text-slate-500">
          竞品 TOP 素材表格视图；视频名称右侧展示从命名解析的竞品名称、上传日期、序号、版位（格式：竞品-YYYYMMDD-序号-版位）。上传将录入竞品 TOP。
        </p>
      ) : null}

      {mode === 'hooks' ? (
        <p className="mb-6 text-xs text-slate-500">
          自动汇总爬榜单 · 竞品 TOP 中已录入素材的 AI 开场分析（画面、台词、钩子类型等）；在此上传的专项素材也会出现在列表中。
        </p>
      ) : null}

      {mode === 'ranking' && (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
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
              批量上传时可选择录入竞品 TOP 或团队 TOP；竞品 TOP 支持表格视图查看投放指标
            </p>
          </div>
          {rankingSegment === 'competitor_top' ? (
            <div
              className="flex shrink-0 items-end self-end sm:self-auto"
              role="tablist"
              aria-label="竞品 TOP 视图"
            >
              <button
                type="button"
                role="tab"
                aria-selected={competitorRankingView === 'grid'}
                onClick={() => setCompetitorRankingView('grid')}
                className={`relative -mb-px inline-flex items-center gap-1.5 rounded-t-xl border px-4 py-2.5 text-sm font-bold transition ${
                  competitorRankingView === 'grid'
                    ? 'z-10 border-slate-200 border-b-white bg-white text-primary-blue shadow-[0_-1px_0_rgba(0,0,0,0.04)]'
                    : 'border-transparent bg-slate-100/80 text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`}
              >
                <LayoutGrid className="h-4 w-4" />
                卡片
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={competitorRankingView === 'table'}
                onClick={() => setCompetitorRankingView('table')}
                className={`relative -mb-px inline-flex items-center gap-1.5 rounded-t-xl border px-4 py-2.5 text-sm font-bold transition ${
                  competitorRankingView === 'table'
                    ? 'z-10 border-slate-200 border-b-white bg-white text-primary-blue shadow-[0_-1px_0_rgba(0,0,0,0.04)]'
                    : 'border-transparent bg-slate-100/80 text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`}
              >
                <LayoutList className="h-4 w-4" />
                表格
              </button>
            </div>
          ) : null}
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
      ) : displayItems.length === 0 ? (
        <div className="glass-card border-dashed py-16 text-center text-slate-500">
          <LayoutGrid className="mx-auto mb-3 h-10 w-10 opacity-25" />
          <p className="font-bold">暂无可展示视频</p>
          <p className="mt-1 text-sm">正在比对封面，请稍候；或点击「显示全部封面」恢复列表。</p>
        </div>
      ) : (
        <>
          {coversMerged && hiddenDuplicateCount > 0 ? (
            <p className="mb-4 text-center text-xs text-slate-500">
              已隐藏 {hiddenDuplicateCount} 条相同封面素材（同封面仅保留一条）
            </p>
          ) : null}
          {mode === 'material_library' ? (
            <CompetitorTopTable
              variant="material_library"
              showNamingColumns={isPlacementSpecialist}
              items={displayItems}
              onOpenPreview={setPreviewItem}
              onSaveRunDates={handleRunDatesSave}
              onBatchSaveRunDates={handleBatchRunDatesSave}
              onSavePlacements={handlePlacementsSave}
              onScopeItemsChange={setAssistantScopeItems}
            />
          ) : mode === 'ranking' ? (
            rankingSegment === 'competitor_top' && competitorRankingView === 'table' ? (
              <CompetitorTopTable
                showNamingColumns={isPlacementSpecialist}
                items={displayItems}
                onOpenPreview={setPreviewItem}
                onSaveRunDates={handleRunDatesSave}
                onBatchSaveRunDates={handleBatchRunDatesSave}
                onSavePlacements={handlePlacementsSave}
                onScopeItemsChange={setAssistantScopeItems}
              />
            ) : (
              <RankingGrid items={displayItems} onOpenPreview={setPreviewItem} />
            )
          ) : mode === 'hooks' ? (
            <BuyingHooksRankView
              items={displayItems}
              showNamingColumns={isPlacementSpecialist}
              onOpenPreview={setPreviewItem}
              onSaveRunDates={handleRunDatesSave}
              onBatchSaveRunDates={handleBatchRunDatesSave}
              onSavePlacements={handlePlacementsSave}
            />
          ) : (
            <TrendingGrid items={displayItems} aspect={trendingAspect} onOpenPreview={setPreviewItem} />
          )}
        </>
      )}

      <AnimatePresence>
        {previewItem && (
          <PreviewOverlay
            item={previewItem}
            dashboardMode={mode}
            onClose={() => setPreviewItem(null)}
            canAccessWorkshop={canAccessWorkshop}
            isLoggedIn={Boolean(user)}
            onRequestLogin={onRequestLogin}
            onSendToIteration={onSendToIteration}
            showToast={showToast}
            onHookAnalysisSaved={(id, ha) => {
              setItems((prev) =>
                prev.map((row) => (row.id === id ? { ...row, hookAnalysis: ha } : row)),
              );
              setPreviewItem((prev) => (prev?.id === id ? { ...prev, hookAnalysis: ha } : prev));
            }}
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
        <HookAnalysisPanel ha={ha} compact />
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
          <div>版位：{item.placements.map(buyingPlacementLabel).join('、')}</div>
          <div>跑量时间：{item.runTimeText || '—'}</div>
          <div className="line-clamp-2">跑量数据：{item.runVolumeText || '—'}</div>
        </div>
      </div>
    </button>
  );
}

function PreviewOverlay({
  item,
  dashboardMode,
  onClose,
  canAccessWorkshop,
  isLoggedIn,
  onRequestLogin,
  onSendToIteration,
  showToast,
  onHookAnalysisSaved,
}: {
  item: BuyingVideoItem;
  dashboardMode: BuyingDashboardMode;
  onClose: () => void;
  canAccessWorkshop: boolean;
  isLoggedIn: boolean;
  onRequestLogin: () => void;
  onSendToIteration: (video: IterationVideoPayload) => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
  onHookAnalysisSaved: (id: string, ha: BuyingHookAnalysis) => void;
}) {
  const [preparingIteration, setPreparingIteration] = useState(false);
  const [hookHa, setHookHa] = useState(item.hookAnalysis);

  useEffect(() => {
    setHookHa(item.hookAnalysis);
  }, [item.id, item.hookAnalysis]);

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

  const badge = sourceBadge(item);
  const fullAnalysis = hookHa?.fullAnalysis ?? item.hookAnalysis?.fullAnalysis;
  const previewItem = { ...item, hookAnalysis: hookHa };
  const showHookTypeEditor = isLoggedIn;

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
        className="relative flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl lg:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black lg:min-w-[55%]">
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
        <div className="flex max-h-[50vh] w-full flex-col gap-4 overflow-y-auto border-t border-slate-200 p-6 lg:max-h-none lg:w-[400px] lg:shrink-0 lg:border-l lg:border-t-0">
          <h2 className="text-xl font-black leading-snug text-primary-blue">{item.title || '未命名视频'}</h2>

          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] text-slate-600">
            <div>
              <span className="font-bold text-slate-400">上传时间</span>
              <p className="mt-0.5 font-medium text-slate-800">{formatUploadTime(item.created)}</p>
            </div>
            <div>
              <span className="font-bold text-slate-400">作者</span>
              <p className="mt-0.5 font-medium text-slate-800">{authorLabel(item)}</p>
            </div>
            <div className="col-span-2">
              <span className="font-bold text-slate-400">上传来源</span>
              <p className="mt-0.5">
                <span className={`inline-block rounded-lg px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                  {badge.text}
                </span>
              </p>
            </div>
            <div>
              <span className="font-bold text-slate-400">跑量时间</span>
              <p className="mt-0.5 font-medium text-slate-800">{item.runTimeText || '—'}</p>
            </div>
            <div>
              <span className="font-bold text-slate-400">跑量数据</span>
              <p className="mt-0.5 line-clamp-2 font-medium text-slate-800">{item.runVolumeText || '—'}</p>
            </div>
            {dashboardMode === 'trending' && item.placements.length > 0 ? (
              <div className="col-span-2">
                <span className="font-bold text-slate-400">版位</span>
                <p className="mt-0.5 font-medium text-slate-800">
                  {item.placements.map(buyingPlacementLabel).join('、')}
                </p>
              </div>
            ) : null}
          </div>

          <section>
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">脚本标签</h3>
            {item.scriptTags.length ? (
              <p className="mt-2 text-sm font-medium leading-snug text-slate-800">{compactScriptLine(item.scriptTags)}</p>
            ) : (
              <p className="mt-2 text-sm text-slate-400">暂无</p>
            )}
          </section>

          <section>
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">开场分析</h3>
            <div className="mt-2">
              <HookAnalysisPanel ha={hookHa} />
            </div>
            {showHookTypeEditor ? (
              <HookTypeManualEditor
                item={previewItem}
                showToast={showToast}
                onSaved={(ha) => {
                  setHookHa(ha);
                  onHookAnalysisSaved(item.id, ha);
                }}
              />
            ) : null}
          </section>

          <section>
            <BuyingVideoEmotionCurve data={fullAnalysis} />
          </section>

          <div className="mt-auto border-t border-slate-100 pt-4">{iterationButton}</div>
        </div>
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

          {(mode === 'ranking' || mode === 'material_library') && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">榜单类型</div>
              <select
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={formRankingSegment}
                disabled={busy || mode === 'material_library'}
                onChange={(e) => setFormRankingSegment(e.target.value as BuyingRankingSegment)}
              >
                {RANKING_SEGMENT_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              {mode === 'material_library' ? (
                <p className="mt-1 text-[11px] text-slate-500">素材库固定录入竞品 TOP</p>
              ) : null}
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
