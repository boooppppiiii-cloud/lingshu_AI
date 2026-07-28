import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = (process.env.OBJECT_STORAGE_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID)?.trim();
  const secretAccessKey = (process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY)?.trim();
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT?.trim()
    || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const region = process.env.OBJECT_STORAGE_REGION?.trim() || 'auto';

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Object storage credentials not configured '
      + '(OBJECT_STORAGE_ENDPOINT / OBJECT_STORAGE_ACCESS_KEY_ID / OBJECT_STORAGE_SECRET_ACCESS_KEY)',
    );
  }

  return new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket(): string {
  return process.env.OBJECT_STORAGE_BUCKET_NAME || process.env.R2_BUCKET_NAME || 'overseas-assets';
}

export function objectStorageEnabled(): boolean {
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT?.trim()
    || (process.env.R2_ACCOUNT_ID?.trim() ? 'configured' : '');
  const accessKeyId = (process.env.OBJECT_STORAGE_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID)?.trim();
  const secretAccessKey = (process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY)?.trim();
  const bucket = (process.env.OBJECT_STORAGE_BUCKET_NAME || process.env.R2_BUCKET_NAME)?.trim();
  return Boolean(endpoint && accessKeyId && secretAccessKey && bucket);
}

function isNotFound(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate?.name === 'NoSuchKey'
    || candidate?.name === 'NotFound'
    || candidate?.$metadata?.httpStatusCode === 404;
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
    const res = await r2GetObject(key);
    if (!res) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.body) {
      chunks.push(chunk);
    }
    return {
      buf: Buffer.concat(chunks),
      contentType: res.contentType,
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export interface R2ObjectStream {
  body: AsyncIterable<Uint8Array>;
  contentType: string;
  contentLength?: number;
  contentRange?: string;
  acceptRanges?: string;
  etag?: string;
  lastModified?: Date;
}

/** Stream a private object through an authenticated application route. */
export async function r2GetObject(key: string, range?: string): Promise<R2ObjectStream | null> {
  try {
    const res = await getR2Client().send(new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
      ...(range ? { Range: range } : {}),
    }));
    if (!res.Body) return null;
    return {
      body: res.Body as AsyncIterable<Uint8Array>,
      contentType: res.ContentType ?? 'application/octet-stream',
      contentLength: res.ContentLength,
      contentRange: res.ContentRange,
      acceptRanges: res.AcceptRanges,
      etag: res.ETag,
      lastModified: res.LastModified,
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function r2Head(key: string): Promise<{ size: number; contentType: string; etag?: string } | null> {
  try {
    const res = await getR2Client().send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
    return {
      size: res.ContentLength ?? 0,
      contentType: res.ContentType ?? 'application/octet-stream',
      etag: res.ETag,
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
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
