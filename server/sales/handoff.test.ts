import assert from 'node:assert/strict';
import { evaluateHandoff } from './handoff.js';

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

console.log('handoff routing policy passed');
