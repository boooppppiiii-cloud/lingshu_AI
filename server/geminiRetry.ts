import { runGeminiOp, type GeminiOpBody } from './geminiBackend';
import { runGeminiThroughQueue } from './geminiConcurrencyQueue';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetriableGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /503|502|504|429|UNAVAILABLE|high demand|RESOURCE_EXHAUSTED|繁忙|限流/i.test(msg);
}

/** ingest / backfill：走并发队列 + 503 时指数退避重试 */
export async function runGeminiOpWithRetry(
  body: GeminiOpBody,
  maxAttempts = 6,
): Promise<unknown> {
  const backoffMs = [2000, 5000, 10000, 20000, 30000];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runGeminiThroughQueue(() => runGeminiOp(body));
    } catch (e) {
      lastErr = e;
      if (!isRetriableGeminiError(e) || attempt >= maxAttempts) throw e;
      await sleep(backoffMs[attempt - 1] ?? 30000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * 交互路径（用户在等结果）：在出站层 GEMINI_OUTBOUND_RETRIES 之外再加一层 op 级别短重试。
 * Gemini 上游 503 经常是连续的，出站层只覆盖单次连接级失败；这里用更长的 sleep 跨过短期波动。
 * 最多额外等 2+4=6 秒。失败次数仍受 isRetriableGeminiError 限制（429/key/参数错不重试）。
 */
export async function runGeminiOpInteractive(
  body: GeminiOpBody,
  maxAttempts = 3,
): Promise<unknown> {
  const backoffMs = [2000, 4000];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runGeminiThroughQueue(() => runGeminiOp(body));
    } catch (e) {
      lastErr = e;
      if (!isRetriableGeminiError(e) || attempt >= maxAttempts) throw e;
      await sleep(backoffMs[attempt - 1] ?? 4000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
