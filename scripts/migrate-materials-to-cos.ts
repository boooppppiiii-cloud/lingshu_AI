import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { materialAssetContentType, materialAssetObjectKey } from '../server/storage/materialAssets.js';
import { objectStorageEnabled, r2Head, r2Upload } from '../server/storage/r2.js';

dotenv.config({ path: process.env.ENV_FILE_PATH || '.env.production' });

const root = process.cwd();
const mediaDir = path.resolve(root, process.env.MATERIAL_MEDIA_DIR || 'data/media');
const materialsFile = path.resolve(root, process.env.MATERIALS_FILE || 'data/materials.json');
const dryRun = process.argv.includes('--dry-run');

type Segment = { poster?: string; posterObjectKey?: string };
type Material = {
  id: string;
  tenantId?: string;
  scope?: string;
  file: string;
  url?: string;
  poster?: string;
  objectKey?: string;
  posterObjectKey?: string;
  segments?: Segment[];
};

function localPath(value?: string): string | null {
  const relative = String(value || '').replace(/^\/media\//, '').split('?', 1)[0];
  if (!relative || /^https?:\/\//i.test(relative)) return null;
  const resolved = path.resolve(mediaDir, relative);
  return resolved.startsWith(`${mediaDir}${path.sep}`) ? resolved : null;
}

async function uploadFile(tenantId: string, filePath: string): Promise<string> {
  const key = materialAssetObjectKey(tenantId, path.basename(filePath));
  const stat = fs.statSync(filePath);
  const existing = await r2Head(key);
  if (!existing || existing.size !== stat.size) {
    await r2Upload({ key, body: fs.readFileSync(filePath), contentType: materialAssetContentType(filePath) });
  }
  const verified = await r2Head(key);
  if (!verified || verified.size !== stat.size) throw new Error(`COS verification failed: ${key}`);
  return key;
}

function persist(materials: Material[]): void {
  const temp = `${materialsFile}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(materials, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, materialsFile);
}

async function main(): Promise<void> {
  if (!fs.existsSync(materialsFile)) {
    if (dryRun) {
      console.log(JSON.stringify({ dryRun, total: 0, pending: 0, note: 'materials index not found' }));
      return;
    }
    throw new Error(`materials index not found: ${materialsFile}`);
  }
  if (!dryRun && !objectStorageEnabled()) throw new Error('object storage is not configured');
  const materials = JSON.parse(fs.readFileSync(materialsFile, 'utf8')) as Material[];
  const pending = materials.filter(item => item.scope === 'own' && item.tenantId && !item.objectKey && localPath(item.file) && fs.existsSync(localPath(item.file)!));
  console.log(JSON.stringify({ dryRun, total: materials.length, pending: pending.length }));
  if (dryRun) return;

  let migrated = 0;
  for (const material of pending) {
    const tenantId = String(material.tenantId);
    const source = localPath(material.file)!;
    const originalUrl = material.url;
    material.objectKey = await uploadFile(tenantId, source);
    material.url = '';

    const poster = localPath(material.poster);
    if (poster && fs.existsSync(poster)) {
      material.posterObjectKey = await uploadFile(tenantId, poster);
      material.poster = undefined;
    } else if (material.poster === originalUrl) {
      material.posterObjectKey = material.objectKey;
    }
    for (const segment of material.segments || []) {
      const segmentPoster = localPath(segment.poster);
      if (!segmentPoster || !fs.existsSync(segmentPoster)) continue;
      segment.posterObjectKey = await uploadFile(tenantId, segmentPoster);
      segment.poster = undefined;
    }
    persist(materials);
    migrated += 1;
    console.log(JSON.stringify({ migrated: material.id, tenantId, progress: `${migrated}/${pending.length}` }));
  }
  console.log(JSON.stringify({ complete: true, migrated }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
