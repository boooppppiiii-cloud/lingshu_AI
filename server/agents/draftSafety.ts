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
