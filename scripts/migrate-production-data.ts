/**
 * Migrates local runtime JSON into PocketBase before the Singapore cut-over.
 * Dry-run is the default. Set MIGRATION_APPLY=true to write.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { decryptRegistrationPassword } from '../server/lib/registrationCredentials.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.production'), override: true });

const pbUrl = String(process.env.PB_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
const adminEmail = String(process.env.PB_ADMIN_EMAIL || '').trim();
const adminPassword = String(process.env.PB_ADMIN_PASSWORD || '').trim();
const apply = String(process.env.MIGRATION_APPLY || '').toLowerCase() === 'true';
const dataDir = path.join(root, 'data');

type JsonRecord = Record<string, any>;
type LocalTenant = JsonRecord & { id: string; registeredEmail?: string; registeredPasswordCipher?: string };

function readJson<T>(relative: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, relative), 'utf8')) as T; } catch { return fallback; }
}

function pbValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function request(token: string, endpoint: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`${pbUrl}${endpoint}`, {
    ...init,
    headers: { Authorization: token, ...(init.headers || {}) },
  });
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${endpoint}: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function authenticate(): Promise<string> {
  if (!adminEmail || !adminPassword) throw new Error('PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD are required');
  for (const collection of ['_superusers', 'admins']) {
    const response = await fetch(`${pbUrl}/api/collections/${collection}/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
    }).catch(() => null);
    if (response?.ok) {
      const body = await response.json() as { token?: string };
      if (body.token) return body.token;
    }
  }
  throw new Error('PocketBase admin authentication failed');
}

async function findOne(token: string, collection: string, filter: string): Promise<JsonRecord | null> {
  const body = await request(token, `/api/collections/${collection}/records?perPage=1&filter=${encodeURIComponent(filter)}`);
  return body.items?.[0] || null;
}

async function upsert(
  token: string,
  collection: string,
  filter: string,
  payload: JsonRecord,
): Promise<JsonRecord | null> {
  const existing = await findOne(token, collection, filter);
  if (!apply) return existing || { id: `dry_${collection}` };
  return request(token, `/api/collections/${collection}/records${existing?.id ? `/${existing.id}` : ''}`, {
    method: existing?.id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function migrateTenant(token: string, tenant: LocalTenant): Promise<{ oldId: string; newId: string }> {
  const email = String(tenant.registeredEmail || '').trim().toLowerCase();
  const invite = String(tenant.registrationInviteCode || tenant.inviteCode || '').trim();
  const lookup = email
    ? `registeredEmail = ${pbValue(email)}`
    : invite
      ? `registrationInviteCode = ${pbValue(invite)}`
      : `name = ${pbValue(String(tenant.companyName || tenant.name || tenant.id))}`;
  const payload = {
    name: String(tenant.name || tenant.companyName || tenant.id),
    companyName: String(tenant.companyName || tenant.name || ''),
    contactName: String(tenant.contactName || ''),
    contact: String(tenant.contact || ''),
    industry: String(tenant.industry || ''),
    notes: String(tenant.notes || ''),
    inviteCode: String(tenant.inviteCode || ''),
    registrationInviteCode: invite,
    registeredEmail: email,
    registeredPasswordCipher: String(tenant.registeredPasswordCipher || ''),
    registeredAt: String(tenant.registeredAt || ''),
    subscriptionStatus: String(tenant.subscriptionStatus || 'active'),
    subscriptionPlan: String(tenant.subscriptionPlan || 'customer'),
    subscriptionExpiresAt: tenant.subscriptionExpiresAt || null,
    createdAt: String(tenant.createdAt || new Date().toISOString()),
  };
  const remote = await upsert(token, 'tenants', lookup, payload);
  const newId = String(remote?.id || '');
  if (!newId) throw new Error(`Tenant migration did not return an id: ${tenant.id}`);

  if (email) {
    const password = decryptRegistrationPassword(tenant.registeredPasswordCipher);
    const existingUser = await findOne(token, 'users', `email = ${pbValue(email)}`);
    if (!existingUser && !password) {
      console.warn(`  ! ${email}: password cannot be decrypted; user creation skipped`);
    } else if (apply && existingUser) {
      await request(token, `/api/collections/users/records/${existingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: newId,
          ...(password ? { password, passwordConfirm: password } : {}),
        }),
      });
    } else if (apply) {
      await request(token, '/api/collections/users/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, passwordConfirm: password, name: payload.companyName, tenantId: newId, emailVisibility: true }),
      });
    }
  }
  return { oldId: tenant.id, newId };
}

function remap(value: unknown, mapping: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map(item => remap(item, mapping));
  if (!value || typeof value !== 'object') return value;
  const next: JsonRecord = {};
  for (const [key, item] of Object.entries(value as JsonRecord)) {
    if (['tenantId', 'tenant_id'].includes(key) && typeof item === 'string') next[key] = mapping.get(item) || item;
    else if (key === 'config' && item && typeof item === 'object') next[key] = remap(item, mapping);
    else next[key] = remap(item, mapping);
  }
  return next;
}

async function migrateOperationalData(token: string, mapping: Map<string, string>): Promise<void> {
  const tasks = remap(readJson<JsonRecord[]>('tasks.json', []), mapping) as JsonRecord[];
  for (const task of tasks) {
    const tenantId = String(task.tenantId || '');
    if (!tenantId || !task.id) continue;
    await upsert(token, 'scheduled_tasks', `tenant_id = ${pbValue(tenantId)} && task_id = ${pbValue(String(task.id))}`, {
      task_id: task.id, tenant_id: tenantId, name: task.name || task.id,
      category: task.category || '', task_type: task.taskType || 'custom', cron_expr: task.cronExpr || '0 8 * * *',
      cron_label: task.cronLabel || '', enabled: task.enabled !== false, channel_id: task.channelId || '',
      config: task.config || {}, last_run: task.lastRun || '', last_result: task.lastResult || '', created_at: task.createdAt || new Date().toISOString(),
    });
  }

  const customers = remap(readJson<JsonRecord[]>('whatsapp-customers.json', []), mapping) as JsonRecord[];
  for (const customer of customers) {
    if (!customer.tenantId || !customer.id) continue;
    await upsert(token, 'whatsapp_customers', `tenant_id = ${pbValue(customer.tenantId)} && customer_id = ${pbValue(customer.id)}`, {
      tenant_id: customer.tenantId, customer_id: customer.id, wa_number: customer.waNumber || '', name: customer.name || '',
      stage: customer.stage || '', last_active_at: Number(customer.lastActiveAt || 0), payload: customer,
    });
  }

  const interactions = remap(readJson<JsonRecord[]>('whatsapp-interactions.json', []), mapping) as JsonRecord[];
  for (const interaction of interactions) {
    if (!interaction.tenantId || !interaction.id) continue;
    await upsert(token, 'whatsapp_interactions', `tenant_id = ${pbValue(interaction.tenantId)} && interaction_id = ${pbValue(interaction.id)}`, {
      tenant_id: interaction.tenantId, interaction_id: interaction.id, customer_id: interaction.customerId || '',
      wa_number: interaction.waNumber || '', timestamp: Number(interaction.timestamp || 0), payload: interaction,
    });
  }

  const settings = readJson<Record<string, JsonRecord>>('support-access-settings.json', {});
  for (const [oldId, setting] of Object.entries(settings)) {
    const tenantId = mapping.get(oldId) || oldId;
    await upsert(token, 'tenant_support_settings', `tenant_id = ${pbValue(tenantId)}`, {
      tenant_id: tenantId, default_authorized: setting.defaultAuthorized !== false, updated_by: setting.updatedByUserId || 'migration',
    });
  }

  const requests = remap(readJson<JsonRecord[]>('support-access.json', []), mapping) as JsonRecord[];
  for (const item of requests) {
    if (!item.id || !item.tenantId) continue;
    await upsert(token, 'support_access_requests', `request_id = ${pbValue(item.id)}`, {
      request_id: item.id, tenant_id: item.tenantId, tenant_name: item.tenantName || '', admin_user_id: item.requestedByUserId || 'migration',
      admin_email: item.requestedByEmail || '', status: item.status || 'revoked', requested_at: item.requestedAt || new Date().toISOString(), revoked_at: item.revokedAt || '',
    });
  }
  console.log(`  tasks=${tasks.length}, whatsappCustomers=${customers.length}, whatsappInteractions=${interactions.length}, supportRequests=${requests.length}`);
}

async function remapExistingPocketBaseRows(token: string, mapping: Map<string, string>): Promise<void> {
  for (const collection of ['trend_videos', 'competitor_accounts']) {
    for (const [oldId, newId] of mapping) {
      let page = 1;
      while (true) {
        const body = await request(token, `/api/collections/${collection}/records?page=${page}&perPage=200&filter=${encodeURIComponent(`tenantId = ${pbValue(oldId)}`)}`);
        for (const row of body.items || []) {
          if (apply) await request(token, `/api/collections/${collection}/records/${row.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: newId }),
          });
        }
        if (page >= Number(body.totalPages || 1)) break;
        page += 1;
      }
    }
  }
}

async function main(): Promise<void> {
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} migration against ${pbUrl}`);
  const token = await authenticate();
  const tenants = readJson<LocalTenant[]>('local-auth-tenants.json', []);
  const mapping = new Map<string, string>();
  for (const tenant of tenants) {
    const result = await migrateTenant(token, tenant);
    mapping.set(result.oldId, result.newId);
    console.log(`  tenant ${result.oldId} -> ${result.newId}`);
  }
  await migrateOperationalData(token, mapping);
  await remapExistingPocketBaseRows(token, mapping);
  const mapFile = path.join(dataDir, 'migration-tenant-id-map.json');
  if (apply) fs.writeFileSync(mapFile, JSON.stringify(Object.fromEntries(mapping), null, 2), { mode: 0o600 });
  console.log(apply ? `Migration complete. Mapping written to ${mapFile}` : 'Dry run complete. Set MIGRATION_APPLY=true after reviewing output.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
