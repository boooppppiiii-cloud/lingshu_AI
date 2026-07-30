import assert from 'node:assert/strict';
import { getBestTimeScores } from './bestTime.js';

const weekdays = Array.from({ length: 7 }, (_, weekday) =>
  getBestTimeScores('test-tenant', 'tiktok', weekday, 4),
);

for (const scores of weekdays) {
  assert.equal(scores.length, 24, 'each weekday should expose 24 hourly scores');
  assert.ok(scores.every(score => score >= 0 && score <= 1), 'scores must stay normalized');
}

const weekdayPeaks = weekdays.map(scores => Math.max(...scores));
assert.ok(new Set(weekdayPeaks).size >= 4, 'weekday peaks should not collapse into a flat tide');
assert.ok(weekdayPeaks[5] > weekdayPeaks[2], 'Friday should be stronger than Tuesday in the platform reference rhythm');

const beijingScores = getBestTimeScores('test-tenant', 'youtube', 6, 8);
const dubaiScores = getBestTimeScores('test-tenant', 'youtube', 6, 4);
assert.notEqual(
  beijingScores.indexOf(Math.max(...beijingScores)),
  dubaiScores.indexOf(Math.max(...dubaiScores)),
  'market UTC offset should move the recommended Beijing-time slot',
);

console.log('publishing best-time rhythm passed');
