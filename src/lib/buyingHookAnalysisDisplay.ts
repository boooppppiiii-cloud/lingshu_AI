import type { BuyingHookAnalysis, BuyingVideoItem } from '../types';

/** 与 server/buyingVideoAnalysis 占位一致，不参与相似度聚类 */
export const BUYING_HOOK_PLACEHOLDER_TEXT = '（待分析）';

const THEME_TAG_PLACEHOLDERS = new Set(['待分析', '']);

export function isPlaceholderAnalysisText(text: string): boolean {
  const t = text.trim();
  if (!t || t === '—') return true;
  if (t === BUYING_HOOK_PLACEHOLDER_TEXT || t === '待分析') return true;
  if (/^解析失败/.test(t)) return true;
  return false;
}

export function isMeaningfulThemeTag(tag: string): boolean {
  const t = tag.trim();
  return t.length > 0 && !THEME_TAG_PLACEHOLDERS.has(t);
}

/** 是否已有可用的钩子分析（非空且非占位） */
export function hasMeaningfulHookAnalysisItem(item: BuyingVideoItem): boolean {
  const ha = item.hookAnalysis;
  if (!ha) return false;
  if (
    isMeaningfulHookField(ha.first3sHookType) ||
    isMeaningfulHookField(ha.coreGameplaySellingPoints) ||
    isMeaningfulHookField(ha.coreWelfareSellingPoints) ||
    isMeaningfulHookField(ha.reusableViralPattern)
  ) {
    return true;
  }
  if (ha.first3sHookType === '其他' && isMeaningfulHookField(ha.first3sHookTypeOther)) {
    return true;
  }
  return false;
}

function isMeaningfulHookField(v: unknown): boolean {
  return typeof v === 'string' && !isPlaceholderAnalysisText(v);
}

/** 钩子分析 7 项 — 卡片/表格展示顺序（与业务字段序号一致） */
export const BUYING_HOOK_DISPLAY_FIELDS: {
  label: string;
  key: keyof BuyingHookAnalysis;
  /** 钩子类型需合并 first3sHookTypeOther */
  isHookType?: boolean;
}[] = [
  { label: '前三秒画面呈现', key: 'first3sVisual' },
  { label: '前三秒台词/字幕', key: 'first3sDialogue' },
  { label: '前三秒钩子类型', key: 'first3sHookType', isHookType: true },
  { label: '核心玩法卖点', key: 'coreGameplaySellingPoints' },
  { label: '核心福利卖点', key: 'coreWelfareSellingPoints' },
  { label: '结尾引导语', key: 'endingGuidance' },
  { label: '分析可复用爆款套路', key: 'reusableViralPattern' },
];

export function buyingHookTypeDisplay(ha: BuyingHookAnalysis | null): string {
  if (!ha?.first3sHookType?.trim()) return '—';
  const t = ha.first3sHookType.trim();
  if (t === '其他' && ha.first3sHookTypeOther?.trim()) {
    return `其他 · ${ha.first3sHookTypeOther.trim()}`;
  }
  return t;
}

export function buyingHookFieldText(
  ha: BuyingHookAnalysis | null,
  key: keyof BuyingHookAnalysis,
  isHookType?: boolean,
): string {
  if (!ha) return '—';
  if (isHookType) return buyingHookTypeDisplay(ha);
  const v = ha[key];
  if (typeof v === 'string' && v.trim() && !isPlaceholderAnalysisText(v)) return v.trim();
  if (key === 'first3sVisual') {
    const legacy = [ha.firstFrameVisual, ha.firstFiveSecondsSummary]
      .filter((x) => typeof x === 'string' && !isPlaceholderAnalysisText(x))
      .join('；');
    if (legacy.trim()) return legacy.trim();
  }
  return '—';
}
