import assert from 'node:assert/strict';
import {
  conciseGreetingReply,
  conversationPhase,
  conversationToneGuidance,
  hasPreviousConversation,
  isSimpleGreetingMessage,
  timelineTimestampMs,
} from './conversationTone.js';

const now = Date.parse('2026-07-30T06:00:00.000Z');
const firstGreeting = [{ actor: 'buyer', type: 'whatsapp', body: 'hi', timestamp: now }];
const ongoingGreeting = [
  { actor: 'buyer', type: 'whatsapp', body: 'I need the black version.', timestamp: now - 5 * 60_000 },
  { actor: 'ai', type: 'whatsapp', body: 'Got it. What quantity do you need?', timestamp: now - 2 * 60_000 },
  { actor: 'buyer', type: 'whatsapp', body: 'hi', timestamp: now },
];
const resumedGreeting = [
  { actor: 'buyer', type: 'whatsapp', body: 'I need the black version.', timestamp: now - 2 * 60 * 60_000 },
  { actor: 'ai', type: 'whatsapp', body: 'Got it. What quantity do you need?', timestamp: now - 90 * 60_000 },
  { actor: 'buyer', type: 'whatsapp', body: 'hi', timestamp: now },
];

assert.equal(isSimpleGreetingMessage('Hi!'), true);
assert.equal(isSimpleGreetingMessage('Hi, what is your MOQ?'), false);
assert.equal(timelineTimestampMs({ timestamp: Math.floor(now / 1000) }), now);
assert.equal(conversationPhase(firstGreeting), 'first_contact');
assert.equal(conversationPhase(ongoingGreeting), 'ongoing');
assert.equal(conversationPhase(resumedGreeting), 'resumed');
assert.equal(conversationPhase(ongoingGreeting.map(({ timestamp, ...event }) => event)), 'ongoing');
assert.equal(hasPreviousConversation(firstGreeting), false);
assert.equal(hasPreviousConversation(ongoingGreeting), true);
assert.equal(conciseGreetingReply('English', 'first_contact'), 'Hey! What are you looking for today?');
assert.equal(conciseGreetingReply('English', 'ongoing', 'the black travel organizer'), "Sure, let's continue with the black travel organizer. What do you want to check?");
assert.doesNotMatch(conciseGreetingReply('English', 'ongoing'), /\b(?:hi|hello|hey|again)\b/i);
assert.equal(conciseGreetingReply('English', 'resumed'), 'Hi again! Where shall we pick up?');
assert.equal(conciseGreetingReply('English', 'resumed', 'the black travel organizer'), 'Hi again! Shall we continue with the black travel organizer?');

const ongoingGuidance = conversationToneGuidance(ongoingGreeting, 'hi');
assert.match(ongoingGuidance, /same live conversation/);
assert.match(ongoingGuidance, /Do not greet again/);
assert.match(ongoingGuidance, /Match the length to the moment/);
assert.doesNotMatch(ongoingGuidance, /no more than|words total|at most one question/);

const resumedGuidance = conversationToneGuidance(resumedGreeting, 'hi');
assert.match(resumedGuidance, /returning after a pause of more than 30 minutes/);
assert.match(resumedGuidance, /welcome-back is appropriate once/);

const detailedGuidance = conversationToneGuidance([
  { actor: 'buyer', type: 'whatsapp', body: 'We need custom packaging for the black version.', timestamp: now },
], 'Can you explain the packaging options?');
assert.match(detailedGuidance, /serious product question can take a little more space/);
assert.match(detailedGuidance, /genuinely the next missing piece/);

console.log('conversation tone policy passed');
