import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, ChevronDown, ChevronUp, ChevronsUpDown, Loader2, Play, Search, X } from 'lucide-react';
import {
  BUYING_HOOK_DISPLAY_FIELDS,
  buyingHookFieldText,
} from '../lib/buyingHookAnalysisDisplay';
import {
  COMPETITOR_TABLE_CHECKBOX_CLASS,
  competitorTableMinWidth,
  getCompetitorTableColumns,
  getCompetitorTableHideableColumns,
  isCompetitorColumnVisible,
  loadHiddenCompetitorColumns,
  parseMetricColumnId,
  type CompetitorMetricColumnId,
  type CompetitorTableColumnDef,
  type CompetitorTableColumnId,
} from '../lib/competitorTableColumns';
import { parseBuyingTitleNaming } from '../lib/buyingTitleNaming';
import { mergeRunDatesList } from '../lib/buyingRunDates';
import {
  BUYING_AD_PLATFORM_FILTER_OPTIONS,
  itemMatchesAdPlatformFilter,
  type BuyingAdPlatformFilter,
} from '../lib/buyingAdPlatform';
import {
  BUYING_GENRE_TAG_FILTER_OPTIONS,
  itemMatchesGenreTagFilter,
  type BuyingGenreTag,
  type BuyingGenreTagFilter,
} from '../lib/buyingGenreTag';
import { rankItemsByRelevance } from '../lib/competitorTableRelevanceSearch';
import {
  itemMatchesCompetitorTitleFilter,
  type CompetitorTitleFilter,
} from '../lib/competitorTitleFilter';
import {
  BUYING_CHANNEL_PLACEMENT_OPTIONS,
  channelPlacementsFromList,
  type BuyingChannelPlacement,
} from '../lib/buyingPlacements';
import { compactScriptLine } from '../lib/buyingScriptTags';
import type { BuyingVideoAdMetrics, BuyingVideoItem } from '../types';
import BuyingPlacementMultiSelect from './BuyingPlacementMultiSelect';
import BuyingRunDatesEditor from './BuyingRunDatesEditor';
import BuyingRunDatesPickerPanel from './BuyingRunDatesPickerPanel';
import CompetitorTableColumnCustomizer from './CompetitorTableColumnCustomizer';

const PAGE_SIZE = 30;
const SELECT_COL_WIDTH = 44;

function formatSimilarityPercent(sim: number | undefined): string {
  if (sim === undefined || Number.isNaN(sim)) return '—';
  return `${Math.round(sim * 100)}%`;
}
const RUN_DATE_FILTER_UNSET = '__unset__';

type SortDir = 'asc' | 'desc';
type PlacementFilter = 'all' | 'unset' | BuyingChannelPlacement;
type HeaderPlacementFilterTag = BuyingChannelPlacement | 'unset';
type CompetitorTopTableVariant = 'default' | 'material_library';

function itemMatchesPlacementFilter(item: BuyingVideoItem, filter: PlacementFilter): boolean {
  const channels = channelPlacementsFromList(item.placements);
  if (filter === 'all') return true;
  if (filter === 'unset') return channels.length === 0;
  return channels.includes(filter);
}

function itemMatchesHeaderRunDatesFilter(item: BuyingVideoItem, selected: Set<string>): boolean {
  if (selected.size === 0) return true;
  const wantUnset = selected.has(RUN_DATE_FILTER_UNSET);
  const dateTags = new Set([...selected].filter((x) => x !== RUN_DATE_FILTER_UNSET));
  if (item.runDates.length === 0) return wantUnset;
  if (dateTags.size === 0) return false;
  return item.runDates.some((d) => dateTags.has(d));
}

function itemMatchesHeaderPlacementFilter(
  item: BuyingVideoItem,
  selected: Set<HeaderPlacementFilterTag>,
): boolean {
  if (selected.size === 0) return true;
  const channels = channelPlacementsFromList(item.placements);
  if (selected.has('unset') && channels.length === 0) return true;
  return channels.some((c) => selected.has(c));
}

function collectAvailableRunDateTags(items: BuyingVideoItem[]): { id: string; label: string }[] {
  const seen = new Set<string>();
  let hasUnset = false;
  for (const item of items) {
    if (item.runDates.length === 0) hasUnset = true;
    for (const d of item.runDates) seen.add(d);
  }
  const out: { id: string; label: string }[] = [];
  if (hasUnset) out.push({ id: RUN_DATE_FILTER_UNSET, label: '未设置' });
  for (const d of [...seen].sort((a, b) => b.localeCompare(a, 'zh-CN'))) {
    out.push({ id: d, label: d });
  }
  return out;
}

function filterTagClass(active: boolean): string {
  return `rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
    active
      ? 'border-accent-blue bg-accent-blue/10 text-primary-blue'
      : 'border-slate-200 bg-white text-slate-600 hover:border-accent-blue/40'
  }`;
}

function ColumnHeaderTagFilter({
  label,
  minWidth,
  active,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  minWidth: number;
  active: boolean;
  options: { id: string; label: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <th className="relative px-3 py-3" style={{ minWidth }} onClick={(e) => e.stopPropagation()}>
      <div ref={rootRef} className="relative inline-block max-w-full">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex max-w-full items-center gap-0.5 rounded-md text-left text-[10px] font-black uppercase tracking-wide transition ${
            active ? 'text-primary-blue' : 'text-slate-500 hover:text-primary-blue'
          }`}
          title={active ? '已筛选，点击调整' : '点击按标签筛选'}
        >
          <span className="truncate">{label}</span>
          {active ? (
            <span className="rounded bg-accent-blue/15 px-1 text-[9px] font-bold normal-case text-primary-blue">
              {selected.size}
            </span>
          ) : null}
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {open ? (
          <div className="absolute left-0 top-full z-30 mt-1 min-w-[168px] max-w-[min(280px,70vw)] rounded-xl border border-slate-200 bg-white p-2.5 shadow-lg">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}筛选</span>
              {active ? (
                <button
                  type="button"
                  onClick={() => {
                    onClear();
                    setOpen(false);
                  }}
                  className="text-[10px] font-bold text-primary-blue hover:underline"
                >
                  全部
                </button>
              ) : null}
            </div>
            {options.length === 0 ? (
              <p className="text-[11px] text-slate-500">暂无可筛选项</p>
            ) : (
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {options.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onToggle(opt.id)}
                    className={filterTagClass(selected.has(opt.id))}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </th>
  );
}

function AdPlatformFilterBar({
  value,
  onChange,
}: {
  value: BuyingAdPlatformFilter;
  onChange: (next: BuyingAdPlatformFilter) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/40 px-4 py-2.5">
      <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-slate-500">投放平台</span>
      {BUYING_AD_PLATFORM_FILTER_OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={filterTagClass(value === opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function CompetitorTitleFilterBar({
  value,
  otherKeyword,
  onChange,
  onOtherKeywordChange,
}: {
  value: CompetitorTitleFilter;
  otherKeyword: string;
  onChange: (next: CompetitorTitleFilter) => void;
  onOtherKeywordChange: (next: string) => void;
}) {
  const pick = (next: CompetitorTitleFilter) => {
    onChange(value === next && next !== 'all' ? 'all' : next);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-white px-4 py-2.5">
      <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-slate-500">竞品筛选</span>
      <button type="button" onClick={() => onChange('all')} className={filterTagClass(value === 'all')}>
        全部
      </button>
      <button
        type="button"
        onClick={() => pick('my_garden_world')}
        className={filterTagClass(value === 'my_garden_world')}
      >
        我的花园世界
      </button>
      <button
        type="button"
        onClick={() => pick('dream_forest')}
        className={filterTagClass(value === 'dream_forest')}
      >
        织梦森林
      </button>
      <button type="button" onClick={() => pick('other')} className={filterTagClass(value === 'other')}>
        其他
      </button>
      {value === 'other' ? (
        <input
          type="text"
          value={otherKeyword}
          onChange={(e) => onOtherKeywordChange(e.target.value)}
          placeholder="填写视频名称关键词"
          className="min-w-[140px] rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] outline-none transition focus:border-accent-blue/40 focus:ring-2 focus:ring-accent-blue/10"
        />
      ) : null}
    </div>
  );
}

function PlacementFilterBar({
  value,
  onChange,
}: {
  value: PlacementFilter;
  onChange: (next: PlacementFilter) => void;
}) {
  const pick = (next: PlacementFilter) => {
    onChange(value === next && next !== 'all' ? 'all' : next);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-white px-4 py-2.5">
      <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-slate-500">版位筛选</span>
      <button type="button" onClick={() => onChange('all')} className={filterTagClass(value === 'all')}>
        全部
      </button>
      <button type="button" onClick={() => pick('unset')} className={filterTagClass(value === 'unset')}>
        未设置
      </button>
      {BUYING_CHANNEL_PLACEMENT_OPTIONS.map((opt) => (
        <button key={opt} type="button" onClick={() => pick(opt)} className={filterTagClass(value === opt)}>
          {opt}
        </button>
      ))}
    </div>
  );
}

function ScriptGenreFilterBar({
  value,
  onChange,
}: {
  value: BuyingGenreTagFilter;
  onChange: (next: BuyingGenreTagFilter) => void;
}) {
  const pick = (next: BuyingGenreTag) => {
    onChange(value === next ? 'all' : next);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/30 px-4 py-2.5">
      <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-slate-500">脚本标签</span>
      <button type="button" onClick={() => onChange('all')} className={filterTagClass(value === 'all')}>
        全部
      </button>
      {BUYING_GENRE_TAG_FILTER_OPTIONS.filter((o) => o.id !== 'all').map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => pick(opt.id as BuyingGenreTag)}
          className={filterTagClass(value === opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function RelevanceSearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const active = value.trim().length > 0;

  return (
    <div className="border-b border-slate-100 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-slate-500">相关度检索</span>
        <div className="relative min-w-[200px] flex-1 max-w-xl">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="输入关键词句，在上方筛选结果内检索"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-8 text-[11px] outline-none transition focus:border-accent-blue/40 focus:ring-2 focus:ring-accent-blue/10"
          />
          {active ? (
            <button
              type="button"
              onClick={() => onChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="清空检索"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function parseMetricSortValue(raw: string): number | null {
  const s = raw.trim();
  if (!s || s === '—') return null;
  const normalized = s.replace(/[,，%\s¥￥$]/g, '');
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function compareMetricValues(a: number | null, b: number | null, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === 'asc' ? a - b : b - a;
}

function sortByMetric(
  items: BuyingVideoItem[],
  key: CompetitorMetricColumnId,
  dir: SortDir,
): BuyingVideoItem[] {
  return [...items].sort((a, b) => {
    const av = parseMetricSortValue(a.adMetrics[key]);
    const bv = parseMetricSortValue(b.adMetrics[key]);
    const cmp = compareMetricValues(av, bv, dir);
    if (cmp !== 0) return cmp;
    return a.created.localeCompare(b.created);
  });
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

function sourceBadgeText(item: BuyingVideoItem): string {
  if (item.sourceType === 'internal') {
    return `内部 · ${item.sourceLabel || '未填昵称'}`;
  }
  return `外部 · ${item.sourceLabel || '未填游戏名'}`;
}

function metricCell(value: string): string {
  return value.trim() || '—';
}

function TextCell({ text, maxWidth }: { text: string; maxWidth?: string }) {
  return (
    <td className={`px-3 py-2 align-top text-[11px] leading-snug text-slate-700 ${maxWidth ?? 'max-w-[200px]'}`}>
      <p className="line-clamp-4 break-words" title={text === '—' ? undefined : text}>
        {text}
      </p>
    </td>
  );
}

function SortableMetricHeader({
  label,
  sortKey,
  activeKey,
  sortDir,
  minWidth,
  relevanceLocked,
  onSort,
}: {
  label: string;
  sortKey: CompetitorMetricColumnId;
  activeKey: CompetitorMetricColumnId | null;
  sortDir: SortDir;
  minWidth: number;
  relevanceLocked: boolean;
  onSort: (key: CompetitorMetricColumnId) => void;
}) {
  const active = !relevanceLocked && activeKey === sortKey;
  return (
    <th className="px-3 py-3" style={{ minWidth }}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        disabled={relevanceLocked}
        className={`inline-flex max-w-full items-center gap-0.5 rounded-md text-left text-[10px] font-black uppercase tracking-wide transition ${
          relevanceLocked
            ? 'cursor-not-allowed text-slate-300'
            : active
              ? 'text-primary-blue hover:text-primary-blue'
              : 'text-slate-500 hover:text-primary-blue'
        }`}
        title={
          relevanceLocked
            ? '相关度检索进行中，清空检索后可按指标排序'
            : active
              ? sortDir === 'desc'
                ? '当前：从高到低，点击切换为从低到高'
                : '当前：从低到高，点击切换为从高到低'
              : '点击排序'
        }
      >
        <span className="truncate">{label}</span>
        {active ? (
          sortDir === 'desc' ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-35" aria-hidden />
        )}
      </button>
    </th>
  );
}

/** 表格预览列：默认封面（lazy），悬停再挂载并播放 preview.mp4，避免首屏并发拉取大量视频 */
function CompetitorTablePreviewThumb({ item }: { item: BuyingVideoItem }) {
  const [hovered, setHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const coverUrl = item.coverUrl.trim();
  const previewUrl = item.previewUrl.trim();
  const hasCover = coverUrl.length > 0;
  const hasPreview = previewUrl.length > 0;

  useEffect(() => {
    if (!hovered || !hasPreview) return;
    const v = videoRef.current;
    if (!v) return;
    void v.play().catch(() => {});
  }, [hovered, hasPreview]);

  if (!hasCover && !hasPreview) {
    return (
      <div className="relative aspect-video w-[104px] overflow-hidden rounded-lg bg-slate-900">
        <div className="flex h-full min-h-[58px] items-center justify-center text-[10px] text-slate-500">
          无预览
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative aspect-video w-[104px] overflow-hidden rounded-lg bg-slate-900"
      onMouseEnter={() => {
        if (hasPreview) setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      {hasCover ? (
        <img
          src={coverUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className={`h-full w-full object-cover transition-opacity ${
            hovered && hasPreview ? 'opacity-0' : 'opacity-100'
          }`}
        />
      ) : (
        <div
          className={`flex h-full min-h-[58px] w-full items-center justify-center text-[10px] text-slate-500 ${
            hovered && hasPreview ? 'opacity-0' : ''
          }`}
        >
          悬停预览
        </div>
      )}
      {hovered && hasPreview ? (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          src={previewUrl}
          muted
          playsInline
          preload="auto"
        />
      ) : null}
      <div
        className={`pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25 transition ${
          hovered && hasPreview ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <Play className="h-6 w-6 text-white drop-shadow" />
      </div>
    </div>
  );
}

type CompetitorTopTableProps = {
  items: BuyingVideoItem[];
  variant?: CompetitorTopTableVariant;
  /** 投放专员：视频名称右侧展示从命名解析的竞品/日期/序号/版位 */
  showNamingColumns?: boolean;
  /** minimal：找钩子簇展开内嵌，隐藏表头筛选条 */
  toolbarMode?: 'full' | 'minimal';
  /** 找钩子聚类：展示该维度余弦相似度（0–1） */
  similarityByItemId?: Record<string, number>;
  onOpenPreview: (item: BuyingVideoItem) => void;
  onSaveRunDates: (item: BuyingVideoItem, dates: string[]) => Promise<void>;
  onBatchSaveRunDates: (ids: string[], dates: string[]) => Promise<void>;
  onSavePlacements: (item: BuyingVideoItem, channels: BuyingChannelPlacement[]) => Promise<void>;
  /** 表格筛选后的列表，供左下助手作为问答上下文 */
  onScopeItemsChange?: (scoped: BuyingVideoItem[]) => void;
};

const SIMILARITY_COL_WIDTH = 88;

export default function CompetitorTopTable({
  items,
  variant = 'default',
  showNamingColumns = false,
  toolbarMode = 'full',
  similarityByItemId,
  onOpenPreview,
  onSaveRunDates,
  onBatchSaveRunDates,
  onSavePlacements,
  onScopeItemsChange,
}: CompetitorTopTableProps) {
  const isMaterialLibrary = variant === 'material_library';
  const isMinimalToolbar = toolbarMode === 'minimal';
  const showSimilarityColumn = Boolean(similarityByItemId && Object.keys(similarityByItemId).length > 0);
  const showSelection = !isMinimalToolbar;
  const [visibleCount, setVisibleCount] = useState(() =>
    toolbarMode === 'minimal' ? Math.max(PAGE_SIZE, 9999) : PAGE_SIZE,
  );
  const [sortKey, setSortKey] = useState<CompetitorMetricColumnId | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [batchPanelOpen, setBatchPanelOpen] = useState(false);
  const [batchDraft, setBatchDraft] = useState<string[]>([]);
  const [batchSaving, setBatchSaving] = useState(false);
  const [hiddenColumnIds, setHiddenColumnIds] = useState<Set<CompetitorTableColumnId>>(() =>
    loadHiddenCompetitorColumns(showNamingColumns),
  );
  const [platformFilter, setPlatformFilter] = useState<BuyingAdPlatformFilter>('all');
  const [competitorTitleFilter, setCompetitorTitleFilter] = useState<CompetitorTitleFilter>('all');
  const [competitorOtherKeyword, setCompetitorOtherKeyword] = useState('');
  const [placementFilter, setPlacementFilter] = useState<PlacementFilter>('all');
  const [headerRunDateFilter, setHeaderRunDateFilter] = useState<Set<string>>(() => new Set());
  const [headerPlacementFilter, setHeaderPlacementFilter] = useState<Set<HeaderPlacementFilterTag>>(
    () => new Set(),
  );
  const [genreTagFilter, setGenreTagFilter] = useState<BuyingGenreTagFilter>('all');
  const [relevanceQuery, setRelevanceQuery] = useState('');
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const syncingScroll = useRef(false);

  const tableColumns = useMemo(
    () => getCompetitorTableColumns(showNamingColumns),
    [showNamingColumns],
  );
  const visibleColumns = useMemo(
    () => tableColumns.filter((c) => isCompetitorColumnVisible(c.id, hiddenColumnIds)),
    [tableColumns, hiddenColumnIds],
  );
  const previewVisible = isCompetitorColumnVisible('preview', hiddenColumnIds);
  const selectColWidth = showSelection ? SELECT_COL_WIDTH : 0;
  const tableMinWidth =
    competitorTableMinWidth(hiddenColumnIds, selectColWidth, showNamingColumns) +
    (showSimilarityColumn ? SIMILARITY_COL_WIDTH : 0);

  const relevanceQueryTrimmed = relevanceQuery.trim();
  const relevanceActive = relevanceQueryTrimmed.length > 0;

  const availableRunDateTags = useMemo(
    () => (isMaterialLibrary ? collectAvailableRunDateTags(items) : []),
    [isMaterialLibrary, items],
  );
  const placementHeaderOptions = useMemo(() => {
    if (!isMaterialLibrary) return [];
    const opts: { id: string; label: string }[] = [{ id: 'unset', label: '未设置' }];
    for (const p of BUYING_CHANNEL_PLACEMENT_OPTIONS) {
      opts.push({ id: p, label: p });
    }
    return opts;
  }, [isMaterialLibrary]);

  const toggleHeaderRunDate = useCallback((id: string) => {
    setHeaderRunDateFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleHeaderPlacement = useCallback((id: string) => {
    setHeaderPlacementFilter((prev) => {
      const next = new Set(prev);
      const tag = id as HeaderPlacementFilterTag;
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [
    items,
    sortKey,
    sortDir,
    hiddenColumnIds,
    platformFilter,
    competitorTitleFilter,
    competitorOtherKeyword,
    placementFilter,
    headerRunDateFilter,
    headerPlacementFilter,
    genreTagFilter,
    relevanceQueryTrimmed,
    isMaterialLibrary,
  ]);

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (!itemMatchesAdPlatformFilter(item, platformFilter)) return false;
        if (!itemMatchesGenreTagFilter(item, genreTagFilter)) return false;
        if (isMaterialLibrary) {
          return (
            itemMatchesHeaderRunDatesFilter(item, headerRunDateFilter) &&
            itemMatchesHeaderPlacementFilter(item, headerPlacementFilter)
          );
        }
        return (
          itemMatchesCompetitorTitleFilter(item, competitorTitleFilter, competitorOtherKeyword) &&
          itemMatchesPlacementFilter(item, placementFilter)
        );
      }),
    [
      items,
      platformFilter,
      competitorTitleFilter,
      competitorOtherKeyword,
      placementFilter,
      genreTagFilter,
      isMaterialLibrary,
      headerRunDateFilter,
      headerPlacementFilter,
    ],
  );
  const platformFilterActive = platformFilter !== 'all';
  const competitorFilterActive =
    competitorTitleFilter !== 'all' &&
    (competitorTitleFilter !== 'other' || competitorOtherKeyword.trim().length > 0);
  const placementFilterActive = placementFilter !== 'all';
  const headerRunDateFilterActive = headerRunDateFilter.size > 0;
  const headerPlacementFilterActive = headerPlacementFilter.size > 0;
  const genreTagFilterActive = genreTagFilter !== 'all';
  const relevanceRankedItems = useMemo(() => {
    if (!relevanceActive) return filteredItems;
    return rankItemsByRelevance(filteredItems, relevanceQueryTrimmed);
  }, [filteredItems, relevanceActive, relevanceQueryTrimmed]);

  const displayPoolCount = relevanceActive ? relevanceRankedItems.length : filteredItems.length;
  const scopeItemsForAssistant = useMemo(
    () => (relevanceActive ? relevanceRankedItems : filteredItems),
    [relevanceActive, relevanceRankedItems, filteredItems],
  );

  useEffect(() => {
    onScopeItemsChange?.(scopeItemsForAssistant);
  }, [onScopeItemsChange, scopeItemsForAssistant]);

  const tableFilterActive =
    platformFilterActive ||
    (!isMaterialLibrary && competitorFilterActive) ||
    (!isMaterialLibrary && placementFilterActive) ||
    (isMaterialLibrary && headerRunDateFilterActive) ||
    (isMaterialLibrary && headerPlacementFilterActive) ||
    genreTagFilterActive ||
    relevanceActive;

  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set(items.map((i) => i.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  useEffect(() => {
    if (isMinimalToolbar) {
      setVisibleCount(Math.max(items.length, PAGE_SIZE));
    } else {
      setVisibleCount(PAGE_SIZE);
    }
  }, [items.length, isMinimalToolbar]);

  const handleMetricSort = useCallback((key: CompetitorMetricColumnId) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
      return;
    }
    setSortKey(key);
    setSortDir('desc');
  }, [sortKey]);

  const sortedItems = useMemo(() => {
    if (showSimilarityColumn && similarityByItemId) {
      return [...filteredItems].sort(
        (a, b) => (similarityByItemId[b.id] ?? 0) - (similarityByItemId[a.id] ?? 0),
      );
    }
    if (relevanceActive) return relevanceRankedItems;
    if (!sortKey) return filteredItems;
    return sortByMetric(filteredItems, sortKey, sortDir);
  }, [relevanceActive, relevanceRankedItems, filteredItems, sortKey, sortDir, showSimilarityColumn, similarityByItemId]);

  const visibleItems = useMemo(() => sortedItems.slice(0, visibleCount), [sortedItems, visibleCount]);
  const hasMore = visibleCount < sortedItems.length;
  const remaining = sortedItems.length - visibleCount;
  const selectedCount = selectedIds.size;

  const visibleIdList = useMemo(() => visibleItems.map((i) => i.id), [visibleItems]);
  const allVisibleSelected =
    visibleIdList.length > 0 && visibleIdList.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIdList.some((id) => selectedIds.has(id));

  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIdList) next.delete(id);
      } else {
        for (const id of visibleIdList) next.add(id);
      }
      return next;
    });
  }, [allVisibleSelected, visibleIdList]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setBatchPanelOpen(false);
  }, []);

  const openBatchPanel = useCallback(() => {
    const selectedItems = items.filter((i) => selectedIds.has(i.id));
    const union = mergeRunDatesList(selectedItems.flatMap((i) => i.runDates));
    setBatchDraft(union);
    setBatchPanelOpen(true);
  }, [items, selectedIds]);

  const applyBatchDates = useCallback(async () => {
    const ids = [...selectedIds];
    if (!ids.length || batchSaving) return;
    setBatchSaving(true);
    try {
      await onBatchSaveRunDates(ids, batchDraft);
      setBatchPanelOpen(false);
      setSelectedIds(new Set());
    } finally {
      setBatchSaving(false);
    }
  }, [selectedIds, batchDraft, batchSaving, onBatchSaveRunDates]);

  const syncScroll = useCallback((source: 'main' | 'top') => {
    const main = mainScrollRef.current;
    const top = topScrollRef.current;
    if (!main || !top || syncingScroll.current) return;
    syncingScroll.current = true;
    if (source === 'main') {
      top.scrollLeft = main.scrollLeft;
    } else {
      main.scrollLeft = top.scrollLeft;
    }
    requestAnimationFrame(() => {
      syncingScroll.current = false;
    });
  }, []);

  const loadMore = () => {
    setVisibleCount((n) => Math.min(n + PAGE_SIZE, sortedItems.length));
  };

  const renderHeaderCell = (col: CompetitorTableColumnDef) => {
    if (isMaterialLibrary && col.id === 'dates') {
      return (
        <ColumnHeaderTagFilter
          key={col.id}
          label={col.label}
          minWidth={col.minWidth}
          active={headerRunDateFilterActive}
          options={availableRunDateTags}
          selected={headerRunDateFilter}
          onToggle={toggleHeaderRunDate}
          onClear={() => setHeaderRunDateFilter(new Set())}
        />
      );
    }
    if (isMaterialLibrary && col.id === 'placements') {
      return (
        <ColumnHeaderTagFilter
          key={col.id}
          label={col.label}
          minWidth={col.minWidth}
          active={headerPlacementFilterActive}
          options={placementHeaderOptions}
          selected={headerPlacementFilter}
          onToggle={toggleHeaderPlacement}
          onClear={() => setHeaderPlacementFilter(new Set())}
        />
      );
    }
    const metricKey = parseMetricColumnId(col.id);
    if (metricKey) {
      return (
        <SortableMetricHeader
          key={col.id}
          label={col.label}
          sortKey={metricKey}
          activeKey={sortKey}
          sortDir={sortDir}
          minWidth={col.minWidth}
          relevanceLocked={relevanceActive}
          onSort={handleMetricSort}
        />
      );
    }
    return (
      <th key={col.id} className="px-3 py-3 text-[10px] font-black uppercase tracking-wide text-slate-500" style={{ minWidth: col.minWidth }}>
        {col.label}
      </th>
    );
  };

  const renderBodyCell = (
    item: BuyingVideoItem,
    col: CompetitorTableColumnDef,
    ctx: {
      ha: BuyingVideoItem['hookAnalysis'];
      m: BuyingVideoAdMetrics;
      sourceCls: string;
      isSelected: boolean;
    },
  ) => {
    const { ha, m, sourceCls, isSelected } = ctx;
    const stickyBg = isSelected ? 'bg-accent-blue/[0.08]' : 'bg-white';

    if (col.id === 'preview') {
      return (
        <td
          key={col.id}
          className={`sticky z-10 px-3 py-2 ${stickyBg} group-hover:bg-accent-blue/[0.04]`}
          style={{ left: selectColWidth }}
        >
          <CompetitorTablePreviewThumb item={item} />
        </td>
      );
    }

    if (col.id === 'title') {
      return (
        <td key={col.id} className="max-w-[180px] px-3 py-2 align-top text-xs font-bold leading-snug text-slate-800">
          <p className="line-clamp-3 break-words" title={item.title}>
            {item.title || '—'}
          </p>
        </td>
      );
    }

    if (
      col.id === 'titleCompetitor' ||
      col.id === 'titleUploadDate' ||
      col.id === 'titleSequence' ||
      col.id === 'titlePlacement'
    ) {
      const naming = parseBuyingTitleNaming(item.title);
      const text =
        col.id === 'titleCompetitor'
          ? naming.competitorName
          : col.id === 'titleUploadDate'
            ? naming.uploadDate
            : col.id === 'titleSequence'
              ? naming.sequence
              : naming.placement;
      return (
        <TextCell
          key={col.id}
          text={text}
          maxWidth={
            col.id === 'titleSequence'
              ? 'max-w-[64px]'
              : col.id === 'titleUploadDate'
                ? 'max-w-[96px]'
                : 'max-w-[120px]'
          }
        />
      );
    }

    if (col.id === 'dates') {
      return (
        <td key={col.id} className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}>
          <BuyingRunDatesEditor runDates={item.runDates} onSave={(dates) => onSaveRunDates(item, dates)} />
        </td>
      );
    }

    if (col.id === 'source') {
      return (
        <td key={col.id} className="px-3 py-2 align-top">
          <span
            className={`inline-block max-w-[140px] rounded-lg px-2 py-0.5 text-[10px] font-bold leading-snug ${sourceCls}`}
          >
            {sourceBadgeText(item)}
          </span>
        </td>
      );
    }

    if (col.id === 'placements') {
      return (
        <td key={col.id} className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}>
          <BuyingPlacementMultiSelect
            placements={item.placements}
            onSave={(channels) => onSavePlacements(item, channels)}
          />
        </td>
      );
    }

    if (col.id === 'uploadTime') {
      return (
        <td key={col.id} className="whitespace-nowrap px-3 py-2 align-top text-[11px] text-slate-600">
          {formatUploadTime(item.created)}
        </td>
      );
    }

    if (col.id === 'scriptTags') {
      return (
        <TextCell key={col.id} text={compactScriptLine(item.scriptTags) || '—'} maxWidth="max-w-[160px]" />
      );
    }

    if (col.id.startsWith('hook:')) {
      const hookKey = col.id.slice(5) as keyof NonNullable<typeof ha>;
      const hookField = BUYING_HOOK_DISPLAY_FIELDS.find((f) => f.key === hookKey);
      return (
        <TextCell
          key={col.id}
          text={buyingHookFieldText(ha, hookKey, hookField?.isHookType)}
          maxWidth={hookField?.isHookType ? 'max-w-[120px]' : 'max-w-[200px]'}
        />
      );
    }

    if (col.id === 'bidMethod') {
      return <TextCell key={col.id} text={metricCell(m.bidMethod)} maxWidth="max-w-[100px]" />;
    }

    const metricKey = parseMetricColumnId(col.id);
    if (metricKey) {
      return <TextCell key={col.id} text={metricCell(m[metricKey])} maxWidth="max-w-[100px]" />;
    }

    return null;
  };

  return (
    <div className={`${isMinimalToolbar ? '' : 'rounded-2xl border border-slate-200'} bg-white shadow-sm`}>
      {!isMinimalToolbar ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-2">
            {tableFilterActive ? (
              <p className="text-[10px] text-slate-500">
                已筛选，匹配 <span className="font-bold text-slate-700">{displayPoolCount}</span> / {items.length}{' '}
                条
              </p>
            ) : (
              <span />
            )}
            <CompetitorTableColumnCustomizer
              hiddenIds={hiddenColumnIds}
              hideableColumns={getCompetitorTableHideableColumns(showNamingColumns)}
              onHiddenChange={setHiddenColumnIds}
            />
          </div>

          <AdPlatformFilterBar value={platformFilter} onChange={setPlatformFilter} />
          {!isMaterialLibrary ? (
            <>
              <CompetitorTitleFilterBar
                value={competitorTitleFilter}
                otherKeyword={competitorOtherKeyword}
                onChange={setCompetitorTitleFilter}
                onOtherKeywordChange={setCompetitorOtherKeyword}
              />
              <PlacementFilterBar value={placementFilter} onChange={setPlacementFilter} />
            </>
          ) : null}
          <ScriptGenreFilterBar value={genreTagFilter} onChange={setGenreTagFilter} />
          <RelevanceSearchBar value={relevanceQuery} onChange={setRelevanceQuery} />
        </>
      ) : null}

      {selectedCount > 0 ? (
        <div className="border-b border-accent-blue/20 bg-accent-blue/[0.06] px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-primary-blue">已选 {selectedCount} 条视频</span>
            <button
              type="button"
              onClick={() => (batchPanelOpen ? setBatchPanelOpen(false) : openBatchPanel())}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent-blue px-3 py-1.5 text-[11px] font-bold text-white shadow-sm hover:brightness-110"
            >
              <CalendarRange className="h-3.5 w-3.5" />
              {batchPanelOpen ? '收起批量日期' : '批量编辑日期'}
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" />
              取消选择
            </button>
          </div>
          {batchPanelOpen ? (
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <BuyingRunDatesPickerPanel
                draft={batchDraft}
                onDraftChange={setBatchDraft}
                hint={`批量设置日期：将统一写入已选的 ${selectedCount} 条视频`}
              />
              <div className="flex flex-wrap gap-2 border-t border-slate-100 px-3 py-2">
                <button
                  type="button"
                  disabled={batchSaving}
                  onClick={() => void applyBatchDates()}
                  className="rounded-lg bg-accent-blue px-4 py-1.5 text-[11px] font-bold text-white hover:brightness-110 disabled:opacity-50"
                >
                  {batchSaving ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      保存中…
                    </span>
                  ) : (
                    `应用到 ${selectedCount} 条视频`
                  )}
                </button>
                <button
                  type="button"
                  disabled={batchSaving}
                  onClick={() => setBatchDraft([])}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                >
                  清空日期
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        ref={topScrollRef}
        onScroll={() => syncScroll('top')}
        className="buying-table-scroll-sticky buying-table-scroll-track overflow-x-scroll overflow-y-hidden border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur-sm"
        aria-label="表格横向滚动"
      >
        <div style={{ width: tableMinWidth, height: 14 }} />
      </div>

      <div
        ref={mainScrollRef}
        onScroll={() => syncScroll('main')}
        className="buying-table-scroll-main overflow-x-scroll rounded-b-2xl"
      >
        <table className="w-full border-collapse text-left" style={{ minWidth: tableMinWidth }}>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/90">
              {showSelection ? (
                <th
                  className="sticky left-0 z-20 bg-slate-50/95 px-2 py-3"
                  style={{ width: SELECT_COL_WIDTH, minWidth: SELECT_COL_WIDTH }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    className={COMPETITOR_TABLE_CHECKBOX_CLASS}
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                    }}
                    onChange={toggleAllVisible}
                    title={allVisibleSelected ? '取消全选当前页' : '全选当前页'}
                    aria-label="全选当前页"
                  />
                </th>
              ) : null}
              {previewVisible ? (
                <th
                  className="sticky z-20 bg-slate-50/95 px-3 py-3 text-[10px] font-black uppercase tracking-wide text-slate-500"
                  style={{ left: selectColWidth, minWidth: 120 }}
                >
                  压缩视频
                </th>
              ) : null}
              {showSimilarityColumn ? (
                <th
                  className="sticky z-20 bg-slate-50/95 px-3 py-3 text-[10px] font-black uppercase tracking-wide text-slate-500"
                  style={{
                    left: selectColWidth + (previewVisible ? 120 : 0),
                    minWidth: SIMILARITY_COL_WIDTH,
                  }}
                >
                  相似度
                </th>
              ) : null}
              {visibleColumns
                .filter((c) => c.id !== 'preview')
                .map((col) => renderHeaderCell(col))}
            </tr>
          </thead>
          <tbody>
            {visibleItems.length === 0 ? (
              <tr>
                <td
                  colSpan={Math.max(
                    1,
                    visibleColumns.length + (showSelection ? 1 : 0) + (showSimilarityColumn ? 1 : 0),
                  )}
                  className="px-4 py-16 text-center text-sm text-slate-500"
                >
                  {relevanceActive ? (
                    <>
                      <p className="font-bold text-slate-600">当前筛选范围内无相关匹配</p>
                      <p className="mt-1 text-xs">
                        {isMaterialLibrary
                          ? '可调整关键词，或放宽上方平台 / 脚本标签筛选，或表头日期 / 版位筛选'
                          : '可调整关键词，或放宽上方平台 / 版位 / 题材筛选'}
                      </p>
                    </>
                  ) : (
                    <p className="font-bold text-slate-600">暂无数据</p>
                  )}
                </td>
              </tr>
            ) : null}
            {visibleItems.map((item) => {
              const ha = item.hookAnalysis;
              const m = item.adMetrics;
              const isSelected = selectedIds.has(item.id);
              const sourceCls =
                item.sourceType === 'internal'
                  ? 'bg-emerald-500/15 text-emerald-800'
                  : 'bg-amber-500/15 text-amber-900';
              const rowBg = isSelected ? 'bg-accent-blue/[0.08]' : '';

              return (
                <tr
                  key={item.id}
                  className={`group cursor-pointer border-b border-slate-100 transition hover:bg-accent-blue/[0.04] ${rowBg}`}
                  onClick={() => onOpenPreview(item)}
                >
                  {showSelection ? (
                    <td
                      className={`sticky left-0 z-10 px-2 py-2 ${rowBg || 'bg-white'} group-hover:bg-accent-blue/[0.04]`}
                      style={{ width: SELECT_COL_WIDTH }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className={COMPETITOR_TABLE_CHECKBOX_CLASS}
                        checked={isSelected}
                        onChange={() => toggleRow(item.id)}
                        aria-label={`选择 ${item.title || '视频'}`}
                      />
                    </td>
                  ) : null}
                  {visibleColumns
                    .filter((c) => c.id === 'preview')
                    .map((col) => renderBodyCell(item, col, { ha, m, sourceCls, isSelected }))}
                  {showSimilarityColumn && similarityByItemId ? (
                    <td
                      className={`sticky z-10 whitespace-nowrap px-3 py-2 align-top text-xs font-bold text-primary-blue ${rowBg || 'bg-white'} group-hover:bg-accent-blue/[0.04]`}
                      style={{
                        left: selectColWidth + (previewVisible ? 120 : 0),
                        minWidth: SIMILARITY_COL_WIDTH,
                      }}
                    >
                      {formatSimilarityPercent(similarityByItemId[item.id])}
                    </td>
                  ) : null}
                  {visibleColumns
                    .filter((c) => c.id !== 'preview')
                    .map((col) => renderBodyCell(item, col, { ha, m, sourceCls, isSelected }))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
        <p className="text-xs text-slate-500">
          已显示 <span className="font-bold text-slate-700">{visibleItems.length}</span> /{' '}
          {tableFilterActive ? (
            <>
              {relevanceActive ? '检索命中' : '筛选后'}{' '}
              <span className="font-bold text-slate-700">{displayPoolCount}</span> 条（共{' '}
              <span className="font-bold text-slate-700">{items.length}</span> 条）
            </>
          ) : (
            <>
              共 <span className="font-bold text-slate-700">{items.length}</span> 条
            </>
          )}
          {selectedCount > 0 ? (
            <span className="text-primary-blue"> · 已选 {selectedCount} 条</span>
          ) : null}
          {hiddenColumnIds.size > 0 ? (
            <span className="text-slate-400"> · 已隐藏 {hiddenColumnIds.size} 列</span>
          ) : null}
          {items.length > PAGE_SIZE ? (
            <span className="text-slate-400">（默认每页 {PAGE_SIZE} 条，可手动加载更多）</span>
          ) : null}
        </p>
        {hasMore ? (
          <button
            type="button"
            onClick={loadMore}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-primary-blue shadow-sm transition hover:border-accent-blue/40 hover:bg-white"
          >
            <ChevronDown className="h-4 w-4" />
            加载更多
            {remaining > PAGE_SIZE ? `（+${PAGE_SIZE}）` : `（+${remaining}）`}
          </button>
        ) : items.length > PAGE_SIZE ? (
          <span className="text-xs font-medium text-emerald-700">已全部加载</span>
        ) : null}
      </div>
    </div>
  );
}
