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
assert.equal(strategyProgressionCount(), 26);
for (let index = 1; index <= 15; index += 1) {
  const progression = progressionForStrategy(`S${String(index).padStart(2, '0')}`);
  assert.ok(progression?.goal);
  assert.ok(progression?.indirectQuestion.endsWith('？'));
}

// Clean fixtures (no red/green flag patterns hit) must keep authenticity neutral at 1.0.
assert.equal(first.authenticity.score, 1);
assert.equal(first.authenticity.band, 'verified');
assert.deepEqual(first.authenticity.redFlags, []);
assert.equal(first.rawTotal, first.total);

// Two red-flag categories (price-only-no-quantity + full-price-list) should halve the multiplier
// and pull `total` below `rawTotal`, even though the raw BANT dimensions did not decrease.
const redFlagged = assessBant({
  turns: [
    { role: 'buyer', text: 'What is your best price for private label?' },
    { role: 'buyer', text: "Just send me the full price list for everything, I don't want to say how many I need." },
  ],
});
assert.equal(redFlagged.rawTotal, 25);
assert.equal(redFlagged.authenticity.score, 0.5);
assert.equal(redFlagged.authenticity.band, 'reduced');
assert.equal(redFlagged.authenticity.redFlags.length, 2);
assert.equal(redFlagged.total, 13);
assert.ok(redFlagged.total < redFlagged.rawTotal);

// Three red-flag categories must drop the multiplier to 0.2 and force the black "suspected
// scraping" band regardless of the raw score, per the design doc's price-scraping guard.
const blackBanded = assessBant({
  turns: [
    { role: 'buyer', text: 'What is your factory address and production line details? Also who else do you supply?' },
    { role: 'buyer', text: "What is your best price? I don't want to give quantity yet." },
  ],
});
assert.equal(blackBanded.authenticity.score, 0.2);
assert.equal(blackBanded.authenticity.band, 'suspected_scraping');
assert.equal(blackBanded.band, 'black');
assert.ok(blackBanded.authenticity.redFlags.every(flag => flag.startsWith('信息待核实')));

// Green flags accumulate across turns and can partially recover the multiplier (never past 1.0),
// without erasing the red flags already recorded.
const recovered = assessBant({
  previous: redFlagged,
  turns: [
    { role: 'buyer', text: 'We are a skincare retail chain. Check our website: ourbrand.com. Can you tell me about shipping and payment terms?' },
  ],
});
assert.equal(recovered.authenticity.redFlags.length, 2);
assert.equal(recovered.authenticity.greenFlags.length, 3);
assert.equal(recovered.authenticity.score, 0.8);

console.log('BANT qualification and progression goals passed');
