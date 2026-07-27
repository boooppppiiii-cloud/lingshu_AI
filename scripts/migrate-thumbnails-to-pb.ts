/**
 * 把历史封面从 data/media/*.thumb.jpg 迁进 PocketBase 的 trend_videos.thumbnailFile。
 *
 * 背景：封面此前只写在各自代码副本的 data/media/ 下，而 PocketBase 是多个副本共用的。
 * 于是换一个工作目录跑，数据库里的 /media/xxx.thumb.jpg 就集体变成 404。
 * 迁完之后封面跟记录绑在一起，换目录、换机器都不再丢。
 *
 * 用法：
 *   npx tsx scripts/migrate-thumbnails-to-pb.ts          # 演练，只报告不写入
 *   npx tsx scripts/migrate-thumbnails-to-pb.ts --apply  # 实际写入
 *
 * 需要 PocketBase 已启动，且 scripts/setup-pb.ts 已建出 thumbnailFile 字段。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PB_URL = (process.env.PB_URL ?? 'http://127.0.0.1:8090').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD ?? '';
const MEDIA_DIR = path.join(__dirname, '..', 'data', 'media');
const COL = 'trend_videos';
const APPLY = process.argv.includes('--apply');

/** 额外的本地封面来源目录，用逗号分隔；用于从旧工作副本回捞文件。 */
const EXTRA_DIRS = String(process.env.THUMB_MIGRATION_EXTRA_DIRS ?? '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);

async function adminToken(): Promise<string> {
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`PocketBase admin auth failed: ${res.status} ${await res.text().catch(() => '')}`);
  return String(((await res.json()) as { token?: string }).token ?? '');
}

/** 在所有候选目录里找这条记录的封面文件。 */
function findLocalThumb(basename: string): string | null {
  for (const dir of [MEDIA_DIR, ...EXTRA_DIRS]) {
    const candidate = path.join(dir, basename);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) return candidate;
    } catch { /* 目录不可读就跳过 */ }
  }
  return null;
}

function contentTypeOf(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function listAllRecords(token: string): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (let page = 1; ; page += 1) {
    const res = await fetch(
      `${PB_URL}/api/collections/${COL}/records?page=${page}&perPage=200`,
      { headers: { Authorization: token } },
    );
    if (!res.ok) throw new Error(`list ${COL} failed: ${res.status}`);
    const body = (await res.json()) as { items?: Array<Record<string, unknown>>; totalPages?: number };
    out.push(...(body.items ?? []));
    if (page >= Number(body.totalPages ?? 1)) break;
  }
  return out;
}

async function main(): Promise<void> {
  if (!EMAIL || !PASSWORD) throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD are required');
  const token = await adminToken();
  const records = await listAllRecords(token);

  let migrated = 0;
  let alreadyDone = 0;
  let missingFile = 0;
  let notLocal = 0;

  for (const record of records) {
    const id = String(record.id || '');
    const thumbnailUrl = String(record.thumbnailUrl || '');
    if (String(record.thumbnailFile || '')) { alreadyDone += 1; continue; }
    if (!thumbnailUrl.startsWith('/media/')) { notLocal += 1; continue; }

    const localPath = findLocalThumb(path.basename(thumbnailUrl));
    if (!localPath) { missingFile += 1; continue; }

    if (!APPLY) { migrated += 1; continue; }

    const buf = fs.readFileSync(localPath);
    const contentType = contentTypeOf(localPath);
    const form = new FormData();
    form.append('thumbnailFile', new Blob([buf], { type: contentType }), path.basename(localPath));
    form.append('thumbnailUrl', `/api/overseas/videos/${id}/thumbnail`);

    const res = await fetch(`${PB_URL}/api/collections/${COL}/records/${id}`, {
      method: 'PATCH',
      headers: { Authorization: token },
      body: form,
    });
    if (!res.ok) {
      console.warn(`[thumb-migrate] ${id} failed: ${res.status} ${await res.text().catch(() => '')}`);
      continue;
    }
    migrated += 1;
  }

  console.log(APPLY ? '[thumb-migrate] applied' : '[thumb-migrate] dry run (pass --apply to write)');
  console.log(`  记录总数        ${records.length}`);
  console.log(`  可迁移/已迁移   ${migrated}`);
  console.log(`  已在 PB 里      ${alreadyDone}`);
  console.log(`  本地文件缺失    ${missingFile}`);
  console.log(`  非本地封面      ${notLocal}  （外链，如 i.ytimg.com；本脚本不处理）`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
