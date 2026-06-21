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

type Field = { name: string; type: 'text' | 'number'; required?: boolean };

/** Collection definitions, derived from what the route handlers write/read. */
const COLLECTIONS: { name: string; fields: Field[] }[] = [
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

async function main(): Promise<void> {
  console.log(`→ Provisioning PocketBase at ${PB_URL}`);
  const token = await authToken();
  const existing = await listCollections(token);

  await ensureUsersTenantId(token);

  for (const { name, fields } of COLLECTIONS) {
    if (existing.has(name)) {
      console.log(`  = ${name} already exists`);
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
