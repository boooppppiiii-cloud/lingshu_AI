import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decideAction, type AutonomyLevel } from '../autonomy/actionRules.js';
import { guardOutbound } from '../autonomy/outboundGuard.js';
import { prioritizeCustomer } from '../autonomy/prioritize.js';
import { autoFaqReady, findApprovedFaqAnswer, readEnterpriseProfile } from '../routes/enterprise.js';
import { store } from '../storage/index.js';
import { sendTenantWhatsAppText } from './send.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'whatsapp-customers.json');
const INTERACTIONS_FILE = path.join(DATA_DIR, 'whatsapp-interactions.json');
const IMPORT_STATUS_FILE = path.join(DATA_DIR, 'whatsapp-import-status.json');
const ENTERPRISE_FILE = path.join(DATA_DIR, 'enterprise.json');

type HandlingMode = 'ai_auto' | 'ai_draft' | 'human_needed';
type CustomerStage = 'lead' | 'inquiry' | 'quoted' | 'won' | 'silent30' | 'silent60';

interface StoredInteraction {
  id: string;
  tenantId: string;
  customerId: string;
  waNumber: string;
  metaMessageId?: string;
  type: 'msg_in' | 'msg_out_human' | 'msg_out_ai' | 'system';
  body: string;
  timestamp: number;
  autoSent?: boolean;
  audit?: Record<string, unknown>;
}

interface StoredCustomer {
  id: string;
  tenantId: string;
  waNumber: string;
  name: string;
  language: string;
  stage: CustomerStage;
  handlingMode: HandlingMode;
  handlingReason: string;
  intentScore: number;
  lastActiveAt: number;
  createdAt: string;
  updatedAt: string;
  aiAutoCount?: number;
  blockedAutoReplyReason?: string;
  pendingDraft?: string;
}

interface ImportStatus {
  tenantId: string;
  status: 'idle' | 'importing' | 'done' | 'skipped';
  done: number;
  total: number;
  updatedAt: string;
  note?: string;
}

interface IncomingContact {
  waNumber: string;
  name?: string;
}

interface IncomingMessage {
  id: string;
  waNumber: string;
  name?: string;
  fromBusiness?: boolean;
  body: string;
  timestamp: number;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (error) {
    const backupFile = `${file}.bak`;
    if (fs.existsSync(backupFile)) {
      try {
        return JSON.parse(fs.readFileSync(backupFile, 'utf8')) as T;
      } catch { /* continue to corruption backup */ }
    }
    if (fs.existsSync(file)) {
      const corruptFile = `${file}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(file, corruptFile);
        console.error('[whatsapp-json-corrupt]', file, 'backed up to', corruptFile, error);
      } catch (copyError) {
        console.error('[whatsapp-json-corrupt]', file, copyError);
      }
    }
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, `${file}.bak`); } catch { /* best effort backup */ }
  }
  fs.renameSync(tmp, file);
}

function backupWhatsAppDataFiles(now = new Date()): void {
  const date = now.toISOString().slice(0, 10);
  const backupDir = path.join(DATA_DIR, 'backups', date);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const file of [CUSTOMERS_FILE, INTERACTIONS_FILE, IMPORT_STATUS_FILE, ENTERPRISE_FILE]) {
    if (!fs.existsSync(file)) continue;
    const target = path.join(backupDir, path.basename(file));
    if (fs.existsSync(target)) continue;
    try { fs.copyFileSync(file, target); } catch (error) { console.error('[whatsapp-daily-backup]', file, error); }
  }
}

async function mirrorCustomerToPocketBase(customer: StoredCustomer): Promise<void> {
  const payload = {
    tenant_id: customer.tenantId,
    customer_id: customer.id,
    wa_number: customer.waNumber,
    name: customer.name,
    stage: customer.stage,
    last_active_at: customer.lastActiveAt,
    payload: JSON.stringify(customer),
  };
  const existing = await store.list<{ id: string }>('whatsapp_customers', {
    where: { tenant_id: customer.tenantId, customer_id: customer.id },
    perPage: 1,
  });
  const id = existing.items[0]?.id;
  if (id) await store.update('whatsapp_customers', id, payload);
  else await store.create('whatsapp_customers', payload);
}

async function mirrorInteractionToPocketBase(interaction: StoredInteraction): Promise<void> {
  const payload = {
    tenant_id: interaction.tenantId,
    interaction_id: interaction.id,
    customer_id: interaction.customerId,
    wa_number: interaction.waNumber,
    timestamp: interaction.timestamp,
    payload: JSON.stringify(interaction),
  };
  const existing = await store.list<{ id: string }>('whatsapp_interactions', {
    where: { tenant_id: interaction.tenantId, interaction_id: interaction.id },
    perPage: 1,
  });
  const id = existing.items[0]?.id;
  if (id) await store.update('whatsapp_interactions', id, payload);
  else await store.create('whatsapp_interactions', payload);
}

function customers(): StoredCustomer[] {
  return readJson<StoredCustomer[]>(CUSTOMERS_FILE, []);
}

function writeCustomers(items: StoredCustomer[]): void {
  writeJson(CUSTOMERS_FILE, items);
}

function interactions(): StoredInteraction[] {
  return readJson<StoredInteraction[]>(INTERACTIONS_FILE, []);
}

function writeInteractions(items: StoredInteraction[]): void {
  writeJson(INTERACTIONS_FILE, items);
}

function importStatus(): ImportStatus {
  return readJson<ImportStatus>(IMPORT_STATUS_FILE, {
    tenantId: 'local',
    status: 'idle',
    done: 0,
    total: 0,
    updatedAt: new Date(0).toISOString(),
  });
}

function writeImportStatus(status: ImportStatus): void {
  writeJson(IMPORT_STATUS_FILE, status);
}

function autonomyLevel(): AutonomyLevel {
  const profile = readJson<any>(ENTERPRISE_FILE, {});
  const value = profile?.strategy?.aiAutonomy;
  return value === 'remind' || value === 'draft' || value === 'auto' ? value : 'draft';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timestamp(value: unknown): number {
  const raw = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(raw) && raw > 0) return raw < 10_000_000_000 ? raw * 1000 : raw;
  return Date.now();
}

function detectLanguage(body: string): string {
  if (/[\u0600-\u06ff]/.test(body)) return '\u963f\u8bed';
  if (/[áéíóúãõçñ¿¡]/i.test(body) || /\b(hola|gracias|precio|env[ií]o|cu[aá]nto|piezas)\b/i.test(body)) return '\u897f\u8bed';
  if (/\b(ol[aá]|obrigad[ao]|pre[cç]o|envio|quantidade)\b/i.test(body)) return '\u8461\u8bed';
  if (/[\u4e00-\u9fff]/.test(body)) return '\u4e2d\u6587';
  return '\u82f1\u8bed';
}

function stageByTimestamp(lastActiveAt: number): CustomerStage {
  const days = Math.floor((Date.now() - lastActiveAt) / 86_400_000);
  if (days <= 30) return 'inquiry';
  if (days <= 60) return 'silent30';
  return 'silent60';
}

export function recomputeWhatsAppCustomerStages(now = Date.now()): number {
  const list = customers();
  let changed = 0;
  const next = list.map(customer => {
    const stage = stageByTimestamp(customer.lastActiveAt || now);
    if (stage === customer.stage) return customer;
    changed += 1;
    return {
      ...customer,
      stage,
      handlingMode: stage === 'silent30' || stage === 'silent60' ? 'ai_draft' as HandlingMode : customer.handlingMode,
      handlingReason: stage === 'silent30' || stage === 'silent60'
        ? '\u5ba2\u6237\u5df2\u6c89\u9ed8\uff0cAI \u5df2\u51c6\u5907\u5524\u9192\u8ddf\u8fdb'
        : customer.handlingReason,
      updatedAt: new Date(now).toISOString(),
    };
  });
  if (changed > 0) writeCustomers(next);
  return changed;
}

export function initWhatsAppCustomerMaintenance(): void {
  const run = () => {
    try {
      backupWhatsAppDataFiles();
      const changed = recomputeWhatsAppCustomerStages();
      if (changed > 0) console.log(`[whatsapp-maintenance] recomputed ${changed} customer stages`);
    } catch (error) {
      console.error('[whatsapp-maintenance]', error);
    }
  };
  setTimeout(run, 30_000);
  setInterval(run, 24 * 60 * 60 * 1000);
}

function customerId(tenantId: string, waNumber: string): string {
  return `wa_${tenantId}_${waNumber}`.replace(/[^\w-]/g, '_');
}

function upsertCustomer(input: { tenantId: string; waNumber: string; name?: string; body?: string; lastActiveAt?: number; patch?: Partial<StoredCustomer> }): StoredCustomer {
  const list = customers();
  const id = customerId(input.tenantId, input.waNumber);
  const now = new Date().toISOString();
  const index = list.findIndex(item => item.id === id);
  const lastActiveAt = input.lastActiveAt ?? Date.now();
  const base: StoredCustomer = index >= 0 ? list[index] : {
    id,
    tenantId: input.tenantId,
    waNumber: input.waNumber,
    name: input.name || input.waNumber,
    language: detectLanguage(input.body || ''),
    stage: stageByTimestamp(lastActiveAt),
    handlingMode: 'ai_draft',
    handlingReason: 'WhatsApp 新询盘已进入待确认',
    intentScore: 45,
    lastActiveAt,
    createdAt: now,
    updatedAt: now,
    aiAutoCount: 0,
  };
  const next: StoredCustomer = {
    ...base,
    ...input.patch,
    name: input.name || base.name,
    language: base.language || detectLanguage(input.body || ''),
    stage: stageByTimestamp(lastActiveAt),
    lastActiveAt: Math.max(base.lastActiveAt, lastActiveAt),
    updatedAt: now,
  };
  if (index >= 0) list[index] = next;
  else list.push(next);
  writeCustomers(list);
  void mirrorCustomerToPocketBase(next).catch(error => console.error('[whatsapp-pb-customer]', error));
  return next;
}

function addInteraction(item: StoredInteraction): boolean {
  const list = interactions();
  const exists = item.metaMessageId
    ? list.some(existing => existing.tenantId === item.tenantId && existing.metaMessageId === item.metaMessageId)
    : list.some(existing => existing.id === item.id);
  if (exists) return false;
  list.push(item);
  list.sort((a, b) => a.timestamp - b.timestamp);
  writeInteractions(list);
  void mirrorInteractionToPocketBase(item).catch(error => console.error('[whatsapp-pb-interaction]', error));
  return true;
}

function collectChanges(payload: any): any[] {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  return entries.flatMap((entry: any) => Array.isArray(entry?.changes) ? entry.changes : []);
}

function contactFromMeta(raw: any): IncomingContact | null {
  const waNumber = text(raw?.wa_id || raw?.waNumber || raw?.phone_number || raw?.phone || raw?.id);
  if (!waNumber) return null;
  const name = text(raw?.profile?.name || raw?.name || raw?.first_name);
  return { waNumber, name };
}

function messagesFromValue(value: any): IncomingMessage[] {
  const contacts = new Map<string, string>();
  for (const raw of Array.isArray(value?.contacts) ? value.contacts : []) {
    const contact = contactFromMeta(raw);
    if (contact) contacts.set(contact.waNumber, contact.name || contact.waNumber);
  }

  const rawMessages = [
    ...(Array.isArray(value?.messages) ? value.messages : []),
    ...(Array.isArray(value?.history?.messages) ? value.history.messages : []),
    ...(Array.isArray(value?.history) ? value.history.flatMap((chunk: any) => Array.isArray(chunk?.messages) ? chunk.messages : []) : []),
  ];

  return rawMessages.map((message: any) => {
    const waNumber = text(message.from || message.to || message.wa_id || message.recipient_id);
    const media = message.audio || message.voice || message.image || message.video || message.document || message.sticker;
    const mediaType = message.audio || message.voice
      ? '\u8bed\u97f3\u6d88\u606f'
      : message.image
        ? '\u56fe\u7247\u6d88\u606f'
        : message.video
          ? '\u89c6\u9891\u6d88\u606f'
          : message.document
            ? '\u6587\u4ef6\u6d88\u606f'
            : message.sticker
              ? '\u8868\u60c5\u6d88\u606f'
              : '';
    const mediaId = text(media?.id);
    const mediaLink = mediaId ? `https://graph.facebook.com/v19.0/${mediaId}` : '';
    const body = text(message?.text?.body || message?.body || message?.message?.text)
      || (mediaType ? `[${mediaType}]${mediaLink ? ` ${mediaLink}` : ''}` : '');
    if (!waNumber || !body) return null;
    return {
      id: text(message.id) || `${waNumber}-${timestamp(message.timestamp)}`,
      waNumber,
      name: contacts.get(waNumber),
      fromBusiness: Boolean(message.from_me || message.direction === 'outbound' || message.from_business),
      body,
      timestamp: timestamp(message.timestamp),
    } as IncomingMessage;
  }).filter(Boolean) as IncomingMessage[];
}

function contactsFromValue(value: any): IncomingContact[] {
  const direct = Array.isArray(value?.contacts) ? value.contacts : [];
  const nested = Array.isArray(value?.smb_app_state_sync?.contacts) ? value.smb_app_state_sync.contacts : [];
  return [...direct, ...nested].map(contactFromMeta).filter(Boolean) as IncomingContact[];
}

function inferActionFromText(body: string): string {
  if (/\b(price|quote|quotation|discount|payment|deposit|delivery time|lead time)\b|报价|价格|付款|定金|交期|折扣/i.test(body)) return 'formal_quote';
  if (/\b(catalog|catalogue|brochure|collections?)\b|目录|产品册/i.test(body)) return 'auto_send_catalog';
  if (/\b(track|tracking|ship|shipping|logistics)\b|物流|运单|发货/i.test(body)) return 'auto_logistics_update';
  if (/\b(sample|after.?sale|warranty)\b|样品|售后|质保/i.test(body)) return 'auto_aftersale_confirm';
  return 'auto_faq_reply';
}

function draftForMessage(message: IncomingMessage): string {
  if (/\b(catalog|catalogue|brochure|collections?)\b|目录|产品册/i.test(message.body)) {
    return 'Thanks for your message. I can send our approved catalog for your review. Which product line and quantity are you interested in?';
  }
  if (/\b(track|tracking|ship|shipping|logistics)\b|物流|运单|发货/i.test(message.body)) {
    return 'Thanks for checking in. I will update the tracking status and share the latest logistics information with you.';
  }
  return 'Thanks for your message. I have received your request and will confirm the details with our team.';
}

async function handleInboundMessage(tenantId: string, message: IncomingMessage, options: { skipAutonomy?: boolean } = {}): Promise<void> {
  const customer = upsertCustomer({
    tenantId,
    waNumber: message.waNumber,
    name: message.name,
    body: message.body,
    lastActiveAt: message.timestamp,
  });
  addInteraction({
    id: `${customer.id}-${message.id}`,
    tenantId,
    customerId: customer.id,
    waNumber: message.waNumber,
    metaMessageId: message.id,
    type: message.fromBusiness ? 'msg_out_human' : 'msg_in',
    body: message.body,
    timestamp: message.timestamp,
  });
  if (message.fromBusiness || options.skipAutonomy) return;

  const profile = readEnterpriseProfile();
  let action = inferActionFromText(message.body);
  const autonomy = autonomyLevel();
  let draft = draftForMessage(message);
  let blockedAutoReplyReason = '';
  if (action === 'auto_faq_reply') {
    const approvedFaq = findApprovedFaqAnswer(profile, message.body);
    if (approvedFaq) {
      draft = approvedFaq.answer;
    } else {
      action = 'draft_greeting';
      blockedAutoReplyReason = autoFaqReady(profile)
        ? '未命中已审批常见问答，已降级为草稿'
        : '需要先录入并审批至少 5 条常见问答';
    }
  }
  const decision = decideAction(action, autonomy);

  if (decision.decision === 'auto') {
    const guard = await guardOutbound(draft, { tenantId, customerId: customer.id, action });
    if (guard.allowed) {
      try {
        await sendTenantWhatsAppText(tenantId, message.waNumber, draft);
      } catch (error) {
        addInteraction({
          id: `${customer.id}-send-failed-${Date.now()}`,
          tenantId,
          customerId: customer.id,
          waNumber: message.waNumber,
          type: 'system',
          body: `AI 自动回复发送失败，已降级为待确认草稿：${error instanceof Error ? error.message : 'WhatsApp send failed'}`,
          timestamp: Date.now(),
          audit: { action, risk: decision.rule.risk, autonomy, sendError: error instanceof Error ? error.message : String(error) },
        });
        upsertCustomer({
          tenantId,
          waNumber: message.waNumber,
          patch: {
            handlingMode: 'ai_draft',
            handlingReason: 'AI 自动回复未真正发出，需要你确认后重发',
            pendingDraft: draft,
            blockedAutoReplyReason: error instanceof Error ? error.message : 'WhatsApp send failed',
          },
        });
        return;
      }
      addInteraction({
        id: `${customer.id}-ai-${Date.now()}`,
        tenantId,
        customerId: customer.id,
        waNumber: message.waNumber,
        type: 'msg_out_ai',
        body: draft,
        timestamp: Date.now(),
        autoSent: true,
        audit: { action, risk: decision.rule.risk, autonomy },
      });
      upsertCustomer({
        tenantId,
        waNumber: message.waNumber,
        patch: {
          handlingMode: 'ai_auto',
          handlingReason: decision.rule.desc,
          aiAutoCount: (customer.aiAutoCount ?? 0) + 1,
          pendingDraft: undefined,
          blockedAutoReplyReason: undefined,
        },
      });
      return;
    }
    addInteraction({
      id: `${customer.id}-guard-${Date.now()}`,
      tenantId,
      customerId: customer.id,
      waNumber: message.waNumber,
      type: 'system',
      body: `AI 想回复但涉及 ${guard.matchedRule || 'L4'}，已降级为待确认草稿。`,
      timestamp: Date.now(),
      audit: { action, risk: decision.rule.risk, autonomy, guardRule: guard.matchedRule },
    });
    upsertCustomer({
      tenantId,
      waNumber: message.waNumber,
      patch: {
        handlingMode: 'ai_draft',
        handlingReason: `AI 想回复但涉及${guard.matchedRule || '红线'}，需要你确认`,
        pendingDraft: draft,
        blockedAutoReplyReason: guard.matchedRule || '红线',
      },
    });
    return;
  }

  upsertCustomer({
    tenantId,
    waNumber: message.waNumber,
    patch: {
      handlingMode: decision.decision === 'remind' ? 'human_needed' : 'ai_draft',
      handlingReason: decision.decision === 'remind' ? 'AI 已提醒你处理该客户' : `${decision.rule.desc}，AI 已生成草稿等待确认`,
      pendingDraft: decision.decision === 'draft' ? draft : undefined,
      blockedAutoReplyReason: blockedAutoReplyReason || undefined,
    },
  });
}

export async function handleMetaWebhook(tenantId: string, payload: any): Promise<void> {
  const changes = collectChanges(payload);
  for (const change of changes) {
    const field = text(change?.field);
    const value = change?.value ?? {};
    if (field === 'smb_app_state_sync') {
      for (const contact of contactsFromValue(value)) {
        upsertCustomer({ tenantId, waNumber: contact.waNumber, name: contact.name, patch: { handlingReason: '已从 WhatsApp Business App 同步联系人' } });
      }
    }
    if (field === 'history') {
      const messages = messagesFromValue(value);
      writeImportStatus({ tenantId, status: 'importing', done: 0, total: messages.length, updatedAt: new Date().toISOString() });
      let done = 0;
      for (const message of messages) {
        await handleInboundMessage(tenantId, message, { skipAutonomy: true });
        done += 1;
        writeImportStatus({ tenantId, status: 'importing', done, total: messages.length, updatedAt: new Date().toISOString() });
      }
      writeImportStatus({ tenantId, status: messages.length ? 'done' : 'skipped', done, total: messages.length, updatedAt: new Date().toISOString(), note: messages.length ? undefined : '客户未授权历史聊天记录共享或本次无历史消息' });
    }
    if (field === 'messages') {
      for (const message of messagesFromValue(value)) {
        await handleInboundMessage(tenantId, message);
      }
    }
  }
}

export function getWhatsAppImportStatus(): ImportStatus {
  return importStatus();
}

export function getWhatsAppCustomers(tenantId?: string): any[] {
  const allCustomers = customers().filter(customer => !tenantId || customer.tenantId === tenantId);
  const allInteractions = interactions();
  return allCustomers.map(customer => {
    const timeline = allInteractions
      .filter(item => item.customerId === customer.id)
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(item => ({
        id: item.id,
        type: item.type === 'system' ? 'system' : 'whatsapp',
        actor: item.type === 'msg_in' ? 'buyer' : item.type === 'msg_out_ai' ? 'ai' : item.type === 'system' ? 'owner' : 'seller',
        title: item.type === 'msg_in' ? '客户消息' : item.type === 'msg_out_ai' ? 'AI 自动回复' : item.type === 'system' ? '系统记录' : '销售回复',
        body: item.body,
        time: new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        autoSent: item.autoSent,
        audit: item.audit,
      }));
    const priority = prioritizeCustomer({
      ...customer,
      orders: [],
      estimatedValue: '$0',
    }).priorityScore;
    return {
      id: customer.id,
      name: customer.name,
      avatar: (customer.name[0] || 'W').toUpperCase(),
      countryName: 'WhatsApp',
      email: undefined,
      language: customer.language,
      languageLocked: false,
      source: 'whatsapp',
      product: 'WhatsApp 询盘',
      outboundProduct: 'current WhatsApp inquiry',
      estimatedValue: '$0',
      stage: customer.stage,
      intentScore: customer.intentScore,
      intentSignals: ['真实 WhatsApp 消息', customer.blockedAutoReplyReason ? '自动回复已拦截' : '待持续评分'],
      handlingMode: customer.handlingMode,
      handlingReason: customer.handlingReason,
      aiAutoCount: customer.aiAutoCount,
      needCall: false,
      hasUnread: true,
      isReal: true,
      waNumber: customer.waNumber,
      blockedAutoReplyReason: customer.blockedAutoReplyReason,
      pendingDraft: customer.pendingDraft,
      priority,
      inboxReason: customer.handlingMode === 'human_needed' ? 'reply' : customer.handlingMode === 'ai_draft' ? 'draft' : 'reply',
      lastActive: '刚刚',
      localTime: new Date(customer.lastActiveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      orders: [],
      tags: ['真实WhatsApp', customer.handlingMode === 'ai_auto' ? 'AI接待' : '待处理'],
      summary: customer.handlingReason,
      nextStep: customer.pendingDraft || '继续跟进客户最新消息。',
      timeline,
    };
  });
}
