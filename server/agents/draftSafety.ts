const FACTUAL_RISK_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: 'commercial terms or commitment',
    pattern: /\b(?:price|quote|quotation|discount|stock|in stock|available|availability|moq|minimum order|lead time|delivery|ship(?:ping)?|payment|deposit|certif(?:ied|icate|ication)|warranty|guarantee|promise|capacity|factory|manufacturer)\b/i,
  },
  {
    label: 'product or company factual claim',
    pattern: /\b(?:we|our)\s+(?:are|have|come|support|use|include|ship|deliver|meet|provide|offer|accept|produce|manufacture)\b|\b(?:this|it|the (?:product|item|model))\s+(?:is|has|can|comes?|supports?|uses?|includes?|ships?|delivers?|meets?|provides?|offers?|works?|lasts?|fits?|accepts?)\b/i,
  },
  {
    label: 'company capability commitment',
    pattern: /\bwe\s+can\s+(?:supply|produce|manufacture|customi[sz]e|deliver|ship|offer|provide|support|meet|accept|certify|guarantee)\b/i,
  },
  {
    label: 'product attribute claim',
    pattern: /\b(?:made (?:of|from|with)|material\s*(?:is|:)|comes? in|available in|dimensions?\s*(?:are|is|:)|sizes?\s*(?:are|is|:)|colou?rs?\s*(?:are|is|:)|weights?\s*(?:are|is|:)|capacity\s*(?:is|:)|voltage\s*(?:is|:)|ingredients?\s*(?:are|is|:)|certified|waterproof|food[- ]grade)\b/i,
  },
  {
    label: 'order or logistics status claim',
    pattern: /\b(?:has shipped|have shipped|was shipped|dispatched|in transit|on the way|tracking number|order status|invoice (?:is|has|was)|payment (?:is|has|was))\b/i,
  },
  {
    label: 'claimed conversation memory',
    pattern: /\b(?:you|your (?:team|company))\s+(?:said|mentioned|asked|needed|wanted|preferred|confirmed|were looking|had chosen|agreed)\b/i,
  },
  {
    label: 'Spanish business fact or commitment',
    pattern: /\b(?:precio|cotizaci[oó]n|descuento|stock|disponible|disponibilidad|pedido m[ií]nimo|entrega|env[ií]o|pago|dep[oó]sito|certificad[oa]|garant[ií]a|plazo|f[aá]brica|material|podemos entregar|podemos enviar)\b/i,
  },
  {
    label: 'Arabic business fact or commitment',
    pattern: /(?:سعر|عرض سعر|خصم|مخزون|متوفر|الحد الأدنى|شحن|تسليم|دفع|عربون|شهادة|ضمان|مدة التوريد|مصنع|مادة|يمكننا الشحن|يمكننا التسليم)/i,
  },
];

export function unsupportedDraftNumbers(draft: string, factualSource: string): string[] {
  const values = draft.match(/\b\d+(?:[.,]\d+)?\b/g) ?? [];
  const evidenceValues = new Set(factualSource.match(/\b\d+(?:[.,]\d+)?\b/g) ?? []);
  return Array.from(new Set(values.filter(value => !evidenceValues.has(value))));
}

export function draftFactualRiskSignals(draft: string, factualSource: string): string[] {
  const signals = FACTUAL_RISK_PATTERNS
    .filter(item => item.pattern.test(draft))
    .map(item => item.label);
  if (unsupportedDraftNumbers(draft, factualSource).length) signals.push('number absent from supplied evidence');
  return Array.from(new Set(signals));
}

export function requiresFactualVerification(signals: string[], knowledgeMiss: boolean): boolean {
  return knowledgeMiss || signals.length > 0;
}

const HIGH_RISK_SUPPORT_RULES: Array<{ label: string; draft: RegExp; evidence: RegExp }> = [
  {
    label: 'private-label capability is not grounded',
    draft: /\b(?:we|our (?:team|factory|company))\s+(?:can|support|offer|provide|do|handle)[^.!?]{0,80}\b(?:private[ -]?label|oem|odm)\b/i,
    evidence: /\b(?:private[ -]?label|oem|odm)\b|贴牌|代工/i,
  },
  {
    label: 'bilingual or Arabic packaging capability is not grounded',
    draft: /\b(?:we|our (?:team|factory|company))\s+(?:can|support|offer|provide|do|handle)[^.!?]{0,100}\b(?:arabic|bilingual|english[- +]arabic)\b[^.!?]{0,40}\b(?:packaging|label)\b/i,
    evidence: /\b(?:arabic|bilingual|english[- +]arabic)\b[^.!?]{0,80}\b(?:packaging|label)\b|阿拉伯语包装|双语包装/i,
  },
  {
    label: 'quality document promise is not grounded',
    draft: /\b(?:we|i)\s+(?:can|will|['’]ll|are able to)\s+(?:send|share|provide|forward|arrange)[^.!?]{0,100}\b(?:gmp|iso|coa|lab report|test report|certificate|compliance document|inspection)\b/i,
    evidence: /\b(?:gmp|iso|coa|lab report|test report|certificate|compliance document|inspection)\b|认证|证书|检测报告|验货/i,
  },
  {
    label: 'certification validity claim is not grounded',
    draft: /\b(?:accredited bod(?:y|ies)|all certifications? (?:are|is)|certifications? (?:are|is) live|match(?:es)? our production|internationally recognized quality standard|made under international)\b/i,
    evidence: /\b(?:accredited bod(?:y|ies)|certifications? (?:are|is) live|internationally recognized|gmp|iso)\b|认可机构|国际认证/i,
  },
  {
    label: 'free inspection promise is not grounded',
    draft: /\b(?:third[- ]party inspection|inspection)[^.!?]{0,60}\b(?:free|no extra charge|without extra charge)\b|\b(?:free|no extra charge)[^.!?]{0,60}\binspection\b/i,
    evidence: /\b(?:third[- ]party inspection|inspection)[^.!?]{0,60}\b(?:free|no extra charge|without extra charge)\b|免费验货/i,
  },
  {
    label: 'company identity claim is not grounded',
    draft: /\bwe(?:['’]re| are) (?:a )?(?:factory|manufacturer|trading company|factory \+ trading company)\b/i,
    evidence: /\b(?:factory|manufacturer|trading company|factory \+ trading company)\b|企业类型：.*(?:工厂|制造商|贸易)/i,
  },
  {
    label: 'deadline promise is not grounded',
    draft: /\b(?:i|we)(?:['’]ll| will)\s+[^.!?]{0,100}\b(?:by end of day|today|within \d+ (?:hours?|days?)|in \d+ days?)\b/i,
    evidence: /\b(?:by end of day|within \d+ (?:hours?|days?)|in \d+ days?)\b|当天回复|\d+天内/i,
  },
];

export function unsupportedHighRiskClaims(draft: string, factualSource: string): string[] {
  return HIGH_RISK_SUPPORT_RULES
    .filter(rule => rule.draft.test(draft) && !rule.evidence.test(factualSource))
    .map(rule => rule.label);
}

export function hasInternalPromptLeak(draft: string): boolean {
  return /\b(?:system prompt|intent instruction|conversation phase|knowledgeReady|knowledge miss is true|customer id|recent timeline|detected factual-risk signals|return one directly-sendable reply|unified knowledge context|dialogue strategies)\b|统一知识检索上下文|硬规则：|客户上下文：/i.test(draft);
}
