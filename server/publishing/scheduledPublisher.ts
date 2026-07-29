import type { PublishPlatform } from '../lib/publishHistory.js';
import { store } from '../storage/index.js';
import { publishVideoToAccount } from './platformPublisher.js';
import { finalizeTrackedPost, type PostRecord } from './waLink.js';

const POLL_INTERVAL_MS = 30_000;
const STALE_LOCK_MS = 15 * 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;
const SUPPORTED_PLATFORMS = new Set<PublishPlatform>(['youtube', 'tiktok', 'instagram', 'facebook']);

type PublishResult = {
  status: 'published' | 'failed';
  platformPostId?: string;
  publishedAt?: string;
  error?: string;
  failedAt?: string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function statsOf(post: PostRecord): Record<string, unknown> {
  if (post.stats && typeof post.stats === 'object' && !Array.isArray(post.stats)) return post.stats;
  if (typeof post.stats === 'string') {
    try {
      const parsed = JSON.parse(post.stats) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function attemptsOf(stats: Record<string, unknown>): number {
  const attempts = Number(stats.publishAttempts || 0);
  return Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0;
}

export function scheduledRetryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(Math.max(attempt - 1, 0), RETRY_DELAYS_MS.length - 1)];
}

export function isScheduledPostDue(post: PostRecord, now = Date.now()): boolean {
  const stats = statsOf(post);
  const status = text(stats.status);
  const scheduledAt = Date.parse(text(post.published_at));
  if (!Number.isFinite(scheduledAt) || scheduledAt > now || attemptsOf(stats) >= MAX_ATTEMPTS) return false;
  if (status === 'scheduled') return true;
  if (status === 'failed') {
    const retryAt = Date.parse(text(stats.nextPublishAttemptAt));
    return !Number.isFinite(retryAt) || retryAt <= now;
  }
  if (status === 'publishing') {
    const lockedAt = Date.parse(text(stats.lastPublishAttemptAt));
    return Number.isFinite(lockedAt) && lockedAt + STALE_LOCK_MS <= now;
  }
  return false;
}

function resultMap(stats: Record<string, unknown>): Record<string, PublishResult> {
  const value = stats.publishResults;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, PublishResult>) }
    : {};
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return '平台未返回明确错误，请稍后重试';
}

async function markFailed(post: PostRecord, stats: Record<string, unknown>, attempts: number, message: string): Promise<void> {
  const exhausted = attempts >= MAX_ATTEMPTS;
  const results = resultMap(stats);
  const hasSuccess = Object.values(results).some(result => result.status === 'published');
  await store.update('posts', post.id, {
    stats: {
      ...stats,
      status: exhausted ? (hasSuccess ? 'partial' : 'failed') : 'failed',
      publishAttempts: attempts,
      publishError: message,
      warnings: [message],
      nextPublishAttemptAt: exhausted ? '' : new Date(Date.now() + scheduledRetryDelay(attempts)).toISOString(),
    },
  });
}

async function publishScheduledPost(post: PostRecord): Promise<void> {
  const initialStats = statsOf(post);
  const attempts = attemptsOf(initialStats) + 1;
  const attemptStartedAt = new Date().toISOString();
  const lockedStats = {
    ...initialStats,
    status: 'publishing',
    publishAttempts: attempts,
    lastPublishAttemptAt: attemptStartedAt,
    nextPublishAttemptAt: '',
    publishError: '',
    warnings: [],
  };
  await store.update('posts', post.id, { stats: lockedStats });

  const platform = text(post.platform) as PublishPlatform;
  const accountIds = Array.isArray(initialStats.targetAccountIds)
    ? Array.from(new Set(initialStats.targetAccountIds.map(String).map(text).filter(Boolean)))
    : [];
  const accountLabels = Array.isArray(initialStats.targetAccountLabels)
    ? initialStats.targetAccountLabels.map(String).map(text)
    : [];
  const accountLabel = (accountId: string) => accountLabels[accountIds.indexOf(accountId)] || accountId;
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    await markFailed(post, lockedStats, attempts, `暂不支持自动发布到 ${platform || '未知平台'}`);
    return;
  }
  if (!accountIds.length) {
    await markFailed(post, lockedStats, attempts, '排期任务没有可用的发布账号');
    return;
  }
  const videoPath = text(initialStats.videoPath);
  const videoUrl = text(initialStats.videoUrl);
  if (!videoPath && !videoUrl) {
    await markFailed(post, lockedStats, attempts, '排期任务缺少视频文件');
    return;
  }

  const results = resultMap(initialStats);
  for (const accountId of accountIds) {
    if (results[accountId]?.status === 'published') continue;
    try {
      const result = await publishVideoToAccount({
        tenantId: post.tenant_id,
        accountId,
        platform,
        videoPath: videoPath || undefined,
        videoUrl: videoUrl || undefined,
        title: text(post.title) || 'Untitled content',
        description: text(initialStats.description),
        privacyStatus: 'public',
        language: text(initialStats.language),
        contentId: text(post.content_id),
        trackWaLink: initialStats.trackWaLink !== false,
        trackingPost: post,
        finalizeTracking: false,
      });
      results[accountId] = {
        status: 'published',
        platformPostId: result.platformPostId,
        publishedAt: new Date().toISOString(),
      };
    } catch (error) {
      results[accountId] = {
        status: 'failed',
        error: errorMessage(error),
        failedAt: new Date().toISOString(),
      };
    }
    await store.update('posts', post.id, { stats: { ...lockedStats, publishResults: results } });
  }

  const failures = accountIds.filter(accountId => results[accountId]?.status !== 'published');
  if (failures.length) {
    const message = failures
      .map(accountId => `${accountLabel(accountId)}: ${results[accountId]?.error || '发布失败'}`)
      .join('；');
    await markFailed(post, { ...lockedStats, publishResults: results }, attempts, message);
    return;
  }

  const firstPlatformPostId = accountIds.map(accountId => text(results[accountId]?.platformPostId)).find(Boolean) || '';
  await finalizeTrackedPost(post.id, {
    platformPostId: firstPlatformPostId,
    title: text(post.title),
    stats: {
      ...lockedStats,
      status: 'published',
      publishResults: results,
      publishedAt: new Date().toISOString(),
      publishError: '',
      nextPublishAttemptAt: '',
      warnings: [],
    },
  });
}

let cycleRunning = false;

export async function runScheduledPublishingCycle(now = Date.now()): Promise<number> {
  if (cycleRunning) return 0;
  cycleRunning = true;
  try {
    const result = await store.list<PostRecord>('posts', { perPage: 500, sort: 'published_at' });
    const duePosts = result.items.filter(post => isScheduledPostDue(post, now)).slice(0, 20);
    for (const post of duePosts) {
      try {
        await publishScheduledPost(post);
      } catch (error) {
        const stats = statsOf(post);
        const attempts = Math.max(attemptsOf(stats) + 1, 1);
        await markFailed(post, stats, attempts, errorMessage(error)).catch(() => undefined);
        console.error(`[publishing-worker] post ${post.id} failed:`, error);
      }
    }
    return duePosts.length;
  } finally {
    cycleRunning = false;
  }
}

export function initScheduledPublisher(): void {
  if (process.env.PUBLISH_SCHEDULER_ENABLED === 'false') {
    console.log('[publishing-worker] disabled');
    return;
  }
  const run = () => void runScheduledPublishingCycle().catch(error => {
    console.error('[publishing-worker] cycle failed:', error);
  });
  const initial = setTimeout(run, 5_000);
  initial.unref?.();
  const timer = setInterval(run, POLL_INTERVAL_MS);
  timer.unref?.();
  console.log(`[publishing-worker] enabled; polling every ${POLL_INTERVAL_MS / 1000}s`);
}
