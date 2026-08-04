import assert from 'node:assert/strict';
import { assessScriptStrategyBrief, buildScriptContentPlan, createScriptStrategyBrief, hasThemeMinimumVisuals, resolveCooperationRoute, routeStrategyDefaults } from './scriptBrief.js';

assert.deepEqual(resolveCooperationRoute({ enabledRoutes: ['oem_odm'] }), { requiresSelection: false, route: 'oem_odm' });
assert.deepEqual(resolveCooperationRoute({ enabledRoutes: ['oem_odm', 'wholesale_distribution'] }), {
  requiresSelection: true,
  availableRoutes: ['oem_odm', 'wholesale_distribution'],
});
assert.deepEqual(routeStrategyDefaults({
  enabledRoutes: ['oem_odm'],
  routeStrategies: { oem_odm: { targetBuyerRoles: ['brand_founder'], primaryCta: 'request_sample', verifiedCtaChannels: ['whatsapp'] } },
}, 'oem_odm'), { targetBuyerRoles: ['brand_founder'], primaryCta: 'request_sample', verifiedCtaChannels: ['whatsapp'] });

const incomplete = createScriptStrategyBrief();
assert.equal(assessScriptStrategyBrief(incomplete).status, 'blocked');

const ready = createScriptStrategyBrief({
  contentTheme: 'customization',
  approvedFacts: [{ label: '产品', value: '护肤精华', source: 'product' }],
  availableEvidence: [{ label: '包装样品视频', type: 'material', visualCapabilities: ['product_identity', 'packaging_customization'] }],
  primaryCta: 'request_sample',
  verifiedCtaChannels: ['whatsapp'],
  targetBuyerRoles: ['brand_founder'],
  targetMarkets: ['Kazakhstan'],
});
assert.equal(assessScriptStrategyBrief(ready).status, 'ready');

const productProofWithVisualButWithoutDocument = createScriptStrategyBrief({
  contentTheme: 'product_proof',
  approvedFacts: [{ label: '产品', value: '护肤精华' }],
  availableEvidence: [{ label: '瓶身特写', type: 'material', visualCapabilities: ['product_identity', 'product_detail'] }],
  primaryCta: 'request_catalog',
  verifiedCtaChannels: ['whatsapp'],
});
assert.equal(assessScriptStrategyBrief(productProofWithVisualButWithoutDocument).status, 'needs_information');
assert.ok(!assessScriptStrategyBrief(productProofWithVisualButWithoutDocument).blockers.some(item => item.includes('主题')));

assert.equal(hasThemeMinimumVisuals(createScriptStrategyBrief({
  contentTheme: 'supplier_capability',
  availableEvidence: [{ label: '灌装实拍', type: 'factory', visualCapabilities: ['production_process'] }],
})), true);
assert.equal(hasThemeMinimumVisuals(createScriptStrategyBrief({
  contentTheme: 'product_proof',
  availableEvidence: [{ label: '产品整体', type: 'material', visualCapabilities: ['product_identity'] }],
})), false);
const productProofWithRelatedButNotIdealVisual = createScriptStrategyBrief({
  contentTheme: 'product_proof',
  approvedFacts: [{ label: '产品', value: '护肤精华' }],
  availableEvidence: [{ label: '产品整体', type: 'material', visualCapabilities: ['product_identity'] }],
  primaryCta: 'request_catalog',
  verifiedCtaChannels: ['whatsapp'],
});
assert.notEqual(assessScriptStrategyBrief(productProofWithRelatedButNotIdealVisual).status, 'blocked');

const strategyPlan = buildScriptContentPlan(createScriptStrategyBrief({
  cooperationRoute: 'oem_odm',
  contentTheme: 'customization',
  approvedFacts: [{ label: '包装样品', value: '无品牌瓶器、标签和外盒样品' }],
  availableEvidence: [{ label: '包装组合实拍', type: 'material' }],
  primaryCta: '发送定制需求',
}));
assert.equal(strategyPlan.targetBuyer, '品牌创始人');
assert.match(strategyPlan.hookFormula, /包装|样品|规格/);
assert.deepEqual(strategyPlan.beats.map(item => item.function), ['hook', 'buyer_problem', 'evidence', 'decision_guidance', 'cta']);
assert.match(strategyPlan.modeEvidenceRule, /建议补拍/);
