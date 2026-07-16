import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getPbUrl, getPbAdminToken, pbCreate, pbGet, pbListStrict, pbPatch } from '../storage/pb.js';
import { auth } from '../storage/index.js';
import { getTenantSubscription } from '../middleware/subscription.js';
import { buildDemoStatus, isExpired } from '../lib/demo.js';
import {
  activateTrialAccount,
  consumeDemoGuide,
  isAdminEmail,
  isTrialAccount,
  readDemoAccountRegistry,
  rotateExpiredTrialPassword,
  trialExpiresAt,
  upsertDemoAccountRegistry,
} from '../lib/demoAccounts.js';
import {
  activateLocalTenantInvite,
  findLocalTenantByInvite,
  findLocalTenantByRegistrationInvite,
  getLocalTenant,
  type LocalTenantRecord,
} from '../lib/localTenants.js';
import { encryptRegistrationPassword } from '../lib/registrationCredentials.js';

/* ──────────────────────────────────────────────────────────────────────────
   账号 / 登录（基于 PocketBase）
   - 注册：建租户（按公司订阅，默认 14 天试用）→ 建用户 → 登录拿 token
   - 登录：PB auth-with-password → 返回 token + 用户 + 租户订阅
   - me：用 token 取当前身份 + 订阅状态
   token 由前端存起来，后续请求带 Authorization: Bearer <token>。
─────────────────────────────────────────────────────────────────────────── */

export const authRouter = Router();

interface PbUser { id: string; email?: string; name?: string; tenantId?: string }

const LOCAL_AUTH_PREFIX = 'local-demo.';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_ACCOUNTS_FILE = path.join(__dirname, '../../data/local-auth-accounts.json');

interface LocalIdentity {
  userId: string;
  tenantId: string;
  email?: string;
  name?: string;
  accountType?: 'customer' | 'trial' | 'admin';
}

interface LocalAccount extends LocalIdentity {
  email: string;
  name: string;
  accountType: 'customer';
  salt: string;
  passwordHash: string;
  createdAt: string;
}

interface LocalLoginResult {
  token: string;
  record: PbUser;
  accountType: 'customer' | 'trial' | 'admin';
  expiresAt?: string | null;
}

function isLocalDevFallbackEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.DISABLE_LOCAL_AUTH_FALLBACK !== 'true';
}

function localId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'demo';
}

function localUser(email: string, companyName = ''): PbUser {
  const normalizedEmail = String(email).trim().toLowerCase();
  const id = `local_user_${localId(normalizedEmail)}`;
  return {
    id,
    email: normalizedEmail,
    name: companyName || normalizedEmail.split('@')[0] || '本地账号',
    tenantId: `local_tenant_${localId(normalizedEmail)}`,
  };
}

function readLocalAccounts(): LocalAccount[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCAL_ACCOUNTS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalAccounts(accounts: LocalAccount[]): void {
  fs.mkdirSync(path.dirname(LOCAL_ACCOUNTS_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
}

function passwordHash(password: string, salt: string): Buffer {
  return scryptSync(password, salt, 64);
}

function localPasswordMatches(account: LocalAccount, password: string): boolean {
  try {
    const stored = Buffer.from(account.passwordHash, 'hex');
    const candidate = passwordHash(password, account.salt);
    return stored.length === candidate.length && timingSafeEqual(stored, candidate);
  } catch {
    return false;
  }
}

function createLocalToken(user: PbUser, accountType: LocalLoginResult['accountType'] = 'customer'): string {
  const payload = Buffer.from(JSON.stringify({
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    accountType,
  }), 'utf8').toString('base64url');
  return `${LOCAL_AUTH_PREFIX}${payload}`;
}

function parseLocalToken(authHeader: string | undefined): LocalIdentity | null {
  if (!isLocalDevFallbackEnabled()) return null;
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token?.startsWith(LOCAL_AUTH_PREFIX)) return null;
  try {
    const data = JSON.parse(Buffer.from(token.slice(LOCAL_AUTH_PREFIX.length), 'base64url').toString('utf8')) as Partial<LocalIdentity>;
    return data.userId && data.tenantId ? {
      userId: data.userId,
      tenantId: data.tenantId,
      email: data.email,
      name: data.name,
      accountType: data.accountType,
    } : null;
  } catch {
    return null;
  }
}

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

function localLogin(email: string, password: string): LocalLoginResult | null {
  if (!isLocalDevFallbackEnabled()) return null;
  const normalizedEmail = String(email).trim().toLowerCase();
  const account = readLocalAccounts().find(item => item.email === normalizedEmail);
  if (account) {
    if (!localPasswordMatches(account, password)) return null;
    const record: PbUser = {
      id: account.userId,
      email: account.email,
      name: account.name,
      tenantId: account.tenantId,
    };
    return { token: createLocalToken(record, 'customer'), record, accountType: 'customer' };
  }

  const configuredAdminEmail = String(process.env.LOCAL_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const configuredAdminPassword = process.env.LOCAL_ADMIN_PASSWORD;
  if (
    configuredAdminEmail &&
    configuredAdminPassword &&
    normalizedEmail === configuredAdminEmail &&
    password === configuredAdminPassword
  ) {
    const record: PbUser = {
      id: `local_user_admin_${localId(normalizedEmail)}`,
      email: normalizedEmail,
      name: normalizedEmail.split('@')[0],
      tenantId: `local_tenant_admin_${localId(normalizedEmail)}`,
    };
    return { token: createLocalToken(record, 'admin'), record, accountType: 'admin', expiresAt: null };
  }

  const registryEntry = readDemoAccountRegistry()[normalizedEmail];
  if (registryEntry?.password && registryEntry.password === password && registryEntry.status !== 'expired') {
    const accountType = registryEntry.status === 'admin' ? 'admin' : 'trial';
    const tenantId = `local_tenant_${accountType}_${localId(normalizedEmail)}`;
    const record: PbUser = {
      id: `local_user_${accountType}_${localId(normalizedEmail)}`,
      email: normalizedEmail,
      name: normalizedEmail.split('@')[0],
      tenantId,
    };
    if (accountType === 'admin') {
      return { token: createLocalToken(record, accountType), record, accountType, expiresAt: null };
    }
    const expiresAt = registryEntry.expiresAt || trialExpiresAt();
    upsertDemoAccountRegistry(normalizedEmail, {
      userId: record.id,
      tenantId,
      activatedAt: registryEntry.activatedAt || new Date().toISOString(),
      expiresAt,
      status: 'trialing',
    });
    return { token: createLocalToken(record, accountType), record, accountType, expiresAt };
  }

  const allowedEmails = String(process.env.LOCAL_AUTH_EMAILS ?? '')
    .split(/[\s,;]+/)
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  const configuredPassword = process.env.LOCAL_AUTH_PASSWORD;
  if (!configuredPassword || !allowedEmails.includes(normalizedEmail) || password !== configuredPassword) return null;
  const accountType = isAdminEmail(normalizedEmail) ? 'admin' : 'trial';
  const record: PbUser = {
    id: `local_user_${accountType}_${localId(normalizedEmail)}`,
    email: normalizedEmail,
    name: normalizedEmail.split('@')[0],
    tenantId: `local_tenant_${accountType}_${localId(normalizedEmail)}`,
  };
  if (accountType === 'admin') {
    return { token: createLocalToken(record, accountType), record, accountType, expiresAt: null };
  }
  const expiresAt = trialExpiresAt();
  upsertDemoAccountRegistry(normalizedEmail, {
    password: configuredPassword,
    userId: record.id,
    tenantId: record.tenantId,
    activatedAt: new Date().toISOString(),
    expiresAt,
    status: 'trialing',
  });
  return { token: createLocalToken(record, accountType), record, accountType, expiresAt };
}

function localRegister(email: string, password: string, tenant: LocalTenantRecord):
  | { ok: true; token: string; record: PbUser }
  | { ok: false; error: string }
  | null {
  if (!isLocalDevFallbackEnabled()) return null;
  const normalizedEmail = String(email).trim().toLowerCase();
  const accounts = readLocalAccounts();
  if (accounts.some(item => item.email === normalizedEmail)) {
    return { ok: false, error: '该邮箱已注册，请直接登录' };
  }
  const record: PbUser = {
    id: `local_user_customer_${localId(normalizedEmail)}`,
    email: normalizedEmail,
    name: tenant.companyName || tenant.name || normalizedEmail.split('@')[0],
    tenantId: tenant.id,
  };
  const salt = randomBytes(16).toString('hex');
  accounts.push({
    userId: String(record.id),
    tenantId: String(record.tenantId),
    email: normalizedEmail,
    name: String(record.name || normalizedEmail.split('@')[0]),
    accountType: 'customer',
    salt,
    passwordHash: passwordHash(password, salt).toString('hex'),
    createdAt: new Date().toISOString(),
  });
  writeLocalAccounts(accounts);
  return { ok: true, token: createLocalToken(record, 'customer'), record };
}

function publicUser(r: PbUser) {
  return { id: r.id, email: r.email ?? '', name: r.name ?? '', tenantId: r.tenantId ?? '' };
}

function pbFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function tenantByInviteCode(code: string): Promise<Record<string, unknown> | null> {
  const invite = String(code || '').trim();
  if (!invite) return null;
  try {
    const result = await pbListStrict<Record<string, unknown>>('tenants', {
      perPage: 1,
      filter: `inviteCode = ${pbFilterValue(invite)}`,
    });
    return result.items[0] ?? null;
  } catch {
    return null;
  }
}

async function tenantByUsedInviteCode(code: string): Promise<Record<string, unknown> | null> {
  const invite = String(code || '').trim();
  if (!invite) return null;
  try {
    const result = await pbListStrict<Record<string, unknown>>('tenants', {
      perPage: 1,
      filter: `registrationInviteCode = ${pbFilterValue(invite)}`,
    });
    return result.items[0] ?? null;
  } catch {
    return null;
  }
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

// GET /auth/invite/:code
authRouter.get('/invite/:code', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const code = String(req.params.code || '').trim();
  if (!code) {
    res.status(400).json({ error: 'invite_code_required' });
    return;
  }
  const invitedTenant = await tenantByInviteCode(code);
  const localInvitedTenant = invitedTenant ? null : findLocalTenantByInvite(code);
  const tenant = invitedTenant || localInvitedTenant;
  if (tenant) {
    res.json({
      valid: true,
      companyName: String(tenant.companyName || tenant.name || ''),
    });
    return;
  }
  const usedTenant = await tenantByUsedInviteCode(code) || findLocalTenantByRegistrationInvite(code);
  if (!usedTenant) {
    res.status(404).json({ valid: false, error: '邀请码无效或已使用' });
    return;
  }
  res.status(410).json({
    valid: false,
    companyName: String(usedTenant.companyName || usedTenant.name || ''),
    error: '邀请码已使用，请联系管理员重新生成',
  });
});

// POST /auth/register  { email, password, inviteCode }
authRouter.post('/register', async (req, res) => {
  const { email, password, inviteCode } = req.body ?? {};
  if (!email || !password) { res.status(400).json({ error: '邮箱和密码必填' }); return; }
  if (String(password).length < 8) { res.status(400).json({ error: '密码至少 8 位' }); return; }
  const code = String(inviteCode || '').trim();
  if (!code) { res.status(400).json({ error: '请输入管理员提供的邀请码' }); return; }

  const invitedTenant = await tenantByInviteCode(code);
  const localInvitedTenant = invitedTenant ? null : findLocalTenantByInvite(code);
  if (!invitedTenant && !localInvitedTenant) {
    res.status(403).json({ error: '邀请码无效或已使用，请联系管理员重新生成' });
    return;
  }

  if (localInvitedTenant) {
    const fallback = localRegister(String(email), String(password), localInvitedTenant);
    if (fallback?.ok) {
      const tenant = activateLocalTenantInvite({
        inviteCode: code,
        email: String(email),
        password: String(password),
      });
      if (!tenant) {
        res.status(409).json({ error: '邀请码已被使用，请联系管理员重新生成' });
        return;
      }
      res.json({
        token: fallback.token,
        user: publicUser(fallback.record),
        tenant: publicTenant(tenant as unknown as Record<string, unknown>),
      });
      return;
    }
    if (fallback && !fallback.ok) {
      res.status(409).json({ error: fallback.error });
      return;
    }
    res.status(500).json({ error: '创建账号失败' }); return;
  }

  const invitedCompanyName = String(invitedTenant!.companyName || invitedTenant!.name || '').trim();
  let user: Record<string, unknown> | null = null;
  try {
    user = await pbCreate('users', {
      email, password, passwordConfirm: password,
      name: invitedCompanyName, tenantId: invitedTenant!.id, emailVisibility: true,
    });
  } catch {
    user = null;
  }
  if (!user) {
    res.status(400).json({ error: '创建用户失败（邮箱可能已被注册）' }); return;
  }

  const login = await pbLogin(email, password);
  if (!login) { res.status(500).json({ error: '注册后自动登录失败' }); return; }
  await pbPatch('tenants', String(invitedTenant!.id), {
    name: invitedCompanyName || String(email).split('@')[0],
    companyName: invitedCompanyName,
    inviteCode: '',
    registrationInviteCode: code,
    registeredEmail: String(email).trim().toLowerCase(),
    registeredPasswordCipher: encryptRegistrationPassword(String(password)),
    registeredAt: new Date().toISOString(),
    subscriptionStatus: 'active',
    subscriptionPlan: 'customer',
    subscriptionExpiresAt: null,
  });
  const tenant = await pbGet('tenants', String(invitedTenant!.id)) || {
    ...invitedTenant,
    inviteCode: '',
    subscriptionStatus: 'active',
    subscriptionPlan: 'customer',
    subscriptionExpiresAt: null,
  };
  res.json({
    token: login.token,
    user: publicUser(login.record),
    tenant: publicTenant(tenant),
  });
});

// POST /auth/login  { email, password }
authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) { res.status(400).json({ error: '邮箱和密码必填' }); return; }
  const login = await pbLogin(email, password);
  if (!login) {
    const fallback = localLogin(email, password);
    if (!fallback) { res.status(401).json({ error: '邮箱或密码错误' }); return; }
    const subscription = await getTenantSubscription(String(fallback.record.tenantId || ''));
    const demo = fallback.accountType === 'trial'
      ? await buildDemoStatus(req, fallback.record.tenantId, fallback.expiresAt, fallback.record.id)
      : undefined;
    res.json({
      token: fallback.token,
      user: publicUser(fallback.record),
      tenant: publicTenant({
        id: fallback.record.tenantId,
        name: fallback.record.name,
        subscriptionStatus: subscription.status,
        subscriptionPlan: subscription.plan,
        subscriptionExpiresAt: subscription.expiresAt,
      }),
      subscription,
      demo,
    });
    return;
  }
  let tenant = login.record.tenantId ? await pbGet('tenants', login.record.tenantId) : null;
  let subscription = login.record.tenantId ? await getTenantSubscription(login.record.tenantId) : null;
  if (isTrialAccount(subscription) && login.record.tenantId && !subscription?.expiresAt) {
    const activated = await activateTrialAccount(login.record.email ?? email, login.record.id, login.record.tenantId);
    tenant = await pbGet('tenants', login.record.tenantId);
    subscription = { status: 'trialing', plan: 'trial', expiresAt: activated.expiresAt };
    const demoStatus = await buildDemoStatus(req, login.record.tenantId, activated.expiresAt, login.record.id);
    res.json({
      token: login.token,
      user: publicUser(login.record),
      tenant: publicTenant(tenant),
      demo: {
        ...demoStatus,
        guideTrigger: activated.activatedNow,
        guideScope: `${login.record.id}:${activated.expiresAt}`,
      },
    });
    return;
  }
  if (subscription?.expiresAt && isExpired(subscription.expiresAt)) {
    await rotateExpiredTrialPassword(login.record, 'login_trial_expired');
    res.status(402).json({ error: '试用账号已到期，请联系服务顾问开通或延长试用。' });
    return;
  }
  const demoStatus = await buildDemoStatus(req, login.record.tenantId, subscription?.expiresAt, login.record.id);
  res.json({
    token: login.token,
    user: publicUser(login.record),
    tenant: publicTenant(tenant),
    demo: {
      ...demoStatus,
      guideTrigger: false,
      guideScope: subscription?.expiresAt ? `${login.record.id}:${subscription.expiresAt}` : undefined,
    },
  });
});

// GET /auth/me  (Authorization: Bearer <token>)
authRouter.get('/me', async (req, res) => {
  const local = parseLocalToken(req.headers.authorization);
  if (local) {
    const name = local.name || local.email?.split('@')[0] || '本地账号';
    const subscription = await getTenantSubscription(local.tenantId);
    if (subscription.expiresAt && isExpired(subscription.expiresAt)) {
      res.status(402).json({ error: '试用账号已到期，请联系管理员获取其他备用账号。' });
      return;
    }
    const demo = subscription.status === 'trialing' || subscription.plan === 'trial'
      ? await buildDemoStatus(req, local.tenantId, subscription.expiresAt, local.userId)
      : undefined;
    const storedTenant = getLocalTenant(local.tenantId);
    res.json({
      user: { id: local.userId, email: local.email || '', name, tenantId: local.tenantId },
      tenant: publicTenant({
        id: local.tenantId,
        name: storedTenant?.name || name,
        subscriptionStatus: subscription.status,
        subscriptionPlan: subscription.plan,
        subscriptionExpiresAt: subscription.expiresAt,
      }),
      subscription,
      demo,
    });
    return;
  }
  const id = await auth.verifyToken(req.headers.authorization);
  if (!id) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const [user, tenant] = await Promise.all([pbGet('users', id.userId), pbGet('tenants', id.tenantId)]);
  const subscription = await getTenantSubscription(id.tenantId);
  if (subscription?.expiresAt && isExpired(subscription.expiresAt)) {
    await rotateExpiredTrialPassword(user as unknown as PbUser | null, 'session_trial_expired');
    res.status(402).json({ error: '试用账号已到期，请重新登录或联系服务顾问开通。' });
    return;
  }
  const demo = await buildDemoStatus(req, id.tenantId, subscription.expiresAt, id.userId);
  res.json({
    user: user ? publicUser(user as unknown as PbUser) : { id: id.userId, email: '', name: '', tenantId: id.tenantId },
    tenant: publicTenant(tenant),
    subscription,
    demo: {
      ...demo,
      guideTrigger: false,
      guideScope: subscription.expiresAt ? `${id.userId}:${subscription.expiresAt}` : undefined,
    },
  });
});

authRouter.post('/guide-seen', async (req, res) => {
  const id = await auth.verifyToken(req.headers.authorization);
  if (!id) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const user = await pbGet('users', id.userId);
  const email = String(user?.email ?? '').trim().toLowerCase();
  if (email) consumeDemoGuide(email);
  res.json({ ok: true });
});
