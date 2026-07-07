import { Router, type Request, type Response } from 'express';
import { requireIdentity } from '../lib/requestAuth.js';
import { isWithinCustomerServiceWindow, resendPending, sendMessage, windowClosesAt } from '../lib/waOutbound.js';
import { store } from '../storage/index.js';
import type { CustomerInsightRecord, CustomerRecord, TimelineEventRecord } from '../lib/waTypes.js';
import { generateSalesDraft } from '../prompts/salesPrompts.js';

export const customersRouter = Router();

type CustomerView = 'inbox' | 'leads' | 'won' | 'silent';

function viewFilter(customer: CustomerRecord, view: CustomerView): boolean {
  if (view === 'inbox') return Boolean(customer.inboxReason);
  if (view === 'leads') return customer.stage === '潜客' || customer.stage === '询盘中' || customer.stage === '已报价';
  if (view === 'won') return customer.stage === '成交';
  return customer.stage === '沉默30' || customer.stage === '沉默60';
}

function sortCustomers(a: CustomerRecord, b: CustomerRecord, view: CustomerView): number {
  if (view === 'inbox') return Number(b.priority ?? 0) - Number(a.priority ?? 0);
  if (view === 'leads' || view === 'silent') return Number(b.priority ?? 0) - Number(a.priority ?? 0);
  return String(b.last_inbound_at ?? '').localeCompare(String(a.last_inbound_at ?? ''));
}

async function insightFor(customerId: string): Promise<CustomerInsightRecord | null> {
  const result = await store.list<CustomerInsightRecord>('customer_insights', { where: { customer: customerId }, perPage: 1 });
  return result.items[0] ?? null;
}

async function customerForTenant(id: string, tenantId: string): Promise<CustomerRecord | null> {
  const customer = await store.getById<CustomerRecord>('customers', id);
  if (!customer || customer.tenantId !== tenantId) return null;
  return customer;
}

customersRouter.get('/', async (req: Request, res: Response) => {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const view = String(req.query.view || 'inbox') as CustomerView;
  const list = await store.list<CustomerRecord>('customers', { where: { tenantId: identity.tenantId }, perPage: 200 });
  const insights = await store.list<CustomerInsightRecord>('customer_insights', { where: { tenantId: identity.tenantId }, perPage: 500 });
  const insightMap = new Map(insights.items.map(item => [item.customer, item]));
  const items = list.items
    .filter(customer => viewFilter(customer, view))
    .sort((a, b) => sortCustomers(a, b, view))
    .map(customer => ({ ...customer, insight: insightMap.get(customer.id) ?? null }));
  res.json({ items });
});

customersRouter.get('/:id', async (req: Request, res: Response) => {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const customer = await customerForTenant(req.params.id, identity.tenantId);
  if (!customer) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({
    customer,
    insight: await insightFor(customer.id),
    window: {
      open: isWithinCustomerServiceWindow(customer),
      closesAt: windowClosesAt(customer),
    },
  });
});

customersRouter.get('/:id/timeline', async (req: Request, res: Response) => {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const customer = await customerForTenant(req.params.id, identity.tenantId);
  if (!customer) { res.status(404).json({ error: 'not_found' }); return; }
  const events = await store.list<TimelineEventRecord>('timeline_events', {
    where: { tenantId: identity.tenantId, customer: customer.id },
    sort: 'ts',
    perPage: 200,
  });
  res.json({ items: events.items });
});

customersRouter.post('/:id/draft', async (req: Request, res: Response) => {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const customer = await customerForTenant(req.params.id, identity.tenantId);
  if (!customer) { res.status(404).json({ error: 'not_found' }); return; }
  const insight = await insightFor(customer.id);
  const draft = await generateSalesDraft(customer, insight);
  if (draft.reply_text || draft.should_escalate) {
    await store.create('timeline_events', {
      tenantId: identity.tenantId,
      customer: customer.id,
      type: 'ai',
      actor: 'ai',
      title: draft.should_escalate ? 'AI 草稿已暂停' : 'AI 草稿待确认',
      body: draft.should_escalate ? `原因：${draft.reason || '需要人工确认'}` : draft.reply_text,
      ref: '',
      status: draft.should_escalate ? 'escalated' : 'ai_draft',
      ts: new Date().toISOString(),
    });
  }
  res.json({ draft });
});

customersRouter.post('/:id/reply', async (req: Request, res: Response) => {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const customer = await customerForTenant(req.params.id, identity.tenantId);
  if (!customer) { res.status(404).json({ error: 'not_found' }); return; }
  const type = req.body.type === 'template' ? 'template' : 'text';
  const result = await sendMessage(
    customer.channelId || '',
    customer.wa_id,
    {
      type,
      body: String(req.body.body || ''),
      aiDraft: req.body.aiDraft ? String(req.body.aiDraft) : undefined,
      templateName: req.body.templateName,
      languageCode: req.body.languageCode,
      components: req.body.components,
    },
    { customer },
  );
  if (!result.ok) {
    res.status(result.error === 'window_closed' ? 409 : 400).json(result);
    return;
  }
  res.json(result);
});

customersRouter.post('/:id/resend-pending', async (req: Request, res: Response) => {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const customer = await customerForTenant(req.params.id, identity.tenantId);
  if (!customer) { res.status(404).json({ error: 'not_found' }); return; }
  res.json(await resendPending(customer));
});

customersRouter.patch('/:id', async (req: Request, res: Response) => {
  const identity = await requireIdentity(req, res);
  if (!identity) return;
  const customer = await customerForTenant(req.params.id, identity.tenantId);
  if (!customer) { res.status(404).json({ error: 'not_found' }); return; }
  const allowed = ['stage', 'sop_step', 'automation', 'owner', 'next_step', 'first_source'];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in req.body) patch[key] = req.body[key];
  }
  const ok = await store.update('customers', customer.id, patch);
  if (ok) {
    await store.create('timeline_events', {
      tenantId: identity.tenantId,
      customer: customer.id,
      type: 'note',
      actor: 'owner',
      title: '客户信息更新',
      body: Object.keys(patch).join('、') || '更新客户信息',
      ref: '',
      status: '',
      ts: new Date().toISOString(),
    });
  }
  res.json({ ok });
});
