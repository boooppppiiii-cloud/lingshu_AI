/**
 * PocketBase-backed file storage.
 *
 * Replaces the R2/S3 dependency for local + self-hosted deploys: video blobs
 * live in a PocketBase file field on their own record, served from PB's disk
 * (not inside the SQLite row). Files attach to an existing record, so the
 * caller must create the record first, then attach.
 *
 * If you later want external object storage (R2/S3) in production, swap these
 * two functions for an implementation against `r2.ts` — callers only use
 * `attachFile` / `fetchFile`.
 */
import { getPbAdminToken, getPbUrl } from './pb.js';

/** Upload a blob into `record[field]`; returns the stored filename (or null). */
export async function attachFile(
  collection: string,
  recordId: string,
  field: string,
  file: { name: string; buf: Buffer; contentType: string },
): Promise<string | null> {
  const token = await getPbAdminToken();
  if (!token) return null;

  const form = new FormData();
  form.append(field, new Blob([file.buf], { type: file.contentType }), file.name);

  // NOTE: do not set Content-Type — fetch derives the multipart boundary.
  const res = await fetch(
    `${getPbUrl()}/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(recordId)}`,
    { method: 'PATCH', headers: { Authorization: token }, body: form },
  );
  if (!res.ok) {
    console.error(`[files] attach ${collection}/${recordId}.${field} failed`, res.status, await res.text().catch(() => ''));
    return null;
  }
  const rec = (await res.json()) as Record<string, unknown>;
  const v = rec[field];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length) return String(v[0]);
  return null;
}

/** Download a stored file as a Buffer. Uses a short-lived PB file token. */
export async function fetchFile(
  collection: string,
  recordId: string,
  filename: string,
): Promise<{ buf: Buffer; contentType: string } | null> {
  const token = await getPbAdminToken();
  if (!token) return null;

  // Protected-collection files require a short-lived file token (query param).
  let fileToken = '';
  const tk = await fetch(`${getPbUrl()}/api/files/token`, {
    method: 'POST',
    headers: { Authorization: token },
  });
  if (tk.ok) fileToken = ((await tk.json()) as { token?: string }).token ?? '';

  const url =
    `${getPbUrl()}/api/files/${encodeURIComponent(collection)}/${encodeURIComponent(recordId)}/${encodeURIComponent(filename)}` +
    (fileToken ? `?token=${fileToken}` : '');
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[files] fetch ${collection}/${recordId}/${filename} failed`, res.status);
    return null;
  }
  return {
    buf: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}
