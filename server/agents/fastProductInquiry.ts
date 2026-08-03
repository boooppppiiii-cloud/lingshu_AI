type SupportedLanguage = 'english' | 'spanish' | 'arabic';

const RISK_OR_COMPLEX_PATTERN = /\b(?:price|quote|quotation|discount|cost|how much|guarantee|certificate|certification|gmp|iso|coa|delivery|ship(?:ping)?|lead time|private[ -]?label|oem|odm|customi[sz]|packaging|refund|complaint|damaged|competitor|another supplier)\b|报价|价格|折扣|保证|证书|认证|交期|物流|贴牌|定制|包装|投诉|退款|竞争对手|(?:precio|cotización|descuento|certificado|entrega|envío|marca privada|empaque)|(?:سعر|خصم|شهادة|تسليم|شحن|علامة خاصة|تغليف)/iu;
const BASIC_INQUIRY_PATTERN = /\b(?:saw|watched|interested|looking for|need|want|buy|source|order|distribute|boutique)\b|看到|想要|需要|采购|询盘|(?:vi|interesa|busco|necesito|comprar)|(?:رأيت|مهتم|أبحث|أحتاج|شراء)/iu;

function normalizeLanguage(value: unknown): SupportedLanguage {
  const language = String(value || '').toLowerCase();
  if (language.includes('arabic') || language.includes('阿语') || language.includes('العربية')) return 'arabic';
  if (language.includes('spanish') || language.includes('西语') || language.includes('español')) return 'spanish';
  return 'english';
}

function quantityFromMessage(message: string): string {
  return message.match(/\b\d[\d,]*(?:\.\d+)?\s*(?:pcs?|pieces?|units?|sets?|bottles?|boxes?|cartons?|piezas?|unidades?)\b/iu)?.[0] || '';
}

export function isFastProductInquiry(input: {
  message: string;
  product: string;
  firstBuyerTurn: boolean;
}): boolean {
  const message = String(input.message || '').trim();
  return Boolean(
    input.firstBuyerTurn
    && String(input.product || '').trim()
    && quantityFromMessage(message)
    && BASIC_INQUIRY_PATTERN.test(message)
    && !RISK_OR_COMPLEX_PATTERN.test(message)
    && (message.match(/[?？؟]/g) || []).length <= 1
  );
}

export function fastProductInquiryReply(input: {
  message: string;
  product: string;
  language: unknown;
}): { draft: string; draftZh: string } {
  const quantity = quantityFromMessage(input.message);
  const product = String(input.product || '').trim();
  const language = normalizeLanguage(input.language);
  if (language === 'spanish') return {
    draft: `${quantity} de ${product}, entendido. ¿Qué especificaciones necesitas?`,
    draftZh: `${product}，${quantity}，明白。您需要什么规格？`,
  };
  if (language === 'arabic') return {
    draft: `${quantity} من ${product}، واضح. ما المواصفات التي تحتاجها؟`,
    draftZh: `${product}，${quantity}，明白。您需要什么规格？`,
  };
  return {
    draft: `${quantity} of ${product}—got it. What specs do you need?`,
    draftZh: `${product}，${quantity}，明白。您需要什么规格？`,
  };
}
