import assert from 'node:assert/strict';
import { mobileChatRewritePrompt, normalizeMobileChatFormatting, planMobileChatMessages, shouldReshapeMobileChatDraft, splitMobileChatMessages } from './mobileChatStyle.js';

const structured = `**Here are the options:**
- [x] Fast shipping
- ◆ Custom packaging
3. Please confirm the quantity`;
assert.equal(
  normalizeMobileChatFormatting(structured),
  'Here are the options: Fast shipping Custom packaging Please confirm the quantity',
);
assert.equal(shouldReshapeMobileChatDraft(structured, 'What options do you have?'), true);
assert.equal(shouldReshapeMobileChatDraft('You want the black one, right?', 'yes black'), false);
assert.equal(shouldReshapeMobileChatDraft('Thank you for your inquiry. We would be delighted to assist you.', 'hi'), true);
assert.equal(
  normalizeMobileChatFormatting('Thank you for your inquiry. Please be advised that we are checking it.'),
  'Thanks for your message. Just so you know, we are checking it.',
);
assert.equal(shouldReshapeMobileChatDraft('The material is ABS, and the size is 20 cm. Tell me if you need the packing details too.', 'Can you explain the material, dimensions, packaging and certification details?'), false);
assert.equal(normalizeMobileChatFormatting('Got it 👍 😊 🔥'), 'Got it 👍');
assert.match(mobileChatRewritePrompt(structured, 'hi', 'English'), /plain-text WhatsApp message/);
assert.match(mobileChatRewritePrompt(structured, 'hi', 'English'), /Do not add product facts/);
const englishMessages = splitMobileChatMessages('I understand your question. Please send the product model and target quantity. I will pass that exact context to the responsible salesperson. You will get a reply in this chat within four working hours.');
assert.ok(englishMessages.length <= 3);
assert.ok(englishMessages.every(message => message.split(/\s+/).length <= 25));
const chineseMessages = splitMobileChatMessages('我明白你的问题。请把产品型号和预计数量发给我。我会把完整上下文交给负责同事，并在四个工作小时内通过这里回复你。');
assert.ok(chineseMessages.length <= 3);
assert.ok(chineseMessages.every(message => Array.from(message.replace(/\s/g, '')).length <= 30));
const overflow = planMobileChatMessages('One short sentence. Two short sentence. Three short sentence. Four short sentence. Five short sentence. Six short sentence. Seven short sentence.');
assert.equal(overflow.messages.length, 3);
assert.equal(overflow.truncated, true);
assert.equal(shouldReshapeMobileChatDraft('One short sentence. Two short sentence. Three short sentence. Four short sentence. Five short sentence. Six short sentence. Seven short sentence.', 'Hi'), true);
const oneQuestion = splitMobileChatMessages('Which market are you in? I can check the matching option. What quantity do you need?');
assert.equal((oneQuestion.join(' ').match(/[?？]/g) ?? []).length, 1);
assert.match(oneQuestion.join(' '), /^Which market are you in\?/);
assert.match(oneQuestion.join(' '), /I can check the matching option\./);

console.log('mobile chat style policy passed');
