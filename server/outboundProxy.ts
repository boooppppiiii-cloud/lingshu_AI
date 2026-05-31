import { installGeminiOutboundFetch, logGeminiOutboundConfig } from './geminiOutbound';

/**
 * 配置 Gemini 出站：仅拦截 generativelanguage.googleapis.com，新加坡直连 + 可配置重试。
 * PocketBase 等其它请求仍走系统默认 fetch。
 */
export function setupOutboundProxy(): { enabled: boolean; proxyUrl: string } {
  installGeminiOutboundFetch();
  logGeminiOutboundConfig();
  return { enabled: false, proxyUrl: '' };
}
