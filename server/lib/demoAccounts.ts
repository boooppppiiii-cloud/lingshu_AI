import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Request } from 'express';
import { auth } from '../storage/index.js';
import { pbGet, pbPatch } from '../storage/pb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_FILE = path.join(__dirname, '../../data/demo-account-registry.json');
const REGISTRY_BACKUP_FILE = path.join(__dirname, '../../data/demo-account-registry.backup.json');
const USAGE_FILE = path.join(__dirname, '../../data/demo-usage.json');

export interface DemoAccountRegistryEntry {
  email: string;
  password: string;
  userId?: string;
  tenantId?: string;
  activatedAt?: string | null;
  expiresAt?: string | null;
  rotatedAt?: string | null;
  rotationPassword?: string | null;
  guidePending?: boolean;
  status?: 'available' | 'trialing' | 'expired' | 'admin';
}

type DemoAccountRegistry = Record<string, DemoAccountRegistryEntry>;
type DemoUsageDay = { aiChat?: number; generation?: number; render?: number; videoGeneration?: number; tokens?: number };
type DemoUsageStore = Record<string, Record<string, DemoUsageDay>>;

function norm(email: string): string {
  return String(email || '').trim().toLowerCase();
}

function localId(value: string): string {
  return norm(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'demo';
}

function localTokenEmail(authHeader?: string): string {
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token?.startsWith('local-demo.')) return '';
  try {
    const payload = JSON.parse(Buffer.from(token.slice('local-demo.'.length), 'base64url').toString('utf8')) as { email?: string };
    return norm(payload.email || '');
  } catch {
    return '';
  }
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function readStoredRegistry(): DemoAccountRegistry {
  const primary = readJson<DemoAccountRegistry | null>(REGISTRY_FILE, null);
  if (primary && Object.keys(primary).length > 0) return primary;
  return readJson<DemoAccountRegistry>(REGISTRY_BACKUP_FILE, primary ?? {});
}

function writeSecureJson(file: string, contents: string): void {
  const temporaryFile = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, contents, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryFile, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Some platforms ignore POSIX file modes.
  }
}

function writeRegistry(registry: DemoAccountRegistry): void {
  fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
  const next = JSON.stringify(registry, null, 2);
  try {
    if (
      fs.readFileSync(REGISTRY_FILE, 'utf8') === next
      && fs.readFileSync(REGISTRY_BACKUP_FILE, 'utf8') === next
    ) return;
  } catch {
    // File may not exist yet.
  }
  writeSecureJson(REGISTRY_BACKUP_FILE, next);
  writeSecureJson(REGISTRY_FILE, next);
}

export function allowedDemoAccounts(): string[] {
  const envAccounts = String(process.env.DEMO_ALLOWED_ACCOUNTS ?? '')
    .split(/[\s,;]+/)
    .map(norm)
    .filter(Boolean);
  const registry = readStoredRegistry();
  return Array.from(new Set([
    ...envAccounts,
    ...Object.keys(registry).map(norm).filter(Boolean),
  ]));
}

export function isAllowedDemoAccount(email: string): boolean {
  const allowed = allowedDemoAccounts();
  if (!allowed.length) return true; // no whitelist configured → open to all
  return allowed.includes(norm(email));
}

export function readDemoAccountRegistry(): DemoAccountRegistry {
  const registry = readStoredRegistry();
  for (const email of allowedDemoAccounts()) {
    registry[email] ??= { email, password: '', status: 'available' };
  }
  return registry;
}

export function upsertDemoAccountRegistry(email: string, patch: Partial<DemoAccountRegistryEntry>): DemoAccountRegistryEntry {
  const key = norm(email);
  const registry = readDemoAccountRegistry();
  const next = { status: 'available' as const, ...registry[key], ...patch, email: key, password: patch.password ?? registry[key]?.password ?? '' };
  registry[key] = next;
  writeRegistry(registry);
  return next;
}

export function isTrialAccount(subscription: { status?: string; plan?: string | null } | null | undefined): boolean {
  return subscription?.status === 'trialing' || String(subscription?.plan ?? '').toLowerCase() === 'trial';
}

export function trialExpiresAt(from = new Date()): string {
  return new Date(from.getTime() + 5 * 24 * 3600 * 1000).toISOString();
}

export async function activateTrialAccount(email: string, userId: string, tenantId: string, currentExpiresAt?: string | null): Promise<{ expiresAt: string; activatedNow: boolean }> {
  const registryEntry = readDemoAccountRegistry()[norm(email)];
  const activatedNow = !currentExpiresAt && !registryEntry?.activatedAt;
  const expiresAt = currentExpiresAt || registryEntry?.expiresAt || trialExpiresAt();
  upsertDemoAccountRegistry(email, {
    userId,
    tenantId,
    activatedAt: registryEntry?.activatedAt || new Date().toISOString(),
    expiresAt,
    status: 'trialing',
  });
  await pbPatch('tenants', tenantId, {
    subscriptionStatus: 'trialing',
    subscriptionPlan: 'trial',
    subscriptionExpiresAt: expiresAt,
  });
  return { expiresAt, activatedNow };
}

export function consumeDemoGuide(email: string): void {
  const key = norm(email);
  const registry = readDemoAccountRegistry();
  if (!registry[key]) return;
  if (registry[key].guidePending === false) return;
  registry[key] = { ...registry[key], guidePending: false };
  writeRegistry(registry);
}

function expiredPassword(email: string): string {
  const local = norm(email).split('@')[0].replace(/[^a-z0-9]/g, '').slice(-6) || 'demo';
  return `Off@${local}#${new Date().getFullYear()}`;
}

export async function rotateExpiredTrialPassword(user: { id?: string; email?: string } | null, reason = 'trial_expired'): Promise<void> {
  if (!user?.id || !user.email) return;
  const entry = readDemoAccountRegistry()[norm(user.email)];
  if (entry?.rotatedAt) return;

  const password = expiredPassword(user.email);
  const ok = await pbPatch('users', user.id, { password, passwordConfirm: password });
  if (!ok) return;
  upsertDemoAccountRegistry(user.email, {
    userId: user.id,
    rotatedAt: new Date().toISOString(),
    rotationPassword: password,
    status: 'expired',
  });
  void reason;
}

export function isAdminEmail(email?: string): boolean {
  const normalized = norm(email ?? '');
  if (!normalized) return false;
  const localAdminEmail = norm(process.env.LOCAL_ADMIN_EMAIL ?? '');
  if (localAdminEmail && normalized === localAdminEmail) return true;
  const workbenchAdminEmail = norm(process.env.WORKBENCH_ADMIN_EMAIL ?? '');
  if (workbenchAdminEmail && normalized === workbenchAdminEmail) return true;
  const registry = readDemoAccountRegistry();
  if (registry[normalized]?.status === 'admin') return true;
  const allowed = String(process.env.ADMIN_DASHBOARD_EMAILS ?? '')
    .split(/[\s,;]+/)
    .map(norm)
    .filter(Boolean);
  return allowed.includes(normalized);
}

export async function requireAdminUser(req: Request): Promise<{ userId: string; tenantId: string; email: string } | null> {
  const id = await auth.verifyToken(req.headers.authorization);
  if (!id || id.supportAccess) return null;
  let user: Record<string, unknown> | null = null;
  try {
    user = await pbGet('users', id.userId);
  } catch {
    user = null;
  }
  const registry = readDemoAccountRegistry();
  const registryEntry = Object.values(registry).find(entry =>
    entry.userId === id.userId ||
    entry.tenantId === id.tenantId ||
    `local_user_${localId(entry.email)}` === id.userId ||
    `local_tenant_${localId(entry.email)}` === id.tenantId
  );
  const email = norm(String(user?.email ?? registryEntry?.email ?? localTokenEmail(req.headers.authorization)));
  if (!isAdminEmail(email)) return null;
  return { ...id, email };
}

export function demoUsageForUser(userId?: string): { todayTokens: number; totalTokens: number; aiChat: number; generation: number; render: number; videoGeneration: number } {
  if (!userId) return { todayTokens: 0, totalTokens: 0, aiChat: 0, generation: 0, render: 0, videoGeneration: 0 };
  const store = readJson<DemoUsageStore>(USAGE_FILE, {});
  const days = store[`user:${userId}`] ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const todayUsage = days[today] ?? {};
  const totalTokens = Object.values(days).reduce((sum, day) => sum + Number(day.tokens ?? 0), 0);
  return {
    todayTokens: Number(todayUsage.tokens ?? 0),
    totalTokens,
    aiChat: Number(todayUsage.aiChat ?? 0),
    generation: Number(todayUsage.generation ?? 0),
    render: Number(todayUsage.render ?? 0),
    videoGeneration: Number(todayUsage.videoGeneration ?? 0),
  };
}
