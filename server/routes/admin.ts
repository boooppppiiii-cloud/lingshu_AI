import { Router } from 'express';
import { pbGet } from '../storage/pb.js';
import { demoLimits } from '../lib/demo.js';
import {
  effectiveOAuthConfig,
  oauthCallbackUrls,
  readOAuthConfig,
  writeOAuthConfig,
  type StoredOAuthConfig,
} from '../lib/oauthConfig.js';
import {
  demoUsageForUser,
  readDemoAccountRegistry,
  requireAdminUser,
} from '../lib/demoAccounts.js';
import { getVideoAdminAlert, listVideoAdminAlerts } from '../lib/videoAdminAlerts.js';
import { attachManualVideoUploadAndQueue } from './videos.js';
import {
  decryptSecret,
  getTenantPlatformApp,
  listTenantPlatformApps,
  publicTenantPlatformApp,
  tenantWebhookUrl,
  upsertTenantPlatformApp,
  type TenantPlatform,
} from '../lib/tenantPlatformApps.js';
import { store } from '../storage/index.js';
import axios from 'axios';

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

  const limits = demoLimits();
  const registry = readDemoAccountRegistry();
  const accounts = await Promise.all(Object.values(registry)
    .sort((a, b) => a.email.localeCompare(b.email))
    .map(async entry => {
      const tenant = await safePbGet('tenants', entry.tenantId);
      const expiresAt = String(tenant?.subscriptionExpiresAt ?? entry.expiresAt ?? '') || null;
      const activatedAt = entry.activatedAt ?? null;
      const usage = demoUsageForUser(entry.userId);
      const day = trialDay(activatedAt);
      return {
        email: entry.email,
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

  res.json({ admin: admin.email, accounts });
});

adminRouter.get('/video-alerts', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }

  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50) || 50));
  res.json({ admin: admin.email, items: listVideoAdminAlerts(limit) });
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

  const [tenants, apps] = await Promise.all([
    store.list<Record<string, any>>('tenants', { perPage: 200 }).catch(() => ({ items: [], totalItems: 0, totalPages: 0, page: 1, perPage: 200 })),
    listTenantPlatformApps(),
  ]);
  const tenantIds = new Set<string>([
    ...tenants.items.map(item => String(item.id || item.tenantId || '')).filter(Boolean),
    ...apps.map(app => app.tenant_id),
  ]);

  res.json({
    admin: admin.email,
    tenants: Array.from(tenantIds).map(tenantId => {
      const tenant = tenants.items.find(item => item.id === tenantId || item.tenantId === tenantId);
      return {
        tenantId,
        name: String(tenant?.name || tenant?.companyName || tenant?.company || tenantId),
        apps: (['meta', 'google'] as TenantPlatform[]).map(platform => {
          const app = apps.find(item => item.tenant_id === tenantId && item.platform === platform);
          return app ? publicTenantPlatformApp(req, app) : {
            id: '',
            tenantId,
            platform,
            appId: '',
            appSecretSet: false,
            waConfigId: '',
            webhookVerifyToken: '',
            webhookUrl: platform === 'meta' ? tenantWebhookUrl(req, tenantId) : '',
            tokenType: 'user_60d',
            accessTokenSet: false,
            tokenExpiresAt: '',
            status: 'pending',
            notes: '',
          };
        }),
      };
    }),
  });
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
      tokenType: req.body?.tokenType === 'system_user_permanent' ? 'system_user_permanent' : 'user_60d',
      accessToken: bodyText(req.body?.accessToken),
      tokenExpiresAt: bodyText(req.body?.tokenExpiresAt),
      status: bodyText(req.body?.status) as any || 'pending',
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
  const app = await upsertTenantPlatformApp({
    tenantId: bodyText(req.params.tenantId),
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
  try {
    if (!app) throw new Error('请先保存该租户的平台应用配置');
    if (kind === 'pages') {
      if (platform !== 'meta') throw new Error('主页列表自检仅适用于 Meta');
      if (!token) throw new Error('请先录入访问 token');
      const resp = await axios.get(`https://graph.facebook.com/${graphVersion()}/me/accounts`, {
        params: { access_token: token, fields: 'id,name', limit: 10 },
      });
      res.json({ ok: true, message: `已拉取 ${resp.data?.data?.length ?? 0} 个主页`, data: resp.data?.data ?? [] });
      return;
    }
    if (kind === 'webhook') {
      if (platform !== 'meta') throw new Error('Webhook 自检仅适用于 Meta');
      if (!app.app_id || !token) throw new Error('请先录入 App ID 和访问 token');
      const resp = await axios.get(`https://graph.facebook.com/${graphVersion()}/${app.app_id}/subscriptions`, {
        params: { access_token: token },
      });
      res.json({ ok: true, message: 'Webhook 订阅状态已返回', data: resp.data?.data ?? [] });
      return;
    }
    if (kind === 'whatsapp') {
      if (platform !== 'meta') throw new Error('WhatsApp 自检仅适用于 Meta');
      if (!token) throw new Error('请先录入访问 token');
      if (!app.wa_config_id) throw new Error('请先录入 WhatsApp Embedded Signup config id 或在备注中记录 phone_number_id');
      res.json({ ok: true, message: 'WhatsApp 配置已存在。真实测试发送需要 phone_number_id 和测试收件手机号，后续可继续扩展。' });
      return;
    }
    if (kind === 'google') {
      if (platform !== 'google') throw new Error('Google 自检仅适用于 Google');
      if (!app.app_id || !appSecret) throw new Error('请先录入 Google Client ID / Secret');
      res.json({ ok: true, message: 'Google OAuth 应用信息已保存，等待用户授权验证。' });
      return;
    }
    throw new Error('未知自检项');
  } catch (error: any) {
    const msg = error?.response?.data?.error?.message || error?.message || '自检失败';
    res.status(400).json({ ok: false, error: msg });
  }
});
