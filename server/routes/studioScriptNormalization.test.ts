import assert from 'node:assert/strict';
import {
  applySafeStoryboardSpeechFallback,
  clearStoryboardSpeech,
  ctaSemanticallySatisfied,
  dedupeStoryboardFieldLines,
  ensureSelectedProductNamesInScript,
  fitStoryboardSpeech,
  fitSpeechToShot,
  isPackagingOnlyProductInfo,
  normalizeStoryboardFieldLines,
  openingMatchesCooperationRoute,
  productVoicePlanSupportsTheme,
  repairMaterialScript,
  restoreProductStoryboardBoundaries,
  unsupportedNumericClaims,
  storyboardSpeechIssues,
  syncStoryboardSubtitles,
} from './studio.js';

const compact = '[0-3s] 素材：瓶身 环境：桌面 景别：特写 运镜：推进 构图：居中 镜头功能：钩子 画面：旋出膏体 配乐：轻快 台词：买家先看膏体。 字幕：旧字幕';
const normalized = normalizeStoryboardFieldLines(compact);
assert.match(normalized, /^\[0-3s\]\n素材：瓶身\n环境：桌面/m);
assert.match(normalized, /\n台词：买家先看膏体。\n字幕：旧字幕$/m);
assert.match(normalizeStoryboardFieldLines('  [0-3s]\n环境：桌面\n- [3-6s]\n环境：展台\n2. [6-9s]\n环境：仓库'), /^\[0-3s\][\s\S]*^\[3-6s\][\s\S]*^\[6-9s\]/m);
const deduped = dedupeStoryboardFieldLines('[0-3s]\n素材：瓶身\n素材：重复瓶身\n环境：桌面\n台词：无\n字幕：无');
assert.equal((deduped.match(/^素材[：:]/gm) || []).length, 1);
assert.match(deduped, /^素材：瓶身$/m);
const restored = restoreProductStoryboardBoundaries('[0-3s]\n环境：桌面\n台词：第一句\n字幕：第一句\n环境：展台\n台词：第二句\n字幕：第二句\n[6-9s]\n环境：仓库\n台词：第三句\n字幕：第三句');
assert.equal((restored.match(/^\[[^\]]+\]$/gm) || []).length, 3);
assert.equal((restored.match(/^环境[：:]/gm) || []).length, 3);

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
assert.equal(fitSpeechToShot('Brand founder, please carefully compare these two real packaging options directly now.', 4.5), 'compare these two real packaging options.');
assert.equal(fitSpeechToShot('品牌方，你是否正在担心这款包装到底是否适合你的品牌？', 5), '是否担心包装是否适合你的品牌？');
const realMaterialOverflow = '品牌方，你是否正在担心这款包装是否真正适合当前品牌产品？';
assert.match(storyboardSpeechIssues(`[0-5s]\n台词：${realMaterialOverflow}`)[0] ?? '', /口播预计6\.4秒，超过镜头5\.0秒/);
const realMaterialFitted = fitSpeechToShot(realMaterialOverflow, 5);
assert.equal(realMaterialFitted, '是否担心包装是否适合品牌产品？');
assert.equal(storyboardSpeechIssues(`[0-5s]\n台词：${realMaterialFitted}`).length, 0);

const cloneWithSlightSpeechOverflow = `[0-4s]
环境：桌面
台词：品牌方，你是否正在担心包装是否真正很适合品牌？
字幕：品牌方，你是否正在担心包装是否真正很适合品牌？`;
assert.match(storyboardSpeechIssues(cloneWithSlightSpeechOverflow)[0] ?? '', /口播预计5\.3秒，超过镜头4\.0秒/);
const fittedCloneSpeech = syncStoryboardSubtitles(fitStoryboardSpeech(cloneWithSlightSpeechOverflow));
assert.match(fittedCloneSpeech, /^台词：是否担心包装是否很适合品牌？\n字幕：是否担心包装是否很适合品牌？$/m);
assert.equal(storyboardSpeechIssues(fittedCloneSpeech).length, 0);
assert.match(clearStoryboardSpeech('[0-4s]\n  台词：Original voice\n  字幕：Original caption'), /^台词：无\n字幕：无$/m);

const severeCloneVoice = '品牌方这是一个非常非常漫长而且包含大量重复修饰语以及许多无法在短镜头中完整表达的产品包装判断问题。';
const cloneWithSevereSpeechOverflow = `[0-4s]\n台词：${severeCloneVoice}\n字幕：${severeCloneVoice}`;
const unchangedSevereClone = syncStoryboardSubtitles(fitStoryboardSpeech(cloneWithSevereSpeechOverflow));
assert.match(unchangedSevereClone, new RegExp(`^台词：${severeCloneVoice}$`, 'm'));
assert.ok(storyboardSpeechIssues(unchangedSevereClone).length > 0);

const materialWithSlightSpeechOverflow = `[0-5s]
素材：精华液滴落肌肤微距
环境：桌面
景别：特写
运镜：固定
构图：产品居中
镜头功能：买家钩子
画面：Mock Hydra Serum Dropper Bottle 居中展示
配乐：轻节奏
台词：品牌方，你是否正在担心这款包装到底是否适合你的品牌？
字幕：品牌方，你是否正在担心这款包装到底是否适合你的品牌？
[5-10s]
素材：工厂气动设备特写
环境：工厂
景别：近景
运镜：固定
构图：设备居中
镜头功能：产品证据
画面：Mock Barrier Cream Airless Jar 居中展示
配乐：环境声
台词：看两款真实包装。
字幕：看两款真实包装。`;
const repairedMaterialSpeech = syncStoryboardSubtitles(repairMaterialScript(materialWithSlightSpeechOverflow, '产品名称：Mock Hydra Serum Dropper Bottle\n产品名称：Mock Barrier Cream Airless Jar', '精华液滴落肌肤微距\n工厂气动设备特写'));
assert.deepEqual(repairedMaterialSpeech.match(/^\[[^\]]+\]$/gm), ['[0-5s]', '[5-10s]']);
assert.match(repairedMaterialSpeech, /^台词：是否担心包装是否适合你的品牌？\n字幕：是否担心包装是否适合你的品牌？$/m);
assert.equal(storyboardSpeechIssues(repairedMaterialSpeech).length, 0);

const namedMaterial = ensureSelectedProductNamesInScript(materialWithSlightSpeechOverflow.replace(/Mock (?:Hydra Serum Dropper Bottle|Barrier Cream Airless Jar)/g, 'selected packaging'), '产品名称：Mock Hydra Serum Dropper Bottle\n产品名称：Mock Barrier Cream Airless Jar');
assert.match(namedMaterial, /^画面：[^\n]*Mock Hydra Serum Dropper Bottle[^\n]*Mock Barrier Cream Airless Jar$/m);
assert.match(syncStoryboardSubtitles(namedMaterial), /^画面：[^\n]*Mock Hydra Serum Dropper Bottle[^\n]*Mock Barrier Cream Airless Jar$/m);

const firstSceneWithoutVisual = `[0-4s]
环境：桌面
台词：品牌方，包装难选吗？
字幕：品牌方，包装难选吗？
[4-8s]
环境：展台
画面：两款空包装并排
台词：查看包装。
字幕：查看包装。`;
const namesInjectedIntoRealVisual = ensureSelectedProductNamesInScript(firstSceneWithoutVisual, '产品名称：Mock Hydra Serum Dropper Bottle\n产品名称：Mock Barrier Cream Airless Jar');
assert.doesNotMatch(namesInjectedIntoRealVisual.split('[4-8s]')[0] || '', /Mock Hydra|Mock Barrier/);
assert.match(namesInjectedIntoRealVisual, /^画面：两款空包装并排；展示 Mock Hydra Serum Dropper Bottle；展示 Mock Barrier Cream Airless Jar$/m);
const twoPackagingNames = '产品名称：Mock Hydra Serum Dropper Bottle\n产品名称：Mock Barrier Cream Airless Jar';
const namesPreservedAfterFallback = ensureSelectedProductNamesInScript(
  applySafeStoryboardSpeechFallback(firstSceneWithoutVisual, twoPackagingNames, 'customization', '引导跳转WhatsApp以触达', 'zh'),
  twoPackagingNames,
);
assert.match(namesPreservedAfterFallback, /^画面：两款空包装并排；展示 Mock Hydra Serum Dropper Bottle；展示 Mock Barrier Cream Airless Jar$/m);

assert.ok(storyboardSpeechIssues(`[0-2s]\n台词：怎么判断这款包装是否适合你的品牌？`).length > 0);
assert.equal(ctaSemanticallySatisfied('Message us for verified product details.', '引导跳转WhatsApp以触达'), true);
assert.equal(ctaSemanticallySatisfied('Read the catalog.', '引导跳转WhatsApp以触达'), false);

assert.deepEqual(unsupportedNumericClaims('运镜：镜头向前推进1cm\n画面：滴管抬起0.5cm', '产品名称：测试精华'), []);
assert.deepEqual(unsupportedNumericClaims('构图：产品占画面70%\n运镜：推进至80%\n字幕：提升70%\n画面：瓶身高度10cm', '产品名称：测试精华'), ['70%', '10cm']);
assert.deepEqual(unsupportedNumericClaims('画面：摆放3个空白标签样稿\n字幕：每箱3个', '产品名称：测试精华'), ['3个']);
const multiProductInfo = `选定产品 1：Mock Hydra Serum Dropper Bottle
产品名称：Mock Hydra Serum Dropper Bottle
产品卖点：30ml透明玻璃滴管瓶

选定产品 2：Mock Barrier Cream Airless Jar
产品名称：Mock Barrier Cream Airless Jar
产品卖点：50\u200bg真空泵霜瓶；支持标签、外盒和泵头颜色定制`;
assert.deepEqual(unsupportedNumericClaims(
  '台词：Mock Barrier Cream Airless Jar is a 50g vacuum pump jar.\n字幕：Mock Barrier Cream Airless Jar is a 50g vacuum pump jar.',
  multiProductInfo,
), []);
assert.deepEqual(unsupportedNumericClaims('台词：This jar is 60g.\n字幕：This jar is 60g.', multiProductInfo), ['60g']);

assert.equal(isPackagingOnlyProductInfo('所属类目：美妆个护\n产品卖点：30ml透明玻璃滴管瓶；适合精华液包装展示'), true);
assert.equal(isPackagingOnlyProductInfo('所属类目：美妆个护\n产品卖点：精华液膏体质地轻盈，适合涂抹'), false);
assert.equal(productVoicePlanSupportsTheme(['Brand founders, verify visible packaging details.'], 'product_proof'), true);
assert.equal(productVoicePlanSupportsTheme(['Brand founders, which packaging fits?'], 'use_case'), true);
assert.equal(productVoicePlanSupportsTheme(['Brand founders, compare visible packaging.'], 'comparison'), true);
assert.equal(productVoicePlanSupportsTheme(['As a brand founder, I struggle with packaging.'], 'product_proof'), false);

const longFiveSceneScript = Array.from({ length: 5 }, (_, index) => `[${index * 4}-${(index + 1) * 4}s]
素材：素材${index + 1}
环境：测试桌面
景别：特写
运镜：固定
构图：产品居中
镜头功能：${index === 0 ? '钩子' : index === 4 ? 'CTA' : '证据'}
画面：保留原始画面${index + 1}
配乐：轻节奏
台词：This narration is deliberately much too long for a four second scene and must be replaced as one complete sentence.
字幕：This narration is deliberately much too long for a four second scene and must be replaced as one complete sentence.`).join('\n');
assert.equal(storyboardSpeechIssues(longFiveSceneScript).length, 5);
const fallbackProductInfo = '产品名称：Mock Hydra Serum Dropper Bottle\n产品名称：Mock Barrier Cream Airless Jar';
const visuallyNamedFiveSceneScript = ensureSelectedProductNamesInScript(longFiveSceneScript, fallbackProductInfo);
const fallbackThemes = ['buyer_pain', 'product_proof', 'use_case', 'supplier_capability', 'customization', 'comparison', 'customer_case', 'trend', 'talking_head'] as const;
for (const theme of fallbackThemes) {
  const safeFiveSceneScript = applySafeStoryboardSpeechFallback(
    visuallyNamedFiveSceneScript,
    fallbackProductInfo,
    theme,
    '引导跳转WhatsApp以触达',
    'en',
  );
  assert.equal(storyboardSpeechIssues(safeFiveSceneScript).length, 0, `${theme} fallback should fit five four-second shots`);
  const firstVoice = safeFiveSceneScript.match(/^台词[：:]\s*(.+)$/m)?.[1] || '';
  assert.equal(firstVoice.split(/\s+/).filter(Boolean).length <= 7, true, `${theme} hook should use at most seven words`);
  assert.equal(productVoicePlanSupportsTheme([firstVoice], theme), true, `${theme} hook should match its theme`);
  assert.match(safeFiveSceneScript, /^画面：[^\n]*Mock Hydra Serum Dropper Bottle[^\n]*Mock Barrier Cream Airless Jar$/m);
  assert.match(safeFiveSceneScript, /^台词：Message us on WhatsApp\.$/m);
  assert.equal((safeFiveSceneScript.match(/^素材：素材\d$/gm) || []).length, 5);
  assert.equal((safeFiveSceneScript.match(/^画面：/gm) || []).length, 5);
  for (const block of safeFiveSceneScript.split(/(?=^\[\d)/m).filter(item => /^\[\d/.test(item))) {
    assert.equal(block.match(/^台词[：:]\s*(.+)$/m)?.[1], block.match(/^字幕[：:]\s*(.+)$/m)?.[1]);
  }
}

const chineseFiveSceneScript = Array.from({ length: 5 }, (_, index) => {
  const start = index * 4;
  const end = index === 4 ? 18 : start + 4;
  return `[${start}-${end}s]
素材：中文素材${index + 1}
环境：测试桌面
景别：特写
运镜：固定
构图：产品居中
镜头功能：${index === 0 ? '钩子' : index === 4 ? 'CTA' : '证据'}
画面：保留中文原始画面${index + 1}
配乐：轻节奏
台词：品牌方这是一段明显无法放进当前短镜头而且必须被替换的完整超长中文口播。
字幕：品牌方这是一段明显无法放进当前短镜头而且必须被替换的完整超长中文口播。`;
}).join('\n');
assert.equal(storyboardSpeechIssues(chineseFiveSceneScript).length, 5);
const visuallyNamedChineseScript = ensureSelectedProductNamesInScript(chineseFiveSceneScript, fallbackProductInfo);
for (const theme of fallbackThemes) {
  const safeChineseScript = applySafeStoryboardSpeechFallback(
    visuallyNamedChineseScript,
    fallbackProductInfo,
    theme,
    '引导跳转WhatsApp以触达',
    'zh',
  );
  assert.equal(storyboardSpeechIssues(safeChineseScript).length, 0, `${theme} Chinese fallback should fit four-second shots and a two-second CTA`);
  const firstVoice = safeChineseScript.match(/^台词[：:]\s*(.+)$/m)?.[1] || '';
  assert.equal(productVoicePlanSupportsTheme([firstVoice], theme), true, `${theme} Chinese hook should match its theme`);
  assert.match(safeChineseScript, /^画面：[^\n]*Mock Hydra Serum Dropper Bottle[^\n]*Mock Barrier Cream Airless Jar$/m);
  assert.match(safeChineseScript, /^台词：请用WhatsApp联系。$/m);
  assert.match(safeChineseScript, /^字幕：请用WhatsApp联系。$/m);
  assert.equal((safeChineseScript.match(/^素材：中文素材\d$/gm) || []).length, 5);
}

const noAsrCloneScript = clearStoryboardSpeech(visuallyNamedFiveSceneScript);
assert.equal(storyboardSpeechIssues(noAsrCloneScript).length, 0);
assert.equal((noAsrCloneScript.match(/^台词：无$/gm) || []).length, 5);
assert.equal((noAsrCloneScript.match(/^字幕：无$/gm) || []).length, 5);
assert.match(noAsrCloneScript, /^画面：[^\n]*Mock Hydra Serum Dropper Bottle[^\n]*Mock Barrier Cream Airless Jar$/m);
assert.equal((noAsrCloneScript.match(/^素材：素材\d$/gm) || []).length, 5);
assert.equal((noAsrCloneScript.match(/^环境：测试桌面$/gm) || []).length, 5);
assert.equal((noAsrCloneScript.match(/^景别：特写$/gm) || []).length, 5);
assert.deepEqual(noAsrCloneScript.match(/^\[[^\]]+\]$/gm), visuallyNamedFiveSceneScript.match(/^\[[^\]]+\]$/gm));

const materialWithValidTimingButNoBuyer = visuallyNamedChineseScript
  .replace(/^台词：[^\n]+$/gm, '台词：看看包装。')
  .replace(/^字幕：[^\n]+$/gm, '字幕：看看包装。');
assert.equal(storyboardSpeechIssues(materialWithValidTimingButNoBuyer).length, 0);
const buyerPainFallback = applySafeStoryboardSpeechFallback(
  materialWithValidTimingButNoBuyer,
  fallbackProductInfo,
  'buyer_pain',
  '引导跳转WhatsApp以触达',
  'zh',
);
const buyerPainOpening = buyerPainFallback.match(/^台词[：:]\s*(.+)$/m)?.[1] || '';
assert.equal(openingMatchesCooperationRoute(buyerPainOpening, 'oem_odm'), true);
assert.equal(productVoicePlanSupportsTheme([buyerPainOpening], 'buyer_pain'), true);
assert.equal(storyboardSpeechIssues(buyerPainFallback).length, 0);
assert.deepEqual(buyerPainFallback.match(/^\[[^\]]+\]$/gm), materialWithValidTimingButNoBuyer.match(/^\[[^\]]+\]$/gm));
assert.equal((buyerPainFallback.match(/^素材：中文素材\d$/gm) || []).length, 5);
assert.equal((buyerPainFallback.match(/^画面：/gm) || []).length, 5);

console.log('studio script normalization tests passed');
