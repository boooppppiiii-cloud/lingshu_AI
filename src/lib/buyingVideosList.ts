import { pb } from './pb';
import { recordToBuyingVideo, sortBuyingVideosByTitleSequenceAsc } from './buyingVideoMapper';
import { buyingVideosListFilter } from './buyingVideosListFilter';
import { readBuyingVideosCache, writeBuyingVideosCache } from './buyingVideosListCache';
import { readStoredRankingSegment } from './buyingRankingSegment';
import type { GameProfileId } from './gameProfiles';
import type { BuyingDashboardMode, BuyingTrendingPlacement, BuyingVideoItem } from '../types';

export const BUYING_VIDEOS_COLLECTION = 'buying_videos';
/** 与竞品表格首屏条数一致，用于无缓存时先出第一页 */
export const BUYING_LIST_FIRST_PAGE_SIZE = 30;

export type FetchBuyingVideosParams = {
  filter: string;
  mode: BuyingDashboardMode;
  trendingPlacement: BuyingTrendingPlacement;
};

function applyModeFilter(
  mapped: BuyingVideoItem[],
  mode: BuyingDashboardMode,
  trendingPlacement: BuyingTrendingPlacement,
): BuyingVideoItem[] {
  if (mode === 'trending') {
    return mapped.filter((v) => v.placements.includes(trendingPlacement));
  }
  return mapped;
}

export async function fetchBuyingVideosList(
  params: FetchBuyingVideosParams,
  options?: { firstPageOnly?: boolean },
): Promise<BuyingVideoItem[]> {
  const { filter, mode, trendingPlacement } = params;
  const sort = '-created';

  if (options?.firstPageOnly) {
    const page = await pb.collection(BUYING_VIDEOS_COLLECTION).getList(1, BUYING_LIST_FIRST_PAGE_SIZE, {
      filter,
      sort,
      requestKey: `buying-first:${filter}`,
    });
    const mapped = applyModeFilter(page.items.map(recordToBuyingVideo), mode, trendingPlacement);
    return sortBuyingVideosByTitleSequenceAsc(mapped);
  }

  const records = await pb.collection(BUYING_VIDEOS_COLLECTION).getFullList({
    filter,
    sort,
    requestKey: null,
  });
  const mapped = applyModeFilter(records.map(recordToBuyingVideo), mode, trendingPlacement);
  return sortBuyingVideosByTitleSequenceAsc(mapped);
}

function prefetchBuyingVideosFilter(
  gameProfileId: GameProfileId,
  mode: BuyingDashboardMode,
  rankingSegment: 'internal_top' | 'competitor_top',
): void {
  const filter = buyingVideosListFilter(gameProfileId, mode, rankingSegment);
  if (readBuyingVideosCache(filter)) return;

  void (async () => {
    try {
      const items = await fetchBuyingVideosList({
        filter,
        mode,
        trendingPlacement: 'douyin_portrait_916',
      });
      writeBuyingVideosCache(filter, items);
    } catch {
      /* 预取失败不影响主流程 */
    }
  })();
}

/** 登录后 / 切换游戏版本时后台预取，打开买量大屏可直接读缓存 */
export function prefetchBuyingVideosList(gameProfileId: GameProfileId): void {
  const segment = readStoredRankingSegment() ?? 'competitor_top';
  prefetchBuyingVideosFilter(gameProfileId, 'ranking', segment);
  prefetchBuyingVideosFilter(gameProfileId, 'hooks', 'competitor_top');
}
