import { Router } from 'express';
import { getPbUrl, getPbAdminToken, pbCreate, pbGet } from '../storage/pb.js';
import { auth } from '../storage/index.js';
import { getTenantSubscription } from '../middleware/subscription.js';
import { buildDemoStatus, demoTrialExpiresAt } from '../lib/demo.js';

/* ──────────────────────────────────────────────────────────────────────────
   账号 / 登录（基于 PocketBase）
   - 注册：建租户（按公司订阅，默认 14 天试用）→ 建用户 → 登录拿 token
   - 登录：PB auth-with-password → 返回 token + 用户 + 租户订阅
   - me：用 token 取当前身份 + 订阅状态
   token 由前端存起来，后续请求带 Authorization: Bearer <token>。
─────────────────────────────────────────────────────────────────────────── */

export const authRouter = Router();

interface PbUser { id: string; email?: string; name?: string; tenantId?: string }

async function resolveLoginIdentity(identity: string): Promise<string> {
  const raw = String(identity).trim();
  if (raw.includes('@')) return raw;

  const adminToken = await getPbAdminToken();
  if (!adminToken) return raw;

  const normalized = raw.replace(/\s+/g, ' ');
  const filter = `name = "${normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  try {
    const res = await fetch(`${getPbUrl()}/api/collections/users/records?perPage=1&filter=${encodeURIComponent(filter)}`, {
      headers: { Authorization: adminToken },
    });
    if (!res.ok) return raw;
    const json = (await res.json()) as { items?: PbUser[] };
    return json.items?.[0]?.email || raw;
  } catch {
    return raw;
  }
}

async function pbLogin(identity: string, password: string): Promise<{ token: string; record: PbUser } | null> {
  try {
    const loginIdentity = await resolveLoginIdentity(identity);
    const res = await fetch(`${getPbUrl()}/api/collections/users/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: loginIdentity, password }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { token: string; record: PbUser };
  } catch {
    return null;
  }
}

function publicUser(r: PbUser) {
  return { id: r.id, email: r.email ?? '', name: r.name ?? '', tenantId: r.tenantId ?? '' };
}
function publicTenant(t: Record<string, unknown> | null) {
  if (!t) return null;
  return {
    id: t.id,
    name: t.name ?? '',
    subscriptionStatus: t.subscriptionStatus ?? 'none',
    subscriptionPlan: t.subscriptionPlan ?? null,
    subscriptionExpiresAt: t.subscriptionExpiresAt ?? null,
  };
}

// POST /auth/register  { email, password, companyName? }
authRouter.post('/register', async (req, res) => {
  const { email, password, companyName, inviteCode } = req.body ?? {};
  if (!email || !password) { res.status(400).json({ error: '邮箱和密码必填' }); return; }
  if (String(password).length < 8) { res.status(400).json({ error: '密码至少 8 位' }); return; }
  const expectedInvite = process.env.DEMO_INVITE_CODE?.trim();
  if (expectedInvite && inviteCode !== expectedInvite) {
    res.status(403).json({ error: '邀请码无效，请联系团队获取 Demo 访问码' });
    return;
  }

  const now = new Date();
  const expiresAt = demoTrialExpiresAt(now);
  const tenant = await pbCreate('tenants', {
    name: companyName || String(email).split('@')[0],
    subscriptionStatus: 'trialing',
    subscriptionPlan: 'trial',
    subscriptionExpiresAt: expiresAt,
    createdAt: now.toISOString(),
  });
  if (!tenant) { res.status(500).json({ error: '创建租户失败' }); return; }

  const user = await pbCreate('users', {
    email, password, passwordConfirm: password,
    name: companyName || '', tenantId: tenant.id, emailVisibility: true,
  });
  if (!user) { res.status(400).json({ error: '创建用户失败（邮箱可能已被注册）' }); return; }

  const login = await pbLogin(email, password);
  if (!login) { res.status(500).json({ error: '注册后自动登录失败' }); return; }
  res.json({ token: login.token, user: publicUser(login.record), tenant: publicTenant(tenant), demo: await buildDemoStatus(req, String(tenant.id), String(tenant.subscriptionExpiresAt ?? expiresAt)) });
});

// POST /auth/login  { email, password }
authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) { res.status(400).json({ error: '邮箱和密码必填' }); return; }
  const login = await pbLogin(email, password);
  if (!login) { res.status(401).json({ error: '邮箱或密码错误' }); return; }
  const tenant = login.record.tenantId ? await pbGet('tenants', login.record.tenantId) : null;
  const subscription = login.record.tenantId ? await getTenantSubscription(login.record.tenantId) : null;
  res.json({ token: login.token, user: publicUser(login.record), tenant: publicTenant(tenant), demo: await buildDemoStatus(req, login.record.tenantId, subscription?.expiresAt) });
});

// GET /auth/me  (Authorization: Bearer <token>)
authRouter.get('/me', async (req, res) => {
  const id = await auth.verifyToken(req.headers.authorization);
  if (!id) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const [user, tenant] = await Promise.all([pbGet('users', id.userId), pbGet('tenants', id.tenantId)]);
  const subscription = await getTenantSubscription(id.tenantId);
  const demo = await buildDemoStatus(req, id.tenantId, subscription.expiresAt);
  res.json({
    user: user ? publicUser(user as unknown as PbUser) : { id: id.userId, email: '', name: '', tenantId: id.tenantId },
    tenant: publicTenant(tenant),
    subscription,
    demo,
  });
});
