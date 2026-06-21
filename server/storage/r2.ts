import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket(): string {
  return process.env.R2_BUCKET_NAME ?? 'overseas-assets';
}

/** Upload a Buffer to R2, return the public URL */
export async function r2Upload(opts: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<string> {
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: opts.key,
      Body: opts.body,
      ContentType: opts.contentType,
    }),
  );
  const publicUrl = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
  return `${publicUrl}/${opts.key}`;
}

/** Download an object from R2 as a Buffer */
export async function r2Download(key: string): Promise<{ buf: Buffer; contentType: string } | null> {
  try {
    const client = getR2Client();
    const res = await client.send(
      new GetObjectCommand({ Bucket: getBucket(), Key: key }),
    );
    if (!res.Body) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return {
      buf: Buffer.concat(chunks),
      contentType: res.ContentType ?? 'application/octet-stream',
    };
  } catch {
    return null;
  }
}

/** Delete an object from R2 */
export async function r2Delete(key: string): Promise<void> {
  const client = getR2Client();
  await client.send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

/** Build public URL for a known R2 key */
export function r2PublicUrl(key: string): string {
  const base = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
  return `${base}/${key}`;
}
