export type KnowledgeGapScenario =
  | 'quality_or_certification'
  | 'competitor_comparison'
  | 'customization_or_packaging'
  | 'urgent_next_step'
  | 'order_or_logistics'
  | 'price_or_quote'
  | 'high_value_or_peer'
  | 'general_unknown';

type TimelineLike = { actor?: unknown; type?: unknown; body?: unknown };

export interface KnowledgeGapPlan {
  scenario: KnowledgeGapScenario;
  draft: string;
  draftZh: string;
  handoffRequired: true;
  safeToSendBeforeHandoff: true;
  handlingReason: string;
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

function canonicalReply(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function recentSellerTexts(timeline: TimelineLike[]): string[] {
  return timeline
    .filter(item => {
      const actor = String(item.actor || '').toLowerCase();
      return actor === 'seller' || actor === 'ai' || String(item.type || '').includes('msg_out');
    })
    .slice(-6)
    .map(item => canonicalReply(String(item.body || '')))
    .filter(Boolean);
}

function chooseNonRepeatedIndex(options: string[], timeline: TimelineLike[]): number {
  const recent = recentSellerTexts(timeline);
  const index = options.findIndex(option => {
    const candidate = canonicalReply(option);
    return !recent.some(previous => previous === candidate || previous.startsWith(candidate.slice(0, 80)) || candidate.startsWith(previous.slice(0, 80)));
  });
  return index >= 0 ? index : options.length - 1;
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
    'I understand why you’re careful. Send me the exact standard or document your clinics need. I’m handing this to our team to confirm what is genuinely available for this product.',
  ],
  competitor_comparison: [
    'That offer is worth comparing. Send me what it includes and your must-haves. I’m asking our sales team to check our MOQ, timing and documents against the same list—no guessing.',
    'Let’s compare the same things, not just one number. Send me their included scope and your top priority, and I’ll pass it to our sales team for a proper answer.',
  ],
  customization_or_packaging: [
    'Got it—private label and English-Arabic packaging. Send me the exact product, logo, target quantity and launch market. I’ll put it into one clean brief and have our team confirm what we can actually support 👍',
    'Send me the product, logo file, packaging reference and quantity. I’ll pass one clear brief to our team so you don’t have to explain it again 👍',
  ],
  urgent_next_step: [
    'Send me the product, logo or packaging reference, quantity and target launch date. I’ll put them into one brief for our team to confirm. I won’t promise timing before they check it 👌',
    'Keep it simple: send the product, quantity, packaging reference and deadline. I’ll hand over one complete brief and ask the right person to confirm the next step.',
  ],
  order_or_logistics: [
    'Send me the order number and the account or phone used for the order. I’ll pass it to the team to check the real status—better than guessing.',
    'I need the order number to check this properly. Send it here and I’ll hand the full context to the person who can verify the record.',
  ],
  price_or_quote: [
    'Got it. I’m passing this to sales for the exact quote. If you haven’t sent the quantity, specs and packaging yet, add them here so we can answer in one go.',
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
    'Es normal que quieras comprobarlo. Envíame el estándar o documento exacto que necesitas y nuestro equipo confirmará qué archivo real está disponible para este producto.',
  ],
  competitor_comparison: [
    'Vale la pena comparar la misma oferta. Envíame qué incluye y qué es lo más importante para ti; nuestro equipo comercial confirmará MOQ, plazo y documentos sin adivinar.',
    'Comparemos las mismas condiciones, no solo un número. Envíame lo que incluye su oferta y tu prioridad; lo paso a ventas para darte una respuesta real.',
  ],
  customization_or_packaging: [
    'Entendido: marca privada y empaque bilingüe. Envíame el producto, logo, cantidad y mercado; preparo un solo resumen para que el equipo confirme lo que realmente podemos hacer 👍',
    'Envíame producto, logo, referencia de empaque y cantidad. Lo paso todo en un solo resumen para que no tengas que explicarlo otra vez 👍',
  ],
  urgent_next_step: [
    'Envíame producto, cantidad, referencia de empaque y fecha objetivo. Lo paso todo en un solo resumen; no voy a prometer un plazo antes de confirmarlo 👌',
    'Hagámoslo fácil: producto, cantidad, empaque y fecha objetivo. Paso el resumen completo a la persona que confirmará el siguiente paso.',
  ],
  order_or_logistics: [
    'Envíame el número de pedido y el teléfono o cuenta usada. Lo paso al equipo para comprobar el estado real, sin adivinar.',
    'Necesito el número de pedido para revisarlo bien. Envíamelo y paso todo el contexto a la persona que puede confirmar el registro.',
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
    'من حقك أن تتأكد. أرسل المعيار أو المستند المطلوب بالضبط، وسيتحقق الفريق مما هو متاح فعليًا لهذا المنتج.',
  ],
  competitor_comparison: [
    'الأفضل أن نقارن نفس التفاصيل. أرسل لي ما يشمله عرضهم وما هو الأهم لك، وسأطلب من فريق المبيعات تأكيد الحد الأدنى والمدة والمستندات بدون تخمين.',
    'لنقارن نفس الشروط وليس رقمًا واحدًا فقط. أرسل تفاصيل عرضهم وأهم نقطة لك، وسأحوّلها للمبيعات لرد واضح.',
  ],
  customization_or_packaging: [
    'واضح: علامة خاصة وتغليف عربي-إنجليزي. أرسل المنتج والشعار والكمية والسوق، وسأجهز ملخصًا واحدًا للفريق لتأكيد ما يمكن تنفيذه فعليًا 👍',
    'أرسل المنتج والشعار ومرجع التغليف والكمية. سأحوّلها في ملخص واحد حتى لا تضطر لشرحها مرة أخرى 👍',
  ],
  urgent_next_step: [
    'أرسل المنتج والكمية ومرجع التغليف وموعد الإطلاق المطلوب. سأجمعها في ملخص واحد للفريق، ولن أعد بموعد قبل التأكيد 👌',
    'لنجعلها سهلة: المنتج والكمية والتغليف والموعد المطلوب. سأحوّل الملخص كاملًا للشخص الذي يؤكد الخطوة التالية.',
  ],
  order_or_logistics: [
    'أرسل رقم الطلب والحساب أو الهاتف المستخدم، وسأحوّل التفاصيل للفريق للتحقق من الحالة الفعلية بدون تخمين.',
    'أحتاج رقم الطلب للتحقق بشكل صحيح. أرسله هنا وسأحوّل كل السياق للشخص الذي يمكنه مراجعة السجل.',
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
    '理解您为什么谨慎。请发来诊所要求的具体标准或文件，我会转给团队确认这个产品真正能提供什么。',
  ],
  competitor_comparison: [
    '这个报价值得认真比较。请发来对方报价包含的内容和您的硬性要求，我会让销售按同一口径确认起订量、时间和文件，不靠猜。',
    '我们按相同条件比较，不只看一个数字。请发来对方包含的内容和您最看重的点，我会交给销售给出准确答复。',
  ],
  customization_or_packaging: [
    '明白，您需要贴牌和英阿双语包装。请发来具体产品、Logo、目标数量和销售市场，我会整理成一份清单，让团队确认真正能做到的范围。',
    '请发来产品、Logo 文件、包装参考和数量。我会整理后一次性交给团队，您不用重复说明。',
  ],
  urgent_next_step: [
    '请发来产品、Logo 或包装参考、数量和计划上市时间。我会整理后交给团队确认，在确认前我不会随口承诺时间。',
    '简单一点：把产品、数量、包装参考和截止时间发来。我会一次性交给对应负责人确认下一步。',
  ],
  order_or_logistics: [
    '请发来订单号，以及下单时使用的账号或手机号。我会交给团队核对真实状态，不靠猜。',
    '需要订单号才能准确核查。请发在这里，我会把完整上下文交给能核对记录的负责人。',
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

export function resolveKnowledgeGapPlan(input: {
  message: string;
  language: unknown;
  timeline?: TimelineLike[];
}): KnowledgeGapPlan {
  const scenario = classifyKnowledgeGapScenario(input.message);
  const language = normalizeLanguage(input.language);
  const options = language === 'arabic'
    ? ARABIC_REPLIES[scenario]
    : language === 'spanish'
    ? SPANISH_REPLIES[scenario]
    : ENGLISH_REPLIES[scenario];
  const replyIndex = chooseNonRepeatedIndex(options, input.timeline ?? []);
  return {
    scenario,
    draft: options[replyIndex],
    draftZh: CHINESE_REPLIES[scenario][replyIndex] || CHINESE_REPLIES[scenario][0],
    handoffRequired: true,
    safeToSendBeforeHandoff: true,
    handlingReason: HANDLING_REASON[scenario],
    replyConfidence: {
      level: 'bridge_only',
      score: scenario === 'general_unknown' ? 0.35 : 0.55,
      reason: '这是一条不承诺业务事实的承接话术，真实答案等待人工确认',
    },
  };
}

export function scenarioHasGroundedEvidence(scenario: KnowledgeGapScenario, evidenceSource: string): boolean {
  const source = String(evidenceSource || '').toLowerCase();
  if (scenario === 'quality_or_certification' || scenario === 'competitor_comparison' || scenario === 'urgent_next_step' || scenario === 'price_or_quote' || scenario === 'high_value_or_peer' || scenario === 'order_or_logistics') return false;
  if (scenario === 'customization_or_packaging') return /\b(?:private[ -]?label|oem|odm|custom packaging|bilingual|arabic packaging)\b|贴牌|代工|定制包装|双语包装|阿拉伯语包装/.test(source);
  return false;
}
