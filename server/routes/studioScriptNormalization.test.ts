import assert from 'node:assert/strict';
import {
  ctaSemanticallySatisfied,
  fitSpeechToShot,
  normalizeStoryboardFieldLines,
  storyboardSpeechIssues,
  syncStoryboardSubtitles,
} from './studio.js';

const compact = '[0-3s] 素材：瓶身 环境：桌面 景别：特写 运镜：推进 构图：居中 镜头功能：钩子 画面：旋出膏体 配乐：轻快 台词：买家先看膏体。 字幕：旧字幕';
const normalized = normalizeStoryboardFieldLines(compact);
assert.match(normalized, /^\[0-3s\]\n素材：瓶身\n环境：桌面/m);
assert.match(normalized, /\n台词：买家先看膏体。\n字幕：旧字幕$/m);

const indented = `  [0-3s]
环境：桌面
台词：买家先看膏体。
字幕：旧字幕
  [3-6s]
环境：展台
台词：Message us for verified details.`;
const synced = syncStoryboardSubtitles(indented);
assert.match(synced, /字幕：买家先看膏体。/);
assert.match(synced, /台词：Message us for verified details\.\n字幕：Message us for verified details\./);

assert.equal(fitSpeechToShot('怎么判断这款包装是否适合你的品牌', 2), '怎么判断这款包装是否适合你的品牌');
assert.equal(fitSpeechToShot('先看膏体。再看包装是否适配。', 2.5), '先看膏体。');
assert.equal(fitSpeechToShot('How do you judge whether this package fits your brand?', 2), 'How do you judge whether this package fits your brand?');

assert.ok(storyboardSpeechIssues(`[0-2s]\n台词：怎么判断这款包装是否适合你的品牌？`).length > 0);
assert.equal(ctaSemanticallySatisfied('Message us for verified product details.', '引导跳转WhatsApp以触达'), true);
assert.equal(ctaSemanticallySatisfied('Read the catalog.', '引导跳转WhatsApp以触达'), false);

console.log('studio script normalization tests passed');
