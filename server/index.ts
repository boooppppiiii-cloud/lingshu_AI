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
 * production（云服务器）未配置代理则直连 Gemini。可用 LOCAL_GEMINI_DIRECT=1 在本地跳过默认代理。
 */
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express from 'express';
import { fetch as undiciFetch, ProxyAgent, setGlobalDispatcher } from 'undici';
import { runGeminiOp, streamAnalyzeVideoIterationDeltas, streamGenerateDisplayProductionScriptDeltas } from './geminiBackend';
import { runGeminiThroughQueue } from './geminiConcurrencyQueue';
import { parseGeminiRequest } from './parseGeminiBody';
import { adminCreateUsageRecord, getAuthenticatedUserIdFromPocketBase, logGeminiCallUsage } from './pbAdminUsage';
import { ingestBuyingVideoRecord } from './buyingVideoIngest';
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
      ? '[script-ai] usage_events: PocketBase admin 凭据已加载（gemini.call / like.received / buying_videos.ingest 可写库）'
      : '[script-ai] usage_events: 未检测到 POCKETBASE_ADMIN_EMAIL/PASSWORD → 请在项目根 .env / .env.local 填写，并确认无空占位；gemini.call、like.received、buying_videos 自动分析不会写库',
  );
}

const proxyFromEnv =
  process.env.OUTBOUND_PROXY?.trim() ||
  process.env.HTTPS_PROXY?.trim() ||
  process.env.HTTP_PROXY?.trim();

const isProd = process.env.NODE_ENV === 'production';
const skipLocalDefault =
  process.env.LOCAL_GEMINI_DIRECT === '1' || /^true$/i.test(process.env.LOCAL_GEMINI_DIRECT ?? '');

const defaultLocalProxy = '';
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

/** Base64 约膨胀 4/3，视频类 op 需明显大于原文件体积；过小会导致「能选文件但接口 413」 */
app.use(express.json({ limit: '200mb' }));

/**
 * PocketBase `buying_videos` 入库后自动分析（由 PocketBase 侧调用本接口触发）。
 *
 * 请求：POST JSON `{ "recordId": "<新记录 id>" }`
 * 鉴权：Header `X-Ingest-Secret` 与进程环境变量 `BUYING_VIDEO_INGEST_SECRET` 一致（生产环境必填）。
 *
 * PocketBase 0.23+ 可在 `pb_hooks` 中绑定 `onRecordAfterCreateSuccess`（集合 `buying_videos`），
 * 在 `e.next()` 之后对 `http://<你的 API 主机>:8787/api/buying-videos/ingest` 发起 POST（勿阻塞事务过久）。
 *
 * 若记录已有非空 scriptTags（例如前端已跑过 AI），本接口会跳过并返回 `{ ok: true, skipped: true }`。
 */
app.post('/api/buying-videos/ingest', async (req, res) => {
  const secret = process.env.BUYING_VIDEO_INGEST_SECRET?.trim();
  const hdrRaw = req.headers['x-ingest-secret'];
  const hdr = typeof hdrRaw === 'string' ? hdrRaw : '';
  if (isProd && !secret) {
    res.status(503).json({ ok: false, error: 'BUYING_VIDEO_INGEST_SECRET is required in production' });
    return;
  }
  if (secret && hdr !== secret) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  if (!secret && !isProd) {
    console.warn(
      '[buying-videos/ingest] BUYING_VIDEO_INGEST_SECRET 未设置：开发环境允许无密钥调用，请勿将 API 暴露到公网',
    );
  }

  const body = req.body as { recordId?: string };
  if (typeof body.recordId !== 'string' || !body.recordId.trim()) {
    res.status(400).json({ ok: false, error: 'JSON body.recordId (string) is required' });
    return;
  }

  try {
    const out = await ingestBuyingVideoRecord(body.recordId.trim());
    if (!out.ok) {
      res.status(502).json({ ok: false, error: out.error ?? 'ingest failed' });
      return;
    }
    res.json({ ok: true, skipped: Boolean(out.skipped) });
  } catch (err) {
    console.error('[buying-videos/ingest]', err);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

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

/** NDJSON 流式：支持 analyzeVideoIteration、generateDisplayProductionScript；每行 JSON：{type:'delta',text} | {type:'done'} | {type:'error',message} */
app.post('/api/gemini/stream', async (req, res) => {
  let streamOp = 'unknown';
  let analyticsUserId: string | undefined;
  const started = Date.now();
  let startedNdjson = false;

  try {
    const parsed = parseGeminiRequest(req.body);
    analyticsUserId = parsed.analyticsUserId;
    const opBody = parsed.opBody;
    streamOp = opBody.op;

    if (opBody.op !== 'analyzeVideoIteration' && opBody.op !== 'generateDisplayProductionScript') {
      res.status(400).json({ ok: false, error: 'Streaming is not supported for this op' });
      return;
    }

    if (opBody.op === 'generateDisplayProductionScript') {
      const ds = Number(opBody.durationSeconds);
      if (!Number.isFinite(ds) || ds < 1 || ds > 600) {
        res.status(400).json({ ok: false, error: 'durationSeconds must be 1–600' });
        return;
      }
      if (typeof opBody.motionCardText !== 'string' || !opBody.motionCardText.trim()) {
        res.status(400).json({ ok: false, error: 'motionCardText is required' });
        return;
      }
    }

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    (res as { flushHeaders?: () => void }).flushHeaders?.();

    startedNdjson = true;

    await runGeminiThroughQueue(async () => {
      if (opBody.op === 'analyzeVideoIteration') {
        const streamBody = {
          videoBase64: opBody.videoBase64,
          mimeType: opBody.mimeType,
          style: opBody.style,
          moods: opBody.moods,
        };
        for await (const delta of streamAnalyzeVideoIterationDeltas(streamBody)) {
          const line = `${JSON.stringify({ type: 'delta', text: delta })}\n`;
          if (!res.write(line)) {
            await new Promise<void>((resolve) => res.once('drain', resolve));
          }
        }
      } else {
        const { op, ...rest } = opBody;
        void op;
        for await (const delta of streamGenerateDisplayProductionScriptDeltas(rest)) {
          const line = `${JSON.stringify({ type: 'delta', text: delta })}\n`;
          if (!res.write(line)) {
            await new Promise<void>((resolve) => res.once('drain', resolve));
          }
        }
      }
      res.write(`${JSON.stringify({ type: 'done' })}\n`);
    });

    void logGeminiCallUsage({
      op: streamOp,
      ok: true,
      durationMs: Date.now() - started,
      userId: analyticsUserId,
    });
  } catch (err) {
    console.error('[api/gemini/stream]', err);
    const message = err instanceof Error ? err.message : String(err);
    if (!startedNdjson) {
      const status =
        message === 'Invalid body' || message === 'Invalid or unknown op'
          ? 400
          : message.includes('GEMINI_API_KEY')
            ? 503
            : 500;
      res.status(status).json({ ok: false, error: message });
      if (message !== 'Invalid body' && message !== 'Invalid or unknown op') {
        void logGeminiCallUsage({
          op: streamOp,
          ok: false,
          durationMs: Date.now() - started,
          userId: analyticsUserId,
          errorMessage: message,
        });
      }
    } else {
      try {
        res.write(`${JSON.stringify({ type: 'error', message })}\n`);
      } catch {
        /* client disconnected */
      }
      void logGeminiCallUsage({
        op: streamOp,
        ok: false,
        durationMs: Date.now() - started,
        userId: analyticsUserId,
        errorMessage: message,
      });
    }
  } finally {
    if (startedNdjson) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  }
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
      ? `[script-ai] production http://0.0.0.0:${port} (static + /api/gemini + /api/gemini/stream)`
      : `[script-ai] API only http://127.0.0.1:${port} (use Vite proxy /api → /api/gemini, /api/gemini/stream)`,
  );
});
