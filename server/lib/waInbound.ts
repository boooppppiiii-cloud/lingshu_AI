import { store } from '../storage/index.js';
import { refreshCustomerInsight } from './waInsights.js';
import type { CustomerRecord, ParsedWaMessage, WaMessageRecord } from './waTypes.js';

type WaPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<Record<string, any>>;
        statuses?: Array<Record<string, any>>;
      };
    }>;
  }>;
};

function isoFromWaTimestamp(ts: unknown): string {
  const n = Number(ts);
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toISOString();
  return new Date().toISOString();
}

function messageBody(message: Record<string, any>): { body: string; mediaId?: string } {
  if (message.type === 'text') return { body: String(message.text?.body ?? '') };
  if (message.type === 'button') return { body: String(message.button?.text ?? message.button?.payload ?? '') };
  if (message.type === 'interactive') {
    const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
    return { body: String(reply?.title ?? reply?.id ?? '') };
  }
  if (message.type === 'image') return { body: String(message.image?.caption ?? '[图片]'), mediaId: message.image?.id };
  if (message.type === 'video') return { body: String(message.video?.caption ?? '[视频]'), mediaId: message.video?.id };
  if (message.type === 'audio') return { body: '[语音]', mediaId: message.audio?.id };
  if (message.type === 'document') return { body: String(message.document?.caption ?? message.document?.filename ?? '[文档]'), mediaId: message.document?.id };
  if (message.type === 'location') return { body: `[位置] ${message.location?.name ?? ''} ${message.location?.address ?? ''}`.trim() };
  if (message.type === 'contacts') return { body: '[联系人]' };
  return { body: `[${message.type ?? 'unknown'}]` };
}

export function parseWebhookPayload(payload: WaPayload): { messages: ParsedWaMessage[]; statuses: Array<{ id: string; status: string; ts: string }> } {
  const messages: ParsedWaMessage[] = [];
  const statuses: Array<{ id: string; status: string; ts: string }> = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const contactsByWaId = new Map((value.contacts ?? []).map(contact => [contact.wa_id, contact.profile?.name ?? '']));
      for (const message of value.messages ?? []) {
        const waId = String(message.from ?? '');
        if (!waId || !message.id) continue;
        const body = messageBody(message);
        messages.push({
          wamid: String(message.id),
          wa_id: waId,
          profileName: contactsByWaId.get(waId) || '',
          type: String(message.type ?? 'unknown'),
          body: body.body,
          mediaId: body.mediaId,
          referral: message.referral ?? null,
          context: message.context ?? null,
          ts: isoFromWaTimestamp(message.timestamp),
        });
      }
      for (const status of value.statuses ?? []) {
        if (!status.id) continue;
        statuses.push({ id: String(status.id), status: String(status.status ?? ''), ts: isoFromWaTimestamp(status.timestamp) });
      }
    }
  }
  return { messages, statuses };
}

async function findCustomer(tenantId: string, waId: string): Promise<CustomerRecord | null> {
  const existing = await store.list<CustomerRecord>('customers', { where: { tenantId, wa_id: waId }, perPage: 1 });
  return existing.items[0] ?? null;
}

async function upsertCustomer(input: { tenantId: string; channelId: string; message: ParsedWaMessage }): Promise<CustomerRecord> {
  const existing = await findCustomer(input.tenantId, input.message.wa_id);
  if (existing) {
    await store.update('customers', existing.id, {
      profile_name: input.message.profileName || existing.profile_name || input.message.wa_id,
      channelId: input.channelId,
      last_inbound_at: input.message.ts,
      lastActiveLabel: '刚刚',
    });
    return { ...existing, channelId: input.channelId, profile_name: input.message.profileName || existing.profile_name, last_inbound_at: input.message.ts };
  }
  const created = await store.create<CustomerRecord>('customers', {
    tenantId: input.tenantId,
    wa_id: input.message.wa_id,
    profile_name: input.message.profileName || input.message.wa_id,
    phone: input.message.wa_id,
    channelId: input.channelId,
    first_source: input.message.referral ?? null,
    last_inbound_at: input.message.ts,
    stage: '潜客',
    sop_step: '首响',
    automation: 'confirm',
    owner: '',
    next_step: 'AI 初筛中',
    tags: [],
    orderHistory: [],
    inboxReason: 'reply',
    priority: 50,
    estimatedValue: '',
    lastActiveLabel: '刚刚',
  });
  if (created) return created;
  const afterConflict = await findCustomer(input.tenantId, input.message.wa_id);
  if (afterConflict) return afterConflict;
  throw new Error('customer upsert failed');
}

async function messageExists(wamid: string): Promise<boolean> {
  const existing = await store.list<WaMessageRecord>('wa_messages', { where: { wamid }, perPage: 1 });
  return Boolean(existing.items[0]);
}

export async function processWebhookPayload(channelId: string, payload: WaPayload, opts: { tenantId?: string } = {}): Promise<{ messages: number; statuses: number }> {
  const tenantId = opts.tenantId || 'local_tenant_default';
  const parsed = parseWebhookPayload(payload);
  for (const status of parsed.statuses) {
    const existing = await store.list<WaMessageRecord>('wa_messages', { where: { wamid: status.id }, perPage: 1 });
    const msg = existing.items[0];
    if (!msg) continue;
    await store.update('wa_messages', msg.id, { status: status.status, ts: msg.ts });
    if (status.status === 'read' && msg.customerId) {
      await store.create('timeline_events', {
        tenantId: msg.tenantId,
        customer: msg.customerId,
        type: 'message',
        actor: 'seller',
        title: '消息已读',
        body: '客户已读系统发送的消息。',
        ref: msg.wamid,
        status: 'read',
        ts: status.ts,
      });
    }
  }

  for (const message of parsed.messages) {
    if (await messageExists(message.wamid)) continue;
    const customer = await upsertCustomer({ tenantId, channelId, message });
    await store.create('wa_messages', {
      tenantId,
      channelId,
      customerId: customer.id,
      wamid: message.wamid,
      wa_id: message.wa_id,
      direction: 'in',
      type: message.type,
      body: message.body,
      media_id: message.mediaId ?? '',
      media_url: '',
      referral: message.referral ?? null,
      context: message.context ?? null,
      status: 'received',
      ts: message.ts,
    });
    await store.create('timeline_events', {
      tenantId,
      customer: customer.id,
      type: 'message',
      actor: 'buyer',
      title: '客户消息',
      body: message.body,
      ref: message.wamid,
      status: 'received',
      ts: message.ts,
    });
    await refreshCustomerInsight(customer, message.body);
  }
  return { messages: parsed.messages.length, statuses: parsed.statuses.length };
}
