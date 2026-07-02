import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import {
  getMyChannelInfo,
  getMyVideos,
  getVideoComments,
  getMyVideoComments,
  getSuperChats,
  getChannelAnalytics,
  verifyYouTubeCredentials,
  getChannelCommentsByApiKey,
  getVideoCommentsByApiKey,
  getChannelIdByHandle,
  uploadVideoToYouTube,
  exchangeYouTubeOAuthCode,
  type YouTubeConfig,
} from '../integrations/youtube.js';
import {
  advancedManualConnectEnabled as readAdvancedManualConnectEnabled,
  getYouTubeOAuthClient,
} from '../lib/oauthConfig.js';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const GOOGLE_OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const YOUTUBE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export const youtubeRouter = Router();

const COL = 'youtube_accounts';

interface PendingOAuthState {
  userId: string;
  tenantId: string;
  returnTo: string;
  expiresAt: number;
}

const pendingOAuthStates = new Map<string, PendingOAuthState>();

interface YouTubeAccountRecord {
  tenantId: string;
  userId: string;
  channelId: string;
  channelTitle: string;
  channelDescription?: string;
  customUrl?: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  thumbnailUrl?: string;
  connectedAt: string;
  lastSyncAt?: string;
  isMonetized: boolean;
  status: 'connected' | 'error' | 'expired';
}

function youtubeConfig(record: YouTubeAccountRecord): YouTubeConfig {
  return {
    clientId: record.clientId,
    clientSecret: record.clientSecret,
    refreshToken: record.refreshToken,
    accessToken: record.accessToken,
  };
}

function getOAuthClient() {
  return getYouTubeOAuthClient();
}

function advancedManualConnectEnabled() {
  return readAdvancedManualConnectEnabled();
}

function getPublicOrigin(req: Request) {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, '');
  if (configured && !configured.includes('your-domain.com')) return configured;

  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'http';
  const host = req.get('host') || `localhost:${process.env.PORT ?? 8788}`;
  return `${proto}://${host}`;
}

function getYouTubeRedirectUri(req: Request) {
  return `${getPublicOrigin(req)}/api/overseas/youtube/oauth/callback`;
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
  accountId?: string;
  channelTitle?: string;
}) {
  const payload = {
    source: 'overseas-workbench',
    type: 'youtube-oauth',
    status: input.ok ? 'success' : 'error',
    accountId: input.accountId,
    channelTitle: input.channelTitle,
    message: input.message,
  };
  const separator = input.returnTo.includes('?') ? '&' : '?';
  const fallbackUrl = `${input.returnTo}${separator}youtube_oauth=${input.ok ? 'connected' : 'error'}`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(input.title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; }
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

async function safeChannelAnalytics(config: YouTubeConfig, channelInfo: Awaited<ReturnType<typeof getMyChannelInfo>>) {
  try {
    return await getChannelAnalytics(config);
  } catch (error) {
    console.warn('YouTube analytics unavailable during connect:', error);
    return {
      isMonetized: false,
      totalSubscribers: channelInfo.subscriberCount,
      totalViews: channelInfo.viewCount,
      totalVideos: channelInfo.videoCount,
    };
  }
}

async function upsertYouTubeAccount(input: {
  userId: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  accessToken?: string;
}) {
  const initialConfig: YouTubeConfig = {
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    refreshToken: input.refreshToken,
    accessToken: input.accessToken,
  };

  const channelInfo = await getMyChannelInfo(initialConfig);
  const existing = await store.list<YouTubeAccountRecord & { id: string }>(COL, {
    where: { tenantId: input.tenantId, channelId: channelInfo.id },
    perPage: 1,
  });

  const existingRecord = existing.items[0];
  const refreshToken = input.refreshToken || existingRecord?.refreshToken || '';
  if (!refreshToken) {
    throw new Error('Google 未返回长期授权，请重新连接并确认允许访问 YouTube');
  }

  const config: YouTubeConfig = {
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    refreshToken,
    accessToken: input.accessToken,
  };
  const analytics = await safeChannelAnalytics(config, channelInfo);
  const now = new Date().toISOString();
  const data = {
    tenantId: input.tenantId,
    userId: input.userId,
    channelId: channelInfo.id,
    channelTitle: channelInfo.title,
    channelDescription: channelInfo.description || '',
    customUrl: channelInfo.customUrl || '',
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    refreshToken,
    accessToken: input.accessToken || '',
    subscriberCount: channelInfo.subscriberCount,
    videoCount: channelInfo.videoCount,
    viewCount: channelInfo.viewCount,
    thumbnailUrl: channelInfo.thumbnailUrl || '',
    lastSyncAt: now,
    isMonetized: analytics.isMonetized,
    status: 'connected' as const,
  };

  if (existingRecord) {
    await store.update(COL, existingRecord.id, data);
    return { ...existingRecord, ...data };
  }

  const created = await store.create<YouTubeAccountRecord & { id: string }>(COL, {
    ...data,
    connectedAt: now,
  });
  if (!created) throw new Error('保存 YouTube 账号失败');
  return created;
}

function normalizeVideoPath(input: string) {
  const raw = input.trim();
  return raw.startsWith('file://') ? fileURLToPath(raw) : path.resolve(raw);
}

function parseTags(tags: unknown, description: string) {
  if (Array.isArray(tags)) {
    return tags.map(String).map(t => t.replace(/^#/, '').trim()).filter(Boolean);
  }
  if (typeof tags === 'string') {
    return tags.split(/[\s,，]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean);
  }
  return Array.from(description.matchAll(/#([\p{L}\p{N}_-]+)/gu)).map(m => m[1]);
}

function readableYouTubeError(error: any) {
  const oauthError = error?.response?.data?.error;
  const oauthDescription = error?.response?.data?.error_description;
  const apiMessage = error?.response?.data?.error?.message;
  const reason = error?.response?.data?.error?.errors?.[0]?.reason;
  if (oauthError === 'invalid_grant') {
    return '授权凭据无效或已过期。请重新登录 YouTube 授权，或联系服务顾问协助处理。';
  }
  if (oauthError === 'invalid_client') {
    return '授权应用配置不匹配。请联系服务顾问确认平台应用配置。';
  }
  if (String(oauthDescription ?? '').toLowerCase().includes('bad request')) {
    return 'Google 拒绝了本次授权参数。请重新授权，或联系服务顾问协助处理。';
  }
  if (reason === 'insufficientPermissions') {
    return '当前 YouTube 授权缺少上传权限，请重新连接账号并勾选 youtube.upload 权限';
  }
  if (reason === 'accessNotConfigured') {
    return '当前 Google Cloud 项目还没有启用 YouTube Data API v3，请先启用后再重试。';
  }
  if (reason === 'quotaExceeded') {
    return 'YouTube API 配额不足，今天暂时无法继续上传';
  }
  if (error?.message === 'No channel found') {
    return '这个 Google 账号没有可用的 YouTube 频道，请先登录 YouTube 创建频道后再连接。';
  }
  if (error?.message === '保存 YouTube 账号失败') {
    return 'YouTube 账号验证成功，但保存到数据库失败。请确认 PocketBase 已创建 youtube_accounts 表。';
  }
  return oauthDescription || apiMessage || error?.message || 'YouTube 请求失败';
}

/**
 * GET /youtube/oauth/callback
 * Google redirects here after the customer approves YouTube access.
 */
youtubeRouter.get('/oauth/callback', async (req, res) => {
  const state = String(req.query.state ?? '');
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
  const oauthErrorDescription = typeof req.query.error_description === 'string' ? req.query.error_description : '';

  cleanupOAuthStates();
  const pending = pendingOAuthStates.get(state);
  const returnTo = pending?.returnTo ?? '/';

  if (!pending) {
    res.status(400).type('html').send(callbackHtml({
      ok: false,
      title: 'YouTube 授权已失效',
      message: '请回到系统里重新点击“连接 YouTube”。',
      returnTo,
    }));
    return;
  }

  pendingOAuthStates.delete(state);

  if (oauthError) {
    res.status(400).type('html').send(callbackHtml({
      ok: false,
      title: 'YouTube 授权未完成',
      message: oauthErrorDescription || oauthError,
      returnTo,
    }));
    return;
  }

  if (!code) {
    res.status(400).type('html').send(callbackHtml({
      ok: false,
      title: '缺少授权码',
      message: 'Google 没有返回授权码，请重新连接 YouTube。',
      returnTo,
    }));
    return;
  }

  const client = getOAuthClient();
  if (!client) {
    res.status(503).type('html').send(callbackHtml({
      ok: false,
      title: 'YouTube 一键授权暂未开启',
      message: '请联系服务顾问配置平台应用和回调地址。',
      returnTo,
    }));
    return;
  }

  try {
    const tokens = await exchangeYouTubeOAuthCode({
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      code,
      redirectUri: getYouTubeRedirectUri(req),
    });
    const record = await upsertYouTubeAccount({
      userId: pending.userId,
      tenantId: pending.tenantId,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
    });

    res.type('html').send(callbackHtml({
      ok: true,
      title: 'YouTube 已连接',
      message: `${record.channelTitle} 已连接成功，可以关闭这个窗口。`,
      returnTo,
      accountId: record.id,
      channelTitle: record.channelTitle,
    }));
  } catch (error: any) {
    console.error('YouTube OAuth callback error:', error?.response?.data ?? error);
    res.status(500).type('html').send(callbackHtml({
      ok: false,
      title: 'YouTube 连接失败',
      message: readableYouTubeError(error),
      returnTo,
    }));
  }
});

youtubeRouter.use(requireAuth);

/**
 * GET /youtube/oauth/status
 * Let the UI know whether one-click YouTube OAuth is ready.
 */
youtubeRouter.get('/oauth/status', (req, res) => {
  const client = getOAuthClient();
  res.json({
    configured: Boolean(client),
    redirectUri: getYouTubeRedirectUri(req),
    scopes: YOUTUBE_OAUTH_SCOPES,
    manualConnectEnabled: advancedManualConnectEnabled(),
  });
});

/**
 * POST /youtube/oauth/start
 * Creates a short-lived state and returns the Google authorization URL.
 */
youtubeRouter.post('/oauth/start', (req, res) => {
  const client = getOAuthClient();
  if (!client) {
    res.status(503).json({
      error: 'YouTube 一键授权暂未开启，请联系服务顾问配置平台应用和回调地址。',
    });
    return;
  }

  const { userId, tenantId } = res.locals as AuthLocals;
  cleanupOAuthStates();
  const state = crypto.randomBytes(24).toString('hex');
  pendingOAuthStates.set(state, {
    userId,
    tenantId,
    returnTo: normalizeReturnTo(req.body?.returnTo),
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  });

  const url = new URL(GOOGLE_OAUTH_URL);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', getYouTubeRedirectUri(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', YOUTUBE_OAUTH_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);

  res.json({
    url: url.toString(),
    redirectUri: getYouTubeRedirectUri(req),
    expiresInSeconds: Math.floor(OAUTH_STATE_TTL_MS / 1000),
  });
});

/**
 * POST /youtube/connect
 * Connect a YouTube account with OAuth tokens
 * Body: { refreshToken, accessToken?, clientId?, clientSecret? }
 */
youtubeRouter.post('/connect', async (req, res) => {
  const { userId, tenantId } = res.locals as AuthLocals;
  if (!advancedManualConnectEnabled()) {
    res.status(403).json({ error: 'Advanced manual connect is disabled' });
    return;
  }

  const client = getOAuthClient();
  const clientId = String(req.body?.clientId || client?.clientId || '').trim();
  const clientSecret = String(req.body?.clientSecret || client?.clientSecret || '').trim();
  const refreshToken = String(req.body?.refreshToken || '').trim();
  const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : undefined;

  if (!clientId || !clientSecret || !refreshToken) {
    res.status(400).json({ error: 'YouTube 授权信息不完整，请重新授权或联系服务顾问协助处理。' });
    return;
  }

  try {
    const record = await upsertYouTubeAccount({
      userId,
      tenantId,
      clientId,
      clientSecret,
      refreshToken,
      accessToken,
    });

    res.json({
      id: record.id,
      channelId: record.channelId,
      channelTitle: record.channelTitle,
      status: record.status,
    });
  } catch (error: any) {
    console.error('YouTube connect error:', error?.response?.data ?? error?.message ?? error);
    const status = error?.response?.status === 401 ? 401 : error?.response?.status === 403 ? 403 : 500;
    res.status(status).json({ error: readableYouTubeError(error) });
  }
});

/**
 * GET /youtube/accounts
 * List connected YouTube accounts for the tenant
 */
youtubeRouter.get('/accounts', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;

  const result = await store.list(COL, {
    where: { tenantId },
    sort: '-connectedAt',
  });

  res.json({
    items: result.items.map((item: any) => ({
      id: item.id,
      channelId: item.channelId,
      channelTitle: item.channelTitle,
      channelDescription: item.channelDescription,
      customUrl: item.customUrl,
      thumbnailUrl: item.thumbnailUrl,
      subscriberCount: item.subscriberCount,
      videoCount: item.videoCount,
      viewCount: item.viewCount,
      isMonetized: item.isMonetized,
      status: item.status,
      connectedAt: item.connectedAt,
      lastSyncAt: item.lastSyncAt,
    })),
    total: result.totalItems,
  });
});

/**
 * GET /youtube/accounts/:id
 * Get a specific YouTube account
 */
youtubeRouter.get('/accounts/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id);

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  res.json({
    id: record.id,
    channelId: record.channelId,
    channelTitle: record.channelTitle,
    channelDescription: record.channelDescription,
    customUrl: record.customUrl,
    thumbnailUrl: record.thumbnailUrl,
    subscriberCount: record.subscriberCount,
    videoCount: record.videoCount,
    viewCount: record.viewCount,
    isMonetized: record.isMonetized,
    status: record.status,
    connectedAt: record.connectedAt,
    lastSyncAt: record.lastSyncAt,
  });
});

/**
 * DELETE /youtube/accounts/:id
 * Disconnect a YouTube account
 */
youtubeRouter.delete('/accounts/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id);

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  await store.delete(COL, req.params.id);
  res.json({ ok: true });
});

/**
 * GET /youtube/accounts/:id/channel-info
 * Get channel information
 */
youtubeRouter.get('/accounts/:id/channel-info', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id) as YouTubeAccountRecord;

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    const config: YouTubeConfig = {
      clientId: record.clientId,
      clientSecret: record.clientSecret,
      refreshToken: record.refreshToken,
      accessToken: record.accessToken,
    };

    const info = await getMyChannelInfo(config);
    res.json(info);
  } catch (error) {
    console.error('Error fetching channel info:', error);
    res.status(500).json({ error: 'Failed to fetch channel info' });
  }
});

/**
 * GET /youtube/accounts/:id/videos
 * Get all videos from the YouTube channel
 * Query: maxResults (default 50)
 */
youtubeRouter.get('/accounts/:id/videos', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { maxResults = '50' } = req.query;
  const record = await store.getById(COL, req.params.id) as YouTubeAccountRecord;

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    const config: YouTubeConfig = {
      clientId: record.clientId,
      clientSecret: record.clientSecret,
      refreshToken: record.refreshToken,
      accessToken: record.accessToken,
    };

    const videos = await getMyVideos(config, Number(maxResults));
    res.json({ videos });
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

/**
 * POST /youtube/accounts/:id/upload
 * Upload a locally rendered video file to the connected YouTube channel.
 * Body: { videoPath, title, description?, tags?, privacyStatus?, madeForKids? }
 */
youtubeRouter.post('/accounts/:id/upload', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id) as YouTubeAccountRecord;

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  if (record.status !== 'connected') {
    res.status(400).json({ error: 'YouTube account is not connected' });
    return;
  }

  const {
    videoPath,
    title,
    description = '',
    tags,
    privacyStatus = 'unlisted',
    madeForKids = false,
  } = req.body as {
    videoPath?: string;
    title?: string;
    description?: string;
    tags?: unknown;
    privacyStatus?: 'private' | 'unlisted' | 'public';
    madeForKids?: boolean;
  };

  if (!videoPath || !title) {
    res.status(400).json({ error: 'videoPath and title are required' });
    return;
  }
  if (!['private', 'unlisted', 'public'].includes(privacyStatus)) {
    res.status(400).json({ error: 'privacyStatus must be private, unlisted, or public' });
    return;
  }

  const resolvedPath = normalizeVideoPath(videoPath);
  const ext = path.extname(resolvedPath).toLowerCase();
  if (!['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(ext)) {
    res.status(400).json({ error: 'Only video files can be uploaded to YouTube' });
    return;
  }
  if (!fs.existsSync(resolvedPath)) {
    res.status(404).json({ error: 'Rendered video file not found, please render again' });
    return;
  }

  const maxMb = Number(process.env.YOUTUBE_MAX_UPLOAD_MB ?? 2048);
  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    res.status(400).json({ error: 'videoPath must point to a file' });
    return;
  }
  if (stat.size > maxMb * 1024 * 1024) {
    res.status(413).json({ error: `Video is larger than ${maxMb}MB` });
    return;
  }

  try {
    const result = await uploadVideoToYouTube(youtubeConfig(record), {
      filePath: resolvedPath,
      title,
      description,
      tags: parseTags(tags, description),
      privacyStatus,
      madeForKids,
    });

    await store.update(COL, req.params.id, {
      lastSyncAt: new Date().toISOString(),
      status: 'connected',
    });

    res.status(201).json({ ok: true, video: result });
  } catch (error: any) {
    console.error('YouTube upload error:', error?.response?.data ?? error);
    const status = error?.response?.status === 401 ? 401 : error?.response?.status === 403 ? 403 : 500;
    if (status === 401 || status === 403) {
      await store.update(COL, req.params.id, { status: 'error' });
    }
    res.status(status).json({ ok: false, error: readableYouTubeError(error) });
  }
});

/**
 * GET /youtube/accounts/:id/comments
 * Get all comments from my videos
 * Query: maxResults (default 1000)
 */
youtubeRouter.get('/accounts/:id/comments', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { maxResults = '1000' } = req.query;
  const record = await store.getById(COL, req.params.id) as YouTubeAccountRecord;

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    const config: YouTubeConfig = {
      clientId: record.clientId,
      clientSecret: record.clientSecret,
      refreshToken: record.refreshToken,
      accessToken: record.accessToken,
    };

    const comments = await getMyVideoComments(config, Number(maxResults));
    res.json({
      comments,
      total: comments.length,
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

/**
 * GET /youtube/accounts/:id/video/:videoId/comments
 * Get comments on a specific video
 * Query: maxResults (default 100)
 */
youtubeRouter.get('/accounts/:id/video/:videoId/comments', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { maxResults = '100' } = req.query;
  const { videoId } = req.params;
  const record = await store.getById(COL, req.params.id) as YouTubeAccountRecord;

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    const config: YouTubeConfig = {
      clientId: record.clientId,
      clientSecret: record.clientSecret,
      refreshToken: record.refreshToken,
      accessToken: record.accessToken,
    };

    const comments = await getVideoComments(config, videoId, Number(maxResults));
    res.json({
      videoId,
      comments,
      total: comments.length,
    });
  } catch (error) {
    console.error('Error fetching video comments:', error);
    res.status(500).json({ error: 'Failed to fetch video comments' });
  }
});

/**
 * GET /youtube/accounts/:id/analytics
 * Get channel analytics and monetization info
 */
youtubeRouter.get('/accounts/:id/analytics', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id) as YouTubeAccountRecord;

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    const config: YouTubeConfig = {
      clientId: record.clientId,
      clientSecret: record.clientSecret,
      refreshToken: record.refreshToken,
      accessToken: record.accessToken,
    };

    const analytics = await getChannelAnalytics(config);
    res.json(analytics);
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

/**
 * GET /youtube/accounts/:id/super-chats
 * Get super chats and channel memberships
 */
youtubeRouter.get('/accounts/:id/super-chats', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { videoId } = req.query;
  const record = await store.getById(COL, req.params.id) as YouTubeAccountRecord;

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    const config: YouTubeConfig = {
      clientId: record.clientId,
      clientSecret: record.clientSecret,
      refreshToken: record.refreshToken,
      accessToken: record.accessToken,
    };

    const superChats = await getSuperChats(config, videoId as string);
    res.json({
      superChats,
      total: superChats.length,
    });
  } catch (error) {
    console.error('Error fetching super chats:', error);
    res.status(500).json({ error: 'Failed to fetch super chats' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// API Key 模式（无需 OAuth，读取公开频道数据）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /youtube/public/comments
 * 用 API Key 拉取频道所有视频的评论
 * Query: channelId (必填) | maxResults | pageToken | order
 */
youtubeRouter.get('/public/comments', async (req, res) => {
  if (!YOUTUBE_API_KEY) {
    res.status(503).json({ error: 'YOUTUBE_API_KEY not configured in .env' });
    return;
  }

  const { channelId, maxResults = '100', pageToken, order = 'time' } = req.query as Record<string, string>;

  if (!channelId) {
    res.status(400).json({ error: 'channelId is required' });
    return;
  }

  try {
    const result = await getChannelCommentsByApiKey(YOUTUBE_API_KEY, channelId, {
      maxResults: Number(maxResults),
      pageToken,
      order: order as 'time' | 'relevance',
    });
    res.json(result);
  } catch (error: any) {
    console.error('Error fetching channel comments by API key:', error);
    const status = error?.response?.status || 500;
    res.status(status).json({ error: error?.response?.data?.error?.message || 'Failed to fetch comments' });
  }
});

/**
 * GET /youtube/public/video/:videoId/comments
 * 用 API Key 拉取指定视频的评论
 * Query: maxResults | pageToken | order
 */
youtubeRouter.get('/public/video/:videoId/comments', async (req, res) => {
  if (!YOUTUBE_API_KEY) {
    res.status(503).json({ error: 'YOUTUBE_API_KEY not configured in .env' });
    return;
  }

  const { videoId } = req.params;
  const { maxResults = '100', pageToken, order = 'time' } = req.query as Record<string, string>;

  try {
    const result = await getVideoCommentsByApiKey(YOUTUBE_API_KEY, videoId, {
      maxResults: Number(maxResults),
      pageToken,
      order: order as 'time' | 'relevance',
    });
    res.json(result);
  } catch (error: any) {
    console.error('Error fetching video comments by API key:', error);
    const status = error?.response?.status || 500;
    res.status(status).json({ error: error?.response?.data?.error?.message || 'Failed to fetch comments' });
  }
});

/**
 * GET /youtube/public/resolve-handle
 * 通过 YouTube handle（如 @YourChannel）查询频道 ID
 * Query: handle (必填)
 */
youtubeRouter.get('/public/resolve-handle', async (req, res) => {
  if (!YOUTUBE_API_KEY) {
    res.status(503).json({ error: 'YOUTUBE_API_KEY not configured in .env' });
    return;
  }

  const { handle } = req.query as { handle: string };
  if (!handle) {
    res.status(400).json({ error: 'handle is required' });
    return;
  }

  try {
    const channelId = await getChannelIdByHandle(YOUTUBE_API_KEY, handle);
    if (!channelId) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }
    res.json({ channelId, handle });
  } catch (error: any) {
    console.error('Error resolving channel handle:', error);
    res.status(500).json({ error: 'Failed to resolve channel handle' });
  }
});

/**
 * POST /youtube/accounts/:id/sync
 * Manually trigger a sync of YouTube data
 */
youtubeRouter.post('/accounts/:id/sync', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id) as YouTubeAccountRecord;

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    const config: YouTubeConfig = {
      clientId: record.clientId,
      clientSecret: record.clientSecret,
      refreshToken: record.refreshToken,
      accessToken: record.accessToken,
    };

    const channelInfo = await getMyChannelInfo(config);
    const analytics = await safeChannelAnalytics(config, channelInfo);

    await store.update(COL, req.params.id, {
      channelId: channelInfo.id,
      channelTitle: channelInfo.title,
      channelDescription: channelInfo.description,
      customUrl: channelInfo.customUrl || '',
      thumbnailUrl: channelInfo.thumbnailUrl || '',
      subscriberCount: channelInfo.subscriberCount,
      videoCount: analytics.totalVideos,
      viewCount: analytics.totalViews,
      lastSyncAt: new Date().toISOString(),
      status: 'connected',
    });

    res.json({ ok: true, message: 'Sync triggered successfully', channelTitle: channelInfo.title });
  } catch (error) {
    console.error('Error syncing YouTube account:', error);
    res.status(500).json({ error: 'Failed to sync YouTube account' });
  }
});
