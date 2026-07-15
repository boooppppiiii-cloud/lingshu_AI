import { callLLM } from '../agents/llm.js';
import { readEnterpriseProfile, type BizRules, type EnterpriseProfile, type FaqItem } from '../routes/enterprise.js';

export interface CustomerLite {
  id?: string;
  name?: string;
  language?: string;
  stage?: string;
  product?: string;
}

export interface ProductLite {
  sku?: string;
  name: string;
  category?: string;
  priceRange?: string;
  moq?: string;
  tagPrice?: string;
  material?: string;
  color?: string;
  size?: string;
  highlights?: string;
  attributes?: Record<string, unknown>;
}

export interface RetrievedContext {
  companyIntro: string;
  bizRules: BizRules;
  faqs: Array<{ q: string; a: string; approvedForAuto: boolean; source: 'manual'|'pack'|'learned' }>;
  matchedFaqs: Array<{ q: string; a: string; approvedForAuto: boolean; source: 'manual'|'pack'|'learned' }>;
  products: Array<ProductLite>;
  evidence: string[];
  knowledgeMiss: boolean;
  missReason?: string;
  sentiment?: 'negative' | 'neutral' | 'positive';
}

interface ProductQuery {
  sku?: string;
  keywords?: string[];
  category?: string;
  sentiment?: 'negative' | 'neutral' | 'positive';
}

const EMPTY_BIZ_RULES: BizRules = {
  quoteMode: '',
  priceRange: '',
  bargainPolicy: 'no',
  bargainFloor: '',
  moq: '',
  samplePolicy: '',
  paymentTerms: '',
  leadTime: '',
};

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function normalize(value: unknown): string {
  return text(value).normalize('NFKC').toLowerCase();
}

function heuristicSentiment(message: string): 'negative' | 'neutral' {
  const raw = normalize(message);
  return /\b(angry|terrible|awful|bad service|waste(d)? my time|complaint|refund|unacceptable|disappointed|ridiculous|worst)\b|太糟糕|浪费.*时间|投诉|退款|生气|差评|无法接受|很差|太差/.test(raw)
    ? 'negative'
    : 'neutral';
}

function tokenize(value: string): string[] {
  return Array.from(new Set(
    normalize(value)
      .split(/[^a-z0-9\u4e00-\u9fff]+/i)
      .map(item => item.trim())
      .filter(item => item.length >= 2),
  ));
}

function companyIntro(profile: EnterpriseProfile): string {
  return [
    profile.company?.name ? `公司名称：${profile.company.name}` : '',
    profile.company?.industry ? `行业类目：${profile.company.industry}` : '',
    profile.company?.companyType ? `企业类型：${profile.company.companyType}` : '',
    profile.company?.mainMarkets ? `主攻市场：${profile.company.mainMarkets}` : '',
    profile.company?.primaryLanguages ? `主要业务语言：${profile.company.primaryLanguages}` : '',
    profile.company?.description ? `公司简介：${profile.company.description}` : '',
    profile.products?.categories ? `主营产品：${profile.products.categories}` : '',
    profile.brand?.usp ? `核心卖点：${profile.brand.usp}` : '',
  ].filter(Boolean).join('\n');
}

function faqSource(item: FaqItem): 'manual'|'pack'|'learned' {
  const raw = text((item as any).source);
  return raw === 'pack' || raw === 'learned' ? raw : 'manual';
}

function retrieveFaqs(profile: EnterpriseProfile, message: string, evidence: string[]): RetrievedContext['faqs'] {
  const all = (profile.faq ?? [])
    .filter(item => item.question || item.answer)
    .map(item => ({
      q: item.question,
      a: item.answer,
      approvedForAuto: item.approvedForAuto,
      source: faqSource(item),
    }));
  if (all.length <= 50) {
    if (all.length) evidence.push(`FAQ 总数 ${all.length} 条，已全量返回`);
    return all;
  }
  const tokens = tokenize(message);
  const scored = all
    .map(item => {
      const question = normalize(item.q);
      const score = tokens.reduce((sum, token) => sum + (question.includes(token) ? 1 : 0), 0);
      return { item, score };
    })
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(row => row.item);
  evidence.push(`FAQ 超过 50 条，关键词粗筛命中 ${scored.length} 条`);
  return scored;
}

function matchedFaqs(faqs: RetrievedContext['faqs'], message: string): RetrievedContext['faqs'] {
  const tokens = tokenize(message);
  const normalizedMessage = normalize(message);
  if (!normalizedMessage) return [];
  return faqs
    .map(item => {
      const q = normalize(item.q);
      const score = tokens.reduce((sum, token) => sum + (q.includes(token) ? 1 : 0), 0)
        + (normalizedMessage.includes(q) || q.includes(normalizedMessage) ? 3 : 0);
      return { item, score };
    })
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(row => row.item);
}

function productIntentLikely(message: string): boolean {
  const raw = text(message);
  if (!raw) return false;
  if (/^(hi|hello|hey|hola|buenas|thanks|thank you|ok|okay|are you there|est[aá]n ah[ií]|在吗|你好|您好)[\s?？!.！。]*$/i.test(raw)) return false;
  return /(?:[A-Z]{1,6}[-_]\d{2,}|[A-Z0-9]{2,}[-_][A-Z0-9-]{2,})/.test(raw)
    || /\b(price|how much|quote|quotation|sku|model|item|product|catalog|moq|sample|fabric|material|size|color|pcs|pieces)\b/i.test(raw)
    || /价格|报价|多少钱|货号|款号|产品|目录|起订|样品|面料|材质|颜色|尺码/.test(raw);
}

export function isGreetingOrProcessIntent(message: string): boolean {
  const raw = text(message);
  if (!raw) return true;
  return /^(hi|hello|hey|hola|buenas|thanks|thank you|ok|okay|are you there|est[aá]n ah[ií]|在吗|你好|您好)[\s?？!.！。]*$/i.test(raw)
    || /\b(catalog|catalogue|brochure|tracking|track|shipped|shipping status|invoice|pi)\b/i.test(raw)
    || /目录|产品册|物流|运单|发货|发票|形式发票/.test(raw);
}

function toProductLite(item: NonNullable<EnterpriseProfile['products']['items']>[number]): ProductLite {
  return {
    sku: text(item.sku),
    name: text(item.name || item.sku),
    category: text(item.category),
    priceRange: text(item.priceRange || item.tagPrice),
    moq: text(item.moq),
    tagPrice: text(item.tagPrice),
    material: text(item.material),
    color: text(item.color),
    size: text(item.size),
    highlights: text(item.highlights),
    attributes: item.attributes && typeof item.attributes === 'object' && !Array.isArray(item.attributes) ? item.attributes : {},
  };
}

function parseJsonObject(raw: string): ProductQuery | null {
  const trimmed = raw.replace(/```json|```/gi, '').trim();
  const match = trimmed.match(/\{[\s\S]*}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as ProductQuery;
    const sku = text(parsed.sku);
    const category = text(parsed.category);
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.map(item => text(item)).filter(Boolean).slice(0, 8)
      : [];
    const sentiment = parsed.sentiment === 'negative' || parsed.sentiment === 'positive' ? parsed.sentiment : 'neutral';
    if (!sku && !category && keywords.length === 0) return { sentiment };
    return { sku, category, keywords, sentiment };
  } catch {
    return null;
  }
}

function heuristicProductQuery(message: string): ProductQuery | null {
  const sku = text(message.match(/\b[A-Z0-9]{2,}(?:[-_][A-Z0-9]{2,})+\b/i)?.[0]).toUpperCase();
  const keywords = tokenize(message)
    .filter(token => !/^(price|quote|quotation|how|much|sku|model|item|product|moq|pcs|pieces|hello|hola)$/i.test(token))
    .slice(0, 6);
  if (!sku && keywords.length === 0) return null;
  return { sku, keywords };
}

async function parseProductQuery(message: string, evidence: string[]): Promise<ProductQuery | null> {
  if (!productIntentLikely(message)) {
    evidence.push('买家消息为寒暄或未涉及具体产品，跳过产品查询解析');
    return { sentiment: heuristicSentiment(message) };
  }
  const prompt = [
    'Parse the buyer message into product search conditions and sentiment.',
    'Return strict JSON only: {"sku": string, "keywords": string[], "category": string, "sentiment":"negative|neutral|positive"} or null.',
    'Only return conditions when the message refers to a concrete product, SKU, category, material, size, color, MOQ, price, or catalog need.',
    'For greetings or availability checks, return {"keywords":[],"sentiment":"neutral"}.',
    'Use sentiment="negative" when the buyer is angry, complaining, asking for a refund because of dissatisfaction, or says the seller wasted their time.',
    `Buyer message: ${message}`,
  ].join('\n');
  try {
    const raw = await callLLM(prompt, { backend: 'qwen', model: process.env.KNOWLEDGE_QUERY_MODEL || 'qwen-plus' });
    const parsed = raw.trim() === 'null' ? null : parseJsonObject(raw);
    if (parsed) {
      evidence.push('产品查询条件由 LLM 解析');
      return parsed;
    }
  } catch (error) {
    evidence.push(`产品查询 LLM 解析失败，已使用规则兜底：${error instanceof Error ? error.message : 'unknown_error'}`);
  }
  const fallback = heuristicProductQuery(message);
  if (fallback) fallback.sentiment = heuristicSentiment(message);
  if (fallback) evidence.push('产品查询条件由规则兜底解析');
  return fallback ?? { sentiment: heuristicSentiment(message) };
}

function productHaystack(product: ProductLite): string {
  return normalize([
    product.sku,
    product.name,
    product.category,
    product.material,
    product.color,
    product.size,
    product.highlights,
    product.priceRange,
    product.moq,
    JSON.stringify(product.attributes ?? {}),
  ].filter(Boolean).join(' '));
}

function retrieveProducts(profile: EnterpriseProfile, query: ProductQuery | null, evidence: string[]): ProductLite[] {
  if (!query) return [];
  const all = (profile.products.items ?? []).map(toProductLite).filter(item => item.name || item.sku);
  if (!all.length) {
    evidence.push('产品表为空，未命中产品');
    return [];
  }
  const sku = normalize(query.sku);
  if (sku) {
    const exact = all.filter(item => normalize(item.sku) === sku);
    if (exact.length) {
      evidence.push(`命中货号 ${query.sku}`);
      return exact.slice(0, 5);
    }
  }
  const keywords = (query.keywords ?? []).map(normalize).filter(Boolean);
  const category = normalize(query.category);
  const scored = all
    .map(product => {
      const haystack = productHaystack(product);
      const categoryMatched = category && normalize(product.category).includes(category);
      const keywordScore = keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0);
      const nameScore = keywords.reduce((sum, keyword) => sum + (normalize(product.name).includes(keyword) ? 2 : 0), 0);
      return { product, score: keywordScore + nameScore + (categoryMatched ? 2 : 0) };
    })
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(row => row.product);
  if (scored.length) {
    evidence.push(`产品关键词命中 ${scored.length} 条：${scored.map(item => item.sku || item.name).join('、')}`);
  } else {
    evidence.push('产品结构化检索未命中');
  }
  return scored;
}

export async function retrieveContext(tenantId: string, customer: CustomerLite, message: string): Promise<RetrievedContext> {
  const profile = readEnterpriseProfile();
  const evidence: string[] = [];
  if (tenantId) evidence.push(`租户 ${tenantId} 使用企业知识库`);
  if (customer?.id || customer?.name) evidence.push(`客户上下文：${customer.name || customer.id}`);
  const query = await parseProductQuery(message, evidence);
  const products = retrieveProducts(profile, query, evidence);
  const faqs = retrieveFaqs(profile, message, evidence);
  const faqMatches = matchedFaqs(faqs, message);
  const processIntent = isGreetingOrProcessIntent(message);
  const knowledgeMiss = faqMatches.length === 0 && products.length === 0 && !processIntent;
  if (knowledgeMiss) evidence.push('知识库未覆盖：FAQ 与产品均无有效命中，且不是寒暄/流程类意图');
  return {
    companyIntro: companyIntro(profile),
    bizRules: profile.bizRules ?? EMPTY_BIZ_RULES,
    faqs,
    matchedFaqs: faqMatches,
    products,
    evidence,
    knowledgeMiss,
    missReason: knowledgeMiss ? '客户在问知识库没有的问题' : '',
    sentiment: query?.sentiment ?? heuristicSentiment(message),
  };
}
