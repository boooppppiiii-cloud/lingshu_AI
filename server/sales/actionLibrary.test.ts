import assert from 'node:assert/strict';
import { salesActionRule } from '../autonomy/actionRules.js';
import {
  L4_SALES_ACTION_IDS,
  SALES_ACTION_LIBRARY,
  matchesSalesAction,
  salesActionById,
  shouldEscalateSalesAction,
  type SalesActionMatchInput,
} from './actionLibrary.js';

const fixtures: Record<string, SalesActionMatchInput> = {
  A01: { message: 'Hi 😊', firstTurn: true },
  A02: { message: 'We need 500 face masks.', firstTurn: true },
  A03: { message: 'Send me your full price list.' },
  A04: { message: 'We are a skincare distributor in Dubai.' },
  B01: { message: 'I need SKU SR-100.' },
  B02: { message: 'Do you have beard oil?', productAvailable: false },
  B03: { message: 'What are the ingredients and benefits?' },
  B04: { message: 'Can you send photos and a video?' },
  C01: { message: 'How much is it?' },
  C02: { message: 'This is too expensive.' },
  C03: { message: 'Another supplier offered a lower price.' },
  C04: { message: 'I am ready to order if you give me a discount.' },
  C05: { message: 'Please prepare a proforma invoice.' },
  D01: { message: 'This is my first time buying from China. How can I know the quality?' },
  D02: { message: 'Can you send GMP and ISO certificates?', knowledgeMiss: true },
  D03: { message: 'My last supplier sent a fake certificate.' },
  D04: { message: 'Are you a factory or trading company?' },
  E01: { message: 'Can I get a sample?' },
  E02: { message: 'Can you give me a free sample?' },
  E03: { message: 'The sample was delivered last week.' },
  F01: { message: 'How long is delivery to Dubai?' },
  F02: { message: 'What is the freight cost?' },
  F03: { message: 'How do customs and import duty work?' },
  G01: { message: 'What payment method do you accept?' },
  G02: { message: 'Can I pay after I receive the goods?' },
  H01: { message: 'We need private label with our logo.' },
  H02: { message: 'I want to be your exclusive distributor.' },
  I01: { message: "Let's proceed. I want to order." },
  I02: { message: 'Let me think about it.' },
  I03: { message: "I don't want a long process. Keep it simple." },
  I04: { message: 'Please summarize what we discussed.' },
  J01: { message: 'Just checking in on the quote.', stage: 'quoted' },
  J02: { message: 'scheduled follow-up', stage: 'silent30' },
  J03: { message: 'Maybe next season.' },
  K01: { message: 'Hi again', stage: 'won' },
  K02: { message: 'The masks sold well. Customers love them.' },
  K03: { message: 'The goods arrived damaged. I need a refund.' },
  L01: { message: 'Can we have a video call with your manager?' },
  L02: { message: 'Send your details.', redFlagCount: 2 },
  L03: { message: 'Ship first and I will pay after delivery.', redFlagCount: 3 },
  L04: { message: 'This is unacceptable.', sentiment: 'negative' },
  L05: { message: 'Can you confirm this unusual requirement?', knowledgeMiss: true },
};

assert.equal(SALES_ACTION_LIBRARY.length, 42, 'document action library must contain exactly 42 scenarios');
assert.equal(new Set(SALES_ACTION_LIBRARY.map(item => item.id)).size, 42, 'action IDs must be unique');
assert.deepEqual(Object.keys(fixtures).sort(), SALES_ACTION_LIBRARY.map(item => item.id).sort(), 'every action needs one acceptance fixture');

for (const item of SALES_ACTION_LIBRARY) {
  assert.equal(matchesSalesAction(item.id, fixtures[item.id]), true, `${item.id} did not match its fixture`);
  assert.equal(salesActionRule(item.id).risk, item.risk, `${item.id} risk is out of sync with actionRules.ts`);
  assert.ok(item.goal && item.actions.length && item.talk.length, `${item.id} is missing required fields`);
  for (const variant of item.talk) {
    assert.ok(variant.length > 0, `${item.id} has an empty talk variant`);
    for (const bubble of variant) {
      assert.ok(bubble.length <= 180, `${item.id} talk bubble is too long`);
      assert.doesNotMatch(bubble, /(^|\n)\s*(?:[-*•]|\d+[.)])\s+|\*\*|```/, `${item.id} talk contains list/markdown formatting`);
    }
  }
}

assert.deepEqual(
  L4_SALES_ACTION_IDS.slice().sort(),
  SALES_ACTION_LIBRARY.filter(item => salesActionRule(item.id).risk === 'L4').map(item => item.id).sort(),
  'L4 definitions must match exactly',
);

assert.equal(shouldEscalateSalesAction(salesActionById('C01')!, 'How much is it?'), false);
assert.equal(shouldEscalateSalesAction(salesActionById('C01')!, 'How much for 500 pcs?'), true);
assert.equal(shouldEscalateSalesAction(salesActionById('B03')!, 'What are the ingredients?'), false);
assert.equal(shouldEscalateSalesAction(salesActionById('B03')!, 'Can you guarantee this cures acne?'), true);
assert.equal(shouldEscalateSalesAction(salesActionById('D02')!, 'Do you have GMP?'), true);

console.log('42 sales action scenarios and L4 alignment passed');
