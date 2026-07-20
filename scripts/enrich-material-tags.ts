import 'dotenv/config';
import fs from 'node:fs';
import { adminFetch } from '../server/storage/pb.js';

type Taxonomy = Record<string, { industry: string; shotFunction: string; applicability: string; tags: string }>;
const taxonomy = JSON.parse(fs.readFileSync(new URL('../data/material-tag-taxonomy.json', import.meta.url), 'utf8')) as Taxonomy;

async function main() {
  const collectionResponse = await adminFetch('/api/collections/materials');
  if (!collectionResponse.ok) throw new Error(`materials collection unavailable: ${collectionResponse.status}`);
  const collection = await collectionResponse.json() as any;
  const fields = Array.isArray(collection.fields) ? collection.fields : [];
  for (const field of [
    { name: 'industry', type: 'text', max: 80 },
    { name: 'shotFunction', type: 'text', max: 200 },
    { name: 'applicability', type: 'text', max: 40 },
  ]) {
    if (!fields.some((item: any) => item.name === field.name)) fields.push(field);
  }
  const updatedCollection = await adminFetch('/api/collections/materials', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }),
  });
  if (!updatedCollection.ok) throw new Error(`taxonomy fields update failed: ${updatedCollection.status} ${await updatedCollection.text()}`);

  const listResponse = await adminFetch('/api/collections/materials/records?perPage=500');
  const records = (await listResponse.json() as any).items || [];
  let updated = 0;
  for (const record of records) {
    const tags = taxonomy[String(record.sourceName || '')];
    if (!tags) continue;
    const response = await adminFetch(`/api/collections/materials/records/${record.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tags),
    });
    if (!response.ok) throw new Error(`tag update failed for ${record.sourceName}: ${response.status}`);
    updated += 1;
  }
  console.log(`updated material taxonomy: ${updated}/${records.length}`);
}

main().catch(error => { console.error(error); process.exit(1); });
