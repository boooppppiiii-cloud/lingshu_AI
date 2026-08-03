import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isPredominantlyChineseText } from '../../src/lib/messageLanguage.js';

const source = fs.readFileSync('src/components/ConversionPage.tsx', 'utf8');

const translatedDraftMappings = source.match(/translatedDraft:\s*typeof data\.translatedDraft/g) ?? [];
assert.ok(
  translatedDraftMappings.length >= 2,
  'handoff and normal AI replies must both reuse the translation returned for that exact draft',
);
assert.doesNotMatch(
  source,
  /const translation\s*=.*fallbackCustomerReplyZh/,
  'the timeline must not label a generic fallback sentence as the translation of an unrelated AI reply',
);
const forwardedTranslations = source.match(/translatedBody:\s*result\.translatedDraft/g) ?? [];
assert.ok(
  forwardedTranslations.length >= 2,
  'handoff bridges and normal automatically sent replies must retain their matching Chinese translation',
);
assert.equal(
  isPredominantlyChineseText('We mainly carry 商品1. Is that what you are looking for?'),
  false,
  'an English reply containing a Chinese product name must stay in English',
);
assert.equal(isPredominantlyChineseText('帮我确认一下 MOQ 和交期'), true);

console.log('customer reply UI translation contract tests passed');
