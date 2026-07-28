import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { materialAssetContentType, sharedObjectKey, tenantPrivateObjectKey } from '../server/storage/materialAssets.js';
import { objectStorageEnabled, r2Head, r2Upload } from '../server/storage/r2.js';

dotenv.config({ path: process.env.ENV_FILE_PATH || '.env.production' });
const dryRun = process.argv.includes('--dry-run');
const root = process.cwd();
const namespaces = ['tts', 'voice-samples', 'covers', 'bgm'] as const;

type Entry = { namespace: string; tenantId?: string; shared?: boolean; file: string; key: string };
function entries(): Entry[] {
  const result: Entry[] = [];
  for (const namespace of namespaces) {
    const base = path.join(root, 'data', namespace);
    const tenants = path.join(base, 'tenants');
    if (fs.existsSync(tenants)) for (const tenantId of fs.readdirSync(tenants)) {
      const dir = path.join(tenants, tenantId);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        if (fs.statSync(file).isFile() && !name.endsWith('.json')) result.push({ namespace, tenantId, file, key: tenantPrivateObjectKey(namespace, tenantId, name) });
      }
    }
    const shared = path.join(base, 'shared');
    if (fs.existsSync(shared)) for (const name of fs.readdirSync(shared)) {
      const file = path.join(shared, name);
      if (fs.statSync(file).isFile()) result.push({ namespace, shared: true, file, key: sharedObjectKey(namespace, name) });
    }
  }
  return result;
}

async function main() {
  const files = entries();
  console.log(JSON.stringify({ dryRun, total: files.length }));
  if (dryRun) return;
  if (!objectStorageEnabled()) throw new Error('object storage is not configured');
  let migrated = 0;
  for (const entry of files) {
    const size = fs.statSync(entry.file).size;
    const existing = await r2Head(entry.key);
    if (!existing || existing.size !== size) await r2Upload({ key: entry.key, body: fs.readFileSync(entry.file), contentType: materialAssetContentType(entry.file) });
    const verified = await r2Head(entry.key);
    if (!verified || verified.size !== size) throw new Error(`verification failed: ${entry.key}`);
    migrated += 1;
    console.log(JSON.stringify({ migrated: entry.key, progress: `${migrated}/${files.length}` }));
  }
  console.log(JSON.stringify({ complete: true, migrated }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
