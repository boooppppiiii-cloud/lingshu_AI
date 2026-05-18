import type { BuyingRankingSegment } from '../types';

export const BUYING_RANKING_SEGMENT_STORAGE_KEY = 'lingqi-buying-ranking-segment-v1';

export const RANKING_SEGMENT_OPTIONS: { id: BuyingRankingSegment; label: string }[] = [
  { id: 'competitor_top', label: '竞品 TOP' },
  { id: 'internal_top', label: '团队 TOP' },
];

export function rankingSegmentLabel(id: BuyingRankingSegment): string {
  return RANKING_SEGMENT_OPTIONS.find((o) => o.id === id)?.label ?? id;
}

export function readStoredRankingSegment(): BuyingRankingSegment | null {
  try {
    const v = localStorage.getItem(BUYING_RANKING_SEGMENT_STORAGE_KEY);
    if (v === 'competitor_top' || v === 'internal_top') return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function storeRankingSegment(segment: BuyingRankingSegment): void {
  try {
    localStorage.setItem(BUYING_RANKING_SEGMENT_STORAGE_KEY, segment);
  } catch {
    /* ignore */
  }
}

/** 从文件名生成默认标题（去扩展名） */
export function titleFromVideoFileName(fileName: string): string {
  const base = fileName.replace(/[/\\]/g, '_').trim();
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).trim() || '未命名视频';
}
