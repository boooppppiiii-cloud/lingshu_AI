import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { store } from '../server/storage/index.js';

dotenv.config({ path: process.env.ENV_FILE_PATH || '.env.production' });
const file = path.resolve(process.cwd(), 'data/studio-projects.json');
const tenantId = String(process.env.LEGACY_STUDIO_TENANT_ID || '').trim();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const projects = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as any[] : [];
  console.log(JSON.stringify({ dryRun, total: projects.length, tenantId: tenantId || null }));
  if (dryRun || !projects.length) return;
  if (!tenantId) throw new Error('LEGACY_STUDIO_TENANT_ID is required');
  let migrated = 0;
  for (const project of projects) {
    const existing = await store.list<any>('studio_projects', { where: { tenant_id: tenantId, legacy_id: String(project.id) }, perPage: 1 });
    if (!existing.items.length) {
      await store.create('studio_projects', { tenant_id: tenantId, legacy_id: String(project.id), title: String(project.title || '未命名草稿'), status: String(project.status || 'draft'), spec: project.spec || {}, thumb_seed: String(project.thumbSeed || ''), created_at: String(project.createdAt || ''), updated_at: String(project.updatedAt || '') });
    }
    migrated += 1;
  }
  console.log(JSON.stringify({ complete: true, migrated }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
