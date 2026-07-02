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
