import { notifyDeliveryTeam, type DeliveryNotificationSeverity } from '../lib/tenantPlatformApps.js';
import { hasLargeQuantity } from '../lib/dealSize.js';
import type { BantAssessment } from './qualification.js';

export type HandoffLine = 'business_value' | 'risk' | 'capability';
export type RiskKind = 'price_or_terms' | 'dispute_or_quality';

export interface HandoffDecision {
  required: boolean;
  primaryLine?: HandoffLine;
  lines: HandoffLine[];
  riskKind?: RiskKind;
  severity: DeliveryNotificationSeverity;
  stopAuto: boolean;
  reasons: string[];
}

const VALUE_PATTERN = /\b(?:ready to order|place (?:the )?order|purchase now|send (?:the )?pi|proforma invoice|contract|repeat order|reorder|exclusive|distributor agreement|oem|odm|private label)\b|准备下单|马上下单|采购意向明确|形式发票|合同|复购|返单|独家|总代|贴牌|代工/i;
const PRICE_RISK_PATTERN = /\b(?:price|quote|quotation|discount|best price|payment|deposit|credit terms|lead time|delivery date|other supplier|competitor price)\b|价格|报价|折扣|优惠|付款|定金|账期|交期|同行价|其他供应商/i;
const DISPUTE_RISK_PATTERN = /\b(?:guarantee|complaint|refund|compensation|damaged|defect|bad quality|lawyer)\b|保证|投诉|退款|赔偿|破损|瑕疵|质量问题|律师/i;

export function evaluateHandoff(input: {
  message: string;
  sentiment?: string;
  knowledgeMissStreak?: number;
  fallbackCount?: number;
  requestedHuman?: boolean;
  knowledgeGap?: boolean;
  historicalOrderValue?: number;
  repeatCustomer?: boolean;
}): HandoffDecision {
  const lines: HandoffLine[] = [];
  const reasons: string[] = [];
  const message = String(input.message || '');
  if (VALUE_PATTERN.test(message) || hasLargeQuantity(message) || (input.historicalOrderValue ?? 0) >= 5000 || input.repeatCustomer) {
    lines.push('business_value');
    reasons.push(input.repeatCustomer || (input.historicalOrderValue ?? 0) >= 5000
      ? '历史已成交或累计采购价值高，属于优先人工维护客户'
      : '命中大单、明确采购、PI/合同、复购或 OEM/独家等商业价值信号');
  }
  const disputeRisk = DISPUTE_RISK_PATTERN.test(message) || input.sentiment === 'negative';
  const priceRisk = PRICE_RISK_PATTERN.test(message);
  let riskKind: RiskKind | undefined;
  if (disputeRisk || priceRisk) {
    lines.push('risk');
    riskKind = disputeRisk ? 'dispute_or_quality' : 'price_or_terms';
    reasons.push(input.sentiment === 'negative' ? '客户情绪负面或存在投诉风险' : disputeRisk ? '涉及客诉、质量或纠纷类 L4 事项' : '涉及价格、付款、交期或同行探价等 L4 事项');
  }
  if (input.requestedHuman || input.knowledgeGap || (input.knowledgeMissStreak ?? 0) >= 2 || (input.fallbackCount ?? 0) > 2) {
    lines.push('capability');
    reasons.push(input.requestedHuman
      ? '客户主动要求人工'
      : input.knowledgeGap
      ? '知识库没有可核验答案，需要人工确认并补充知识'
      : '连续知识缺口或兜底次数达到强制转人工阈值');
  }
  const uniqueLines = [...new Set(lines)];
  const severity: DeliveryNotificationSeverity = uniqueLines.includes('business_value')
    ? 'urgent'
    : uniqueLines.includes('risk')
    ? 'important'
    : 'normal';
  return {
    required: uniqueLines.length > 0,
    primaryLine: uniqueLines[0],
    lines: uniqueLines,
    riskKind: uniqueLines.includes('risk') ? riskKind : undefined,
    severity,
    stopAuto: uniqueLines.includes('business_value') || uniqueLines.includes('risk') || uniqueLines.includes('capability'),
    reasons,
  };
}

// 真实性系数≤0.3（疑似套价/踩点）时，仅抑制价格/条款类的转人工推送噪音；
// 纠纷、投诉等 dispute_or_quality 永远不受此影响，必须正常转人工。
export function shouldRestrictToPublicInfo(bant?: BantAssessment): boolean {
  return (bant?.authenticity?.score ?? 1) <= 0.3;
}

export function automationFailureHandoff(detail: unknown): HandoffDecision {
  return {
    required: true,
    primaryLine: 'capability',
    lines: ['capability'],
    severity: 'important',
    stopAuto: true,
    reasons: [`自动回复链路中断：${compact(detail, 120)}`],
  };
}

function compact(value: unknown, max = 160): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max) || '未提供';
}

function publicAppOrigin(): string {
  return String(process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || process.env.PUBLIC_BASE_URL || 'https://app.lingshu.site').replace(/\/+$/, '');
}

export async function notifyCustomerHandoff(input: {
  tenantId: string;
  customer: {
    id: string;
    name: string;
    waNumber: string;
    countryName?: string;
    localTime?: string;
    stage?: string;
    estimatedValue?: string;
    intentScore?: number;
    bant?: BantAssessment;
  };
  message: string;
  decision: HandoffDecision;
  bridgeSent?: boolean;
}): Promise<void> {
  const { customer, decision } = input;
  const detailUrl = `${publicAppOrigin()}/?page=conversion&customer=${encodeURIComponent(customer.id)}&action=review`;
  const title = decision.severity === 'urgent'
    ? '灵小枢｜紧急商机，请立即接手'
    : decision.severity === 'important'
    ? '灵小枢｜重要风险，请审核草稿'
    : '灵小枢｜知识缺口待处理';
  const summary = [
    `客户要什么：${compact(input.message)}`,
    `聊到哪一步：${compact(customer.stage || '询盘')}，BANT ${customer.bant?.total ?? customer.intentScore ?? 0}/100`,
    `为什么需要人：${compact(decision.reasons.join('；'))}`,
  ];
  const content = [
    `**客户**：${compact(customer.name)}（${compact(customer.countryName || '国家未知')}，当地 ${compact(customer.localTime || '时间未知')}）`,
    `**WhatsApp**：${compact(customer.waNumber)}`,
    `**意向 / 预估价值**：${customer.bant?.total ?? customer.intentScore ?? 0}/100 / ${compact(customer.estimatedValue || '$0')}`,
    `**分流线**：${decision.lines.join(' + ')}`,
    ...summary,
    input.bridgeSent === undefined ? '' : input.bridgeSent ? 'AI 已发送安全承接短消息。' : 'AI 未自动发送，已有待审核草稿。',
  ].filter(Boolean).join('\n');
  await notifyDeliveryTeam(content, {
    tenantId: input.tenantId,
    severity: decision.severity,
    immediate: decision.severity !== 'normal',
    title,
    actions: [
      { text: decision.severity === 'important' ? '审核草稿' : '立即接手', url: detailUrl },
      { text: '查看客户', url: detailUrl },
    ],
  });
}
