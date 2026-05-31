/**
 * Gemini 出站连通性自检（新加坡直连 + 重试，与生产一致）。
 *
 *   npm run test:outbound-proxy
 */
import path from 'node:path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  geminiOutboundFetch,
  installGeminiOutboundFetch,
  logGeminiOutboundConfig,
} from '../geminiOutbound';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local'), override: true });

installGeminiOutboundFetch();
logGeminiOutboundConfig();

const target = 'https://generativelanguage.googleapis.com/';
const started = Date.now();

try {
  const res = await geminiOutboundFetch(target, { method: 'GET', signal: AbortSignal.timeout(20_000) });
  const ms = Date.now() - started;
  console.log(JSON.stringify({ ok: true, route: 'direct', status: res.status, ms }));
  process.exit(0);
} catch (err) {
  const ms = Date.now() - started;
  console.error(
    JSON.stringify({
      ok: false,
      route: 'direct',
      ms,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
}
