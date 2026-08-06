import assert from 'node:assert/strict';
import {
  assessScriptStrategyBrief,
  buildScriptContentPlan,
  createScriptStrategyBrief,
  hasThemeMinimumVisuals,
  type ContentTheme,
  type ScriptEvidence,
  type ScriptFact,
  type ScriptGenerationMode,
} from './scriptBrief.js';

const modes: Array<{ id: ScriptGenerationMode; label: string }> = [
  { id: 'product_info', label: '产品资料' },
  { id: 'asset_library', label: '素材库' },
  { id: 'viral_remix', label: '爆款复刻' },
];

const themes: Array<{ id: ContentTheme; label: string }> = [
  { id: 'buyer_pain', label: '买家痛点' },
  { id: 'product_proof', label: '产品证明' },
  { id: 'use_case', label: '使用场景' },
  { id: 'supplier_capability', label: '供应能力' },
  { id: 'customization', label: '定制能力' },
  { id: 'comparison', label: '选型对比' },
  { id: 'customer_case', label: '客户案例' },
  { id: 'trend', label: '趋势热点' },
  { id: 'talking_head', label: '真人口播' },
];

// Complete, fictional fixture: it is deliberately kept in test code and is
// never written to a tenant profile or presented as a real company claim.
const approvedFacts: ScriptFact[] = [
  { label: '产品 A', value: 'Mock Hydra Serum 30ml，透明玻璃滴管瓶', source: 'product' },
  { label: '产品 B', value: 'Mock Barrier Cream 50g，真空泵瓶', source: 'product' },
  { label: '共同对比维度', value: '剂型、包装结构与适用陈列场景', source: 'user_confirmed' },
  { label: '工厂证明', value: '模拟灌装线与逐批外观质检记录', source: 'user_confirmed' },
  { label: '定制触点', value: '模拟标签、外盒与瓶器样品可供画面演示', source: 'user_confirmed' },
  { label: '客户案例授权', value: 'Mock Beauty Lab 已授权测试环境展示打样流程', source: 'user_confirmed' },
  { label: '趋势来源', value: 'Mock Retail Signal，2026-08-01，补水精华陈列观察', source: 'user_confirmed' },
];

const availableEvidence: ScriptEvidence[] = [
  {
    label: '模拟产品与细节素材', type: 'material', source: 'fixture://product-detail',
    visualCapabilities: ['product_identity', 'product_detail', 'demo_action', 'scene_context', 'problem_contrast'],
  },
  {
    label: '模拟产线与质检素材', type: 'factory', source: 'fixture://factory-proof',
    visualCapabilities: ['production_process', 'quality_check', 'fulfillment_process'],
  },
  {
    label: '模拟包装打样素材', type: 'material', source: 'fixture://customization',
    visualCapabilities: ['packaging_customization', 'sample_prototype', 'specification_comparison'],
  },
  {
    label: '模拟双产品同框', type: 'material', source: 'fixture://comparison-pair',
    visualCapabilities: ['comparison_pair'],
  },
  {
    label: '模拟已授权客户案例', type: 'case', source: 'fixture://authorized-case',
    visualCapabilities: ['customer_context', 'case_process', 'case_result_visual'],
  },
  {
    label: '模拟带日期趋势来源', type: 'trend_source', source: 'fixture://dated-trend-source',
    visualCapabilities: ['trend_source_visual'],
  },
  {
    label: '模拟出镜产品经理', type: 'material', source: 'fixture://presenter',
    visualCapabilities: ['presenter_identity'],
  },
];

const results: string[] = [];
for (const mode of modes) {
  for (const theme of themes) {
    const brief = createScriptStrategyBrief({
      generationMode: mode.id,
      contentTheme: theme.id,
      cooperationRoute: 'oem_odm',
      targetBuyerRoles: ['海外美妆品牌产品经理'],
      targetMarkets: ['东南亚'],
      languagePlan: ['英语'],
      platform: 'tiktok',
      targetDurationSec: 20,
      approvedFacts,
      availableEvidence,
      primaryCta: 'Message us on WhatsApp for the verified product sheet.',
      verifiedCtaChannels: ['whatsapp'],
      missingHighRiskFacts: [],
    });

    const readiness = assessScriptStrategyBrief(brief);
    const plan = buildScriptContentPlan(brief);
    assert.equal(readiness.status, 'ready', `${mode.label} × ${theme.label}: ${readiness.blockers.join('；')}`);
    assert.equal(hasThemeMinimumVisuals(brief), true, `${mode.label} × ${theme.label}: 缺少主题画面能力`);
    assert.equal(plan.beats.length, 5, `${mode.label} × ${theme.label}: 内容节拍不完整`);
    assert.equal(plan.beats.at(-1)?.function, 'cta', `${mode.label} × ${theme.label}: CTA 不是最后一步`);
    assert.match(plan.beats.at(-1)?.instruction ?? '', /WhatsApp/, `${mode.label} × ${theme.label}: CTA 未继承`);
    assert.ok(plan.hookFormula.trim(), `${mode.label} × ${theme.label}: 缺少主题钩子`);
    assert.ok(plan.modeEvidenceRule.trim(), `${mode.label} × ${theme.label}: 缺少模式证据边界`);
    results.push(`PASS ${mode.label} × ${theme.label}`);
  }
}

assert.equal(results.length, 27);
console.log(results.join('\n'));
console.log(`script generation matrix passed ${results.length}/27 combinations`);
