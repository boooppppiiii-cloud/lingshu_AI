import type { BuyingVideoItem } from '../types';

/** 竞品 TOP 表格 — 投放平台筛选 */
export type BuyingAdPlatform = 'juliang' | 'tencent';

export type BuyingAdPlatformFilter = 'all' | BuyingAdPlatform;

const JULIANG_HINT = /巨量|字节|抖音|douyin|千川|ocean\s*engine|oceanengine/i;
const TENCENT_HINT = /腾讯|微信|广点通|gdt|广点|mp广告|视频号/i;

/**
 * 依据上传来源推断投放平台：外部竞品素材默认腾讯系，内部素材默认巨量系；
 * sourceLabel 含平台关键词时优先匹配。
 */
export function buyingAdPlatformFromItem(item: BuyingVideoItem): BuyingAdPlatform {
  const hay = `${item.sourceLabel} ${item.sourceType}`;
  if (JULIANG_HINT.test(hay)) return 'juliang';
  if (TENCENT_HINT.test(hay)) return 'tencent';
  return item.sourceType === 'external' ? 'tencent' : 'juliang';
}

export function itemMatchesAdPlatformFilter(item: BuyingVideoItem, filter: BuyingAdPlatformFilter): boolean {
  if (filter === 'all') return true;
  return buyingAdPlatformFromItem(item) === filter;
}

export const BUYING_AD_PLATFORM_FILTER_OPTIONS: readonly {
  id: BuyingAdPlatformFilter;
  label: string;
}[] = [
  { id: 'all', label: '全渠道' },
  { id: 'juliang', label: '巨量' },
  { id: 'tencent', label: '腾讯' },
] as const;
