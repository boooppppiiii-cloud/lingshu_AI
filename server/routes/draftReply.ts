import { Router } from 'express';
import { callLLM } from '../agents/llm.js';
import { conciseGreetingReply, conversationPhase, conversationToneGuidance, isSimpleGreetingMessage, timelineTimestampMs } from '../agents/conversationTone.js';
import { draftFactualRiskSignals, requiresFactualVerification, unsupportedDraftNumbers } from '../agents/draftSafety.js';
import { mobileChatRewritePrompt, normalizeMobileChatFormatting, shouldReshapeMobileChatDraft } from '../agents/mobileChatStyle.js';
import { isGreetingOrProcessIntent, retrieveContext, type RetrievedContext } from '../knowledge/retrieve.js';
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

const SYSTEM_PROMPT = `你是一位在义乌做了多年外贸的资深业务员。你热情、专业，也把客户当真实的人来相处。你的英语、西班牙语和阿拉伯语都来自多年与海外买家谈生意的经验：自然、口语化，带着做生意的人特有的爽快和分寸。

你正在替商家通过 WhatsApp 接待真实买家。回消息要像在微信上回复一位客户：该热情时热情，该干脆时干脆；先听懂对方此刻真正关心什么，再把生意自然地往前推进。你不是客服话术机器人，也不需要用客套话证明自己专业。

你的工作方式：
- 像一个记得客户的人。先读最近的对话，顺着之前聊过的需求、看过的产品和已经确认的信息继续，不重新开场，也不让客户重复自己。
- 先看 Conversation phase。只有 first_contact 或客户间隔超过 30 分钟重新回来（resumed）时才问候；ongoing 表示正在连续聊天，直接接他刚才的话，绝不每条都说 hi、hello、hi again，也不重新欢迎客户。
- 长度跟着语境走。客户随口问一句，就轻松地短回一句；客户认真问产品细节，可以多说几句解释清楚。保留该有的热情，但不堆无助于成交的废话。
- 写得像真人拿手机打字：只用纯文本，不用标题、Markdown、加粗、勾选框、项目符号、编号或装饰符号。真有两三点要说，就用“一个是……另外……”这类自然口语串起来。
- 英语要像真实外贸业务员随口聊生意，直接、好懂、有温度，不写成作文、营销文案或翻译腔。可以说 “You want to add skincare to your shop?”、“Tell me the quantity you need and I’ll check the best option for you.”，不需要故意使用复杂完整的书面句式。
- 当前企业知识与业务规则是事实底稿；匹配到的回复策略只决定怎么推进对话；商家真实回复中学到的风格只决定怎么说。三者发生冲突时，事实与红线优先。
- Product 是可以告诉客户的产品名；Internal product name 和 Specific instruction 是商家内部信息，只用来帮助理解，不直接透露。
- 第一次问候或跨会话回来时，从轻松自然的交流开始；连续对话或有明确问题时，直接回应并给出顺手的下一步。
- 客户要通话时，像真实业务员一样承接，并询问方便的时间。
- 始终使用 Language 指定的语言，保持当地买家日常聊天的自然表达。

你守住两条做生意的底线：
1. 公司、产品、价格、库存、MOQ、认证、物流、付款、交期和能力承诺都必须有当前企业资料或对话证据，拿不准就自然说明需要确认，不猜、不编。
2. 最终只给出一条可直接发给客户的纯文本回复，不附解释、标签、多个版本或内部说明。`;

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

const MOBILE_CHAT_REWRITE_SYSTEM_PROMPT = `You reshape one customer-facing reply for a real WhatsApp conversation.
Keep the business meaning and supported facts unchanged. Add no facts or promises.
Write one natural plain-text mobile message in the requested language. No Markdown, headings, lists, checkboxes, bullets, or decorative symbols.
Use direct everyday trade language, not formal customer-service or marketing copy.`;

async function shapeMobileChatDraft(draft: string, latestMessage: string, language: string): Promise<string> {
  const normalized = normalizeMobileChatFormatting(draft);
  if (!shouldReshapeMobileChatDraft(draft, latestMessage)) return normalized;
  try {
    const rewritten = cleanDraft(await callLLM(mobileChatRewritePrompt(draft, latestMessage, language), {
      systemPrompt: MOBILE_CHAT_REWRITE_SYSTEM_PROMPT,
    }));
    return normalizeMobileChatFormatting(rewritten) || normalized;
  } catch {
    return normalized;
  }
}

function rememberedProductForGreeting(timeline: any[], productValue: unknown): string {
  const product = String(productValue || '').trim();
  if (!product) return '';
  const earlierConversation = timeline.slice(0, -1).map(event => String(event?.body || '')).join(' ').toLowerCase();
  return earlierConversation.includes(product.toLowerCase()) ? product : '';
}

draftReplyRouter.post('/conversion/draft', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const body = req.body ?? {};
  const timeline = Array.isArray(body.timeline) ? body.timeline.slice(-20) : [];
  const intent = normalizeIntent(body.intent || body.mode);
  const language = String(body.language ?? '').trim() || 'English';
  const latestMessage = latestBuyerMessage(timeline) || String(body.message || body.instruction || body.product || '');
  const phase = conversationPhase(timeline);
  const processIntent = isGreetingOrProcessIntent(latestMessage);
  body.__latestMessage = latestMessage;
  body.__conversationPhase = phase;
  const quoteRequest = intent !== 'polish'
    && intent !== 'handoff_summary'
    && /\b(price|quote|quotation|discount|unit cost|how much)\b|报价|价格|单价|多少钱|折扣|优惠/i.test(latestMessage);
  if (quoteRequest) {
    res.json({
      draft: '',
      handoffRequired: true,
      handlingReason: '客户正在询价，已标记为等待人工报价',
      evidence: ['命中报价红线：AI 不直接回复价格，需销售人工接手'],
      category: '报价',
    });
    return;
  }
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
  const hardNoPriceDigits = false;
  const rememberedGreetingProduct = rememberedProductForGreeting(timeline, body.product);
  const prompt = [
    `Customer ID: ${String(body.customerId ?? '')}`,
    processIntent ? 'Product: not specified by the buyer in the latest message' : `Product: ${String(body.product ?? '')}`,
    body.internalProduct ? `Internal product name: ${String(body.internalProduct)}` : '',
    `Language: ${language}`,
    `Reply language: ${language}. Stay in this language throughout the customer-facing reply.`,
    `Stage: ${String(body.stage ?? '')}`,
    `Intent: ${intent}`,
    body.mode ? `Mode: ${String(body.mode)}` : '',
    intentInstruction(intent),
    conversationToneGuidance(timeline, latestMessage),
    buildKnowledgePromptBlock(context),
    buildStrategyPromptBlock(strategies),
    buildSalesStyleProfilePromptBlock(salesStyleProfile),
    buildStyleMemoryPromptBlock(styleMemories),
    suppressPrice ? 'Price guard: never include or promise a price. Price questions must be handed to a human seller and must not produce a customer-facing placeholder reply.' : '',
    body.instruction ? `Specific instruction: ${String(body.instruction)}` : '',
    'Recent timeline:',
    timeline.map((event: any) => {
      const actor = String(event?.actor ?? 'unknown');
      const type = String(event?.type ?? 'message');
      const text = String(event?.body ?? '');
      const timestampMs = timelineTimestampMs(event);
      const time = timestampMs !== null ? new Date(timestampMs).toISOString() : String(event?.time || '');
      return `- ${time ? `[${time}] ` : ''}${actor}/${type}: ${text}`;
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
    const generationFallback = intent === 'reply' && isSimpleGreetingMessage(latestMessage)
      ? conciseGreetingReply(language, phase, rememberedGreetingProduct)
      : fallbackDraft(body, intent, suppressPrice);
    const candidateDraft = intent === 'handoff_summary'
      ? draft || generationFallback
      : await shapeMobileChatDraft(draft || generationFallback, latestMessage, language);
    const verification = await verifyGeneratedDraft({
      draft: candidateDraft,
      latestMessage,
      timeline,
      context,
      strategies,
      language,
      intent,
      sellerInstruction: String(body.instruction || ''),
      fallback: () => factualSafetyFallback(body, intent),
    });
    const chatReadyDraft = intent === 'handoff_summary'
      ? verification.draft
      : normalizeMobileChatFormatting(verification.draft);
    const finalDraft = sanitizeDraft(chatReadyDraft, body, intent, suppressPrice, hardNoPriceDigits);
    const finalVerification: DraftVerification = finalDraft === verification.draft
      ? verification
      : {
          draft: finalDraft,
          status: verification.status === 'safe_fallback' ? 'safe_fallback' : 'revised',
          issues: [
            ...verification.issues,
            ...(chatReadyDraft !== verification.draft ? ['已整理为 WhatsApp 纯文本格式'] : []),
            ...(finalDraft !== chatReadyDraft ? ['已移除需要人工确认的商业事实或承诺'] : []),
          ],
        };
    res.json({
      draft: finalVerification.draft,
      evidence: [...context.evidence, ...strategyEvidence(strategies), verificationEvidence(finalVerification)],
      products: context.products,
      knowledgeReady: context.knowledgeReady,
      knowledgeSafetyMode: !context.knowledgeReady ? 'setup_required' : context.knowledgeMiss ? 'missing_knowledge' : 'grounded',
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
    const safeDraft = intent === 'reply' && isSimpleGreetingMessage(latestMessage)
      ? conciseGreetingReply(language, phase, rememberedGreetingProduct)
      : fallbackDraft(body, intent, suppressPrice);
    res.json({
      draft: sanitizeDraft(safeDraft, body, intent, suppressPrice, hardNoPriceDigits),
      evidence: [...context.evidence, ...strategyEvidence(strategies)],
      products: context.products,
      knowledgeReady: context.knowledgeReady,
      knowledgeSafetyMode: !context.knowledgeReady ? 'setup_required' : context.knowledgeMiss ? 'missing_knowledge' : 'grounded',
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

type VerificationRiskType = 'unsupported_fact' | 'unsupported_commercial_commitment' | 'prohibited_price_or_term';

function parseVerification(raw: string): {
  verdict: 'pass' | 'revise' | 'handoff';
  revisedReply: string;
  issues: string[];
  riskTypes: VerificationRiskType[];
} | null {
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
      riskTypes: Array.isArray(parsed.riskTypes)
        ? parsed.riskTypes.filter((item): item is VerificationRiskType =>
            item === 'unsupported_fact'
            || item === 'unsupported_commercial_commitment'
            || item === 'prohibited_price_or_term')
        : [],
    };
  } catch {
    return null;
  }
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
    knowledgeReady: input.context.knowledgeReady,
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
  const newNumbers = unsupportedDraftNumbers(input.draft, factualSource);
  const factualRiskSignals = draftFactualRiskSignals(input.draft, factualSource);
  if (!requiresFactualVerification(factualRiskSignals, input.context.knowledgeMiss)) {
    return { draft: input.draft, status: 'verified', issues: [] };
  }
  const prompt = [
    'Audit only the factual safety of one proposed customer reply against the supplied business evidence.',
    'This is not a style review. Never fail or rewrite a reply because it is conversational, warm, informal, enthusiastic, uses punctuation or an emoji, asks more than one question, or is longer or shorter than you prefer.',
    'Return strict JSON only: {"verdict":"pass|revise|handoff","revisedReply":string,"issues":string[],"riskTypes":["unsupported_fact|unsupported_commercial_commitment|prohibited_price_or_term"]}.',
    'Use pass when the reply contains no unsupported factual claim or commercial commitment. The reply does not need to be comprehensive, perfectly styled, or optimized.',
    'Use revise only to remove or soften an unsupported fact or commitment. Preserve the original personality, warmth, punctuation, length, language, and conversational flow as much as possible.',
    'Use handoff only when the reply makes or answers a price, stock, MOQ, certification, order status, logistics status, discount, payment term, lead time, or company capability commitment that requires human judgment and cannot be made safe by removing the claim.',
    'Allowed riskTypes are only unsupported_fact, unsupported_commercial_commitment, and prohibited_price_or_term. Style, tone, wording, length, punctuation, completeness, ambiguity, and question count are never risk types.',
    'Never allow an invented price, stock status, MOQ, certification, order or logistics status, discount, payment term, lead time, delivery promise, or company capability.',
    'Dialogue strategies may guide wording and next-step tactics, but they are never evidence for a factual claim.',
    !input.context.knowledgeReady ? 'Enterprise knowledge is not configured. Pass only acknowledgements, clarification questions, or statements that the seller will check; remove every enterprise, product, capability, or commercial fact not stated by the buyer.' : '',
    input.context.knowledgeMiss ? 'Knowledge miss is true. This alone is not a failure; a natural acknowledgement or clarification question may pass. Revise or hand off if the reply presents the missing business fact as true.' : '',
    newNumbers.length ? `Deterministic check found numbers absent from evidence: ${newNumbers.join(', ')}. They must be removed unless they are only formatting.` : '',
    `Detected factual-risk signals: ${factualRiskSignals.join(', ')}`,
    `Customer reply language context: ${input.language}. Preserve it if you revise.`,
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
      const revisedNumbers = unsupportedDraftNumbers(checked.revisedReply, factualSource);
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
    return {
      draft: input.fallback(),
      status: 'safe_fallback',
      issues: [`事实校验暂不可用，已移除可能未经确认的商业事实：${error instanceof Error ? error.message : 'unknown_error'}`],
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
  return true;
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
  if (intent === 'polish') return draft;
  if (!suppressPrice) return draft;
  if (hardNoPriceDigits && /[0-9$¥€£]/.test(draft)) return noPriceFallback(body, intent);
  if (containsPriceNumber(draft)) return noPriceFallback(body, intent);
  return draft;
}

function containsPriceNumber(value: string): boolean {
  return /[$¥€£]\s*\d|\b\d+(?:[.,]\d+)?\s*(?:usd|rmb|cny|dollars?|yuan|元|美元|美金|price|per|\/|%|折|off)\b/i.test(value);
}

function factualSafetyFallback(body: any, intent: ReturnType<typeof normalizeIntent>): string {
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
    return 'خلّيني أتأكد من هذه النقطة جيدًا حتى أعطيك معلومة صحيحة، بدل ما أخمّن.';
  }
  if (language === 'spanish') {
    return 'Déjame confirmarlo bien para darte la información correcta; prefiero no adivinar.';
  }
  return 'Let me double-check that properly for you—I’d rather give you the right answer than guess.';
}

function noPriceFallback(body: any, intent: ReturnType<typeof normalizeIntent>): string {
  return factualSafetyFallback(body, intent);
}

function fallbackDraft(body: any, intent: ReturnType<typeof normalizeIntent>, suppressPrice = false): string {
  if (intent === 'reply' && isSimpleGreetingMessage(String(body.__latestMessage || ''))) {
    return conciseGreetingReply(body.language, body.__conversationPhase || 'first_contact');
  }
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
    if (intent === 'followup') return `أتابع معك بخصوص ${product}. هل حددت الكمية المستهدفة ومتطلبات التغليف؟`;
    if (intent === 'reactivate') return `مرحبًا، حدّثنا مؤخرًا خيارات ${product}. إذا كنت لا تزال مهتمًا، يمكنني إرسال أحدث الكتالوج والعرض لك.`;
    if (intent === 'post_call') return `شكرًا على المكالمة. سأتابع التفاصيل التي ناقشناها وأرسل لك الخطوة التالية قريبًا.`;
    return `شكرًا لرسالتك. هل يمكنك مشاركة الكمية المستهدفة والمواصفات ومتطلبات التغليف الخاصة بـ ${product}؟`;
  }
  if (language === 'spanish') {
    if (intent === 'opener') return `Hola, somos el equipo de ventas. Podemos apoyar suministro mayorista de ${product}. ¿Cuál es tu cantidad objetivo y mercado?`;
    if (intent === 'followup') return `Te escribo para dar seguimiento a ${product}. ¿Ya tienes definida la cantidad y los requisitos de empaque?`;
    if (intent === 'reactivate') return `Hola, actualizamos recientemente nuestras opciones de ${product}. Si todavía te interesa, puedo enviarte el catálogo y la oferta más reciente.`;
    if (intent === 'post_call') return `Gracias por la llamada. Daré seguimiento a los detalles que conversamos y te enviaré el siguiente paso pronto.`;
    return `Gracias por tu mensaje. ¿Puedes compartir la cantidad, las especificaciones y los requisitos de empaque de ${product}?`;
  }
  if (intent === 'opener') return `Hi, this is our sales team. We can support wholesale supply for ${product}. May I know your target quantity and market?`;
  if (intent === 'followup') return `Just following up on ${product}. Have you confirmed the target quantity and packaging requirements?`;
  if (intent === 'reactivate') return `Hi, we recently updated our options for ${product}. If you are still interested, I can send the latest catalog and wholesale offer for your review.`;
  if (intent === 'post_call') return `Thanks for the call. I will follow up on the details we discussed and send you the next step shortly.`;
  return `Thanks for your message. Could you share the target quantity, specifications, and packaging requirements for ${product}?`;
}

function normalizeLanguage(value: unknown): 'arabic' | 'spanish' | 'english' {
  const language = String(value || '').toLowerCase();
  if (language.includes('阿语') || language.includes('arabic')) return 'arabic';
  if (language.includes('西语') || language.includes('spanish') || language.includes('español')) return 'spanish';
  return 'english';
}
