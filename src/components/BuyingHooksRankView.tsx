import { useMemo, useState } from 'react';
import { BarChart2, ChevronDown, ChevronUp } from 'lucide-react';
import {
  BUYING_HOOK_RANK_DIMENSIONS,
  buildHookDimensionRankings,
  type BuyingHookRankDimension,
  type HookDimensionClusterRow,
} from '../lib/buyingHookPatternStats';
import type { BuyingVideoItem } from '../types';
import CompetitorTopTable from './CompetitorTopTable';
import type { BuyingChannelPlacement } from '../lib/buyingPlacements';

type Props = {
  items: BuyingVideoItem[];
  showNamingColumns?: boolean;
  onOpenPreview: (item: BuyingVideoItem) => void;
  onSaveRunDates: (item: BuyingVideoItem, dates: string[]) => Promise<void>;
  onBatchSaveRunDates: (ids: string[], dates: string[]) => Promise<void>;
  onSavePlacements: (item: BuyingVideoItem, channels: BuyingChannelPlacement[]) => Promise<void>;
};

export function BuyingHooksRankView({
  items,
  showNamingColumns = false,
  onOpenPreview,
  onSaveRunDates,
  onBatchSaveRunDates,
  onSavePlacements,
}: Props) {
  const [dimension, setDimension] = useState<BuyingHookRankDimension>('theme_tag');
  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);

  const ranking = useMemo(() => buildHookDimensionRankings(items, dimension), [items, dimension]);

  const activeMeta = BUYING_HOOK_RANK_DIMENSIONS.find((d) => d.id === dimension)!;

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const toggleCluster = (clusterId: string) => {
    setExpandedClusterId((prev) => (prev === clusterId ? null : clusterId));
  };

  const onDimensionChange = (id: BuyingHookRankDimension) => {
    setDimension(id);
    setExpandedClusterId(null);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <BarChart2 className="mt-0.5 h-5 w-5 shrink-0 text-accent-blue" aria-hidden />
          <div>
            <h2 className="text-sm font-black text-slate-800">开场套路统计排行</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
              优先展示含 ≥2 条素材的共性套路簇；单条会先尝试并入相近簇，仍未归并的收入「零散」桶。
              <span className="text-slate-400"> {activeMeta.hint}</span>
            </p>
          </div>
        </div>
        <p className="shrink-0 text-right text-[11px] font-medium text-slate-500">
          共性簇{' '}
          <span className="font-bold text-primary-blue">{ranking.patternClusterCount}</span> 个 · 本维度已分析{' '}
          <span className="font-bold text-slate-700">{ranking.analyzableCount}</span> /{' '}
          {ranking.totalInScope} 条
          {ranking.skippedCount > 0 ? (
            <span className="text-slate-400">（{ranking.skippedCount} 条未分析完，未参与）</span>
          ) : null}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-4 py-2">
        {BUYING_HOOK_RANK_DIMENSIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onDimensionChange(tab.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              dimension === tab.id
                ? 'bg-accent-blue text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {ranking.entries.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-slate-500">
          当前维度暂无可聚类数据。请确认竞品 TOP 素材已完成 AI 开场/卖点分析。
        </p>
      ) : (
        <ol className="divide-y divide-slate-100">
          {ranking.entries.map((entry) => (
            <ClusterRankRow
              key={entry.clusterId}
              entry={entry}
              expanded={expandedClusterId === entry.clusterId}
              itemsById={itemsById}
              showNamingColumns={showNamingColumns}
              onToggle={() => toggleCluster(entry.clusterId)}
              onOpenPreview={onOpenPreview}
              onSaveRunDates={onSaveRunDates}
              onBatchSaveRunDates={onBatchSaveRunDates}
              onSavePlacements={onSavePlacements}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function ClusterRankRow({
  entry,
  expanded,
  itemsById,
  showNamingColumns,
  onToggle,
  onOpenPreview,
  onSaveRunDates,
  onBatchSaveRunDates,
  onSavePlacements,
}: {
  entry: HookDimensionClusterRow;
  expanded: boolean;
  itemsById: Map<string, BuyingVideoItem>;
  showNamingColumns: boolean;
  onToggle: () => void;
  onOpenPreview: (item: BuyingVideoItem) => void;
  onSaveRunDates: (item: BuyingVideoItem, dates: string[]) => Promise<void>;
  onBatchSaveRunDates: (ids: string[], dates: string[]) => Promise<void>;
  onSavePlacements: (item: BuyingVideoItem, channels: BuyingChannelPlacement[]) => Promise<void>;
}) {
  const clusterItems = useMemo(() => {
    const ids = Object.keys(entry.similarityByItemId);
    return ids
      .map((id) => itemsById.get(id))
      .filter((x): x is BuyingVideoItem => Boolean(x))
      .sort(
        (a, b) =>
          (entry.similarityByItemId[b.id] ?? 0) - (entry.similarityByItemId[a.id] ?? 0),
      );
  }, [entry, itemsById]);

  const avgSimilarity =
    Object.values(entry.similarityByItemId).reduce((s, v) => s + v, 0) /
    Math.max(1, Object.keys(entry.similarityByItemId).length);

  const barWidth = Math.max(8, Math.min(100, entry.percent));

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
          expanded ? 'bg-accent-blue/5 ring-1 ring-inset ring-accent-blue/20' : ''
        }`}
      >
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-black ${
            entry.isMiscBucket
              ? 'bg-slate-200 text-slate-500'
              : entry.rank <= 3
                ? 'bg-accent-blue text-white'
                : 'bg-slate-100 text-slate-600'
          }`}
        >
          {entry.isMiscBucket ? '—' : entry.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-bold text-slate-800 line-clamp-2">{entry.label}</span>
            <span
              className={`text-xs font-bold ${entry.isMiscBucket ? 'text-slate-500' : 'text-primary-blue'}`}
            >
              {entry.count} 条 · {entry.percent}%
              {!entry.isMiscBucket && entry.count >= 2 ? ' · 共性簇' : ''}
            </span>
            <span className="text-[10px] font-medium text-slate-400">
              簇内均相似度 {Math.round(avgSimilarity * 100)}%
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-accent-blue transition-all"
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-accent-blue" aria-hidden />
        ) : (
          <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-300" aria-hidden />
        )}
      </button>

      {expanded ? (
        <div className="border-t border-slate-100 bg-slate-50/40 px-3 pb-4 pt-3">
          <CompetitorTopTable
            items={clusterItems}
            showNamingColumns={showNamingColumns}
            toolbarMode="minimal"
            similarityByItemId={entry.similarityByItemId}
            onOpenPreview={onOpenPreview}
            onSaveRunDates={onSaveRunDates}
            onBatchSaveRunDates={onBatchSaveRunDates}
            onSavePlacements={onSavePlacements}
          />
        </div>
      ) : null}
    </li>
  );
}
