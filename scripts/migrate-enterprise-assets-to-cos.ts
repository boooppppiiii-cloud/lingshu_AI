import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { enterpriseAssetContentType, enterpriseAssetObjectKeyFromTenantKey } from '../server/storage/enterpriseAssets.js';
import { objectStorageEnabled, r2Head, r2Upload } from '../server/storage/r2.js';

dotenv.config({ path: process.env.ENV_FILE_PATH || '.env.production' });

const root = process.cwd();
const assetsDir = path.resolve(root, process.env.ENTERPRISE_ASSETS_DIR || 'data/enterprise-assets');
const stateFile = path.resolve(root, process.env.ENTERPRISE_ASSETS_MIGRATION_STATE || 'data/migrations/enterprise-assets-cos.json');
const dryRun = process.argv.includes('--dry-run');
const batchArg = process.argv.find(arg => arg.startsWith('--batch-size='));
const batchSize = Math.max(1, Number(batchArg?.split('=', 2)[1] || 25));

interface MigrationEntry {
  key: string;
  size: number;
  migratedAt: string;
  etag?: string;
}

interface MigrationState {
  version: 1;
  updatedAt: string;
  entries: Record<string, MigrationEntry>;
}

function readState(): MigrationState {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as MigrationState;
    return parsed.version === 1 && parsed.entries ? parsed : { version: 1, updatedAt: '', entries: {} };
  } catch {
    return { version: 1, updatedAt: '', entries: {} };
  }
}

function writeState(state: MigrationState): void {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  state.updatedAt = new Date().toISOString();
  const temp = `${stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, stateFile);
}

function listFiles(): Array<{ source: string; relative: string; key: string; size: number }> {
  if (!fs.existsSync(assetsDir)) return [];
  const files: Array<{ source: string; relative: string; key: string; size: number }> = [];
  for (const tenantDir of fs.readdirSync(assetsDir, { withFileTypes: true })) {
    if (!tenantDir.isDirectory()) continue;
    const tenantPath = path.join(assetsDir, tenantDir.name);
    for (const item of fs.readdirSync(tenantPath, { withFileTypes: true })) {
      if (!item.isFile()) continue;
      const source = path.join(tenantPath, item.name);
      const relative = `${tenantDir.name}/${item.name}`;
      files.push({
        source,
        relative,
        key: enterpriseAssetObjectKeyFromTenantKey(tenantDir.name, item.name),
        size: fs.statSync(source).size,
      });
    }
  }
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

async function main(): Promise<void> {
  if (!dryRun && !objectStorageEnabled()) throw new Error('object storage is not configured');
  const state = readState();
  const files = listFiles();
  const pending = files.filter(file => state.entries[file.relative]?.size !== file.size);
  console.log(JSON.stringify({ dryRun, total: files.length, migrated: files.length - pending.length, pending: pending.length, batchSize }));
  if (dryRun) return;

  let migratedThisRun = 0;
  let bytesThisRun = 0;
  for (const file of pending.slice(0, batchSize)) {
    const existing = await r2Head(file.key);
    if (!existing || existing.size !== file.size) {
      await r2Upload({
        key: file.key,
        body: fs.readFileSync(file.source),
        contentType: enterpriseAssetContentType(file.source),
      });
    }
    const verified = await r2Head(file.key);
    if (!verified || verified.size !== file.size) throw new Error(`verification failed for ${file.relative}`);
    state.entries[file.relative] = {
      key: file.key,
      size: file.size,
      migratedAt: new Date().toISOString(),
      etag: verified.etag,
    };
    writeState(state);
    migratedThisRun += 1;
    bytesThisRun += file.size;
    console.log(JSON.stringify({ migrated: file.relative, size: file.size, progress: `${files.length - pending.length + migratedThisRun}/${files.length}` }));
  }
  console.log(JSON.stringify({ complete: pending.length <= batchSize, migratedThisRun, bytesThisRun, remaining: Math.max(0, pending.length - batchSize) }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
