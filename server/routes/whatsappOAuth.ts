import axios from 'axios';
import { Router } from 'express';
import { requireAdminUser } from '../lib/demoAccounts.js';
import {
  decryptSecret,
  getTenantPlatformApp,
  publicTenantPlatformApp,
  upsertTenantPlatformApp,
} from '../lib/tenantPlatformApps.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';

export const whatsappOAuthRouter = Router();

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function graphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || 'v25.0';
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return '';
}

function sessionData(input: any): Record<string, any> {
  const raw = input?.sessionInfo ?? input?.session_info ?? input?.data ?? {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? raw : {};
}

function wabaIdFrom(input: any): string {
  const data = sessionData(input);
  return firstText(
    input?.wabaId,
    input?.waba_id,
    input?.wabaID,
    data?.waba_id,
    data?.wabaId,
    data?.wabaID,
    data?.business_account_id,
    data?.whatsapp_business_account_id,
  );
}

function phoneNumberIdFrom(input: any): string {
  const data = sessionData(input);
  return firstText(
    input?.phoneNumberId,
    input?.phone_number_id,
    input?.phoneNumberID,
    data?.phone_number_id,
    data?.phoneNumberId,
    data?.phoneNumberID,
    data?.phone_number?.id,
    data?.phone?.id,
  );
}

async function tenantForRequest(req: any, res: any): Promise<string | null> {
  const { tenantId } = res.locals as AuthLocals;
  const requestedTenantId = text(req.body?.tenantId || req.query?.tenantId);
  if (!requestedTenantId || requestedTenantId === tenantId) return tenantId;
  const admin = await requireAdminUser(req);
  return admin ? requestedTenantId : null;
}

async function exchangeCodeForLongLivedToken(input: {
  appId: string;
  appSecret: string;
  code: string;
}): Promise<{ accessToken: string; expiresAt: string }> {
  const shortTokenResp = await axios.get(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`, {
    params: {
      client_id: input.appId,
      client_secret: input.appSecret,
      code: input.code,
    },
  });
  const shortToken = text(shortTokenResp.data?.access_token);
  if (!shortToken) throw new Error('meta_code_exchange_returned_empty_token');

  const longTokenResp = await axios.get(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: input.appId,
      client_secret: input.appSecret,
      fb_exchange_token: shortToken,
    },
  });
  const accessToken = text(longTokenResp.data?.access_token) || shortToken;
  const expiresIn = Number(longTokenResp.data?.expires_in || shortTokenResp.data?.expires_in || 60 * 24 * 3600);
  return {
    accessToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

whatsappOAuthRouter.get('/config', requireAuth, async (req, res) => {
  const tenantId = await tenantForRequest(req, res);
  if (!tenantId) {
    res.status(403).json({ error: 'tenant_not_allowed' });
    return;
  }
  const app = await getTenantPlatformApp(tenantId, 'meta');
  const appId = text(app?.app_id);
  const configId = text(app?.wa_config_id);
  res.json({
    tenantId,
    appId,
    configId,
    configured: Boolean(appId && configId && decryptSecret(app?.app_secret)),
    missing: {
      appId: !appId,
      appSecret: !decryptSecret(app?.app_secret),
      configId: !configId,
    },
  });
});

whatsappOAuthRouter.post('/exchange', requireAuth, async (req, res) => {
  const tenantId = await tenantForRequest(req, res);
  if (!tenantId) {
    res.status(403).json({ error: 'tenant_not_allowed' });
    return;
  }

  const code = text(req.body?.code);
  const wabaId = wabaIdFrom(req.body);
  const phoneNumberId = phoneNumberIdFrom(req.body);
  if (!code) {
    res.status(400).json({ error: 'embedded_signup_code_required' });
    return;
  }
  if (!wabaId || !phoneNumberId) {
    res.status(400).json({ error: 'embedded_signup_session_info_incomplete' });
    return;
  }

  const app = await getTenantPlatformApp(tenantId, 'meta');
  const appId = text(app?.app_id);
  const appSecret = decryptSecret(app?.app_secret);
  if (!appId || !appSecret) {
    res.status(409).json({ error: 'tenant_meta_app_not_configured' });
    return;
  }

  try {
    const token = await exchangeCodeForLongLivedToken({ appId, appSecret, code });
    const checklist = (() => {
      try {
        return JSON.parse(text(app?.last_checklist) || '{}');
      } catch {
        return {};
      }
    })();
    const updated = await upsertTenantPlatformApp({
      tenantId,
      platform: 'meta',
      wabaId,
      phoneNumberId,
      accessToken: token.accessToken,
      tokenExpiresAt: token.expiresAt,
      tokenType: 'user_60d',
      status: 'active',
      checklist: {
        ...checklist,
        customer_scanned: true,
        whatsapp_embedded_signup_done: true,
      },
    });
    res.json({ ok: true, app: publicTenantPlatformApp(req, updated) });
  } catch (error: any) {
    res.status(502).json({
      error: 'whatsapp_exchange_failed',
      message: error?.response?.data?.error?.message || error?.message || 'WhatsApp exchange failed',
    });
  }
});
