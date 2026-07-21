import type { RetrievedContext } from './retrieve.js';

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function buildKnowledgePromptBlock(context: RetrievedContext): string {
  return [
    '【统一知识检索上下文】',
    '硬规则：',
    '- 引用产品信息时，必须只使用下方 products 中的准确数字、SKU、MOQ、价格、材质、颜色、尺码、库存或交期；禁止编造价格、库存、MOQ、折扣、证书、交期。',
    '- products 为空时，不得假装已经查到具体产品；需要向客户确认货号/品类/数量/规格。',
    '- bizRules 是报价与业务规则的最高优先级；如果 quoteMode=human_only 或规则不完整，不得输出具体价格数字。',
    '- FAQ 只有 approvedForAuto=true 时才可用于自动回复；未审批 FAQ 只能作为草稿参考。',
    '- matchedFaq 的 confidence 低于 0.90 或 ambiguous=true 时，不得把标准答案当成当前问题的确定答案；应先澄清语境。',
    '- knowledgeMiss=true 时，只能确认收到问题、询问缺失信息或转人工，不得补写知识库中不存在的事实。',
    '',
    'companyIntro:',
    context.companyIntro || '(empty)',
    '',
    'bizRules:',
    json(context.bizRules),
    '',
    'faqs:',
    json(context.faqs),
    '',
    'matchedFaq:',
    json(context.faqMatch),
    '',
    'products:',
    json(context.products),
    '',
    'evidence:',
    context.evidence.length ? context.evidence.map(item => `- ${item}`).join('\n') : '(none)',
  ].join('\n');
}

export function buildKnowledgeEvidenceBlock(context: RetrievedContext): string {
  return context.evidence.length ? context.evidence.map(item => `- ${item}`).join('\n') : '未命中具体知识依据';
}
