/**
 * Import demo inspiration videos exported from PocketBase.
 *
 * Usage:
 *   PB_URL=https://your-pocketbase \
 *   PB_ADMIN_EMAIL=admin@example.com \
 *   PB_ADMIN_PASSWORD=... \
 *   npm run import:trend-videos
 *
 * Optional:
 *   IMPORT_TENANT_ID=<tenantId>  Rewrite all imported records to a specific tenant.
 *   IMPORT_LIMIT=100            Import only the first N records.
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
const IMPORT_TENANT_ID = process.env.IMPORT_TENANT_ID?.trim();
const IMPORT_LIMIT = Number(process.env.IMPORT_LIMIT || 0);
const DATA_FILE = path.join(__dirname, '..', 'data', 'trend-videos.json');

interface ExportPayload {
  items?: Record<string, unknown>[];
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

async function findExistingBySourceUrl(token: string, sourceUrl: string, tenantId: string): Promise<boolean> {
  const filter = `sourceUrl = "${sourceUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" && tenantId = "${tenantId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const params = new URLSearchParams({ page: '1', perPage: '1', filter });
  const res = await fetch(`${PB_URL}/api/collections/trend_videos/records?${params}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) return false;
  const json = await res.json() as { items?: unknown[] };
  return Boolean(json.items?.[0]);
}

function cleanRecord(input: Record<string, unknown>): Record<string, unknown> {
  const {
    id: _id,
    collectionId: _collectionId,
    collectionName: _collectionName,
    expand: _expand,
    created: _created,
    updated: _updated,
    videoFile: _videoFile,
    ...rest
  } = input;
  return {
    ...rest,
    tenantId: IMPORT_TENANT_ID || String(input.tenantId || 'demo-shared-video-pool'),
    tags: typeof rest.tags === 'string' ? rest.tags : JSON.stringify(rest.tags ?? []),
    aiAnalysis: typeof rest.aiAnalysis === 'string' ? rest.aiAnalysis : JSON.stringify(rest.aiAnalysis ?? {}),
    status: String(rest.status || 'analyzed'),
    crawledAt: String(rest.crawledAt || new Date().toISOString()),
  };
}

async function createRecord(token: string, record: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${PB_URL}/api/collections/trend_videos/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(`create failed ${res.status}: ${await res.text()}`);
}

async function main(): Promise<void> {
  const payload = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as ExportPayload;
  const sourceItems = payload.items ?? [];
  const items = IMPORT_LIMIT > 0 ? sourceItems.slice(0, IMPORT_LIMIT) : sourceItems;
  const token = await authToken();

  let created = 0;
  let skipped = 0;
  for (const item of items) {
    const record = cleanRecord(item);
    const sourceUrl = String(record.sourceUrl || '').trim();
    const tenantId = String(record.tenantId || '').trim();
    if (!sourceUrl || !tenantId) { skipped += 1; continue; }
    if (await findExistingBySourceUrl(token, sourceUrl, tenantId)) { skipped += 1; continue; }
    await createRecord(token, record);
    created += 1;
    if (created % 50 === 0) console.log(`  imported ${created}/${items.length}`);
  }

  console.log(`✓ import complete. created=${created}, skipped=${skipped}, source=${sourceItems.length}, target=${PB_URL}`);
}

main().catch((e) => {
  console.error('✗ import failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
