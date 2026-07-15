import { authHeader } from './auth';

declare global {
  interface Window {
    FB?: {
      init: (options: Record<string, unknown>) => void;
      login: (
        callback: (response: { authResponse?: { code?: string }; status?: string }) => void,
        options: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

interface SignupConfig {
  appId: string;
  configId: string;
  tenantId?: string;
}

interface SignupResult {
  ok: boolean;
  app?: unknown;
}

const SDK_ID = 'facebook-jssdk';
const FB_SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';

let sdkPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.FB) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    window.fbAsyncInit = () => resolve();
    const existing = document.getElementById(SDK_ID);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Meta SDK 加载失败')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = SDK_ID;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.src = FB_SDK_URL;
    script.onerror = () => reject(new Error('Meta SDK 加载失败'));
    document.body.appendChild(script);
  });
  return sdkPromise;
}

function parseSessionMessage(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  try {
    const data = JSON.parse(raw);
    if (data?.type !== 'WA_EMBEDDED_SIGNUP') return null;
    return data;
  } catch {
    return null;
  }
}

function waitForSessionInfo(): { promise: Promise<Record<string, unknown>>; cleanup: () => void } {
  let cleanup = () => {};
  const promise = new Promise<Record<string, unknown>>(resolve => {
    const timer = window.setTimeout(() => resolve({}), 90_000);
    const handler = (event: MessageEvent) => {
      if (!['https://www.facebook.com', 'https://web.facebook.com'].includes(event.origin)) return;
      const parsed = parseSessionMessage(event.data);
      if (!parsed) return;
      const eventName = String(parsed.event || '');
      if (eventName !== 'FINISH' && eventName !== 'FINISH_ONLY_WABA') return;
      window.clearTimeout(timer);
      resolve((parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed) as Record<string, unknown>);
    };
    window.addEventListener('message', handler);
    cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', handler);
    };
  });
  return { promise, cleanup };
}

async function exchangeCode(input: { code: string; sessionInfo: Record<string, unknown>; tenantId?: string }): Promise<SignupResult> {
  const resp = await fetch('/api/oauth/whatsapp/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(input),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.message || data.error || 'WhatsApp 授权交换失败');
  return data as SignupResult;
}

export async function getWhatsAppEmbeddedSignupConfig(tenantId?: string): Promise<SignupConfig> {
  const url = new URL('/api/oauth/whatsapp/config', window.location.origin);
  if (tenantId) url.searchParams.set('tenantId', tenantId);
  const resp = await fetch(url.toString(), { headers: authHeader() });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || '无法读取 WhatsApp 授权配置');
  if (!data.configured) {
    const missing = data.missing || {};
    const fields = [
      missing.appId ? 'App ID' : '',
      missing.appSecret ? 'App Secret' : '',
      missing.configId ? 'Embedded Signup Config ID' : '',
    ].filter(Boolean).join(' / ');
    throw new Error(`请先在交付工作台配置 ${fields || 'Meta 应用信息'}`);
  }
  return { appId: String(data.appId), configId: String(data.configId), tenantId: String(data.tenantId || tenantId || '') };
}

export async function startWhatsAppEmbeddedSignup(config: SignupConfig): Promise<SignupResult> {
  await loadSdk();
  if (!window.FB) throw new Error('Meta SDK 未就绪');
  window.FB.init({
    appId: config.appId,
    cookie: true,
    xfbml: false,
    version: 'v25.0',
  });

  const session = waitForSessionInfo();
  try {
    const response = await new Promise<{ authResponse?: { code?: string }; status?: string }>((resolve, reject) => {
      window.FB?.login(resolve, {
        config_id: config.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
        },
      });
      window.setTimeout(() => reject(new Error('WhatsApp 授权弹窗超时')), 120_000);
    });
    const code = response.authResponse?.code;
    if (!code) throw new Error('未拿到 WhatsApp Embedded Signup code');
    const sessionInfo = await session.promise;
    return await exchangeCode({ code, sessionInfo, tenantId: config.tenantId });
  } finally {
    session.cleanup();
  }
}
