import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { r2Upload } from '../storage/r2.js';
import {
  exchangeMetaCode,
  exchangeTikTokCode,
  getFacebookComments,
  getFacebookPage,
  getFacebookVideos,
  getInstagramAccount,
  getInstagramAccountFromPage,
  getInstagramComments,
  getInstagramMedia,
  getMetaBusinessPages,
  getMetaPages,
  getTikTokUser,
  getTikTokVideos,
  publishInstagramReel,
  uploadFacebookVideo,
  uploadTikTokVideo,
  type SocialPlatform,
  type SocialUploadInput,
} from '../integrations/social.js';

const COL = 'social_accounts';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const META_AUTH_URL = 'https://www.facebook.com';

const TIKTOK_SCOPES = ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list', 'video.publish'];
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

export const socialRouter = Router();

interface PendingOAuthState {
  userId: string;
  tenantId: string;
  platform: SocialPlatform;
  returnTo: string;
  expiresAt: number;
}

interface SocialAccountRecord {
  id: string;
  tenantId: string;
  userId: string;
  platform: SocialPlatform;
  providerAccountId: string;
  title: string;
  handle?: string;
  avatarUrl?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  scope?: string;
  parentPageId?: string;
  parentPageName?: string;
  followerCount: number;
  videoCount: number;
  viewCount: number;
  likeCount: number;
  connectedAt: string;
  lastSyncAt?: string;
  status: 'connected' | 'error' | 'expired';
}

const pendingOAuthStates = new Map<string, PendingOAuthState>();

function graphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || 'v25.0';
}

function getTikTokClient() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  if (!clientKey || !clientSecret) return null;
  return { clientKey, clientSecret };
}

function getMetaClient() {
  const appId = process.env.META_SOCIAL_APP_ID?.trim() || process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_ID?.trim();
  const appSecret = process.env.META_SOCIAL_APP_SECRET?.trim() || process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

function advancedManualConnectEnabled() {
  return process.env.ADVANCED_MANUAL_CONNECT_ENABLED === 'true';
}

function isPlatform(value: string): value is SocialPlatform {
  return value === 'tiktok' || value === 'instagram' || value === 'facebook';
}

function getPublicOrigin(req: Request) {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, '');
  if (configured && !configured.includes('your-domain.com')) return configured;
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || req.protocol || 'http';
  const host = req.get('host') || `localhost:${process.env.PORT ?? 8788}`;
  return `${proto}://${host}`;
}

function redirectUri(req: Request, platform: SocialPlatform) {
  return `${getPublicOrigin(req)}/api/overseas/social/oauth/${platform}/callback`;
}

function normalizeReturnTo(value: unknown) {
  if (typeof value !== 'string') return '/';
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/';
  return trimmed.slice(0, 300);
}

function cleanupOAuthStates() {
  const now = Date.now();
  for (const [state, pending] of pendingOAuthStates) {
    if (pending.expiresAt <= now) pendingOAuthStates.delete(state);
  }
}

function htmlEscape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function callbackHtml(input: {
  ok: boolean;
  title: string;
  message: string;
  returnTo: string;
  platform: SocialPlatform;
}) {
  const payload = {
    source: 'overseas-workbench',
    type: 'social-oauth',
    platform: input.platform,
    status: input.ok ? 'success' : 'error',
    message: input.message,
  };
  const separator = input.returnTo.includes('?') ? '&' : '?';
  const fallbackUrl = `${input.returnTo}${separator}${input.platform}_oauth=${input.ok ? 'connected' : 'error'}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(input.title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; }
    main { width: min(420px, calc(100vw - 32px)); padding: 28px; border: 1px solid #e2e8f0; border-radius: 16px; background: #fff; box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08); }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0; color: #64748b; line-height: 1.6; font-size: 14px; }
    a { display: inline-flex; margin-top: 18px; color: #dc2626; font-weight: 700; text-decoration: none; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>${htmlEscape(input.title)}</h1>
    <p>${htmlEscape(input.message)}</p>
    <a href="${htmlEscape(fallbackUrl)}">返回应用</a>
  </main>
  <script>
    const payload = ${JSON.stringify(payload)};
    const fallbackUrl = ${JSON.stringify(fallbackUrl)};
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, "*");
        window.close();
      } else {
        setTimeout(() => window.location.replace(fallbackUrl), 900);
      }
    } catch {
      setTimeout(() => window.location.replace(fallbackUrl), 900);
    }
  </script>
</body>
</html>`;
}

function readableSocialError(error: any) {
  const data = error?.response?.data;
  const message = data?.error?.message || data?.error_description || data?.message || error?.message;
  const lower = String(message || '').toLowerCase();
  if (data?.error === 'invalid_grant') return '授权已过期或授权码无效，请重新连接账号。';
  if (lower.includes('session has expired')) {
    return 'Meta Access Token 已过期，请重新生成一个新的 token 后再保存。Graph API Explorer 里生成的临时 token 通常很快会过期。';
  }
  if (lower.includes('error validating access token')) {
    return 'Meta Access Token 无效或已过期，请重新生成 token，并确认勾选了 Page / Instagram 相关权限。';
  }
  if (lower.includes('permission') || lower.includes('permissions') || lower.includes('scope')) {
    if (lower.includes('tiktok') || lower.includes('video.publish') || lower.includes('content posting')) {
      return 'TikTok 发布权限不可用。请确认 TikTok 开发者应用已配置 Client Key/Secret，并已通过 Content Posting API / video.publish 审核，然后重新连接账号。';
    }
    return '平台授权权限不足。请重新连接账号，并确认 Meta 应用已开通 pages_manage_posts / instagram_content_publish 等发布权限。';
  }
  if (lower.includes('unsupported post request') || lower.includes('object does not exist')) {
    return 'Meta 没有找到可发布的 Page 或 Instagram 专业账号。请确认发布目标是 Facebook Page，且 Instagram 已绑定到该 Page。';
  }
  if (lower.includes('invalid parameter') && lower.includes('video')) {
    return '平台无法读取这个视频。Instagram 需要公网可访问的视频 URL，请确认 R2_PUBLIC_URL 可以直接访问生成的视频文件。';
  }
  if (lower.includes('media id is not available')) {
    return 'Instagram 视频还在处理，系统已更新为等待处理完成后再发布。请稍后重新发布一次。';
  }
  if (lower.includes('socket hang up') || lower.includes('econnreset')) {
    return 'Facebook 上传连接被中断。系统已改用更稳定的 Facebook 视频上传接口，请稍后重新发布一次。';
  }
  if (String(message || '').includes('R2 credentials')) return 'Instagram 发布本地视频需要先配置 R2 公网存储。';
  return message || '社交平台请求失败';
}

async function upsertSocialAccount(data: Omit<SocialAccountRecord, 'id' | 'connectedAt' | 'lastSyncAt' | 'status'>) {
  const existing = await store.list<SocialAccountRecord>(COL, {
    where: { tenantId: data.tenantId, platform: data.platform, providerAccountId: data.providerAccountId },
    perPage: 1,
  });
  const now = new Date().toISOString();
  const payload = {
    ...data,
    connectedAt: existing.items[0]?.connectedAt || now,
    lastSyncAt: now,
    status: 'connected' as const,
  };
  if (existing.items[0]) {
    await store.update(COL, existing.items[0].id, payload);
    return { ...existing.items[0], ...payload };
  }
  const created = await store.create<SocialAccountRecord>(COL, payload);
  if (!created) throw new Error('保存社交账号失败');
  return created;
}

function publicSocialAccount(a: SocialAccountRecord) {
  return {
    id: a.id,
    platform: a.platform,
    providerAccountId: a.providerAccountId,
    title: a.title,
    handle: a.handle,
    avatarUrl: a.avatarUrl,
    parentPageId: a.parentPageId,
    parentPageName: a.parentPageName,
    followerCount: a.followerCount,
    videoCount: a.videoCount,
    viewCount: a.viewCount,
    likeCount: a.likeCount,
    connectedAt: a.connectedAt,
    lastSyncAt: a.lastSyncAt,
    status: a.status,
  };
}

function bodyText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function getAvailableMetaPages(accessToken: string) {
  const graph = graphVersion();
  const results = await Promise.allSettled([
    getMetaPages(accessToken, graph),
    getMetaBusinessPages(accessToken, graph),
  ]);
  const pages = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const seen = new Set<string>();
  return pages.filter(page => {
    if (!page.id || seen.has(page.id)) return false;
    seen.add(page.id);
    return true;
  });
}

async function saveFacebookPageFromMeta(input: {
  tenantId: string;
  userId: string;
  page: Awaited<ReturnType<typeof getMetaPages>>[number];
}) {
  return upsertSocialAccount({
    tenantId: input.tenantId,
    userId: input.userId,
    platform: 'facebook',
    providerAccountId: input.page.id,
    title: input.page.name,
    handle: input.page.name,
    avatarUrl: input.page.pictureUrl || '',
    accessToken: input.page.accessToken,
    refreshToken: '',
    tokenExpiresAt: '',
    scope: META_SCOPES.join(','),
    parentPageId: input.page.id,
    parentPageName: input.page.name,
    followerCount: input.page.fanCount || 0,
    videoCount: 0,
    viewCount: 0,
    likeCount: 0,
  });
}

async function saveInstagramFromMeta(input: {
  tenantId: string;
  userId: string;
  page: Awaited<ReturnType<typeof getMetaPages>>[number];
}) {
  if (!input.page.instagram) return null;
  return upsertSocialAccount({
    tenantId: input.tenantId,
    userId: input.userId,
    platform: 'instagram',
    providerAccountId: input.page.instagram.id,
    title: input.page.instagram.username,
    handle: `@${input.page.instagram.username}`,
    avatarUrl: input.page.instagram.profilePictureUrl || '',
    accessToken: input.page.accessToken,
    refreshToken: '',
    tokenExpiresAt: '',
    scope: META_SCOPES.join(','),
    parentPageId: input.page.id,
    parentPageName: input.page.name,
    followerCount: input.page.instagram.followersCount || 0,
    videoCount: input.page.instagram.mediaCount || 0,
    viewCount: 0,
    likeCount: 0,
  });
}

async function connectTikTok(pending: PendingOAuthState, code: string, req: Request) {
  const client = getTikTokClient();
  if (!client) throw new Error('管理员尚未配置 TikTok OAuth');
  const tokens = await exchangeTikTokCode({ ...client, code, redirectUri: redirectUri(req, 'tiktok') });
  const user = await getTikTokUser(tokens.accessToken);
  await upsertSocialAccount({
    tenantId: pending.tenantId,
    userId: pending.userId,
    platform: 'tiktok',
    providerAccountId: user.openId,
    title: user.displayName,
    handle: user.displayName,
    avatarUrl: user.avatarUrl || '',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenExpiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString() : '',
    scope: tokens.scope || '',
    parentPageId: '',
    parentPageName: '',
    followerCount: user.followerCount || 0,
    videoCount: user.videoCount || 0,
    viewCount: 0,
    likeCount: user.likeCount || 0,
  });
}

async function connectMeta(pending: PendingOAuthState, code: string, req: Request) {
  const client = getMetaClient();
  if (!client) throw new Error('管理员尚未配置 Meta OAuth');
  const userToken = await exchangeMetaCode({
    appId: client.appId,
    appSecret: client.appSecret,
    code,
    redirectUri: redirectUri(req, pending.platform),
    graphVersion: graphVersion(),
  });
  const pages = await getAvailableMetaPages(userToken);
  let saved = 0;
  for (const page of pages) {
    if (pending.platform === 'facebook') {
      await upsertSocialAccount({
        tenantId: pending.tenantId,
        userId: pending.userId,
        platform: 'facebook',
        providerAccountId: page.id,
        title: page.name,
        handle: page.name,
        avatarUrl: page.pictureUrl || '',
        accessToken: page.accessToken,
        refreshToken: '',
        tokenExpiresAt: '',
        scope: META_SCOPES.join(','),
        parentPageId: page.id,
        parentPageName: page.name,
        followerCount: page.fanCount || 0,
        videoCount: 0,
        viewCount: 0,
        likeCount: 0,
      });
      saved += 1;
    }
    if (pending.platform === 'instagram' && page.instagram) {
      await upsertSocialAccount({
        tenantId: pending.tenantId,
        userId: pending.userId,
        platform: 'instagram',
        providerAccountId: page.instagram.id,
        title: page.instagram.username,
        handle: `@${page.instagram.username}`,
        avatarUrl: page.instagram.profilePictureUrl || '',
        accessToken: page.accessToken,
        refreshToken: '',
        tokenExpiresAt: '',
        scope: META_SCOPES.join(','),
        parentPageId: page.id,
        parentPageName: page.name,
        followerCount: page.instagram.followersCount || 0,
        videoCount: page.instagram.mediaCount || 0,
        viewCount: 0,
        likeCount: 0,
      });
      saved += 1;
    }
  }
  if (!saved) {
    if (!pages.length) {
      throw new Error(pending.platform === 'instagram'
        ? 'Meta 没有返回任何 Facebook Page。请在授权页点击“编辑访问权限”，勾选已绑定 Instagram 的 Page；如果没有弹出权限页，请先移除旧的 Business Integration 后重试。'
        : 'Meta 没有返回任何可管理的 Facebook Page。请在授权页点击“编辑访问权限”并勾选 Page；如果没有弹出权限页，请先移除旧的 Business Integration 后重试。');
    }
    const pageNames = pages.map(page => page.name).filter(Boolean).slice(0, 3).join('、');
    throw new Error(pending.platform === 'instagram'
      ? `Meta 返回了 ${pages.length} 个 Page（${pageNames || '未命名'}），但这些 Page 没有返回已绑定的 Instagram 专业账号。请确认 IG 是专业账号，并在该 Page 的 Linked accounts 里绑定 Instagram 后重新授权。`
      : `Meta 返回了 ${pages.length} 个 Page，但没有可保存的 Page Access Token。请重新授权并确认 pages_show_list / pages_read_engagement 权限已授权。`);
  }
}

socialRouter.get('/oauth/:platform/callback', async (req, res) => {
  const platform = String(req.params.platform);
  if (!isPlatform(platform)) {
    res.status(404).send('Unknown platform');
    return;
  }
  cleanupOAuthStates();
  const state = String(req.query.state || '');
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const pending = pendingOAuthStates.get(state);
  const returnTo = pending?.returnTo || '/';
  if (!pending || pending.platform !== platform) {
    res.status(400).type('html').send(callbackHtml({ ok: false, title: '授权已失效', message: '请回到系统重新连接账号。', returnTo, platform }));
    return;
  }
  pendingOAuthStates.delete(state);
  try {
    if (!code) throw new Error(String(req.query.error_description || req.query.error || '缺少授权码'));
    if (platform === 'tiktok') await connectTikTok(pending, code, req);
    else await connectMeta(pending, code, req);
    res.type('html').send(callbackHtml({ ok: true, title: '账号已连接', message: '授权完成，可以关闭这个窗口。', returnTo, platform }));
  } catch (error: any) {
    console.error(`${platform} OAuth callback error:`, error?.response?.data ?? error?.message ?? error);
    res.status(500).type('html').send(callbackHtml({ ok: false, title: '连接失败', message: readableSocialError(error), returnTo, platform }));
  }
});

socialRouter.use(requireAuth);

socialRouter.get('/oauth/:platform/status', (req, res) => {
  const platform = String(req.params.platform);
  if (!isPlatform(platform)) {
    res.status(404).json({ error: 'Unknown platform' });
    return;
  }
  const configured = platform === 'tiktok' ? Boolean(getTikTokClient()) : Boolean(getMetaClient());
  res.json({
    configured,
    redirectUri: redirectUri(req, platform),
    scopes: platform === 'tiktok' ? TIKTOK_SCOPES : META_SCOPES,
    manualConnectEnabled: advancedManualConnectEnabled(),
  });
});

socialRouter.post('/oauth/:platform/start', (req, res) => {
  const platform = String(req.params.platform);
  if (!isPlatform(platform)) {
    res.status(404).json({ error: 'Unknown platform' });
    return;
  }
  const configured = platform === 'tiktok' ? getTikTokClient() : getMetaClient();
  if (!configured) {
    res.status(503).json({ error: `管理员尚未配置 ${platform} OAuth` });
    return;
  }
  const { userId, tenantId } = res.locals as AuthLocals;
  cleanupOAuthStates();
  const state = crypto.randomBytes(24).toString('hex');
  pendingOAuthStates.set(state, {
    userId,
    tenantId,
    platform,
    returnTo: normalizeReturnTo(req.body?.returnTo),
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  });

  if (platform === 'tiktok') {
    const client = configured as ReturnType<typeof getTikTokClient>;
    const url = new URL(TIKTOK_AUTH_URL);
    url.searchParams.set('client_key', client!.clientKey);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', TIKTOK_SCOPES.join(','));
    url.searchParams.set('redirect_uri', redirectUri(req, platform));
    url.searchParams.set('state', state);
    res.json({ url: url.toString(), redirectUri: redirectUri(req, platform), scopes: TIKTOK_SCOPES });
    return;
  }

  const client = configured as ReturnType<typeof getMetaClient>;
  const url = new URL(`${META_AUTH_URL}/${graphVersion()}/dialog/oauth`);
  url.searchParams.set('client_id', client!.appId);
  url.searchParams.set('redirect_uri', redirectUri(req, platform));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', META_SCOPES.join(','));
  url.searchParams.set('state', state);
  url.searchParams.set('auth_type', 'rerequest');
  url.searchParams.set('return_scopes', 'true');
  res.json({ url: url.toString(), redirectUri: redirectUri(req, platform), scopes: META_SCOPES });
});

socialRouter.post('/connect/manual', async (req, res) => {
  const { userId, tenantId } = res.locals as AuthLocals;
  if (!advancedManualConnectEnabled()) {
    res.status(403).json({ error: 'Advanced manual connect is disabled' });
    return;
  }

  const platform = bodyText(req.body?.platform);
  if (!isPlatform(platform)) {
    res.status(400).json({ error: 'Unknown platform' });
    return;
  }

  const accessToken = bodyText(req.body?.accessToken);
  if (!accessToken) {
    res.status(400).json({ error: 'Access Token is required' });
    return;
  }

  const refreshToken = bodyText(req.body?.refreshToken);
  const providerAccountId = bodyText(req.body?.providerAccountId);
  const parentPageId = bodyText(req.body?.parentPageId);
  const parentPageName = bodyText(req.body?.parentPageName);
  const title = bodyText(req.body?.title);
  const handle = bodyText(req.body?.handle);
  const avatarUrl = bodyText(req.body?.avatarUrl);

  try {
    let account: SocialAccountRecord | null = null;

    if (platform === 'tiktok') {
      const user = await getTikTokUser(accessToken);
      account = await upsertSocialAccount({
        tenantId,
        userId,
        platform,
        providerAccountId: user.openId,
        title: title || user.displayName,
        handle: handle || user.displayName,
        avatarUrl: avatarUrl || user.avatarUrl || '',
        accessToken,
        refreshToken,
        tokenExpiresAt: '',
        scope: TIKTOK_SCOPES.join(','),
        parentPageId: '',
        parentPageName: '',
        followerCount: user.followerCount || 0,
        videoCount: user.videoCount || 0,
        viewCount: 0,
        likeCount: user.likeCount || 0,
      });
    }

    if (platform === 'facebook') {
      const requestedId = providerAccountId || parentPageId;
      const pages = await getAvailableMetaPages(accessToken).catch(error => {
        const message = String(error?.response?.data?.error?.message || error?.message || '').toLowerCase();
        if (message.includes('session has expired') || message.includes('validating access token')) throw error;
        return [];
      });

      if (pages.length) {
        const targetPages = requestedId ? pages.filter(page => page.id === requestedId) : pages;
        if (!targetPages.length) throw new Error(`这个 Meta token 有效，但没有找到 Page ID ${requestedId}。请确认填的是 Facebook Page ID，或留空让系统自动连接全部 Page。`);
        const saved: SocialAccountRecord[] = [];
        for (const page of targetPages) {
          if (!page.accessToken) continue;
          saved.push(await saveFacebookPageFromMeta({ tenantId, userId, page }));
        }
        if (!saved.length) throw new Error('Meta 返回了 Page，但没有返回 Page Access Token。请重新生成 token，并勾选 pages_show_list / pages_read_engagement 权限。');
        account = saved[0];
      } else {
        const page = await getFacebookPage(accessToken, graphVersion(), requestedId);
        account = await upsertSocialAccount({
          tenantId,
          userId,
          platform,
          providerAccountId: page.id,
          title: title || page.name,
          handle: handle || page.name,
          avatarUrl: avatarUrl || page.pictureUrl || '',
          accessToken: page.accessToken,
          refreshToken: '',
          tokenExpiresAt: '',
          scope: META_SCOPES.join(','),
          parentPageId: page.id,
          parentPageName: page.name,
          followerCount: page.fanCount || 0,
          videoCount: 0,
          viewCount: 0,
          likeCount: 0,
        });
      }
    }

    if (platform === 'instagram') {
      const requestedId = providerAccountId || parentPageId;
      const pages = await getAvailableMetaPages(accessToken).catch(error => {
        const message = String(error?.response?.data?.error?.message || error?.message || '').toLowerCase();
        if (message.includes('session has expired') || message.includes('validating access token')) throw error;
        return [];
      });

      if (pages.length) {
        const targetPages = requestedId
          ? pages.filter(page => page.id === requestedId || page.instagram?.id === requestedId)
          : pages;
        const instagramPages = targetPages.filter(page => page.instagram);
        if (!instagramPages.length) {
          const pageNames = targetPages.map(page => page.name).filter(Boolean).slice(0, 3).join('、');
          throw new Error(`这个 Meta token 有效，也找到了 Page（${pageNames || '未命名'}），但没有找到绑定的 Instagram 专业账号。请确认该 Page 已绑定 IG 专业账号。`);
        }
        const saved: SocialAccountRecord[] = [];
        for (const page of instagramPages) {
          const savedAccount = await saveInstagramFromMeta({ tenantId, userId, page });
          if (savedAccount) saved.push(savedAccount);
        }
        account = saved[0] || null;
      } else {
        const pageId = parentPageId || providerAccountId || 'me';
        const linked = await getInstagramAccountFromPage(pageId, accessToken, graphVersion()).catch(async error => {
          if (!providerAccountId || pageId === 'me') throw error;
          return {
            page: { id: parentPageId, name: parentPageName },
            instagram: await getInstagramAccount(providerAccountId, accessToken, graphVersion()),
          };
        });

        account = await upsertSocialAccount({
          tenantId,
          userId,
          platform,
          providerAccountId: linked.instagram.id,
          title: title || linked.instagram.username,
          handle: handle || `@${linked.instagram.username}`,
          avatarUrl: avatarUrl || linked.instagram.profilePictureUrl || '',
          accessToken,
          refreshToken: '',
          tokenExpiresAt: '',
          scope: META_SCOPES.join(','),
          parentPageId: linked.page.id || '',
          parentPageName: linked.page.name || '',
          followerCount: linked.instagram.followersCount || 0,
          videoCount: linked.instagram.mediaCount || 0,
          viewCount: 0,
          likeCount: 0,
        });
      }
    }

    if (!account) throw new Error('Unsupported platform');
    res.status(201).json({ ok: true, account: publicSocialAccount(account) });
  } catch (error: any) {
    console.error(`${platform} manual connect error:`, error?.response?.data ?? error?.message ?? error);
    res.status(error?.response?.status || 500).json({ ok: false, error: readableSocialError(error) });
  }
});

socialRouter.get('/accounts', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const platform = typeof req.query.platform === 'string' && isPlatform(req.query.platform) ? req.query.platform : undefined;
  const result = await store.list<SocialAccountRecord>(COL, {
    where: platform ? { tenantId, platform } : { tenantId },
    sort: '-connectedAt',
  });
  res.json({
    items: result.items.map(publicSocialAccount),
    total: result.totalItems,
  });
});

socialRouter.delete('/accounts/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById<SocialAccountRecord>(COL, req.params.id);
  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  await store.delete(COL, req.params.id);
  res.json({ ok: true });
});

async function getAccount(req: Request, res: any) {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById<SocialAccountRecord>(COL, req.params.id);
  if (!record || record.tenantId !== tenantId) return null;
  return record;
}

socialRouter.get('/accounts/:id/videos', async (req, res) => {
  const account = await getAccount(req, res);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const maxResults = Number(req.query.maxResults ?? 25);
  try {
    let videos: unknown[] = [];
    if (account.platform === 'tiktok') videos = await getTikTokVideos(account.accessToken, maxResults);
    if (account.platform === 'facebook') videos = await getFacebookVideos(account.providerAccountId, account.accessToken, graphVersion(), maxResults);
    if (account.platform === 'instagram') videos = await getInstagramMedia(account.providerAccountId, account.accessToken, graphVersion(), maxResults);
    res.json({ videos });
  } catch (error: any) {
    console.error(`${account.platform} videos error:`, error?.response?.data ?? error?.message ?? error);
    res.status(error?.response?.status || 500).json({ error: readableSocialError(error) });
  }
});

socialRouter.get('/accounts/:id/video/:videoId/comments', async (req, res) => {
  const account = await getAccount(req, res);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const maxResults = Number(req.query.maxResults ?? 50);
  try {
    let comments: unknown[] = [];
    if (account.platform === 'tiktok') {
      res.status(501).json({ error: 'TikTok 评论读取需要额外 API 权限，当前暂未开放' });
      return;
    }
    if (account.platform === 'facebook') comments = await getFacebookComments(req.params.videoId, account.accessToken, graphVersion(), maxResults);
    if (account.platform === 'instagram') comments = await getInstagramComments(req.params.videoId, account.accessToken, graphVersion(), maxResults);
    res.json({ comments, total: comments.length });
  } catch (error: any) {
    console.error(`${account.platform} comments error:`, error?.response?.data ?? error?.message ?? error);
    res.status(error?.response?.status || 500).json({ error: readableSocialError(error) });
  }
});

function normalizeVideoPath(input: string) {
  const raw = input.trim();
  return raw.startsWith('file://') ? fileURLToPath(raw) : path.resolve(raw);
}

function socialVideoContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  return 'video/mp4';
}

function validateSocialUploadInput(account: SocialAccountRecord, input: SocialUploadInput) {
  if (!['private', 'unlisted', 'public', undefined].includes(input.privacyStatus)) {
    throw Object.assign(new Error('发布可见性只能是 private、unlisted 或 public'), { statusCode: 400 });
  }

  if (account.platform !== 'instagram' || !input.videoUrl) {
    if (!input.filePath) {
      throw Object.assign(new Error(`${account.platform} 发布需要本地成片文件，请先完成合成`), { statusCode: 400 });
    }
    if (!fs.existsSync(input.filePath)) {
      throw Object.assign(new Error('成片文件不存在，请先重新合成后再发布'), { statusCode: 404 });
    }
    const stat = fs.statSync(input.filePath);
    if (!stat.isFile()) {
      throw Object.assign(new Error('成片路径不是文件，请重新合成后再发布'), { statusCode: 400 });
    }
    const ext = path.extname(input.filePath).toLowerCase();
    if (!['.mp4', '.mov', '.webm'].includes(ext)) {
      throw Object.assign(new Error('社交平台发布仅支持 MP4、MOV 或 WebM 视频'), { statusCode: 400 });
    }
    const maxMb = Number(process.env.SOCIAL_MAX_UPLOAD_MB ?? 2048);
    if (stat.size > maxMb * 1024 * 1024) {
      throw Object.assign(new Error(`视频超过 ${maxMb}MB，请压缩后再发布`), { statusCode: 413 });
    }
  }

  if (account.platform === 'instagram' && !input.videoUrl && !process.env.R2_PUBLIC_URL?.trim()) {
    throw Object.assign(new Error('Instagram 发布需要公开视频地址。请先配置 R2_PUBLIC_URL，或传入 videoUrl。'), { statusCode: 400 });
  }
}

async function publicVideoUrlIfNeeded(filePath: string | undefined) {
  if (!filePath) return undefined;
  const publicBase = process.env.R2_PUBLIC_URL?.trim();
  if (!publicBase) return undefined;
  const resolved = normalizeVideoPath(filePath);
  if (!fs.existsSync(resolved)) return undefined;
  const key = `social-publish/${Date.now()}-${path.basename(resolved).replace(/[^\w.-]+/g, '-')}`;
  return r2Upload({ key, body: fs.readFileSync(resolved), contentType: socialVideoContentType(resolved) });
}

socialRouter.post('/accounts/:id/upload', async (req, res) => {
  const account = await getAccount(req, res);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  if (account.status !== 'connected') {
    res.status(400).json({ error: 'Account is not connected' });
    return;
  }
  const body = req.body as SocialUploadInput & { videoPath?: string };
  if (!body.title || (!body.videoPath && !body.videoUrl)) {
    res.status(400).json({ error: 'title and videoPath/videoUrl are required' });
    return;
  }
  const input: SocialUploadInput = {
    filePath: body.videoPath ? normalizeVideoPath(body.videoPath) : undefined,
    videoUrl: body.videoUrl,
    title: body.title,
    description: body.description,
    privacyStatus: body.privacyStatus,
  };
  try {
    validateSocialUploadInput(account, input);
    let video;
    if (account.platform === 'tiktok') video = await uploadTikTokVideo(account.accessToken, input);
    if (account.platform === 'facebook') video = await uploadFacebookVideo(account.providerAccountId, account.accessToken, graphVersion(), input);
    if (account.platform === 'instagram') {
      video = await publishInstagramReel(account.providerAccountId, account.accessToken, graphVersion(), {
        ...input,
        videoUrl: input.videoUrl || await publicVideoUrlIfNeeded(input.filePath),
      });
    }
    if (!video) throw new Error('不支持的平台');
    await store.update(COL, account.id, { lastSyncAt: new Date().toISOString(), status: 'connected' });
    res.status(201).json({ ok: true, video });
  } catch (error: any) {
    console.error(`${account.platform} upload error:`, error?.response?.data ?? error?.message ?? error);
    const status = error?.statusCode || error?.response?.status || 500;
    if (status === 401 || status === 403) await store.update(COL, account.id, { status: 'error' });
    res.status(status).json({ ok: false, error: readableSocialError(error) });
  }
});
