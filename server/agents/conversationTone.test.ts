import assert from 'node:assert/strict';
import { conciseGreetingReply, conversationToneGuidance, hasPreviousConversation, isSimpleGreetingMessage } from './conversationTone.js';

const firstGreeting = [{ actor: 'buyer', type: 'whatsapp', body: 'hi' }];
const returningGreeting = [
  { actor: 'buyer', type: 'whatsapp', body: 'hi' },
  { actor: 'ai', type: 'whatsapp', body: 'Hi! How can I help?' },
  { actor: 'buyer', type: 'whatsapp', body: 'hi' },
];

assert.equal(isSimpleGreetingMessage('Hi!'), true);
assert.equal(isSimpleGreetingMessage('Hi, what is your MOQ?'), false);
assert.equal(hasPreviousConversation(firstGreeting), false);
assert.equal(hasPreviousConversation(returningGreeting), true);
assert.equal(conciseGreetingReply('English', false), 'Hey! What are you looking for today?');
assert.equal(conciseGreetingReply('English', true), 'Hey, good to hear from you again! What are we working on today?');
assert.equal(conciseGreetingReply('English', true, 'the black travel organizer'), 'Hey, good to hear from you again! Still looking at the black travel organizer?');
const returningGuidance = conversationToneGuidance(returningGreeting, 'hi');
assert.match(returningGuidance, /someone who remembers this buyer/);
assert.match(returningGuidance, /Match the length to the moment/);
assert.match(returningGuidance, /recognize them/);
assert.doesNotMatch(returningGuidance, /no more than|words total|at most one question|Do not introduce/);

const detailedGuidance = conversationToneGuidance([
  { actor: 'buyer', type: 'whatsapp', body: 'We need custom packaging for the black version.' },
], 'Can you explain the packaging options?');
assert.match(detailedGuidance, /serious product question can take a little more space/);
assert.match(detailedGuidance, /genuinely the next missing piece/);

console.log('conversation tone policy passed');
