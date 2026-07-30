import assert from 'node:assert/strict';
import { mobileChatRewritePrompt, normalizeMobileChatFormatting, shouldReshapeMobileChatDraft } from './mobileChatStyle.js';

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
assert.match(mobileChatRewritePrompt(structured, 'hi', 'English'), /plain-text WhatsApp message/);
assert.match(mobileChatRewritePrompt(structured, 'hi', 'English'), /Do not add product facts/);

console.log('mobile chat style policy passed');
