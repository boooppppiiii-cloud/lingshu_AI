import {
  BUYING_HOOK_DISPLAY_FIELDS,
  buyingHookFieldText,
} from './buyingHookAnalysisDisplay';
import type { BuyingDashboardMode, BuyingRankingSegment, BuyingVideoItem } from '../types';

export type BuyingPageAssistantMessage = { role: 'user' | 'assistant'; text: string };

export type BuyingPageAssistantPageMeta = {
  mode: BuyingDashboardMode;
  rankingSegment?: BuyingRankingSegment | '';
  gameProfileLabel: string;
  scopeNote: string;
};

export type BuyingPageAssistantVideoRow = {
  id: string;
  title: string;
  scriptTags: string[];
  hookType: string;
  first3sVisual: string;
  first3sDialogue: string;
  coreGameplay: string;
  coreWelfare: string;
  endingGuidance: string;
  viralPattern: string;
  ctr: string;
  roi: string;
  miniGameDay1PayRoi: string;
  runVolumeText: string;
};

export type BuyingPageAssistantContext = {
  page: BuyingPageAssistantPageMeta;
  totalInScope: number;
  withHookAnalysis: number;
  hookTypeCounts: Record<string, number>;
  genreTagCounts: Record<string, number>;
  videos: BuyingPageAssistantVideoRow[];
};

const MAX_VIDEOS_IN_CONTEXT = 48;

function hasHookAnalysis(item: BuyingVideoItem): boolean {
  const ha = item.hookAnalysis;
  if (!ha) return false;
  return BUYING_HOOK_DISPLAY_FIELDS.some((f) => {
    const t = buyingHookFieldText(ha, f.key, f.isHookType);
    return t !== '—';
  });
}

function rowFromItem(item: BuyingVideoItem): BuyingPageAssistantVideoRow {
  const ha = item.hookAnalysis;
  return {
    id: item.id,
    title: item.title.trim() || '（无标题）',
    scriptTags: item.scriptTags.filter(Boolean),
    hookType: buyingHookFieldText(ha, 'first3sHookType', true),
    first3sVisual: buyingHookFieldText(ha, 'first3sVisual'),
    first3sDialogue: buyingHookFieldText(ha, 'first3sDialogue'),
    coreGameplay: buyingHookFieldText(ha, 'coreGameplaySellingPoints'),
    coreWelfare: buyingHookFieldText(ha, 'coreWelfareSellingPoints'),
    endingGuidance: buyingHookFieldText(ha, 'endingGuidance'),
    viralPattern: buyingHookFieldText(ha, 'reusableViralPattern'),
    ctr: item.adMetrics.ctr.trim() || '—',
    roi: item.adMetrics.roi.trim() || '—',
    miniGameDay1PayRoi: item.adMetrics.miniGameDay1PayRoi.trim() || '—',
    runVolumeText: item.runVolumeText.trim() || '—',
  };
}

export function buildBuyingPageAssistantContext(
  items: BuyingVideoItem[],
  page: BuyingPageAssistantPageMeta,
): BuyingPageAssistantContext {
  const hookTypeCounts: Record<string, number> = {};
  const genreTagCounts: Record<string, number> = {};

  const analyzed = items.filter(hasHookAnalysis);
  for (const item of analyzed) {
    const ha = item.hookAnalysis!;
    const ht = buyingHookFieldText(ha, 'first3sHookType', true);
    if (ht !== '—') hookTypeCounts[ht] = (hookTypeCounts[ht] ?? 0) + 1;
    const genre = item.scriptTags[0]?.trim();
    if (genre) genreTagCounts[genre] = (genreTagCounts[genre] ?? 0) + 1;
  }

  const prioritized = [
    ...analyzed,
    ...items.filter((i) => !analyzed.includes(i)),
  ].slice(0, MAX_VIDEOS_IN_CONTEXT);

  return {
    page,
    totalInScope: items.length,
    withHookAnalysis: analyzed.length,
    hookTypeCounts,
    genreTagCounts,
    videos: prioritized.map(rowFromItem),
  };
}
