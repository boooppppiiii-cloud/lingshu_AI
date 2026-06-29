import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resetDemoUsage } from '../lib/demo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '../../data/enterprise.json');
const TEMPLATES_FILE = path.join(__dirname, '../../data/demo-templates.json');
const DATA_DIR = path.join(__dirname, '../../data');

export interface EnterpriseProfile {
  company: {
    name: string;
    industry: string;
    companyType?: string;
    mainMarkets: string;
    primaryLanguages?: string;
    founded: string;
    description: string;
  };
  products: {
    categories: string;
    priceRange: string;
    moq: string;
    certifications: string;
    highlights: string;
  };
  brand: {
    tone: string;
    style: string;
    taboos: string;
    usp: string;
    preferredLanguages?: string;
  };
  strategy?: {
    currentGoal?: string;
    focusProducts?: string;
    focusMarkets?: string;
    excludedMarkets?: string;
    pricingStrategy?: string;
    minMargin?: string;
    agentAutonomy?: string;
  };
  customers?: {
    targetProfiles?: string;
    highValueSignals?: string;
    lowQualitySignals?: string;
    commonQuestions?: string;
    followupStyle?: string;
  };
  operations?: {
    leadTime?: string;
    customization?: string;
    logistics?: string;
    paymentTerms?: string;
    riskNotes?: string;
  };
  agentLearning?: {
    provenAngles?: string;
    weakAngles?: string;
    pendingAssumptions?: string;
    userCorrections?: string;
  };
  knowledge: string;
}

function readProfile(): EnterpriseProfile {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      company: { name: '', industry: '', companyType: '', mainMarkets: '', primaryLanguages: '英语、阿拉伯语', founded: '', description: '' },
      products: { categories: '', priceRange: '', moq: '', certifications: '', highlights: '' },
      brand: { tone: '', style: '专业', taboos: '', usp: '', preferredLanguages: '英语、阿拉伯语' },
      strategy: { currentGoal: '', focusProducts: '', focusMarkets: '', excludedMarkets: '', pricingStrategy: '', minMargin: '', agentAutonomy: '建议优先，关键动作需确认' },
      customers: { targetProfiles: '', highValueSignals: '', lowQualitySignals: '', commonQuestions: '', followupStyle: '' },
      operations: { leadTime: '', customization: '', logistics: '', paymentTerms: '', riskNotes: '' },
      agentLearning: { provenAngles: '', weakAngles: '', pendingAssumptions: '', userCorrections: '' },
      knowledge: '',
    };
  }
}

interface DemoTemplate {
  id: string;
  name: string;
  description: string;
  profile: EnterpriseProfile;
}

function readTemplates(): DemoTemplate[] {
  try {
    return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8')) as DemoTemplate[];
  } catch {
    return [];
  }
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(value, null, 2), 'utf8');
}

export function buildEnterpriseContext(profile: EnterpriseProfile): string {
  const parts: string[] = [];
  if (profile.company.name) parts.push(`公司名称：${profile.company.name}`);
  if (profile.company.industry) parts.push(`行业类目：${profile.company.industry}`);
  if (profile.company.companyType) parts.push(`企业类型：${profile.company.companyType}`);
  if (profile.company.mainMarkets) parts.push(`主攻市场：${profile.company.mainMarkets}`);
  if (profile.company.primaryLanguages) parts.push(`主要业务语言：${profile.company.primaryLanguages}`);
  if (profile.company.description) parts.push(`公司简介：${profile.company.description}`);
  if (profile.products.categories) parts.push(`主营产品：${profile.products.categories}`);
  if (profile.products.priceRange) parts.push(`价格区间：${profile.products.priceRange}`);
  if (profile.products.moq) parts.push(`起订量：${profile.products.moq}`);
  if (profile.products.certifications) parts.push(`认证资质：${profile.products.certifications}`);
  if (profile.products.highlights) parts.push(`产品优势：${profile.products.highlights}`);
  if (profile.brand.usp) parts.push(`核心卖点：${profile.brand.usp}`);
  if (profile.brand.tone) parts.push(`品牌调性：${profile.brand.tone}`);
  if (profile.brand.preferredLanguages) parts.push(`首选输出语言：${profile.brand.preferredLanguages}`);
  if (profile.brand.taboos) parts.push(`禁忌话题：${profile.brand.taboos}`);
  if (profile.strategy?.currentGoal) parts.push(`当前经营目标：${profile.strategy.currentGoal}`);
  if (profile.strategy?.focusProducts) parts.push(`重点产品：${profile.strategy.focusProducts}`);
  if (profile.strategy?.focusMarkets) parts.push(`重点市场：${profile.strategy.focusMarkets}`);
  if (profile.strategy?.excludedMarkets) parts.push(`暂不经营市场：${profile.strategy.excludedMarkets}`);
  if (profile.strategy?.pricingStrategy) parts.push(`价格策略：${profile.strategy.pricingStrategy}`);
  if (profile.strategy?.minMargin) parts.push(`最低利润要求：${profile.strategy.minMargin}`);
  if (profile.strategy?.agentAutonomy) parts.push(`Agent 执行权限：${profile.strategy.agentAutonomy}`);
  if (profile.customers?.targetProfiles) parts.push(`目标客户画像：${profile.customers.targetProfiles}`);
  if (profile.customers?.highValueSignals) parts.push(`高价值客户信号：${profile.customers.highValueSignals}`);
  if (profile.customers?.lowQualitySignals) parts.push(`低质量询盘特征：${profile.customers.lowQualitySignals}`);
  if (profile.customers?.commonQuestions) parts.push(`客户常问问题：${profile.customers.commonQuestions}`);
  if (profile.customers?.followupStyle) parts.push(`跟进偏好：${profile.customers.followupStyle}`);
  if (profile.operations?.leadTime) parts.push(`交期能力：${profile.operations.leadTime}`);
  if (profile.operations?.customization) parts.push(`定制能力：${profile.operations.customization}`);
  if (profile.operations?.logistics) parts.push(`物流履约：${profile.operations.logistics}`);
  if (profile.operations?.paymentTerms) parts.push(`付款条款：${profile.operations.paymentTerms}`);
  if (profile.operations?.riskNotes) parts.push(`履约风险提示：${profile.operations.riskNotes}`);
  if (profile.agentLearning?.provenAngles) parts.push(`已验证有效角度：${profile.agentLearning.provenAngles}`);
  if (profile.agentLearning?.weakAngles) parts.push(`低效角度/需降权：${profile.agentLearning.weakAngles}`);
  if (profile.agentLearning?.pendingAssumptions) parts.push(`待用户确认推断：${profile.agentLearning.pendingAssumptions}`);
  if (profile.agentLearning?.userCorrections) parts.push(`用户纠正偏好：${profile.agentLearning.userCorrections}`);
  if (profile.knowledge) parts.push(`补充知识：${profile.knowledge}`);
  return parts.join('\n');
}

export const enterpriseRouter = Router();

enterpriseRouter.get('/profile', (_req, res) => {
  res.json(readProfile());
});

enterpriseRouter.post('/profile', (req, res) => {
  const profile = req.body as EnterpriseProfile;
  fs.writeFileSync(DATA_FILE, JSON.stringify(profile, null, 2), 'utf8');
  res.json({ ok: true });
});

enterpriseRouter.get('/context', (_req, res) => {
  const profile = readProfile();
  res.json({ context: buildEnterpriseContext(profile) });
});

enterpriseRouter.get('/demo/templates', (_req, res) => {
  res.json(readTemplates().map(({ id, name, description }) => ({ id, name, description })));
});

enterpriseRouter.post('/demo/templates/:id/apply', (req, res) => {
  const template = readTemplates().find(t => t.id === req.params.id);
  if (!template) { res.status(404).json({ error: 'template not found' }); return; }
  fs.writeFileSync(DATA_FILE, JSON.stringify(template.profile, null, 2), 'utf8');
  res.json({ ok: true, profile: template.profile });
});

enterpriseRouter.post('/demo/reset', (_req, res) => {
  const template = readTemplates()[0];
  if (template) fs.writeFileSync(DATA_FILE, JSON.stringify(template.profile, null, 2), 'utf8');
  writeJson('channels.json', []);
  writeJson('plugins.json', []);
  writeJson('tasks.json', []);
  writeJson('studio-projects.json', []);
  resetDemoUsage();
  res.json({ ok: true, profile: template?.profile ?? readProfile() });
});
