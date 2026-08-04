import assert from 'node:assert/strict';
import { assessBant } from './qualification.js';
import { advanceSpinStage, selectSpinGuidance, type SpinState } from './spin.js';

function buyerTurn(text: string) {
  return { role: 'buyer' as const, text };
}

// Large deal: should progress situation -> problem -> implication (once) -> need_payoff, and stay there.
const largeTurns = [
  buyerTurn('Hi, do you have face masks?'),
  buyerTurn('We are looking for a good quality supplier.'),
  buyerTurn('Can you tell me about your packaging options?'),
  buyerTurn('Our current supplier has slow delivery and we need 2000 pieces regularly.'),
  buyerTurn("Yes, that's been a real problem for our shop."),
  buyerTurn('That would definitely help us a lot.'),
  buyerTurn('Great, what would be the next step?'),
];

let state: SpinState | undefined;
const expectedStages = ['situation', 'situation', 'problem', 'implication', 'need_payoff', 'need_payoff', 'need_payoff'];
for (let i = 0; i < largeTurns.length; i += 1) {
  const turnsSoFar = largeTurns.slice(0, i + 1);
  const bant = assessBant({ turns: turnsSoFar });
  state = advanceSpinStage({ previous: state, turns: turnsSoFar, bant, isNewBuyerTurn: true });
  assert.equal(state.stage, expectedStages[i], `turn ${i + 1} expected ${expectedStages[i]} got ${state.stage}`);
  assert.equal(state.turnIndex, i + 1);
}
assert.equal(state?.dealSizeHint, 'large');
assert.equal(state?.implicationUsed, true);

// Small deal: plateaus at 'problem', never reaches implication/need_payoff.
const smallTurns = [
  buyerTurn('Hi, interested in your hair accessories.'),
  buyerTurn('Just checking out the catalog for now.'),
  buyerTurn('Do you have different colors?'),
  buyerTurn('My current supplier is a bit slow on delivery.'),
  buyerTurn('Still deciding what I need exactly.'),
  buyerTurn('Maybe next month I will order something.'),
];
let smallState: SpinState | undefined;
for (const turn of smallTurns) {
  const turnsSoFar = smallTurns.slice(0, smallTurns.indexOf(turn) + 1);
  const bant = assessBant({ turns: turnsSoFar });
  smallState = advanceSpinStage({ previous: smallState, turns: turnsSoFar, bant, isNewBuyerTurn: true });
}
assert.equal(smallState?.dealSizeHint, 'small');
assert.equal(smallState?.stage, 'problem');
assert.equal(smallState?.implicationUsed, false);

// isNewBuyerTurn: false (e.g. replaying history / seller message) must not advance turnIndex or stage.
const staticBant = assessBant({ turns: [buyerTurn('Hi')] });
const before: SpinState = { stage: 'situation', turnIndex: 2, implicationUsed: false, dealSizeHint: 'unknown', updatedAt: new Date().toISOString() };
const after = advanceSpinStage({ previous: before, turns: [buyerTurn('Hi')], bant: staticBant, isNewBuyerTurn: false });
assert.equal(after.turnIndex, 2);
assert.equal(after.stage, 'situation');

// Localization coverage: every stage must produce non-empty statement+question in all 4 languages.
const stages: SpinState['stage'][] = ['situation', 'problem', 'implication', 'need_payoff'];
const languages = ['中文', 'English', 'Spanish', 'Arabic'];
for (const stage of stages) {
  for (const language of languages) {
    const sample: SpinState = { stage, turnIndex: 1, implicationUsed: false, dealSizeHint: 'unknown', updatedAt: new Date().toISOString() };
    const guidance = selectSpinGuidance(sample, language);
    assert.ok(guidance.statement.length > 0, `${stage}/${language} statement empty`);
    assert.ok(guidance.question.length > 0, `${stage}/${language} question empty`);
    assert.equal(guidance.stage, stage);
    assert.equal((guidance.question.match(/[?？؟]/g) ?? []).length, 1, `${stage}/${language} must ask exactly one question`);
  }
}

// Non-repeating: once a phrasing has been used (present in timeline as a seller message),
// the next call for the same stage should avoid repeating it verbatim when alternatives exist.
const repeatState: SpinState = { stage: 'situation', turnIndex: 1, implicationUsed: false, dealSizeHint: 'unknown', updatedAt: new Date().toISOString() };
const first = selectSpinGuidance(repeatState, 'English');
const timelineWithFirst = [{ actor: 'ai', type: 'msg_out', body: `${first.statement} ${first.question}` }];
const second = selectSpinGuidance(repeatState, 'English', timelineWithFirst);
assert.notEqual(second.question, first.question, 'expected a different question when a prior one was already used');

const needPayoff = selectSpinGuidance({ stage: 'need_payoff', turnIndex: 6, implicationUsed: true, dealSizeHint: 'large', updatedAt: new Date().toISOString() }, 'English');
assert.doesNotMatch(needPayoff.question, /two weeks|certificate|guarantee/i, 'SPIN guidance must not invent delivery or certification capabilities');

console.log('SPIN stage progression passed');
