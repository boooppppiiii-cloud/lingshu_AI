import assert from 'node:assert/strict';
import {
  buildStrategyPromptBlock,
  rankResponseStrategies,
  responseStrategyLibrary,
  type RetrievedStrategy,
} from './strategyRetrieve.js';

const library = responseStrategyLibrary();
assert.equal(library.length, 57, 'the strategy library must contain 42 document actions plus 15 compatible legacy strategies');
assert.equal(new Set(library.map(item => item.id)).size, 57, 'strategy IDs must be unique');

const cases: Array<{ message: string; expected: string }> = [
  { message: 'Your price is too high. Can you make it cheaper?', expected: 'C02' },
  { message: 'Another supplier offers a much lower price.', expected: 'C03' },
  { message: 'How much is it?', expected: 'C01' },
  { message: 'Can you do OEM private label for us?', expected: 'H01' },
  { message: 'The goods are damaged. I need a refund.', expected: 'K03' },
  { message: 'Can your manager call me tomorrow?', expected: 'L01' },
];

for (const item of cases) {
  const ranked = rankResponseStrategies({ latestMessage: item.message });
  assert.equal(ranked[0]?.strategy.id, item.expected, `wrong top strategy for: ${item.message}`);
}

const strategy = library.find(item => item.id === 'C02');
assert.ok(strategy);
const prompt = buildStrategyPromptBlock([{
  strategy,
  confidence: 0.93,
  reason: '客户明确表示价格太高',
  method: 'semantic',
  learnedAdjustment: '先确认比较对象，再解释可验证的差异。',
  learnedEvidenceCount: 8,
} satisfies RetrievedStrategy]);
assert.match(prompt, /enterprise knowledge > response strategy > seller style memory/);
assert.match(prompt, /dialogue tactics, not business facts/);
assert.match(prompt, /already gave that answer/i);
assert.match(prompt, /Never copy numbers or company claims/);
assert.match(prompt, /Ask at most one question/);
assert.match(prompt, /BANT impact|Progression goal/);
assert.match(prompt, /8 real edited replies/);

console.log('strategy retrieval policy tests passed');
