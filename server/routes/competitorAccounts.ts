import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import type { Platform } from '../types/index.js';
import {
  crawlVideosForTenant,
  looksLikeAccountUrl,
  accountLabelFromUrl,
  inferPlatformFromUrl,
} from './videos.js';
import { createCrawlWorkerJob } from './crawlWorker.js';

export const competitorAccountsRouter = Router();
competitorAccountsRouter.use(requireAuth);

const COL = 'competitor_accounts';
const SUPPORTED: Platform[] = ['youtube', 'tiktok', 'instagram', 'facebook'];

interface AccountRecord {
  id: string;
  tenantId: string;
  platform: Platform;
  accountUrl: string;
  accountName: string;
  handle: string;
  avatarUrl?: string;
  note?: string;
  lastCrawledAt?: string;
  lastCrawlCount?: number;
  createdAt?: string;
}

function toClient(record: AccountRecord) {
  return {
    id: record.id,
    platform: record.platform,
    accountUrl: record.accountUrl,
    accountName: record.accountName || accountLabelFromUrl(record.accountUrl),
    handle: record.handle || '',
    avatarUrl: record.avatarUrl || '',
    note: record.note || '',
    lastCrawledAt: record.lastCrawledAt || '',
    lastCrawlCount: Number(record.lastCrawlCount || 0),
    createdAt: record.createdAt || '',
  };
}

// ─── GET /competitor-accounts ────────────────────────────────────────────────
competitorAccountsRouter.get('/', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<AccountRecord>(COL, {
    where: { tenantId },
    sort: '-createdAt',
    page: 1,
    perPage: 200,
  });
  res.json({ items: result.items.map(toClient) });
});

// ─── POST /competitor-accounts ───────────────────────────────────────────────
// Body: { url: string, platform?: 'youtube' | 'tiktok' | 'instagram' | 'facebook', accountName?: string, note?: string }
competitorAccountsRouter.post('/', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { url = '', accountName = '', note = '' } = req.body as {
    url?: string; platform?: Platform; accountName?: string; note?: string;
  };
  const trimmed = String(url || '').trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    res.status(400).json({ error: '请填写以 http(s):// 开头的账号主页链接' });
    return;
  }

  const bodyPlatform = (req.body as { platform?: string })?.platform;
  const platform: Platform = bodyPlatform && SUPPORTED.includes(bodyPlatform as Platform)
    ? (bodyPlatform as Platform)
    : inferPlatformFromUrl(trimmed);
  if (!SUPPORTED.includes(platform)) {
    res.status(400).json({ error: '当前支持 YouTube、TikTok、Instagram、Facebook 对标账号主页' });
    return;
  }
  if (!looksLikeAccountUrl(trimmed, platform)) {
    res.status(400).json({ error: '这看起来不是账号主页链接（例如 YouTube @handle、TikTok @user、Instagram username 或 Facebook Page 主页）' });
    return;
  }

  // 同租户按 URL 去重
  const existing = await store.list<AccountRecord>(COL, {
    where: { tenantId, accountUrl: trimmed },
    page: 1,
    perPage: 1,
  });
  if (existing.items[0]) {
    res.json({ item: toClient(existing.items[0]), duplicated: true });
    return;
  }

  const label = String(accountName || '').trim() || accountLabelFromUrl(trimmed);
  const record = await store.create<AccountRecord>(COL, {
    tenantId,
    platform,
    accountUrl: trimmed,
    accountName: label,
    handle: accountLabelFromUrl(trimmed),
    note: String(note || '').trim(),
    lastCrawledAt: '',
    lastCrawlCount: 0,
    createdAt: new Date().toISOString(),
  });
  if (!record) {
    res.status(500).json({ error: '保存对标账号失败' });
    return;
  }
  res.json({ item: toClient(record) });
});

// ─── DELETE /competitor-accounts/:id ─────────────────────────────────────────
competitorAccountsRouter.delete('/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById<AccountRecord>(COL, req.params.id);
  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await store.delete(COL, req.params.id);
  res.json({ ok: true });
});

// ─── POST /competitor-accounts/:id/crawl ─────────────────────────────────────
// Body: { limit?: number }  → 采集该账号主页最新视频，复用灵感大屏采集/分析管线
competitorAccountsRouter.post('/:id/crawl', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const record = await store.getById<AccountRecord>(COL, req.params.id);
  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const limit = Math.min(30, Math.max(1, Number((req.body as { limit?: number })?.limit) || 10));

  try {
    if (record.platform === 'youtube' || record.platform === 'tiktok') {
      const job = await createCrawlWorkerJob({
        tenantId,
        requestedBy: userId,
        platform: record.platform,
        mode: 'account',
        accountUrl: record.accountUrl,
        accountName: record.accountName || accountLabelFromUrl(record.accountUrl),
        limit,
      });
      if (!job) {
        res.status(500).json({ error: '本地采集任务创建失败' });
        return;
      }
      res.status(202).json({
        queued: true,
        jobId: job.id,
        platform: record.platform,
        requested: limit,
        imported: 0,
        refreshed: 0,
        skipped: 0,
        skippedExisting: 0,
        returnedExisting: 0,
        total: 0,
        source: 'mac-local-worker',
        message: '已提交到 Mac 本地采集队列，worker 会用我们的采集账号执行，不使用客户账号。',
        items: [],
      });
      return;
    }

    const result = await crawlVideosForTenant({
      tenantId,
      platform: record.platform,
      mode: 'account',
      accountUrl: record.accountUrl,
      accountName: record.accountName || accountLabelFromUrl(record.accountUrl),
      limit,
    });
    await store.update(COL, record.id, {
      lastCrawledAt: new Date().toISOString(),
      lastCrawlCount: result.imported,
    });
    res.json(result);
  } catch (e) {
    console.error('[competitor-accounts] crawl failed:', e);
    res.status(502).json({ error: e instanceof Error ? e.message : '对标账号采集失败' });
  }
});
