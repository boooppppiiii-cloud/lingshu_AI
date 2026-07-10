import crypto from 'node:crypto';
import type { Request } from 'express';
import { store } from '../storage/index.js';
import { getPublicOrigin, getMetaOAuthClient, getYouTubeOAuthClient } from './oauthConfig.js';
import { sendDingTalkText } from '../integrations/dingtalk.js';
import { sendFeishuText } from '../integrations/feishu.js';

export type TenantPlatform = 'meta' | 'google';
export type TenantTokenType = 'user_60d' | 'system_user_permanent';
export type TenantPlatformStatus = 'pending' | 'active' | 'token_expired' | 'error';

export interface TenantPlatformAppRecord {
  id: string;
  tenant_id: string;
  platform: TenantPlatform;
  app_id?: string;
  app_secret?: string;
  wa_config_id?: string;
  webhook_verify_token?: string;
  token_type?: TenantTokenType;
  access_token?: string;
  token_expires_at?: string;
  status?: TenantPlatformStatus;
  notes?: string;
}

export interface PublicTenantPlatformApp {
  id: string;
  tenantId: string;
  platform: TenantPlatform;
  appId: string;
  appSecretSet: boolean;
  waConfigId: string;
  webhookVerifyToken: string;
  webhookUrl: string;
  tokenType: TenantTokenType;
  accessTokenSet: boolean;
  tokenExpiresAt: string;
  status: TenantPlatformStatus;
  notes: string;
}

const COL = 'tenant_platform_apps';
const STATE_TTL_MS = 10 * 60 * 1000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function secretKey(): Buffer {
  const raw = text(process.env.TENANT_PLATFORM_APP_KEY) || text(process.env.OAUTH_STATE_SECRET) || 'lingshu-local-dev-tenant-platform-key';
  if (raw === 'lingshu-local-dev-tenant-platform-key' && process.env.NODE_ENV === 'production') {
    console.warn('[tenant-platform-apps] TENANT_PLATFORM_APP_KEY is not set in production.');
  }
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

export function tenantWebhookUrl(req: Request, tenantId: string): string {
  return `${getPublicOrigin(req)}/api/webhooks/meta/${encodeURIComponent(tenantId)}`;
}

export function publicTenantPlatformApp(req: Request, app: TenantPlatformAppRecord): PublicTenantPlatformApp {
  return {
    id: app.id,
    tenantId: app.tenant_id,
    platform: app.platform,
    appId: text(app.app_id),
    appSecretSet: Boolean(text(app.app_secret)),
    waConfigId: text(app.wa_config_id),
    webhookVerifyToken: text(app.webhook_verify_token),
    webhookUrl: app.platform === 'meta' ? tenantWebhookUrl(req, app.tenant_id) : '',
    tokenType: app.token_type || 'user_60d',
    accessTokenSet: Boolean(text(app.access_token)),
    tokenExpiresAt: text(app.token_expires_at),
    status: app.status || 'pending',
    notes: text(app.notes),
  };
}

export async function upsertTenantPlatformApp(input: {
  tenantId: string;
  platform: TenantPlatform;
  appId?: string;
  appSecret?: string;
  waConfigId?: string;
  tokenType?: TenantTokenType;
  accessToken?: string;
  tokenExpiresAt?: string;
  status?: TenantPlatformStatus;
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
  if (input.accessToken) patch.access_token = encryptSecret(input.accessToken);
  if (input.tokenExpiresAt !== undefined) patch.token_expires_at = input.tokenExpiresAt;
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

export async function notifyDeliveryTeam(message: string): Promise<void> {
  const tasks: Promise<unknown>[] = [];
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
