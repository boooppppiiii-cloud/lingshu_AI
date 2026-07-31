import { chooseNonRepeatedIndex, type TimelineLike } from '../lib/nonRepeatingReply.js';

export type KnowledgeGapScenario =
  | 'quality_or_certification'
  | 'competitor_comparison'
  | 'customization_or_packaging'
  | 'urgent_next_step'
  | 'order_or_logistics'
  | 'price_or_quote'
  | 'high_value_or_peer'
  | 'general_unknown';

export interface KnowledgeGapPlan {
  scenario: KnowledgeGapScenario;
  draft: string;
  draftZh: string;
  handoffRequired: true;
  safeToSendBeforeHandoff: true;
  handlingReason: string;
  variantCount: number;
  followUpMinutes: number;
  followUpDueAt: string;
  replyConfidence: {
    level: 'bridge_only';
    score: number;
    reason: string;
  };
}

const SCENARIO_PATTERNS: Array<{ scenario: KnowledgeGapScenario; pattern: RegExp }> = [
  {
    scenario: 'quality_or_certification',
    pattern: /\b(?:quality|reliable|certificate|certification|gmp|iso|coa|lab report|test report|inspection|compliance|fake cert|standard)\b|质量|可靠|证书|认证|检测报告|验货|合规|假证/i,
  },
  {
    scenario: 'competitor_comparison',
    pattern: /\b(?:another supplier|other supplier|competitor|offered|why should i choose|compare (?:you|your)|better than)\b|其他供应商|另一家|竞争对手|为什么选你|对比你们/i,
  },
  {
    scenario: 'order_or_logistics',
    pattern: /\b(?:tracking|where is my order|order status|has it shipped|invoice|payment status|in transit|dispatch)\b|物流|运单|订单状态|发货了吗|发票|付款状态/i,
  },
  {
    scenario: 'price_or_quote',
    pattern: /\b(?:price|quote|quotation|discount|payment terms?|deposit|lead time|delivery time|unit cost|how much)\b|报价|价格|单价|多少钱|折扣|付款条款|定金|交期/i,
  },
  {
    scenario: 'urgent_next_step',
    pattern: /\b(?:today|end of day|right now|immediately|urgent|move this forward|what exactly do you need|no back and forth|how (?:fast|soon)|ship in \d+ days?)\b|今天|马上|尽快|加急|怎么推进|不要来回沟通|多久发货/i,
  },
  {
    scenario: 'customization_or_packaging',
    pattern: /\b(?:private[ -]?label|customi[sz]e|custom packaging|our logo|my logo|bilingual|arabic packaging|label design|packaging style|oem|odm)\b|贴牌|定制|包装|双语|阿拉伯语|徽标|商标|代工/i,
  },
];

const LARGE_ORDER_PATTERN = /\b(\d[\d,]*(?:\.\d+)?)\s*(?:pcs?|pieces?|units?|sets?|bottles?|boxes?|cartons?)\b/gi;
const PEER_PATTERN = /\b(?:we are (?:also )?(?:a )?(?:supplier|factory|manufacturer|trading company)|i am (?:also )?(?:a )?(?:supplier|manufacturer|trader)|our factory|resell to other suppliers)\b|我们也是供应商|我们是工厂|我们也是厂家|同行/i;

function hasLargeOrderSignal(message: string): boolean {
  for (const match of message.matchAll(LARGE_ORDER_PATTERN)) {
    const quantity = Number(String(match[1]).replace(/,/g, ''));
    if (Number.isFinite(quantity) && quantity >= 1000) return true;
  }
  return false;
}

export function classifyKnowledgeGapScenario(message: string): KnowledgeGapScenario {
  const value = String(message || '').trim();
  if (PEER_PATTERN.test(value) || hasLargeOrderSignal(value)) return 'high_value_or_peer';
  for (const item of SCENARIO_PATTERNS) {
    if (item.pattern.test(value)) return item.scenario;
  }
  return 'general_unknown';
}

function normalizeLanguage(value: unknown): 'english' | 'spanish' | 'arabic' {
  const language = String(value || '').toLowerCase();
  if (language.includes('arabic') || language.includes('阿语') || language.includes('العربية')) return 'arabic';
  if (language.includes('spanish') || language.includes('西语') || language.includes('español')) return 'spanish';
  return 'english';
}

const HANDLING_REASON: Record<KnowledgeGapScenario, string> = {
  quality_or_certification: '客户在确认质量或资质真实性，需要人工核验真实文件',
  competitor_comparison: '客户正在比较供应商条件，需要销售确认同口径方案',
  customization_or_packaging: '客户提出定制或包装需求，需要确认真实可执行范围',
  urgent_next_step: '客户希望快速推进，需要负责人确认下一步与时间',
  order_or_logistics: '客户在查询订单、物流或付款状态，需要人工核对真实记录',
  price_or_quote: '客户正在询价或确认交易条件，需要销售人工报价',
  high_value_or_peer: '疑似大单或同行客户，需要销售负责人判断并接管',
  general_unknown: '客户问题超出企业知识库，已生成承接回复并转人工确认',
};

const ENGLISH_REPLIES: Record<KnowledgeGapScenario, string[]> = {
  quality_or_certification: [
    'That concern is fair. I won’t promise certificates or reports until the exact product is checked. Tell me which proof you need—GMP, ISO, COA or a test report—and I’ll pass it to our team to verify the real files with you.',
    'I understand why you’re careful. Send me the exact standard or document your clinics need. I’m handing this to our team to check the matching real files for this product.',
  ],
  competitor_comparison: [
    'That offer is worth comparing. Send me what it includes and your must-haves. I’m asking our sales team to check our MOQ, timing and documents against the same list—no guessing.',
    'Let’s compare the same things, not just one number. Send me their included scope and your top priority, and I’ll pass it to our sales team for a proper answer.',
  ],
  customization_or_packaging: [
    'Got it—private label and English-Arabic packaging. Send me the exact product, logo, target quantity and launch market. I’ll put it into one clean brief for our team to verify the real scope 👍',
    'Send me the product, logo file, packaging reference and quantity. I’ll pass one clear brief to our team so you don’t have to explain it again 👍',
  ],
  urgent_next_step: [
    'This needs a fast check. Send me the product, logo or packaging reference, quantity and target launch date. I’ll put them into one brief for our team to confirm. I won’t promise timing before they check it 👌',
    'Time matters here. Keep it simple: send the product, quantity, packaging reference and deadline. I’ll hand over one complete brief and ask the right person to confirm the next step.',
  ],
  order_or_logistics: [
    'This needs the real order record. Send me the order number and the account or phone used for the order. I’ll pass it to the team to check the real status—better than guessing.',
    'Let me route this to the right record. I need the order number to check this properly. Send it here and I’ll hand the full context to the person responsible for verifying the record.',
  ],
  price_or_quote: [
    'Got it. I’m passing this to sales for the exact quote. If you haven’t sent the quantity, specs and packaging yet, add them here so sales has one complete brief.',
    'I won’t guess the price here. Send the quantity, specs and packaging you need, and I’ll hand the full brief to sales for a proper quote.',
  ],
  high_value_or_peer: [
    'Got it—this needs a proper sales review. Send your company name, market, expected volume and main requirement. I’m passing the brief to our sales lead so you don’t have to repeat it.',
    'This looks like a serious business inquiry. Share your company, market, expected quantity and target product, and I’ll bring in our sales lead with the context ready.',
  ],
  general_unknown: [
    'I don’t want to guess and give you the wrong answer. Send me the exact product or model and quantity, and I’ll pass the question to the right person with the context included.',
    'Let me get the right person to confirm this. Send me the product or model and quantity, and I’ll hand over the full question so you won’t need to repeat it.',
  ],
};

const SPANISH_REPLIES: Record<KnowledgeGapScenario, string[]> = {
  quality_or_certification: [
    'Entiendo tu preocupación. No voy a prometer certificados sin comprobar el producto exacto. Dime si necesitas GMP, ISO, COA u otro informe y lo paso al equipo para verificar los archivos reales.',
    'Es normal que quieras comprobarlo. Envíame el estándar o documento exacto que necesitas y nuestro equipo revisará los archivos reales correspondientes a este producto.',
  ],
  competitor_comparison: [
    'Vale la pena comparar la misma oferta. Envíame qué incluye y qué es lo más importante para ti; nuestro equipo comercial confirmará MOQ, plazo y documentos sin adivinar.',
    'Comparemos las mismas condiciones, no solo un número. Envíame lo que incluye su oferta y tu prioridad; lo paso a ventas para darte una respuesta real.',
  ],
  customization_or_packaging: [
    'Entendido: marca privada y empaque bilingüe. Envíame el producto, logo, cantidad y mercado; preparo un solo resumen para que el equipo verifique el alcance real 👍',
    'Envíame producto, logo, referencia de empaque y cantidad. Lo paso todo en un solo resumen para que no tengas que explicarlo otra vez 👍',
  ],
  urgent_next_step: [
    'Esto necesita una revisión rápida. Envíame producto, cantidad, referencia de empaque y fecha objetivo. Lo paso todo en un solo resumen; no voy a prometer un plazo antes de confirmarlo 👌',
    'Aquí el tiempo importa. Hagámoslo fácil: producto, cantidad, empaque y fecha objetivo. Paso el resumen completo a la persona que confirmará el siguiente paso.',
  ],
  order_or_logistics: [
    'Esto necesita el registro real. Envíame el número de pedido y el teléfono o cuenta usada. Lo paso al equipo para comprobar el estado real, sin adivinar.',
    'Voy a dirigirlo al registro correcto. Necesito el número de pedido para revisarlo bien. Envíamelo y paso todo el contexto a la persona responsable de verificar el registro.',
  ],
  price_or_quote: [
    'Entendido. Lo paso a ventas para una cotización exacta. Si aún falta cantidad, especificación o empaque, envíamelo aquí y lo revisamos todo de una vez.',
    'No voy a inventar el precio. Envíame cantidad, especificaciones y empaque; paso el resumen completo a ventas para la cotización.',
  ],
  high_value_or_peer: [
    'Esto necesita revisión comercial. Envíame empresa, mercado, volumen estimado y producto; lo paso al responsable con todo el contexto.',
    'Parece una consulta comercial importante. Comparte empresa, mercado, cantidad estimada y producto; nuestro responsable recibirá todo el contexto.',
  ],
  general_unknown: [
    'No quiero adivinar y darte una respuesta incorrecta. Envíame el producto o modelo y la cantidad; paso la pregunta completa a la persona adecuada.',
    'Voy a pedir una confirmación real. Envíame producto o modelo y cantidad; paso la pregunta completa para que no tengas que repetirla.',
  ],
};

const ARABIC_REPLIES: Record<KnowledgeGapScenario, string[]> = {
  quality_or_certification: [
    'أتفهم قلقك. لن أعدك بأي شهادة قبل التحقق من المنتج نفسه. أخبرني هل تحتاج GMP أو ISO أو COA أو تقرير فحص، وسأحوّل الطلب للفريق للتأكد من الملفات الحقيقية.',
    'من حقك أن تتأكد. أرسل المعيار أو المستند المطلوب بالضبط، وسيراجع الفريق الملفات الحقيقية المطابقة لهذا المنتج.',
  ],
  competitor_comparison: [
    'الأفضل أن نقارن نفس التفاصيل. أرسل لي ما يشمله عرضهم وما هو الأهم لك، وسأطلب من فريق المبيعات تأكيد الحد الأدنى والمدة والمستندات بدون تخمين.',
    'لنقارن نفس الشروط وليس رقمًا واحدًا فقط. أرسل تفاصيل عرضهم وأهم نقطة لك، وسأحوّلها للمبيعات لرد واضح.',
  ],
  customization_or_packaging: [
    'واضح: علامة خاصة وتغليف عربي-إنجليزي. أرسل المنتج والشعار والكمية والسوق، وسأجهز ملخصًا واحدًا للفريق للتحقق من النطاق الفعلي 👍',
    'أرسل المنتج والشعار ومرجع التغليف والكمية. سأحوّلها في ملخص واحد حتى لا تضطر لشرحها مرة أخرى 👍',
  ],
  urgent_next_step: [
    'هذا يحتاج مراجعة سريعة. أرسل المنتج والكمية ومرجع التغليف وموعد الإطلاق المطلوب. سأجمعها في ملخص واحد للفريق، ولن أعد بموعد قبل التأكيد 👌',
    'الوقت مهم هنا. لنجعلها سهلة: المنتج والكمية والتغليف والموعد المطلوب. سأحوّل الملخص كاملًا للشخص الذي يؤكد الخطوة التالية.',
  ],
  order_or_logistics: [
    'هذا يحتاج سجل الطلب الحقيقي. أرسل رقم الطلب والحساب أو الهاتف المستخدم، وسأحوّل التفاصيل للفريق للتحقق من الحالة الفعلية بدون تخمين.',
    'سأوجه هذا إلى السجل الصحيح. أحتاج رقم الطلب للتحقق بشكل صحيح. أرسله هنا وسأحوّل كل السياق للشخص المسؤول عن مراجعة السجل.',
  ],
  price_or_quote: [
    'واضح. سأحوّل الطلب للمبيعات للحصول على عرض دقيق. إذا لم ترسل الكمية والمواصفات والتغليف بعد، أرسلها هنا لنراجع كل شيء مرة واحدة.',
    'لن أخمّن السعر. أرسل الكمية والمواصفات والتغليف المطلوب، وسأحوّل الملخص كاملًا للمبيعات لإعداد العرض.',
  ],
  high_value_or_peer: [
    'هذا الطلب يحتاج مراجعة من مسؤول المبيعات. أرسل اسم الشركة والسوق والكمية المتوقعة والمنتج، وسأحوّل له كل السياق.',
    'يبدو أنه طلب تجاري مهم. أرسل الشركة والسوق والكمية المتوقعة والمنتج، وسيصل لمسؤول المبيعات بكل التفاصيل.',
  ],
  general_unknown: [
    'لا أريد أن أخمّن وأعطيك جوابًا خاطئًا. أرسل المنتج أو الموديل والكمية، وسأحوّل السؤال كاملًا للشخص المناسب.',
    'دعني أطلب تأكيدًا صحيحًا. أرسل المنتج أو الموديل والكمية، وسأحوّل السؤال كاملًا حتى لا تكرر التفاصيل.',
  ],
};

const CHINESE_REPLIES: Record<KnowledgeGapScenario, string[]> = {
  quality_or_certification: [
    '这个担心很合理。在确认具体产品之前，我不会承诺证书或报告。请告诉我需要 GMP、ISO、COA 还是检测报告，我会交给团队核验真实文件。',
    '理解您为什么谨慎。请发来诊所要求的具体标准或文件，我会转给团队核对这个产品对应的真实文件。',
  ],
  competitor_comparison: [
    '这个报价值得认真比较。请发来对方报价包含的内容和您的硬性要求，我会让销售按同一口径确认起订量、时间和文件，不靠猜。',
    '我们按相同条件比较，不只看一个数字。请发来对方包含的内容和您最看重的点，我会交给销售给出准确答复。',
  ],
  customization_or_packaging: [
    '明白，您需要贴牌和英阿双语包装。请发来具体产品、Logo、目标数量和销售市场，我会整理成一份清单，让团队核实真实执行范围。',
    '请发来产品、Logo 文件、包装参考和数量。我会整理后一次性交给团队，您不用重复说明。',
  ],
  urgent_next_step: [
    '这需要快速核实。请发来产品、Logo 或包装参考、数量和计划上市时间。我会整理后交给团队确认，在确认前我不会随口承诺时间。',
    '这里时间很重要。简单一点：把产品、数量、包装参考和截止时间发来。我会一次性交给对应负责人确认下一步。',
  ],
  order_or_logistics: [
    '这需要核对真实订单记录。请发来订单号，以及下单时使用的账号或手机号。我会交给团队核对真实状态，不靠猜。',
    '我会转到对应订单记录。需要订单号才能准确核查。请发在这里，我会把完整上下文交给负责核对记录的同事。',
  ],
  price_or_quote: [
    '收到，我会转给销售核算准确报价。如果还没发数量、规格和包装要求，请一起补充，争取一次确认清楚。',
    '我不会随口猜价格。请发来数量、规格和包装要求，我会把完整需求交给销售正式报价。',
  ],
  high_value_or_peer: [
    '这需要销售负责人认真评估。请发来公司名称、市场、预计数量和主要需求，我会把完整信息交给负责人，您不用重复说明。',
    '这是一条重要的商务询盘。请发来公司、市场、预计数量和目标产品，我会带着完整上下文请销售负责人接手。',
  ],
  general_unknown: [
    '我不想靠猜给您错误答案。请发来具体产品或型号和数量，我会带着完整上下文转给对应负责人。',
    '我请对应负责人准确确认。请发来产品或型号和数量，我会把完整问题一起转过去，您不用重复说明。',
  ],
};

type FallbackLanguage = 'english' | 'spanish' | 'arabic' | 'chinese';

const FOLLOW_UP_SUFFIXES: Record<FallbackLanguage, string[]> = {
  english: [
    'The expected human follow-up is within four working hours.',
    'A responsible colleague is expected to reply here within four working hours.',
    'I have put this into the human queue, with a four-working-hour target.',
    'The next step is a human check, normally within four working hours.',
    'This is now waiting for a responsible colleague, with a four-working-hour target.',
    'I have flagged the full context for review; the target reply time is four working hours.',
  ],
  spanish: [
    'La respuesta humana está prevista dentro de cuatro horas laborables.',
    'La persona responsable debería responder aquí dentro de cuatro horas laborables.',
    'Ya está en la cola del equipo, con un objetivo de cuatro horas laborables.',
    'El siguiente paso es la revisión humana, normalmente dentro de cuatro horas laborables.',
    'Ahora está pendiente del responsable, con un objetivo de cuatro horas laborables.',
    'He marcado todo el contexto para revisión; el objetivo es responder en cuatro horas laborables.',
  ],
  arabic: [
    'الرد البشري متوقع خلال أربع ساعات عمل.',
    'من المتوقع أن يرد المسؤول هنا خلال أربع ساعات عمل.',
    'تم وضع الطلب في قائمة الفريق بهدف الرد خلال أربع ساعات عمل.',
    'الخطوة التالية مراجعة بشرية، وعادة خلال أربع ساعات عمل.',
    'الطلب الآن لدى المسؤول بهدف الرد خلال أربع ساعات عمل.',
    'تم إرسال السياق الكامل للمراجعة، والوقت المستهدف أربع ساعات عمل.',
  ],
  chinese: [
    '预计由负责人在四个工作小时内通过这里回复。',
    '下一步由负责人核实，预计四个工作小时内在这里回复。',
    '已进入人工待办，目标处理时间为四个工作小时。',
    '现在等待负责人核实，通常会在四个工作小时内回复。',
    '完整信息已交给负责人，目标回复时间为四个工作小时。',
    '这条问题已经进入人工核实队列，预计四个工作小时内答复。',
  ],
};

const FOLLOW_UP_OPENERS: Record<FallbackLanguage, string[]> = {
  english: ['I understand.', 'That is a fair question.', 'Let me check this properly.', 'I have the context.', 'I will not guess here.', 'This needs a real check.'],
  spanish: ['Entiendo.', 'Es una pregunta válida.', 'Voy a comprobarlo bien.', 'Ya tengo el contexto.', 'No voy a adivinar.', 'Esto necesita una revisión real.'],
  arabic: ['أفهمك.', 'هذا سؤال مهم.', 'سأطلب تحققًا دقيقًا.', 'لدي السياق الآن.', 'لن أخمّن هنا.', 'هذا يحتاج مراجعة فعلية.'],
  chinese: ['我明白。', '这个问题很合理。', '我会认真核实。', '我已经了解上下文。', '这里不能靠猜。', '这需要真实核验。'],
};

function expandedFallbacks(base: string[], language: FallbackLanguage): string[] {
  return FOLLOW_UP_SUFFIXES[language].map((suffix, index) => {
    const scenarioReply = base[index % base.length];
    const withoutRepeatedOpening = scenarioReply.replace(/^[^.!?。！？]+[.!?。！？]\s*/u, '').trim() || scenarioReply;
    return `${FOLLOW_UP_OPENERS[language][index]} ${withoutRepeatedOpening} ${suffix}`;
  });
}

function followUpMinutes(): number {
  const configured = Number(process.env.CUSTOMER_SERVICE_FOLLOW_UP_MINUTES ?? 240);
  return Number.isFinite(configured) ? Math.min(24 * 60, Math.max(15, Math.round(configured))) : 240;
}

export function resolveKnowledgeGapPlan(input: {
  message: string;
  language: unknown;
  timeline?: TimelineLike[];
}): KnowledgeGapPlan {
  const scenario = classifyKnowledgeGapScenario(input.message);
  const language = normalizeLanguage(input.language);
  const options = language === 'arabic'
    ? expandedFallbacks(ARABIC_REPLIES[scenario], 'arabic')
    : language === 'spanish'
    ? expandedFallbacks(SPANISH_REPLIES[scenario], 'spanish')
    : expandedFallbacks(ENGLISH_REPLIES[scenario], 'english');
  const chineseOptions = expandedFallbacks(CHINESE_REPLIES[scenario], 'chinese');
  const replyIndex = chooseNonRepeatedIndex(options, input.timeline ?? []);
  const minutes = followUpMinutes();
  return {
    scenario,
    draft: options[replyIndex],
    draftZh: chineseOptions[replyIndex] || chineseOptions[0],
    handoffRequired: true,
    safeToSendBeforeHandoff: true,
    handlingReason: HANDLING_REASON[scenario],
    variantCount: options.length,
    followUpMinutes: minutes,
    followUpDueAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    replyConfidence: {
      level: 'bridge_only',
      score: scenario === 'general_unknown' ? 0.35 : 0.55,
      reason: '这是一条不承诺业务事实的承接话术，真实答案等待人工确认',
    },
  };
}

export function ambiguousFaqClarification(language: unknown): { draft: string; draftZh: string } {
  const normalized = normalizeLanguage(language);
  const draft = normalized === 'arabic'
    ? 'أي منتج أو موديل تقصد تحديدًا، وما النقطة التي تريد تأكيدها؟'
    : normalized === 'spanish'
    ? '¿Qué producto o modelo exacto quieres confirmar y qué dato necesitas?'
    : 'Which exact product or model do you mean, and what detail should I confirm?';
  return { draft, draftZh: '请问您具体指哪个产品或型号，想确认哪一项信息？' };
}

export function scenarioHasGroundedEvidence(scenario: KnowledgeGapScenario, evidenceSource: string): boolean {
  const source = String(evidenceSource || '').toLowerCase();
  if (scenario === 'quality_or_certification' || scenario === 'competitor_comparison' || scenario === 'urgent_next_step' || scenario === 'price_or_quote' || scenario === 'high_value_or_peer' || scenario === 'order_or_logistics') return false;
  if (scenario === 'customization_or_packaging') return /\b(?:private[ -]?label|oem|odm|custom packaging|bilingual|arabic packaging)\b|贴牌|代工|定制包装|双语包装|阿拉伯语包装/.test(source);
  return false;
}
