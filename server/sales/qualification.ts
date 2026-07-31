export type BantKey = 'budget' | 'authority' | 'need' | 'timing';
export type BantStatus = 'unknown' | 'partial' | 'confirmed';
export type AuthenticityBand = 'verified' | 'reduced' | 'suspected_scraping';
export type QualificationBand = 'white' | 'blue' | 'yellow' | 'red' | 'black';

export interface BantDimension {
  score: number;
  status: BantStatus;
  evidence: string[];
}

export interface AuthenticityAssessment {
  score: number;
  band: AuthenticityBand;
  redFlags: string[];
  greenFlags: string[];
}

export interface BantAssessment {
  budget: BantDimension;
  authority: BantDimension;
  need: BantDimension;
  timing: BantDimension;
  rawTotal: number;
  authenticity: AuthenticityAssessment;
  total: number;
  band: QualificationBand;
  completeness: number;
  level: 'early' | 'qualified' | 'hot';
  updatedAt: string;
}

export interface ProgressionGoal {
  dimension: BantKey;
  label: string;
  reason: string;
  question: string;
  questionStyle: 'spin_indirect';
  updatedAt: string;
}

export interface QualificationTurn {
  role: 'buyer' | 'seller';
  text: string;
}

const MONEY_PATTERN = /(?:(?:[$€£¥]|usd|eur|gbp|rmb|cny)\s?\d[\d,.]*|\d[\d,.]*\s?(?:usd|eur|gbp|rmb|cny|dollars?|euros?|元|美元|欧元))/i;
const BUDGET_PATTERN = /\b(?:budget|target price|price range|quotation|quote|cost|afford|investment)\b|预算|目标价|价格区间|报价|成本/i;
const AUTHORITY_CONFIRMED_PATTERN = /\b(?:owner|founder|director|ceo|purchasing manager|procurement manager|head buyer|decision maker|i decide|my company|our company)\b|老板|创始人|总监|采购经理|负责人|我决定|我们公司/i;
const AUTHORITY_PARTIAL_PATTERN = /\b(?:buyer|purchasing|procurement|partner|manager|boss|team approval|management approval|approve)\b|采购|买手|合伙人|经理|领导|团队确认|审批/i;
const NEED_CONFIRMED_PATTERN = /\b(?:we need|i need|looking for|interested in|require|requirement|private label|oem|odm|custom packaging|for our (?:shop|store|clinic|brand|chain)|distribute|resell)\b|我们需要|我需要|寻找|采购|定制|贴牌|代工|包装要求|用于.{0,8}(?:门店|诊所|品牌)|经销|转售/i;
const NEED_PARTIAL_PATTERN = /\b(?:product|catalog|catalogue|sample|specification|material|model|sku|moq)\b|产品|目录|样品|规格|材质|型号|起订量/i;
const TIMING_CONFIRMED_PATTERN = /\b(?:today|tomorrow|this week|this month|next month|urgent|asap|before\s+[a-z]+|within\s+\d+\s+(?:days?|weeks?)|launch date|deadline|busy season)\b|今天|明天|本周|本月|下月|尽快|紧急|截止|上市时间|旺季|\d+\s*(?:天|周|个月)内/i;
const TIMING_PARTIAL_PATTERN = /\b(?:when|lead time|delivery time|ship|schedule|timeline|launch)\b|什么时候|交期|发货|排期|周期|上市/i;

function evidenceSnippet(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function scoreDimension(
  buyerMessages: string[],
  confirmed: RegExp,
  partial: RegExp,
  confirmedScore = 25,
  partialScore = 12,
): BantDimension {
  const confirmedHits = buyerMessages.filter(message => confirmed.test(message));
  const partialHits = buyerMessages.filter(message => partial.test(message));
  const evidence = [...confirmedHits, ...partialHits]
    .map(evidenceSnippet)
    .filter((item, index, list) => item && list.indexOf(item) === index)
    .slice(-3);
  if (confirmedHits.length) return { score: confirmedScore, status: 'confirmed', evidence };
  if (partialHits.length) return { score: partialScore, status: 'partial', evidence };
  return { score: 0, status: 'unknown', evidence: [] };
}

function mergeDimension(current: BantDimension, previous?: BantDimension): BantDimension {
  if (!previous || current.score >= previous.score) return current;
  return {
    ...previous,
    evidence: [...previous.evidence, ...current.evidence]
      .filter((item, index, list) => item && list.indexOf(item) === index)
      .slice(-3),
  };
}

// 外贸场景专属的真实性信号：识别套价/踩点/欺诈试探，而不是评估采购意愿本身。
const PRICE_PROBE_PATTERN = /\b(?:how much|best price|lowest price|cheapest|price)\b|多少钱|最低价|价格/i;
const QUANTITY_MENTION_PATTERN = /\b\d[\d,]*\s*(?:pcs?|pieces?|units?|sets?|cartons?|containers?|bottles?|boxes?)\b|\d+\s*(?:件|个|套|箱)/i;
const MARKET_MENTION_PATTERN = /\b(?:market|country|region)\b|selling (?:in|to)|for\s+(?:our|the)\s+\w+\s+market|市场|国家|地区/i;
const REFUSAL_TO_DISCLOSE_PATTERN = /\bwhy (?:do you need|does it matter|ask)\b|just (?:send|give|tell) me (?:the )?price|no need to (?:know|tell)|不需要告诉你|不方便说|直接说价格|别问那么多/i;
const FULL_PRICE_LIST_PATTERN = /\bfull price list\b|\ball (?:your )?products?.{0,10}price\b|complete price list|price list for everything|全部产品.{0,6}价格|完整价格表|所有产品报价/i;
const FACTORY_PROBE_PATTERN = /\bfactory address\b|\bproduction line\b|\bwhich factory\b|\bwho (?:is your|manufactures)\b|工厂地址|生产线|哪个工厂|谁生产/i;
const OTHER_CUSTOMERS_PATTERN = /\bwho else (?:do you supply|are your customers)\b|other (?:customers|clients|buyers)\b.{0,20}(?:you supply|you have)|还给谁供货|其他客户是谁|你的客户有哪些/i;
const UNUSUAL_PAYMENT_PATTERN = /\bno deposit\b|\bzero deposit\b|\bpay (?:you )?extra\b|\boverpay\b|refund the difference|western union|money order|cashier'?s check|无需定金|多付.{0,6}退还|银行本票|电汇差额/i;
const DESCRIBES_BUSINESS_PATTERN = /\bwe are\b|\bour (?:shop|store|company|business|clinic|chain|brand|salon|pharmacy)\b|\bi run\b|\bi own\b|我们是|我们店|我司|我们公司/i;
const SHARES_COMPANY_INFO_PATTERN = /\bwebsite\b|\binstagram\b|\bfacebook\b|www\.|\.com\b|官网|社媒|https?:\/\//i;
const EXECUTABLE_LOGISTICS_PATTERN = /\b(?:shipping|customs|duty|payment terms|deposit|T\/T|L\/C|incoterm|FOB|CIF)\b|物流|清关|关税|付款方式|定金/i;
const CERTIFICATION_INTEREST_PATTERN = /\bcertificat\w*|\bwarranty\b|\bGMP\b|\bISO\b|\bCOA\b|认证|质保|保修/i;
const CONTENT_SOURCE_PATTERN = /\bsaw your (?:video|post|ad)\b|\byour (?:tiktok|instagram|youtube)\b|看到你.{0,6}(?:视频|广告)|从.{0,10}(?:短视频|广告).{0,6}看到/i;

const RED_FLAG_LABELS: Record<string, string> = {
  price_only_no_quantity: '信息待核实：反复问价但未提供采购数量',
  full_price_list: '信息待核实：要求提供全部产品完整报价',
  refuses_market: '信息待核实：回避说明目标市场或国家',
  factory_probe: '信息待核实：多次追问工厂地址或生产线细节',
  other_customers: '信息待核实：询问其他客户或供货对象信息',
  unusual_payment: '信息待核实：付款条件明显异常',
};

const GREEN_FLAG_LABELS: Record<string, string> = {
  describes_business: '已主动介绍自身业务',
  shares_company_info: '已提供公司/官网/社媒信息',
  executable_logistics: '已询问物流、清关或付款等可执行问题',
  certification_interest: '已询问认证或质保信息',
  content_source: '来源于内容/视频观看后咨询',
};

function assessAuthenticity(buyerMessages: string[], previous?: AuthenticityAssessment): AuthenticityAssessment {
  const redKeys: string[] = [];
  if (buyerMessages.length >= 2 && buyerMessages.some(message => PRICE_PROBE_PATTERN.test(message)) && !buyerMessages.some(message => QUANTITY_MENTION_PATTERN.test(message))) {
    redKeys.push('price_only_no_quantity');
  }
  if (buyerMessages.some(message => FULL_PRICE_LIST_PATTERN.test(message))) redKeys.push('full_price_list');
  if (buyerMessages.some(message => REFUSAL_TO_DISCLOSE_PATTERN.test(message)) && !buyerMessages.some(message => MARKET_MENTION_PATTERN.test(message))) {
    redKeys.push('refuses_market');
  }
  if (buyerMessages.some(message => FACTORY_PROBE_PATTERN.test(message))) redKeys.push('factory_probe');
  if (buyerMessages.some(message => OTHER_CUSTOMERS_PATTERN.test(message))) redKeys.push('other_customers');
  if (buyerMessages.some(message => UNUSUAL_PAYMENT_PATTERN.test(message))) redKeys.push('unusual_payment');

  const greenKeys: string[] = [];
  if (buyerMessages.some(message => DESCRIBES_BUSINESS_PATTERN.test(message))) greenKeys.push('describes_business');
  if (buyerMessages.some(message => SHARES_COMPANY_INFO_PATTERN.test(message))) greenKeys.push('shares_company_info');
  if (buyerMessages.some(message => EXECUTABLE_LOGISTICS_PATTERN.test(message))) greenKeys.push('executable_logistics');
  if (buyerMessages.some(message => CERTIFICATION_INTEREST_PATTERN.test(message))) greenKeys.push('certification_interest');
  if (buyerMessages.some(message => CONTENT_SOURCE_PATTERN.test(message))) greenKeys.push('content_source');

  const redFlags = [...new Set([...(previous?.redFlags ?? []), ...redKeys.map(key => RED_FLAG_LABELS[key])])];
  const greenFlags = [...new Set([...(previous?.greenFlags ?? []), ...greenKeys.map(key => GREEN_FLAG_LABELS[key])])];

  const redCategoryCount = redFlags.length;
  const greenCategoryCount = greenFlags.length;
  const baseline = redCategoryCount >= 3 ? 0.2 : redCategoryCount >= 2 ? 0.5 : 1.0;
  const score = Math.min(1, baseline + 0.1 * greenCategoryCount);
  const band: AuthenticityBand = score <= 0.3 ? 'suspected_scraping' : score >= 1 ? 'verified' : 'reduced';
  return { score, band, redFlags, greenFlags };
}

export function assessBant(input: { turns: QualificationTurn[]; previous?: BantAssessment }): BantAssessment {
  const buyerMessages = input.turns.filter(turn => turn.role === 'buyer').map(turn => String(turn.text || '').trim()).filter(Boolean);
  const budget = mergeDimension(
    scoreDimension(buyerMessages, MONEY_PATTERN, BUDGET_PATTERN),
    input.previous?.budget,
  );
  const authority = mergeDimension(
    scoreDimension(buyerMessages, AUTHORITY_CONFIRMED_PATTERN, AUTHORITY_PARTIAL_PATTERN),
    input.previous?.authority,
  );
  const need = mergeDimension(
    scoreDimension(buyerMessages, NEED_CONFIRMED_PATTERN, NEED_PARTIAL_PATTERN),
    input.previous?.need,
  );
  const timing = mergeDimension(
    scoreDimension(buyerMessages, TIMING_CONFIRMED_PATTERN, TIMING_PARTIAL_PATTERN),
    input.previous?.timing,
  );
  const rawTotal = budget.score + authority.score + need.score + timing.score;
  const authenticity = assessAuthenticity(buyerMessages, input.previous?.authenticity);
  const total = Math.round(rawTotal * authenticity.score);
  const completeness = [budget, authority, need, timing].filter(item => item.status !== 'unknown').length;
  const band: QualificationBand = authenticity.band === 'suspected_scraping'
    ? 'black'
    : total >= 75 ? 'red' : total >= 50 ? 'yellow' : total >= 25 ? 'blue' : 'white';
  return {
    budget,
    authority,
    need,
    timing,
    rawTotal,
    authenticity,
    total,
    band,
    completeness,
    level: total >= 75 ? 'hot' : total >= 50 ? 'qualified' : 'early',
    updatedAt: new Date().toISOString(),
  };
}

function normalizedLanguage(value: unknown): 'zh' | 'es' | 'ar' | 'en' {
  const language = String(value || '').toLowerCase();
  if (/中文|chinese|zh/.test(language)) return 'zh';
  if (/西语|spanish|español|\bes\b/.test(language)) return 'es';
  if (/阿语|arabic|العربية|\bar\b/.test(language)) return 'ar';
  return 'en';
}

const GOALS: Record<BantKey, {
  label: string;
  reason: string;
  questions: Record<'zh' | 'es' | 'ar' | 'en', string>;
}> = {
  need: {
    label: '明确真实需求',
    reason: '先确认客户的使用场景与优先需求，避免过早报价。',
    questions: {
      zh: '您现在最想解决的是选品、包装，还是交付时间？',
      en: 'What matters most for this purchase right now: product fit, packaging, or timing?',
      es: '¿Qué importa más ahora: el producto, el empaque o el plazo?',
      ar: 'ما الأهم الآن في هذا الشراء: المنتج أم التغليف أم الوقت؟',
    },
  },
  timing: {
    label: '确认采购时间',
    reason: '用业务节点判断紧迫度，不直接逼问下单日期。',
    questions: {
      zh: '这批货是配合旺季、补货，还是新项目上线？',
      en: 'Is this for seasonal demand, replenishment, or a new launch?',
      es: '¿Es para temporada alta, reposición o un nuevo lanzamiento?',
      ar: 'هل هذه الكمية للموسم أم لإعادة التخزين أم لإطلاق جديد؟',
    },
  },
  authority: {
    label: '识别决策链',
    reason: '了解谁参与确认，以便准备适合内部决策的资料。',
    questions: {
      zh: '除了您之外，还有谁会一起确认产品和采购条件？',
      en: 'Who else will review the product and purchase terms with you?',
      es: '¿Quién más revisará contigo el producto y las condiciones de compra?',
      ar: 'من سيشاركك مراجعة المنتج وشروط الشراء؟',
    },
  },
  budget: {
    label: '判断预算适配',
    reason: '通过既有采购方式判断预算，而不是生硬追问预算数字。',
    questions: {
      zh: '您之前采购类似产品时，更看重单价还是整体到岸成本？',
      en: 'For similar purchases, do you focus more on unit price or total landed cost?',
      es: 'En compras similares, ¿priorizas el precio unitario o el costo total puesto en destino?',
      ar: 'في المشتريات المشابهة، هل تركز أكثر على سعر الوحدة أم التكلفة الإجمالية بعد الوصول؟',
    },
  },
};

export function selectProgressionGoal(bant: BantAssessment, language: unknown): ProgressionGoal {
  const order: BantKey[] = ['need', 'timing', 'authority', 'budget'];
  const dimension = order
    .map(key => ({ key, score: bant[key].score }))
    .sort((left, right) => left.score - right.score || order.indexOf(left.key) - order.indexOf(right.key))[0].key;
  const goal = GOALS[dimension];
  return {
    dimension,
    label: goal.label,
    reason: goal.reason,
    question: goal.questions[normalizedLanguage(language)],
    questionStyle: 'spin_indirect',
    updatedAt: new Date().toISOString(),
  };
}
