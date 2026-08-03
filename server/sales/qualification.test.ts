import assert from 'node:assert/strict';
import { assessBant, selectProgressionGoal } from './qualification.js';

const highValue = assessBant({
  turns: [
    { role: 'buyer', text: 'I am the purchasing manager for our clinic chain. We need 5,000 private-label bottles before next month.' },
  ],
});
assert.equal(highValue.budget.score, 20);
assert.equal(highValue.authority.score, 25);
assert.equal(highValue.need.score, 25);
assert.equal(highValue.timing.score, 22);
assert.equal(highValue.total, 92);
assert.equal(highValue.level, 'hot');
assert.equal(selectProgressionGoal(highValue, 'English').dimension, 'budget');

const budgetCompleted = assessBant({
  previous: highValue,
  turns: [{ role: 'buyer', text: 'Our target budget is USD 12,000 and we also want wholesale tiers.' }],
});
assert.equal(budgetCompleted.budget.score, 25, 'new signals must add to prior-turn signals without double counting');
assert.equal(budgetCompleted.completeness, 4);

const budgetSignals = assessBant({
  turns: [
    { role: 'buyer', text: 'We currently buy from another supplier. We need 1,000 pcs and our target price is USD 2.50. Do you have wholesale pricing?' },
  ],
});
assert.equal(budgetSignals.budget.score, 25);
assert.ok(budgetSignals.budget.evidence.some(item => item.includes('1000') || item.includes('500')));
assert.ok(budgetSignals.budget.evidence.every(item => /[+-]\d+$/.test(item)), 'evidence must explain the points instead of echoing raw buyer text');

const needSignals = assessBant({
  turns: [{ role: 'buyer', text: 'I need the collagen serum in a 30ml bottle for clinics in the Dubai market.' }],
});
assert.equal(needSignals.need.score, 25);
assert.equal(needSignals.need.status, 'confirmed');

const weak = assessBant({ turns: [{ role: 'buyer', text: 'Please send the catalog.' }] });
assert.equal(weak.need.score, 3);
assert.equal(weak.need.status, 'partial');
assert.equal(selectProgressionGoal(weak, '中文').dimension, 'timing');

const later = assessBant({ turns: [{ role: 'buyer', text: 'Maybe next year. I am only comparing suppliers now.' }] });
assert.equal(later.timing.score, 9);

const redFlagged = assessBant({
  turns: [
    { role: 'buyer', text: 'What is your best price for private label?' },
    { role: 'buyer', text: 'Please send the full price list for everything.' },
  ],
});
assert.equal(redFlagged.authenticity.redFlags.length, 2);
assert.equal(redFlagged.authenticity.score, 0.5);
assert.ok(redFlagged.total < redFlagged.rawTotal);

const blackBanded = assessBant({
  turns: [
    { role: 'buyer', text: 'What is your factory address and production line details? Who else do you supply?' },
    { role: 'buyer', text: 'What is your lowest price?' },
    { role: 'buyer', text: 'Price? Just the best price.' },
  ],
});
assert.equal(blackBanded.authenticity.redFlags.length, 3);
assert.equal(blackBanded.authenticity.score, 0.2);
assert.equal(blackBanded.band, 'black');
assert.ok(blackBanded.authenticity.redFlags.every(flag => flag.startsWith('信息待核实')));

const recovered = assessBant({
  previous: redFlagged,
  turns: [
    { role: 'buyer', text: 'We are a skincare retail chain. Our website is ourbrand.com. Can you explain shipping and payment terms?' },
  ],
});
assert.equal(recovered.authenticity.redFlags.length, 2);
assert.equal(recovered.authenticity.greenFlags.length, 3);
assert.equal(recovered.authenticity.score, 0.8);

const suspiciousPayment = assessBant({
  turns: [{ role: 'buyer', text: 'Ship 10,000 pcs first and I will pay after delivery.' }],
});
assert.ok(suspiciousPayment.authenticity.redFlags.some(flag => flag.includes('异常大单')));

const actionImpacts = assessBant({
  turns: [{ role: 'buyer', text: 'Please prepare a proforma invoice. I also want a sample.' }],
});
assert.equal(actionImpacts.authority.score, 10);
assert.equal(actionImpacts.need.score, 10);
assert.equal(actionImpacts.timing.score, 25);

console.log('BANT additive scoring, evidence and authenticity passed');
