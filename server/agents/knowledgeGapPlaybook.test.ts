import assert from 'node:assert/strict';
import { classifyKnowledgeGapScenario, resolveKnowledgeGapPlan, scenarioHasGroundedEvidence } from './knowledgeGapPlaybook.js';
import { planMobileChatMessages, splitMobileChatMessages } from './mobileChatStyle.js';

const rounds = [
  ['Hi, I saw your collagen serum video. I distribute skincare to clinics in Dubai and I am looking for a private-label supplier. What can you do for us?', 'customization_or_packaging'],
  ['How can I know your quality is reliable? Can you show a COA?', 'quality_or_certification'],
  ['Another supplier offered only 300 pieces and says they can ship in 10 days. Why should I choose you instead?', 'competitor_comparison'],
  ['I do not want a lot of back and forth. What exactly do you need from me today?', 'urgent_next_step'],
  ['Can you guarantee Arabic packaging and provide real GMP or ISO documents?', 'quality_or_certification'],
  ['The goods arrived damaged. I want a refund and need your manager.', 'after_sale_complaint'],
  ['Can we have a video call today?', 'call_request'],
  ['Can you guarantee delivery to Dubai within 10 days?', 'delivery_commitment'],
] as const;

const replies: string[] = [];
for (const [message, expected] of rounds) {
  assert.equal(classifyKnowledgeGapScenario(message), expected);
  const plan = resolveKnowledgeGapPlan({
    message,
    language: 'English',
    timeline: replies.map(body => ({ actor: 'ai', body })),
  });
  assert.equal(plan.handoffRequired, true);
  assert.equal(plan.safeToSendBeforeHandoff, true);
  assert.equal(plan.replyConfidence.level, 'bridge_only');
  assert.ok(plan.variantCount >= 1);
  assert.equal(plan.followUpMinutes, 240);
  assert.ok(Date.parse(plan.followUpDueAt) > Date.now());
  assert.ok(plan.draftZh.length > 10);
  assert.ok(plan.draft.length < 420);
  assert.doesNotMatch(plan.draft, /(?:^|\n)\s*(?:[-*•◆◇]|\d+[.)])\s+/m);
  assert.doesNotMatch(plan.draft, /\b(?:we|i)\s+(?:can|guarantee|provide|offer|support)\b/i);
  assert.doesNotMatch(splitMobileChatMessages(plan.draft).join(' '), /four(?:-| )working(?:-| )hour|within four hours/i);
  replies.push(plan.draft);
}
assert.equal(new Set(replies).size, replies.length);
assert.equal(classifyKnowledgeGapScenario('We need 5,000 bottles for our chain.'), 'high_value_or_peer');
assert.equal(classifyKnowledgeGapScenario('We are also a supplier in this market.'), 'high_value_or_peer');
assert.equal(classifyKnowledgeGapScenario('We need 5,000 bottles with private-label packaging.'), 'high_value_or_peer');
assert.equal(classifyKnowledgeGapScenario('What is the price for 300 pieces?'), 'price_or_quote');
assert.equal(classifyKnowledgeGapScenario('Do you have size M for this one?'), 'product_availability');
assert.equal(classifyKnowledgeGapScenario('What colors are available for this one?'), 'product_availability');
assert.equal(scenarioHasGroundedEvidence('quality_or_certification', 'Approved documents: GMP and ISO 22716'), false);
assert.equal(scenarioHasGroundedEvidence('quality_or_certification', 'No documents configured'), false);
assert.equal(scenarioHasGroundedEvidence('customization_or_packaging', 'OEM and bilingual packaging are approved'), true);
assert.equal(scenarioHasGroundedEvidence('product_availability', '{"color":"black, navy","size":""}'), true);
assert.equal(scenarioHasGroundedEvidence('product_availability', '{"color":"","size":""}'), false);

const repeated = resolveKnowledgeGapPlan({
  message: 'How can I know your quality is reliable?',
  language: 'English',
  timeline: [{ actor: 'ai', body: replies[1].replaceAll('’', "'") }],
});
assert.notEqual(repeated.draft, replies[1]);

for (const language of ['Spanish', 'Arabic']) {
  const first = resolveKnowledgeGapPlan({ message: 'Can you provide real GMP documents?', language });
  const second = resolveKnowledgeGapPlan({ message: 'Can you provide real GMP documents?', language, timeline: [{ actor: 'ai', body: first.draft }] });
  assert.notEqual(first.draft, second.draft);
}

const sameScenarioReplies: string[] = [];
for (let index = 0; index < 6; index += 1) {
  const plan = resolveKnowledgeGapPlan({
    message: 'Can you provide real GMP documents?',
    language: 'English',
    timeline: sameScenarioReplies.map(body => ({ actor: 'ai', body })),
  });
  sameScenarioReplies.push(plan.draft);
}
assert.ok(new Set(sameScenarioReplies).size >= 2);
assert.ok(sameScenarioReplies.every(reply => !/four(?:-| )working(?:-| )hour|within four hours/i.test(reply)));
for (let index = 1; index < sameScenarioReplies.length; index += 1) {
  assert.notEqual(sameScenarioReplies[index], sameScenarioReplies[index - 1]);
}

for (const language of ['English', 'Spanish', 'Arabic']) {
  const history: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const fallback = resolveKnowledgeGapPlan({
      message: 'Can you provide real GMP documents?',
      language,
      timeline: history.map(body => ({ actor: 'ai', body })),
    });
    const deliveryPlan = planMobileChatMessages(fallback.draft);
    assert.equal(deliveryPlan.truncated, false, `${language} fallback must fit in three bubbles`);
    assert.ok(deliveryPlan.messages.length >= 1 && deliveryPlan.messages.length <= 3);
    history.push(fallback.draft);
  }
  assert.ok(new Set(history).size >= 1);
}

const generalUnknown = resolveKnowledgeGapPlan({ message: 'Does this work with our internal ERP workflow?', language: 'English' });
assert.doesNotMatch(generalUnknown.draft, /pass|hand(?:ing)? over|right person|team|human queue|four hours/i);

const knownQuantity = resolveKnowledgeGapPlan({
  message: 'We need 5,000 bottles for Dubai and want your exact price.',
  language: 'English',
});
assert.doesNotMatch(knownQuantity.draft, /how many|what quantity|send (?:me )?(?:your )?quantity/i);

const complaint = resolveKnowledgeGapPlan({ message: 'The bottles arrived damaged. I want a refund.', language: 'English' });
assert.equal(complaint.scenario, 'after_sale_complaint');
assert.match(complaint.draft, /order number|photos/i);
assert.doesNotMatch(complaint.draft, /refund approved|compensat|our fault|guarantee/i);

const call = resolveKnowledgeGapPlan({ message: 'Can you call me today?', language: 'English' });
assert.equal(call.scenario, 'call_request');
assert.match(call.draft, /time|today|time zone/i);

const sizeCheck = resolveKnowledgeGapPlan({ message: 'Do you have size M for this one?', language: 'English' });
assert.equal(sizeCheck.scenario, 'product_availability');
assert.match(sizeCheck.draft, /size M/i);
assert.doesNotMatch(sizeCheck.draft, /which size|what size/i);

console.log('knowledge gap playbook passed');
