import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decideAction, type AutonomyLevel } from '../autonomy/actionRules.js';
import { guardOutbound } from '../autonomy/outboundGuard.js';
import { prioritizeCustomer } from '../autonomy/prioritize.js';
import { retrieveContext, type RetrievedContext } from '../knowledge/retrieve.js';
import { notifyDeliveryTeam } from '../lib/tenantPlatformApps.js';
import { distillSalesStyleProfile, markStyleMemoryWonForCustomer } from '../knowledge/styleMemory.js';
import { readTenantEnterpriseProfile, type EnterpriseProfile } from '../routes/enterprise.js';
import { r2Upload } from '../storage/r2.js';
import { store } from '../storage/index.js';
import { sendTenantWhatsAppText } from './send.js';
import {
  attributionSystemText,
  extractTrackCode,
  findPostById,
  findPostByTrackCode,
  incrementPostMetric,
  recentPostCandidates,
  sourceFromPost,
  type PostRecord,
} from '../publishing/waLink.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'whatsapp-customers.json');
const INTERACTIONS_FILE = path.join(DATA_DIR, 'whatsapp-interactions.json');
const IMPORT_STATUS_FILE = path.join(DATA_DIR, 'whatsapp-import-status.json');
const NIGHT_MODE_EVENTS_FILE = path.join(DATA_DIR, 'night-mode-events.json');
const ENTERPRISE_FILE = path.join(DATA_DIR, 'enterprise.json');
const BACKUP_ROOT = path.join(DATA_DIR, 'backups');

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
  meta?: Record<string, unknown>;
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
  needCall?: boolean;
  knowledgeMissStreak?: number;
  source?: string;
  sourcePostId?: string;
  sourceTrackCode?: string;
  sourcePostTitle?: string;
  sourcePostPlatform?: string;
  softAttribution?: { candidates: Array<{ id: string; title: string; platform: string; trackCode: string }> };
}

interface NightModeEvent {
  id: string;
  tenantId: string;
  customerId: string;
  kind: 'auto' | 'draft' | 'call';
  createdAt: string;
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

export interface KnowledgeConversationSample {
  customerId: string;
  messages: Array<{ actor: 'buyer' | 'seller'; body: string; timestamp: number }>;
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
  const backupDir = path.join(BACKUP_ROOT, date);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const file of [CUSTOMERS_FILE, INTERACTIONS_FILE, IMPORT_STATUS_FILE, ENTERPRISE_FILE]) {
    if (!fs.existsSync(file)) continue;
    const target = path.join(backupDir, path.basename(file));
    if (fs.existsSync(target)) continue;
    try { fs.copyFileSync(file, target); } catch (error) { console.error('[whatsapp-daily-backup]', file, error); }
  }
}

function r2BackupEnabled(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID?.trim()
    && process.env.R2_ACCESS_KEY_ID?.trim()
    && process.env.R2_SECRET_ACCESS_KEY?.trim()
    && process.env.R2_BUCKET_NAME?.trim(),
  );
}

function backupPrefix(): string {
  return (process.env.R2_BACKUP_PREFIX || 'lingshu-backups').replace(/^\/+|\/+$/g, '');
}

function localBackupRetentionDays(): number {
  const raw = Number(process.env.R2_BACKUP_LOCAL_RETENTION_DAYS || 7);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 7;
}

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFilesRecursive(full) : [full];
  });
}

async function syncBackupsToR2(now = new Date()): Promise<void> {
  if (!r2BackupEnabled()) {
    console.warn('[whatsapp-backup-r2] skipped: R2 credentials are not configured');
    return;
  }
  if (!fs.existsSync(BACKUP_ROOT)) return;

  const dirs = fs.readdirSync(BACKUP_ROOT, { withFileTypes: true }).filter(entry => entry.isDirectory());
  const prefix = backupPrefix();
  for (const dir of dirs) {
    const backupDir = path.join(BACKUP_ROOT, dir.name);
    const files = listFilesRecursive(backupDir);
    for (const file of files) {
      const relative = path.relative(BACKUP_ROOT, file).split(path.sep).join('/');
      await r2Upload({
        key: `${prefix}/${relative}`,
        body: fs.readFileSync(file),
        contentType: 'application/json',
      });
    }
  }

  const cutoff = now.getTime() - localBackupRetentionDays() * 86_400_000;
  for (const dir of dirs) {
    const time = new Date(`${dir.name}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(time) || time >= cutoff) continue;
    fs.rmSync(path.join(BACKUP_ROOT, dir.name), { recursive: true, force: true });
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

function autonomyLevel(profile: EnterpriseProfile): AutonomyLevel {
  const value = profile?.strategy?.aiAutonomy;
  return value === 'remind' || value === 'draft' || value === 'auto' ? value : 'draft';
}

function handoffRules(profile: EnterpriseProfile): { keywords: string[]; missStreakToDraft: number; negativeSentiment: boolean } {
  const rules: Partial<NonNullable<EnterpriseProfile['handoffRules']>> = profile.handoffRules ?? {};
  const keywords = Array.isArray(rules.keywords)
    ? rules.keywords.map((item: unknown) => text(item)).filter(Boolean)
    : [];
  const missStreakToDraft = [1, 2, 3].includes(Number(rules.missStreakToDraft)) ? Number(rules.missStreakToDraft) : 2;
  return {
    keywords: keywords.length ? keywords : ['人工', '老板', 'manager', 'complaint', 'refund'],
    missStreakToDraft,
    negativeSentiment: rules.negativeSentiment !== false,
  };
}

function normalizeForMatch(value: string): string {
  return text(value).normalize('NFKC').toLowerCase();
}

function matchedHandoffKeyword(body: string, keywords: string[]): string {
  const normalized = normalizeForMatch(body);
  return keywords.find(keyword => normalized.includes(normalizeForMatch(keyword))) || '';
}

function minutesOfDay(value: string): number {
  const [hour, minute] = String(value || '').split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return hour * 60 + minute;
}

function currentDate(): Date {
  const raw = process.env.LINGSHU_MOCK_NOW || process.env.NIGHT_MODE_MOCK_NOW || '';
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
}

function isWithinWorkHours(workHours: { start: string; end: string }, now = new Date()): boolean {
  const current = now.getHours() * 60 + now.getMinutes();
  const start = minutesOfDay(workHours.start || '09:00');
  const end = minutesOfDay(workHours.end || '22:00');
  if (start === end) return true;
  if (start < end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function nightModeState(profile: EnterpriseProfile, now = currentDate()): { enabled: boolean; active: boolean; workHours: { start: string; end: string } } {
  const notifications = profile.notifications;
  const workHours = {
    start: /^\d{2}:\d{2}$/.test(String(notifications?.workHours?.start || '')) ? notifications!.workHours.start : '09:00',
    end: /^\d{2}:\d{2}$/.test(String(notifications?.workHours?.end || '')) ? notifications!.workHours.end : '22:00',
  };
  const enabled = Boolean(notifications?.nightMode?.enabled);
  return { enabled, active: enabled && !isWithinWorkHours(workHours, now), workHours };
}

function nightModeEvents(): NightModeEvent[] {
  return readJson<NightModeEvent[]>(NIGHT_MODE_EVENTS_FILE, []);
}

function writeNightModeEvents(items: NightModeEvent[]): void {
  writeJson(NIGHT_MODE_EVENTS_FILE, items);
}

function recordNightModeEvent(input: Omit<NightModeEvent, 'id' | 'createdAt'>): void {
  const now = currentDate();
  const recent = nightModeEvents().filter(item => now.getTime() - new Date(item.createdAt).getTime() < 7 * 86_400_000);
  recent.push({ ...input, id: `${input.kind}-${input.customerId}-${now.getTime()}`, createdAt: now.toISOString() });
  writeNightModeEvents(recent);
}

export function getNightModeMorningBriefing(tenantId = 'local'): null | {
  customers: number;
  autoReplies: number;
  drafts: number;
  calls: number;
  autoCustomerIds: string[];
  draftCustomerIds: string[];
  callCustomerIds: string[];
} {
  const since = currentDate().getTime() - 24 * 60 * 60 * 1000;
  const items = nightModeEvents().filter(item => item.tenantId === tenantId && new Date(item.createdAt).getTime() >= since);
  if (!items.length) return null;
  const autoCustomerIds = Array.from(new Set(items.filter(item => item.kind === 'auto').map(item => item.customerId)));
  const draftCustomerIds = Array.from(new Set(items.filter(item => item.kind === 'draft').map(item => item.customerId)));
  const callCustomerIds = Array.from(new Set(items.filter(item => item.kind === 'call').map(item => item.customerId)));
  return {
    customers: new Set(items.map(item => item.customerId)).size,
    autoReplies: items.filter(item => item.kind === 'auto').length,
    drafts: items.filter(item => item.kind === 'draft').length,
    calls: callCustomerIds.length,
    autoCustomerIds,
    draftCustomerIds,
    callCustomerIds,
  };
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
  if (changed > 0) {
    writeCustomers(next);
    for (const customer of next) {
      void mirrorCustomerToPocketBase(customer).catch(error => console.error('[whatsapp-pb-customer]', error));
    }
  }
  return changed;
}

function storedPayload<T>(value: unknown): T | null {
  if (value && typeof value === 'object') return value as T;
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

async function readAllPocketBaseRecords(collection: string): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  let page = 1;
  while (page <= 50) {
    const result = await store.list<Record<string, unknown>>(collection, { page, perPage: 100 });
    items.push(...result.items);
    if (page >= result.totalPages || result.items.length < 100) break;
    page += 1;
  }
  return items;
}

async function hydrateWhatsAppFromPocketBase(): Promise<void> {
  try {
    const [customerRecords, interactionRecords] = await Promise.all([
      readAllPocketBaseRecords('whatsapp_customers'),
      readAllPocketBaseRecords('whatsapp_interactions'),
    ]);
    const remoteCustomers = customerRecords
      .map(record => storedPayload<StoredCustomer>(record.payload))
      .filter((item): item is StoredCustomer => Boolean(item?.id && item?.tenantId));
    const remoteInteractions = interactionRecords
      .map(record => storedPayload<StoredInteraction>(record.payload))
      .filter((item): item is StoredInteraction => Boolean(item?.id && item?.tenantId));
    if (remoteCustomers.length) writeCustomers(remoteCustomers);
    if (remoteInteractions.length) writeInteractions(remoteInteractions);
    if (remoteCustomers.length || remoteInteractions.length) {
      console.log(`[whatsapp] hydrated ${remoteCustomers.length} customers and ${remoteInteractions.length} interactions from PocketBase`);
    }
  } catch (error) {
    console.warn('[whatsapp] using local snapshot:', error instanceof Error ? error.message : error);
  }
}

export async function initWhatsAppCustomerMaintenance(): Promise<void> {
  await hydrateWhatsAppFromPocketBase();
  const run = () => {
    try {
      backupWhatsAppDataFiles();
      void syncBackupsToR2().catch(error => console.error('[whatsapp-backup-r2]', error));
      void distillSalesStyleProfile('local_tenant_default').catch(error => console.error('[style-memory:distill]', error));
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
  if (next.stage === 'won' && base.stage !== 'won') {
    void markStyleMemoryWonForCustomer(next.tenantId, next.id).catch(error => console.error('[style-memory:won]', error));
    if (next.sourcePostId) {
      void incrementPostMetric(next.sourcePostId, 'deals').catch(error => console.error('[post-attribution:deal]', error));
    }
  }
  void mirrorCustomerToPocketBase(next).catch(error => console.error('[whatsapp-pb-customer]', error));
  return next;
}

export function upsertSocialLead(input: {
  tenantId: string;
  platform: string;
  externalId: string;
  name: string;
  comment: string;
  score: number;
  postId?: string;
  postTitle?: string;
}): StoredCustomer {
  return upsertCustomer({
    tenantId: input.tenantId,
    waNumber: `social:${input.platform}:${input.externalId}`,
    name: input.name,
    body: input.comment,
    patch: {
      source: input.platform,
      sourcePostId: input.postId,
      sourcePostTitle: input.postTitle,
      sourcePostPlatform: input.platform,
      intentScore: Math.max(0, Math.min(100, input.score)),
      handlingMode: 'ai_draft',
      handlingReason: `来自 ${input.platform} 评论的高意向线索，待继续建联`,
    },
  });
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

export async function confirmCustomerSourceAttribution(input: { tenantId: string; customerId: string; postId: string }): Promise<StoredCustomer | null> {
  const post = await findPostById(input.postId);
  if (!post || post.tenant_id !== input.tenantId) return null;
  const list = customers();
  const index = list.findIndex(item => item.tenantId === input.tenantId && item.id === input.customerId);
  if (index < 0) return null;
  const existing = list[index];
  const next: StoredCustomer = {
    ...existing,
    source: sourceFromPost(post),
    sourcePostId: post.id,
    sourceTrackCode: post.track_code,
    sourcePostTitle: post.title,
    sourcePostPlatform: post.platform,
    softAttribution: undefined,
    updatedAt: new Date().toISOString(),
  };
  list[index] = next;
  writeCustomers(list);
  await mirrorCustomerToPocketBase(next).catch(error => console.error('[whatsapp-pb-customer]', error));
  await incrementPostMetric(post.id, 'inquiries').catch(error => console.error('[post-attribution:confirm]', error));
  addInteraction({
    id: `attr_${input.customerId}_${post.id}_${Date.now()}`,
    tenantId: input.tenantId,
    customerId: input.customerId,
    waNumber: next.waNumber,
    type: 'system',
    body: attributionSystemText(post),
    timestamp: Date.now(),
    audit: { sourcePostId: post.id, trackCode: post.track_code, platform: post.platform, confirmed: true },
    meta: { sourcePostId: post.id, trackCode: post.track_code, platform: post.platform, confirmed: true },
  });
  return next;
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
  if (/\b(can we (talk|call)|call me|phone call|voice call|speak to|talk with|talk to manager)\b|电话|通话|语音|加个微信聊|找经理聊/i.test(body)) return 'call_request';
  if (/\b(price|quote|quotation|discount|payment|deposit|delivery time|lead time)\b|报价|价格|付款|定金|交期|折扣/i.test(body)) return 'formal_quote';
  if (/\b(catalog|catalogue|brochure|collections?)\b|目录|产品册/i.test(body)) return 'auto_send_catalog';
  if (/\b(track|tracking|ship|shipping|logistics)\b|物流|运单|发货/i.test(body)) return 'auto_logistics_update';
  if (/\b(sample|after.?sale|warranty)\b|样品|售后|质保/i.test(body)) return 'auto_aftersale_confirm';
  return 'auto_faq_reply';
}

function approvedFaqAnswer(context: RetrievedContext, message: string): string {
  if (!message || !context.faqMatch?.autoSafe) return '';
  return context.faqMatch.faq.approvedForAuto ? context.faqMatch.faq.a : '';
}

function autoFaqLibraryReady(profile: EnterpriseProfile): boolean {
  return (profile.faq ?? []).filter(item => item.approvedForAuto && text(item.question) && text(item.answer)).length >= 5;
}

function recentConversationForCustomer(tenantId: string, customerIdValue: string) {
  return interactions()
    .filter(item => item.tenantId === tenantId && item.customerId === customerIdValue && item.type !== 'system')
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-8)
    .map(item => ({
      role: item.type === 'msg_in' ? 'buyer' as const : 'seller' as const,
      text: item.body,
    }));
}

function draftForMessage(message: IncomingMessage, context?: RetrievedContext): string {
  const product = context?.products?.[0];
  if (product) {
    const details = [
      product.sku ? `SKU ${product.sku}` : product.name,
      product.moq ? `MOQ ${product.moq}` : '',
      product.material ? `material ${product.material}` : '',
    ].filter(Boolean).join(', ');
    return `Thanks for your message. I found ${details}. Please confirm your target quantity and packaging requirements, then I can prepare the next quote details.`;
  }
  if (/\b(catalog|catalogue|brochure|collections?)\b|目录|产品册/i.test(message.body)) {
    return 'Thanks for your message. I can send our approved catalog for your review. Which product line and quantity are you interested in?';
  }
  if (/\b(track|tracking|ship|shipping|logistics)\b|物流|运单|发货/i.test(message.body)) {
    return 'Thanks for checking in. I will update the tracking status and share the latest logistics information with you.';
  }
  return 'Thanks for your message. I have received your request and will confirm the details with our team.';
}

async function handleInboundMessage(tenantId: string, message: IncomingMessage, options: { skipAutonomy?: boolean } = {}): Promise<void> {
  const existingCustomer = customers().find(item => item.tenantId === tenantId && item.id === customerId(tenantId, message.waNumber));
  let attributedPost: PostRecord | null = null;
  const attributionPatch: Partial<StoredCustomer> = {};
  if (!message.fromBusiness && !existingCustomer && !options.skipAutonomy) {
    const trackCode = extractTrackCode(message.body);
    if (trackCode) {
      attributedPost = await findPostByTrackCode(tenantId, trackCode);
      if (attributedPost) {
        attributionPatch.source = sourceFromPost(attributedPost);
        attributionPatch.sourcePostId = attributedPost.id;
        attributionPatch.sourceTrackCode = attributedPost.track_code;
        attributionPatch.sourcePostTitle = attributedPost.title || attributedPost.track_code;
        attributionPatch.sourcePostPlatform = attributedPost.platform;
        attributionPatch.handlingReason = `客户来自${attributedPost.platform}内容《${attributedPost.title || attributedPost.track_code}》`;
      }
    } else {
      const candidates = await recentPostCandidates(tenantId, 72);
      if (candidates.length) {
        attributionPatch.softAttribution = {
          candidates: candidates.slice(0, 5).map(post => ({
            id: post.id,
            title: post.title || post.track_code,
            platform: post.platform,
            trackCode: post.track_code,
          })),
        };
      }
    }
  }
  const customer = upsertCustomer({
    tenantId,
    waNumber: message.waNumber,
    name: message.name,
    body: message.body,
    lastActiveAt: message.timestamp,
    patch: attributionPatch,
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
    audit: {},
  });
  if (attributedPost) {
    await incrementPostMetric(attributedPost.id, 'inquiries');
    addInteraction({
      id: `${customer.id}-source-${attributedPost.track_code}-${Date.now()}`,
      tenantId,
      customerId: customer.id,
      waNumber: message.waNumber,
      type: 'system',
      body: attributionSystemText(attributedPost),
      timestamp: Date.now(),
      audit: { sourcePostId: attributedPost.id, trackCode: attributedPost.track_code, platform: attributedPost.platform },
      meta: { sourcePostId: attributedPost.id, trackCode: attributedPost.track_code, platform: attributedPost.platform },
    });
  }
  if (message.fromBusiness) {
    upsertCustomer({ tenantId, waNumber: message.waNumber, patch: { knowledgeMissStreak: 0, blockedAutoReplyReason: undefined } });
    return;
  }
  if (options.skipAutonomy) return;

  const profile = await readTenantEnterpriseProfile(tenantId);
  const autonomy = autonomyLevel(profile);
  const rules = handoffRules(profile);
  const handoffKeyword = matchedHandoffKeyword(message.body, rules.keywords);
  if (handoffKeyword) {
    const reason = `客户主动要求人工/触发关键词【${handoffKeyword}】`;
    addInteraction({
      id: `${customer.id}-handoff-keyword-${Date.now()}`,
      tenantId,
      customerId: customer.id,
      waNumber: message.waNumber,
      type: 'system',
      body: reason,
      timestamp: Date.now(),
      audit: { handoff: true, reason, keyword: handoffKeyword },
      meta: { handoff: true, reason, keyword: handoffKeyword },
    });
    upsertCustomer({
      tenantId,
      waNumber: message.waNumber,
      patch: {
        handlingMode: 'human_needed',
        handlingReason: reason,
        pendingDraft: undefined,
        blockedAutoReplyReason: reason,
      },
    });
    return;
  }

  const inferredAction = inferActionFromText(message.body);
  if (inferredAction === 'formal_quote') {
    const reason = '客户正在询价，已标记为等待人工报价';
    addInteraction({
      id: `${customer.id}-waiting-human-quote-${Date.now()}`,
      tenantId,
      customerId: customer.id,
      waNumber: message.waNumber,
      type: 'system',
      body: `${reason}。AI 不会直接回复价格，请销售确认数量、规格和包装后亲自报价。`,
      timestamp: Date.now(),
      audit: { action: 'formal_quote', risk: 'L4', handoff: true, reason },
      meta: { action: 'formal_quote', waitingForQuote: true, handoff: true, reason },
    });
    upsertCustomer({
      tenantId,
      waNumber: message.waNumber,
      patch: {
        handlingMode: 'human_needed',
        handlingReason: reason,
        pendingDraft: undefined,
        blockedAutoReplyReason: 'waiting_for_human_quote',
      },
    });
    return;
  }

  const context = await retrieveContext(tenantId, {
    id: customer.id,
    name: customer.name,
    language: customer.language,
    stage: customer.stage,
  }, message.body, { conversation: recentConversationForCustomer(tenantId, customer.id) });
  if (context.knowledgeMiss) {
    addInteraction({
      id: `${customer.id}-knowledge-miss-${Date.now()}`,
      tenantId,
      customerId: customer.id,
      waNumber: message.waNumber,
      type: 'system',
      body: '知识库未覆盖：客户在问资料中没有的问题，已停止自动处理并等待人工确认。',
      timestamp: Date.now(),
      audit: { knowledgeMiss: true, buyerMessage: message.body, evidence: context.evidence },
      meta: { knowledgeMiss: true, buyerMessage: message.body, evidence: context.evidence },
    });
  }
  const nextMissStreak = context.knowledgeMiss ? (customer.knowledgeMissStreak ?? 0) + 1 : 0;
  if (context.knowledgeMiss && nextMissStreak >= rules.missStreakToDraft) {
    const reason = `连续 ${nextMissStreak} 条超出知识库范围`;
    const draft = draftForMessage(message, context);
    addInteraction({
      id: `${customer.id}-handoff-miss-streak-${Date.now()}`,
      tenantId,
      customerId: customer.id,
      waNumber: message.waNumber,
      type: 'system',
      body: reason,
      timestamp: Date.now(),
      audit: { knowledgeMiss: true, handoff: true, reason, missStreak: nextMissStreak, evidence: context.evidence },
      meta: { knowledgeMiss: true, handoff: true, reason, missStreak: nextMissStreak, evidence: context.evidence },
    });
    upsertCustomer({
      tenantId,
      waNumber: message.waNumber,
      patch: {
        handlingMode: autonomy === 'remind' ? 'human_needed' : 'ai_draft',
        handlingReason: reason,
        pendingDraft: autonomy === 'remind' ? undefined : draft,
        blockedAutoReplyReason: 'knowledge_miss_streak',
        knowledgeMissStreak: nextMissStreak,
      },
    });
    return;
  }
  if (!context.knowledgeMiss && (customer.knowledgeMissStreak ?? 0) > 0) {
    upsertCustomer({ tenantId, waNumber: message.waNumber, patch: { knowledgeMissStreak: 0 } });
  }
  if (rules.negativeSentiment && context.sentiment === 'negative') {
    const reason = '客户情绪负面，建议亲自处理';
    addInteraction({
      id: `${customer.id}-handoff-sentiment-${Date.now()}`,
      tenantId,
      customerId: customer.id,
      waNumber: message.waNumber,
      type: 'system',
      body: reason,
      timestamp: Date.now(),
      audit: { handoff: true, reason, sentiment: context.sentiment, evidence: context.evidence },
      meta: { handoff: true, reason, sentiment: context.sentiment, evidence: context.evidence },
    });
    upsertCustomer({
      tenantId,
      waNumber: message.waNumber,
      patch: {
        handlingMode: 'human_needed',
        handlingReason: reason,
        pendingDraft: undefined,
        blockedAutoReplyReason: 'negative_sentiment',
        knowledgeMissStreak: nextMissStreak,
      },
    });
    return;
  }
  let action = inferredAction;
  if (context.faqMatch?.autoSafe && action !== 'formal_quote' && action !== 'call_request') {
    action = 'auto_faq_reply';
  }
  const night = nightModeState(profile);
  let draft = draftForMessage(message, context);
  let blockedAutoReplyReason = '';
  let approvedFaqHit = false;
  if (action === 'call_request') {
    const callDraft = 'Our manager will contact you shortly. What time works best for you?';
    addInteraction({
      id: `${customer.id}-call-request-${Date.now()}`,
      tenantId,
      customerId: customer.id,
      waNumber: message.waNumber,
      type: 'system',
      body: '客户想通电话，已即时提醒负责人。',
      timestamp: Date.now(),
      audit: { action, risk: 'L4', nightMode: night.active },
    });
    if (night.active) recordNightModeEvent({ tenantId, customerId: customer.id, kind: 'call' });
    await notifyDeliveryTeam([
      '【灵枢通话提醒】客户想通电话',
      `客户：${customer.name}`,
      `WhatsApp：${message.waNumber}`,
      `消息：${message.body}`,
      '请尽快查看客户详情并安排通话。',
    ].join('\n'), { immediate: true });
    upsertCustomer({
      tenantId,
      waNumber: message.waNumber,
      patch: {
        handlingMode: 'human_needed',
        handlingReason: '客户想通电话，已即时提醒负责人',
        pendingDraft: autonomy === 'remind' ? undefined : callDraft,
        needCall: true,
      },
    });
    return;
  }
  if (action === 'auto_faq_reply') {
    const approvedAnswer = approvedFaqAnswer(context, message.body);
    if (approvedAnswer) {
      draft = approvedAnswer;
      approvedFaqHit = true;
    } else {
      action = 'draft_greeting';
      blockedAutoReplyReason = autoFaqLibraryReady(profile)
        ? '未命中已审批常见问答，已降级为草稿'
        : '需要先录入并审批至少 5 条常见问答';
    }
  }
  const faqLibraryReady = autoFaqLibraryReady(profile);
  const configuredAutonomy: AutonomyLevel = autonomy === 'auto' && !faqLibraryReady ? 'draft' : autonomy;
  const nightAllowsAuto = night.active && action === 'auto_faq_reply' && approvedFaqHit;
  const effectiveAutonomy: AutonomyLevel = night.active && !nightAllowsAuto
    ? (configuredAutonomy === 'remind' ? 'remind' : 'draft')
    : configuredAutonomy;
  const decision = decideAction(action, effectiveAutonomy);
  if (night.active && decision.decision !== 'auto') {
    blockedAutoReplyReason = blockedAutoReplyReason || '夜班模式：非工作时间仅自动回复已审批常见问题和低风险动作';
  }

  if (context.knowledgeMiss && decision.decision === 'auto') {
    if (night.active) recordNightModeEvent({ tenantId, customerId: customer.id, kind: 'draft' });
    upsertCustomer({
      tenantId,
      waNumber: message.waNumber,
      patch: {
        handlingMode: 'ai_draft',
        handlingReason: '客户在问知识库没有的问题',
        pendingDraft: draft,
        blockedAutoReplyReason: 'knowledge_miss',
        knowledgeMissStreak: nextMissStreak,
      },
    });
    return;
  }

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
          audit: { action, risk: decision.rule.risk, autonomy, evidence: context.evidence, sendError: error instanceof Error ? error.message : String(error) },
        });
        upsertCustomer({
          tenantId,
          waNumber: message.waNumber,
          patch: {
            handlingMode: 'ai_draft',
            handlingReason: 'AI 自动回复未真正发出，需要你确认后重发',
          pendingDraft: draft,
          blockedAutoReplyReason: error instanceof Error ? error.message : 'WhatsApp send failed',
          knowledgeMissStreak: nextMissStreak,
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
        audit: { action, risk: decision.rule.risk, autonomy, evidence: context.evidence },
      });
      if (night.active) recordNightModeEvent({ tenantId, customerId: customer.id, kind: 'auto' });
      upsertCustomer({
        tenantId,
        waNumber: message.waNumber,
        patch: {
          handlingMode: 'ai_auto',
          handlingReason: decision.rule.desc,
          aiAutoCount: (customer.aiAutoCount ?? 0) + 1,
          pendingDraft: undefined,
          blockedAutoReplyReason: undefined,
          knowledgeMissStreak: 0,
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
      audit: { action, risk: decision.rule.risk, autonomy, evidence: context.evidence, guardRule: guard.matchedRule },
    });
    upsertCustomer({
      tenantId,
      waNumber: message.waNumber,
      patch: {
        handlingMode: 'ai_draft',
        handlingReason: `AI 想回复但涉及${guard.matchedRule || '红线'}，需要你确认`,
        pendingDraft: draft,
        blockedAutoReplyReason: guard.matchedRule || '红线',
        knowledgeMissStreak: nextMissStreak,
      },
    });
    if (night.active) recordNightModeEvent({ tenantId, customerId: customer.id, kind: 'draft' });
    return;
  }

  if (night.active) recordNightModeEvent({ tenantId, customerId: customer.id, kind: 'draft' });
  upsertCustomer({
    tenantId,
    waNumber: message.waNumber,
    patch: {
      handlingMode: decision.decision === 'remind' ? 'human_needed' : 'ai_draft',
      handlingReason: decision.decision === 'remind' ? 'AI 已提醒你处理该客户' : `${decision.rule.desc}，AI 已生成草稿等待确认`,
      pendingDraft: decision.decision === 'draft' ? draft : undefined,
      blockedAutoReplyReason: blockedAutoReplyReason || undefined,
      knowledgeMissStreak: nextMissStreak,
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

export function markWhatsAppHumanReply(input: { tenantId: string; customerId: string; body: string; waNumber?: string }): void {
  const customer = customers().find(item => item.tenantId === input.tenantId && item.id === input.customerId);
  const waNumber = input.waNumber || customer?.waNumber;
  if (!customer || !waNumber) return;
  addInteraction({
    id: `${customer.id}-human-${Date.now()}`,
    tenantId: input.tenantId,
    customerId: customer.id,
    waNumber,
    type: 'msg_out_human',
    body: input.body,
    timestamp: Date.now(),
    audit: { clearsKnowledgeMissStreak: true },
  });
  upsertCustomer({
    tenantId: input.tenantId,
    waNumber,
    patch: {
      handlingMode: 'ai_draft',
      handlingReason: '人工已回复，AI 继续辅助跟进',
      knowledgeMissStreak: 0,
      blockedAutoReplyReason: undefined,
      pendingDraft: undefined,
    },
  });
}

export function getWhatsAppCustomers(tenantId?: string): any[] {
  const allCustomers = customers().filter(customer => !tenantId || customer.tenantId === tenantId);
  const allInteractions = interactions();
  return allCustomers.map(customer => {
    const timeline = allInteractions
      .filter(item => item.tenantId === customer.tenantId && item.customerId === customer.id)
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
      countryName: customer.source && customer.source !== 'whatsapp' ? customer.source : 'WhatsApp',
      email: undefined,
      language: customer.language,
      languageLocked: false,
      source: customer.source || 'whatsapp',
      sourcePostId: customer.sourcePostId,
      sourceTrackCode: customer.sourceTrackCode,
      sourcePostTitle: customer.sourcePostTitle,
      sourcePostPlatform: customer.sourcePostPlatform,
      softAttribution: customer.softAttribution,
      product: customer.source && customer.source !== 'whatsapp' ? '社媒评论商机' : 'WhatsApp 询盘',
      outboundProduct: customer.source && customer.source !== 'whatsapp' ? 'social comment lead' : 'current WhatsApp inquiry',
      estimatedValue: '$0',
      stage: customer.stage,
      intentScore: customer.intentScore,
      intentSignals: [customer.source && customer.source !== 'whatsapp' ? '真实社媒评论' : '真实 WhatsApp 消息', customer.blockedAutoReplyReason ? '自动回复已拦截' : '待持续评分'],
      handlingMode: customer.handlingMode,
      handlingReason: customer.handlingReason,
      aiAutoCount: customer.aiAutoCount,
      needCall: Boolean(customer.needCall),
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
      tags: [customer.source && customer.source !== 'whatsapp' ? '社媒商机' : '真实WhatsApp', customer.handlingMode === 'ai_auto' ? 'AI接待' : '待处理'],
      summary: customer.handlingReason,
      nextStep: customer.pendingDraft || '继续跟进客户最新消息。',
      timeline,
    };
  });
}

export function getWhatsAppKnowledgeSamples(
  tenantId: string,
  options: { maxConversations?: number; maxMessages?: number; sinceDays?: number } = {},
): KnowledgeConversationSample[] {
  const maxConversations = Math.max(1, Math.min(120, options.maxConversations ?? 60));
  const maxMessages = Math.max(20, Math.min(800, options.maxMessages ?? 500));
  const since = Date.now() - Math.max(1, options.sinceDays ?? 180) * 86_400_000;
  const grouped = new Map<string, KnowledgeConversationSample['messages']>();

  interactions()
    .filter(item => item.tenantId === tenantId && item.timestamp >= since && item.type !== 'system' && item.body.trim())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, maxMessages)
    .forEach(item => {
      const current = grouped.get(item.customerId) ?? [];
      current.push({
        actor: item.type === 'msg_in' ? 'buyer' : 'seller',
        body: item.body
          .replace(/\+?\d[\d\s().-]{7,}\d/g, '[电话号码]')
          .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱]')
          .replace(/\b\d{5,}\b/g, '[编号]')
          .slice(0, 800),
        timestamp: item.timestamp,
      });
      grouped.set(item.customerId, current);
    });

  return Array.from(grouped.entries())
    .slice(0, maxConversations)
    .map(([customerId, messages]) => ({
      customerId,
      messages: messages.sort((a, b) => a.timestamp - b.timestamp).slice(-30),
    }))
    .filter(sample => sample.messages.some(message => message.actor === 'buyer'));
}
