import { Router, type Request, type Response } from 'express';
import { ensureDevWhatsAppChannel } from '../lib/channelsStore.js';
import { processWebhookPayload } from '../lib/waInbound.js';
import { requireIdentity } from '../lib/requestAuth.js';
import { store } from '../storage/index.js';

export const devSimRouter = Router();

function waPayload(input: {
  wa_id: string;
  name?: string;
  text: string;
  referral?: Record<string, unknown>;
  timestamp?: string | number;
  wamid?: string;
}) {
  const ts = input.timestamp
    ? String(Math.floor(new Date(input.timestamp).getTime() / 1000))
    : String(Math.floor(Date.now() / 1000));
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'dev_waba',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550000000', phone_number_id: 'dev_phone_number' },
          contacts: [{ profile: { name: input.name || input.wa_id }, wa_id: input.wa_id }],
          messages: [{
            from: input.wa_id,
            id: input.wamid || `wamid.dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: ts,
            type: 'text',
            text: { body: input.text },
            ...(input.referral ? { referral: input.referral } : {}),
          }],
        },
      }],
    }],
  };
}

function statusPayload(input: { wamid: string; status: string; timestamp?: string | number }) {
  const ts = input.timestamp
    ? String(Math.floor(new Date(input.timestamp).getTime() / 1000))
    : String(Math.floor(Date.now() / 1000));
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          statuses: [{ id: input.wamid, status: input.status, timestamp: ts, recipient_id: 'dev' }],
        },
      }],
    }],
  };
}

async function identityChannel(req: Request, res: Response) {
  const identity = await requireIdentity(req, res);
  if (!identity) return null;
  return { identity, channel: ensureDevWhatsAppChannel(identity.tenantId) };
}

devSimRouter.post('/wa/inbound', async (req: Request, res: Response) => {
  const ctx = await identityChannel(req, res);
  if (!ctx) return;
  const payload = waPayload({
    wa_id: String(req.body.wa_id || req.body.waId || '966500000001'),
    name: req.body.name,
    text: String(req.body.text || ''),
    referral: req.body.referral,
    timestamp: req.body.timestamp,
  });
  const result = await processWebhookPayload(ctx.channel.id, payload, { tenantId: ctx.identity.tenantId });
  res.json({ ok: true, channelId: ctx.channel.id, result });
});

devSimRouter.post('/wa/status', async (req: Request, res: Response) => {
  const ctx = await identityChannel(req, res);
  if (!ctx) return;
  const payload = statusPayload({
    wamid: String(req.body.wamid || ''),
    status: String(req.body.status || 'read'),
    timestamp: req.body.timestamp,
  });
  const result = await processWebhookPayload(ctx.channel.id, payload, { tenantId: ctx.identity.tenantId });
  res.json({ ok: true, result });
});

devSimRouter.post('/wa/seed', async (req: Request, res: Response) => {
  const ctx = await identityChannel(req, res);
  if (!ctx) return;
  const now = Date.now();
  const referral = (headline: string, sourceId: string) => ({
    source_type: 'ad',
    source_id: sourceId,
    source_url: `https://instagram.com/p/${sourceId}`,
    ctwa_clid: `ctwa_${sourceId}`,
    headline,
  });
  const scripts = [
    { wa_id: '966501111111', name: 'Ahmed Al-Rashid', text: 'Can we talk with your manager today? I need 500 pcs custom hair wigs. What is your best price and delivery time?', referral: referral('Saudi wig wholesale reel', 'ig_001'), timestamp: now - 10 * 60 * 1000 },
    { wa_id: '971502222222', name: 'Fatima Hassan', text: 'أريد طلب 1000 مجموعة من صناديق الصابون. ما هو أفضل سعر؟ Need logo package before Ramadan.', referral: referral('Gift soap box ad', 'fb_002'), timestamp: now - 45 * 60 * 1000 },
    { wa_id: '553333333333', name: 'Maria Santos', text: 'Me interesa el parche de moxibustión, 200 piezas. ¿Cuál es el precio unitario? Can I get sample first?', referral: referral('Moxa patch video', 'tt_003'), timestamp: now - 70 * 60 * 1000 },
    { wa_id: '14085554444', name: 'John Thompson', text: 'Curated selection sounds great. Standard shipping is fine. Please arrange the sample box order.', referral: referral('Yiwu sample box', 'yt_004'), timestamp: now - 3 * 60 * 60 * 1000 },
    { wa_id: '966505555555', name: 'Khalid Mohammed', text: 'Hi, we bought straight hair before. Do you have new brown straight hair catalog and old customer price?', referral: referral('Brown straight hair new arrivals', 'ig_005'), timestamp: now - 68 * 24 * 60 * 60 * 1000 },
    { wa_id: '84966666666', name: 'Nguyen Van A', text: 'Hi, interested in wholesale hair accessories. What collections do you have?', referral: referral('Hair accessory bio link', 'ig_006'), timestamp: now - 24 * 60 * 60 * 1000 },
  ];
  for (const waId of scripts.map(item => item.wa_id)) {
    const existing = await store.list<any>('customers', { where: { tenantId: ctx.identity.tenantId, wa_id: waId }, perPage: 20 });
    for (const customer of existing.items) {
      const [events, messages, insights] = await Promise.all([
        store.list<any>('timeline_events', { where: { tenantId: ctx.identity.tenantId, customer: customer.id }, perPage: 200 }),
        store.list<any>('wa_messages', { where: { tenantId: ctx.identity.tenantId, customerId: customer.id }, perPage: 200 }),
        store.list<any>('customer_insights', { where: { customer: customer.id }, perPage: 20 }),
      ]);
      for (const event of events.items) await store.delete('timeline_events', event.id);
      for (const message of messages.items) await store.delete('wa_messages', message.id);
      for (const insight of insights.items) await store.delete('customer_insights', insight.id);
      await store.delete('customers', customer.id);
    }
  }
  for (const item of scripts) {
    await processWebhookPayload(ctx.channel.id, waPayload(item), { tenantId: ctx.identity.tenantId });
  }
  const list = await store.list<any>('customers', { where: { tenantId: ctx.identity.tenantId }, perPage: 200 });
  const byWaId = new Map(list.items.map(customer => [customer.wa_id, customer]));
  const patch = async (waId: string, data: Record<string, unknown>, note?: string) => {
    const customer = byWaId.get(waId);
    if (!customer) return;
    await store.update('customers', customer.id, data);
    if (note) {
      await store.create('timeline_events', {
        tenantId: ctx.identity.tenantId,
        customer: customer.id,
        type: 'note',
        actor: 'ai',
        title: '演示状态校准',
        body: note,
        ref: '',
        status: '',
        ts: new Date().toISOString(),
      });
    }
  };
  await patch('966501111111', { stage: '询盘中', sop_step: '问需求', automation: 'manual', inboxReason: 'call', priority: 100, estimatedValue: '≥$1,000', tags: ['大单', 'OEM', '想通电话'] });
  await patch('971502222222', { stage: '已报价', sop_step: '报价', automation: 'confirm', inboxReason: 'large', priority: 91, estimatedValue: '≥$1,000', tags: ['已报价', '大单预警', '阿语'] }, '已给初步报价，等待确认 LOGO 和包装方案。');
  await patch('553333333333', { stage: '潜客', sop_step: '问需求', automation: 'confirm', inboxReason: 'draft', priority: 74, estimatedValue: '$380', tags: ['样品', '西语', '可培育'] });
  await patch('14085554444', { stage: '成交', sop_step: '履约', automation: 'confirm', inboxReason: '', priority: 45, estimatedValue: '$120', orderHistory: ['2026-07 样品盒 $120'], tags: ['已下单', '样品', '待寄样'] }, '创建寄样跟进任务，2 个工作日内发送单号。');
  await patch('966505555555', { stage: '沉默60', sop_step: '复购唤醒', automation: 'confirm', inboxReason: 'reply', priority: 70, estimatedValue: '$3,600', orderHistory: ['2026-03 直发批量单 $3,600', '2025-12 补货 $1,900'], tags: ['高价值老客', '沉默60', '新品可唤醒'] }, '进入沉默60状态，建议触达新品目录和老客价。');
  await patch('84966666666', { stage: '潜客', sop_step: '首响', automation: 'auto', inboxReason: 'reply', priority: 30, estimatedValue: '$260', tags: ['低分潜客', '自动回复', '目录'] });
  res.json({ ok: true, inserted: scripts.length, channelId: ctx.channel.id });
});
