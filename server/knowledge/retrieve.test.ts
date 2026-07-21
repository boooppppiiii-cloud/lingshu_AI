import assert from 'node:assert/strict';
import { isContextDependentFaqQuestion } from './retrieve.js';

for (const question of ['How much?', 'What about this?', 'Is it available?', '这个呢？', '多少钱？']) {
  assert.equal(isContextDependentFaqQuestion(question), true, `${question} needs conversation context`);
}

for (const question of ['What is the MOQ for custom packaging?', 'Do you provide CE certificates?', '样品运费由谁承担？']) {
  assert.equal(isContextDependentFaqQuestion(question), false, `${question} is self-contained`);
}

console.log('knowledge retrieval policy passed');
