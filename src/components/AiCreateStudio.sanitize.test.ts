import assert from 'node:assert/strict';
import { sanitizeStoryboardScript } from './AiCreateStudio.js';

const fiveSilentScenes = Array.from({ length: 5 }, (_, index) => `[${index * 4}-${(index + 1) * 4}s]
环境：测试环境${index + 1}
台词：无
字幕：无`).join('\n');

const sanitizedSilentScenes = sanitizeStoryboardScript(fiveSilentScenes, '');
assert.equal((sanitizedSilentScenes.match(/^台词：无$/gm) || []).length, 5);
assert.equal((sanitizedSilentScenes.match(/^字幕：无$/gm) || []).length, 5);

const englishSilentMarkers = sanitizeStoryboardScript(`[0-4s]
Voiceover: none
Subtitle: none
[4-8s]
Voiceover: no voiceover
Subtitle: no voiceover`, '');
assert.equal((englishSilentMarkers.match(/^Voiceover: (?:none|no voiceover)$/gm) || []).length, 2);
assert.equal((englishSilentMarkers.match(/^Subtitle: (?:none|no voiceover)$/gm) || []).length, 2);

const repeatedNarration = sanitizeStoryboardScript(`[0-4s]
台词：普通重复台词。
字幕：普通重复台词。
[4-8s]
台词：普通重复台词。
字幕：普通重复台词。`, '');
assert.equal((repeatedNarration.match(/^台词：普通重复台词。$/gm) || []).length, 1);

console.log('AiCreateStudio storyboard sanitizer tests passed');
