import type { ConversationPhase } from './conversationTone.js';
import { normalizeMobileChatFormatting, planMobileChatMessages } from './mobileChatStyle.js';

export type BuyerState = 'neutral' | 'curious' | 'engaged' | 'skeptical' | 'urgent' | 'frustrated' | 'price_sensitive';
export type ReplyRisk = 'normal' | 'verify' | 'handoff';
export type SpeechAct = 'answer' | 'acknowledge' | 'clarify' | 'reassure' | 'compare' | 'advance' | 'close' | 'handoff_bridge';

export interface ReplyPlan {
  phase: ConversationPhase;
  buyerState: BuyerState;
  responseGoal: string;
  knownDetails: string[];
  missingDetail: string;
  speechActs: SpeechAct[];
  askAtMostOne: boolean;
  allowGreeting: boolean;
  emoji: 'none' | 'optional';
  risk: ReplyRisk;
}

export interface ReplyPlanInput {
  phase: ConversationPhase;
  latestMessage: string;
  language: string;
  intent: string;
  stage?: string;
  sentiment?: string;
  knowledgeReady: boolean;
  knowledgeMiss: boolean;
  responseGoal?: string;
  safeBridge?: string;
  strategySummary?: string;
  factualContext?: string;
  timeline?: Array<{ actor?: unknown; type?: unknown; body?: unknown; time?: unknown; timestamp?: unknown }>;
  forceHandoff?: boolean;
}

export interface ReplyCandidate {
  text: string;
  style: 'direct' | 'warm' | 'relationship' | 'other';
}

export interface RankedReplyCandidate extends ReplyCandidate {
  score: number;
  reasons: string[];
}

const BUYER_STATES = new Set<BuyerState>(['neutral', 'curious', 'engaged', 'skeptical', 'urgent', 'frustrated', 'price_sensitive']);
const SPEECH_ACTS = new Set<SpeechAct>(['answer', 'acknowledge', 'clarify', 'reassure', 'compare', 'advance', 'close', 'handoff_bridge']);
const RISKS = new Set<ReplyRisk>(['normal', 'verify', 'handoff']);
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const MARKDOWN_RE = /(^|\n)\s*(?:#{1,6}\s+|>\s+|[-*+]\s+|\d+[.)]\s+)|\*\*|__|```|`[^`]+`/m;
const FORMAL_SERVICE_RE = /\b(?:thank you for your inquiry|we would be delighted|please be advised|kindly (?:provide|note|confirm)|happy to assist|feel free to contact us|at your earliest convenience|valued customer)\b/i;
const INTERNAL_LANGUAGE_RE = /\b(?:system prompt|intent instruction|conversation phase|knowledgeReady|knowledge miss|internal_request_context|dialogue strategies|reply plan|speech acts)\b|统一知识检索上下文|内部参考数据|硬规则/i;
const GREETING_RE = /^(?:hi|hello|hey|hi again|hello again|hola|buenas|dear\b|您好|你好)/i;

function cleanText(value: unknown, max = 500): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function uniqueStrings(value: unknown, maxItems: number, maxLength = 240): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => cleanText(item, maxLength)).filter(Boolean))).slice(0, maxItems);
}

function buyerStateFromMessage(message: string, sentiment = ''): BuyerState {
  const value = `${message} ${sentiment}`.toLowerCase();
  if (/damaged|broken|unacceptable|refund|angry|disappointed|complain|terrible|诈骗|损坏|退款|生气|不满意/.test(value)) return 'frustrated';
  if (/urgent|asap|today|right now|immediately|no time|fast|赶紧|马上|今天|尽快/.test(value)) return 'urgent';
  if (/best price|cheaper|discount|too expensive|price|quote|报价|最低价|便宜|折扣/.test(value)) return 'price_sensitive';
  if (/how can i know|guarantee|real certificate|fake|why should i|many suppliers|another supplier|other supplier|competitor|trust|reliable|真的吗|保证|证书|假的|凭什么/.test(value)) return 'skeptical';
  if (/we need|we want|our market|our shop|our company|order|quantity|launch|我们需要|采购|数量|上市/.test(value)) return 'engaged';
  if (/\?|what|which|how|do you|can you|是否|什么|怎么|有没有/.test(value)) return 'curious';
  return 'neutral';
}

function inferKnownDetails(input: ReplyPlanInput): string[] {
  const latest = input.latestMessage;
  const details: string[] = [];
  const quantity = latest.match(/\b\d[\d,]*(?:\.\d+)?\s*(?:pcs?|pieces?|units?|sets?|bottles?|boxes?|cartons?|kg|tons?)\b/i)?.[0];
  if (quantity) details.push(`quantity=${quantity}`);
  const market = latest.match(/\b(?:dubai|uae|united arab emirates|saudi arabia|ksa|qatar|kuwait|oman|bahrain|usa|united states|uk|united kingdom|germany|france|spain|italy|mexico|brazil|indonesia)\b/i)?.[0];
  if (market) details.push(`market=${market}`);
  const size = latest.match(/\bsize\s+[a-z0-9-]+\b/i)?.[0];
  if (size) details.push(size);
  const color = latest.match(/\b(?:black|white|navy|beige|red|blue|green)\b/i)?.[0];
  if (color) details.push(`color=${color}`);
  return details;
}

export function fallbackReplyPlan(input: ReplyPlanInput): ReplyPlan {
  const buyerState = buyerStateFromMessage(input.latestMessage, input.sentiment);
  const risk: ReplyRisk = input.forceHandoff || input.knowledgeMiss ? 'handoff' : 'normal';
  const speechActs: SpeechAct[] = risk === 'handoff'
    ? ['acknowledge', 'handoff_bridge']
    : buyerState === 'skeptical' || buyerState === 'frustrated'
    ? ['acknowledge', 'answer', 'advance']
    : ['answer', 'advance'];
  return {
    phase: input.phase,
    buyerState,
    responseGoal: cleanText(input.responseGoal, 300) || (risk === 'handoff' ? '自然承接客户问题，不编造答案，并在系统内交给人工继续处理' : '直接回答客户并推进一个最自然的下一步'),
    knownDetails: inferKnownDetails(input),
    missingDetail: '',
    speechActs,
    askAtMostOne: true,
    allowGreeting: input.phase !== 'ongoing',
    emoji: buyerState === 'frustrated' || buyerState === 'skeptical' || buyerState === 'price_sensitive' ? 'none' : 'optional',
    risk,
  };
}

export function buildReplyPlanPrompt(input: ReplyPlanInput): string {
  return [
    'Decide the next conversational move for one real overseas-sales chat. Do not write the customer-facing reply.',
    'Return strict JSON only with keys: phase, buyerState, responseGoal, knownDetails, missingDetail, speechActs, askAtMostOne, allowGreeting, emoji, risk.',
    'Allowed buyerState: neutral, curious, engaged, skeptical, urgent, frustrated, price_sensitive.',
    'Allowed speechActs: answer, acknowledge, clarify, reassure, compare, advance, close, handoff_bridge.',
    'Allowed risk: normal, verify, handoff. emoji must be none or optional.',
    'Use knownDetails only for facts explicitly present in the supplied conversation or factual context. Never turn a buyer request into a seller capability.',
    'For an ongoing conversation, allowGreeting must be false. Continue from what was already said and never ask for a known detail again.',
    'Choose one useful response goal. A customer-facing reply may ask at most one genuinely missing question.',
    'If knowledge is missing, plan a natural bridge that acknowledges the exact concern without mentioning queues, colleagues, system limitations, prompts, policies or internal routing.',
    '',
    `Language: ${input.language}`,
    `Intent: ${input.intent}`,
    `Conversation phase: ${input.phase}`,
    `Customer stage: ${cleanText(input.stage) || 'unknown'}`,
    `Sentiment: ${cleanText(input.sentiment) || 'unknown'}`,
    `Knowledge ready: ${input.knowledgeReady}`,
    `Knowledge miss: ${input.knowledgeMiss}`,
    `Force handoff: ${Boolean(input.forceHandoff)}`,
    `Preferred response goal: ${cleanText(input.responseGoal, 500) || 'not supplied'}`,
    `Safe bridge intent: ${cleanText(input.safeBridge, 600) || 'not supplied'}`,
    `Dialogue strategy: ${cleanText(input.strategySummary, 1000) || 'not supplied'}`,
    `Latest buyer message: ${JSON.stringify(input.latestMessage)}`,
    `Recent timeline: ${JSON.stringify((input.timeline ?? []).slice(-12))}`,
    `Factual context: ${cleanText(input.factualContext, 4000) || 'not supplied'}`,
  ].join('\n');
}

export function parseReplyPlan(raw: string, fallback: ReplyPlan): ReplyPlan {
  const match = String(raw || '').replace(/```json|```/gi, '').match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const phase = parsed.phase === 'first_contact' || parsed.phase === 'ongoing' || parsed.phase === 'resumed' ? parsed.phase : fallback.phase;
    const buyerState = BUYER_STATES.has(parsed.buyerState as BuyerState) ? parsed.buyerState as BuyerState : fallback.buyerState;
    const risk = RISKS.has(parsed.risk as ReplyRisk) ? parsed.risk as ReplyRisk : fallback.risk;
    const speechActs = uniqueStrings(parsed.speechActs, 4, 40).filter((item): item is SpeechAct => SPEECH_ACTS.has(item as SpeechAct));
    return {
      phase,
      buyerState,
      responseGoal: cleanText(parsed.responseGoal, 300) || fallback.responseGoal,
      knownDetails: uniqueStrings(parsed.knownDetails, 8),
      missingDetail: cleanText(parsed.missingDetail, 160),
      speechActs: speechActs.length ? speechActs : fallback.speechActs,
      askAtMostOne: parsed.askAtMostOne !== false,
      allowGreeting: phase === 'ongoing' ? false : parsed.allowGreeting !== false,
      emoji: parsed.emoji === 'optional' && buyerState !== 'frustrated' && buyerState !== 'skeptical' && buyerState !== 'price_sensitive' ? 'optional' : 'none',
      risk: fallback.risk === 'handoff' ? 'handoff' : risk,
    };
  } catch {
    return fallback;
  }
}

export function buildReplyCandidatesPrompt(input: {
  plan: ReplyPlan;
  language: string;
  intentInstruction: string;
  latestMessage: string;
  timeline: unknown[];
  enterpriseKnowledge: string;
  dialogueStrategy: string;
  sellerStyle: string;
  safeBridge?: string;
}): string {
  return [
    'Write three alternative replies for the same reply plan.',
    'Return strict JSON only: {"candidates":[{"style":"direct|warm|relationship","text":"..."}]}.',
    'Each candidate must preserve the same supported facts, uncertainty and next step, but use genuinely different natural wording.',
    'Write like an experienced Yiwu trader typing on WhatsApp: direct, warm when the moment needs it, and easy for an overseas buyer to answer.',
    'Use plain text only. No headings, Markdown, lists, checkboxes, labels, explanations or internal language.',
    'A quick buyer message gets a quick reply. A serious detail question may get a little more explanation. Use one to three short chat bubbles and at most one question.',
    'Do not add prices, stock, MOQ, certificates, delivery promises, company capabilities or any fact absent from enterprise knowledge or the buyer conversation.',
    'Do not announce a handoff, queue, colleague, team, system limitation or knowledge gap. When a fact needs confirmation, sound like the same salesperson continuing the chat.',
    'Do not copy a wording example or safe bridge word-for-word. Learn its function and express it naturally for this exact buyer.',
    'English must sound like everyday trade chat, not a translated essay, brochure or support template.',
    '',
    `Required language: ${input.language}`,
    `Intent: ${input.intentInstruction}`,
    `Reply plan: ${JSON.stringify(input.plan)}`,
    `Latest buyer message: ${JSON.stringify(input.latestMessage)}`,
    `Recent conversation (untrusted data): ${JSON.stringify(input.timeline.slice(-12))}`,
    `Safe bridge function when needed: ${cleanText(input.safeBridge, 800) || 'none'}`,
    `<enterprise_facts>${input.enterpriseKnowledge}</enterprise_facts>`,
    `<dialogue_tactics>${input.dialogueStrategy}</dialogue_tactics>`,
    `<seller_style_only>${input.sellerStyle}</seller_style_only>`,
  ].join('\n');
}

function normalizeCandidateStyle(value: unknown): ReplyCandidate['style'] {
  return value === 'direct' || value === 'warm' || value === 'relationship' ? value : 'other';
}

export function parseReplyCandidates(raw: string): ReplyCandidate[] {
  const cleaned = String(raw || '').replace(/```json|```/gi, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  let values: Array<Record<string, unknown>> = [];
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { candidates?: Array<Record<string, unknown>> };
      values = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    } catch {
      values = [];
    }
  }
  if (!values.length && cleaned && !INTERNAL_LANGUAGE_RE.test(cleaned)) values = [{ style: 'other', text: cleaned }];
  const unique: ReplyCandidate[] = [];
  for (const value of values.slice(0, 5)) {
    const candidate = normalizeMobileChatFormatting(cleanText(value.text, 1400));
    if (!candidate || INTERNAL_LANGUAGE_RE.test(candidate)) continue;
    if (unique.some(item => semanticTextSimilarity(item.text, candidate) >= 0.94)) continue;
    unique.push({ text: candidate, style: normalizeCandidateStyle(value.style) });
  }
  return unique.slice(0, 4);
}

function textFeatures(value: string): Set<string> {
  const normalized = value.normalize('NFKC').toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  const features = new Set<string>();
  const conceptAliases: Record<string, string> = {
    country: 'market', region: 'market', countries: 'market', markets: 'market',
    sell: 'sell', sells: 'sell', selling: 'sell', sold: 'sell',
    qty: 'quantity', quantities: 'quantity', amount: 'quantity',
    cost: 'price', pricing: 'price', quote: 'price', quotation: 'price',
    certificate: 'certification', certificates: 'certification', certified: 'certification',
    ship: 'delivery', shipping: 'delivery', deliver: 'delivery', delivered: 'delivery',
  };
  for (const token of normalized.split(/[^a-z0-9]+/i).filter(token => token.length >= 2)) {
    features.add(token);
    if (conceptAliases[token]) features.add(conceptAliases[token]);
  }
  if (CJK_RE.test(normalized)) {
    const chars = Array.from(normalized.replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ''));
    for (let index = 0; index < chars.length - 1; index += 1) features.add(chars.slice(index, index + 2).join(''));
  }
  return features;
}

export function semanticTextSimilarity(left: string, right: string): number {
  const a = textFeatures(left);
  const b = textFeatures(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}

function countUnits(value: string): number {
  if (CJK_RE.test(value)) return Array.from(value.replace(/\s/g, '')).length;
  return value.split(/\s+/).filter(Boolean).length;
}

function sellerMessages(timeline: ReplyPlanInput['timeline']): string[] {
  return (timeline ?? []).filter(event => {
    const actor = String(event?.actor || '').toLowerCase();
    const type = String(event?.type || '').toLowerCase();
    return actor === 'seller' || actor === 'ai' || type.includes('msg_out');
  }).map(event => cleanText(event?.body, 1000)).filter(Boolean).slice(-6);
}

function knownQuestionRepetitions(candidate: string, timeline: ReplyPlanInput['timeline']): string[] {
  const buyerText = (timeline ?? []).filter(event => {
    const actor = String(event?.actor || '').toLowerCase();
    const type = String(event?.type || '').toLowerCase();
    return actor === 'buyer' || type.includes('msg_in');
  }).map(event => String(event?.body || '')).join(' ');
  const signals: string[] = [];
  if (/\b\d[\d,]*(?:\.\d+)?\s*(?:pcs?|pieces?|units?|sets?|bottles?|boxes?|cartons?)\b/i.test(buyerText)
    && /\b(?:how many|what quantity|which quantity|target quantity|quantity do you)\b/i.test(candidate)) signals.push('quantity');
  if (/\b(?:dubai|uae|saudi arabia|qatar|kuwait|oman|bahrain|usa|uk|germany|france|spain|italy|mexico|brazil|indonesia)\b/i.test(buyerText)
    && /\b(?:which|what) (?:market|country)|where (?:are|will) you (?:sell|selling)\b/i.test(candidate)) signals.push('market');
  if (/\b(?:black|white|navy|beige|red|blue|green)\b/i.test(buyerText)
    && /\b(?:which|what) colo(?:u)?r|colo(?:u)?r do you\b/i.test(candidate)) signals.push('color');
  if (/\bsize\s+[a-z0-9-]+\b/i.test(buyerText)
    && /\b(?:which|what) size|size do you\b/i.test(candidate)) signals.push('size');
  if (/\b(?:within|in)\s+\d+\s+days?|\bby\s+[a-z]+\s+\d{1,2}\b/i.test(buyerText)
    && /\b(?:when|what deadline|target date|launch date|how soon)\b/i.test(candidate)) signals.push('deadline');
  return signals;
}

function anchorMatches(candidate: string, latestMessage: string): number {
  const anchors = latestMessage.match(/\b(?:\d[\d,]*(?:\.\d+)?(?:\s*[a-z]+)?|dubai|uae|saudi arabia|qatar|kuwait|oman|bahrain|usa|uk|germany|france|spain|italy|mexico|brazil|indonesia|black|white|navy|beige|red|blue|green|size\s+[a-z0-9-]+)\b/gi) ?? [];
  const lower = candidate.toLowerCase();
  return Array.from(new Set(anchors.map(anchor => anchor.toLowerCase()))).filter(anchor => lower.includes(anchor)).length;
}

export function rankReplyCandidates(candidates: ReplyCandidate[], input: {
  latestMessage: string;
  timeline?: ReplyPlanInput['timeline'];
  plan: ReplyPlan;
}): RankedReplyCandidate[] {
  const previousSellerMessages = sellerMessages(input.timeline);
  const latestUnits = countUnits(input.latestMessage);
  return candidates.map(candidate => {
    const reasons: string[] = [];
    let score = 100;
    const units = countUnits(candidate.text);
    const questions = (candidate.text.match(/[?？]/g) ?? []).length;
    const delivery = planMobileChatMessages(candidate.text);
    if (MARKDOWN_RE.test(candidate.text)) { score -= 55; reasons.push('structured_format'); }
    if (FORMAL_SERVICE_RE.test(candidate.text)) { score -= 28; reasons.push('formal_service_language'); }
    if (INTERNAL_LANGUAGE_RE.test(candidate.text)) { score -= 100; reasons.push('internal_language'); }
    if (delivery.truncated) { score -= 70; reasons.push('mobile_overflow'); }
    if (questions > 1) { score -= (questions - 1) * 24; reasons.push('too_many_questions'); }
    if (input.plan.phase === 'ongoing' && GREETING_RE.test(candidate.text)) { score -= 45; reasons.push('repeated_greeting'); }
    if (latestUnits <= 8 && units > 36) { score -= Math.min(35, units - 30); reasons.push('too_long_for_quick_message'); }
    if (latestUnits >= 45 && units < 7) { score -= 10; reasons.push('too_brief_for_detailed_message'); }
    if (units > 75) { score -= Math.min(35, units - 70); reasons.push('wall_of_text'); }
    const repeatedDetails = knownQuestionRepetitions(candidate.text, input.timeline);
    if (repeatedDetails.length) { score -= repeatedDetails.length * 35; reasons.push(`reasks_${repeatedDetails.join('_')}`); }
    const maxSimilarity = previousSellerMessages.reduce((max, previous) => Math.max(max, semanticTextSimilarity(candidate.text, previous)), 0);
    if (maxSimilarity >= 0.45) {
      score -= Math.round(maxSimilarity * 45);
      reasons.push('recent_wording_repetition');
    }
    const anchors = anchorMatches(candidate.text, input.latestMessage);
    if (anchors) { score += Math.min(12, anchors * 4); reasons.push('uses_buyer_detail'); }
    const emojiCount = (candidate.text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
    if (emojiCount > 1 || (input.plan.emoji === 'none' && emojiCount > 0)) { score -= 18; reasons.push('emoji_mismatch'); }
    if (candidate.style === 'direct' && (input.plan.buyerState === 'urgent' || input.plan.buyerState === 'price_sensitive')) score += 4;
    if (candidate.style === 'warm' && (input.plan.buyerState === 'frustrated' || input.plan.buyerState === 'skeptical')) score += 4;
    return { ...candidate, score, reasons };
  }).sort((left, right) => right.score - left.score || left.text.length - right.text.length);
}
