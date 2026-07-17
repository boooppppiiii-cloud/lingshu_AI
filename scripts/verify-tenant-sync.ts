import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local'), override: true });

const pbUrl = String(process.env.PB_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
const appUrl = String(process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 8788}`).replace(/\/$/, '');
const suffix = Date.now().toString(36);
const password = `Smoke#${suffix}Aa1`;

async function json(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${url}: ${response.status} ${text}`);
  return body;
}

async function adminToken(): Promise<string> {
  for (const collection of ['_superusers', 'admins']) {
    try {
      const body = await json(`${pbUrl}/api/collections/${collection}/auth-with-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }),
      });
      if (body.token) return body.token;
    } catch { /* try legacy endpoint */ }
  }
  throw new Error('PocketBase admin authentication failed');
}

async function main() {
  const admin = await adminToken();
  const adminHeaders = { Authorization: admin, 'Content-Type': 'application/json' };
  const cleanup: Array<{ collection: string; id: string }> = [];
  const sessions: Array<{ token: string; tenantId: string; company: string }> = [];
  try {
    for (const label of ['A', 'B']) {
      const company = `Tenant Smoke ${label} ${suffix}`;
      const email = `tenant-smoke-${label.toLowerCase()}-${suffix}@example.com`;
      const tenant = await json(`${pbUrl}/api/collections/tenants/records`, {
        method: 'POST', headers: adminHeaders,
        body: JSON.stringify({ name: company, companyName: company, subscriptionStatus: 'active', subscriptionPlan: 'customer' }),
      });
      cleanup.unshift({ collection: 'tenants', id: tenant.id });
      const user = await json(`${pbUrl}/api/collections/users/records`, {
        method: 'POST', headers: adminHeaders,
        body: JSON.stringify({ email, password, passwordConfirm: password, name: company, tenantId: tenant.id, emailVisibility: true }),
      });
      cleanup.unshift({ collection: 'users', id: user.id });
      const login = await json(`${appUrl}/api/overseas/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
      });
      assert.equal(login.user.tenantId, tenant.id);
      sessions.push({ token: login.token, tenantId: tenant.id, company });
    }

    for (const session of sessions) {
      await json(`${appUrl}/api/overseas/enterprise/profile`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: { name: session.company }, products: {}, brand: {}, knowledge: '' }),
      });
      const order = await json(`${appUrl}/api/overseas/enterprise/orders`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyer: session.company, product: 'Isolation Test SKU', orderNo: `SMOKE-${session.tenantId}`, amount: 100, cost: 60 }),
      });
      assert.ok(order.id);
    }

    for (const session of sessions) {
      const profile = await json(`${appUrl}/api/overseas/enterprise/profile`, { headers: { Authorization: `Bearer ${session.token}` } });
      assert.equal(profile.company.name, session.company);
      const orders = await json(`${appUrl}/api/overseas/enterprise/orders`, { headers: { Authorization: `Bearer ${session.token}` } });
      assert.equal(orders.items.length, 1);
      assert.equal(orders.items[0].buyer, session.company);
      assert.equal(orders.items.some((item: { buyer?: string }) => item.buyer !== session.company), false);
    }
    assert.notEqual(sessions[0].tenantId, sessions[1].tenantId);
    console.log('tenant sync smoke test passed');
  } finally {
    for (const session of sessions) {
      for (const collection of ['tenant_orders', 'tenant_profiles']) {
        const list = await json(`${pbUrl}/api/collections/${collection}/records?perPage=200&filter=${encodeURIComponent(`tenant_id = "${session.tenantId}"`)}`, { headers: { Authorization: admin } }).catch(() => ({ items: [] }));
        for (const item of list.items || []) await fetch(`${pbUrl}/api/collections/${collection}/records/${item.id}`, { method: 'DELETE', headers: { Authorization: admin } });
      }
    }
    for (const item of cleanup) await fetch(`${pbUrl}/api/collections/${item.collection}/records/${item.id}`, { method: 'DELETE', headers: { Authorization: admin } });
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
