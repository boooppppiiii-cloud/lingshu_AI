import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes, randomUUID } from 'crypto';
import type { Request } from 'express';
import { resetDemoUsage } from '../lib/demo.js';
import { auth } from '../storage/index.js';
import type { AutonomyLevel } from '../autonomy/actionRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '../../data/enterprise.json');
const TEMPLATES_FILE = path.join(__dirname, '../../data/demo-templates.json');
const DATA_DIR = path.join(__dirname, '../../data');
const ASSETS_DIR = path.join(DATA_DIR, 'enterprise-assets');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
// 生成的 productApi 密钥单独存放，不进 data/enterprise.json（避免和会被提交/覆盖的企业资料文件混在一起）。
const PRODUCT_API_FILE = path.join(DATA_DIR, 'product-api.json');

type OrderStatus = '待付款' | '已付款' | '生产中' | '已发货' | '已完成' | '退款';

interface OrderRecord {
  id: string;
  orderNo: string;
  buyer: string;
  market: string;
  channel: string;
  product: string;
  quantity: number;
  amount: number;
  cost: number;
  status: OrderStatus;
  orderDate: string;
  owner: string;
  source: string;
  sourceRef?: string;
  importedAt: string;
  updatedAt: string;
}

const ORDER_STATUSES: OrderStatus[] = ['待付款', '已付款', '生产中', '已发货', '已完成', '退款'];

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
      factoryImages?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
      packagingImages?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
      certificateImages?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
      sceneImages?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
      brandAssets?: Array<{ name: string; type: string; size: number; updatedAt: string; url?: string }>;
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
    aiAutonomy?: AutonomyLevel;
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

interface ProductApiSecret {
  tenantId: string;
  apiKey: string;
  createdAt: string;
  lastIngestedAt?: string;
  lastProductName?: string;
}

function readProductApiSecret(): ProductApiSecret | null {
  try {
    return JSON.parse(fs.readFileSync(PRODUCT_API_FILE, 'utf8')) as ProductApiSecret;
  } catch {
    return null;
  }
}

function writeProductApiSecret(secret: ProductApiSecret): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PRODUCT_API_FILE, JSON.stringify(secret, null, 2), 'utf8');
}

// 兼容旧数据：老版本把 productApi 密钥写进了 data/enterprise.json 的 integrations 字段。
// 首次读取到这种旧格式时，把密钥迁移到独立文件，并从企业资料里彻底删除，避免它再被写回 enterprise.json。
function migrateLegacyProductApiSecret(parsed: Record<string, unknown>): void {
  const legacy = (parsed?.integrations as { productApi?: ProductApiSecret } | undefined)?.productApi;
  if (legacy?.apiKey && !fs.existsSync(PRODUCT_API_FILE)) {
    writeProductApiSecret(legacy);
  }
  delete parsed.integrations;
}

function readProfile(): EnterpriseProfile {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    migrateLegacyProductApiSecret(parsed);
    return normalizeProfile(parsed);
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
      strategy: { currentGoal: '', focusProducts: '', focusMarkets: '', excludedMarkets: '', pricingStrategy: '', minMargin: '', agentAutonomy: '', aiAutonomy: 'draft' },
      customers: { targetProfiles: '', highValueSignals: '', lowQualitySignals: '', commonQuestions: '', followupStyle: '' },
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

function readOrders(): OrderRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed.map(normalizeOrder).filter(Boolean) as OrderRecord[] : [];
  } catch {
    return [];
  }
}

function writeOrders(orders: OrderRecord[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8');
}

function parseNumber(value: unknown): number {
  const n = Number(String(value ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normalizeStatus(value: unknown): OrderStatus {
  const raw = String(value || '').trim();
  if (ORDER_STATUSES.includes(raw as OrderStatus)) return raw as OrderStatus;
  const lower = raw.toLowerCase();
  if (/paid|已付款|付款/.test(lower)) return '已付款';
  if (/ship|fulfilled|已发|发货/.test(lower)) return '已发货';
  if (/complete|done|完成/.test(lower)) return '已完成';
  if (/refund|退款/.test(lower)) return '退款';
  if (/production|生产/.test(lower)) return '生产中';
  return '待付款';
}

function normalizeDate(value: unknown): string {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('/');
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function normalizeOrder(input: Partial<OrderRecord>): OrderRecord | null {
  const buyer = String(input.buyer || '').trim();
  const product = String(input.product || '').trim();
  const amount = parseNumber(input.amount);
  if (!buyer || !product || amount <= 0) return null;
  const now = new Date().toISOString();
  const orderDate = normalizeDate(input.orderDate);
  return {
    id: String(input.id || randomUUID()),
    orderNo: String(input.orderNo || `LS-${orderDate.replaceAll('-', '')}-${randomBytes(3).toString('hex').toUpperCase()}`),
    buyer,
    market: String(input.market || '未标注').trim(),
    channel: String(input.channel || '手工录入').trim(),
    product,
    quantity: Math.max(1, parseNumber(input.quantity) || 1),
    amount,
    cost: Math.max(0, parseNumber(input.cost)),
    status: normalizeStatus(input.status),
    orderDate,
    owner: String(input.owner || '').trim() || '未分配',
    source: String(input.source || '手工录入').trim(),
    sourceRef: String(input.sourceRef || '').trim(),
    importedAt: input.importedAt || now,
    updatedAt: now,
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const ORDER_HEADER_MAP: Record<string, keyof OrderRecord> = {
  订单号: 'orderNo',
  orderno: 'orderNo',
  order_no: 'orderNo',
  orderid: 'orderNo',
  order_id: 'orderNo',
  客户: 'buyer',
  客户名称: 'buyer',
  buyer: 'buyer',
  customer: 'buyer',
  market: 'market',
  市场: 'market',
  国家: 'market',
  country: 'market',
  渠道: 'channel',
  channel: 'channel',
  商品: 'product',
  '商品/sku': 'product',
  '商品 / sku': 'product',
  产品: 'product',
  sku: 'product',
  product: 'product',
  数量: 'quantity',
  quantity: 'quantity',
  qty: 'quantity',
  gmv: 'amount',
  金额: 'amount',
  订单金额: 'amount',
  amount: 'amount',
  成本: 'cost',
  cost: 'cost',
  状态: 'status',
  status: 'status',
  日期: 'orderDate',
  订单日期: 'orderDate',
  date: 'orderDate',
  orderdate: 'orderDate',
  负责人: 'owner',
  owner: 'owner',
  销售: 'owner',
  来源: 'source',
  source: 'source',
  来源凭证: 'sourceRef',
  凭证: 'sourceRef',
  sourceref: 'sourceRef',
  platform_order_id: 'sourceRef',
  平台订单号: 'sourceRef',
};

function importOrdersFromCsv(text: string): { imported: OrderRecord[]; skipped: number } {
  const rows = parseCsv(text);
  const [headers = [], ...body] = rows;
  const keys = headers.map(header => ORDER_HEADER_MAP[String(header).trim().toLowerCase()] || ORDER_HEADER_MAP[String(header).trim()]);
  const imported: OrderRecord[] = [];
  let skipped = 0;
  for (const row of body) {
    const raw: Partial<OrderRecord> = {};
    row.forEach((value, index) => {
      const key = keys[index];
      if (key) (raw as Record<string, unknown>)[key] = value;
    });
    const order = normalizeOrder({ ...raw, source: raw.source || 'CSV导入' });
    if (order) imported.push(order);
    else skipped += 1;
  }
  return { imported, skipped };
}

function ensureAssetsDir(): void {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

function safeStoredName(originalName: string): string {
  const ext = path.extname(originalName).slice(0, 16).replace(/[^a-zA-Z0-9.]/g, '');
  return `${Date.now()}-${randomUUID()}${ext}`;
}

function emptyProduct(index: number): NonNullable<EnterpriseProfile['products']['items']>[number] {
  return {
    name: `产品${index + 1}`,
    images: [],
    videos: [],
    documents: [],
    factoryImages: [],
    packagingImages: [],
    certificateImages: [],
    sceneImages: [],
    brandAssets: [],
  };
}

function normalizeProfile(profile: EnterpriseProfile): EnterpriseProfile {
  const products = profile.products ?? { categories: '', priceRange: '', moq: '', certifications: '', highlights: '' };
  const existing = Array.isArray(products.items) ? products.items : [];
  const items = existing.length
    ? existing.filter(item =>
      item.name || item.sku || item.category || item.priceRange || item.moq || item.certifications || item.highlights ||
      item.color || item.size || item.tagPrice || item.material || item.imageUrl ||
      item.images?.length || item.videos?.length || item.documents?.length ||
      item.factoryImages?.length || item.packagingImages?.length || item.certificateImages?.length ||
      item.sceneImages?.length || item.brandAssets?.length
    ).map((item) => ({
      ...item,
      name: item.name || item.sku || '',
      images: Array.isArray(item.images) ? item.images : [],
      videos: Array.isArray(item.videos) ? item.videos : [],
      documents: Array.isArray(item.documents) ? item.documents : [],
      factoryImages: Array.isArray(item.factoryImages) && item.factoryImages.length ? item.factoryImages : (Array.isArray(item.videos) ? item.videos : []),
      packagingImages: Array.isArray(item.packagingImages) ? item.packagingImages : [],
      certificateImages: Array.isArray(item.certificateImages) && item.certificateImages.length ? item.certificateImages : (Array.isArray(item.documents) ? item.documents : []),
      sceneImages: Array.isArray(item.sceneImages) ? item.sceneImages : [],
      brandAssets: Array.isArray(item.brandAssets) ? item.brandAssets : [],
    }))
    : [];
  const strategy = { ...(profile.strategy ?? {}), aiAutonomy: normalizeAutonomy(profile.strategy?.aiAutonomy) };
  return { ...profile, strategy, products: { ...products, items } };
}

function normalizeAutonomy(value: unknown): AutonomyLevel {
  return value === 'remind' || value === 'auto' || value === 'draft' ? value : 'draft';
}

function writeProfile(profile: EnterpriseProfile): void {
  const clean = normalizeProfile(profile) as EnterpriseProfile & { integrations?: unknown };
  delete clean.integrations;
  fs.writeFileSync(DATA_FILE, JSON.stringify(clean, null, 2), 'utf8');
}

async function resolveTenantId(req: Request): Promise<string> {
  const id = await auth.verifyToken(req.headers.authorization);
  return id?.tenantId || String(req.query.tenantId || req.headers['x-tenant-id'] || 'local_tenant_default');
}

function publicProductApiInfo(secret: ProductApiSecret | null) {
  return {
    apiKey: secret?.apiKey || '',
    tenantId: secret?.tenantId || '',
    createdAt: secret?.createdAt || '',
    lastIngestedAt: secret?.lastIngestedAt || '',
    lastProductName: secret?.lastProductName || '',
  };
}

function ensureProductApiKey(tenantId: string): ProductApiSecret {
  const current = readProductApiSecret();
  if (current?.apiKey && current.tenantId === tenantId) return current;
  const next: ProductApiSecret = {
    tenantId,
    apiKey: `ls_prod_${randomBytes(24).toString('base64url')}`,
    createdAt: new Date().toISOString(),
  };
  writeProductApiSecret(next);
  return next;
}

function readApiKey(req: Request) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return String(req.headers['x-api-key'] || bearer || '').trim();
}

function verifyProductApiKey(req: Request) {
  const expected = readProductApiSecret()?.apiKey;
  const provided = readApiKey(req);
  if (!expected || !provided || expected !== provided) return null;
  return readProfile();
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
    factoryImages: [],
    packagingImages: [],
    certificateImages: [],
    sceneImages: [],
    brandAssets: [],
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
        item.factoryImages?.length ? `工厂实拍素材：${item.factoryImages.map(a => a.name).join('、')}` : '',
        item.packagingImages?.length ? `包装定制素材：${item.packagingImages.map(a => a.name).join('、')}` : '',
        item.certificateImages?.length ? `证书资质素材：${item.certificateImages.map(a => a.name).join('、')}` : '',
        item.sceneImages?.length ? `使用场景素材：${item.sceneImages.map(a => a.name).join('、')}` : '',
        item.brandAssets?.length ? `品牌视觉素材：${item.brandAssets.map(a => a.name).join('、')}` : '',
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
  if (profile.strategy?.aiAutonomy) parts.push(`AI 参与程度：${profile.strategy.aiAutonomy}`);
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

enterpriseRouter.get('/orders', (_req, res) => {
  res.json({ items: readOrders() });
});

enterpriseRouter.post('/orders', (req, res) => {
  const order = normalizeOrder({ ...(req.body || {}), source: req.body?.source || '手工录入' });
  if (!order) {
    res.status(400).json({ error: 'invalid order payload' });
    return;
  }
  const orders = readOrders();
  const next = [order, ...orders.filter(item => item.orderNo !== order.orderNo)];
  writeOrders(next);
  res.status(201).json(order);
});

enterpriseRouter.patch('/orders/:id/status', (req, res) => {
  const status = normalizeStatus(req.body?.status);
  const orders = readOrders();
  const index = orders.findIndex(order => order.id === req.params.id);
  if (index < 0) {
    res.status(404).json({ error: 'order not found' });
    return;
  }
  orders[index] = { ...orders[index], status, updatedAt: new Date().toISOString() };
  writeOrders(orders);
  res.json(orders[index]);
});

enterpriseRouter.post('/orders/import', (req, res) => {
  const { csv } = req.body as { csv?: string };
  if (!csv?.trim()) {
    res.status(400).json({ error: 'csv is required' });
    return;
  }
  const result = importOrdersFromCsv(csv);
  const existing = readOrders();
  const merged = new Map<string, OrderRecord>();
  [...existing, ...result.imported].forEach(order => merged.set(order.orderNo, order));
  const items = [...merged.values()].sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  writeOrders(items);
  res.json({ ok: true, imported: result.imported.length, skipped: result.skipped, total: items.length });
});

enterpriseRouter.get('/product-api', async (req, res) => {
  const tenantId = await resolveTenantId(req);
  const secret = ensureProductApiKey(tenantId);
  res.json(publicProductApiInfo(secret));
});

enterpriseRouter.post('/product-api/rotate', async (req, res) => {
  const tenantId = await resolveTenantId(req);
  const next: ProductApiSecret = {
    tenantId,
    apiKey: `ls_prod_${randomBytes(24).toString('base64url')}`,
    createdAt: new Date().toISOString(),
  };
  writeProductApiSecret(next);
  res.json(publicProductApiInfo(next));
});

enterpriseRouter.get('/product-api/status', (_req, res) => {
  const profile = readProfile();
  const items = profile.products.items ?? [];
  const secret = readProductApiSecret();
  res.json({
    count: items.length,
    lastIngestedAt: secret?.lastIngestedAt || '',
    lastProductName: secret?.lastProductName || items.at(-1)?.name || '',
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
    strategy: { currentGoal: '', focusProducts: '', focusMarkets: '', excludedMarkets: '', pricingStrategy: '', minMargin: '', agentAutonomy: '', aiAutonomy: 'draft' },
    customers: { targetProfiles: '', highValueSignals: '', lowQualitySignals: '', commonQuestions: '', followupStyle: '' },
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
  writeProfile({ ...profile, products: { ...profile.products, items: nextItems } });
  const secret = readProductApiSecret();
  if (secret) writeProductApiSecret({ ...secret, lastIngestedAt: new Date().toISOString(), lastProductName: last?.name || '' });
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
