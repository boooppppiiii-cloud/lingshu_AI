import assert from 'node:assert/strict';
import { isScheduledPostDue, scheduledRetryDelay } from './scheduledPublisher.js';
import type { PostRecord } from './waLink.js';

const now = Date.parse('2026-07-29T10:00:00.000Z');

function post(status: string, overrides: Partial<PostRecord> = {}, stats: Record<string, unknown> = {}): PostRecord {
  return {
    id: 'post-1',
    tenant_id: 'tenant-1',
    platform: 'youtube',
    published_at: '2026-07-29T09:00:00.000Z',
    track_code: 'V1000',
    stats: { status, publishAttempts: 0, ...stats },
    ...overrides,
  };
}

assert.equal(isScheduledPostDue(post('scheduled'), now), true, 'an overdue scheduled post should run');
assert.equal(
  isScheduledPostDue(post('scheduled', { published_at: '2026-07-29T11:00:00.000Z' }), now),
  false,
  'a future scheduled post must wait',
);
assert.equal(isScheduledPostDue(post(''), now), false, 'legacy posts without an explicit scheduled status must not run');
assert.equal(
  isScheduledPostDue(post('failed', {}, { nextPublishAttemptAt: '2026-07-29T10:01:00.000Z' }), now),
  false,
  'a failed post must wait until its retry time',
);
assert.equal(
  isScheduledPostDue(post('failed', {}, { nextPublishAttemptAt: '2026-07-29T09:59:00.000Z' }), now),
  true,
  'a failed post should retry after the retry time',
);
assert.equal(
  isScheduledPostDue(post('publishing', {}, { lastPublishAttemptAt: '2026-07-29T09:40:00.000Z' }), now),
  true,
  'a stale publishing lock should recover',
);
assert.equal(
  isScheduledPostDue(post('publishing', {}, { lastPublishAttemptAt: '2026-07-29T09:50:00.000Z' }), now),
  false,
  'an active publishing lock must not run twice',
);
assert.equal(isScheduledPostDue(post('failed', {}, { publishAttempts: 3 }), now), false, 'exhausted tasks must stop retrying');

assert.equal(scheduledRetryDelay(1), 60_000);
assert.equal(scheduledRetryDelay(2), 300_000);
assert.equal(scheduledRetryDelay(3), 900_000);
assert.equal(scheduledRetryDelay(99), 900_000);

console.log('scheduledPublisher passed');
