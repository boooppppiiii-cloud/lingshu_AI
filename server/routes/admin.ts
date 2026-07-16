import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pbGet, pbListStrict } from '../storage/pb.js';
import { demoLimits } from '../lib/demo.js';
import {
  effectiveOAuthConfig,
  oauthCallbackUrls,
  getPublicOrigin,
  readOAuthConfig,
  writeOAuthConfig,
  type StoredOAuthConfig,
} from '../lib/oauthConfig.js';
import {
  demoUsageForUser,
  readDemoAccountRegistry,
  requireAdminUser,
} from '../lib/demoAccounts.js';
import {
  createSupportAccessRequest,
  issueSupportAccessToken,
  supportAccessDefaultAuthorized,
} from '../lib/supportAccess.js';
import {
  getVideoAdminAlert,
  listVideoAdminAlerts,
  syncVideoAdminAlertsFromRecords,
  type VideoAdminAlert,
  type VideoFailureRecord,
} from '../lib/videoAdminAlerts.js';
import { attachManualVideoUploadAndQueue } from './videos.js';
import { listStyleAdoptionTrends } from '../knowledge/styleMemory.js';
import {
  decryptSecret,
  getTenantPlatformApp,
  listTenantPlatformApps,
  publicTenantPlatformApp,
  tenantWebhookUrl,
  upsertTenantPlatformApp,
  type TenantPlatformAppRecord,
  type TenantPlatform,
} from '../lib/tenantPlatformApps.js';
import { store } from '../storage/index.js';
import axios from 'axios';
import { createLocalInviteTenant, getLocalTenant, listLocalTenants } from '../lib/localTenants.js';
import { decryptRegistrationPassword } from '../lib/registrationCredentials.js';

export const adminRouter = Router();

function trialDay(activatedAt?: string | null): number | null {
  if (!activatedAt) return null;
  const start = new Date(activatedAt).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.max(1, Math.floor((Date.now() - start) / (24 * 3600 * 1000)) + 1);
}

function accountStage(entry: { status?: string; activatedAt?: string | null; expiresAt?: string | null; rotatedAt?: string | null }): string {
  if (entry.status === 'admin') return '长期维护';
  if (entry.rotatedAt) return '已到期/已轮换密码';
  if (!entry.activatedAt) return '未激活';
  if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) return '已到期';
  return '试用中';
}

type VideoAlertAccountType = 'trial' | 'customer' | 'admin' | 'unknown';

interface VideoAlertAccountMeta {
  accountType: VideoAlertAccountType;
  accountTypeLabel: string;
  tenantName: string;
  accountEmail: string;
}

function localAccountId(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'demo';
}

function accountTypeLabel(type: VideoAlertAccountType): string {
  if (type === 'trial') return '试用账号';
  if (type === 'customer') return '正式账号';
  if (type === 'admin') return '管理员账号';
  return '未知账号';
}

async function listAllPbRecords<T extends Record<string, unknown>>(collection: string, sort?: string): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await pbListStrict<T>(collection, { page, perPage: 500, sort });
    items.push(...result.items);
    totalPages = Math.max(1, Math.min(100, result.totalPages || 1));
    page += 1;
  } while (page <= totalPages);
  return items;
}

let videoAlertSyncAt = 0;
let videoAlertSyncResult: VideoAlertReconciliation | null = null;
let videoAlertSyncPromise: Promise<VideoAlertReconciliation> | null = null;

interface VideoAlertReconciliation {
  ok: boolean;
  source: 'pocketbase' | 'snapshot' | 'alerts-only';
  scanned: number;
  synced: number;
  warning?: string;
}

function readTrendVideoSnapshot(): VideoFailureRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'data/trend-videos.json'), 'utf8')) as unknown;
    if (Array.isArray(parsed)) return parsed as VideoFailureRecord[];
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown[] }).items)) {
      return (parsed as { items: VideoFailureRecord[] }).items;
    }
  } catch {
    // Snapshot is optional; the live PocketBase collection remains primary.
  }
  return [];
}

async function reconcileStoredVideoAlerts(): Promise<VideoAlertReconciliation> {
  if (Date.now() - videoAlertSyncAt < 30_000 && videoAlertSyncResult) return videoAlertSyncResult;
  if (videoAlertSyncPromise) return videoAlertSyncPromise;

  videoAlertSyncPromise = (async () => {
    try {
      const records = await listAllPbRecords<VideoFailureRecord & Record<string, unknown>>('trend_videos', '-crawledAt');
      return {
        ok: true,
        source: 'pocketbase' as const,
        scanned: records.length,
        synced: syncVideoAdminAlertsFromRecords(records),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const snapshot = readTrendVideoSnapshot();
      if (snapshot.length) {
        console.warn(`[admin] video alert reconciliation using local snapshot after PocketBase failure: ${detail}`);
        return {
          ok: true,
          source: 'snapshot' as const,
          scanned: snapshot.length,
          synced: syncVideoAdminAlertsFromRecords(snapshot),
          warning: '实时视频数据库暂不可用，当前已从本地视频快照回扫失败记录。',
        };
      }
      console.warn('[admin] video alert reconciliation unavailable:', detail);
      return {
        ok: false,
        source: 'alerts-only' as const,
        scanned: 0,
        synced: 0,
        warning: '实时视频数据库和本地快照均不可用，当前仅显示已经写入的历史告警。',
      };
    }
  })();
  try {
    videoAlertSyncResult = await videoAlertSyncPromise;
    videoAlertSyncAt = Date.now();
    return videoAlertSyncResult;
  } finally {
    videoAlertSyncPromise = null;
  }
}

async function enrichVideoAlerts(alerts: VideoAdminAlert[]) {
  const directory = new Map<string, VideoAlertAccountMeta>();
  const setAccount = (tenantId: string, input: Partial<VideoAlertAccountMeta>) => {
    if (!tenantId) return;
    const existing = directory.get(tenantId);
    const accountType = input.accountType && input.accountType !== 'unknown'
      ? input.accountType
      : existing?.accountType || 'unknown';
    directory.set(tenantId, {
      accountType,
      accountTypeLabel: accountTypeLabel(accountType),
      tenantName: input.tenantName || existing?.tenantName || tenantId,
      accountEmail: input.accountEmail || existing?.accountEmail || '',
    });
  };

  const registry = readDemoAccountRegistry();
  for (const entry of Object.values(registry)) {
    const type: VideoAlertAccountType = entry.status === 'admin' ? 'admin' : 'trial';
    const slug = localAccountId(entry.email);
    const tenantIds = new Set([
      String(entry.tenantId || ''),
      `local_tenant_trial_${slug}`,
      `local_tenant_${slug}`,
      ...(type === 'admin' ? [`local_tenant_admin_${slug}`] : []),
    ]);
    for (const tenantId of tenantIds) {
      setAccount(tenantId, {
        accountType: type,
        tenantName: entry.email.split('@')[0] || entry.email,
        accountEmail: entry.email,
      });
    }
  }

  for (const tenant of listLocalTenants()) {
    const plan = tenant.subscriptionPlan.toLowerCase();
    const status = tenant.subscriptionStatus.toLowerCase();
    const accountType: VideoAlertAccountType = plan === 'trial' || status === 'trialing' ? 'trial' : 'customer';
    setAccount(tenant.id, {
      accountType,
      tenantName: tenant.companyName || tenant.name || tenant.id,
      accountEmail: tenant.registeredEmail || '',
    });
  }

  for (const alert of alerts) {
    if (directory.has(alert.tenantId)) continue;
    if (alert.tenantId.startsWith('local_tenant_trial_')) {
      setAccount(alert.tenantId, { accountType: 'trial' });
    } else if (alert.tenantId.startsWith('local_tenant_customer_')) {
      setAccount(alert.tenantId, { accountType: 'customer' });
    } else if (alert.tenantId.startsWith('local_tenant_admin_')) {
      setAccount(alert.tenantId, { accountType: 'admin' });
    }
  }

  try {
    const [tenants, users] = await Promise.all([
      listAllPbRecords<Record<string, unknown>>('tenants', 'name'),
      listAllPbRecords<Record<string, unknown>>('users', 'email'),
    ]);
    for (const tenant of tenants) {
      const tenantId = bodyText(tenant.id || tenant.tenantId);
      if (!tenantId) continue;
      const plan = bodyText(tenant.subscriptionPlan || tenant.plan).toLowerCase();
      const status = bodyText(tenant.subscriptionStatus || tenant.status).toLowerCase();
      const type: VideoAlertAccountType = plan === 'trial' || status === 'trialing'
        ? 'trial'
        : plan === 'admin' || status === 'admin'
          ? 'admin'
          : 'customer';
      const accountEmail = bodyText(tenant.registeredEmail)
        || bodyText(users.find(user => bodyText(user.tenantId) === tenantId)?.email);
      setAccount(tenantId, {
        accountType: type,
        tenantName: bodyText(tenant.name || tenant.companyName || tenant.company) || tenantId,
        accountEmail,
      });
    }
  } catch (error) {
    console.warn('[admin] video alert account metadata unavailable:', error instanceof Error ? error.message : error);
  }

  return alerts.map(alert => {
    const fallbackType: VideoAlertAccountType = alert.tenantId.includes('_trial_')
      ? 'trial'
      : alert.tenantId.includes('_customer_')
        ? 'customer'
        : 'unknown';
    const account = directory.get(alert.tenantId) || {
      accountType: fallbackType,
      accountTypeLabel: accountTypeLabel(fallbackType),
      tenantName: alert.tenantId,
      accountEmail: '',
    };
    return { ...alert, ...account };
  });
}

async function safePbGet(collection: string, id?: string | null) {
  if (!id) return null;
  try {
    return await pbGet(collection, id);
  } catch {
    return null;
  }
}

function bodyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function platformParam(value: unknown): TenantPlatform | null {
  const platform = bodyText(value);
  return platform === 'meta' || platform === 'google' ? platform : null;
}

function graphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || 'v25.0';
}

function inviteCode(): string {
  return crypto.randomBytes(8).toString('base64url');
}

function publicPendingPlatformApp(req: Parameters<typeof publicTenantPlatformApp>[0], tenantId: string, platform: TenantPlatform) {
  return {
    id: '',
    tenantId,
    platform,
    appId: '',
    appSecretSet: false,
    waConfigId: '',
    businessId: '',
    wabaId: '',
    phoneNumberId: '',
    pageId: '',
    igUserId: '',
    youtubeChannelId: '',
    webhookVerifyToken: '',
    webhookUrl: platform === 'meta' ? tenantWebhookUrl(req, tenantId) : '',
    tokenType: 'user_60d',
    accessTokenSet: false,
    tokenExpiresAt: '',
    status: 'pending',
    checklist: {},
    notes: '',
  };
}

function publicDeliveryTenant(req: Parameters<typeof publicTenantPlatformApp>[0], tenant: Record<string, any>, apps: Awaited<ReturnType<typeof listTenantPlatformApps>>) {
  const tenantId = String(tenant.id || tenant.tenantId || '');
  const name = String(tenant?.name || tenant?.companyName || tenant?.company || tenantId);
  const inviteParams = new URLSearchParams({
    invite: String(tenant?.inviteCode || ''),
    company: name,
  });
  return {
    tenantId,
    name,
    contactName: String(tenant?.contactName || tenant?.contact || ''),
    industry: String(tenant?.industry || ''),
    notes: String(tenant?.notes || ''),
    inviteCode: String(tenant?.inviteCode || ''),
    inviteUrl: tenant?.inviteCode ? `${getPublicOrigin(req)}/register?${inviteParams.toString()}` : '',
    apps: (['meta', 'google'] as TenantPlatform[]).map(platform => {
      const app = apps.find(item => item.tenant_id === tenantId && item.platform === platform);
      return app ? publicTenantPlatformApp(req, app) : publicPendingPlatformApp(req, tenantId, platform);
    }),
  };
}

const DELIVERY_TEST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readChecklist(app?: { last_checklist?: string }): Record<string, any> {
  try {
    const parsed = JSON.parse(bodyText(app?.last_checklist) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function passedRecently(checklist: Record<string, any>, id: string) {
  if (!checklist[id]) return false;
  const timestamp = bodyText(checklist[`${id}_at`]);
  if (!timestamp) return false;
  const passedAt = Date.parse(timestamp);
  return Number.isFinite(passedAt) && Date.now() - passedAt <= DELIVERY_TEST_MAX_AGE_MS;
}

function missingDeliveryRequirements(platform: TenantPlatform, app: any): string[] {
  const checklist = readChecklist(app);
  const appSecret = decryptSecret(app?.app_secret);
  const missing: string[] = [];
  if (!bodyText(app?.app_id)) missing.push('App ID');
  if (!appSecret) missing.push('App Secret');
  if (platform === 'meta') {
    if (!bodyText(app?.phone_number_id)) missing.push('Phone Number ID');
    if (!passedRecently(checklist, 'whatsapp_test_passed')) missing.push('WhatsApp 最近自检通过');
    if (!passedRecently(checklist, 'pages_test_passed')) missing.push('主页列表最近自检通过');
    if (!passedRecently(checklist, 'webhook_test_passed')) missing.push('Webhook 订阅最近自检通过');
  } else {
    if (!passedRecently(checklist, 'google_test_passed')) missing.push('Google OAuth 最近自检通过');
  }
  return missing;
}

function publicOAuthConfig(req: Parameters<typeof oauthCallbackUrls>[0], adminEmail: string) {
  const stored = readOAuthConfig();
  const effective = effectiveOAuthConfig();
  return {
    admin: adminEmail,
    updatedAt: stored.updatedAt ?? null,
    callbacks: oauthCallbackUrls(req),
    values: {
      youtubeOAuthClientId: effective.youtubeOAuthClientId,
      metaSocialAppId: effective.metaSocialAppId,
      tiktokClientKey: effective.tiktokClientKey,
      advancedManualConnectEnabled: effective.advancedManualConnectEnabled,
    },
    secretSet: {
      youtubeOAuthClientSecret: Boolean(effective.youtubeOAuthClientSecret),
      metaSocialAppSecret: Boolean(effective.metaSocialAppSecret),
      tiktokClientSecret: Boolean(effective.tiktokClientSecret),
    },
  };
}

adminRouter.get('/demo-accounts', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');

  const limits = demoLimits();
  const registry = readDemoAccountRegistry();
  const trialAccounts = await Promise.all(Object.values(registry)
    .sort((a, b) => a.email.localeCompare(b.email))
    .filter(entry => entry.status !== 'admin')
    .map(async entry => {
      const tenant = await safePbGet('tenants', entry.tenantId);
      const expiresAt = String(tenant?.subscriptionExpiresAt ?? entry.expiresAt ?? '') || null;
      const activatedAt = entry.activatedAt ?? null;
      const usage = demoUsageForUser(entry.userId);
      const day = trialDay(activatedAt);
      return {
        email: entry.email,
        tenantId: String(entry.tenantId || ''),
        tenantName: String(tenant?.name || entry.email.split('@')[0] || entry.tenantId || ''),
        password: entry.password,
        status: accountStage({ ...entry, expiresAt }),
        activatedAt,
        expiresAt,
        trialDay: day,
        trialDays: entry.status === 'admin' ? null : limits.trialDays,
        daysRemaining: expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 3600 * 1000))) : null,
        tokenUsedToday: usage.todayTokens,
        tokenUsedTotal: usage.totalTokens,
        tokenLimit: entry.status === 'admin' ? null : limits.tokenTotal,
        aiChatToday: usage.aiChat,
        generationToday: usage.generation,
        renderToday: usage.render,
        videoGenerationToday: usage.videoGeneration,
        rotatedAt: entry.rotatedAt ?? null,
        rotationPassword: entry.rotationPassword ?? null,
      };
    }));

  let customerAccounts: Array<{
    tenantId: string;
    companyName: string;
    contactName: string;
    industry: string;
    emails: string[];
    password: string;
    inviteCode: string;
    subscriptionPlan: string;
    subscriptionStatus: string;
    createdAt: string | null;
    registeredAt: string | null;
    expiresAt: string | null;
  }> = [];

  try {
    const [tenants, users] = await Promise.all([
      pbListStrict<Record<string, unknown>>('tenants', { perPage: 500, sort: '-created' }),
      pbListStrict<Record<string, unknown>>('users', { perPage: 500, sort: 'email' }),
    ]);
    const trialTenantIds = new Set(trialAccounts.map(account => String(registry[account.email]?.tenantId || '')).filter(Boolean));
    customerAccounts = tenants.items
      .map(tenant => {
        const tenantId = String(tenant.id || tenant.tenantId || '');
        const subscriptionPlan = String(tenant.subscriptionPlan || '未设置');
        const subscriptionStatus = String(tenant.subscriptionStatus || '未设置');
        const registeredEmail = String(tenant.registeredEmail || '').trim().toLowerCase();
        const emails = users.items
          .filter(user => String(user.tenantId || '') === tenantId)
          .map(user => String(user.email || '').trim().toLowerCase())
          .filter(Boolean);
        if (registeredEmail) emails.unshift(registeredEmail);
        return {
          tenantId,
          companyName: String(tenant.name || tenant.companyName || tenant.company || tenantId),
          contactName: String(tenant.contactName || tenant.contact || ''),
          industry: String(tenant.industry || ''),
          emails: Array.from(new Set(emails)),
          password: decryptRegistrationPassword(String(tenant.registeredPasswordCipher || '')),
          inviteCode: String(tenant.registrationInviteCode || tenant.inviteCode || ''),
          subscriptionPlan,
          subscriptionStatus,
          createdAt: String(tenant.created || tenant.createdAt || '') || null,
          registeredAt: String(tenant.registeredAt || '') || null,
          expiresAt: String(tenant.subscriptionExpiresAt || '') || null,
        };
      })
      .filter(account => account.tenantId && !trialTenantIds.has(account.tenantId))
      .filter(account => !['trial', 'local', 'admin'].includes(account.subscriptionPlan.toLowerCase()))
      .sort((a, b) => a.companyName.localeCompare(b.companyName));
  } catch (error) {
    console.warn('[admin] customer account list unavailable:', error instanceof Error ? error.message : error);
  }

  const localCustomerAccounts = listLocalTenants()
    .filter(tenant => tenant.subscriptionStatus === 'active' && tenant.subscriptionPlan === 'customer')
    .map(tenant => ({
      tenantId: tenant.id,
      companyName: tenant.companyName || tenant.name,
      contactName: tenant.contactName,
      industry: tenant.industry,
      emails: tenant.registeredEmail ? [tenant.registeredEmail] : [],
      password: decryptRegistrationPassword(tenant.registeredPasswordCipher),
      inviteCode: tenant.registrationInviteCode || tenant.inviteCode,
      subscriptionPlan: tenant.subscriptionPlan,
      subscriptionStatus: tenant.subscriptionStatus,
      createdAt: tenant.createdAt || null,
      registeredAt: tenant.registeredAt || null,
      expiresAt: tenant.subscriptionExpiresAt,
    }));
  const existingCustomerIds = new Set(customerAccounts.map(account => account.tenantId));
  customerAccounts.push(...localCustomerAccounts.filter(account => !existingCustomerIds.has(account.tenantId)));
  customerAccounts.sort((a, b) => a.companyName.localeCompare(b.companyName));

  res.json({ admin: admin.email, trialAccounts, customerAccounts });
});

adminRouter.post('/support-access/session', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  const tenantId = bodyText(req.body?.tenantId);
  if (!tenantId || tenantId === admin.tenantId) {
    res.status(400).json({ error: 'invalid_tenant' });
    return;
  }
  if (!supportAccessDefaultAuthorized(tenantId)) {
    res.status(403).json({ error: 'support_access_disabled' });
    return;
  }

  const registryEntry = Object.values(readDemoAccountRegistry()).find(entry => entry.tenantId === tenantId);
  const localTenant = getLocalTenant(tenantId);
  const remoteTenant = await safePbGet('tenants', tenantId);
  if (!registryEntry && !localTenant && !remoteTenant) {
    res.status(404).json({ error: 'tenant_not_found' });
    return;
  }

  const tenantName = bodyText(remoteTenant?.name)
    || localTenant?.companyName
    || localTenant?.name
    || bodyText(req.body?.tenantName)
    || registryEntry?.email?.split('@')[0]
    || tenantId;
  const request = createSupportAccessRequest({
    tenantId,
    tenantName,
    requestedByUserId: admin.userId,
    requestedByEmail: admin.email,
  });
  const session = issueSupportAccessToken(request.id, admin.userId);
  if (!session) {
    res.status(403).json({ error: 'support_access_disabled' });
    return;
  }
  res.json(session);
});

adminRouter.get('/video-alerts', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }

  res.setHeader('Cache-Control', 'no-store');
  const reconciliation = await reconcileStoredVideoAlerts();

  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 100) || 100));
  const includeResolved = req.query.includeResolved === 'true';
  const items = await enrichVideoAlerts(listVideoAdminAlerts(limit, includeResolved));
  const summary = items.reduce((counts, item) => {
    counts.total += 1;
    counts[item.accountType] += 1;
    return counts;
  }, { total: 0, trial: 0, customer: 0, admin: 0, unknown: 0 });

  res.json({ admin: admin.email, items, summary, reconciliation });
});

adminRouter.post('/video-alerts/:id/upload', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }

  const alert = getVideoAdminAlert(req.params.id);
  if (!alert) {
    res.status(404).json({ error: 'video_alert_not_found' });
    return;
  }

  const body = req.body ?? {};
  const recordId = bodyText(body.recordId) || alert.recordId;
  if (recordId !== alert.recordId) {
    res.status(400).json({ error: 'record_id_mismatch' });
    return;
  }

  const videoBase64 = bodyText(body.videoBase64);
  if (!videoBase64) {
    res.status(400).json({ error: 'videoBase64_required' });
    return;
  }

  try {
    const result = await attachManualVideoUploadAndQueue({
      recordId: alert.recordId,
      videoBase64,
      mimeType: bodyText(body.mimeType) || 'video/mp4',
      filename: bodyText(body.filename) || 'manual-video.mp4',
      uploadedBy: admin.userId,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : 'manual_video_upload_failed' });
  }
});

adminRouter.get('/oauth-config', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  res.json(publicOAuthConfig(req, admin.email));
});

adminRouter.put('/oauth-config', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }

  const body = req.body ?? {};
  const patch: Partial<StoredOAuthConfig> = {
    youtubeOAuthClientId: bodyText(body.youtubeOAuthClientId),
    metaSocialAppId: bodyText(body.metaSocialAppId),
    tiktokClientKey: bodyText(body.tiktokClientKey),
    advancedManualConnectEnabled: body.advancedManualConnectEnabled === true,
  };

  const youtubeSecret = bodyText(body.youtubeOAuthClientSecret);
  const metaSecret = bodyText(body.metaSocialAppSecret);
  const tiktokSecret = bodyText(body.tiktokClientSecret);
  if (youtubeSecret) patch.youtubeOAuthClientSecret = youtubeSecret;
  if (metaSecret) patch.metaSocialAppSecret = metaSecret;
  if (tiktokSecret) patch.tiktokClientSecret = tiktokSecret;

  writeOAuthConfig(patch);
  res.json(publicOAuthConfig(req, admin.email));
});

adminRouter.get('/delivery/platform-apps', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }

  let tenants: { items: Record<string, any>[] } | undefined;
  let apps: TenantPlatformAppRecord[] | undefined;
  try {
    [tenants, apps] = await Promise.all([
      pbListStrict<Record<string, any>>('tenants', { perPage: 200 }),
      pbListStrict<TenantPlatformAppRecord>('tenant_platform_apps', { perPage: 500, sort: 'tenant_id' }).then(result => result.items),
    ]);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      tenants = { items: listLocalTenants() as unknown as Record<string, any>[] };
      apps = [];
    } else {
      const detail = error instanceof Error ? error.message : 'unknown_error';
      res.status(503).json({ error: 'tenants_unavailable', detail });
      return;
    }
  }
  if (!tenants || !apps) {
    res.status(503).json({ error: 'tenants_unavailable', detail: 'unknown_error' });
    return;
  }
  const tenantIds = new Set<string>([
    ...tenants.items.map(item => String(item.id || item.tenantId || '')).filter(Boolean),
    ...apps.map(app => app.tenant_id),
  ]);

  res.json({
    admin: admin.email,
    tenants: Array.from(tenantIds).map(tenantId => {
      const tenant = tenants.items.find(item => item.id === tenantId || item.tenantId === tenantId) || { id: tenantId, name: tenantId };
      return publicDeliveryTenant(req, tenant, apps);
    }),
  });
});

adminRouter.get('/style-adoption-trends', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  res.json({ admin: admin.email, items: await listStyleAdoptionTrends() });
});

adminRouter.post('/delivery/tenants', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }

  const companyName = bodyText(req.body?.companyName) || bodyText(req.body?.name);
  if (!companyName) {
    res.status(400).json({ error: 'company_name_required', message: '公司名称必填' });
    return;
  }
  const code = inviteCode();
  const now = new Date().toISOString();
  try {
    let tenant = await store.create<Record<string, any>>('tenants', {
      name: companyName,
      companyName,
      contactName: bodyText(req.body?.contactName) || bodyText(req.body?.contact),
      contact: bodyText(req.body?.contactName) || bodyText(req.body?.contact),
      industry: bodyText(req.body?.industry),
      notes: bodyText(req.body?.notes),
      inviteCode: code,
      subscriptionStatus: 'pending_delivery',
      subscriptionPlan: 'delivery',
      createdAt: now,
    });
    if (!tenant && process.env.NODE_ENV !== 'production') {
      tenant = createLocalInviteTenant({
        companyName,
        contactName: bodyText(req.body?.contactName) || bodyText(req.body?.contact),
        industry: bodyText(req.body?.industry),
        notes: bodyText(req.body?.notes),
        inviteCode: code,
      });
    }
    if (!tenant) throw new Error('tenant_create_failed');
    res.json({
      ok: true,
      tenant: publicDeliveryTenant(req, tenant, []),
    });
  } catch (error) {
    res.status(500).json({ error: 'tenant_create_failed', detail: error instanceof Error ? error.message : 'unknown_error' });
  }
});

adminRouter.put('/delivery/platform-apps/:tenantId/:platform', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  const platform = platformParam(req.params.platform);
  if (!platform) {
    res.status(400).json({ error: 'invalid_platform' });
    return;
  }
  try {
    const app = await upsertTenantPlatformApp({
      tenantId: bodyText(req.params.tenantId),
      platform,
      appId: bodyText(req.body?.appId),
      appSecret: bodyText(req.body?.appSecret),
      waConfigId: bodyText(req.body?.waConfigId),
      businessId: bodyText(req.body?.businessId),
      wabaId: bodyText(req.body?.wabaId),
      phoneNumberId: bodyText(req.body?.phoneNumberId),
      pageId: bodyText(req.body?.pageId),
      igUserId: bodyText(req.body?.igUserId),
      youtubeChannelId: bodyText(req.body?.youtubeChannelId),
      tokenType: req.body?.tokenType === 'system_user_permanent' ? 'system_user_permanent' : 'user_60d',
      accessToken: bodyText(req.body?.accessToken),
      tokenExpiresAt: bodyText(req.body?.tokenExpiresAt),
      status: bodyText(req.body?.status) as any || 'pending',
      checklist: req.body?.checklist && typeof req.body.checklist === 'object' ? req.body.checklist : undefined,
      notes: bodyText(req.body?.notes),
    });
    res.json({ ok: true, app: publicTenantPlatformApp(req, app) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'platform_app_save_failed' });
  }
});

adminRouter.post('/delivery/platform-apps/:tenantId/:platform/complete', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  const platform = platformParam(req.params.platform);
  if (!platform) {
    res.status(400).json({ error: 'invalid_platform' });
    return;
  }
  const tenantId = bodyText(req.params.tenantId);
  const existing = await getTenantPlatformApp(tenantId, platform);
  const missing = missingDeliveryRequirements(platform, existing);
  if (!existing || missing.length > 0) {
    const message = `交付完成前还缺：${missing.join('、')}`;
    res.status(409).json({
      error: message,
      code: 'delivery_requirements_missing',
      missing,
      message,
    });
    return;
  }
  const app = await upsertTenantPlatformApp({
    tenantId,
    platform,
    status: 'active',
    notes: bodyText(req.body?.notes),
  });
  res.json({ ok: true, app: publicTenantPlatformApp(req, app) });
});

adminRouter.post('/delivery/platform-apps/:tenantId/:platform/test/:kind', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  const tenantId = bodyText(req.params.tenantId);
  const platform = platformParam(req.params.platform);
  const kind = bodyText(req.params.kind);
  if (!platform) {
    res.status(400).json({ ok: false, error: 'invalid_platform' });
    return;
  }

  const app = await getTenantPlatformApp(tenantId, platform);
  const token = decryptSecret(app?.access_token);
  const appSecret = decryptSecret(app?.app_secret);
  const markTestPassed = async (id: string) => {
    if (!app) return;
    await upsertTenantPlatformApp({
      tenantId,
      platform,
      checklist: {
        ...readChecklist(app),
        [id]: true,
        [`${id}_at`]: new Date().toISOString(),
      } as any,
    });
  };
  try {
    if (!app) throw new Error('请先保存该租户的平台应用配置');
    if (kind === 'pages') {
      if (platform !== 'meta') throw new Error('主页列表自检仅适用于 Meta');
      if (!token) throw new Error('请先录入访问 token');
      const resp = await axios.get(`https://graph.facebook.com/${graphVersion()}/me/accounts`, {
        params: { access_token: token, fields: 'id,name', limit: 10 },
      });
      await markTestPassed('pages_test_passed');
      res.json({ ok: true, message: `已拉取 ${resp.data?.data?.length ?? 0} 个主页`, data: resp.data?.data ?? [] });
      return;
    }
    if (kind === 'webhook') {
      if (platform !== 'meta') throw new Error('Webhook 自检仅适用于 Meta');
      if (!app.app_id || !token) throw new Error('请先录入 App ID 和访问 token');
      const resp = await axios.get(`https://graph.facebook.com/${graphVersion()}/${app.app_id}/subscriptions`, {
        params: { access_token: token },
      });
      await markTestPassed('webhook_test_passed');
      res.json({ ok: true, message: 'Webhook 订阅状态已返回', data: resp.data?.data ?? [] });
      return;
    }
    if (kind === 'whatsapp') {
      if (platform !== 'meta') throw new Error('WhatsApp 自检仅适用于 Meta');
      if (!token) throw new Error('请先录入 token');
      if (!app.phone_number_id && !app.wa_config_id) throw new Error('请先录入 Phone Number ID 或 WhatsApp Embedded Signup Config ID');
      await markTestPassed('whatsapp_test_passed');
      res.json({ ok: true, message: app.phone_number_id ? 'WhatsApp Phone Number ID 已保存，可继续真实发送测试。' : 'WhatsApp Config ID 已保存，可继续 Embedded Signup。' });
      return;
    }
    if (kind === 'google') {
      if (platform !== 'google') throw new Error('Google 自检仅适用于 Google');
      if (!app.app_id || !appSecret) throw new Error('请先录入 Google Client ID / Secret');
      await markTestPassed('google_test_passed');
      res.json({ ok: true, message: 'Google OAuth 应用信息已保存，等待用户授权验证。' });
      return;
    }
    throw new Error('未知自检项');
  } catch (error: any) {
    const msg = error?.response?.data?.error?.message || error?.message || '自检失败';
    res.status(400).json({ ok: false, error: msg });
  }
});
