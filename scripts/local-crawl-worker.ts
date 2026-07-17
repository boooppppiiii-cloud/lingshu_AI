import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { crawlVideosForTenant } from '../server/routes/videos.js';
import type { Platform } from '../server/types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

type CrawlJob = {
  id: string;
  tenantId: string;
  platform: Platform;
  mode: 'keyword' | 'account';
  keyword?: string;
  accountUrl?: string;
  accountName?: string;
  limit?: number;
};

const SERVER_URL = (process.env.CRAWL_WORKER_SERVER_URL || process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:8790').replace(/\/+$/, '');
const WORKER_TOKEN = process.env.CRAWL_WORKER_TOKEN || (process.env.NODE_ENV === 'production' ? '' : 'lingshu-local-crawl-worker-token');
const WORKER_ID = process.env.CRAWL_WORKER_ID || `mac-${process.env.USER || 'worker'}`;
const POLL_MS = Math.max(5_000, Number(process.env.CRAWL_WORKER_POLL_MS || 15_000));
const RUN_ONCE = process.env.CRAWL_WORKER_ONCE === '1';
let stopped = false;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function workerHeaders(): Record<string, string> {
  if (!WORKER_TOKEN) throw new Error('CRAWL_WORKER_TOKEN is required');
  return {
    'Content-Type': 'application/json',
    'x-crawl-worker-token': WORKER_TOKEN,
    'x-crawl-worker-id': WORKER_ID,
  };
}

async function api<T>(pathName: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SERVER_URL}${pathName}`, {
    ...init,
    headers: {
      ...workerHeaders(),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(String(json.error || json.message || res.statusText));
  }
  return json as T;
}

async function nextJob(): Promise<CrawlJob | null> {
  const data = await api<{ job: CrawlJob | null }>(`/api/overseas/crawl-worker/next?workerId=${encodeURIComponent(WORKER_ID)}`);
  return data.job;
}

async function completeJob(jobId: string, payload: Record<string, unknown>): Promise<void> {
  await api(`/api/overseas/crawl-worker/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function runJob(job: CrawlJob): Promise<void> {
  const started = Date.now();
  console.log(`[crawl-worker] running ${job.id} ${job.platform} ${job.mode}`);
  try {
    const result = await crawlVideosForTenant({
      tenantId: job.tenantId,
      platform: job.platform,
      mode: job.mode,
      keyword: job.keyword || '',
      accountUrl: job.accountUrl || '',
      accountName: job.accountName || '',
      limit: job.limit || 10,
    });
    await completeJob(job.id, {
      ok: true,
      result: {
        platform: result.platform,
        requested: result.requested,
        imported: result.imported,
        refreshed: result.refreshed,
        skipped: result.skipped,
        skippedExisting: result.skippedExisting,
        returnedExisting: result.returnedExisting,
        total: result.total,
        source: result.source,
        message: result.message,
        elapsedMs: Date.now() - started,
      },
    });
    console.log(`[crawl-worker] done ${job.id}: ${result.message}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await completeJob(job.id, { ok: false, error: message });
    console.warn(`[crawl-worker] failed ${job.id}: ${message}`);
  }
}

async function main(): Promise<void> {
  console.log(`[crawl-worker] ${WORKER_ID} polling ${SERVER_URL} every ${POLL_MS}ms`);
  console.log('[crawl-worker] platforms: YouTube/TikTok local cookies; FB/IG should stay on Apify server path');
  process.on('SIGINT', () => { stopped = true; });
  process.on('SIGTERM', () => { stopped = true; });
  while (!stopped) {
    try {
      const job = await nextJob();
      if (job) {
        await runJob(job);
        if (RUN_ONCE) stopped = true;
      } else {
        if (RUN_ONCE) stopped = true;
        await sleep(POLL_MS);
      }
    } catch (error) {
      console.warn('[crawl-worker] poll failed:', error instanceof Error ? error.message : error);
      await sleep(POLL_MS);
    }
  }
  console.log('[crawl-worker] stopped');
  if (RUN_ONCE) process.exit(0);
}

void main();
