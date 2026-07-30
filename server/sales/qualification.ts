export type BantKey = 'budget' | 'authority' | 'need' | 'timing';
export type BantStatus = 'unknown' | 'partial' | 'confirmed';

export interface BantDimension {
  score: number;
  status: BantStatus;
  evidence: string[];
}

export interface BantAssessment {
  budget: BantDimension;
  authority: BantDimension;
  need: BantDimension;
  timing: BantDimension;
  total: number;
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
  const total = budget.score + authority.score + need.score + timing.score;
  const completeness = [budget, authority, need, timing].filter(item => item.status !== 'unknown').length;
  return {
    budget,
    authority,
    need,
    timing,
    total,
    completeness,
    level: total >= 75 ? 'hot' : total >= 45 ? 'qualified' : 'early',
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
