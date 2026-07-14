import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { requireAdminUser } from '../lib/demoAccounts.js';
import {
  getTenantAwareGoogleOAuthClient,
  getTenantAwareMetaOAuthClient,
} from '../lib/oauthConfig.js';
import { signOAuthState, type TenantPlatform } from '../lib/tenantPlatformApps.js';
import { store } from '../storage/index.js';

export const assistLinksRouter = Router();

interface AssistLinkRecord {
  id: string;
  token: string;
  tenant_id: string;
  platform: TenantPlatform;
  expires_at: string;
  used_at?: string;
  created_by?: string;
}

const COL = 'assist_links';
const GOOGLE_OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const META_AUTH_URL = 'https://www.facebook.com';
const ASSIST_TTL_MS = 24 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const YOUTUBE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];
const META_SCOPES = [
  'pages_show_list',
  'pages_manage_metadata',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_read_user_content',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
];

function bodyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function platformParam(value: unknown): TenantPlatform | null {
  const platform = bodyText(value);
  return platform === 'meta' || platform === 'google' ? platform : null;
}

function publicOrigin(req: Request) {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, '');
  if (configured && !configured.includes('your-domain.com')) return configured;
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || req.protocol || 'http';
  const host = req.get('host') || `localhost:${process.env.PORT ?? 8788}`;
  return `${proto}://${host}`;
}

function graphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || 'v25.0';
}

function platformName(platform: TenantPlatform) {
  return platform === 'meta' ? 'Meta / Facebook / Instagram' : 'Google / YouTube';
}

function tokenExpired(record: AssistLinkRecord) {
  return new Date(record.expires_at).getTime() <= Date.now();
}

function publicRecord(record: AssistLinkRecord) {
  return {
    token: record.token,
    tenantId: record.tenant_id,
    platform: record.platform,
    platformName: platformName(record.platform),
    expiresAt: record.expires_at,
    usedAt: record.used_at || '',
    valid: !record.used_at && !tokenExpired(record),
  };
}

async function findByToken(token: string): Promise<AssistLinkRecord | null> {
  const result = await store.list<AssistLinkRecord>(COL, { where: { token }, perPage: 1 });
  return result.items[0] ?? null;
}

async function findTenantUserId(tenantId: string) {
  const result = await store.list<Record<string, unknown>>('users', { where: { tenantId }, perPage: 1 });
  return bodyText(result.items[0]?.id) || `assist_${tenantId}`;
}

assistLinksRouter.post('/admin/assist-links', async (req, res) => {
  const admin = await requireAdminUser(req);
  if (!admin) {
    res.status(403).json({ error: 'admin_required' });
    return;
  }

  const tenantId = bodyText(req.body?.tenantId);
  const platform = platformParam(req.body?.platform);
  if (!tenantId || !platform) {
    res.status(400).json({ error: 'tenantId_and_platform_required' });
    return;
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + ASSIST_TTL_MS).toISOString();
  const record = await store.create<AssistLinkRecord>(COL, {
    token,
    tenant_id: tenantId,
    platform,
    expires_at: expiresAt,
    used_at: '',
    created_by: admin.userId,
  });
  if (!record) {
    res.status(500).json({ error: 'assist_link_create_failed' });
    return;
  }

  res.json({
    ok: true,
    link: `${publicOrigin(req)}/assist/${encodeURIComponent(token)}`,
    ...publicRecord(record),
  });
});

assistLinksRouter.get('/assist-links/:token', async (req, res) => {
  const token = bodyText(req.params.token);
  const record = token ? await findByToken(token) : null;
  if (!record) {
    res.status(404).json({ valid: false, error: 'not_found' });
    return;
  }
  res.json(publicRecord(record));
});

assistLinksRouter.post('/assist-links/:token/start', async (req, res) => {
  const token = bodyText(req.params.token);
  const record = token ? await findByToken(token) : null;
  if (!record || record.used_at || tokenExpired(record)) {
    res.status(410).json({ error: 'assist_link_invalid_or_expired' });
    return;
  }

  const tenantId = record.tenant_id;
  const userId = await findTenantUserId(tenantId);
  const returnTo = `/assist/${encodeURIComponent(record.token)}?done=1`;
  const oauthState = signOAuthState({
    userId,
    tenantId,
    platform: record.platform === 'google' ? 'youtube' : 'facebook',
    returnTo,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  });

  if (record.platform === 'google') {
    const client = await getTenantAwareGoogleOAuthClient(tenantId);
    if (!client) {
      res.status(503).json({ error: 'google_oauth_not_configured' });
      return;
    }
    const redirectUri = `${publicOrigin(req)}/api/overseas/youtube/oauth/callback`;
    const url = new URL(GOOGLE_OAUTH_URL);
    url.searchParams.set('client_id', client.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', YOUTUBE_OAUTH_SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', oauthState);
    res.json({ url: url.toString(), platform: record.platform, platformName: platformName(record.platform) });
    return;
  }

  const client = await getTenantAwareMetaOAuthClient(tenantId);
  if (!client) {
    res.status(503).json({ error: 'meta_oauth_not_configured' });
    return;
  }
  const redirectUri = `${publicOrigin(req)}/api/overseas/social/oauth/facebook/callback`;
  const url = new URL(`${META_AUTH_URL}/${graphVersion()}/dialog/oauth`);
  url.searchParams.set('client_id', client.appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', META_SCOPES.join(','));
  url.searchParams.set('state', oauthState);
  url.searchParams.set('auth_type', 'rerequest');
  url.searchParams.set('return_scopes', 'true');
  res.json({ url: url.toString(), platform: record.platform, platformName: platformName(record.platform) });
});

assistLinksRouter.post('/assist-links/:token/complete', async (req, res) => {
  const token = bodyText(req.params.token);
  const record = token ? await findByToken(token) : null;
  if (!record) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (!record.used_at) {
    await store.update(COL, record.id, { used_at: new Date().toISOString() });
  }
  res.json({ ok: true });
});
