import assert from 'node:assert/strict';
import { moveScheduleToDay, resolvePendingDrop } from '../../src/components/publishing/schedulePolicy';

const now = new Date(2026, 7, 3, 12, 0, 0, 0);
const droppedDay = new Date(2026, 7, 8, 0, 0, 0, 0);

const immediate = resolvePendingDrop({ deliveryMode: 'now' }, droppedDay, '', now);
assert.deepEqual(immediate, {
  kind: 'blocked',
  message: '立即发布内容不会进入日历；如需排期，请先改为“时间待定”或“定点排期”。',
});

assert.deepEqual(resolvePendingDrop({ deliveryMode: 'flexible' }, droppedDay, '', now), { kind: 'needs-time' });

const flexible = resolvePendingDrop({ deliveryMode: 'flexible' }, droppedDay, '16:30', now);
assert.equal(flexible.kind, 'ready');
if (flexible.kind === 'ready') {
  assert.equal(flexible.locked, false);
  assert.equal(flexible.scheduledAt.getFullYear(), 2026);
  assert.equal(flexible.scheduledAt.getMonth(), 7);
  assert.equal(flexible.scheduledAt.getDate(), 8);
  assert.equal(flexible.scheduledAt.getHours(), 16);
  assert.equal(flexible.scheduledAt.getMinutes(), 30);
}

const fixedTime = new Date(2026, 7, 15, 9, 45, 0, 0);
const fixed = resolvePendingDrop({ deliveryMode: 'schedule', scheduledAt: fixedTime.toISOString() }, droppedDay, '22:00', now);
assert.equal(fixed.kind, 'ready');
if (fixed.kind === 'ready') {
  assert.equal(fixed.locked, true);
  assert.equal(fixed.scheduledAt.getTime(), fixedTime.getTime(), 'fixed schedule must ignore the drop day and selected time');
}

const moved = moveScheduleToDay(new Date(2026, 7, 9, 18, 20), new Date(2026, 7, 12));
assert.ok(moved);
assert.equal(moved?.getDate(), 12);
assert.equal(moved?.getHours(), 18);
assert.equal(moved?.getMinutes(), 20, 'flexible rescheduling must preserve the selected time');

console.log('schedule policy tests passed');
