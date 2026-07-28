import fs from 'node:fs';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

type Material = { objectKey?: string; posterObjectKey?: string; segments?: Array<{ posterObjectKey?: string }> };
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const oldClient = new S3Client({
  endpoint: `https://${required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`, region: 'auto',
  credentials: { accessKeyId: required('R2_ACCESS_KEY_ID'), secretAccessKey: required('R2_SECRET_ACCESS_KEY') },
});
const cosClient = new S3Client({
  endpoint: required('OBJECT_STORAGE_ENDPOINT'), region: required('OBJECT_STORAGE_REGION'),
  credentials: { accessKeyId: required('OBJECT_STORAGE_ACCESS_KEY_ID'), secretAccessKey: required('OBJECT_STORAGE_SECRET_ACCESS_KEY') },
});
const oldBucket = required('R2_BUCKET_NAME');
const cosBucket = required('OBJECT_STORAGE_BUCKET_NAME');
const materials = JSON.parse(fs.readFileSync('data/materials.json', 'utf8')) as Material[];
const keys = [...new Set(materials.flatMap(item => [item.objectKey, item.posterObjectKey, ...(item.segments || []).map(segment => segment.posterObjectKey)]).filter(Boolean))] as string[];
let copied = 0;
let skipped = 0;
for (const Key of keys) {
  try {
    const existing = await cosClient.send(new HeadObjectCommand({ Bucket: cosBucket, Key }));
    if ((existing.ContentLength || 0) > 0) { skipped += 1; continue; }
  } catch { /* copy missing COS object */ }
  const source = await oldClient.send(new GetObjectCommand({ Bucket: oldBucket, Key }));
  if (!source.Body) throw new Error(`R2 object has no body: ${Key}`);
  const body = Buffer.from(await source.Body.transformToByteArray());
  await cosClient.send(new PutObjectCommand({ Bucket: cosBucket, Key, Body: body, ContentType: source.ContentType || 'application/octet-stream' }));
  const verified = await cosClient.send(new HeadObjectCommand({ Bucket: cosBucket, Key }));
  if (verified.ContentLength !== body.length) throw new Error(`COS size mismatch: ${Key}`);
  copied += 1;
  console.log(JSON.stringify({ copied, total: keys.length, key: Key, size: body.length }));
}
console.log(JSON.stringify({ complete: true, total: keys.length, copied, skipped }));
