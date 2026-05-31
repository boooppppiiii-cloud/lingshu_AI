const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 1000;

const nativeFetch: typeof fetch = globalThis.fetch.bind(globalThis);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** 是否应对该 URL 使用 Gemini 出站策略（仅 Google Generative API 相关域名）。 */
export function isGeminiGoogleFetchUrl(input: RequestInfo | URL): boolean {
  try {
    const url =
      typeof input === 'string'
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
    const host = url.hostname.toLowerCase();
    return (
      host === 'generativelanguage.googleapis.com' ||
      host.endsWith('.generativelanguage.googleapis.com')
    );
  } catch {
    return false;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 网络类失败可重试；不含 429 配额、4xx 参数错误。 */
export function isRetryableGeminiNetworkError(err: unknown): boolean {
  if (!err) return false;
  const msg = errorMessage(err).toLowerCase();
  if (
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('invalid api key') ||
    msg.includes('api key not valid')
  ) {
    return false;
  }
  if (err instanceof TypeError && msg.includes('fetch')) return true;
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED' ||
      code === 'EPIPE' ||
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN'
    ) {
      return true;
    }
    if (
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('socket hang up') ||
      msg.includes('network') ||
      msg.includes('fetch failed') ||
      msg.includes('abort') ||
      msg.includes('retryable http')
    ) {
      return true;
    }
  }
  return false;
}

function isRetryableHttpResponse(response: Response): boolean {
  return response.status === 502 || response.status === 503 || response.status === 504;
}

async function directFetchOnce(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await nativeFetch(input, init);
  if (isRetryableHttpResponse(response)) {
    throw new Error(`Retryable HTTP ${response.status} via direct`);
  }
  return response;
}

/** 新加坡直连 Google，失败时有限次重试。 */
export async function geminiOutboundFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const maxRetries = envInt('GEMINI_OUTBOUND_RETRIES', DEFAULT_RETRIES);
  const retryBaseMs = envInt('GEMINI_OUTBOUND_RETRY_MS', DEFAULT_RETRY_BASE_MS);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await directFetchOnce(input, init);
    } catch (err) {
      lastErr = err;
      if (!isRetryableGeminiNetworkError(err) || attempt >= maxRetries) {
        throw err;
      }
      const delay = retryBaseMs * 2 ** attempt;
      console.warn(
        `[gemini-outbound] direct attempt ${attempt + 1} failed (${errorMessage(err)}), retry in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

let installed = false;

/**
 * 仅对 generativelanguage.googleapis.com 的请求走直连+重试，其它 fetch 不变（PocketBase 等）。
 */
export function installGeminiOutboundFetch(): void {
  if (installed) return;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (isGeminiGoogleFetchUrl(input)) {
      return geminiOutboundFetch(input, init);
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  installed = true;
}

export function logGeminiOutboundConfig(): void {
  const maxRetries = envInt('GEMINI_OUTBOUND_RETRIES', DEFAULT_RETRIES);
  console.log(`[script-ai] Gemini outbound: direct (Singapore), retries=${maxRetries}`);
}
