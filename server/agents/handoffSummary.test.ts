import assert from 'node:assert/strict';
import { buildHandoffSummary } from './handoffSummary.js';

const certificate = buildHandoffSummary({
  latestMessage: 'Can you guarantee the GMP certificate is real?',
  product: 'Pleated skirt',
  handlingReason: '客户问题涉及人工判断',
});
assert.match(certificate, /客户要什么：核实GMP证书或质量文件的真实性/);
assert.match(certificate, /AI 未确认文件真实性/);
assert.match(certificate, /真实文件、编号和对应产品/);
assert.doesNotMatch(certificate, /报价|采购细节/);

const price = buildHandoffSummary({
  latestMessage: 'What is your best price for 500 pcs?',
  product: 'Pleated skirt',
});
assert.match(price, /真实报价/);
assert.match(price, /销售确认/);

const unknown = buildHandoffSummary({
  latestMessage: 'We need a three-level approval workflow connected through our own API.',
});
assert.match(unknown, /three-level approval workflow/);
assert.match(unknown, /超出当前可确认资料/);

console.log('handoff summary tests passed');
