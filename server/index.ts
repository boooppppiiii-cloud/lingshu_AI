import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import dotenv from 'dotenv';
import express from 'express';
import compression from 'compression';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { copywritingRouter } from './routes/copywriting.js';
import { translationRouter } from './routes/translation.js';
import { competitorRouter } from './routes/competitor.js';
import { competitorAccountsRouter } from './routes/competitorAccounts.js';
import { strategyRouter } from './routes/strategy.js';
import { initCrawlerOpsWorker, videosRouter } from './routes/videos.js';
import { scriptsRouter } from './routes/scripts.js';
import { trendsRouter } from './routes/trends.js';
import { assetsRouter } from './routes/assets.js';
import { enterpriseRouter, productApiRouter } from './routes/enterprise.js';
import { agentChatRouter } from './routes/agentChat.js';
import { draftReplyRouter } from './routes/draftReply.js';
import { customerSuggestionsRouter } from './routes/customerSuggestions.js';
import { channelsRouter } from './routes/channels.js';
import { schedulerRouter, initScheduler } from './routes/scheduler.js';
import { pluginsRouter } from './routes/plugins.js';
import { studioRouter } from './routes/studio.js';
import { authRouter } from './routes/auth.js';
import { youtubeRouter } from './routes/youtube.js';
import { socialRouter } from './routes/social.js';
import { platformIntegrationsRouter } from './routes/platformIntegrations.js';
import { adminRouter } from './routes/admin.js';
import { assistantThreadsRouter } from './routes/assistantThreads.js';
import { webhookRouter } from './routes/webhooks.js';
import { isDemoMode, demoLimits } from './lib/demo.js';
import { initTenantPlatformTokenMonitor } from './routes/tenantPlatformTokenMonitor.js';
import { assistLinksRouter } from './routes/assistLinks.js';
import { initWhatsAppCustomerMaintenance } from './whatsapp/historyImport.js';
import { whatsappOAuthRouter } from './routes/whatsappOAuth.js';
import { ensureDeliveryCollections } from './storage/ensureDeliveryCollections.js';
import { supportAccessRouter } from './routes/supportAccess.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
configureNetworkProxy();
try {
  await ensureDeliveryCollections();
} catch (error) {
  console.error('[pb-init] failed to ensure tenants / tenant_platform_apps collections:', error instanceof Error ? error.message : error);
}

const PORT = Number(process.env.PORT ?? 8788);
const app = express();

function configureNetworkProxy(): void {
  const configured = process.env.GEMINI_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.CRAWLER_PROXY;
  const proxy = configured || detectLocalProxy();
  if (!proxy) return;
  process.env.HTTPS_PROXY ||= proxy;
  process.env.HTTP_PROXY ||= proxy;
  process.env.https_proxy ||= proxy;
  process.env.http_proxy ||= proxy;
  process.env.CRAWLER_PROXY ||= proxy;
  process.env.NODE_USE_ENV_PROXY ||= '1';
  // ProxyAgent 不认 NO_PROXY，会把发往 localhost（PocketBase 等）的请求也塞进代理导致静默失败；
  // EnvHttpProxyAgent 按 NO_PROXY 绕行本地和 PB 主机。
  const pbHost = (() => { try { return new URL(process.env.PB_URL || 'http://localhost:8090').hostname; } catch { return ''; } })();
  const noProxy = ['localhost', '127.0.0.1', '::1', pbHost].filter(Boolean).join(',');
  process.env.NO_PROXY = process.env.NO_PROXY ? `${process.env.NO_PROXY},${noProxy}` : noProxy;
  process.env.no_proxy = process.env.NO_PROXY;
  setGlobalDispatcher(new EnvHttpProxyAgent());
  console.log(`[network] using proxy ${proxy} (NO_PROXY=${process.env.NO_PROXY})`);
}

function detectLocalProxy(): string {
  if (process.env.NODE_ENV === 'production') return '';
  for (const port of [7890, 7897, 1087, 1080, 20171]) {
    try {
      execFileSync('nc', ['-z', '127.0.0.1', String(port)], { stdio: 'ignore', timeout: 600 });
      return `http://127.0.0.1:${port}`;
    } catch { /* try next */ }
  }
  return '';
}

// 跳过 SSE 流式响应（text/event-stream），否则 gzip 缓冲会拖慢首字
app.use(compression({
  filter: (req, res) => res.getHeader('Content-Type') === 'text/event-stream' ? false : compression.filter(req, res),
}));
// Supports base64-encoded admin/manual video uploads (≈90MB raw video).
app.use(express.json({
  limit: '120mb',
  verify: (req, _res, buf) => {
    (req as any).rawBody = Buffer.from(buf);
  },
}));

app.get('/api/overseas/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'overseas-marketing-agent',
    port: PORT,
    demoMode: isDemoMode(),
    demoLimits: demoLimits(),
    featureLocks: {
      geminiVideo: process.env.GEMINI_VIDEO_ENABLED !== 'true',
      seedanceVideo: process.env.SEEDANCE_VIDEO_ENABLED !== 'true',
    },
  });
});

// Legacy routes (stub → to be implemented separately)
app.use('/api/overseas/copywriting', copywritingRouter);
app.use('/api/overseas/translation', translationRouter);
app.use('/api/overseas/competitor', competitorRouter);
app.use('/api/overseas/competitor-accounts', competitorAccountsRouter);
app.use('/api/overseas/strategy', strategyRouter);

// Core routes
app.use('/api/overseas/videos', videosRouter);
app.use('/api/overseas/scripts', scriptsRouter);
app.use('/api/overseas/trends', trendsRouter);
app.use('/api/overseas/assets', assetsRouter);
app.use('/api/overseas/enterprise', enterpriseRouter);
app.use('/api/overseas/agents', agentChatRouter);
app.use('/api/overseas/agents', draftReplyRouter);
app.use('/api/overseas/customers', customerSuggestionsRouter);
app.use('/api/overseas/channels', channelsRouter);
app.use('/api/channels', channelsRouter);
app.use('/api/oauth/whatsapp', whatsappOAuthRouter);
app.use('/api', assistLinksRouter);
app.use('/api/overseas/youtube', youtubeRouter);
app.use('/api/overseas/social', socialRouter);
app.use('/api/overseas/scheduler', schedulerRouter);
app.use('/api/overseas/plugins', pluginsRouter);
app.use('/api/overseas/auth', authRouter);
app.use('/api/overseas/admin', adminRouter);
app.use('/api/overseas/support-access', supportAccessRouter);
app.use('/api/overseas/studio', studioRouter);
app.use('/api/overseas/platform-integrations', platformIntegrationsRouter);
app.use('/api/overseas/assistant-threads', assistantThreadsRouter);
app.use('/api/v1/products', productApiRouter);
app.use('/api/webhooks', webhookRouter);

initScheduler();
initCrawlerOpsWorker();
initTenantPlatformTokenMonitor();
initWhatsAppCustomerMaintenance();

// 素材库本地文件托管（POST /studio/materials 上传到 data/media/）
const mediaDir = path.join(__dirname, '..', 'data', 'media');
app.use('/media', express.static(mediaDir, {
  maxAge: '7d',
  immutable: true,
}));

// BGM 曲库本地文件托管（POST /studio/bgm 上传）
const bgmDir = path.join(__dirname, '..', 'data', 'bgm');
app.use('/bgm', express.static(bgmDir, { maxAge: '7d', immutable: true }));

// TTS 配音音频托管（POST /studio/tts 生成到 data/tts/）
const ttsDir = path.join(__dirname, '..', 'data', 'tts');
app.use('/tts', express.static(ttsDir, { maxAge: '1d' }));

// 真人音色样本托管（POST /studio/voice-samples 上传）
const voiceSamplesDir = path.join(__dirname, '..', 'data', 'voice-samples');
app.use('/voice-samples', express.static(voiceSamplesDir, { maxAge: '1d' }));

// 封面 SVG 托管（POST /studio/cover 生成到 data/covers/）
const coversDir = path.join(__dirname, '..', 'data', 'covers');
app.use('/covers', express.static(coversDir, { maxAge: '7d', immutable: true }));

// Serve built frontend
const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir, {
  setHeaders: (res, filePath) => {
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[overseas-agent] http://0.0.0.0:${PORT}`);
});
