import { sendWhatsAppText, sendWhatsAppTemplate } from '../integrations/whatsapp.js';
import { store } from '../storage/index.js';
import { getChannelById, touchChannel } from './channelsStore.js';
import type { CustomerRecord, WaMessageRecord } from './waTypes.js';

export function isWithinCustomerServiceWindow(customer: CustomerRecord, now = new Date()): boolean {
  const last = customer.last_inbound_at ? Date.parse(customer.last_inbound_at) : 0;
  if (!last) return false;
  return now.getTime() - last < 24 * 60 * 60 * 1000;
}

export function windowClosesAt(customer: CustomerRecord): string | null {
  const last = customer.last_inbound_at ? Date.parse(customer.last_inbound_at) : 0;
  if (!last) return null;
  return new Date(last + 24 * 60 * 60 * 1000).toISOString();
}

export async function sendMessage(
  channelId: string,
  waId: string,
  payload: { type: 'text' | 'template'; body?: string; aiDraft?: string; templateName?: string; languageCode?: string; components?: object[] },
  opts: { customer: CustomerRecord },
): Promise<{ ok: true; status: string; message: WaMessageRecord } | { ok: false; error: string; windowClosesAt?: string | null }> {
  if (payload.type === 'text' && !isWithinCustomerServiceWindow(opts.customer)) {
    return { ok: false, error: 'window_closed', windowClosesAt: windowClosesAt(opts.customer) };
  }
  const channel = getChannelById(channelId);
  if (!channel || channel.type !== 'whatsapp') return { ok: false, error: 'channel_not_found' };
  const now = new Date().toISOString();
  const localWamid = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const hasCredentials = Boolean(channel.config.phoneNumberId && channel.config.accessToken);
  const body = payload.type === 'text' ? (payload.body ?? '') : `[模板] ${payload.templateName ?? ''}`;
  const initialStatus = hasCredentials ? 'sent' : 'pending_credentials';

  const created = await store.create<WaMessageRecord>('wa_messages', {
    tenantId: opts.customer.tenantId,
    channelId,
    customerId: opts.customer.id,
    wamid: localWamid,
    wa_id: waId,
    direction: 'out',
    type: payload.type,
    body,
    ai_draft: payload.aiDraft || '',
    media_id: '',
    media_url: '',
    referral: null,
    context: null,
    status: initialStatus,
    ts: now,
  });
  if (!created) return { ok: false, error: 'message_create_failed' };

  await store.create('timeline_events', {
    tenantId: opts.customer.tenantId,
    customer: opts.customer.id,
    type: 'message',
    actor: 'seller',
    title: initialStatus === 'pending_credentials' ? '待发送（凭证未配置）' : '已发送',
    body,
    ref: localWamid,
    status: initialStatus,
    ts: now,
  });

  if (!hasCredentials) return { ok: true, status: initialStatus, message: created };

  try {
    if (payload.type === 'template') {
      await sendWhatsAppTemplate(
        channel.config as any,
        waId,
        payload.templateName ?? '',
        payload.languageCode ?? 'en_US',
        payload.components ?? [],
      );
    } else {
      await sendWhatsAppText(channel.config as any, waId, payload.body ?? '');
    }
    touchChannel(channelId, { stats: { ...channel.stats, sent: channel.stats.sent + 1 } });
    return { ok: true, status: initialStatus, message: created };
  } catch (err) {
    await store.update('wa_messages', created.id, { status: 'failed' });
    await store.create('timeline_events', {
      tenantId: opts.customer.tenantId,
      customer: opts.customer.id,
      type: 'message',
      actor: 'ai',
      title: '发送失败',
      body: err instanceof Error ? err.message : 'WhatsApp 发送失败',
      ref: localWamid,
      status: 'failed',
      ts: new Date().toISOString(),
    });
    return { ok: false, error: err instanceof Error ? err.message : 'send_failed' };
  }
}

export async function resendPending(customer: CustomerRecord): Promise<{ resent: number; skipped: number }> {
  const messages = await store.list<WaMessageRecord>('wa_messages', {
    where: { tenantId: customer.tenantId, customerId: customer.id, direction: 'out', status: 'pending_credentials' },
    perPage: 100,
  });
  let resent = 0;
  let skipped = 0;
  for (const message of messages.items) {
    const result = await sendMessage(message.channelId, message.wa_id, { type: 'text', body: message.body ?? '' }, { customer });
    if (result.ok && result.status !== 'pending_credentials') {
      await store.update('wa_messages', message.id, { status: 'sent' });
      resent += 1;
    } else {
      skipped += 1;
    }
  }
  return { resent, skipped };
}
