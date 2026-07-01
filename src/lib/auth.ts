/* 账号 / 登录：token 存 localStorage，注入到所有 API 请求 */

const TOKEN_KEY = 'overseas_token';

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
}

async function call(path: string, body: unknown): Promise<{ token: string; user: AuthUser; tenant: AuthTenant | null; demo?: AuthSession['demo'] }> {
  const r = await fetch(`/api/overseas/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || '请求失败');
  return j;
}

export const authApi = {
  register: (email: string, password: string, companyName: string, inviteCode?: string) =>
    call('register', { email, password, companyName, inviteCode }),
  login: (email: string, password: string) =>
    call('login', { email, password }),
  me: async (): Promise<AuthSession | null> => {
    if (!getToken()) return null;
    try {
      const r = await fetch('/api/overseas/auth/me', { headers: authHeader() });
      if (!r.ok) {
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
  logout: () => clearToken(),
};
