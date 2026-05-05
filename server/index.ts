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
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express from 'express';
import { fetch as undiciFetch, ProxyAgent, setGlobalDispatcher } from 'undici';
import { runGeminiOp, type GeminiOpBody } from './geminiBackend';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local'), override: true });

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

app.post('/api/gemini', async (req, res) => {
  try {
    const body = req.body as GeminiOpBody;
    if (!body || typeof body !== 'object' || !('op' in body)) {
      res.status(400).json({ ok: false, error: 'Invalid body' });
      return;
    }
    const data = await runGeminiOp(body);
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[api/gemini]', err);
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('GEMINI_API_KEY') ? 503 : 500;
    res.status(status).json({ ok: false, error: message });
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
      ? `[script-ai] production http://0.0.0.0:${port} (static + /api/gemini)`
      : `[script-ai] API only http://127.0.0.1:${port} (use Vite proxy /api)`,
  );
});
