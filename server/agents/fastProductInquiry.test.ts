import assert from 'node:assert/strict';
import { fastProductInquiryReply, isFastProductInquiry } from './fastProductInquiry.js';

const basic = {
  message: 'Hi, I saw your pleated skirt video. I buy for a boutique in Dubai and need 500 pcs.',
  product: 'Pleated skirt',
  firstBuyerTurn: true,
};
assert.equal(isFastProductInquiry(basic), true);
assert.equal(fastProductInquiryReply({ ...basic, language: 'English' }).draft, '500 pcs of Pleated skirt—got it. What specs do you need?');

assert.equal(isFastProductInquiry({ ...basic, firstBuyerTurn: false }), false);
assert.equal(isFastProductInquiry({ ...basic, message: 'I need 500 pcs. What is your best price?' }), false);
assert.equal(isFastProductInquiry({ ...basic, message: 'I need 500 pcs with private label packaging.' }), false);
assert.equal(isFastProductInquiry({ ...basic, product: '' }), false);

console.log('fast product inquiry tests passed');
