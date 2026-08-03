import assert from 'node:assert/strict';
import { resolveKnowledgeGapPlan } from './knowledgeGapPlaybook.js';
import { planMobileChatMessages } from './mobileChatStyle.js';

const conversations = [
  'Hi, I saw your collagen serum video. I need private label with English-Arabic packaging.',
  'Many suppliers say yes to everything. How can I know your quality is reliable?',
  'Another supplier offered 300 pieces and can deliver in 10 days. Why should I choose you?',
  'I do not want a long process. What exactly do you need from me today?',
  'Can you provide real GMP or ISO documents? A supplier sent me fake certificates before.',
  'We need 5,000 bottles for Dubai. Give me your exact best price.',
  'Can you guarantee delivery within 10 days?',
  'The bottles arrived damaged. This is unacceptable and I want a refund.',
  'Can you call me today?',
  'Where is my order? It should have arrived already.',
  'Can your ERP sync our internal approval tree?',
];

for (const message of conversations) {
  const plan = resolveKnowledgeGapPlan({ message, language: 'English' });
  const delivery = planMobileChatMessages(plan.draft);
  const words = plan.draft.split(/\s+/).filter(Boolean).length;
  assert.equal(delivery.truncated, false, `mobile delivery overflow: ${plan.draft}`);
  assert.ok(delivery.messages.length >= 1 && delivery.messages.length <= 3);
  assert.ok(words <= 75, `bridge should still feel typed on a phone (${words} words): ${plan.draft}`);
  assert.ok(plan.draftZh.trim().length > 0, 'every bridge needs a paired Chinese translation');
  assert.doesNotMatch(plan.draft, /(?:^|\n)\s*(?:[-*•◆◇☑✅]|\d+[.)])\s+/m);
  assert.doesNotMatch(plan.draft, /\*\*|__|#{1,6}\s|full context|human queue|four(?:-| )working(?:-| )hours?/i);
  assert.ok((plan.draft.match(/\?/g) || []).length <= 1, `one natural next step only: ${plan.draft}`);
}

const bigOrder = resolveKnowledgeGapPlan({
  message: 'We need 5,000 bottles for Dubai. Give me your exact best price.',
  language: 'English',
});
assert.match(bigOrder.draft, /5,000 bottles/i);
assert.doesNotMatch(bigOrder.draft, /how many|what quantity|send (?:me )?(?:your )?quantity/i);

const competitor = resolveKnowledgeGapPlan({
  message: 'Another supplier offered 300 pieces and can deliver in 10 days.',
  language: 'English',
});
assert.match(competitor.draft, /300 pieces/i);
assert.match(competitor.draft, /in 10 days/i);

const liveChatHistory: Array<{ actor: string; body: string }> = [];
for (let index = 0; index < 7; index += 1) {
  const reply = resolveKnowledgeGapPlan({
    message: 'Can you show the real GMP document?',
    language: 'English',
    timeline: liveChatHistory,
  }).draft;
  if (liveChatHistory.length) assert.notEqual(reply, liveChatHistory.at(-1)?.body, 'same bridge must not repeat back-to-back');
  liveChatHistory.push({ actor: 'ai', body: reply });
}

console.log(`${conversations.length} human-voice scenarios passed`);
