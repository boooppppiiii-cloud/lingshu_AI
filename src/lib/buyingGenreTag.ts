import type { BuyingVideoItem } from '../types';

/** scriptTags 第一项：题材标签（与 server/buyingVideoAnalysis 一致） */
export const BUYING_GENRE_TAGS = ['剧情', '游戏玩法', '画面展示'] as const;

export type BuyingGenreTag = (typeof BUYING_GENRE_TAGS)[number];

export type BuyingGenreTagFilter = 'all' | BuyingGenreTag;

export const BUYING_GENRE_TAG_FILTER_OPTIONS: readonly { id: BuyingGenreTagFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: '画面展示', label: '画面展示' },
  { id: '剧情', label: '剧情' },
  { id: '游戏玩法', label: '游戏玩法' },
] as const;

/** Gemini analyzeBuyingVideo 题材判定说明（与 normalizeBuyingGenreTag 对齐） */
export const BUYING_GENRE_TAG_CLASSIFICATION_PROMPT = `题材 genreTag 判定（必须且只能是「剧情」「游戏玩法」「画面展示」之一，≤4字）：
- **游戏玩法**：成片主轴是演示/讲解游戏机制、操作手感、关卡或战斗、上手门槛与玩法爽点；含「玩法」或操作演示占主导时选此项。
- **画面展示**：连续多帧以展示游戏画面、角色/皮肤/场景美术、画质审美、实机高光集锦为主，**无明显连续剧情线**（非明星演绎、非对话推动的情节段）；含「展示」「审美」或偏种草/秀画面对就选此项。
- **剧情**：有明星/真人演绎、明显情节推进、情绪起伏、对话与动作场景驱动；或叙事/冲突/反转/情感向口播为主；含「剧情」或上述特征时选此项。
- 玩法演示与剧情兼有时，以前 3 秒主钩子 + 全片最长时段承载的内容为准；纯口播福利无玩法演示不算游戏玩法。`;

const GAMEPLAY_SIGNALS = [
  '玩法',
  '操作',
  '上手',
  '局内',
  '关卡',
  '战斗',
  '零氪',
  '试玩',
  '爽点',
  '机制',
] as const;

/** 剧情信号优先于纯展示（有情节/情绪/对话时不归为画面展示） */
const PLOT_SIGNALS = [
  '剧情',
  '明星',
  '情节',
  '情绪',
  '对话',
  '演员',
  '演绎',
  '故事',
  '冲突',
  '反转',
  '口播',
  '人物',
  '争吵',
  '情景',
  '叙事',
] as const;

const SHOWCASE_SIGNALS = [
  '展示',
  '审美',
  '画质',
  '美术',
  '实机',
  '高光',
  '皮肤',
  '角色秀',
  '混剪',
  '连续',
  '多角度',
  '展台',
  '种草',
  '秀画面',
] as const;

function clamp(raw: string, max: number): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, max);
}

function matchesAny(s: string, keywords: readonly string[]): boolean {
  return keywords.some((k) => s.includes(k));
}

/** 与 ingest 归一化规则对齐，用于比对 scriptTags[0] */
export function normalizeBuyingGenreTag(raw: string): BuyingGenreTag {
  const s = clamp(raw, 24);
  if (!s) return '剧情';
  if (s === '游戏玩法' || matchesAny(s, GAMEPLAY_SIGNALS)) return '游戏玩法';
  if (s === '剧情' || matchesAny(s, PLOT_SIGNALS)) return '剧情';
  if (s === '画面展示' || matchesAny(s, SHOWCASE_SIGNALS)) return '画面展示';
  const hit = BUYING_GENRE_TAGS.find((g) => s === g || s.includes(g));
  return hit ?? '剧情';
}

export function buyingGenreTagFromItem(item: BuyingVideoItem): BuyingGenreTag | null {
  const first = item.scriptTags[0]?.trim();
  if (!first) return null;
  return normalizeBuyingGenreTag(first);
}

export function itemMatchesGenreTagFilter(item: BuyingVideoItem, filter: BuyingGenreTagFilter): boolean {
  if (filter === 'all') return true;
  const genre = buyingGenreTagFromItem(item);
  return genre === filter;
}
