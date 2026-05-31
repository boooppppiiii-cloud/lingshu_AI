/** 买量视频 — 前 3 秒钩子类型（AI 须择一；「其他」由运营在前端补全说明） */
export const BUYING_FIRST3S_HOOK_TYPES = [
  '福利诱导',
  '悬念反转',
  '痛点暴击',
  '玩法爽点',
  '对比反差',
  '审美视觉',
  '猎奇搞笑',
  '其他',
] as const;

export type BuyingFirst3sHookType = (typeof BUYING_FIRST3S_HOOK_TYPES)[number];

/** 历史库字段 → 现行枚举 */
export const LEGACY_FIRST3S_HOOK_TYPE_ALIASES: Partial<Record<string, BuyingFirst3sHookType>> = {
  猎奇视觉: '猎奇搞笑',
};

/** Gemini analyzeBuyingVideo 钩子类型列表文案 */
export const BUYING_FIRST3S_HOOK_TYPE_PROMPT_LIST =
  '「福利诱导」「悬念反转」「痛点暴击」「玩法爽点」「对比反差」「审美视觉」「猎奇搞笑」「其他」';

export function isBuyingFirst3sHookType(v: string): v is BuyingFirst3sHookType {
  return (BUYING_FIRST3S_HOOK_TYPES as readonly string[]).includes(v);
}

export function normalizeBuyingFirst3sHookType(raw: unknown): BuyingFirst3sHookType {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 12) : '';
  if (!s) return '其他';
  const legacy = LEGACY_FIRST3S_HOOK_TYPE_ALIASES[s];
  if (legacy) return legacy;
  const exact = BUYING_FIRST3S_HOOK_TYPES.find((t) => s === t);
  if (exact) return exact;
  if (s.includes('福利') || s.includes('红包') || s.includes('领奖')) return '福利诱导';
  if (s.includes('悬念') || s.includes('反转')) return '悬念反转';
  if (s.includes('痛点') || s.includes('暴击') || s.includes('冲突') || s.includes('争吵')) {
    return '痛点暴击';
  }
  if (s.includes('玩法') || s.includes('爽') || s.includes('操作')) return '玩法爽点';
  if (s.includes('对比') || s.includes('反差') || s.includes('前后')) return '对比反差';
  if (s.includes('审美') || (s.includes('视觉') && !s.includes('猎奇') && !s.includes('搞笑'))) {
    return '审美视觉';
  }
  if (s.includes('猎奇') || s.includes('搞笑') || s.includes('奇观')) return '猎奇搞笑';
  return '其他';
}
