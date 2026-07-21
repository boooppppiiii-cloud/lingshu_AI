import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawn } from 'child_process';
import dotenv from 'dotenv';
import express from 'express';
import compression from 'compression';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { copywritingRouter } from './routes/copywriting.js';
import { translationRouter } from './routes/translation.js';
import { competitorRouter } from './routes/competitor.js';
import { competitorAccountsRouter } from './routes/competitorAccounts.js';
import { strategyRouter } from './routes/strategy.js';
import { initCrawlerOpsWorker, initPocketBaseVideoBackfill, videosRouter } from './routes/videos.js';
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
import { publishingRouter } from './routes/publishing.js';
import { ensureDeliveryCollections, ensureTrendVideoAnalysisCapacity } from './storage/ensureDeliveryCollections.js';
import { supportAccessRouter } from './routes/supportAccess.js';
import { crawlWorkerRouter, initCrawlWorkerCloudFallback } from './routes/crawlWorker.js';
import { requireScopedAsset, syncAssetSession } from './lib/assetAccess.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
await ensureLocalPocketBase();
configureNetworkProxy();
try {
  await ensureDeliveryCollections();
  await ensureTrendVideoAnalysisCapacity();
} catch (error) {
  console.error('[pb-init] failed to ensure tenants / tenant_platform_apps collections:', error instanceof Error ? error.message : error);
}

const PORT = Number(process.env.PORT ?? 8788);
const app = express();

async function ensureLocalPocketBase(): Promise<void> {
  if (process.env.NODE_ENV === 'production' || process.env.PB_AUTO_START !== 'true') return;
  const url = process.env.PB_URL || 'http://127.0.0.1:8090';
  try { if ((await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(800) })).ok) return; } catch { /* start below */ }
  const bin = process.env.PB_BIN || '';
  const dataDir = process.env.PB_DATA_DIR || '';
  if (!bin || !dataDir) { console.warn('[pb] auto-start skipped: PB_BIN/PB_DATA_DIR missing'); return; }
  const parsed = new URL(url);
  const child = spawn(bin, ['serve', `--http=${parsed.hostname}:${parsed.port || '8090'}`, `--dir=${dataDir}`], { cwd: path.dirname(bin), stdio: 'ignore', detached: true });
  child.unref();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 250));
    try { if ((await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(800) })).ok) { console.log(`[pb] auto-started at ${url}`); return; } } catch { /* retry */ }
  }
  console.error(`[pb] auto-start failed at ${url}`);
}

function configureNetworkProxy(): void {
  const configured = process.env.GEMINI_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.CRAWLER_PROXY;
  // Prefer a healthy direct connection. A listening local port is not enough to
  // prove that it is an HTTP proxy (other apps commonly occupy these ports).
  // Gemini and YouTube can have different reachability on the same network.
  // Only stay on the direct route when both services are reachable.
  const proxy = configured || (canReachGoogleDirectly() && canReachYouTubeDirectly() ? '' : detectLocalProxy());
  if (!proxy) return;
  process.env.HTTPS_PROXY ||= proxy;
  process.env.HTTP_PROXY ||= proxy;
  process.env.https_proxy ||= proxy;
  process.env.http_proxy ||= proxy;
  process.env.CRAWLER_PROXY ||= proxy;
  process.env.NODE_USE_ENV_PROXY ||= '1';
  // ProxyAgent 涓嶈 NO_PROXY锛屼細鎶婂彂寰€ localhost锛圥ocketBase 绛夛級鐨勮姹備篃濉炶繘浠ｇ悊瀵艰嚧闈欓粯澶辫触锛?
  // EnvHttpProxyAgent 鎸?NO_PROXY 缁曡鏈湴鍜?PB 涓绘満銆?
  const pbHost = (() => { try { return new URL(process.env.PB_URL || 'http://localhost:8090').hostname; } catch { return ''; } })();
  const noProxy = ['localhost', '127.0.0.1', '::1', pbHost].filter(Boolean).join(',');
  process.env.NO_PROXY = process.env.NO_PROXY ? `${process.env.NO_PROXY},${noProxy}` : noProxy;
  process.env.no_proxy = process.env.NO_PROXY;
  setGlobalDispatcher(new EnvHttpProxyAgent());
  console.log(`[network] using proxy ${proxy} (NO_PROXY=${process.env.NO_PROXY})`);
}

function curlCanReach(args: string[]): boolean {
  try {
    const status = execFileSync('curl', [
      '-sS', '-o', '/dev/null', '-w', '%{http_code}',
      '--connect-timeout', '2', '--max-time', '6', ...args,
      'https://generativelanguage.googleapis.com/',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 7000 }).trim();
    return status !== '' && status !== '000';
  } catch {
    return false;
  }
}

function canReachGoogleDirectly(): boolean {
  return curlCanReach(['--noproxy', '*']);
}

function canReachYouTubeDirectly(): boolean {
  try {
    const status = execFileSync('curl', [
      '-sS', '-o', '/dev/null', '-w', '%{http_code}',
      '--connect-timeout', '2', '--max-time', '6', '--noproxy', '*',
      'https://www.youtube.com/',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 7000 }).trim();
    return status !== '' && status !== '000';
  } catch {
    return false;
  }
}

function detectLocalProxy(): string {
  if (process.env.NODE_ENV === 'production') return '';
  // Clash Verge defaults to 7897 for its mixed proxy. Prefer it over 7890,
  // which may belong to another local proxy process that accepts connections
  // but cannot establish a valid TLS tunnel to YouTube.
  for (const port of [7897, 7890, 1087, 1080, 20171]) {
    try {
      execFileSync('nc', ['-z', '127.0.0.1', String(port)], { stdio: 'ignore', timeout: 600 });
      const proxy = `http://127.0.0.1:${port}`;
      if (curlCanReach(['--proxy', proxy])) return proxy;
    } catch { /* try next */ }
  }
  return '';
}

// 璺宠繃 SSE 娴佸紡鍝嶅簲锛坱ext/event-stream锛夛紝鍚﹀垯 gzip 缂撳啿浼氭嫋鎱㈤瀛?
app.use(compression({
  filter: (req, res) => {
    if (res.getHeader('Content-Type') === 'text/event-stream') return false;
    // TTS responses include dense word-level timestamps. On Node 24 the gzip
    // stream can stall after long outbound AI calls, leaving the client with an
    // empty response even though synthesis completed.
    if (req.path === '/api/overseas/studio/tts' || req.path === '/api/overseas/studio/tts/batch') return false;
    return compression.filter(req, res);
  },
}));
// Supports base64-encoded admin/manual video uploads (鈮?0MB raw video).
app.use(express.json({
  limit: '120mb',
  verify: (req, _res, buf) => {
    (req as any).rawBody = Buffer.from(buf);
  },
}));
app.use(syncAssetSession);

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

// Legacy routes (stub 鈫?to be implemented separately)
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
app.use('/api/overseas/publishing', publishingRouter);
app.use('/api', assistLinksRouter);
app.use('/api/overseas/youtube', youtubeRouter);
app.use('/api/overseas/social', socialRouter);
app.use('/api/overseas/scheduler', schedulerRouter);
app.use('/api/overseas/plugins', pluginsRouter);
app.use('/api/overseas/auth', authRouter);
app.use('/api/overseas/admin', adminRouter);
app.use('/api/overseas/support-access', supportAccessRouter);
app.use('/api/overseas/crawl-worker', crawlWorkerRouter);
app.use('/api/overseas/studio', studioRouter);
app.use('/api/overseas/platform-integrations', platformIntegrationsRouter);
app.use('/api/overseas/assistant-threads', assistantThreadsRouter);
app.use('/api/v1/products', productApiRouter);
app.use('/api/webhooks', webhookRouter);

await initScheduler();
initCrawlerOpsWorker();
initPocketBaseVideoBackfill();
initCrawlWorkerCloudFallback();
initTenantPlatformTokenMonitor();
await initWhatsAppCustomerMaintenance();

// 绱犳潗搴撴湰鍦版枃浠舵墭绠★紙POST /studio/materials 涓婁紶鍒?data/media/锛?
const mediaDir = path.join(__dirname, '..', 'data', 'media');
const privateAssetHeaders = (res: express.Response) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie, Authorization');
};
app.use('/media', requireScopedAsset, express.static(mediaDir, {
  setHeaders: privateAssetHeaders,
}));

// BGM 鏇插簱鏈湴鏂囦欢鎵樼锛圥OST /studio/bgm 涓婁紶锛?
const bgmDir = path.join(__dirname, '..', 'data', 'bgm');
app.use('/bgm', requireScopedAsset, express.static(bgmDir, { setHeaders: privateAssetHeaders }));

// TTS 閰嶉煶闊抽鎵樼锛圥OST /studio/tts 鐢熸垚鍒?data/tts/锛?
const ttsDir = path.join(__dirname, '..', 'data', 'tts');
app.use('/tts', requireScopedAsset, express.static(ttsDir, { setHeaders: privateAssetHeaders }));

// 鐪熶汉闊宠壊鏍锋湰鎵樼锛圥OST /studio/voice-samples 涓婁紶锛?
const voiceSamplesDir = path.join(__dirname, '..', 'data', 'voice-samples');
app.use('/voice-samples', requireScopedAsset, express.static(voiceSamplesDir, { setHeaders: privateAssetHeaders }));

// 灏侀潰 SVG 鎵樼锛圥OST /studio/cover 鐢熸垚鍒?data/covers/锛?
const coversDir = path.join(__dirname, '..', 'data', 'covers');
app.use('/covers', requireScopedAsset, express.static(coversDir, { setHeaders: privateAssetHeaders }));

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
