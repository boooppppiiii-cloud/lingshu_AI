import assert from 'node:assert/strict';
import { decideAction } from './actionRules.js';

assert.equal(decideAction('auto_faq_reply', 'remind').decision, 'remind');
assert.equal(decideAction('auto_faq_reply', 'draft').decision, 'draft');
assert.equal(decideAction('auto_faq_reply', 'auto').decision, 'auto');

for (const action of ['auto_logistics_update', 'auto_send_catalog', 'auto_aftersale_confirm']) {
  assert.equal(decideAction(action, 'auto').decision, 'draft', `${action} requires real business evidence`);
}

for (const action of ['formal_quote', 'discount', 'payment_terms', 'delivery_promise', 'contract_terms']) {
  assert.equal(decideAction(action, 'auto').decision, 'draft', `${action} must always require human confirmation`);
  assert.equal(decideAction(action, 'remind').decision, 'remind', `${action} must not create a draft in remind-only mode`);
}

console.log('actionRules passed');
