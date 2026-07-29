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
assert.equal(conciseGreetingReply('English', false), 'Hi! How can I help?');
assert.equal(conciseGreetingReply('English', true), 'Hi again! How can I help today?');
assert.match(conversationToneGuidance(returningGreeting, 'hi'), /Do not introduce the company again/);
assert.match(conversationToneGuidance(returningGreeting, 'hi'), /no more than twelve words/);

console.log('conversation tone policy passed');
