import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const STAGING_DIR = path.join(os.tmpdir(), 'lingqi-video-staging');
const MAX_BYTES = 200 * 1024 * 1024;
const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

type StagingMeta = {
  filePath: string;
  mimeType: string;
  createdAt: number;
};

const staging = new Map<string, StagingMeta>();

async function ensureStagingDir() {
  await fs.mkdir(STAGING_DIR, { recursive: true });
}

function metaPath(stagingId: string) {
  return path.join(STAGING_DIR, `${stagingId}.json`);
}

async function writeMeta(stagingId: string, meta: StagingMeta) {
  await fs.writeFile(metaPath(stagingId), JSON.stringify(meta), 'utf8');
}

async function loadMetaFromDisk(stagingId: string): Promise<StagingMeta | null> {
  try {
    const raw = await fs.readFile(metaPath(stagingId), 'utf8');
    const meta = JSON.parse(raw) as StagingMeta;
    // verify the bin file still exists
    await fs.access(meta.filePath);
    return meta;
  } catch {
    return null;
  }
}

function isExpired(meta: StagingMeta) {
  return Date.now() - meta.createdAt > TTL_MS;
}

async function sweepExpired() {
  const now = Date.now();
  for (const [id, meta] of staging) {
    if (now - meta.createdAt > TTL_MS) {
      staging.delete(id);
      void fs.unlink(meta.filePath).catch(() => undefined);
      void fs.unlink(metaPath(id)).catch(() => undefined);
    }
  }
}

export async function createVideoStaging(
  data: Buffer,
  mimeType: string,
): Promise<{ stagingId: string; sizeBytes: number }> {
  if (!data.byteLength) {
    throw new Error('Empty video body');
  }
  if (data.byteLength > MAX_BYTES) {
    throw new Error('Video exceeds 200MB limit');
  }
  await sweepExpired();
  await ensureStagingDir();
  const stagingId = randomUUID();
  const filePath = path.join(STAGING_DIR, `${stagingId}.bin`);
  await fs.writeFile(filePath, data);
  const meta: StagingMeta = { filePath, mimeType, createdAt: Date.now() };
  staging.set(stagingId, meta);
  await writeMeta(stagingId, meta);
  return { stagingId, sizeBytes: data.byteLength };
}

export async function readVideoStagingBase64(stagingId: string): Promise<{
  videoBase64: string;
  mimeType: string;
  sizeBytes: number;
}> {
  let meta = staging.get(stagingId);
  if (!meta) {
    // try to recover from disk (after restart)
    meta = await loadMetaFromDisk(stagingId);
    if (meta) {
      staging.set(stagingId, meta);
    }
  }
  if (!meta || isExpired(meta)) {
    throw new Error('Video staging expired or not found');
  }
  const buf = await fs.readFile(meta.filePath);
  return {
    videoBase64: buf.toString('base64'),
    mimeType: meta.mimeType,
    sizeBytes: buf.byteLength,
  };
}

export async function deleteVideoStaging(stagingId: string | undefined): Promise<void> {
  if (!stagingId) return;
  const meta = staging.get(stagingId);
  staging.delete(stagingId);
  void fs.unlink(metaPath(stagingId)).catch(() => undefined);
  if (!meta) return;
  await fs.unlink(meta.filePath).catch(() => undefined);
}
