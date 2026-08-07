import fs from 'node:fs';
import path from 'node:path';

const tenantId = String(process.env.QA_TENANT_ID || '').trim();
const email = String(process.env.QA_MOCK_EMAIL || 'lingshu-qa-mock@local.test').trim().toLowerCase();
const password = String(process.env.QA_MOCK_PASSWORD || '');
const pbUrl = String(process.env.PB_URL || 'http://pocketbase:8090').replace(/\/$/, '');
const appUrl = String(process.env.QA_MOCK_APP_URL || 'http://127.0.0.1:8788/api/overseas').replace(/\/$/, '');
const dataDir = path.resolve(process.env.QA_DATA_DIR || '/app/data');
const execute = process.argv.includes('--execute');
const verifyOnly = process.argv.includes('--verify-only');
const marker = 'qa_mock_isolated';

if (!/^[a-z0-9]{15}$/.test(tenantId)) throw new Error('QA_TENANT_ID must be an exact 15-character PocketBase id');
if (email !== 'lingshu-qa-mock@local.test') throw new Error('Refusing to clean a non-QA email');

const escaped = value => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function jsonRequest(url, init = {}) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${url} failed ${response.status}: ${await response.text()}`);
  return response.status === 204 ? {} : await response.json();
}

async function adminToken() {
  const identity = String(process.env.PB_ADMIN_EMAIL || '');
  const secret = String(process.env.PB_ADMIN_PASSWORD || '');
  if (!identity || !secret) throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD are required');
  for (const route of ['/api/collections/_superusers/auth-with-password', '/api/admins/auth-with-password']) {
    const response = await fetch(`${pbUrl}${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity, password: secret }),
    });
    if (response.ok) return String((await response.json()).token || '');
  }
  throw new Error('PocketBase admin login failed');
}

async function list(token, collection, filter = '') {
  const params = new URLSearchParams({ page: '1', perPage: '500' });
  if (filter) params.set('filter', filter);
  const result = await jsonRequest(`${pbUrl}/api/collections/${collection}/records?${params}`, { headers: { Authorization: token } });
  return Array.isArray(result.items) ? result.items : [];
}

async function count(token, collection, filter = '') {
  const params = new URLSearchParams({ page: '1', perPage: '1' });
  if (filter) params.set('filter', filter);
  const result = await jsonRequest(`${pbUrl}/api/collections/${collection}/records?${params}`, { headers: { Authorization: token } });
  return Number(result.totalItems || 0);
}

async function removeRecord(token, collection, id) {
  const response = await fetch(`${pbUrl}/api/collections/${collection}/records/${id}`, { method: 'DELETE', headers: { Authorization: token } });
  if (!response.ok && response.status !== 404) throw new Error(`DELETE ${collection}/${id} failed ${response.status}: ${await response.text()}`);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function atomicWrite(file, value) {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

function safeTenantPath(...parts) {
  const target = path.resolve(dataDir, ...parts);
  if (!target.startsWith(`${dataDir}${path.sep}`) || !target.includes(tenantId)) throw new Error(`Unsafe cleanup path: ${target}`);
  return target;
}

async function main() {
  const token = await adminToken();
  if (verifyOnly) {
    const collectionsResult = await jsonRequest(`${pbUrl}/api/collections?perPage=500`, { headers: { Authorization: token } });
    const remaining = [];
    const otherCounts = [];
    for (const collection of Array.isArray(collectionsResult.items) ? collectionsResult.items : []) {
      if (collection.type === 'view') continue;
      const fields = Array.isArray(collection.fields) ? collection.fields : Array.isArray(collection.schema) ? collection.schema : [];
      const field = fields.find(item => item.name === 'tenant_id' || item.name === 'tenantId')?.name;
      if (!field) continue;
      const rows = await list(token, collection.name, `${field} = "${escaped(tenantId)}"`);
      if (rows.length) remaining.push({ collection: collection.name, count: rows.length });
      otherCounts.push({ collection: collection.name, total: await count(token, collection.name) });
    }
    const tenantRows = await list(token, 'tenants', `id = "${escaped(tenantId)}"`);
    const localRemaining = {};
    for (const name of ['materials.json', 'tasks.json', 'whatsapp-customers.json', 'whatsapp-interactions.json']) {
      const value = readJson(path.join(dataDir, name), []);
      localRemaining[name] = Array.isArray(value) ? value.filter(item => String(item?.tenantId || item?.tenant_id || '') === tenantId).length : 0;
    }
    const dirs = [safeTenantPath('covers', 'tenants', tenantId), safeTenantPath('media', 'tenants', tenantId), safeTenantPath('publishing-uploads', tenantId)].filter(item => fs.existsSync(item));
    const ok = !tenantRows.length && !remaining.length && !Object.values(localRemaining).some(Boolean) && !dirs.length;
    console.log(JSON.stringify({ ok, tenantId, tenantRows: tenantRows.length, remaining, otherCounts, localRemaining, dirs }, null, 2));
    if (!ok) process.exitCode = 1;
    return;
  }
  const tenants = await list(token, 'tenants', `id = "${escaped(tenantId)}"`);
  const tenant = tenants[0];
  if (!tenant || tenant.notes !== marker || tenant.subscriptionPlan !== 'qa_mock' || String(tenant.registeredEmail || '').toLowerCase() !== email) {
    throw new Error('QA tenant marker validation failed; no data changed');
  }
  const users = await list(token, 'users', `tenantId = "${escaped(tenantId)}"`);
  if (!users.length || users.some(user => String(user.email || '').toLowerCase() !== email)) {
    throw new Error('QA user validation failed; no data changed');
  }

  // Delete tenant-owned material through the app first so COS/local blobs are also removed.
  let materialIds = [];
  if (password) {
    const login = await jsonRequest(`${appUrl}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    const appToken = String(login.token || '');
    const materials = await jsonRequest(`${appUrl}/studio/materials?scope=own`, { headers: { Authorization: `Bearer ${appToken}` } });
    materialIds = (Array.isArray(materials) ? materials : []).map(item => String(item.id || '')).filter(Boolean);
    if (execute) for (const id of materialIds) {
      const response = await fetch(`${appUrl}/studio/materials/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${appToken}` } });
      if (!response.ok && response.status !== 404) throw new Error(`material delete ${id} failed ${response.status}: ${await response.text()}`);
    }
  }

  const collectionsResult = await jsonRequest(`${pbUrl}/api/collections?perPage=500`, { headers: { Authorization: token } });
  const collections = Array.isArray(collectionsResult.items) ? collectionsResult.items : [];
  const plan = [];
  for (const collection of collections) {
    if (collection.name === 'tenants' || collection.name === 'users' || collection.type === 'view') continue;
    const fields = Array.isArray(collection.fields) ? collection.fields : Array.isArray(collection.schema) ? collection.schema : [];
    const field = fields.find(item => item.name === 'tenant_id' || item.name === 'tenantId')?.name;
    if (!field) continue;
    const qaRows = await list(token, collection.name, `${field} = "${escaped(tenantId)}"`);
    const total = await count(token, collection.name);
    plan.push({ collection: collection.name, field, qa: qaRows.length, otherBefore: total - qaRows.length, ids: qaRows.map(row => String(row.id)) });
  }

  const jsonFiles = ['materials.json', 'tasks.json', 'whatsapp-customers.json', 'whatsapp-interactions.json'];
  const localPlan = [];
  for (const name of jsonFiles) {
    const file = path.join(dataDir, name);
    const value = readJson(file, []);
    if (!Array.isArray(value)) continue;
    const kept = value.filter(item => String(item?.tenantId || item?.tenant_id || '') !== tenantId);
    localPlan.push({ name, before: value.length, remove: value.length - kept.length, kept, file });
  }
  const usageFile = path.join(dataDir, 'demo-usage.json');
  const usage = readJson(usageFile, {});
  const usageKeys = [`tenant:${tenantId}`, ...users.map(user => `user:${user.id}`)].filter(key => Object.prototype.hasOwnProperty.call(usage, key));
  const dirs = [
    safeTenantPath('covers', 'tenants', tenantId),
    safeTenantPath('media', 'tenants', tenantId),
    safeTenantPath('publishing-uploads', tenantId),
  ].filter(item => fs.existsSync(item));

  const report = { execute, tenantId, email, materialIds, pocketbase: plan.map(({ ids, ...item }) => item), localJson: localPlan.map(({ kept, file, ...item }) => item), usageKeys, directories: dirs };
  if (!execute) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  for (const item of plan) for (const id of item.ids) await removeRecord(token, item.collection, id);
  for (const item of localPlan) atomicWrite(item.file, item.kept);
  if (usageKeys.length) {
    for (const key of usageKeys) delete usage[key];
    atomicWrite(usageFile, usage);
  }
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  for (const user of users) await removeRecord(token, 'users', String(user.id));
  await removeRecord(token, 'tenants', tenantId);

  const after = [];
  for (const item of plan) {
    const qaRows = await list(token, item.collection, `${item.field} = "${escaped(tenantId)}"`);
    const total = await count(token, item.collection);
    after.push({ collection: item.collection, qa: qaRows.length, otherAfter: total });
    if (qaRows.length || total !== item.otherBefore) throw new Error(`Post-cleanup verification failed for ${item.collection}`);
  }
  if ((await list(token, 'users', `tenantId = "${escaped(tenantId)}"`)).length) throw new Error('QA user still exists');
  if ((await list(token, 'tenants', `id = "${escaped(tenantId)}"`)).length) throw new Error('QA tenant still exists');
  for (const item of localPlan) {
    const value = readJson(item.file, []);
    if (value.some(entry => String(entry?.tenantId || entry?.tenant_id || '') === tenantId)) throw new Error(`QA data remains in ${item.name}`);
  }
  if (dirs.some(item => fs.existsSync(item))) throw new Error('QA tenant directory still exists');
  console.log(JSON.stringify({ ...report, verified: true, after }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.stack : error); process.exit(1); });
