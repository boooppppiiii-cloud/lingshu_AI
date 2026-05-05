/**
 * 本地/云端统一入口：
 * - 开发：只监听 API 端口，由 Vite 把 /api 代理过来
 * - 生产（NODE_ENV=production）：同时提供 dist 静态资源 + /api/gemini
 *
 * 密钥只读 process.env.GEMINI_API_KEY，永远不要放进前端。
 *
 * 出站代理：使用 npm 包 `undici` 的 ProxyAgent + setGlobalDispatcher，并把 globalThis.fetch
 * 指向同一实现的 fetch，这样 @google/genai 使用的全局 fetch 也会走代理。
 * （部分环境无内置 `node:undici` 模块，会直接导致 dev:api 起不来、8787 ECONNREFUSED。）
 *
 * 环境策略：非 production 且未配置任何代理时，默认走本机 http://127.0.0.1:7890；
 * production（云服务器）未配置代理则直连 Gemini。可用 LOCAL_GEMINI_DIRECT=1 在本地跳过默认代理。
 */
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express from 'express';
import { fetch as undiciFetch, ProxyAgent, setGlobalDispatcher } from 'undici';
import { runGeminiOp } from './geminiBackend';
import { runGeminiThroughQueue } from './geminiConcurrencyQueue';
import { parseGeminiRequest } from './parseGeminiBody';
import { adminCreateUsageRecord, getAuthenticatedUserIdFromPocketBase, logGeminiCallUsage } from './pbAdminUsage';
import { formatUsageDayShanghai } from './usageDay';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local'), override: true });

/**
 * dotenv 默认不覆盖「已存在」的环境变量。部分工具会先注入空占位符，
 * 导致 .env 里的 POCKETBASE_ADMIN_* 无法写入 process.env。此处从磁盘强制合并这两项。
 */
function mergePocketBaseAdminFromDisk(baseDir: string) {
  const files = [path.join(baseDir, '.env'), path.join(baseDir, '.env.local')];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key !== 'POCKETBASE_ADMIN_EMAIL' && key !== 'POCKETBASE_ADMIN_PASSWORD') continue;
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (val) process.env[key] = val;
    }
  }
}
mergePocketBaseAdminFromDisk(root);

if (process.env.NODE_ENV !== 'production') {
  const hasPbUsageAdmin = Boolean(
    process.env.POCKETBASE_ADMIN_EMAIL?.trim() && process.env.POCKETBASE_ADMIN_PASSWORD?.trim(),
  );
  console.log(
    hasPbUsageAdmin
      ? '[script-ai] usage_events: PocketBase admin 凭据已加载（gemini.call / like.received 可写库）'
      : '[script-ai] usage_events: 未检测到 POCKETBASE_ADMIN_EMAIL/PASSWORD → 请在项目根 .env / .env.local 填写，并确认无空占位；gemini.call、like.received 不会写入',
  );
}

const proxyFromEnv =
  process.env.OUTBOUND_PROXY?.trim() ||
  process.env.HTTPS_PROXY?.trim() ||
  process.env.HTTP_PROXY?.trim();

const isProd = process.env.NODE_ENV === 'production';
const skipLocalDefault =
  process.env.LOCAL_GEMINI_DIRECT === '1' || /^true$/i.test(process.env.LOCAL_GEMINI_DIRECT ?? '');

const defaultLocalProxy = 'http://127.0.0.1:7890';
const outboundProxy =
  proxyFromEnv ||
  (isProd || skipLocalDefault ? '' : defaultLocalProxy);

if (outboundProxy) {
  setGlobalDispatcher(new ProxyAgent(outboundProxy));
  globalThis.fetch = undiciFetch as typeof fetch;
  console.log('[script-ai] outbound fetch proxy:', outboundProxy);
} else if (isProd) {
  console.log('[script-ai] production: outbound fetch direct (no proxy)');
} else {
  console.log('[script-ai] dev: LOCAL_GEMINI_DIRECT — outbound fetch direct (no proxy)');
}
const app = express();

app.use(express.json({ limit: '50mb' }));

/**
 * 为「被点赞用户」写 like.received 流水（需 PocketBase 用户 Authorization；服务端用 admin 代写）。
 */
app.post('/api/usage/like-received', async (req, res) => {
  const actorId = await getAuthenticatedUserIdFromPocketBase(req.headers.authorization);
  if (!actorId) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  const body = req.body as {
    ownerId?: string;
    marketId?: string;
    actorId?: string;
    delta?: number;
  };
  if (
    typeof body.ownerId !== 'string' ||
    typeof body.marketId !== 'string' ||
    body.actorId !== actorId ||
    body.ownerId === actorId
  ) {
    res.status(400).json({ ok: false, error: 'Bad request' });
    return;
  }
  const ok = await adminCreateUsageRecord({
    day: formatUsageDayShanghai(),
    event: 'like.received',
    user: body.ownerId,
    source: 'inspiration_market',
    ref_collection: 'market',
    ref_id: body.marketId,
    meta: { actor_id: actorId, delta: typeof body.delta === 'number' ? body.delta : 0 },
  });
  if (!ok) {
    res.status(503).json({ ok: false, error: 'Usage log unavailable' });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/gemini', async (req, res) => {
  let op = 'unknown';
  let analyticsUserId: string | undefined;
  const started = Date.now();
  let ok = false;
  try {
    const parsed = parseGeminiRequest(req.body);
    const { opBody, analyticsUserId: uid } = parsed;
    analyticsUserId = uid;
    op = String((opBody as { op: string }).op);
    const data = await runGeminiThroughQueue(() => runGeminiOp(opBody));
    ok = true;
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[api/gemini]', err);
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message === 'Invalid body' || message === 'Invalid or unknown op'
        ? 400
        : message.includes('GEMINI_API_KEY')
          ? 503
          : 500;
    res.status(status).json({ ok: false, error: message });
    if (message !== 'Invalid body' && message !== 'Invalid or unknown op') {
      void logGeminiCallUsage({
        op,
        ok: false,
        durationMs: Date.now() - started,
        userId: analyticsUserId,
        errorMessage: message,
      });
    }
    return;
  }
  void logGeminiCallUsage({
    op,
    ok,
    durationMs: Date.now() - started,
    userId: analyticsUserId,
  });
});

if (isProd) {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ ok: false, error: 'Not found' });
      return;
    }
    if (req.method !== 'GET') {
      next();
      return;
    }
    res.sendFile(path.join(dist, 'index.html'));
  });
}

const port = Number(process.env.PORT) || (isProd ? 3000 : 8787);
app.listen(port, () => {
  console.log(
    isProd
      ? `[script-ai] production http://0.0.0.0:${port} (static + /api/gemini)`
      : `[script-ai] API only http://127.0.0.1:${port} (use Vite proxy /api)`,
  );
});
