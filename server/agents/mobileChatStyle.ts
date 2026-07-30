const MARKDOWN_OR_LIST_PATTERN = /(^|\n)\s*(?:#{1,6}\s+|>\s+|[-*+•◦▪▫◆◇]\s+|\d+[.)]\s+|[-*+]\s*\[[ xX]\]\s+)|\*\*[^*]+\*\*|__[^_]+__|```|`[^`]+`/m;
const FORMAL_TRANSLATION_PATTERN = /\b(?:thank you for your inquiry|we would be delighted|please be advised|we are pleased to|kindly (?:provide|note|confirm)|happy to assist|feel free to contact us|at your earliest convenience)\b/i;

export function normalizeMobileChatFormatting(value: unknown): string {
  const raw = String(value || '')
    .replace(/```[a-z]*\s*/gi, '')
    .replace(/```/g, '')
    .replace(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/g, '$1: $2');
  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const plain = lines.map(line => line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/^(?:[-*+•◦▪▫◆◇✅☑️✔️✓]\s+)+/, '')
    .replace(/^\[[ xX]\]\s*/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim())
    .filter(Boolean)
    .join(' ');
  return plain
    .replace(/\bthank you for your inquiry\b/gi, 'Thanks for your message')
    .replace(/\bwe would be delighted to\b/gi, "We'd be glad to")
    .replace(/\bplease be advised(?: that)?\b/gi, 'Just so you know,')
    .replace(/\bkindly (?:provide|send)\b/gi, 'Please send')
    .replace(/\bhappy to assist\b/gi, 'glad to help')
    .replace(/\bfeel free to contact us\b/gi, 'Just message me')
    .replace(/\bat your earliest convenience\b/gi, 'when you can')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isDetailedBuyerMessage(message: string): boolean {
  const normalized = message.trim();
  const questions = (normalized.match(/[?？]/g) ?? []).length;
  return normalized.length >= 120
    || questions >= 2
    || /\b(?:detail|specification|material|dimension|certificate|certification|packaging|compare|difference|requirement|shipping|delivery|payment)\b|材质|规格|尺寸|认证|包装|对比|区别|付款|交期/i.test(normalized);
}

export function shouldReshapeMobileChatDraft(draft: string, latestBuyerMessage: string): boolean {
  const value = String(draft || '').trim();
  if (!value) return false;
  if (MARKDOWN_OR_LIST_PATTERN.test(value) || FORMAL_TRANSLATION_PATTERN.test(value)) return true;
  const detailed = isDetailedBuyerMessage(latestBuyerMessage);
  if (value.length > 720) return true;
  if (!detailed && value.length > Math.max(280, latestBuyerMessage.trim().length * 5)) return true;
  return false;
}

export function mobileChatRewritePrompt(draft: string, latestBuyerMessage: string, language: string): string {
  return [
    'Rewrite one seller reply so it sounds typed by a real, experienced Yiwu trader on a phone.',
    `Use ${language} throughout. Return one plain-text WhatsApp message only.`,
    'Keep every supported business fact and the original intent. Do not add product facts, prices, promises, or capabilities.',
    'Match the length to the buyer: keep a casual message brief; give a serious detail question only the extra explanation it genuinely needs.',
    'Use natural spoken trade language, not an essay, brochure, customer-service template, or polished marketing copy.',
    'Do not use headings, Markdown, bold text, checkboxes, bullets, numbered lists, or decorative symbols. If several points matter, connect them naturally in conversation, such as “one thing is…” and “also…”.',
    'For English, prefer direct everyday trade talk such as “You want to add skincare to your shop?” or “Tell me the quantity you need and I’ll check the best option for you.” Avoid formal translated phrases.',
    `Latest buyer message: ${latestBuyerMessage}`,
    `Draft to rewrite: ${draft}`,
  ].join('\n');
}
