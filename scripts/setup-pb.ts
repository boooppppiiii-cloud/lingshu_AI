/**
 * Idempotent PocketBase provisioning for the overseas-workbench backend.
 *
 * Creates the collections the app reads/writes and ensures `users.tenantId`
 * exists (the multi-tenant auth field). Safe to re-run: existing collections
 * and fields are left untouched.
 *
 * Usage:  npx tsx scripts/setup-pb.ts
 * Reads PB_URL / PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD from .env.
 *
 * This is the single source of truth for the overseas PB schema — run it
 * against any fresh instance (local dev OR the Singapore cloud deploy).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PB_URL = (process.env.PB_URL ?? 'http://127.0.0.1:8090').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD ?? '';

type Field = { name: string; type: string; required?: boolean; [k: string]: unknown };

/** Collection definitions, derived from what the route handlers write/read. */
const COLLECTIONS: { name: string; fields: Field[] }[] = [
  {
    // 租户（按公司订阅）；subscription.ts 读这几个字段
    name: 'tenants',
    fields: [
      { name: 'name', type: 'text' },
      { name: 'companyName', type: 'text' },
      { name: 'contactName', type: 'text' },
      { name: 'contact', type: 'text' },
      { name: 'industry', type: 'text' },
      { name: 'notes', type: 'text' },
      { name: 'inviteCode', type: 'text' },
      { name: 'registrationInviteCode', type: 'text' },
      { name: 'registeredEmail', type: 'text' },
      { name: 'registeredPasswordCipher', type: 'text' },
      { name: 'registeredAt', type: 'text' },
      { name: 'subscriptionStatus', type: 'text' },     // active/trialing/past_due/canceled/expired/none
      { name: 'subscriptionPlan', type: 'text' },
      { name: 'subscriptionExpiresAt', type: 'text' },  // ISO；空=不过期
      { name: 'createdAt', type: 'text' },
    ],
  },
  {
    name: 'trend_videos',
    fields: [
      { name: 'tenantId', type: 'text' },
      { name: 'platform', type: 'text' },
      { name: 'title', type: 'text' },
      { name: 'thumbnailUrl', type: 'text' },
      { name: 'videoFileId', type: 'text' },
      { name: 'duration', type: 'number' },
      { name: 'sourceUrl', type: 'text' },
      { name: 'tags', type: 'text' },
      { name: 'aiAnalysis', type: 'text' },
      { name: 'status', type: 'text' },
      { name: 'crawledAt', type: 'text' },
      // The raw video blob — stored on PB disk, not in the SQLite row.
      { name: 'videoFile', type: 'file', maxSelect: 1, maxSize: 104857600 },
    ],
  },
  {
    name: 'scripts',
    fields: [
      { name: 'tenantId', type: 'text' },
      { name: 'userId', type: 'text' },
      { name: 'sourceVideoId', type: 'text' },
      { name: 'type', type: 'text' },
      { name: 'language', type: 'text' },
      { name: 'content', type: 'text' },
      { name: 'productInfo', type: 'text' },
      { name: 'status', type: 'text' },
      { name: 'createdAt', type: 'text' },
    ],
  },
  {
    name: 'generated_assets',
    fields: [
      { name: 'tenantId', type: 'text' },
      { name: 'scriptId', type: 'text' },
      { name: 'sceneIndex', type: 'number' },
      { name: 'type', type: 'text' },
      { name: 'fileId', type: 'text' },
      { name: 'prompt', type: 'text' },
      { name: 'status', type: 'text' },
      { name: 'createdAt', type: 'text' },
    ],
  },
  {
    name: 'daily_trends',
    fields: [
      { name: 'tenantId', type: 'text' },
      { name: 'date', type: 'text' },
      { name: 'videoIds', type: 'text' },
      { name: 'selectedIds', type: 'text' },
      { name: 'status', type: 'text' },
    ],
  },
  {
    name: 'tenant_profiles',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'profile', type: 'json', required: true },
      { name: 'updated_by', type: 'text' },
    ],
  },
  {
    name: 'tenant_orders',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'order_no', type: 'text', required: true },
      { name: 'order', type: 'json', required: true },
    ],
  },
  {
    name: 'tenant_api_keys',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'api_key', type: 'text', required: true },
      { name: 'created_at', type: 'text', required: true },
      { name: 'last_ingested_at', type: 'text' },
      { name: 'last_product_name', type: 'text' },
    ],
  },
  {
    name: 'tenant_support_settings',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'default_authorized', type: 'bool', required: true },
      { name: 'updated_by', type: 'text' },
    ],
  },
  {
    name: 'support_access_requests',
    fields: [
      { name: 'request_id', type: 'text', required: true },
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'tenant_name', type: 'text' },
      { name: 'admin_user_id', type: 'text', required: true },
      { name: 'admin_email', type: 'text' },
      { name: 'status', type: 'text', required: true },
      { name: 'requested_at', type: 'text', required: true },
      { name: 'revoked_at', type: 'text' },
    ],
  },
  {
    name: 'audit_logs',
    fields: [
      { name: 'tenantId', type: 'text', required: true },
      { name: 'actorUserId', type: 'text', required: true },
      { name: 'actorEmail', type: 'text' },
      { name: 'action', type: 'text', required: true },
      { name: 'targetType', type: 'text' },
      { name: 'targetId', type: 'text' },
      { name: 'metadata', type: 'json' },
      { name: 'createdAt', type: 'text', required: true },
    ],
  },
  {
    name: 'scheduled_tasks',
    fields: [
      { name: 'task_id', type: 'text', required: true },
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'name', type: 'text', required: true },
      { name: 'category', type: 'text' },
      { name: 'task_type', type: 'text', required: true },
      { name: 'cron_expr', type: 'text', required: true },
      { name: 'cron_label', type: 'text' },
      { name: 'enabled', type: 'bool' },
      { name: 'channel_id', type: 'text' },
      { name: 'config', type: 'json' },
      { name: 'last_run', type: 'text' },
      { name: 'last_result', type: 'text' },
      { name: 'created_at', type: 'text', required: true },
    ],
  },
  {
    name: 'whatsapp_customers',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'customer_id', type: 'text', required: true },
      { name: 'wa_number', type: 'text' },
      { name: 'name', type: 'text' },
      { name: 'stage', type: 'text' },
      { name: 'last_active_at', type: 'number' },
      { name: 'payload', type: 'json', required: true },
    ],
  },
  {
    name: 'whatsapp_interactions',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'interaction_id', type: 'text', required: true },
      { name: 'customer_id', type: 'text', required: true },
      { name: 'wa_number', type: 'text' },
      { name: 'timestamp', type: 'number' },
      { name: 'payload', type: 'json', required: true },
    ],
  },
  {
    // 对标账号库：灵感大屏「爬取对标账号主页视频」功能读写这里
    name: 'competitor_accounts',
    fields: [
      { name: 'tenantId', type: 'text' },
      { name: 'platform', type: 'text' },          // youtube / tiktok
      { name: 'accountUrl', type: 'text' },         // 主页 URL（规范化后）
      { name: 'accountName', type: 'text' },        // 展示名
      { name: 'handle', type: 'text' },             // @handle / channel id
      { name: 'avatarUrl', type: 'text' },
      { name: 'note', type: 'text' },
      { name: 'lastCrawledAt', type: 'text' },      // ISO
      { name: 'lastCrawlCount', type: 'number' },
      { name: 'createdAt', type: 'text' },
    ],
  },
];

/** Auth as superuser; supports both new (_superusers) and legacy (admins) APIs. */
async function authToken(): Promise<string> {
  if (!EMAIL || !PASSWORD) {
    throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD not set in .env');
  }
  const body = JSON.stringify({ identity: EMAIL, password: PASSWORD });
  for (const p of [
    '/api/collections/_superusers/auth-with-password',
    '/api/admins/auth-with-password',
  ]) {
    const res = await fetch(`${PB_URL}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (res.ok) {
      const json = (await res.json()) as { token?: string };
      if (json.token) return json.token;
    }
  }
  throw new Error('Superuser auth failed — check creds and PB version');
}

async function listCollections(token: string): Promise<Map<string, unknown>> {
  const res = await fetch(`${PB_URL}/api/collections?perPage=500`, {
    headers: { Authorization: token },
  });
  const json = (await res.json()) as { items?: { name: string }[] };
  return new Map((json.items ?? []).map((c) => [c.name, c]));
}

async function createCollection(token: string, name: string, fields: Field[]): Promise<void> {
  const res = await fetch(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({
      name,
      type: 'base',
      fields: fields.map((f) => ({ ...f, required: f.required ?? false })),
    }),
  });
  if (!res.ok) {
    throw new Error(`create ${name} failed: ${res.status} ${await res.text()}`);
  }
  console.log(`  ✓ created ${name}`);
}

/** Add any missing fields to an existing collection (idempotent schema sync). */
async function ensureFields(token: string, name: string, want: Field[]): Promise<void> {
  const res = await fetch(`${PB_URL}/api/collections/${name}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) return;
  const col = (await res.json()) as { fields?: { name: string }[] };
  const have = new Set((col.fields ?? []).map((f) => f.name));
  const missing = want.filter((f) => !have.has(f.name));
  if (!missing.length) {
    console.log(`  = ${name} up to date`);
    return;
  }
  const merged = [
    ...(col.fields ?? []),
    ...missing.map((f) => ({ ...f, required: f.required ?? false })),
  ];
  const up = await fetch(`${PB_URL}/api/collections/${name}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ fields: merged }),
  });
  if (!up.ok) throw new Error(`patch ${name} fields failed: ${up.status} ${await up.text()}`);
  console.log(`  ✓ ${name}: added ${missing.map((f) => f.name).join(', ')}`);
}

/** Ensure the users auth collection has a tenantId field. */
async function ensureUsersTenantId(token: string): Promise<void> {
  const res = await fetch(`${PB_URL}/api/collections/users`, {
    headers: { Authorization: token },
  });
  if (!res.ok) {
    console.log('  ! users collection not found — skipping tenantId');
    return;
  }
  const col = (await res.json()) as { fields?: { name: string }[]; schema?: { name: string }[] };
  const fields = col.fields ?? col.schema ?? [];
  if (fields.some((f) => f.name === 'tenantId')) {
    console.log('  = users.tenantId already present');
    return;
  }
  const key = col.fields ? 'fields' : 'schema';
  const patch = {
    [key]: [...fields, { name: 'tenantId', type: 'text', required: false }],
  };
  const up = await fetch(`${PB_URL}/api/collections/users`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify(patch),
  });
  if (!up.ok) throw new Error(`add users.tenantId failed: ${up.status} ${await up.text()}`);
  console.log('  ✓ added users.tenantId');
}

async function ensureUsersCollection(token: string, existing: Map<string, unknown>): Promise<void> {
  if (existing.has('users')) {
    await ensureUsersTenantId(token);
    return;
  }
  const res = await fetch(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({
      name: 'users',
      type: 'auth',
      fields: [
        { name: 'name', type: 'text', required: false },
        { name: 'tenantId', type: 'text', required: true },
      ],
      passwordAuth: { enabled: true, identityFields: ['email'] },
    }),
  });
  if (!res.ok) throw new Error(`create users auth collection failed: ${res.status} ${await res.text()}`);
  console.log('  ✓ created users auth collection');
}

async function main(): Promise<void> {
  console.log(`→ Provisioning PocketBase at ${PB_URL}`);
  const token = await authToken();
  const existing = await listCollections(token);

  await ensureUsersCollection(token, existing);

  for (const { name, fields } of COLLECTIONS) {
    if (existing.has(name)) {
      await ensureFields(token, name, fields);
      continue;
    }
    await createCollection(token, name, fields);
  }
  console.log('✓ Done.');
}

main().catch((e) => {
  console.error('✗ Setup failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
