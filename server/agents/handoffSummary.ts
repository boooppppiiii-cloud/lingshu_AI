import { classifyKnowledgeGapScenario, type KnowledgeGapScenario } from './knowledgeGapPlaybook.js';

export interface HandoffSummaryInput {
  latestMessage: string;
  product?: string;
  handlingReason?: string;
  customerSummary?: string;
  nextStep?: string;
}

function compactMessage(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function requestedCertificate(message: string): string {
  const labels = [
    /\bgmp\b/i.test(message) ? 'GMP' : '',
    /\biso\b/i.test(message) ? 'ISO' : '',
    /\bcoa\b/i.test(message) ? 'COA' : '',
  ].filter(Boolean);
  return labels.length ? labels.join('/') : '相关资质';
}

function needLine(scenario: KnowledgeGapScenario, message: string, product: string): string {
  const target = product ? `“${product}”` : '当前产品';
  if (scenario === 'quality_or_certification') return `核实${requestedCertificate(message)}证书或质量文件的真实性`;
  if (scenario === 'price_or_quote') return `确认${target}的真实报价和交易条件`;
  if (scenario === 'delivery_commitment') return `确认${target}能否满足客户要求的交付时间`;
  if (scenario === 'product_availability') return `确认${target}的规格、颜色或库存是否可用`;
  if (scenario === 'competitor_comparison') return '比较竞品条件，并确认我们的真实可执行方案';
  if (scenario === 'customization_or_packaging') return `确认${target}的定制或包装要求能否落地`;
  if (scenario === 'after_sale_complaint') return '处理客户的售后、质量或投诉问题';
  if (scenario === 'order_or_logistics') return '核对客户订单或物流的真实状态';
  if (scenario === 'call_request') return '安排人工通话并确认合适时间';
  if (scenario === 'high_value_or_peer') return '评估大额采购或同行询盘并继续推进';
  if (scenario === 'product_discovery') return `了解客户需求并推荐已录入的${target}`;
  if (scenario === 'urgent_next_step') return '尽快确认下一步所需资料和处理方式';
  return message ? `确认客户提出的具体需求：“${compactMessage(message)}”` : '确认客户最新提出的需求';
}

function progressLine(scenario: KnowledgeGapScenario): string {
  if (scenario === 'quality_or_certification') return '客户正在核验证书，AI 未确认文件真实性';
  if (scenario === 'price_or_quote') return '客户已进入询价阶段，AI 未提供未经确认的价格';
  if (scenario === 'delivery_commitment') return '客户提出了明确时限，生产和物流尚未核实';
  if (scenario === 'product_availability') return '客户已经给出部分产品要求，具体可用情况尚未核实';
  if (scenario === 'after_sale_complaint') return '客户已反馈问题，等待核对订单和证据';
  if (scenario === 'order_or_logistics') return '客户正在查询真实业务记录，系统暂无可确认结果';
  if (scenario === 'call_request') return '客户已提出通话需求，等待人工确认时间';
  if (scenario === 'competitor_comparison') return '客户正在比较供应商，关键条件需要人工核对';
  if (scenario === 'customization_or_packaging') return '客户已提出定制要求，真实能力和细节尚未确认';
  if (scenario === 'high_value_or_peer') return '询盘价值或身份需要人工判断，AI 已停止自动推进';
  return '客户已经说明需求，等待人工核对并继续推进';
}

function humanReasonLine(scenario: KnowledgeGapScenario, fallback: string): string {
  if (scenario === 'quality_or_certification') return '证书真实性必须核对真实文件、编号和对应产品';
  if (scenario === 'price_or_quote') return '价格、折扣和交易条件必须由销售确认';
  if (scenario === 'delivery_commitment') return '交期承诺必须核实生产和物流安排';
  if (scenario === 'product_availability') return '库存和规格可用性需要查询真实产品数据';
  if (scenario === 'after_sale_complaint') return '售后责任和处理方案需要人工依据订单证据判断';
  if (scenario === 'order_or_logistics') return '订单、付款和物流状态必须查询真实记录';
  if (scenario === 'call_request') return '需要人工确认可通话时间并接手沟通';
  if (scenario === 'competitor_comparison') return '竞争条件和可执行方案需要销售判断';
  if (scenario === 'customization_or_packaging') return '定制能力、成本和工艺不能由AI自行承诺';
  if (scenario === 'high_value_or_peer') return '涉及大额商机或客户身份判断，需要人工接手';
  return compactMessage(fallback) || '问题超出当前可确认资料，需要人工核实';
}

export function buildHandoffSummary(input: HandoffSummaryInput): string {
  const message = compactMessage(input.latestMessage);
  const scenario = classifyKnowledgeGapScenario(message);
  const product = compactMessage(input.product || '');
  return [
    `客户要什么：${needLine(scenario, message, product)}。`,
    `聊到哪一步：${progressLine(scenario)}。`,
    `为什么需要人：${humanReasonLine(scenario, input.handlingReason || '')}。`,
  ].join('\n');
}
