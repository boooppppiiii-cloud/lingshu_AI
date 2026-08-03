import assert from 'node:assert/strict';
import {
  fallbackReplyPlan,
  parseReplyCandidates,
  parseReplyPlan,
  rankReplyCandidates,
  semanticTextSimilarity,
} from './replyPlanning.js';
import { styleMemoryRelevanceScore, type StyleMemoryRecord } from '../knowledge/styleMemory.js';

const ongoingPlan = fallbackReplyPlan({
  phase: 'ongoing',
  latestMessage: 'We need 5,000 bottles for Dubai. Can you do Arabic packaging?',
  language: 'English',
  intent: 'reply',
  knowledgeReady: true,
  knowledgeMiss: false,
  timeline: [],
});

assert.equal(ongoingPlan.allowGreeting, false);
assert.equal(ongoingPlan.buyerState, 'engaged');
assert.ok(ongoingPlan.knownDetails.includes('quantity=5,000 bottles'));
assert.ok(ongoingPlan.knownDetails.includes('market=Dubai'));

const parsedPlan = parseReplyPlan(JSON.stringify({
  phase: 'ongoing',
  buyerState: 'skeptical',
  responseGoal: '接住证书质疑，只确认客户需要核验哪份文件',
  knownDetails: ['Dubai clinics', 'GMP requested'],
  missingDetail: 'document type',
  speechActs: ['acknowledge', 'clarify'],
  askAtMostOne: true,
  allowGreeting: true,
  emoji: 'optional',
  risk: 'verify',
}), ongoingPlan);
assert.equal(parsedPlan.allowGreeting, false, 'ongoing chat must never regain a greeting through model output');
assert.equal(parsedPlan.emoji, 'none', 'skeptical buyers should not get decorative emoji');
assert.deepEqual(parsedPlan.speechActs, ['acknowledge', 'clarify']);

const competitorPressure = fallbackReplyPlan({
  ...ongoingPlan,
  phase: 'ongoing',
  latestMessage: 'Another supplier offers 300 pcs in 10 days. Why should I choose you?',
  language: 'English',
  intent: 'reply',
  knowledgeReady: true,
  knowledgeMiss: true,
  timeline: [],
});
assert.equal(competitorPressure.buyerState, 'skeptical');
assert.equal(competitorPressure.emoji, 'none');

const parsedCandidates = parseReplyCandidates(JSON.stringify({
  candidates: [
    { style: 'direct', text: 'For 5,000 bottles in Dubai, I need to confirm the Arabic packaging part first. Do you need the bottle label or the outer box in Arabic?' },
    { style: 'warm', text: 'For 5,000 bottles in Dubai, I need to confirm the Arabic packaging part first. Do you need the bottle label or the outer box in Arabic?' },
    { style: 'relationship', text: 'Got it — 5,000 bottles for Dubai. Is the Arabic needed on the bottle label, the outer box, or both?' },
  ],
}));
assert.equal(parsedCandidates.length, 2, 'near-identical candidates should be deduplicated');

const timeline = [
  { actor: 'buyer', body: 'We need 5,000 bottles for Dubai.' },
  { actor: 'seller', body: 'Hi again! Thank you for your inquiry. Kindly provide your target quantity and market.' },
  { actor: 'buyer', body: 'Can you do Arabic packaging?' },
];
const ranked = rankReplyCandidates([
  {
    style: 'warm',
    text: 'Hi again! Thank you for your inquiry. We would be delighted to assist. Kindly provide your target quantity and which market you sell in?',
  },
  {
    style: 'direct',
    text: 'For the 5,000 bottles in Dubai, I need to confirm the Arabic packaging part. Do you need Arabic on the bottle label, the outer box, or both?',
  },
  {
    style: 'relationship',
    text: 'I understand your question. Please be advised that this request needs review. What quantity do you need?',
  },
], { latestMessage: 'Can you do Arabic packaging?', timeline, plan: ongoingPlan });

assert.equal(ranked[0].style, 'direct');
assert.ok(ranked[0].score > ranked[1].score);
assert.ok(ranked.at(-1)?.reasons.some(reason => reason === 'repeated_greeting' || reason.startsWith('reasks_')));
assert.ok(semanticTextSimilarity('Which market are you selling in?', 'What country do you sell in?') > 0.2);

const now = Date.parse('2026-08-03T00:00:00Z');
const relevant: StyleMemoryRecord = {
  id: 'relevant', tenant_id: 'tenant', trigger_message: 'Can you show the real GMP certificate?',
  draft_original: 'draft', final_sent: 'Sure, which GMP document do you want to verify first?', edited: true,
  category: 'reply', outcome: '', created: '2026-08-01T00:00:00Z',
};
const unrelatedWinner: StyleMemoryRecord = {
  id: 'winner', tenant_id: 'tenant', trigger_message: 'The color is beautiful, I will place the order.',
  draft_original: 'draft', final_sent: 'Great, I will prepare it.', edited: true,
  category: 'reply', outcome: 'won', created: '2026-08-01T00:00:00Z',
};
assert.ok(
  styleMemoryRelevanceScore(relevant, 'Can I verify your GMP certificate?', '', now)
    > styleMemoryRelevanceScore(unrelatedWinner, 'Can I verify your GMP certificate?', '', now),
  'semantic relevance must outrank an unrelated historical win',
);

console.log('reply planning, candidate ranking and hybrid style retrieval passed');
