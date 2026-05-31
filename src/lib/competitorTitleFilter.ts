import type { BuyingVideoItem } from '../types';

export type CompetitorTitleFilter = 'all' | 'my_garden_world' | 'dream_forest' | 'other';

export const COMPETITOR_TITLE_PRESET_KEYWORDS: Record<
  Exclude<CompetitorTitleFilter, 'all' | 'other'>,
  string
> = {
  my_garden_world: '我的花园世界',
  dream_forest: '织梦森林',
};

export function itemMatchesCompetitorTitleFilter(
  item: BuyingVideoItem,
  filter: CompetitorTitleFilter,
  otherKeyword: string,
): boolean {
  if (filter === 'all') return true;

  const title = item.title.trim().toLowerCase();
  if (!title) return false;

  if (filter === 'other') {
    const kw = otherKeyword.trim().toLowerCase();
    if (!kw) return true;
    return title.includes(kw);
  }

  const keyword = COMPETITOR_TITLE_PRESET_KEYWORDS[filter].toLowerCase();
  return title.includes(keyword);
}
