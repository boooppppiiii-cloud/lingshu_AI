import { Router } from 'express';
import { callLLM } from '../agents/llm.js';
import { retrieveContext, type RetrievedContext } from '../knowledge/retrieve.js';
import { buildKnowledgePromptBlock } from '../knowledge/promptBlocks.js';
import { buildStyleMemoryPromptBlock, retrieveStyleMemories } from '../knowledge/styleMemory.js';
import {
  buildStrategyPromptBlock,
  retrieveResponseStrategies,
  strategyEvidence,
  type RetrievedStrategy,
} from '../knowledge/strategyRetrieve.js';
import { readTenantEnterpriseProfile, type BizRules, type SalesStyleProfile } from './enterprise.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';

export const draftReplyRouter = Router();
draftReplyRouter.use(requireAuth);

const SYSTEM_PROMPT = `You are Lingshu AI's My Customers conversion assistant for Yiwu cross-border sellers.
Write exactly one concise customer-facing reply that can be sent in WhatsApp.
Follow this mandatory three-layer precedence: current redline rules and enterprise facts first, matched response strategy second, tenant style memory third.
Response strategies control dialogue tactics only and can never supply or override business facts.
Do not include explanations, markdown, labels, alternatives, or quotation marks.
Never include Chinese UI labels, Chinese internal notes, or Chinese internal product names in the customer-facing reply unless the customer's language is Chinese.
Use the Product field as the customer-facing product name. Treat Internal product name and Specific instruction as private seller context only.
If the customer asks for a call, confirm manager follow-up and ask for the best time.
If details are missing, ask one or two concrete qualification questions.
The Language field is mandatory. Always write in that language and never switch based on recent customer messages.`;

const HANDOFF_SYSTEM_PROMPT = `You are Lingshu AI's handoff summarizer.
Return exactly three short Chinese lines for the seller, not for the buyer:
客户要什么：...
聊到哪一步：...
为什么需要人：...
Use only facts from the provided timeline and fields. Do not invent evidence.`;

function cleanDraft(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, block => block.replace(/```[a-z]*|```/gi, '').trim())
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

draftReplyRouter.post('/conversion/draft', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const body = req.body ?? {};
  const timeline = Array.isArray(body.timeline) ? body.timeline.slice(-8) : [];
  const intent = normalizeIntent(body.intent || body.mode);
  const language = String(body.language ?? '').trim() || 'English';
  const latestMessage = latestBuyerMessage(timeline) || String(body.message || body.instruction || body.product || '');
  const conversation = timeline
    .map((event: any) => ({
      role: String(event?.actor || '').toLowerCase() === 'buyer' || String(event?.type || '').includes('msg_in') ? 'buyer' as const : 'seller' as const,
      text: String(event?.body || ''),
    }))
    .filter((event: { text: string }) => event.text.trim());
  const context = await retrieveContext(tenantId, {
    id: String(body.customerId ?? ''),
    name: String(body.customerName ?? ''),
    language,
    stage: String(body.stage ?? ''),
    product: String(body.product ?? ''),
  }, latestMessage, { conversation });
  const strategies = await retrieveResponseStrategies(tenantId, {
    latestMessage,
    conversation,
    stage: String(body.stage ?? ''),
    intent,
  });
  const styleMemories = await retrieveStyleMemories(tenantId, categoryForIntent(intent), latestMessage);
  const salesStyleProfile = (await readTenantEnterpriseProfile(tenantId)).salesStyleProfile;
  const suppressPrice = shouldSuppressPriceFromRules(context.bizRules);
  const hardNoPriceDigits = context.bizRules?.quoteMode === 'human_only';
  const prompt = [
    `Customer ID: ${String(body.customerId ?? '')}`,
    `Product: ${String(body.product ?? '')}`,
    body.internalProduct ? `Internal product name: ${String(body.internalProduct)}` : '',
    `Language: ${language}`,
    `Hard language rule: 回复语言必须为 ${language}，禁止依据客户消息语种自行切换。`,
    `Stage: ${String(body.stage ?? '')}`,
    `Intent: ${intent}`,
    body.mode ? `Mode: ${String(body.mode)}` : '',
    intentInstruction(intent),
    buildKnowledgePromptBlock(context),
    buildStrategyPromptBlock(strategies),
    buildSalesStyleProfilePromptBlock(salesStyleProfile),
    buildStyleMemoryPromptBlock(styleMemories),
    suppressPrice ? 'Price guard: do not include concrete prices. If the buyer asks how much, say the seller will confirm after checking quantity, specs, and packaging.' : '',
    hardNoPriceDigits ? 'Extra hard rule: the reply must not contain any Arabic numerals, currency symbols, unit prices, discount numbers, or exact amounts.' : '',
    body.instruction ? `Specific instruction: ${String(body.instruction)}` : '',
    'Recent timeline:',
    timeline.map((event: any) => {
      const actor = String(event?.actor ?? 'unknown');
      const type = String(event?.type ?? 'message');
      const text = String(event?.body ?? '');
      return `- ${actor}/${type}: ${text}`;
    }).join('\n'),
    '',
    intent === 'handoff_summary'
      ? 'Return exactly three short Chinese lines for internal handoff only.'
      : intent === 'polish'
      ? 'Return only the polished seller reply. Keep it customer-facing and do not add explanations.'
      : 'Return one directly-sendable reply only.',
  ].filter(Boolean).join('\n');

  try {
    const raw = await callLLM(prompt, { systemPrompt: intent === 'handoff_summary' ? HANDOFF_SYSTEM_PROMPT : SYSTEM_PROMPT });
    const draft = cleanDraft(raw);
    const sanitized = sanitizeDraft(draft || fallbackDraft(body, intent, suppressPrice), body, intent, suppressPrice, hardNoPriceDigits);
    const verification = await verifyGeneratedDraft({
      draft: sanitized,
      latestMessage,
      timeline,
      context,
      strategies,
      language,
      intent,
      sellerInstruction: String(body.instruction || ''),
      fallback: () => sanitizeDraft(fallbackDraft(body, intent, suppressPrice), body, intent, suppressPrice, hardNoPriceDigits),
    });
    const finalDraft = sanitizeDraft(verification.draft, body, intent, suppressPrice, hardNoPriceDigits);
    const finalVerification: DraftVerification = finalDraft === verification.draft
      ? verification
      : { draft: finalDraft, status: 'safe_fallback', issues: [...verification.issues, '报价规则拦截了未经允许的价格内容'] };
    res.json({
      draft: finalVerification.draft,
      evidence: [...context.evidence, ...strategyEvidence(strategies), verificationEvidence(finalVerification)],
      products: context.products,
      knowledgeMiss: context.knowledgeMiss,
      missReason: context.missReason,
      sentiment: context.sentiment,
      category: categoryForIntent(intent),
      styleMemoryUsed: styleMemories.length,
      strategies: strategies.map(match => ({
        id: match.strategy.id,
        scenario: match.strategy.scenario,
        confidence: match.confidence,
        reason: match.reason,
      })),
      verification: { status: finalVerification.status, issues: finalVerification.issues },
    });
  } catch (error) {
    res.json({
      draft: sanitizeDraft(fallbackDraft(body, intent, suppressPrice), body, intent, suppressPrice, hardNoPriceDigits),
      evidence: [...context.evidence, ...strategyEvidence(strategies)],
      products: context.products,
      knowledgeMiss: context.knowledgeMiss,
      missReason: context.missReason,
      sentiment: context.sentiment,
      category: categoryForIntent(intent),
      styleMemoryUsed: styleMemories.length,
      strategies: strategies.map(match => ({
        id: match.strategy.id,
        scenario: match.strategy.scenario,
        confidence: match.confidence,
        reason: match.reason,
      })),
      verification: { status: 'safe_fallback', issues: ['生成服务不可用，已使用不含具体业务事实的安全回复'] },
    });
  }
});

type DraftIntent = ReturnType<typeof normalizeIntent>;
type VerificationStatus = 'verified' | 'revised' | 'review_required' | 'safe_fallback';

interface DraftVerification {
  draft: string;
  status: VerificationStatus;
  issues: string[];
}

function parseVerification(raw: string): { verdict: 'pass' | 'revise' | 'handoff'; revisedReply: string; issues: string[] } | null {
  const match = raw.replace(/```json|```/gi, '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const verdict = parsed.verdict === 'pass' || parsed.verdict === 'revise' || parsed.verdict === 'handoff' ? parsed.verdict : null;
    if (!verdict) return null;
    return {
      verdict,
      revisedReply: cleanDraft(String(parsed.revisedReply || '')),
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String).filter(Boolean).slice(0, 6) : [],
    };
  } catch {
    return null;
  }
}

function unsupportedNumbers(draft: string, source: string): string[] {
  const values = draft.match(/\b\d+(?:[.,]\d+)?\b/g) ?? [];
  return Array.from(new Set(values.filter(value => !source.includes(value))));
}

async function verifyGeneratedDraft(input: {
  draft: string;
  latestMessage: string;
  timeline: any[];
  context: RetrievedContext;
  strategies: RetrievedStrategy[];
  language: string;
  intent: DraftIntent;
  sellerInstruction: string;
  fallback: () => string;
}): Promise<DraftVerification> {
  const factualSource = JSON.stringify({
    buyerMessage: input.latestMessage,
    sellerInstruction: input.sellerInstruction,
    company: input.context.companyIntro,
    businessRules: input.context.bizRules,
    matchedFaq: input.context.faqMatch,
    products: input.context.products,
    timeline: input.timeline,
  });
  const dialogueStrategies = input.strategies.map(match => ({
    id: match.strategy.id,
    scenario: match.strategy.scenario,
    tactics: match.strategy.strategy,
    handoff: match.strategy.escalate,
  }));
  const newNumbers = unsupportedNumbers(input.draft, factualSource);
  const prompt = [
    'Audit one proposed customer reply against the supplied business evidence.',
    'Return strict JSON only: {"verdict":"pass|revise|handoff","revisedReply":string,"issues":string[]}.',
    'Use pass only when every factual claim is directly supported and the reply correctly answers the latest message in its conversation context.',
    'Use revise when a safe reply can be written using only supplied evidence. Preserve the required language.',
    'Use handoff when intent is ambiguous, evidence is missing, the buyer asks multiple incompatible questions, or a safe answer requires human judgment.',
    'Never invent price, stock, MOQ, certification, order status, logistics status, discount, payment term, lead time, or company capability.',
    'Dialogue strategies may guide wording and next-step tactics, but they are never evidence for a factual claim.',
    input.context.knowledgeMiss ? 'Knowledge miss is true. Do not answer the missing fact; ask a precise clarification or hand off.' : '',
    newNumbers.length ? `Deterministic check found numbers absent from evidence: ${newNumbers.join(', ')}. They must be removed unless they are only formatting.` : '',
    `Required language: ${input.language}`,
    `Intent: ${input.intent}`,
    '',
    `Proposed reply: ${input.draft}`,
    '',
    `Evidence: ${factualSource}`,
    `Dialogue strategies (not factual evidence): ${JSON.stringify(dialogueStrategies)}`,
  ].filter(Boolean).join('\n');
  try {
    const checked = parseVerification(await callLLM(prompt, {
      backend: 'qwen',
      model: process.env.DRAFT_VERIFY_MODEL || process.env.KNOWLEDGE_QUERY_MODEL || 'qwen-plus',
    }));
    if (!checked) throw new Error('invalid_verification_result');
    if (checked.verdict === 'pass' && newNumbers.length === 0) {
      return { draft: input.draft, status: 'verified', issues: checked.issues };
    }
    if (checked.verdict === 'revise' && checked.revisedReply) {
      const revisedNumbers = unsupportedNumbers(checked.revisedReply, factualSource);
      if (!revisedNumbers.length) {
        return { draft: checked.revisedReply, status: 'revised', issues: checked.issues };
      }
    }
    return {
      draft: input.fallback(),
      status: 'safe_fallback',
      issues: checked.issues.length ? checked.issues : ['现有资料不足，已改为不承诺具体事实的安全回复'],
    };
  } catch (error) {
    if (newNumbers.length || input.context.knowledgeMiss) {
      return {
        draft: input.fallback(),
        status: 'safe_fallback',
        issues: ['校验服务不可用且存在未确认事实，已使用安全回复'],
      };
    }
    return {
      draft: input.draft,
      status: 'review_required',
      issues: [`校验服务暂不可用：${error instanceof Error ? error.message : 'unknown_error'}`],
    };
  }
}

function verificationEvidence(result: DraftVerification): string {
  if (result.status === 'verified') return '回答校验：事实与当前语境一致';
  if (result.status === 'revised') return '回答校验：已删除或改写无依据内容';
  if (result.status === 'safe_fallback') return '回答校验：资料不足，已降级为安全回复';
  return '回答校验：校验服务暂不可用，当前草稿仍需人工确认';
}

function latestBuyerMessage(timeline: any[]): string {
  const latest = [...timeline].reverse().find(event => String(event?.actor || '').toLowerCase() === 'buyer' || String(event?.type || '').includes('msg_in'));
  return String(latest?.body || '');
}

function buildSalesStyleProfilePromptBlock(profile?: SalesStyleProfile): string {
  if (!profile || profile.learnedFromCount < 20) return '';
  const lines = [
    `Sales style profile learned from ${profile.learnedFromCount} real seller replies:`,
    profile.greeting_style?.value ? `Greeting style: ${profile.greeting_style.value} (evidence: ${profile.greeting_style.evidence || 'n/a'})` : '',
    profile.quoting_stance?.value ? `Quoting stance: ${profile.quoting_stance.value} (evidence: ${profile.quoting_stance.evidence || 'n/a'})` : '',
    profile.followup_rhythm?.value ? `Follow-up rhythm: ${profile.followup_rhythm.value} (evidence: ${profile.followup_rhythm.evidence || 'n/a'})` : '',
    profile.taboo_phrases?.value?.length ? `Taboo phrases: never use these phrases unless the seller explicitly types them: ${profile.taboo_phrases.value.join(' / ')}. Evidence: ${profile.taboo_phrases.evidence || 'n/a'}` : '',
    'Use this profile for wording style only. Current retrieveContext knowledge always overrides old facts, prices, MOQ, lead time, and inventory.',
  ].filter(Boolean);
  return lines.length > 2 ? lines.join('\n') : '';
}

function shouldSuppressPriceFromRules(rules: BizRules): boolean {
  const ready = Boolean(rules?.quoteMode && rules.samplePolicy && rules.paymentTerms);
  return !ready || rules.quoteMode === 'human_only';
}

function normalizeIntent(value: unknown): 'reply'|'opener'|'followup'|'reactivate'|'post_call'|'polish'|'handoff_summary' {
  const v = String(value || '').trim();
  if (['opener', 'followup', 'reactivate', 'post_call', 'polish', 'handoff_summary'].includes(v)) return v as any;
  return 'reply';
}

function categoryForIntent(intent: ReturnType<typeof normalizeIntent>): string {
  if (intent === 'opener') return '寒暄';
  if (intent === 'followup') return '跟进';
  if (intent === 'reactivate') return '唤醒';
  if (intent === 'post_call') return '通话跟进';
  if (intent === 'polish') return '润色';
  if (intent === 'handoff_summary') return '转人工';
  return '报价';
}

function intentInstruction(intent: ReturnType<typeof normalizeIntent>): string {
  if (intent === 'opener') return 'Intent instruction: Write a warm opener with a short self-introduction and a product hook. Ask one easy qualification question.';
  if (intent === 'followup') return 'Intent instruction: Write a light follow-up that gently moves the deal forward without pressure. Mention the prior quote or product context.';
  if (intent === 'reactivate') return 'Intent instruction: Write a reactivation message for an old customer. Refer to past order or interest when available and offer a useful update.';
  if (intent === 'post_call') return 'Intent instruction: Write a follow-up based on the latest call event. Use any call result or note in the timeline, and propose the next concrete step.';
  if (intent === 'polish') return 'Intent instruction: Polish the seller draft. Keep the same meaning, make it more natural, concise, and customer-facing.';
  if (intent === 'handoff_summary') return 'Intent instruction: Summarize handoff context in Chinese, three lines: what the customer wants, where the conversation stands, why a human is needed.';
  return 'Intent instruction: Reply to the latest customer message naturally and helpfully.';
}

function sanitizeDraft(
  draft: string,
  body: any,
  intent: ReturnType<typeof normalizeIntent>,
  suppressPrice: boolean,
  hardNoPriceDigits: boolean,
): string {
  if (!suppressPrice) return draft;
  if (hardNoPriceDigits && /[0-9$¥€£]/.test(draft)) return noPriceFallback(body, intent);
  if (containsPriceNumber(draft)) return noPriceFallback(body, intent);
  return draft;
}

function containsPriceNumber(value: string): boolean {
  return /[$¥€£]\s*\d|\b\d+(?:[.,]\d+)?\s*(?:usd|rmb|cny|dollars?|yuan|元|美元|美金|price|per|\/|%|折|off)\b/i.test(value);
}

function noPriceFallback(body: any, intent: ReturnType<typeof normalizeIntent>): string {
  const product = String(body.product ?? 'the product');
  if (intent === 'handoff_summary') {
    return [
      `客户要什么：正在确认 ${product} 的采购细节。`,
      '聊到哪一步：客户需要卖家继续推进。',
      '为什么需要人：涉及报价或业务规则，需要人工确认。',
    ].join('\n');
  }
  const language = normalizeLanguage(body.language);
  if (language === 'arabic') {
    return `شكرا لرسالتك. سأراجع الكمية والمواصفات والتغليف المطلوب ثم أطلب من الزميل المسؤول تأكيد العرض المناسب لك قريبا.`;
  }
  if (language === 'spanish') {
    return `Gracias por tu mensaje. Voy a revisar la cantidad, las especificaciones y el empaque, y nuestro equipo confirmará la oferta adecuada para ti.`;
  }
  return `Thanks for your message. I will check the quantity, specifications, and packaging requirements, then our team will confirm the right offer for you.`;
}

function fallbackDraft(body: any, intent: ReturnType<typeof normalizeIntent>, suppressPrice = false): string {
  if (suppressPrice && intent !== 'handoff_summary') return noPriceFallback(body, intent);
  const product = String(body.product ?? 'the product');
  if (intent === 'handoff_summary') {
    return [
      `客户要什么：正在确认 ${product} 的采购细节。`,
      '聊到哪一步：最近一轮消息需要卖家继续推进。',
      '为什么需要人：涉及价格、交期、条款或高意向判断，需要人工确认。',
    ].join('\n');
  }
  const language = normalizeLanguage(body.language);
  if (language === 'arabic') {
    if (intent === 'opener') return `مرحبًا، نحن فريق المبيعات. يمكننا دعم توريد ${product} بالجملة. ما الكمية والسوق المستهدف؟`;
    if (intent === 'followup') return `أتابع معك بخصوص ${product}. إذا كانت الكمية أو متطلبات التغليف واضحة، يمكنني تأكيد أفضل سعر ومدة التسليم لك.`;
    if (intent === 'reactivate') return `مرحبًا، حدّثنا مؤخرًا خيارات ${product}. إذا كنت لا تزال مهتمًا، يمكنني إرسال أحدث الكتالوج والعرض لك.`;
    if (intent === 'post_call') return `شكرًا على المكالمة. سأتابع التفاصيل التي ناقشناها وأرسل لك الخطوة التالية قريبًا.`;
    return `شكرًا لرسالتك. سأؤكد لك الحد الأدنى للطلب وأفضل سعر ومدة التسليم لـ ${product}، ثم أرسل التفاصيل قريبًا.`;
  }
  if (language === 'spanish') {
    if (intent === 'opener') return `Hola, somos el equipo de ventas. Podemos apoyar suministro mayorista de ${product}. ¿Cuál es tu cantidad objetivo y mercado?`;
    if (intent === 'followup') return `Te escribo para dar seguimiento a ${product}. Si la cantidad o el empaque ya están claros, puedo confirmar el mejor precio y el tiempo de entrega.`;
    if (intent === 'reactivate') return `Hola, actualizamos recientemente nuestras opciones de ${product}. Si todavía te interesa, puedo enviarte el catálogo y la oferta más reciente.`;
    if (intent === 'post_call') return `Gracias por la llamada. Daré seguimiento a los detalles que conversamos y te enviaré el siguiente paso pronto.`;
    return `Gracias por tu mensaje. Voy a confirmar el MOQ, el mejor precio y el tiempo de entrega de ${product}, y te enviaré los detalles pronto.`;
  }
  if (intent === 'opener') return `Hi, this is our sales team. We can support wholesale supply for ${product}. May I know your target quantity and market?`;
  if (intent === 'followup') return `Just following up on ${product}. If the quantity or packaging requirements are clear, I can confirm the best price and delivery time for you.`;
  if (intent === 'reactivate') return `Hi, we recently updated our options for ${product}. If you are still interested, I can send the latest catalog and wholesale offer for your review.`;
  if (intent === 'post_call') return `Thanks for the call. I will follow up on the details we discussed and send you the next step shortly.`;
  return `Thanks for your message. I will confirm the MOQ, best price, and delivery time for ${product}, then send you the details shortly.`;
}

function normalizeLanguage(value: unknown): 'arabic' | 'spanish' | 'english' {
  const language = String(value || '').toLowerCase();
  if (language.includes('阿语') || language.includes('arabic')) return 'arabic';
  if (language.includes('西语') || language.includes('spanish') || language.includes('español')) return 'spanish';
  return 'english';
}
