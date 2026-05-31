import {
  BUYING_HOOK_DISPLAY_FIELDS,
  buyingHookFieldText,
} from './buyingHookAnalysisDisplay';
import type { BuyingVideoItem } from '../types';

type SearchChunk = { text: string; weight: number };

function pushChunk(chunks: SearchChunk[], raw: string | undefined, weight: number): void {
  const t = raw?.trim();
  if (!t || t === '—') return;
  chunks.push({ text: t.toLowerCase(), weight });
}

/** 竞品 TOP 表格相关度检索 — 可检索字段及权重 */
export function collectCompetitorSearchChunks(item: BuyingVideoItem): SearchChunk[] {
  const chunks: SearchChunk[] = [];

  pushChunk(chunks, item.title, 14);
  pushChunk(chunks, item.sourceLabel, 7);
  pushChunk(chunks, item.sourceType === 'internal' ? '内部' : '外部', 5);
  item.scriptTags.forEach((tag, i) => pushChunk(chunks, tag, i === 0 ? 16 : 10));
  item.placements.forEach((p) => pushChunk(chunks, p, 6));
  item.runDates.forEach((d) => pushChunk(chunks, d, 4));
  pushChunk(chunks, item.runTimeText, 4);
  pushChunk(chunks, item.runVolumeText, 4);

  const ha = item.hookAnalysis;
  if (ha) {
    for (const f of BUYING_HOOK_DISPLAY_FIELDS) {
      pushChunk(chunks, buyingHookFieldText(ha, f.key, f.isHookType), 12);
    }
    pushChunk(chunks, ha.first3sHookTypeOther, 10);
    pushChunk(chunks, ha.firstFiveSecondsSummary, 9);
    pushChunk(chunks, ha.firstFrameVisual, 8);
    pushChunk(chunks, ha.first5sCamera, 6);
    pushChunk(chunks, ha.first5sAvSync, 6);
    pushChunk(chunks, ha.first5sMood, 6);
    pushChunk(chunks, ha.conflictOpeningNote, 6);
    if (ha.firstSellingPoint?.method) pushChunk(chunks, ha.firstSellingPoint.method, 8);
    if (ha.firstSellingPoint?.visualAnalysis) pushChunk(chunks, ha.firstSellingPoint.visualAnalysis, 8);
  }

  const m = item.adMetrics;
  pushChunk(chunks, m.bidMethod, 5);
  pushChunk(chunks, m.roi, 5);
  pushChunk(chunks, m.miniGameDay1PayRoi, 5);
  pushChunk(chunks, m.shallowBid, 5);
  pushChunk(chunks, m.ctr, 5);
  pushChunk(chunks, m.miniGameRegisterCost, 5);
  pushChunk(chunks, m.miniGameDay1PayCost, 5);
  pushChunk(chunks, m.day1PayArppu, 5);

  return chunks;
}

/** 拆分为检索词：整句 + 空白/标点分隔的片段（均需命中） */
export function tokenizeRelevanceQuery(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = new Set<string>();
  if (q.length >= 1) terms.add(q);
  for (const part of q.split(/[\s,，、;；/|]+/)) {
    const t = part.trim();
    if (t.length >= 1) terms.add(t);
  }
  return [...terms];
}

export function scoreCompetitorItemRelevance(item: BuyingVideoItem, query: string): number {
  const terms = tokenizeRelevanceQuery(query);
  if (terms.length === 0) return 0;

  const chunks = collectCompetitorSearchChunks(item);
  if (chunks.length === 0) return 0;

  const fullHay = chunks.map((c) => c.text).join('\u0000');
  let total = 0;

  for (const term of terms) {
    if (!fullHay.includes(term)) return 0;

    for (const chunk of chunks) {
      if (!chunk.text.includes(term)) continue;
      const idx = chunk.text.indexOf(term);
      const freq = chunk.text.split(term).length - 1;
      const positionBonus = idx === 0 ? 4 : idx < 24 ? 2 : 0;
      const exactBonus = chunk.text === term ? chunk.weight * 2 : 0;
      total += chunk.weight * (1 + Math.min(freq, 3) * 0.45) + positionBonus + exactBonus;
    }
  }

  return total;
}

/** 在已筛选范围内按相关度降序排列，无匹配则剔除 */
export function rankItemsByRelevance(items: BuyingVideoItem[], query: string): BuyingVideoItem[] {
  const q = query.trim();
  if (!q) return items;

  return items
    .map((item) => ({ item, score: scoreCompetitorItemRelevance(item, q) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.item.created.localeCompare(a.item.created))
    .map((row) => row.item);
}
