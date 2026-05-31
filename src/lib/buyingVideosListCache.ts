import { buyingVideosListFilter } from './buyingVideosListFilter';
import type { GameProfileId } from './gameProfiles';
import type { BuyingDashboardMode, BuyingRankingSegment, BuyingVideoItem } from '../types';

const CACHE_VERSION = 1;
const TTL_MS = 10 * 60 * 1000;
const PREFIX = `buying-videos-v${CACHE_VERSION}:`;

type CachePayload = {
  at: number;
  items: BuyingVideoItem[];
};

function storageKey(filter: string): string {
  return `${PREFIX}${filter}`;
}

export function readBuyingVideosCache(filter: string): BuyingVideoItem[] | null {
  try {
    const raw = sessionStorage.getItem(storageKey(filter));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachePayload;
    if (!parsed?.items || !Array.isArray(parsed.items)) return null;
    if (Date.now() - parsed.at > TTL_MS) {
      sessionStorage.removeItem(storageKey(filter));
      return null;
    }
    return parsed.items;
  } catch {
    return null;
  }
}

export function writeBuyingVideosCache(filter: string, items: BuyingVideoItem[]): void {
  try {
    const payload: CachePayload = { at: Date.now(), items };
    sessionStorage.setItem(storageKey(filter), JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

/** 找钩子列表可回退读竞品 TOP 缓存，切换 Tab 时更快出数 */
export function readBuyingVideosListCache(
  gameProfileId: GameProfileId,
  mode: BuyingDashboardMode,
  rankingSegment: BuyingRankingSegment,
): BuyingVideoItem[] | null {
  const filter = buyingVideosListFilter(gameProfileId, mode, rankingSegment);
  const cached = readBuyingVideosCache(filter);
  if (cached || mode !== 'hooks') return cached;
  const competitorFilter = buyingVideosListFilter(gameProfileId, 'ranking', 'competitor_top');
  return readBuyingVideosCache(competitorFilter);
}

export function clearBuyingVideosCache(filter?: string): void {
  try {
    if (filter) {
      sessionStorage.removeItem(storageKey(filter));
      return;
    }
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
