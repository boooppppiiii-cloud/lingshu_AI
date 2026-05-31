import { cosineSimilarity, textToNgramVector } from './textCosineSimilarity';
import type { BuyingVideoItem } from '../types';

export type ThemeTagCatalogEntry = { tag: string; count: number };

const SKIP_THEME_TAGS = new Set(['', '待分析', '吸睛开场', '强节奏']);

export function normalizeThemeTagKey(tag: string): string {
  return tag.replace(/\s+/g, '').slice(0, 4);
}

function isCatalogableThemeTag(tag: string): boolean {
  const t = normalizeThemeTagKey(tag);
  return t.length > 0 && !SKIP_THEME_TAGS.has(t);
}

/** 从 scriptTags 列表统计主题标签频次（仅 scriptTags[1]、scriptTags[2]） */
export function buildThemeTagCatalogFromScriptTagsList(
  rows: readonly (readonly string[])[],
): ThemeTagCatalogEntry[] {
  const freq = new Map<string, number>();
  for (const tags of rows) {
    const seen = new Set<string>();
    for (const raw of tags.slice(1)) {
      const tag = normalizeThemeTagKey(String(raw ?? ''));
      if (!isCatalogableThemeTag(tag) || seen.has(tag)) continue;
      seen.add(tag);
      freq.set(tag, (freq.get(tag) ?? 0) + 1);
    }
  }
  return [...freq.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));
}

export function buildThemeTagCatalogFromItems(items: BuyingVideoItem[]): ThemeTagCatalogEntry[] {
  return buildThemeTagCatalogFromScriptTagsList(items.map((i) => i.scriptTags));
}

const MATCH_COSINE_THRESHOLD = 0.72;

/**
 * 将 AI 给出的主题标签对齐到已有库：完全匹配 > 余弦相近 > 保持新词
 */
export function resolveThemeTagAgainstCatalog(
  suggested: string,
  catalog: readonly ThemeTagCatalogEntry[],
): string {
  const key = normalizeThemeTagKey(suggested);
  if (!key) return normalizeThemeTagKey(suggested) || '待分析';
  if (!isCatalogableThemeTag(key)) return key;

  const exact = catalog.find((e) => normalizeThemeTagKey(e.tag) === key);
  if (exact) return exact.tag;

  const suggestedVec = textToNgramVector(key);
  let best: ThemeTagCatalogEntry | null = null;
  let bestSim = 0;

  for (const entry of catalog) {
    const entryKey = normalizeThemeTagKey(entry.tag);
    if (key.includes(entryKey) || entryKey.includes(key)) {
      if (entry.count > (best?.count ?? 0)) {
        best = entry;
        bestSim = 1;
      }
      continue;
    }
    const sim = cosineSimilarity(suggestedVec, textToNgramVector(entryKey));
    if (sim >= MATCH_COSINE_THRESHOLD && sim > bestSim) {
      best = entry;
      bestSim = sim;
    }
  }

  return best?.tag ?? key;
}

export function formatThemeTagCatalogForPrompt(
  catalog: readonly ThemeTagCatalogEntry[],
  maxItems = 32,
): string {
  if (catalog.length === 0) {
    return '当前尚无历史主题标签库；themeTags 可各用≤4字新标签概括。';
  }
  const lines = catalog.slice(0, maxItems).map((e, i) => `${i + 1}. ${e.tag}（${e.count}次）`);
  return `【现有主题标签库】按出现频次排序，themeTags **必须优先**从下列标签中选取最贴切的两项（不要自创新标签，除非全片内容确实无法用库中任何标签概括）：
${lines.join('\n')}
若必须新增：每个新标签≤4个汉字，且不与库中标签同义重复。`;
}
