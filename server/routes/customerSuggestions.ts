import { Router } from 'express';
import { callLLM } from '../agents/llm.js';
import { isDemoMode } from '../lib/demo.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { retrieveContext } from '../knowledge/retrieve.js';
import { buildKnowledgePromptBlock } from '../knowledge/promptBlocks.js';
import { buildStrategyPromptBlock, retrieveResponseStrategies, strategyEvidence } from '../knowledge/strategyRetrieve.js';
import { aggregateKnowledgeMisses } from '../knowledge/misses.js';
import { recordStyleMemory } from '../knowledge/styleMemory.js';
import { confirmCustomerSourceAttribution, getNightModeMorningBriefing, getWhatsAppCustomers, getWhatsAppImportStatus, markWhatsAppHumanReply } from '../whatsapp/historyImport.js';
import { sendTenantWhatsAppTemplate, sendTenantWhatsAppText } from '../whatsapp/send.js';

export const customerSuggestionsRouter = Router();
customerSuggestionsRouter.use(requireAuth);

const manualActiveUntil = new Map<string, number>();

const MESSAGE_TEMPLATES = [
  {
    name: 'greeting_opener',
    label: '问候开场',
    status: process.env.WHATSAPP_TEMPLATE_STATUS || 'pending',
    body: 'Hi {{1}}, this is {{2}}. We can support wholesale supply for {{3}}. May I know your target quantity?',
  },
  {
    name: 'product_update',
    label: '新品通知',
    status: process.env.WHATSAPP_TEMPLATE_STATUS || 'pending',
    body: 'Hi {{1}}, we recently updated {{2}}. I can send you the latest catalog and wholesale offer.',
  },
  {
    name: 'order_followup',
    label: '订单跟进',
    status: process.env.WHATSAPP_TEMPLATE_STATUS || 'pending',
    body: 'Hi {{1}}, following up on your {{2}} order. We can confirm {{3}} for you today.',
  },
] as const;

function isTemplateApproved(templateName: string) {
  return MESSAGE_TEMPLATES.some(template => template.name === templateName && template.status === 'approved');
}

function renderTemplate(templateName: string, variables: string[]) {
  const template = MESSAGE_TEMPLATES.find(item => item.name === templateName);
  if (!template) return '';
  return template.body.replace(/\{\{(\d+)}}/g, (_, index) => variables[Number(index) - 1] || '');
}

async function maybeRecordStyleMemory(req: any, tenantId: string, customerId: string, finalBody: string) {
  const memory = req.body?.styleMemory;
  if (!memory || typeof memory !== 'object') return;
  await recordStyleMemory({
    tenantId,
    customerId,
    triggerMessage: String(memory.triggerMessage || ''),
    draftOriginal: String(memory.draftOriginal || ''),
    finalSent: String(memory.finalSent || finalBody || ''),
    edited: Boolean(memory.edited),
    category: String(memory.category || 'reply'),
    strategyIds: Array.isArray(memory.strategyIds) ? memory.strategyIds.map(String) : [],
  }).catch(error => console.warn('[style-memory:record-failed]', error));
}

customerSuggestionsRouter.get('/', requireAuth, (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const source = String(req.query.source || '');
  if (source && source !== 'whatsapp') {
    res.json({ items: [], source });
    return;
  }
  res.json({ items: getWhatsAppCustomers(tenantId), source: 'whatsapp', importStatus: getWhatsAppImportStatus() });
});

customerSuggestionsRouter.get('/whatsapp/import-status', (_req, res) => {
  res.json(getWhatsAppImportStatus());
});

customerSuggestionsRouter.get('/templates', (_req, res) => {
  res.json({ items: MESSAGE_TEMPLATES });
});

customerSuggestionsRouter.get('/knowledge-misses/briefing', async (_req, res) => {
  const items = await aggregateKnowledgeMisses(7);
  res.json({ items });
});

customerSuggestionsRouter.get('/night-mode/briefing', requireAuth, (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.json({ item: getNightModeMorningBriefing(tenantId) });
});

customerSuggestionsRouter.post('/knowledge-misses/recompute', async (_req, res) => {
  const items = await aggregateKnowledgeMisses(7);
  res.json({ ok: true, items });
});

customerSuggestionsRouter.post('/:id/manual-active', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const customerId = String(req.params.id || '');
  if (!customerId) {
    res.status(400).json({ error: 'customer_id_required' });
    return;
  }
  const minutes = Math.max(1, Math.min(30, Number(req.body?.minutes || 10) || 10));
  const until = Date.now() + minutes * 60_000;
  manualActiveUntil.set(`${tenantId}:${customerId}`, until);
  res.json({ ok: true, suspendedUntil: new Date(until).toISOString() });
});

customerSuggestionsRouter.post('/:id/source-attribution', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const customerId = String(req.params.id || '');
  const postId = String(req.body?.postId || '');
  if (!customerId || !postId) {
    res.status(400).json({ error: 'customer_id_and_post_id_required' });
    return;
  }
  const customer = await confirmCustomerSourceAttribution({ tenantId, customerId, postId });
  if (!customer) {
    res.status(404).json({ error: 'attribution_candidate_not_found' });
    return;
  }
  res.json({
    ok: true,
    source: customer.source,
    sourcePostId: customer.sourcePostId,
    sourceTrackCode: customer.sourceTrackCode,
    sourcePostTitle: customer.sourcePostTitle,
    sourcePostPlatform: customer.sourcePostPlatform,
  });
});

customerSuggestionsRouter.post('/:id/outbox', requireAuth, async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const customerId = String(req.params.id || '');
  const body = String(req.body?.body || '').trim();
  const mode = String(req.body?.mode || 'free_text');
  const to = String(req.body?.to || '').trim();
  if (!customerId || !body) {
    res.status(400).json({ error: 'customer_id_and_body_required' });
    return;
  }
  if (isDemoMode()) {
    res.json({
      ok: true,
      source: 'demo',
      outboxId: `${mode === 'template' ? 'tpl' : 'out'}_${Date.now()}`,
      status: 'sent',
      sentAt: new Date().toISOString(),
      renderedBody: body,
    });
    return;
  }
  if (!to) {
    res.status(400).json({ error: 'whatsapp_recipient_required', message: 'WhatsApp recipient is missing.' });
    return;
  }
  if (mode === 'free_text' && req.body?.outsideWindow) {
    res.status(409).json({ error: 'whatsapp_template_required', message: '距客户上次消息已超过24小时，请使用模板消息发送。' });
    return;
  }
  if (mode === 'template') {
    const templateName = String(req.body?.templateName || '').trim();
    const variables = Array.isArray(req.body?.variables) ? req.body.variables.map((item: unknown) => String(item || '')) : [];
    if (!isTemplateApproved(templateName)) {
      res.status(409).json({ error: 'template_pending', message: '消息模板审核中，暂时不能发送超窗触达。' });
      return;
    }
    try {
      await sendTenantWhatsAppTemplate({
        tenantId,
        to,
        templateName,
        variables,
        languageCode: String(req.body?.languageCode || 'en_US'),
      });
    } catch (error) {
      res.status(502).json({
        error: 'whatsapp_send_failed',
        message: error instanceof Error ? error.message : 'WhatsApp send failed',
      });
      return;
    }
    const renderedBody = renderTemplate(templateName, variables) || body;
    markWhatsAppHumanReply({ tenantId, customerId, body: renderedBody, waNumber: to });
    await maybeRecordStyleMemory(req, tenantId, customerId, renderedBody);
    res.json({
      ok: true,
      outboxId: `tpl_${Date.now()}`,
      status: 'sent',
      sentAt: new Date().toISOString(),
      renderedBody,
    });
    return;
  }
  const suspendedUntil = manualActiveUntil.get(`${tenantId}:${customerId}`) || 0;
  if (req.body?.auto === true && suspendedUntil > Date.now()) {
    res.status(409).json({ error: 'manual_active', message: '人工正在回复，AI 自动发送已挂起，只生成草稿。' });
    return;
  }
  try {
    await sendTenantWhatsAppText(tenantId, to, body);
  } catch (error) {
    res.status(502).json({
      error: 'whatsapp_send_failed',
      message: error instanceof Error ? error.message : 'WhatsApp send failed',
    });
    return;
  }
  markWhatsAppHumanReply({ tenantId, customerId, body, waNumber: to });
  await maybeRecordStyleMemory(req, tenantId, customerId, body);
  res.json({
    ok: true,
    outboxId: `out_${Date.now()}`,
    status: 'sent',
    sentAt: new Date().toISOString(),
  });
});

interface CustomerHint {
  name: string;
  stage: string;
  intentScore: number;
  product: string;
  timeline: string[];
}

const SYSTEM_PROMPT = `你是灵枢 AI「我的客户」里的转化助手。
请返回 2 到 3 条给中国商家看的主动建议。
每条建议一句话，动作明确，可以继续转成 WhatsApp 回复草稿。
不要写完整的客户回复，不要编号、Markdown 或解释。`;

customerSuggestionsRouter.get('/:id/suggestions', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const id = String(req.params.id ?? '');
  const customer = getWhatsAppCustomers(tenantId).find(item => item.id === id);
  if (!customer) {
    res.status(404).json({ items: [], error: 'customer_not_found' });
    return;
  }
  const customerTimeline = Array.isArray(customer.timeline) ? customer.timeline.slice(-8) : [];
  const hint: CustomerHint = {
    name: String(customer.name || customer.waNumber || '客户'),
    stage: String(customer.stage || 'inquiry'),
    intentScore: Number(customer.intentScore || 0),
    product: String(customer.outboundProduct || customer.product || ''),
    timeline: customerTimeline.map((item: any) => String(item.body || '')).filter(Boolean),
  };
  const fallback = fallbackSuggestions(hint);
  const conversation = customerTimeline.map((item: any) => ({
    role: item.actor === 'buyer' ? 'buyer' as const : 'seller' as const,
    text: String(item.body || ''),
  })).filter((item: { text: string }) => item.text);
  const latestMessage = [...conversation].reverse().find(item => item.role === 'buyer')?.text || hint.product || hint.stage;
  const context = await retrieveContext(tenantId, {
    id,
    name: hint.name,
    stage: hint.stage,
    product: hint.product,
  }, latestMessage, { conversation });
  const strategies = await retrieveResponseStrategies(tenantId, {
    latestMessage,
    conversation,
    stage: hint.stage,
    intent: 'suggestion',
  });

  const prompt = [
    `Customer: ${hint.name}`,
    `Stage: ${hint.stage}`,
    `Intent score: ${hint.intentScore}`,
    `Product: ${hint.product}`,
    'Recent timeline:',
    hint.timeline.map(item => `- ${item}`).join('\n'),
    '',
    buildKnowledgePromptBlock(context),
    buildStrategyPromptBlock(strategies),
    '',
    'Return only 2-3 short suggestions, one per line.',
  ].join('\n');

  try {
    const raw = await callLLM(prompt, { systemPrompt: SYSTEM_PROMPT });
    const items = parseSuggestions(raw);
    res.json({ items: items.length > 0 ? items : fallback, evidence: [...context.evidence, ...strategyEvidence(strategies)] });
  } catch {
    res.json({ items: fallback, evidence: [...context.evidence, ...strategyEvidence(strategies)] });
  }
});

function fallbackSuggestions(hint: CustomerHint): string[] {
  if (hint.stage === 'call_request') {
    return [
      `生成一条给 ${hint.name} 的通话承接回复，并询问方便通话的时间。`,
      `整理一份围绕 ${hint.product} 和采购数量的简短通话简报。`,
      '确认经理会亲自跟进，先把客户稳住。',
    ];
  }

  if (hint.stage === 'silent60' || hint.stage === 'silent30') {
    return [
      `给 ${hint.name} 写一条自然的老客唤醒消息，给对方一个回复理由。`,
      `围绕 ${hint.product} 推荐一个不催促的跟进角度。`,
      '询问客户是否还需要样品或新版目录。',
    ];
  }

  if (hint.intentScore >= 75) {
    return [
      `为 ${hint.product} 生成一条简洁的报价跟进。`,
      '用一条消息确认数量、目的港和包装偏好。',
      '把客户自然推进到样品确认，不要显得催促。',
    ];
  }

  return [
    `继续让 ${hint.name} 由 AI 自动接待，并补问一个客资问题。`,
    `发送一条轻量目录回复，围绕 ${hint.product} 引导客户说出需求。`,
    '先询问目标采购数量，再决定是否转人工跟进。',
  ];
}

function parseSuggestions(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*[-*0-9.)]+\s*/, '').trim())
    .map(line => line.replace(/^["'`]+|["'`]+$/g, '').trim())
    .filter(Boolean)
    .slice(0, 3);
}
