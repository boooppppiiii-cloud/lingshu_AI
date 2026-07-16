/**
 * One-time import of legacy local enterprise.json and orders.json into a single
 * PocketBase tenant. The target must be explicit to avoid cross-tenant imports.
 *
 * Usage:
 *   MIGRATE_TENANT_ID=<tenant-id> npm run migrate:tenant-business-data
 *   MIGRATE_ALL_DEMO_TENANTS=true npm run migrate:tenant-business-data
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.production'), override: true });

const PB_URL = (process.env.PB_URL ?? 'http://127.0.0.1:8090').replace(/\/$/, '');
const tenantId = String(process.env.MIGRATE_TENANT_ID ?? '').trim();
const migrateAllDemoTenants = String(process.env.MIGRATE_ALL_DEMO_TENANTS ?? '').toLowerCase() === 'true';
const email = String(process.env.PB_ADMIN_EMAIL ?? '').trim();
const password = String(process.env.PB_ADMIN_PASSWORD ?? '').trim();
const dataDir = path.join(__dirname, '..', 'data');

function readJson(file: string, fallback: unknown) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')); } catch { return fallback; }
}

async function adminToken() {
  if ((!tenantId && !migrateAllDemoTenants) || !email || !password) throw new Error('Set MIGRATE_TENANT_ID or MIGRATE_ALL_DEMO_TENANTS=true, plus PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD');
  for (const endpoint of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const response = await fetch(`${PB_URL}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: email, password }) });
    if (response.ok) {
      const body = await response.json() as { token?: string };
      if (body.token) return body.token;
    }
  }
  throw new Error('PocketBase admin authentication failed');
}

async function findOne(token: string, collection: string, filter: string) {
  const response = await fetch(`${PB_URL}/api/collections/${collection}/records?perPage=1&filter=${encodeURIComponent(filter)}`, { headers: { Authorization: token } });
  if (!response.ok) throw new Error(`cannot read ${collection}: ${response.status}`);
  const body = await response.json() as { items?: Array<{ id: string }> };
  return body.items?.[0] ?? null;
}

async function demoTenantIds(token: string): Promise<string[]> {
  const response = await fetch(`${PB_URL}/api/collections/tenants/records?perPage=500`, { headers: { Authorization: token } });
  if (!response.ok) throw new Error(`cannot read tenants: ${response.status}`);
  const body = await response.json() as { items?: Array<{ id?: string; subscriptionPlan?: string; subscriptionStatus?: string }> };
  return Array.from(new Set((body.items ?? [])
    .filter(item => ['admin', 'trial'].includes(String(item.subscriptionPlan || '').toLowerCase()) || String(item.subscriptionStatus || '').toLowerCase() === 'trialing')
    .map(item => String(item.id || '').trim())
    .filter(Boolean)));
}

async function upsert(token: string, collection: string, filter: string, body: Record<string, unknown>) {
  const existing = await findOne(token, collection, filter);
  const response = await fetch(`${PB_URL}/api/collections/${collection}/records${existing ? `/${existing.id}` : ''}`, {
    method: existing ? 'PATCH' : 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`cannot write ${collection}: ${response.status} ${await response.text()}`);
}

async function main() {
  const token = await adminToken();
  const profile = readJson('enterprise.json', null);
  const orders = readJson('orders.json', []);
  const targets = migrateAllDemoTenants ? await demoTenantIds(token) : [tenantId];
  if (!targets.length) throw new Error('no admin or trial tenants found');
  console.log(`Migrating to ${targets.length} tenant(s).`);
  for (const target of targets) {
    const escapedTenantId = target.replace(/"/g, '\\"');
    if (profile) await upsert(token, 'tenant_profiles', `tenant_id = "${escapedTenantId}"`, { tenant_id: target, profile, updated_by: 'legacy-json-migration' });
    if (!Array.isArray(orders)) continue;
    for (const order of orders) {
      const orderNo = String((order as { orderNo?: string }).orderNo ?? '').trim();
      if (!orderNo) continue;
      await upsert(token, 'tenant_orders', `tenant_id = "${escapedTenantId}" && order_no = "${orderNo.replace(/"/g, '\\"')}"`, { tenant_id: target, order_no: orderNo, order });
    }
  }
  console.log(`Migrated profile and ${Array.isArray(orders) ? orders.length : 0} orders to ${targets.length} tenant(s).`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
