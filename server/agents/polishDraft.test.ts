import assert from 'node:assert/strict';
import { buildFaithfulPolishPrompt, sanitizePolishedDraft } from './polishDraft.js';

const source = '我们有百褶裙，您需要多少件？';
const prompt = buildFaithfulPolishPrompt(source, 'English', 'ongoing');
assert.match(prompt, /Preserve every statement, question, uncertainty and request/);
assert.match(prompt, /Never add Hi/);

assert.equal(
  sanitizePolishedDraft(source, "Hi there! We have pleated skirts. How many pieces do you need?"),
  'We have pleated skirts. How many pieces do you need?',
);
assert.equal(
  sanitizePolishedDraft(source, "We have pleated skirts. How many pieces do you need, and I'll check the best option for you."),
  'We have pleated skirts. How many pieces do you need?',
);

const sourceWithGreeting = '您好，我们有百褶裙，您需要多少件？';
assert.match(sanitizePolishedDraft(sourceWithGreeting, 'Hi! We have pleated skirts. How many pieces do you need?'), /^Hi!/);

console.log('polish draft tests passed');
