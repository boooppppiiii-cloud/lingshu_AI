import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import type { Platform } from '../types/index.js';

export const crawlWorkerRouter = Router();

const COL = 'crawl_jobs';
const WORKER_TOKEN_HEADER = 'x-crawl-worker-token';
const WORKER_LEASE_MS = 10 * 60 * 1000;

type CrawlJobStatus = 'queued' | 'running' | 'done' | 'failed';
type CrawlJobMode = 'keyword' | 'account';

interface CrawlJob {
  id: string;
  tenantId: string;
  requestedBy: string;
  platform: Platform;
  mode: CrawlJobMode;
  keyword: string;
  accountUrl: string;
  accountName: string;
  limit: number;
  status: CrawlJobStatus;
  workerId: string;
  attempts: number;
  resultJson: string;
  error: string;
  createdAt: string;
  updatedAt: string;
  leasedUntil: string;
  finishedAt: string;
}

export type CreateCrawlWorkerJobInput = {
  tenantId: string;
  requestedBy: string;
  platform: Platform;
  mode: CrawlJobMode;
  keyword?: string;
  accountUrl?: string;
  accountName?: string;
  limit?: number;
};

function workerToken(): string {
  return process.env.CRAWL_WORKER_TOKEN || (process.env.NODE_ENV === 'production' ? '' : 'lingshu-local-crawl-worker-token');
}

function requireWorker(req: Parameters<Router['get']>[1] extends (...args: infer P) => unknown ? P[0] : never, res: any): boolean {
  const expected = workerToken();
  const actual = String(req.headers[WORKER_TOKEN_HEADER] || req.headers.authorization?.replace(/^Bearer\s+/i, '') || '');
  if (!expected || actual !== expected) {
    res.status(401).json({ error: 'worker_unauthorized' });
    return false;
  }
  return true;
}

function publicJob(job: CrawlJob) {
  return {
    id: job.id,
    tenantId: job.tenantId,
    platform: job.platform,
    mode: job.mode,
    keyword: job.keyword,
    accountUrl: job.accountUrl,
    accountName: job.accountName,
    limit: Number(job.limit || 0),
    status: job.status,
    workerId: job.workerId || '',
    attempts: Number(job.attempts || 0),
    result: parseJson(job.resultJson),
    error: job.error || '',
    createdAt: job.createdAt || '',
    updatedAt: job.updatedAt || '',
    leasedUntil: job.leasedUntil || '',
    finishedAt: job.finishedAt || '',
  };
}

function parseJson(value: string): unknown {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function isLeaseExpired(job: CrawlJob): boolean {
  const leasedUntil = Date.parse(job.leasedUntil || '');
  return !Number.isFinite(leasedUntil) || leasedUntil <= Date.now();
}

function supportedWorkerPlatform(platform: string): platform is Platform {
  return platform === 'youtube' || platform === 'tiktok';
}

export async function createCrawlWorkerJob(input: CreateCrawlWorkerJobInput): Promise<CrawlJob | null> {
  const createdAt = nowIso();
  return store.create<CrawlJob>(COL, {
    tenantId: input.tenantId,
    requestedBy: input.requestedBy,
    platform: input.platform,
    mode: input.mode,
    keyword: String(input.keyword || '').trim(),
    accountUrl: String(input.accountUrl || '').trim(),
    accountName: String(input.accountName || '').trim(),
    limit: Math.min(30, Math.max(1, Number(input.limit) || 10)),
    status: 'queued',
    workerId: '',
    attempts: 0,
    resultJson: '',
    error: '',
    createdAt,
    updatedAt: createdAt,
    leasedUntil: '',
    finishedAt: '',
  });
}

crawlWorkerRouter.post('/jobs', requireAuth, async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const platform = String(req.body?.platform || '');
  if (!supportedWorkerPlatform(platform)) {
    res.status(400).json({ error: 'local_worker_only_supports_youtube_tiktok' });
    return;
  }

  const mode = req.body?.mode === 'account' ? 'account' : 'keyword';
  const keyword = String(req.body?.keyword || '').trim();
  const accountUrl = String(req.body?.accountUrl || '').trim();
  if (mode === 'account' && !accountUrl) {
    res.status(400).json({ error: 'accountUrl_required' });
    return;
  }
  if (mode === 'keyword' && !keyword) {
    res.status(400).json({ error: 'keyword_required' });
    return;
  }

  const job = await createCrawlWorkerJob({
    tenantId,
    requestedBy: userId,
    platform,
    mode,
    keyword,
    accountUrl,
    accountName: String(req.body?.accountName || '').trim(),
    limit: Math.min(30, Math.max(1, Number(req.body?.limit) || 10)),
  });

  if (!job) {
    res.status(500).json({ error: 'job_create_failed' });
    return;
  }
  res.status(201).json({ job: publicJob(job) });
});

crawlWorkerRouter.get('/jobs', requireAuth, async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<CrawlJob>(COL, {
    where: { tenantId },
    sort: '-createdAt',
    page: 1,
    perPage: 50,
  });
  res.json({ items: result.items.map(publicJob) });
});

crawlWorkerRouter.get('/next', async (req, res) => {
  if (!requireWorker(req as any, res)) return;
  const workerId = String(req.query.workerId || req.headers['x-crawl-worker-id'] || 'mac-worker').slice(0, 80);
  const result = await store.list<CrawlJob>(COL, {
    sort: 'createdAt',
    page: 1,
    perPage: 100,
  });
  const job = result.items.find(item => item.status === 'queued' || (item.status === 'running' && isLeaseExpired(item)));
  if (!job) {
    res.json({ job: null });
    return;
  }
  const updatedAt = nowIso();
  const leasedUntil = new Date(Date.now() + WORKER_LEASE_MS).toISOString();
  await store.update(COL, job.id, {
    status: 'running',
    workerId,
    attempts: Number(job.attempts || 0) + 1,
    updatedAt,
    leasedUntil,
    error: '',
  });
  res.json({
    job: publicJob({
      ...job,
      status: 'running',
      workerId,
      attempts: Number(job.attempts || 0) + 1,
      updatedAt,
      leasedUntil,
      error: '',
    }),
  });
});

crawlWorkerRouter.post('/jobs/:id/heartbeat', async (req, res) => {
  if (!requireWorker(req as any, res)) return;
  const job = await store.getById<CrawlJob>(COL, req.params.id);
  if (!job) {
    res.status(404).json({ error: 'job_not_found' });
    return;
  }
  const leasedUntil = new Date(Date.now() + WORKER_LEASE_MS).toISOString();
  await store.update(COL, job.id, { leasedUntil, updatedAt: nowIso() });
  res.json({ ok: true, leasedUntil });
});

crawlWorkerRouter.post('/jobs/:id/complete', async (req, res) => {
  if (!requireWorker(req as any, res)) return;
  const job = await store.getById<CrawlJob>(COL, req.params.id);
  if (!job) {
    res.status(404).json({ error: 'job_not_found' });
    return;
  }
  const ok = req.body?.ok !== false && !req.body?.error;
  const finishedAt = nowIso();
  await store.update(COL, job.id, {
    status: ok ? 'done' : 'failed',
    resultJson: JSON.stringify(req.body?.result || null),
    error: ok ? '' : String(req.body?.error || 'worker_failed').slice(0, 1000),
    updatedAt: finishedAt,
    finishedAt,
    leasedUntil: '',
  });
  res.json({ ok: true, status: ok ? 'done' : 'failed' });
});
