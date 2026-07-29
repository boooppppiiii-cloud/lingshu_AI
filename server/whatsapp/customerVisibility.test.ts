import assert from 'node:assert/strict';
import { isRealWhatsAppNumber } from './customerVisibility.js';

assert.equal(isRealWhatsAppNumber('15551234567'), true);
assert.equal(isRealWhatsAppNumber('+8613800138000'), true);
assert.equal(isRealWhatsAppNumber('social:youtube:author-1'), false);
assert.equal(isRealWhatsAppNumber('social:instagram:comment-2'), false);
assert.equal(isRealWhatsAppNumber(''), false);

console.log('WhatsApp customer visibility policy passed');
