import 'dotenv/config';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../server/storage/index.js';
import { repairMissingCrawledThumbnails } from '../server/routes/videos.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local'), override: true });

async function main() {
  const records: Record<string, unknown>[] = [];
  const first = await store.list<Record<string, unknown>>('trend_videos', { sort: '-crawledAt', page: 1, perPage: 100 });
  records.push(...first.items);
  for (let page = 2; page <= first.totalPages; page += 1) {
    const next = await store.list<Record<string, unknown>>('trend_videos', { sort: '-crawledAt', page, perPage: 100 });
    records.push(...next.items);
  }
  const repaired = await repairMissingCrawledThumbnails(records, records.length);
  console.log(`thumbnail repair complete: scanned=${records.length}, repaired=${repaired}`);
}

main().catch(error => { console.error(error); process.exit(1); });
