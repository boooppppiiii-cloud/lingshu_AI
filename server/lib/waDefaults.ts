export type AutomationLevel = 'auto' | 'confirm' | 'manual';
export type CustomerStage = '潜客' | '询盘中' | '已报价' | '成交' | '沉默30' | '沉默60';
export type SopStep = '首响' | '问需求' | '报价' | '样品打样' | '付款' | '履约' | '复购唤醒';

export interface IntentSignal {
  label: string;
  score: number;
}

export interface WaDefaults {
  intentThresholds: { autoMax: number; confirmMax: number };
  bigDealAmountUsd: number;
  firstResponseSlaMinutes: number;
  readNoReplyMinutes: number;
  silentDays: number[];
  baseMissingFields: string[];
  sopSteps: SopStep[];
  fuseKeywords: string[];
}

export const WA_DEFAULTS: WaDefaults = {
  intentThresholds: { autoMax: 50, confirmMax: 84 },
  bigDealAmountUsd: 1000,
  firstResponseSlaMinutes: 5,
  readNoReplyMinutes: 45,
  silentDays: [30, 60, 90],
  baseMissingFields: ['数量', '用途', '目的港', '交期', '预算', '付款方式', '是否要样品'],
  sopSteps: ['首响', '问需求', '报价', '样品打样', '付款', '履约', '复购唤醒'],
  fuseKeywords: [
    'call', 'phone', 'talk', 'manager', 'boss', 'refund', 'complaint', 'urgent',
    '通话', '电话', '经理', '老板', '退款', '投诉', '紧急',
    'اتصال', 'مدير', 'عاجل', 'شكوى',
    'llamada', 'gerente', 'urgente', 'queja',
  ],
};

export function automationFromScore(score: number): AutomationLevel {
  if (score <= WA_DEFAULTS.intentThresholds.autoMax) return 'auto';
  if (score <= WA_DEFAULTS.intentThresholds.confirmMax) return 'confirm';
  return 'manual';
}

export function stageFromAutomation(level: AutomationLevel): CustomerStage {
  if (level === 'auto') return '潜客';
  return '询盘中';
}

export function inboxReasonFor(input: { callRequest?: boolean; complaint?: boolean; bigDeal?: boolean; automation?: AutomationLevel }): string {
  if (input.callRequest) return 'call';
  if (input.complaint) return 'complaint';
  if (input.bigDeal) return 'large';
  if (input.automation === 'confirm') return 'draft';
  return 'reply';
}

export function missingFieldsFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const missing: string[] = [];
  if (!/(\d+\s*(pcs|pieces|sets|套|件|个)|数量|quantity|moq)/i.test(text)) missing.push('数量');
  if (!/(gift|retail|wholesale|resell|use|用途|批发|零售|自用)/i.test(text)) missing.push('用途');
  if (!/(ship|port|dubai|riyadh|usa|目的港|发到|shipping|delivery)/i.test(text)) missing.push('目的港');
  if (!/(urgent|days|before|交期|几天|什么时候|when|lead time)/i.test(text)) missing.push('交期');
  if (!/(\$|usd|budget|price|预算|价格|报价|cost)/i.test(text)) missing.push('预算');
  if (!/(pay|payment|付款|订金|deposit|tt|paypal)/i.test(lower)) missing.push('付款方式');
  if (!/(sample|样品|打样)/i.test(text)) missing.push('是否要样品');
  return missing.slice(0, 5);
}
