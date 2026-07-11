import assert from 'node:assert/strict';
import { guardOutbound } from './outboundGuard.js';

const blocked = [
  'The unit price is $2.5 per pc.',
  'We can give u 5 percent off for this order.',
  'I will ship in 7 days.',
  'Delivery can be guaranteed within two weeks.',
  'Payment terms are 30% deposit and 70% before shipment.',
  'T/T is okay for this order.',
  '可以优惠 5%，今天下单就降价。',
  '交期保证 10 天内发货。',
  '定金 30%，尾款发货前付清。',
  'If there is a problem we can compensate you with a refund.',
];

const allowed = [
  'Thanks, I received your message and will check the details.',
  'Your package has been picked up by DHL. I will share tracking when available.',
  'Happy New Year. Wishing your team a great season.',
  'Here is our approved catalog for your review.',
  'Could you share the quantity and target market?',
  'I will ask our sales colleague to review your request.',
  '您好，我先记录您的需求，稍后给您确认。',
  '目录已经发给您，请看一下是否有喜欢的款式。',
  '物流状态已更新，我会继续跟进。',
  '请问您希望采购多少件？',
];

for (const sample of blocked) {
  const result = await guardOutbound(sample);
  assert.equal(result.allowed, false, `Expected block: ${sample}`);
  assert.ok(result.matchedRule, `Expected matched rule: ${sample}`);
}

for (const sample of allowed) {
  const result = await guardOutbound(sample);
  assert.equal(result.allowed, true, `Expected allow: ${sample}`);
}

console.log(`outboundGuard passed ${blocked.length + allowed.length} samples`);
