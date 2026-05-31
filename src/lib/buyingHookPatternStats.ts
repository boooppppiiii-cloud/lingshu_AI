import {
  buyingHookFieldText,
  buyingHookTypeDisplay,
  isMeaningfulThemeTag,
  isPlaceholderAnalysisText,
} from './buyingHookAnalysisDisplay';
import { clusterThemeTagInputs } from './themeTagClustering';
import {
  clusterTextsByCosineSimilarity,
  normalizeTextForSimilarity,
  type TextCluster,
  type TextClusterInput,
} from './textCosineSimilarity';
import type { BuyingVideoItem } from '../types';

export type BuyingHookRankDimension =
  | 'theme_tag'
  | 'av_combo'
  | 'visual'
  | 'dialogue'
  | 'hook_type'
  | 'gameplay'
  | 'welfare'
  | 'viral_pattern';

export const BUYING_HOOK_RANK_DIMENSIONS: {
  id: BuyingHookRankDimension;
  label: string;
  hint: string;
  threshold: number;
  categoricalExact?: boolean;
}[] = [
  {
    id: 'theme_tag',
    label: '主题标签',
    hint: '仅按白名单词根（如「萌宠」）合并，且每簇最多 2 个标签',
    threshold: 0.7,
  },
  {
    id: 'av_combo',
    label: '音画组合',
    hint: '画面+台词相似者合并，便于总结共性开场',
    threshold: 0.55,
  },
  {
    id: 'visual',
    label: '画面分析',
    hint: '前三秒画面描述相似者合并',
    threshold: 0.55,
  },
  {
    id: 'dialogue',
    label: '台词字幕',
    hint: '前三秒台词/音效描述相似者合并',
    threshold: 0.55,
  },
  {
    id: 'hook_type',
    label: '钩子类型',
    hint: '按钩子类型归类（同类型即为一簇）',
    threshold: 1,
    categoricalExact: true,
  },
  {
    id: 'gameplay',
    label: '玩法卖点',
    hint: '玩法卖点表述相似者合并',
    threshold: 0.52,
  },
  {
    id: 'welfare',
    label: '福利卖点',
    hint: '福利卖点表述相似者合并',
    threshold: 0.52,
  },
  {
    id: 'viral_pattern',
    label: '可复用爆款套路',
    hint: '爆款套路分析相似者合并',
    threshold: 0.52,
  },
];

export interface HookDimensionClusterRow {
  rank: number;
  clusterId: string;
  label: string;
  detail?: string;
  count: number;
  percent: number;
  members: { itemId: string; text: string; similarity: number }[];
  similarityByItemId: Record<string, number>;
  isMiscBucket?: boolean;
}

export interface HookDimensionRankResult {
  dimension: BuyingHookRankDimension;
  totalInScope: number;
  analyzableCount: number;
  /** 本维度无有效文本、未参与聚类的素材数 */
  skippedCount: number;
  /** 共性簇（≥2 条素材）数量 */
  patternClusterCount: number;
  entries: HookDimensionClusterRow[];
}

function extractDimensionTexts(item: BuyingVideoItem, dimension: BuyingHookRankDimension): string[] {
  const ha = item.hookAnalysis;
  switch (dimension) {
    case 'theme_tag':
      return item.scriptTags.slice(1).map((t) => t.trim()).filter(isMeaningfulThemeTag);
    case 'av_combo': {
      const visual = buyingHookFieldText(ha, 'first3sVisual');
      const dialogue = buyingHookFieldText(ha, 'first3sDialogue');
      if (visual === '—' && dialogue === '—') return [];
      const parts = [visual === '—' ? '' : visual, dialogue === '—' ? '' : dialogue].filter(Boolean);
      return [parts.join(' · ')];
    }
    case 'visual': {
      const t = buyingHookFieldText(ha, 'first3sVisual');
      return t === '—' ? [] : [t];
    }
    case 'dialogue': {
      const t = buyingHookFieldText(ha, 'first3sDialogue');
      return t === '—' ? [] : [t];
    }
    case 'hook_type': {
      const t = buyingHookTypeDisplay(ha);
      return t === '—' ? [] : [t];
    }
    case 'gameplay': {
      const t = buyingHookFieldText(ha, 'coreGameplaySellingPoints');
      return t === '—' ? [] : [t];
    }
    case 'welfare': {
      const t = buyingHookFieldText(ha, 'coreWelfareSellingPoints');
      return t === '—' ? [] : [t];
    }
    case 'viral_pattern': {
      const t = buyingHookFieldText(ha, 'reusableViralPattern');
      return t === '—' ? [] : [t];
    }
    default:
      return [];
  }
}

function collectDimensionInputs(
  items: BuyingVideoItem[],
  dimension: BuyingHookRankDimension,
): { inputs: TextClusterInput[]; skippedItemIds: Set<string> } {
  const inputs: TextClusterInput[] = [];
  const participated = new Set<string>();
  for (const item of items) {
    for (const text of extractDimensionTexts(item, dimension)) {
      if (isPlaceholderAnalysisText(text)) continue;
      if (normalizeTextForSimilarity(text)) {
        inputs.push({ itemId: item.id, text });
        participated.add(item.id);
      }
    }
  }
  const skippedItemIds = new Set(items.map((i) => i.id).filter((id) => !participated.has(id)));
  return { inputs, skippedItemIds };
}

function clusterToRow(cluster: TextCluster, rank: number, analyzableCount: number): HookDimensionClusterRow {
  const similarityByItemId: Record<string, number> = {};
  for (const m of cluster.members) {
    const prev = similarityByItemId[m.itemId];
    if (prev === undefined || m.similarity > prev) {
      similarityByItemId[m.itemId] = m.similarity;
    }
  }
  const count = Object.keys(similarityByItemId).length;
  return {
    rank,
    clusterId: cluster.clusterId,
    label: cluster.label,
    count,
    percent: analyzableCount > 0 ? Math.round((count / analyzableCount) * 1000) / 10 : 0,
    members: cluster.members,
    similarityByItemId,
    isMiscBucket: cluster.isMiscBucket,
  };
}

export function buildHookDimensionRankings(
  items: BuyingVideoItem[],
  dimension: BuyingHookRankDimension,
): HookDimensionRankResult {
  const meta = BUYING_HOOK_RANK_DIMENSIONS.find((d) => d.id === dimension)!;
  const { inputs, skippedItemIds } = collectDimensionInputs(items, dimension);
  const analyzableItemIds = new Set(inputs.map((x) => x.itemId));
  const analyzableCount = analyzableItemIds.size;
  const skippedCount = skippedItemIds.size;

  const clusters =
    dimension === 'theme_tag'
      ? clusterThemeTagInputs(inputs, {
          bundleSingletons: true,
          miscLabel: '其他零散（暂未形成共性簇）',
        })
      : clusterTextsByCosineSimilarity(inputs, {
          threshold: meta.threshold,
          maxClusters: 50,
          categoricalExact: meta.categoricalExact,
          orphanMergeThreshold: meta.categoricalExact ? 1 : 0.46,
          bundleRemainingSingletons: !meta.categoricalExact,
          miscLabel: '其他零散（暂未形成共性簇）',
          adaptivePasses: meta.categoricalExact ? 0 : 2,
        });

  const entries = clusters.map((c, i) => clusterToRow(c, i + 1, analyzableCount || items.length));
  const patternClusterCount = entries.filter((e) => !e.isMiscBucket && e.count >= 2).length;

  return {
    dimension,
    totalInScope: items.length,
    analyzableCount: analyzableCount || items.length,
    skippedCount,
    patternClusterCount,
    entries,
  };
}

/** @deprecated */
export type BuyingHookPatternRankKind = BuyingHookRankDimension;
