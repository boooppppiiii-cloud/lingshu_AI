import type { BuyingTrendingPlacement } from '../types';

/** 竞品 TOP / 爬榜单：腾讯系版位（存入 placements JSON 数组，中文标签） */
export const BUYING_CHANNEL_PLACEMENT_OPTIONS = [
  '微信视频号',
  '微信小程序公众号',
  '微信朋友圈',
  '优量汇',
  '腾讯广告电脑端',
  '搜索场景',
  'QQ腾讯音乐及游戏',
] as const;

export type BuyingChannelPlacement = (typeof BUYING_CHANNEL_PLACEMENT_OPTIONS)[number];

const CHANNEL_SET = new Set<string>(BUYING_CHANNEL_PLACEMENT_OPTIONS);

const TRENDING_SET = new Set<BuyingTrendingPlacement>([
  'douyin_portrait_916',
  'tencent_landscape_169',
  'tencent_portrait_916',
]);

export function isBuyingChannelPlacement(v: string): v is BuyingChannelPlacement {
  return CHANNEL_SET.has(v);
}

export function isBuyingTrendingPlacement(v: string): v is BuyingTrendingPlacement {
  return TRENDING_SET.has(v as BuyingTrendingPlacement);
}

export function channelPlacementsFromList(placements: string[]): BuyingChannelPlacement[] {
  return placements.filter(isBuyingChannelPlacement);
}

export function mergeChannelPlacements(
  existing: string[],
  channels: BuyingChannelPlacement[],
): string[] {
  const trending = existing.filter(isBuyingTrendingPlacement);
  const unknown = existing.filter((p) => !isBuyingTrendingPlacement(p) && !isBuyingChannelPlacement(p));
  const sorted = [...new Set(channels)].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return [...trending, ...unknown, ...sorted];
}

export function parseBuyingPlacements(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .filter((x) => isBuyingTrendingPlacement(x) || isBuyingChannelPlacement(x));
  } catch {
    return [];
  }
}

const TRENDING_LABELS: Record<BuyingTrendingPlacement, string> = {
  douyin_portrait_916: '抖音竖版 9:16',
  tencent_landscape_169: '腾讯横版 16:9',
  tencent_portrait_916: '腾讯竖版 9:16',
};

export function buyingPlacementLabel(id: string): string {
  if (isBuyingTrendingPlacement(id)) return TRENDING_LABELS[id];
  return id;
}
