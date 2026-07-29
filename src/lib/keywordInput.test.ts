import assert from 'node:assert/strict';
import { normalizeKeywordInput } from './keywordInput.js';

const mixed = normalizeKeywordInput('Bahja Care عناية بهجة', 'instagram');
assert.deepEqual(mixed.items, ['#BahjaCare', '#عنايةبهجة']);

const dirty = normalizeKeywordInput('关键词： ##foundation，#foundation\n#beautywholesale', 'instagram');
assert.deepEqual(dirty.items, ['#foundation', '#beautywholesale']);

const url = normalizeKeywordInput('https://www.instagram.com/explore/tags/skincare/', 'instagram');
assert.deepEqual(url.items, ['#skincare']);

const phrase = normalizeKeywordInput('dollar tree skincare 2026', 'youtube');
assert.deepEqual(phrase.items, ['dollar tree skincare 2026']);

const foreignUrl = normalizeKeywordInput('https://youtube.com/watch?v=abc', 'instagram');
assert.equal(foreignUrl.items.length, 0);
assert.equal(foreignUrl.rejected.length, 1);

console.log('keywordInput tests passed');
