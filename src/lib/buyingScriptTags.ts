import { normalizeBuyingGenreTag, type BuyingGenreTag } from './buyingGenreTag';

export type BuyingScriptTagsTuple = [string, string, string];

const DEFAULT_THEME_TAGS: [string, string] = ['吸睛开场', '强节奏'];

/** 主题标签：去空白，最多 4 字（与 server/buyingVideoAnalysis 一致） */
export function normalizeBuyingThemeTag(raw: string, fallback: string): string {
  const s = raw.replace(/\s+/g, '').slice(0, 4);
  return s || fallback;
}

/** 归一化为 [题材, 主题1, 主题2] 三元组 */
export function normalizeScriptTagsTuple(input: readonly string[]): BuyingScriptTagsTuple {
  const genre = normalizeBuyingGenreTag(String(input[0] ?? ''));
  const theme1 = normalizeBuyingThemeTag(String(input[1] ?? ''), DEFAULT_THEME_TAGS[0]);
  const theme2 = normalizeBuyingThemeTag(String(input[2] ?? ''), DEFAULT_THEME_TAGS[1]);
  return [genre, theme1, theme2];
}

export function scriptTagsEqual(a: readonly string[], b: readonly string[]): boolean {
  const na = normalizeScriptTagsTuple(a);
  const nb = normalizeScriptTagsTuple(b);
  return na[0] === nb[0] && na[1] === nb[1] && na[2] === nb[2];
}

export function scriptTagsFromTuple(tags: BuyingScriptTagsTuple): string[] {
  return [...tags];
}

export function genreTagFromTuple(tags: BuyingScriptTagsTuple): BuyingGenreTag {
  return normalizeBuyingGenreTag(tags[0]);
}

/** 脚本标签单行展示：题材 · 主题1 · 主题2 */
export function compactScriptLine(tags: readonly string[]): string {
  if (!tags.some((t) => String(t).trim())) return '';
  return normalizeScriptTagsTuple(tags).join(' · ');
}
