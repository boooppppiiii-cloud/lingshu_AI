import assert from 'node:assert/strict';
import { assessBant, selectProgressionGoal } from './qualification.js';
import { progressionForStrategy, strategyProgressionCount } from './salesSkill.js';

const first = assessBant({
  turns: [
    { role: 'buyer', text: 'I am the purchasing manager for our clinic chain. We need 5,000 private-label bottles before next month.' },
  ],
});
assert.equal(first.authority.status, 'confirmed');
assert.equal(first.need.status, 'confirmed');
assert.equal(first.timing.status, 'confirmed');
assert.equal(first.budget.status, 'unknown');
assert.equal(first.total, 75);
assert.equal(first.level, 'hot');
const goal = selectProgressionGoal(first, 'English');
assert.equal(goal.dimension, 'budget');
assert.match(goal.question, /unit price|landed cost/i);

const second = assessBant({
  previous: first,
  turns: [{ role: 'buyer', text: 'Our target budget is USD 12,000.' }],
});
assert.equal(second.budget.status, 'confirmed');
assert.equal(second.total, 100);
assert.equal(second.completeness, 4);

const weak = assessBant({ turns: [{ role: 'buyer', text: 'Please send the catalog.' }] });
assert.equal(weak.need.status, 'partial');
assert.equal(selectProgressionGoal(weak, '中文').dimension, 'timing');
assert.equal(strategyProgressionCount(), 15);
for (let index = 1; index <= 15; index += 1) {
  const progression = progressionForStrategy(`S${String(index).padStart(2, '0')}`);
  assert.ok(progression?.goal);
  assert.ok(progression?.indirectQuestion.endsWith('？'));
}

console.log('BANT qualification and progression goals passed');
