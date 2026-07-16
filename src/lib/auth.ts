/* 账号 / 登录：token 存 localStorage，注入到所有 API 请求 */

const TOKEN_KEY = 'overseas_token';
const SUPPORT_ORIGINAL_TOKEN_KEY = 'overseas_support_original_token';

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t: string): void { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken(): void { localStorage.removeItem(TOKEN_KEY); }
/** 给 fetch 用的鉴权头（无 token 时为空对象） */
export function authHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export interface AuthUser { id: string; email: string; name: string; tenantId: string }
export interface AuthTenant {
  id: string; name: string;
  subscriptionStatus: string;
  subscriptionPlan: string | null;
  subscriptionExpiresAt: string | null;
}
export interface AuthSession {
  user: AuthUser;
  tenant: AuthTenant | null;
  subscription?: { status: string; plan: string | null; expiresAt: string | null };
  demo?: {
    enabled: boolean;
    trialDays: number;
    expiresAt: string | null;
    daysRemaining: number | null;
    expired: boolean;
    limits: { trialDays: number; aiChatDaily: number; generationDaily: number; renderDaily: number; videoGenerationDaily: number; tokenDaily: number; tokenTotal: number };
    usage: { aiChat: number; generation: number; render: number; videoGeneration: number; tokens: number };
    remaining: { aiChat: number; generation: number; render: number; videoGeneration: number; tokens: number };
    totalUsage?: { tokens: number; videoGeneration: number };
    totalRemaining?: { tokens: number; videoGeneration: number };
    guideTrigger?: boolean;
    guideScope?: string;
  };
  supportAccess?: {
    requestId: string;
    adminEmail: string;
    tenantName: string;
    expiresAt?: string;
  };
}

export function startSupportSession(token: string): void {
  const current = getToken();
  if (current && !localStorage.getItem(SUPPORT_ORIGINAL_TOKEN_KEY)) {
    localStorage.setItem(SUPPORT_ORIGINAL_TOKEN_KEY, current);
  }
  setToken(token);
}

export function exitSupportSession(): boolean {
  const original = localStorage.getItem(SUPPORT_ORIGINAL_TOKEN_KEY);
  localStorage.removeItem(SUPPORT_ORIGINAL_TOKEN_KEY);
  if (!original) return false;
  setToken(original);
  return true;
}

const wait = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds));

async function authRequest(path: string, body: unknown): Promise<Response> {
  const attempts = path === 'login' ? 3 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(`/api/overseas/auth/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await wait(attempt === 0 ? 500 : 1200);
    }
  }

  throw new Error(lastError instanceof TypeError ? '服务正在启动，请稍后重试' : '服务暂时无法连接，请稍后重试');
}

async function call(path: string, body: unknown): Promise<{ token: string; user: AuthUser; tenant: AuthTenant | null; demo?: AuthSession['demo'] }> {
  const r = await authRequest(path, body);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || '请求失败');
  return j;
}

export const authApi = {
  register: (email: string, password: string, inviteCode: string) =>
    call('register', { email, password, inviteCode }),
  login: (email: string, password: string) =>
    call('login', { email, password }),
  invite: async (inviteCode: string): Promise<{ valid: boolean; companyName: string }> => {
    const r = await fetch(`/api/overseas/auth/invite/${encodeURIComponent(inviteCode)}`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok && !j.companyName) throw new Error(j.error || '邀请码无效或已使用');
    return j;
  },
  me: async (): Promise<AuthSession | null> => {
    if (!getToken()) return null;
    try {
      const r = await fetch('/api/overseas/auth/me', { headers: authHeader() });
      if (!r.ok) {
        if ((r.status === 401 || r.status === 402) && exitSupportSession()) {
          const restored = await fetch('/api/overseas/auth/me', { headers: authHeader() });
          if (restored.ok) return (await restored.json()) as AuthSession;
        }
        if (r.status === 401 || r.status === 402) clearToken();
        return null;
      }
      return (await r.json()) as AuthSession;
    } catch {
      return null;
    }
  },
  guideSeen: async (): Promise<void> => {
    if (!getToken()) return;
    await fetch('/api/overseas/auth/guide-seen', { method: 'POST', headers: authHeader() }).catch(() => {});
  },
  logout: () => {
    clearToken();
    localStorage.removeItem(SUPPORT_ORIGINAL_TOKEN_KEY);
  },
};
