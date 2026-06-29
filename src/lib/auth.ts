/* 账号 / 登录：token 存 localStorage，注入到所有 API 请求 */

const TOKEN_KEY = 'overseas_token';

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t: string): void { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken(): void { localStorage.removeItem(TOKEN_KEY); }
/** 给 fetch 用的鉴权头（无 token 时为空对象） */
export function authHeader(): Record<string, string> {
  const t = getToken();
  const headers: Record<string, string> = { 'ngrok-skip-browser-warning': 'true' };
  if (t) headers.Authorization = `Bearer ${t}`;
  return headers;
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
}

async function call(path: string, body: unknown): Promise<{ token: string; user: AuthUser; tenant: AuthTenant | null }> {
  const r = await fetch(`/api/overseas/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || '请求失败');
  return j;
}

export const authApi = {
  register: (email: string, password: string, companyName: string) =>
    call('register', { email, password, companyName }),
  login: (email: string, password: string) =>
    call('login', { email, password }),
  me: async (): Promise<AuthSession | null> => {
    if (!getToken()) return null;
    try {
      const r = await fetch('/api/overseas/auth/me', { headers: authHeader() });
      if (!r.ok) return null;
      return (await r.json()) as AuthSession;
    } catch {
      return null;
    }
  },
  logout: () => clearToken(),
};
