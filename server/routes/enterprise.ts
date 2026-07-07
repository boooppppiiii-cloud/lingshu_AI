import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes, randomUUID } from 'crypto';
import type { Request } from 'express';
import { resetDemoUsage } from '../lib/demo.js';
import { auth } from '../storage/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '../../data/enterprise.json');
const TEMPLATES_FILE = path.join(__dirname, '../../data/demo-templates.json');
const DATA_DIR = path.join(__dirname, '../../data');
const ASSETS_DIR = path.join(DATA_DIR, 'enterprise-assets');

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
    items?: Array<{
      sku?: string;
      name: string;
      category?: string;
      color?: string;
      size?: string;
      tagPrice?: string;
      material?: string;
      imageUrl?: string;
      priceRange?: string;
      moq?: string;
      certifications?: string;
      highlights?: string;
      attributes?: Record<string, unknown>;
      images?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
      videos?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
      documents?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
    }>;
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
  customerOps?: {
    bigDealThreshold?: string;
    takeoverOwner?: string;
    notificationChannel?: string;
    workingTimezone?: string;
    workingHours?: string;
    automationPreference?: string;
    extraMissingFields?: string;
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
  integrations?: {
    productApi?: {
      tenantId: string;
      apiKey: string;
      createdAt: string;
      lastIngestedAt?: string;
      lastProductName?: string;
    };
  };
  knowledge: string;
}

function readProfile(): EnterpriseProfile {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return normalizeProfile({
      company: { name: '', industry: '', companyType: '', mainMarkets: '', primaryLanguages: '', founded: '', description: '' },
      products: {
        categories: '',
        priceRange: '',
        moq: '',
        certifications: '',
        highlights: '',
        items: [],
      },
      brand: { tone: '', style: '', taboos: '', usp: '', preferredLanguages: '' },
      strategy: { currentGoal: '', focusProducts: '', focusMarkets: '', excludedMarkets: '', pricingStrategy: '', minMargin: '', agentAutonomy: '' },
      customers: { targetProfiles: '', highValueSignals: '', lowQualitySignals: '', commonQuestions: '', followupStyle: '' },
      customerOps: { bigDealThreshold: '', takeoverOwner: '', notificationChannel: '', workingTimezone: '', workingHours: '', automationPreference: '', extraMissingFields: '' },
      operations: { leadTime: '', customization: '', logistics: '', paymentTerms: '', riskNotes: '' },
      agentLearning: { provenAngles: '', weakAngles: '', pendingAssumptions: '', userCorrections: '' },
      knowledge: '',
    });
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

function ensureAssetsDir(): void {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

function safeStoredName(originalName: string): string {
  const ext = path.extname(originalName).slice(0, 16).replace(/[^a-zA-Z0-9.]/g, '');
  return `${Date.now()}-${randomUUID()}${ext}`;
}

function emptyProduct(index: number): NonNullable<EnterpriseProfile['products']['items']>[number] {
  return { name: `产品${index + 1}`, images: [], videos: [], documents: [] };
}

function normalizeProfile(profile: EnterpriseProfile): EnterpriseProfile {
  const products = profile.products ?? { categories: '', priceRange: '', moq: '', certifications: '', highlights: '' };
  const existing = Array.isArray(products.items) ? products.items : [];
  const items = existing.length
    ? existing.filter(item =>
      item.name || item.sku || item.category || item.priceRange || item.moq || item.certifications || item.highlights ||
      item.color || item.size || item.tagPrice || item.material || item.imageUrl ||
      item.images?.length || item.videos?.length || item.documents?.length
    ).map((item) => ({
      ...item,
      name: item.name || item.sku || '',
      images: Array.isArray(item.images) ? item.images : [],
      videos: Array.isArray(item.videos) ? item.videos : [],
      documents: Array.isArray(item.documents) ? item.documents : [],
    }))
    : [];
  return { ...profile, products: { ...products, items } };
}

function writeProfile(profile: EnterpriseProfile): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(normalizeProfile(profile), null, 2), 'utf8');
}

async function resolveTenantId(req: Request): Promise<string> {
  const id = await auth.verifyToken(req.headers.authorization);
  return id?.tenantId || String(req.query.tenantId || req.headers['x-tenant-id'] || 'local_tenant_default');
}

function publicProductApiInfo(profile: EnterpriseProfile) {
  const productApi = profile.integrations?.productApi;
  return {
    apiKey: productApi?.apiKey || '',
    tenantId: productApi?.tenantId || '',
    createdAt: productApi?.createdAt || '',
    lastIngestedAt: productApi?.lastIngestedAt || '',
    lastProductName: productApi?.lastProductName || '',
    docsUrl: '/api/overseas/enterprise/product-api/docs',
  };
}

function ensureProductApiKey(profile: EnterpriseProfile, tenantId: string): EnterpriseProfile {
  const current = profile.integrations?.productApi;
  if (current?.apiKey && current.tenantId === tenantId) return profile;
  return {
    ...profile,
    integrations: {
      ...profile.integrations,
      productApi: {
        tenantId,
        apiKey: `ls_prod_${randomBytes(24).toString('base64url')}`,
        createdAt: new Date().toISOString(),
      },
    },
  };
}

function productApiDocs(origin = '') {
  const base = origin ? `${origin}/api/v1/products` : '/api/v1/products';
  return {
    title: '灵枢产品 API 极简文档',
    auth: '请求头使用 x-api-key: <企业中心生成的 API Key>',
    endpoints: [
      {
        method: 'POST',
        path: `${base}/bulk`,
        description: '批量 upsert 商品。按 sku/货号去重；没有 sku 时按 name 去重。',
      },
      {
        method: 'GET',
        path: `${base}?limit=50`,
        description: '查询已接入商品，可选 sku 参数精确查询。',
      },
      {
        method: 'DELETE',
        path: `${base}/{sku}`,
        description: '按 sku 删除商品，也支持 DELETE /api/v1/products?sku=xxx。',
      },
    ],
    productFields: ['sku', 'name', 'color', 'size', 'tagPrice', 'material', 'imageUrl', 'highlights', 'attributes'],
    attributes: 'JSON 字段，用来承接服装类自由属性标签，例如 { "领型": "圆领", "袖长": "短袖", "季节": "夏季" }。',
    example: {
      products: [
        {
          sku: 'YW-TSHIRT-001',
          name: '纯棉圆领T恤',
          color: '黑色',
          size: 'S/M/L',
          tagPrice: '39.9',
          material: '100% cotton',
          imageUrl: 'https://example.com/sku-001.jpg',
          highlights: '不起球，适合中东夏季批发',
          attributes: { 领型: '圆领', 袖长: '短袖', 厚薄: '常规' },
        },
      ],
    },
  };
}

function readApiKey(req: Request) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return String(req.headers['x-api-key'] || bearer || '').trim();
}

function verifyProductApiKey(req: Request) {
  const profile = readProfile();
  const expected = profile.integrations?.productApi?.apiKey;
  const provided = readApiKey(req);
  return expected && provided && expected === provided ? profile : null;
}

type ApiProductInput = {
  sku?: unknown;
  name?: unknown;
  color?: unknown;
  size?: unknown;
  tagPrice?: unknown;
  material?: unknown;
  imageUrl?: unknown;
  highlights?: unknown;
  attributes?: unknown;
};

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function normalizeApiProduct(input: ApiProductInput): NonNullable<EnterpriseProfile['products']['items']>[number] | null {
  const sku = text(input.sku);
  const name = text(input.name) || sku;
  if (!name) return null;
  const imageUrl = text(input.imageUrl);
  return {
    sku,
    name,
    color: text(input.color),
    size: text(input.size),
    tagPrice: text(input.tagPrice),
    material: text(input.material),
    imageUrl,
    highlights: text(input.highlights),
    attributes: input.attributes && typeof input.attributes === 'object' && !Array.isArray(input.attributes) ? input.attributes as Record<string, unknown> : {},
    images: imageUrl ? [{ name: '商品图片URL', type: 'image/url', size: 0, updatedAt: new Date().toISOString(), url: imageUrl }] : [],
    videos: [],
    documents: [],
  };
}

function upsertProductItems(existing: NonNullable<EnterpriseProfile['products']['items']>, incoming: NonNullable<EnterpriseProfile['products']['items']>) {
  const next = [...existing];
  for (const product of incoming) {
    const sku = product.sku?.trim();
    const index = sku
      ? next.findIndex(item => item.sku?.trim() === sku)
      : next.findIndex(item => item.name?.trim() === product.name?.trim());
    if (index >= 0) next[index] = { ...next[index], ...product };
    else next.push(product);
  }
  return next;
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
  if (Array.isArray(profile.products.items) && profile.products.items.length) {
    profile.products.items.forEach((item, index) => {
      const details = [
        item.name || `产品${index + 1}`,
        item.category ? `类目：${item.category}` : '',
        item.priceRange ? `价格：${item.priceRange}` : '',
        item.moq ? `起订量：${item.moq}` : '',
        item.certifications ? `资质：${item.certifications}` : '',
        item.highlights ? `卖点：${item.highlights}` : '',
        item.images?.length ? `图片附件：${item.images.map(a => a.name).join('、')}` : '',
        item.videos?.length ? `视频附件：${item.videos.map(a => a.name).join('、')}` : '',
        item.documents?.length ? `资质文书附件：${item.documents.map(a => a.name).join('、')}` : '',
      ].filter(Boolean);
      if (details.length) parts.push(`产品${index + 1}：${details.join('；')}`);
    });
  }
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
  if (profile.customerOps?.bigDealThreshold) parts.push(`客户运营大单阈值：${profile.customerOps.bigDealThreshold}`);
  if (profile.customerOps?.takeoverOwner) parts.push(`熔断接管人：${profile.customerOps.takeoverOwner}`);
  if (profile.customerOps?.notificationChannel) parts.push(`接管通知渠道：${profile.customerOps.notificationChannel}`);
  if (profile.customerOps?.workingTimezone) parts.push(`工作时区：${profile.customerOps.workingTimezone}`);
  if (profile.customerOps?.workingHours) parts.push(`工作时段：${profile.customerOps.workingHours}`);
  if (profile.customerOps?.automationPreference) parts.push(`客户自动化偏好：${profile.customerOps.automationPreference}`);
  if (profile.customerOps?.extraMissingFields) parts.push(`品类相关缺失字段：${profile.customerOps.extraMissingFields}`);
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

enterpriseRouter.get('/product-api', async (req, res) => {
  const tenantId = await resolveTenantId(req);
  const profile = ensureProductApiKey(readProfile(), tenantId);
  writeProfile(profile);
  res.json(publicProductApiInfo(profile));
});

enterpriseRouter.post('/product-api/rotate', async (req, res) => {
  const tenantId = await resolveTenantId(req);
  const profile = readProfile();
  const next: EnterpriseProfile = {
    ...profile,
    integrations: {
      ...profile.integrations,
      productApi: {
        tenantId,
        apiKey: `ls_prod_${randomBytes(24).toString('base64url')}`,
        createdAt: new Date().toISOString(),
      },
    },
  };
  writeProfile(next);
  res.json(publicProductApiInfo(next));
});

enterpriseRouter.get('/product-api/docs', (req, res) => {
  res.json(productApiDocs(`${req.protocol}://${req.get('host')}`));
});

enterpriseRouter.get('/product-api/status', (_req, res) => {
  const profile = readProfile();
  const items = profile.products.items ?? [];
  res.json({
    count: items.length,
    lastIngestedAt: profile.integrations?.productApi?.lastIngestedAt || '',
    lastProductName: profile.integrations?.productApi?.lastProductName || items.at(-1)?.name || '',
  });
});

enterpriseRouter.post('/assets', (req, res) => {
  const { name, type, dataUrl } = req.body as { name?: string; type?: string; dataUrl?: string };
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!name || !match) {
    res.status(400).json({ error: 'invalid asset payload' });
    return;
  }
  ensureAssetsDir();
  const storedName = safeStoredName(name);
  const filePath = path.join(ASSETS_DIR, storedName);
  const buffer = Buffer.from(match[2], 'base64');
  fs.writeFileSync(filePath, buffer);
  res.json({
    name,
    type: type || match[1] || 'application/octet-stream',
    size: buffer.length,
    updatedAt: new Date().toISOString(),
    url: `/api/overseas/enterprise/assets/${storedName}`,
  });
});

enterpriseRouter.get('/assets/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const filePath = path.join(ASSETS_DIR, file);
  if (!fs.existsSync(filePath)) {
    res.status(404).end();
    return;
  }
  res.sendFile(filePath);
});

enterpriseRouter.post('/profile', (req, res) => {
  const profile = normalizeProfile(req.body as EnterpriseProfile);
  writeProfile(profile);
  res.json({ ok: true });
});

enterpriseRouter.get('/context', (_req, res) => {
  const profile = readProfile();
  res.json({ context: buildEnterpriseContext(profile) });
});

enterpriseRouter.get('/demo/templates', (_req, res) => {
  res.json(readTemplates().map(({ id, name, description, profile }) => ({ id, name, description, profile })));
});

enterpriseRouter.post('/demo/templates/:id/apply', (req, res) => {
  const template = readTemplates().find(t => t.id === req.params.id);
  if (!template) { res.status(404).json({ error: 'template not found' }); return; }
  const profile = normalizeProfile(template.profile);
  fs.writeFileSync(DATA_FILE, JSON.stringify(profile, null, 2), 'utf8');
  res.json({ ok: true, profile });
});

enterpriseRouter.post('/demo/reset', (_req, res) => {
  const profile = normalizeProfile({
    company: { name: '', industry: '', companyType: '', mainMarkets: '', primaryLanguages: '', founded: '', description: '' },
    products: { categories: '', priceRange: '', moq: '', certifications: '', highlights: '', items: [] },
    brand: { tone: '', style: '', taboos: '', usp: '', preferredLanguages: '' },
    strategy: { currentGoal: '', focusProducts: '', focusMarkets: '', excludedMarkets: '', pricingStrategy: '', minMargin: '', agentAutonomy: '' },
    customers: { targetProfiles: '', highValueSignals: '', lowQualitySignals: '', commonQuestions: '', followupStyle: '' },
    customerOps: { bigDealThreshold: '', takeoverOwner: '', notificationChannel: '', workingTimezone: '', workingHours: '', automationPreference: '', extraMissingFields: '' },
    operations: { leadTime: '', customization: '', logistics: '', paymentTerms: '', riskNotes: '' },
    agentLearning: { provenAngles: '', weakAngles: '', pendingAssumptions: '', userCorrections: '' },
    knowledge: '',
  });
  fs.writeFileSync(DATA_FILE, JSON.stringify(profile, null, 2), 'utf8');
  writeJson('channels.json', []);
  writeJson('plugins.json', []);
  writeJson('tasks.json', []);
  writeJson('studio-projects.json', []);
  resetDemoUsage();
  res.json({ ok: true, profile });
});

export const productApiRouter = Router();

productApiRouter.post('/bulk', (req, res) => {
  const profile = verifyProductApiKey(req);
  if (!profile) {
    res.status(401).json({ error: 'Invalid API Key' });
    return;
  }
  const payload = Array.isArray(req.body) ? req.body : req.body?.products;
  if (!Array.isArray(payload)) {
    res.status(400).json({ error: 'Body should be { products: [...] } or an array.' });
    return;
  }
  const products = payload.map(item => normalizeApiProduct(item)).filter(Boolean) as NonNullable<EnterpriseProfile['products']['items']>;
  const existing = profile.products.items ?? [];
  const nextItems = upsertProductItems(existing, products);
  const last = products.at(-1);
  const next: EnterpriseProfile = {
    ...profile,
    products: { ...profile.products, items: nextItems },
    integrations: {
      ...profile.integrations,
      productApi: profile.integrations?.productApi
        ? { ...profile.integrations.productApi, lastIngestedAt: new Date().toISOString(), lastProductName: last?.name || '' }
        : undefined,
    },
  };
  writeProfile(next);
  res.json({ ok: true, received: payload.length, upserted: products.length, total: nextItems.length });
});

productApiRouter.get('/', (req, res) => {
  const profile = verifyProductApiKey(req);
  if (!profile) {
    res.status(401).json({ error: 'Invalid API Key' });
    return;
  }
  const sku = text(req.query.sku);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
  const items = (profile.products.items ?? []).filter(item => !sku || item.sku === sku).slice(0, limit);
  res.json({ total: items.length, items });
});

productApiRouter.delete('/:sku?', (req, res) => {
  const profile = verifyProductApiKey(req);
  if (!profile) {
    res.status(401).json({ error: 'Invalid API Key' });
    return;
  }
  const sku = text(req.params.sku || req.query.sku || req.body?.sku);
  if (!sku) {
    res.status(400).json({ error: 'Missing sku' });
    return;
  }
  const before = profile.products.items ?? [];
  const after = before.filter(item => item.sku !== sku);
  writeProfile({ ...profile, products: { ...profile.products, items: after } });
  res.json({ ok: true, deleted: before.length - after.length, total: after.length });
});
