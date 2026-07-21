import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request } from 'express';
import { store } from '../storage/index.js';
import { getPublicOrigin, getMetaOAuthClient, getYouTubeOAuthClient } from './oauthConfig.js';
import { sendDingTalkText } from '../integrations/dingtalk.js';
import { sendFeishuText } from '../integrations/feishu.js';

export type TenantPlatform = 'meta' | 'google' | 'wecom';
export type TenantTokenType = 'user_60d' | 'system_user_permanent';
export type TenantPlatformStatus =
  | 'pending'
  | 'configuring'
  | 'waiting_customer'
  | 'importing_history'
  | 'verifying'
  | 'active'
  | 'needs_permanent_token'
  | 'token_expired'
  | 'error';

export interface TenantPlatformAppRecord {
  id: string;
  tenant_id: string;
  platform: TenantPlatform;
  app_id?: string;
  app_secret?: string;
  wa_config_id?: string;
  business_id?: string;
  waba_id?: string;
  phone_number_id?: string;
  wa_public_number?: string;
  page_id?: string;
  ig_user_id?: string;
  youtube_channel_id?: string;
  webhook_verify_token?: string;
  wecom_encoding_aes_key?: string;
  token_type?: TenantTokenType;
  access_token?: string;
  token_expires_at?: string;
  status?: TenantPlatformStatus;
  last_checklist?: string;
  notes?: string;
}

export interface PublicTenantPlatformApp {
  id: string;
  tenantId: string;
  platform: TenantPlatform;
  appId: string;
  appSecretSet: boolean;
  waConfigId: string;
  businessId: string;
  wabaId: string;
  phoneNumberId: string;
  waPublicNumber: string;
  pageId: string;
  igUserId: string;
  youtubeChannelId: string;
  webhookVerifyToken: string;
  wecomEncodingAesKeySet: boolean;
  webhookUrl: string;
  tokenType: TenantTokenType;
  accessTokenSet: boolean;
  tokenExpiresAt: string;
  status: TenantPlatformStatus;
  checklist: Record<string, boolean>;
  notes: string;
}

const COL = 'tenant_platform_apps';
const STATE_TTL_MS = 10 * 60 * 1000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const ENTERPRISE_FILE = path.join(DATA_DIR, 'enterprise.json');
const DAILY_BRIEFING_QUEUE_FILE = path.join(DATA_DIR, 'daily-briefing-queue.json');
const MISSING_TENANT_PLATFORM_APP_KEY =
  'TENANT_PLATFORM_APP_KEY is required in production. Generate one with `openssl rand -base64 32` and set it in the server environment before starting LingShu.';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function assertTenantPlatformAppKey(): void {
  if (process.env.NODE_ENV === 'production' && !text(process.env.TENANT_PLATFORM_APP_KEY)) {
    throw new Error(MISSING_TENANT_PLATFORM_APP_KEY);
  }
}

assertTenantPlatformAppKey();

function secretKey(): Buffer {
  const tenantKey = text(process.env.TENANT_PLATFORM_APP_KEY);
  if (process.env.NODE_ENV === 'production' && !tenantKey) {
    throw new Error(MISSING_TENANT_PLATFORM_APP_KEY);
  }
  const raw = tenantKey || text(process.env.OAUTH_STATE_SECRET) || 'lingshu-local-dev-tenant-platform-key';
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptSecret(value: string): string {
  const plain = text(value);
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptSecret(value?: string): string {
  const raw = text(value);
  if (!raw) return '';
  if (!raw.startsWith('v1:')) return raw;
  try {
    const [, ivRaw, tagRaw, dataRaw] = raw.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivRaw, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataRaw, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}

function randomToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export async function getTenantPlatformApp(tenantId: string, platform: TenantPlatform): Promise<TenantPlatformAppRecord | null> {
  const result = await store.list<TenantPlatformAppRecord>(COL, {
    where: { tenant_id: tenantId, platform },
    perPage: 1,
  });
  return result.items[0] ?? null;
}

export async function listTenantPlatformApps(): Promise<TenantPlatformAppRecord[]> {
  const result = await store.list<TenantPlatformAppRecord>(COL, { perPage: 200, sort: 'tenant_id' });
  return result.items;
}

export function tenantWebhookUrl(req: Request, tenantId: string, platform: TenantPlatform = 'meta'): string {
  const path = platform === 'wecom' ? 'wecom' : 'meta';
  return `${getPublicOrigin(req)}/api/webhooks/${path}/${encodeURIComponent(tenantId)}`;
}

export function publicTenantPlatformApp(req: Request, app: TenantPlatformAppRecord): PublicTenantPlatformApp {
  const checklist = (() => {
    try {
      const parsed = JSON.parse(text(app.last_checklist) || '{}');
      return parsed && typeof parsed === 'object' ? parsed as Record<string, boolean> : {};
    } catch {
      return {};
    }
  })();
  return {
    id: app.id,
    tenantId: app.tenant_id,
    platform: app.platform,
    appId: text(app.app_id),
    appSecretSet: Boolean(text(app.app_secret)),
    waConfigId: text(app.wa_config_id),
    businessId: text(app.business_id),
    wabaId: text(app.waba_id),
    phoneNumberId: text(app.phone_number_id),
    waPublicNumber: text(app.wa_public_number),
    pageId: text(app.page_id),
    igUserId: text(app.ig_user_id),
    youtubeChannelId: text(app.youtube_channel_id),
    webhookVerifyToken: text(app.webhook_verify_token),
    wecomEncodingAesKeySet: Boolean(text(app.wecom_encoding_aes_key)),
    webhookUrl: app.platform === 'meta' || app.platform === 'wecom' ? tenantWebhookUrl(req, app.tenant_id, app.platform) : '',
    tokenType: app.token_type || 'user_60d',
    accessTokenSet: Boolean(text(app.access_token)),
    tokenExpiresAt: text(app.token_expires_at),
    status: app.status || 'pending',
    checklist,
    notes: text(app.notes),
  };
}

export async function upsertTenantPlatformApp(input: {
  tenantId: string;
  platform: TenantPlatform;
  appId?: string;
  appSecret?: string;
  waConfigId?: string;
  businessId?: string;
  wabaId?: string;
  phoneNumberId?: string;
  waPublicNumber?: string;
  pageId?: string;
  igUserId?: string;
  youtubeChannelId?: string;
  wecomEncodingAesKey?: string;
  tokenType?: TenantTokenType;
  accessToken?: string;
  tokenExpiresAt?: string;
  status?: TenantPlatformStatus;
  checklist?: Record<string, boolean>;
  notes?: string;
}): Promise<TenantPlatformAppRecord> {
  const existing = await getTenantPlatformApp(input.tenantId, input.platform);
  const patch: Record<string, unknown> = {
    tenant_id: input.tenantId,
    platform: input.platform,
    webhook_verify_token: existing?.webhook_verify_token || randomToken(),
    token_type: input.tokenType || existing?.token_type || 'user_60d',
    status: input.status || existing?.status || 'pending',
  };
  if (input.appId !== undefined) patch.app_id = input.appId;
  if (input.appSecret) patch.app_secret = encryptSecret(input.appSecret);
  if (input.waConfigId !== undefined) patch.wa_config_id = input.waConfigId;
  if (input.businessId !== undefined) patch.business_id = input.businessId;
  if (input.wabaId !== undefined) patch.waba_id = input.wabaId;
  if (input.phoneNumberId !== undefined) patch.phone_number_id = input.phoneNumberId;
  if (input.waPublicNumber !== undefined) patch.wa_public_number = input.waPublicNumber;
  if (input.pageId !== undefined) patch.page_id = input.pageId;
  if (input.igUserId !== undefined) patch.ig_user_id = input.igUserId;
  if (input.youtubeChannelId !== undefined) patch.youtube_channel_id = input.youtubeChannelId;
  if (input.wecomEncodingAesKey) patch.wecom_encoding_aes_key = encryptSecret(input.wecomEncodingAesKey);
  if (input.accessToken) patch.access_token = encryptSecret(input.accessToken);
  if (input.tokenExpiresAt !== undefined) patch.token_expires_at = input.tokenExpiresAt;
  if (input.checklist !== undefined) patch.last_checklist = JSON.stringify(input.checklist);
  if (input.notes !== undefined) patch.notes = input.notes;

  if (existing) {
    await store.update(COL, existing.id, patch);
    return { ...existing, ...patch } as TenantPlatformAppRecord;
  }
  const created = await store.create<TenantPlatformAppRecord>(COL, patch);
  if (!created) throw new Error('tenant_platform_app_create_failed');
  return created;
}

export async function markTenantPlatformStatus(id: string, status: TenantPlatformStatus, notes?: string): Promise<void> {
  await store.update(COL, id, {
    status,
    ...(notes ? { notes } : {}),
  });
}

export async function getTenantMetaOAuthClient(tenantId?: string): Promise<{ appId: string; appSecret: string } | null> {
  if (tenantId) {
    const app = await getTenantPlatformApp(tenantId, 'meta');
    const appId = text(app?.app_id);
    const appSecret = decryptSecret(app?.app_secret);
    if (appId && appSecret) return { appId, appSecret };
  }
  return getMetaOAuthClient();
}

export async function getTenantGoogleOAuthClient(tenantId?: string): Promise<{ clientId: string; clientSecret: string } | null> {
  if (tenantId) {
    const app = await getTenantPlatformApp(tenantId, 'google');
    const clientId = text(app?.app_id);
    const clientSecret = decryptSecret(app?.app_secret);
    if (clientId && clientSecret) return { clientId, clientSecret };
  }
  return getYouTubeOAuthClient();
}

export function signOAuthState(input: {
  tenantId: string;
  userId: string;
  platform: string;
  returnTo: string;
  nonce?: string;
  expiresAt?: number;
}): string {
  const payload = {
    tenantId: input.tenantId,
    userId: input.userId,
    platform: input.platform,
    returnTo: input.returnTo,
    nonce: input.nonce || crypto.randomBytes(12).toString('base64url'),
    expiresAt: input.expiresAt || Date.now() + STATE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secretKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function parseOAuthState(state: string): null | {
  tenantId: string;
  userId: string;
  platform: string;
  returnTo: string;
  expiresAt: number;
} {
  const [body, sig] = text(state).split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secretKey()).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      tenantId?: string;
      userId?: string;
      platform?: string;
      returnTo?: string;
      expiresAt?: number;
    };
    if (!payload.tenantId || !payload.userId || !payload.platform || !payload.expiresAt) return null;
    if (payload.expiresAt <= Date.now()) return null;
    return {
      tenantId: payload.tenantId,
      userId: payload.userId,
      platform: payload.platform,
      returnTo: payload.returnTo || '/',
      expiresAt: payload.expiresAt,
    };
  } catch {
    return null;
  }
}

export function verifyMetaSignature(appSecret: string, rawBody: Buffer, signatureHeader: unknown): boolean {
  const signature = text(Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader);
  if (!signature.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function notifyDeliveryTeam(message: string, options: { immediate?: boolean } = {}): Promise<void> {
  const enterpriseNotifications = readEnterpriseNotificationSettings();
  if (!options.immediate && enterpriseNotifications?.quietOutsideHours && !isWithinWorkHours(enterpriseNotifications.workHours)) {
    enqueueDailyBriefing(message);
    console.warn('[delivery-alert:queued-for-briefing]', message);
    return;
  }
  const tasks: Promise<unknown>[] = [];
  if (enterpriseNotifications?.receivers.length) {
    for (const receiver of enterpriseNotifications.receivers) {
      if (receiver.channel === 'dingtalk') {
        tasks.push(sendDingTalkText({ webhookUrl: receiver.target, secret: '' }, message));
      } else if (receiver.channel === 'feishu') {
        tasks.push(sendFeishuText({ webhookUrl: receiver.target, secret: '' }, message));
      } else {
        console.warn(`[delivery-alert:${receiver.channel}] ${receiver.name || receiver.target}: ${message}`);
      }
    }
    if (tasks.length) {
      await Promise.allSettled(tasks);
    }
    return;
  }
  const dingTalkWebhook = text(process.env.DELIVERY_ALERT_DINGTALK_WEBHOOK);
  if (dingTalkWebhook) {
    tasks.push(sendDingTalkText({
      webhookUrl: dingTalkWebhook,
      secret: text(process.env.DELIVERY_ALERT_DINGTALK_SECRET),
    }, message));
  }
  const feishuWebhook = text(process.env.DELIVERY_ALERT_FEISHU_WEBHOOK);
  if (feishuWebhook) {
    tasks.push(sendFeishuText({
      webhookUrl: feishuWebhook,
      secret: text(process.env.DELIVERY_ALERT_FEISHU_SECRET),
    }, message));
  }
  if (!tasks.length) {
    console.warn('[delivery-alert]', message);
    return;
  }
  await Promise.allSettled(tasks);
}

function readEnterpriseNotificationSettings(): null | {
  receivers: Array<{ name: string; channel: 'wecom' | 'dingtalk' | 'feishu' | 'sms'; target: string }>;
  workHours: { start: string; end: string };
  quietOutsideHours: boolean;
} {
  try {
    const parsed = JSON.parse(fs.readFileSync(ENTERPRISE_FILE, 'utf8'));
    const notifications = parsed?.notifications;
    const receivers = Array.isArray(notifications?.receivers)
      ? notifications.receivers.map((receiver: any) => ({
        name: text(receiver?.name),
        channel: ['wecom', 'dingtalk', 'feishu', 'sms'].includes(receiver?.channel) ? receiver.channel : 'wecom',
        target: text(receiver?.target),
      })).filter((receiver: any) => receiver.target)
      : [];
    if (!receivers.length) return null;
    return {
      receivers,
      workHours: {
        start: /^\d{2}:\d{2}$/.test(text(notifications?.workHours?.start)) ? text(notifications?.workHours?.start) : '09:00',
        end: /^\d{2}:\d{2}$/.test(text(notifications?.workHours?.end)) ? text(notifications?.workHours?.end) : '22:00',
      },
      quietOutsideHours: notifications?.quietOutsideHours !== false,
    };
  } catch {
    return null;
  }
}

function minutesOfDay(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function isWithinWorkHours(workHours: { start: string; end: string }): boolean {
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const start = minutesOfDay(workHours.start);
  const end = minutesOfDay(workHours.end);
  if (start === end) return true;
  if (start < end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function enqueueDailyBriefing(message: string): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const existing = JSON.parse(fs.existsSync(DAILY_BRIEFING_QUEUE_FILE) ? fs.readFileSync(DAILY_BRIEFING_QUEUE_FILE, 'utf8') : '[]');
    const items = Array.isArray(existing) ? existing : [];
    items.push({ id: crypto.randomUUID(), message, createdAt: new Date().toISOString(), deliverOn: nextLocalDate() });
    fs.writeFileSync(DAILY_BRIEFING_QUEUE_FILE, JSON.stringify(items, null, 2), 'utf8');
  } catch (error) {
    console.warn('[delivery-alert:queue-failed]', error);
  }
}

function nextLocalDate(): string {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}
