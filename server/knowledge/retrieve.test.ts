import assert from 'node:assert/strict';
import type { EnterpriseProfile } from '../routes/enterprise.js';
import { enterpriseKnowledgeReady, isContextDependentFaqQuestion, isProductDiscoveryIntent, isSafeWithoutEnterpriseKnowledge, seedCurrentProductQuery } from './retrieve.js';

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

const mappedProduct = seedCurrentProductQuery(
  { keywords: ['size'], sentiment: 'neutral' },
  { product: 'Pleated skirt', internalProduct: '百褶裙' },
  'Do you have size M for this one?',
  [
    { role: 'buyer', text: 'I like the pleated skirt.' },
    { role: 'seller', text: 'Which size do you need?' },
    { role: 'buyer', text: 'Do you have size M for this one?' },
  ],
  [],
);
assert.ok(mappedProduct?.keywords?.includes('百褶裙'), 'current English product context should seed its mapped Chinese product name');

const unrelatedProduct = seedCurrentProductQuery(
  { keywords: ['leather jackets'], sentiment: 'neutral' },
  { product: 'Pleated skirt', internalProduct: '百褶裙' },
  'Do you have leather jackets?',
  [{ role: 'buyer', text: 'Do you have leather jackets?' }],
  [],
);
assert.equal(unrelatedProduct?.keywords?.includes('百褶裙'), false, 'a new product question must not inherit the stale mapped product');

const quantityForNewProduct = seedCurrentProductQuery(
  { keywords: ['bottles'], sentiment: 'neutral' },
  { product: 'Pleated skirt', internalProduct: '百褶裙' },
  'We need 5,000 bottles for Dubai. Give me your exact best price.',
  [{ role: 'buyer', text: 'We need 5,000 bottles for Dubai. Give me your exact best price.' }],
  [],
);
assert.equal(quantityForNewProduct?.keywords?.includes('百褶裙'), false, 'a quantity alone must not bind a new product to the previous product');
assert.equal(isSafeWithoutEnterpriseKnowledge('hi'), true);
assert.equal(isSafeWithoutEnterpriseKnowledge('thanks!'), true);
assert.equal(isSafeWithoutEnterpriseKnowledge('Where is my tracking number?'), false);
assert.equal(isSafeWithoutEnterpriseKnowledge('Please send the invoice.'), false);
assert.equal(isProductDiscoveryIntent('what do you have'), true);
assert.equal(isProductDiscoveryIntent('show me your products'), true);
assert.equal(isProductDiscoveryIntent('Do you have size M?'), false);
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
