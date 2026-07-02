/**
 * Sync demo/test accounts from data/demo-account-registry.json into PocketBase.
 *
 * This is idempotent: existing users are patched with the registry password and
 * a tenant is created when missing. It intentionally logs emails only, not
 * passwords.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.production'), override: true });

const PB_URL = (process.env.PB_URL ?? 'http://127.0.0.1:8090').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD ?? '';
const REGISTRY_FILE = path.join(__dirname, '..', 'data', 'demo-account-registry.json');

type RegistryEntry = {
  email: string;
  password: string;
  userId?: string;
  tenantId?: string;
  activatedAt?: string | null;
  expiresAt?: string | null;
  status?: 'available' | 'trialing' | 'expired' | 'admin';
};

type RecordMap = Record<string, unknown>;

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function authToken(): Promise<string> {
  if (!EMAIL || !PASSWORD) throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD not set');
  const body = JSON.stringify({ identity: EMAIL, password: PASSWORD });
  for (const p of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const res = await fetch(`${PB_URL}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) continue;
    const json = await res.json() as { token?: string };
    if (json.token) return json.token;
  }
  throw new Error('PocketBase admin login failed');
}

async function pbRequest<T>(token: string, urlPath: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${PB_URL}${urlPath}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: token,
    },
  });
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${urlPath} failed ${res.status}: ${await res.text()}`);
  return await res.json() as T;
}

async function findOne(token: string, collection: string, filter: string): Promise<RecordMap | null> {
  const params = new URLSearchParams({ page: '1', perPage: '1', filter });
  const json = await pbRequest<{ items?: RecordMap[] }>(token, `/api/collections/${collection}/records?${params}`);
  return json.items?.[0] ?? null;
}

async function createTenant(token: string, entry: RegistryEntry): Promise<RecordMap> {
  const now = new Date().toISOString();
  const isAdmin = entry.status === 'admin';
  return await pbRequest<RecordMap>(token, '/api/collections/tenants/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: entry.email.split('@')[0],
      subscriptionStatus: isAdmin ? 'active' : 'trialing',
      subscriptionPlan: isAdmin ? 'admin' : 'trial',
      subscriptionExpiresAt: isAdmin ? '' : (entry.expiresAt || ''),
      createdAt: now,
    }),
  });
}

async function patchTenant(token: string, tenantId: string, entry: RegistryEntry): Promise<void> {
  const isAdmin = entry.status === 'admin';
  await pbRequest<RecordMap>(token, `/api/collections/tenants/records/${tenantId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscriptionStatus: isAdmin ? 'active' : 'trialing',
      subscriptionPlan: isAdmin ? 'admin' : 'trial',
      subscriptionExpiresAt: isAdmin ? '' : (entry.expiresAt || ''),
    }),
  });
}

async function syncAccount(token: string, entry: RegistryEntry): Promise<{ email: string; action: string; userId: string; tenantId: string }> {
  const email = entry.email.trim().toLowerCase();
  const existing = await findOne(token, 'users', `email = "${escapeFilterValue(email)}"`);
  let tenantId = String(existing?.tenantId || entry.tenantId || '');
  if (tenantId) {
    try {
      await patchTenant(token, tenantId, entry);
    } catch {
      const tenant = await createTenant(token, entry);
      tenantId = String(tenant.id);
    }
  } else {
    const tenant = await createTenant(token, entry);
    tenantId = String(tenant.id);
  }

  if (existing?.id) {
    await pbRequest<RecordMap>(token, `/api/collections/users/records/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: entry.password,
        passwordConfirm: entry.password,
        tenantId,
        emailVisibility: true,
      }),
    });
    return { email, action: 'updated', userId: String(existing.id), tenantId };
  }

  const created = await pbRequest<RecordMap>(token, '/api/collections/users/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: entry.password,
      passwordConfirm: entry.password,
      name: email.split('@')[0],
      tenantId,
      emailVisibility: true,
    }),
  });
  return { email, action: 'created', userId: String(created.id), tenantId };
}

async function main(): Promise<void> {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')) as Record<string, RegistryEntry>;
  const accounts = Object.values(registry).filter((entry) => entry.email && entry.password);
  const token = await authToken();

  const nextRegistry = { ...registry };
  const summary = { created: 0, updated: 0, failed: 0 };
  for (const entry of accounts) {
    try {
      const result = await syncAccount(token, entry);
      summary[result.action as 'created' | 'updated'] += 1;
      nextRegistry[result.email] = {
        ...nextRegistry[result.email],
        ...entry,
        email: result.email,
        userId: result.userId,
        tenantId: result.tenantId,
      };
      console.log(`  ${result.action}: ${result.email}`);
    } catch (error) {
      summary.failed += 1;
      console.warn(`  failed: ${entry.email} - ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(nextRegistry, null, 2), 'utf8');
  console.log(`✓ demo account sync complete. created=${summary.created}, updated=${summary.updated}, failed=${summary.failed}, target=${PB_URL}`);
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('✗ demo account sync failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
