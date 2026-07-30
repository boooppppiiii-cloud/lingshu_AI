import assert from 'node:assert/strict';
import { sanitizeImportedWinningStyleText } from './styleMemory.js';

const sanitized = sanitizeImportedWinningStyleText('We can provide ISO 9001 and 500 pcs at $2.50 with 15 days lead time. What market are you selling in?');
assert.doesNotMatch(sanitized, /9001|500|2\.50|15|we can provide/i);
assert.match(sanitized, /What market are you selling in/i);

console.log('winning-history style fact isolation passed');
