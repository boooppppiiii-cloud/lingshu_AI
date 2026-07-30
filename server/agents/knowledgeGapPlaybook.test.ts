import assert from 'node:assert/strict';
import { classifyKnowledgeGapScenario, resolveKnowledgeGapPlan, scenarioHasGroundedEvidence } from './knowledgeGapPlaybook.js';
import { planMobileChatMessages, splitMobileChatMessages } from './mobileChatStyle.js';

const rounds = [
  ['Hi, I saw your collagen serum video. I distribute skincare to clinics in Dubai and I am looking for a private-label supplier. What can you do for us?', 'customization_or_packaging'],
  ['How can I know your quality is reliable? Can you show a COA?', 'quality_or_certification'],
  ['Another supplier offered only 300 pieces and says they can ship in 10 days. Why should I choose you instead?', 'competitor_comparison'],
  ['I do not want a lot of back and forth. What exactly do you need from me today?', 'urgent_next_step'],
  ['Can you guarantee Arabic packaging and provide real GMP or ISO documents?', 'quality_or_certification'],
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
  assert.equal(plan.variantCount, 6);
  assert.equal(plan.followUpMinutes, 240);
  assert.ok(Date.parse(plan.followUpDueAt) > Date.now());
  assert.ok(plan.draftZh.length > 10);
  assert.ok(plan.draft.length < 420);
  assert.doesNotMatch(plan.draft, /(?:^|\n)\s*(?:[-*•◆◇]|\d+[.)])\s+/m);
  assert.doesNotMatch(plan.draft, /\b(?:we|i)\s+(?:can|guarantee|provide|offer|support)\b/i);
  assert.match(splitMobileChatMessages(plan.draft).join(' '), /four(?:-| )working(?:-| )hour/i);
  replies.push(plan.draft);
}
assert.equal(new Set(replies).size, replies.length);
assert.equal(classifyKnowledgeGapScenario('We need 5,000 bottles for our chain.'), 'high_value_or_peer');
assert.equal(classifyKnowledgeGapScenario('We are also a supplier in this market.'), 'high_value_or_peer');
assert.equal(classifyKnowledgeGapScenario('We need 5,000 bottles with private-label packaging.'), 'high_value_or_peer');
assert.equal(classifyKnowledgeGapScenario('What is the price for 300 pieces?'), 'price_or_quote');
assert.equal(scenarioHasGroundedEvidence('quality_or_certification', 'Approved documents: GMP and ISO 22716'), false);
assert.equal(scenarioHasGroundedEvidence('quality_or_certification', 'No documents configured'), false);
assert.equal(scenarioHasGroundedEvidence('customization_or_packaging', 'OEM and bilingual packaging are approved'), true);

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
assert.equal(new Set(sameScenarioReplies).size, 6);
assert.ok(sameScenarioReplies.every(reply => /four(?:-| )working(?:-| )hour/i.test(reply)));

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
  assert.equal(new Set(history).size, 6);
}

console.log('knowledge gap playbook passed');
