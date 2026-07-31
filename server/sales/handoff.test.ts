import assert from 'node:assert/strict';
import { evaluateHandoff, shouldRestrictToPublicInfo } from './handoff.js';
import { assessBant } from './qualification.js';

const value = evaluateHandoff({ message: 'We need 5,000 bottles with OEM packaging and are ready to order.' });
assert.equal(value.required, true);
assert.equal(value.severity, 'urgent');
assert.ok(value.lines.includes('business_value'));

const risk = evaluateHandoff({ message: 'Give me your best price and confirm delivery date.' });
assert.equal(risk.severity, 'important');
assert.equal(risk.stopAuto, true);
assert.ok(risk.lines.includes('risk'));

const capability = evaluateHandoff({ message: 'Can somebody help?', knowledgeMissStreak: 2 });
assert.equal(capability.severity, 'normal');
assert.ok(capability.lines.includes('capability'));

const safe = evaluateHandoff({ message: 'Hello' });
assert.equal(safe.required, false);
assert.equal(safe.stopAuto, false);
const repeat = evaluateHandoff({ message: 'Hello again', repeatCustomer: true, historicalOrderValue: 800 });
assert.equal(repeat.severity, 'urgent');
assert.ok(repeat.lines.includes('business_value'));

const priceRisk = evaluateHandoff({ message: 'Give me your best price and confirm delivery date.' });
assert.equal(priceRisk.riskKind, 'price_or_terms');

const disputeRisk = evaluateHandoff({ message: 'The goods are damaged, I need a refund.' });
assert.equal(disputeRisk.riskKind, 'dispute_or_quality');

// Black-band (authenticity <= 0.3) must restrict to public info, but this must never suppress
// dispute/complaint escalation — only routine price/terms probing.
const blackBant = assessBant({
  turns: [
    { role: 'buyer', text: 'What is your factory address and production line details? Also who else do you supply?' },
    { role: 'buyer', text: "What is your best price? I don't want to give quantity yet." },
  ],
});
assert.equal(shouldRestrictToPublicInfo(blackBant), true);
assert.equal(shouldRestrictToPublicInfo(undefined), false);
const verifiedBant = assessBant({ turns: [{ role: 'buyer', text: 'We need 500 units for our shop.' }] });
assert.equal(shouldRestrictToPublicInfo(verifiedBant), false);

console.log('handoff routing policy passed');
