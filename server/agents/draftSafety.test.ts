import assert from 'node:assert/strict';
import {
  draftFactualRiskSignals,
  hasInternalPromptLeak,
  requiresFactualVerification,
  unsupportedDraftNumbers,
  unsupportedHighRiskClaims,
} from './draftSafety.js';

const evidence = JSON.stringify({ buyerMessage: 'We need 500 pieces of model A12.' });

assert.deepEqual(unsupportedDraftNumbers('Got it — 500 pieces of A12.', evidence), []);
assert.deepEqual(unsupportedDraftNumbers('The MOQ is 1000 pieces.', evidence), ['1000']);
assert.deepEqual(unsupportedDraftNumbers('Got it — 50 pieces.', evidence), ['50']);
assert.equal(draftFactualRiskSignals('Great to hear from you again! How is the project going?', evidence).length, 0);
assert.equal(draftFactualRiskSignals("Don't worry—we can figure this out together.", evidence).length, 0);
assert.ok(draftFactualRiskSignals('This model is in stock and we can ship it tomorrow.', evidence).length >= 1);
assert.ok(draftFactualRiskSignals('We can customize the packaging for you.', evidence).includes('company capability commitment'));
assert.ok(draftFactualRiskSignals('Made from ABS, and the size is 20 cm.', evidence).includes('product attribute claim'));
assert.ok(draftFactualRiskSignals('Your order is on the way.', evidence).includes('order or logistics status claim'));
assert.ok(draftFactualRiskSignals('You mentioned that you preferred the black version.', evidence).includes('claimed conversation memory'));
assert.ok(draftFactualRiskSignals('Podemos entregar el pedido esta semana.', evidence).length >= 1);
assert.ok(draftFactualRiskSignals('هذا المنتج متوفر ويمكننا الشحن غدًا.', evidence).length >= 1);
assert.equal(requiresFactualVerification([], false), false);
assert.equal(requiresFactualVerification([], true), true);
assert.equal(requiresFactualVerification(['product attribute claim'], false), true);
const riskySessionDraft = 'We can send full lab reports and COA, and arrange third-party inspection at no extra charge.';
assert.ok(unsupportedHighRiskClaims(riskySessionDraft, '{}').includes('quality document promise is not grounded'));
assert.ok(unsupportedHighRiskClaims(riskySessionDraft, '{}').includes('free inspection promise is not grounded'));
assert.deepEqual(unsupportedHighRiskClaims('Tell me if you need GMP, ISO or COA and I will ask our team to verify.', '{}'), []);
assert.ok(unsupportedHighRiskClaims('I’ll get back to you by end of day today.', '{}').includes('deadline promise is not grounded'));
const roundTwoDraft = 'We’re a factory + trading company. We can send full lab reports and COA, and arrange a third-party inspection before shipment at no extra charge.';
assert.ok(unsupportedHighRiskClaims(roundTwoDraft, '{}').includes('company identity claim is not grounded'));
assert.ok(unsupportedHighRiskClaims(roundTwoDraft, '{}').includes('quality document promise is not grounded'));
assert.ok(unsupportedHighRiskClaims(roundTwoDraft, '{}').includes('free inspection promise is not grounded'));
const roundFiveDraft = 'We support Arabic + English packaging and we can provide GMP and ISO documents from accredited bodies.';
assert.ok(unsupportedHighRiskClaims(roundFiveDraft, '{}').includes('bilingual or Arabic packaging capability is not grounded'));
assert.ok(unsupportedHighRiskClaims(roundFiveDraft, '{}').includes('quality document promise is not grounded'));
assert.ok(unsupportedHighRiskClaims(roundFiveDraft, '{}').includes('certification validity claim is not grounded'));
assert.equal(hasInternalPromptLeak('Intent instruction: return one directly-sendable reply only.'), true);
assert.equal(hasInternalPromptLeak('Tell me the quantity you need and I’ll check it.'), false);

console.log('draft factual safety policy passed');
