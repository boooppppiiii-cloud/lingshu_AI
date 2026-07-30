import assert from 'node:assert/strict';
import type { EnterpriseProfile } from '../routes/enterprise.js';
import { enterpriseKnowledgeReady, isContextDependentFaqQuestion, isSafeWithoutEnterpriseKnowledge } from './retrieve.js';

for (const question of ['How much?', 'What about this?', 'Is it available?', '这个呢？', '多少钱？']) {
  assert.equal(isContextDependentFaqQuestion(question), true, `${question} needs conversation context`);
}

for (const question of ['What is the MOQ for custom packaging?', 'Do you provide CE certificates?', '样品运费由谁承担？']) {
  assert.equal(isContextDependentFaqQuestion(question), false, `${question} is self-contained`);
}

assert.equal(enterpriseKnowledgeReady({} as EnterpriseProfile), false);
assert.equal(enterpriseKnowledgeReady({
  company: { description: 'We make travel organizers for overseas retailers.' },
} as EnterpriseProfile), true);
assert.equal(isSafeWithoutEnterpriseKnowledge('hi'), true);
assert.equal(isSafeWithoutEnterpriseKnowledge('thanks!'), true);
assert.equal(isSafeWithoutEnterpriseKnowledge('Where is my tracking number?'), false);
assert.equal(isSafeWithoutEnterpriseKnowledge('Please send the invoice.'), false);
assert.equal(enterpriseKnowledgeReady({
  products: { items: [{ name: 'Travel organizer' }] },
} as EnterpriseProfile), true);
assert.equal(enterpriseKnowledgeReady({
  faq: [{ question: 'What is the material?', answer: 'Oxford cloth.', approvedForAuto: false }],
} as EnterpriseProfile), false);
assert.equal(enterpriseKnowledgeReady({
  faq: [{ question: 'What is the material?', answer: 'Oxford cloth.', approvedForAuto: true }],
} as EnterpriseProfile), true);

console.log('knowledge retrieval policy passed');
