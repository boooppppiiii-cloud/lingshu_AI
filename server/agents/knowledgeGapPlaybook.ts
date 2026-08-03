import { chooseNonRepeatedIndex, type TimelineLike } from '../lib/nonRepeatingReply.js';

export type KnowledgeGapScenario =
  | 'after_sale_complaint'
  | 'call_request'
  | 'delivery_commitment'
  | 'product_availability'
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

type SupportedLanguage = 'english' | 'spanish' | 'arabic';
type ReplyPair = { draft: string; draftZh: string };

const LARGE_ORDER_PATTERN = /\b(\d[\d,]*(?:\.\d+)?)\s*(?:pcs?|pieces?|units?|sets?|bottles?|boxes?|cartons?)\b/gi;
const PEER_PATTERN = /\b(?:we are (?:also )?(?:a )?(?:supplier|factory|manufacturer|trading company)|i am (?:also )?(?:a )?(?:supplier|manufacturer|trader)|our factory|resell to other suppliers)\b|我们也是供应商|我们是工厂|我们也是厂家|同行/i;

const SCENARIO_PATTERNS: Array<{ scenario: KnowledgeGapScenario; pattern: RegExp }> = [
  {
    scenario: 'after_sale_complaint',
    pattern: /\b(?:complaint|refund|return|damaged|broken|defective|wrong item|not as described|unacceptable|very disappointed|compensation)\b|投诉|退款|退货|破损|损坏|瑕疵|发错|货不对板|无法接受|很失望|赔偿/i,
  },
  {
    scenario: 'call_request',
    pattern: /\b(?:call me|phone call|video call|can we (?:talk|call)|speak (?:by phone|on a call|to (?:a )?manager)|whatsapp call|zoom|google meet)\b|给我打电话|打个电话|视频通话|语音通话|开会聊|电话聊|找经理聊/i,
  },
  {
    scenario: 'competitor_comparison',
    pattern: /\b(?:another supplier|other supplier|competitor|offered|why should i choose|compare (?:you|your)|better than)\b|其他供应商|另一家|竞争对手|为什么选你|对比你们/i,
  },
  {
    scenario: 'delivery_commitment',
    pattern: /\b(?:(?:can you|will you|do you) guarantee.{0,24}(?:delivery|arrival|shipping|date|days?)|guaranteed? (?:delivery|arrival|shipping)|must arrive|arrive by|deliver by|ship in \d+ days?|within \d+ days?)\b|保证.*(?:到货|交付|发货)|必须.*(?:到货|交付)|\d+天内.*(?:到货|交付|发货)/i,
  },
  {
    scenario: 'quality_or_certification',
    pattern: /\b(?:quality|reliable|certificate|certification|gmp|iso|coa|lab report|test report|inspection|compliance|fake cert|standard)\b|质量|可靠|证书|认证|检测报告|验货|合规|假证/i,
  },
  {
    scenario: 'product_availability',
    pattern: /\b(?:do you have|have you got|available|in stock|what colo(?:u)?rs|which colo(?:u)?rs|what sizes|which sizes|size\s+[a-z0-9-]+|black|white|navy|beige|red|blue|green)\b|有货吗|现货|有哪些颜色|什么颜色|有哪些尺码|什么尺码|黑色|白色|藏青|米色/i,
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
    pattern: /\b(?:today|end of day|right now|immediately|urgent|move this forward|what exactly do you need|no back and forth|how (?:fast|soon))\b|今天|马上|尽快|加急|怎么推进|不要来回沟通/i,
  },
  {
    scenario: 'customization_or_packaging',
    pattern: /\b(?:private[ -]?label|customi[sz]e|custom packaging|our logo|my logo|bilingual|arabic packaging|label design|packaging style|oem|odm)\b|贴牌|定制|包装|双语|阿拉伯语|徽标|商标|代工/i,
  },
];

function hasLargeOrderSignal(message: string): boolean {
  for (const match of message.matchAll(LARGE_ORDER_PATTERN)) {
    const quantity = Number(String(match[1]).replace(/,/g, ''));
    if (Number.isFinite(quantity) && quantity >= 1000) return true;
  }
  return false;
}

export function classifyKnowledgeGapScenario(message: string): KnowledgeGapScenario {
  const value = String(message || '').trim();
  for (const item of SCENARIO_PATTERNS.slice(0, 6)) {
    if (item.pattern.test(value)) return item.scenario;
  }
  if (PEER_PATTERN.test(value) || hasLargeOrderSignal(value)) return 'high_value_or_peer';
  for (const item of SCENARIO_PATTERNS.slice(6)) {
    if (item.pattern.test(value)) return item.scenario;
  }
  return 'general_unknown';
}

function normalizeLanguage(value: unknown): SupportedLanguage {
  const language = String(value || '').toLowerCase();
  if (language.includes('arabic') || language.includes('阿语') || language.includes('العربية')) return 'arabic';
  if (language.includes('spanish') || language.includes('西语') || language.includes('español')) return 'spanish';
  return 'english';
}

const HANDLING_REASON: Record<KnowledgeGapScenario, string> = {
  after_sale_complaint: '客户正在投诉或要求退款，需要负责人立即接管并核对订单证据',
  call_request: '客户希望电话或视频沟通，需要人工确认可用时间并接管',
  delivery_commitment: '客户要求保证交付时间，需要人工核实生产与物流后确认',
  product_availability: '客户正在确认颜色、尺码或库存，需要核对当前产品资料与实时可用状态',
  quality_or_certification: '客户在确认质量或资质真实性，需要人工核验真实文件',
  competitor_comparison: '客户正在比较供应商条件，需要销售确认同口径方案',
  customization_or_packaging: '客户提出定制或包装需求，需要确认真实可执行范围',
  urgent_next_step: '客户希望快速推进，需要负责人确认下一步与时间',
  order_or_logistics: '客户在查询订单、物流或付款状态，需要人工核对真实记录',
  price_or_quote: '客户正在询价或确认交易条件，需要销售人工报价',
  high_value_or_peer: '疑似大单或同行客户，需要销售负责人判断并接管',
  general_unknown: '客户问题超出企业知识库，需要先澄清关键点，重复出现时转人工确认',
};

const ENGLISH: Record<KnowledgeGapScenario, ReplyPair[]> = {
  after_sale_complaint: [
    { draft: "I'm sorry this happened. Send me the order number and a couple of clear photos, and I'll get our manager on it now.", draftZh: '很抱歉出了这个问题。请把订单号和两张清楚的照片发给我，我现在就请负责人处理。' },
    { draft: "I get why you're upset. Send the order number and photos of the issue here; I'm bringing in our manager now.", draftZh: '我理解您为什么生气。请把订单号和问题照片发在这里，我现在请负责人接手。' },
    { draft: "That's not the experience you should have had. Share the order number and clear photos, and I'll have our manager take this over now.", draftZh: '这次体验确实不应该这样。请发来订单号和清楚的照片，我现在让负责人接手处理。' },
  ],
  call_request: [
    { draft: "Sure, let's talk. What time works for you today?", draftZh: '可以，我们电话聊。您今天什么时间方便？' },
    { draft: 'Yes, a call is easier. Send me a time that suits you and I’ll get the right person to join.', draftZh: '可以，电话沟通更方便。请发一个您合适的时间，我会请对应负责人参加。' },
    { draft: 'No problem. Tell me your time zone and a good time to call.', draftZh: '没问题。请告诉我您的时区和方便通话的时间。' },
  ],
  delivery_commitment: [
    { draft: "I don't want to promise a date before checking the real production and shipping time. I'm getting sales to confirm it for this order now.", draftZh: '我不想在核实真实生产和运输时间前随口承诺日期。我现在请销售按这笔订单确认。' },
    { draft: "That date is important, so I won't guess. I'm bringing in sales to check the actual timeline and confirm it here.", draftZh: '这个日期很重要，所以我不会靠猜。我现在请销售核对真实时间并在这里确认。' },
    { draft: "Let me get the real timeline checked first. Sales will confirm whether that delivery date is workable for this order.", draftZh: '我先请人核对真实时间。销售会确认这笔订单是否能做到这个交付日期。' },
  ],
  product_availability: [
    { draft: "I don't want to guess the current options. I'm asking our product colleague to check this item now.", draftZh: '我不想靠猜现在有哪些选项。我正在请产品同事核对这款产品。' },
    { draft: "Let me check this exact option with our product colleague first, then we'll confirm it here.", draftZh: '我先请产品同事核对这个具体选项，然后在这里给您确认。' },
    { draft: "I'll get the product colleague to check the current options for this one now.", draftZh: '我现在请产品同事核对这款产品当前可选的内容。' },
  ],
  quality_or_certification: [
    { draft: "You're right to check. I won't say a certificate is valid before it's matched to this product. I'm bringing in a colleague to verify the real file with you now.", draftZh: '您要核实是对的。在证书与这个产品核对一致前，我不会说它有效。我现在请同事一起核验真实文件。' },
    { draft: "Fair question. Let's verify the actual document and certificate number for this product, not just take a supplier's word for it. I'm getting the right person on it now.", draftZh: '这个问题很合理。我们要核验这个产品对应的真实文件和证书编号，不能只听供应商口头说。我现在请对应负责人处理。' },
    { draft: "I understand why you're careful. I'm asking our team to check the exact document against this product before we give you an answer.", draftZh: '我理解您为什么谨慎。我会请团队先核对这份文件是否与产品一致，再给您答复。' },
  ],
  competitor_comparison: [
    { draft: "That's worth comparing. The fair way is to check what's included, not only the headline number. I'm bringing sales in to compare the same scope with you.", draftZh: '这个报价值得比较。公平的方式是看清包含哪些内容，而不只看表面的数字。我现在请销售按同一范围与您比较。' },
    { draft: "300 pcs and 10 days sounds attractive. Let's check whether the packaging, documents and delivery scope are really the same; sales can compare it properly with you.", draftZh: '300 件和 10 天确实有吸引力。我们先确认包装、文件和交付范围是否完全相同，销售会按同一口径与您比较。' },
    { draft: "Good offer on the surface. I'll get sales to compare the full scope with you so you can see the real difference.", draftZh: '表面看是个不错的报价。我会请销售把完整范围放在一起比较，让您看清真实差异。' },
  ],
  customization_or_packaging: [
    { draft: "Got it—your label, with both languages on the pack. Send me the logo or a pack you like and I'll ask our packaging colleague to check it 👍", draftZh: '明白，要用您的品牌，包装上放两种语言。把 Logo 或喜欢的包装参考发来，我会请包装同事核对。' },
    { draft: "I see the look you're after. Drop the logo and a packaging reference here; I'll keep it together and ask our packaging colleague to check it 👍", draftZh: '我明白您想要的效果。把 Logo 和包装参考发在这里，我会整理好并请包装同事核对。' },
    { draft: "Private label, got it. Send the logo or a pack you like and I'll ask our packaging colleague to look at it 👍", draftZh: '明白，您要做贴牌。把 Logo 或喜欢的包装参考发来，我会请包装同事看一下。' },
  ],
  urgent_next_step: [
    { draft: "Got it—you want this simple. I've kept everything you already sent, so just add anything that's still missing and I'll get someone to confirm the next step.", draftZh: '明白，您想简单推进。我已经记下您发过的信息，只需补充还缺的内容，我会请人确认下一步。' },
    { draft: "Let's keep it simple. I have what you've already shared; just add any missing deadline or packaging reference and I'll get the next step confirmed.", draftZh: '我们简单推进。我已经记下您说过的信息，只需补充还没提到的截止时间或包装参考，我会请人确认下一步。' },
    { draft: "Got it. I won't make you repeat anything—I'm asking the right colleague to pick it up from here.", draftZh: '明白，我不会让您重复说明。现在请对应同事直接从这里继续跟进。' },
  ],
  order_or_logistics: [
    { draft: "Send me the order number and I'll ask the team to check what's happening.", draftZh: '把订单号发给我，我会请团队查一下现在是什么情况。' },
    { draft: "Let me check the order itself instead of guessing. What's the order number?", draftZh: '我会直接核对订单，不靠猜。请问订单号是多少？' },
    { draft: "Drop the order number here and I'll get the colleague handling it to check.", draftZh: '把订单号发在这里，我会请负责的同事核查。' },
  ],
  price_or_quote: [
    { draft: "I won't guess the price here. I'm bringing sales in for the exact quote; if there's any spec or packaging detail we haven't covered, add it here.", draftZh: '我不会随口猜价格。我现在请销售核算准确报价；如果还有没提到的规格或包装细节，请在这里补充。' },
    { draft: "Got it. Sales needs to confirm the real quote for this order, so I'm passing them the details you've already shared.", draftZh: '明白。这笔订单需要销售确认真实报价，我会把您已经说过的信息一起交给他们。' },
    { draft: "Let me get a proper quote checked. I have the details above, so only add anything that's still missing.", draftZh: '我请销售核算正式报价。上面的信息我已经记下，只需补充尚未提到的内容。' },
  ],
  high_value_or_peer: [
    { draft: "That's a serious volume. I'm bringing in our sales lead now and passing over the details you've already shared.", draftZh: '这个数量需要认真跟进。我现在请销售负责人接手，并把您已经提供的信息一起交给他。' },
    { draft: "Got it—this needs a proper commercial review. I'll bring in our sales lead with the context ready.", draftZh: '明白，这需要正式的商务评估。我会带着完整上下文请销售负责人接手。' },
    { draft: "This is worth handling properly. I'm getting our sales lead involved now, and you won't need to repeat the brief.", draftZh: '这条需求值得认真处理。我现在请销售负责人参与，您不需要重复说明。' },
  ],
  general_unknown: [
    { draft: "I don't have a solid answer for that yet. Which exact part do you want me to check?", draftZh: '这件事我现在还没有可靠答案。您最想确认的是哪一部分？' },
    { draft: "I don't want to guess here. Tell me the one detail that matters most and I'll check from there.", draftZh: '这件事我不想靠猜。请告诉我您最在意的一个细节，我从那里开始核实。' },
    { draft: "I need one more detail before I can point you the right way: what exactly are you trying to confirm?", draftZh: '我还需要一个细节才能准确处理：您具体想确认什么？' },
  ],
};

function localizedPairs(language: SupportedLanguage, scenario: KnowledgeGapScenario): ReplyPair[] {
  if (language === 'english') return ENGLISH[scenario];
  if (language === 'spanish') {
    const spanish: Partial<Record<KnowledgeGapScenario, ReplyPair[]>> = {
      after_sale_complaint: [
        { draft: 'Siento que haya pasado esto. Envíame el número de pedido y un par de fotos claras; voy a llamar al responsable ahora.', draftZh: '很抱歉出了这个问题。请发来订单号和两张清楚的照片，我现在请负责人处理。' },
        { draft: 'Entiendo tu enfado. Pásame el número de pedido y fotos del problema; voy a pedir al responsable que lo revise ahora.', draftZh: '我理解您为什么生气。请发来订单号和问题照片，我现在请负责人核查。' },
      ],
      call_request: [
        { draft: 'Claro, hablemos. ¿A qué hora te viene bien hoy?', draftZh: '可以，我们电话聊。您今天什么时间方便？' },
        { draft: 'Sí, una llamada será más fácil. Dime tu zona horaria y una hora que te venga bien.', draftZh: '可以，电话沟通更方便。请告诉我您的时区和合适时间。' },
      ],
      delivery_commitment: [
        { draft: 'No quiero prometer una fecha sin comprobar producción y envío reales. Voy a pedir a ventas que confirme el plazo para este pedido.', draftZh: '我不想在核实真实生产和运输时间前承诺日期。我会请销售确认这笔订单的时间。' },
        { draft: 'Esa fecha importa, así que no voy a adivinar. Ventas revisará el plazo real y lo confirmará aquí.', draftZh: '这个日期很重要，所以我不会靠猜。销售会核对真实时间并在这里确认。' },
      ],
      quality_or_certification: [
        { draft: 'Tienes razón en comprobarlo. No diré que un certificado es válido hasta verificar que corresponde a este producto. Voy a llamar al responsable ahora.', draftZh: '您要核实是对的。在确认与产品一致前，我不会说证书有效。我现在请负责人处理。' },
        { draft: 'Es una duda justa. Vamos a verificar el documento y el número de certificado reales para este producto.', draftZh: '这个问题很合理。我们会核验这个产品对应的真实文件和证书编号。' },
      ],
      general_unknown: [
        { draft: 'Todavía no tengo una respuesta fiable. ¿Qué punto exacto quieres que compruebe?', draftZh: '这件事我现在还没有可靠答案。您具体想确认哪一点？' },
        { draft: 'No quiero adivinar. Dime el detalle más importante y lo reviso desde ahí.', draftZh: '我不想靠猜。请告诉我最重要的细节，我从那里开始核实。' },
      ],
    };
    const fallback: Record<KnowledgeGapScenario, ReplyPair> = {
      after_sale_complaint: spanish.after_sale_complaint![0],
      call_request: spanish.call_request![0],
      delivery_commitment: spanish.delivery_commitment![0],
      product_availability: { draft: 'No quiero adivinar las opciones actuales. Voy a pedir al responsable de producto que revise este artículo ahora.', draftZh: '我不想靠猜现在有哪些选项。我正在请产品负责人核对这款产品。' },
      quality_or_certification: spanish.quality_or_certification![0],
      competitor_comparison: { draft: 'Vale la pena compararlo bien. Voy a pedir a ventas que revise el mismo alcance contigo, no solo el número principal.', draftZh: '这个报价值得认真比较。我会请销售按同一范围与您比较，而不只看表面的数字。' },
      customization_or_packaging: { draft: 'Entendido: marca privada y empaque bilingüe. Envíame el logo o una referencia y pediré que confirmen lo que realmente podemos hacer 👍', draftZh: '明白，您要贴牌和双语包装。请发来 Logo 或参考，我会请人确认真实可执行范围。' },
      urgent_next_step: { draft: 'Entendido, quieres avanzar sin tantas vueltas. Ya tengo lo que compartiste; añade solo lo que falte y pediré que confirmen el siguiente paso.', draftZh: '明白，您想直接推进。我已经记下您说过的信息，只需补充缺少的内容，我会请人确认下一步。' },
      order_or_logistics: { draft: 'Necesito revisar el registro real. Envíame el número de pedido y pediré que comprueben el estado.', draftZh: '这需要核对真实记录。请发来订单号，我会请人核查状态。' },
      price_or_quote: { draft: 'No voy a inventar el precio. Voy a pasar a ventas los datos que ya compartiste para que confirme la cotización real.', draftZh: '我不会随口猜价格。我会把您已经说过的信息交给销售，请他们确认真实报价。' },
      high_value_or_peer: { draft: 'Es un volumen importante. Voy a llamar al responsable de ventas y le pasaré los datos que ya compartiste.', draftZh: '这个数量需要认真跟进。我会请销售负责人接手，并把您已经提供的信息一起交给他。' },
      general_unknown: spanish.general_unknown![0],
    };
    return spanish[scenario] ?? [fallback[scenario]];
  }
  const arabic: Partial<Record<KnowledgeGapScenario, ReplyPair[]>> = {
    after_sale_complaint: [
      { draft: 'آسف لما حدث. أرسل رقم الطلب وصورتين واضحتين، وسأطلب من المسؤول متابعة الموضوع الآن.', draftZh: '很抱歉出了这个问题。请发来订单号和两张清楚的照片，我现在请负责人处理。' },
      { draft: 'أتفهم انزعاجك. أرسل رقم الطلب وصور المشكلة هنا، وسأُدخل المسؤول في المحادثة الآن.', draftZh: '我理解您为什么生气。请发来订单号和问题照片，我现在请负责人加入处理。' },
    ],
    call_request: [
      { draft: 'بالتأكيد، لنتحدث. ما الوقت المناسب لك اليوم؟', draftZh: '可以，我们电话聊。您今天什么时间方便？' },
      { draft: 'نعم، المكالمة أسهل. أرسل منطقتك الزمنية والوقت المناسب لك.', draftZh: '可以，电话沟通更方便。请告诉我您的时区和合适时间。' },
    ],
    delivery_commitment: [
      { draft: 'لا أريد أن أعد بموعد قبل التحقق من وقت الإنتاج والشحن الفعلي. سأطلب من المبيعات تأكيد المدة لهذا الطلب.', draftZh: '我不想在核实真实生产和运输时间前承诺日期。我会请销售确认这笔订单的时间。' },
      { draft: 'هذا الموعد مهم، لذلك لن أخمّن. ستراجع المبيعات المدة الفعلية وتؤكدها هنا.', draftZh: '这个日期很重要，所以我不会靠猜。销售会核对真实时间并在这里确认。' },
    ],
    quality_or_certification: [
      { draft: 'من حقك أن تتحقق. لن أقول إن الشهادة صحيحة قبل مطابقتها مع هذا المنتج. سأطلب من المسؤول التحقق منها الآن.', draftZh: '您要核实是对的。在确认与产品一致前，我不会说证书有效。我现在请负责人核验。' },
      { draft: 'سؤال منطقي. لنتحقق من المستند الحقيقي ورقم الشهادة لهذا المنتج.', draftZh: '这个问题很合理。我们会核验这个产品对应的真实文件和证书编号。' },
    ],
    general_unknown: [
      { draft: 'ليس لدي جواب موثوق بعد. ما النقطة التي تريد مني التحقق منها بالضبط؟', draftZh: '这件事我现在还没有可靠答案。您具体想确认哪一点？' },
      { draft: 'لا أريد أن أخمّن. أخبرني بأهم تفصيل لديك وسأبدأ التحقق منه.', draftZh: '我不想靠猜。请告诉我最重要的细节，我从那里开始核实。' },
    ],
  };
  const fallback: Record<KnowledgeGapScenario, ReplyPair> = {
    after_sale_complaint: arabic.after_sale_complaint![0],
    call_request: arabic.call_request![0],
    delivery_commitment: arabic.delivery_commitment![0],
    product_availability: { draft: 'لا أريد أن أخمّن الخيارات المتاحة الآن. سأطلب من مسؤول المنتج مراجعة هذا المنتج.', draftZh: '我不想靠猜现在有哪些选项。我正在请产品负责人核对这款产品。' },
    quality_or_certification: arabic.quality_or_certification![0],
    competitor_comparison: { draft: 'هذا العرض يستحق مقارنة دقيقة. سأطلب من المبيعات مقارنة نفس النطاق معك، وليس الرقم الظاهر فقط.', draftZh: '这个报价值得认真比较。我会请销售按同一范围与您比较，而不只看表面的数字。' },
    customization_or_packaging: { draft: 'واضح: علامة خاصة وتغليف بلغتين. أرسل الشعار أو مرجعًا للتغليف وسأطلب تأكيد ما يمكن تنفيذه فعليًا 👍', draftZh: '明白，您要贴牌和双语包装。请发来 Logo 或包装参考，我会请人确认真实可执行范围。' },
    urgent_next_step: { draft: 'واضح أنك تريد التقدم بدون نقاش طويل. لدي ما أرسلته، فأضف فقط أي تفصيل ناقص وسأطلب تأكيد الخطوة التالية.', draftZh: '明白，您想直接推进。我已经记下您说过的信息，只需补充缺少的内容，我会请人确认下一步。' },
    order_or_logistics: { draft: 'أحتاج إلى مراجعة سجل الطلب الحقيقي. أرسل رقم الطلب وسأطلب التحقق من الحالة.', draftZh: '这需要核对真实订单记录。请发来订单号，我会请人核查状态。' },
    price_or_quote: { draft: 'لن أخمّن السعر. سأرسل للمبيعات التفاصيل التي شاركتها بالفعل لتأكيد العرض الحقيقي.', draftZh: '我不会随口猜价格。我会把您已经说过的信息交给销售，请他们确认真实报价。' },
    high_value_or_peer: { draft: 'هذه كمية مهمة. سأطلب من مسؤول المبيعات الانضمام وسأرسل له التفاصيل التي شاركتها بالفعل.', draftZh: '这个数量需要认真跟进。我会请销售负责人接手，并把您已经提供的信息一起交给他。' },
    general_unknown: arabic.general_unknown![0],
  };
  return arabic[scenario] ?? [fallback[scenario]];
}

function followUpMinutes(): number {
  const configured = Number(process.env.CUSTOMER_SERVICE_FOLLOW_UP_MINUTES ?? 240);
  return Number.isFinite(configured) ? Math.min(24 * 60, Math.max(15, Math.round(configured))) : 240;
}

function firstBuyerQuantity(message: string): string {
  return String(message || '').match(/\b\d[\d,]*(?:\.\d+)?\s*(?:pcs?|pieces?|units?|sets?|bottles?|boxes?|cartons?)\b/i)?.[0] || '';
}

function firstBuyerDeliveryWindow(message: string): string {
  return String(message || '').match(/\b(?:within|in)\s+\d+\s+days?\b/i)?.[0] || '';
}

function quantityInChinese(value: string): string {
  return value
    .replace(/\bpcs?\b|\bpieces?\b|\bunits?\b/i, '件')
    .replace(/\bsets?\b/i, '套')
    .replace(/\bbottles?\b/i, '瓶')
    .replace(/\bboxes?\b|\bcartons?\b/i, '箱');
}

function deliveryWindowInChinese(value: string): string {
  const days = value.match(/\d+/)?.[0];
  return days ? `${days} 天内` : value;
}

function personalizeEnglishBridge(scenario: KnowledgeGapScenario, message: string, fallback: ReplyPair): ReplyPair {
  const quantity = firstBuyerQuantity(message);
  const deliveryWindow = firstBuyerDeliveryWindow(message);
  if (scenario === 'product_availability') {
    const size = String(message || '').match(/\bsize\s+([a-z0-9-]+)\b/i)?.[1];
    const color = String(message || '').match(/\b(black|white|navy|beige|red|blue|green)\b/i)?.[1];
    if (size) return {
      draft: `I'll check size ${size.toUpperCase()} for this one with our product colleague now.`,
      draftZh: `我现在请产品同事核对这款的 ${size.toUpperCase()} 码。`,
    };
    if (color) {
      const colorZh: Record<string, string> = { black: '黑色', white: '白色', navy: '藏青色', beige: '米色', red: '红色', blue: '蓝色', green: '绿色' };
      return {
      draft: `I'll check the ${color.toLowerCase()} option for this one with our product colleague now.`,
        draftZh: `我现在请产品同事核对这款的${colorZh[color.toLowerCase()] || color}选项。`,
      };
    }
    if (/colo(?:u)?rs?/i.test(message)) return {
      draft: "I don't want to guess the colors. I'm asking our product colleague to confirm the current options now.",
      draftZh: '我不想靠猜有哪些颜色。我现在请产品同事确认当前可选颜色。',
    };
  }
  if (scenario === 'high_value_or_peer' && quantity) {
    return {
      draft: `${quantity}—yes, that needs our sales lead. I'm bringing them in now, and I've already passed over what you sent.`,
      draftZh: `${quantityInChinese(quantity)}，这个数量需要销售负责人跟进。我现在请他加入，并把您已经提供的信息一起交给他。`,
    };
  }
  if (scenario === 'competitor_comparison' && (quantity || deliveryWindow)) {
    const offer = quantity && deliveryWindow
      ? `${quantity} with delivery ${deliveryWindow}`
      : quantity || `delivery ${deliveryWindow}`;
    const offerZh = quantity && deliveryWindow
      ? `${quantityInChinese(quantity)}、交付时间 ${deliveryWindowInChinese(deliveryWindow)}`
      : quantityInChinese(quantity) || `交付时间 ${deliveryWindowInChinese(deliveryWindow)}`;
    return {
      draft: `${offer} does sound attractive. Before you decide, let's check whether the packaging, documents and delivery terms are really the same. I'll ask sales to compare it properly with you.`,
      draftZh: `${offerZh} 确实有吸引力。决定前，我们先确认包装、文件和交付条件是否真的相同。我会请销售按同一口径与您比较。`,
    };
  }
  if (scenario === 'delivery_commitment' && deliveryWindow) {
    const days = deliveryWindow.match(/\d+/)?.[0] || '';
    return {
      draft: `A ${days}-day delivery window is tight, so I don't want to say yes before production and shipping are checked. I'm getting sales to confirm the real timing for this order now.`,
      draftZh: `${days} 天的交付时间比较紧，所以在核实生产和运输前我不会随口答应。我现在请销售确认这笔订单的真实时间。`,
    };
  }
  return fallback;
}

export function resolveKnowledgeGapPlan(input: {
  message: string;
  language: unknown;
  timeline?: TimelineLike[];
}): KnowledgeGapPlan {
  const scenario = classifyKnowledgeGapScenario(input.message);
  const language = normalizeLanguage(input.language);
  const options = localizedPairs(language, scenario);
  const replyIndex = chooseNonRepeatedIndex(options.map(option => option.draft), input.timeline ?? []);
  const baseSelection = options[replyIndex] ?? options[0];
  const selected = language === 'english' && replyIndex === 0
    ? personalizeEnglishBridge(scenario, input.message, baseSelection)
    : baseSelection;
  const minutes = followUpMinutes();
  return {
    scenario,
    draft: selected.draft,
    draftZh: selected.draftZh,
    handoffRequired: true,
    safeToSendBeforeHandoff: true,
    handlingReason: HANDLING_REASON[scenario],
    variantCount: options.length,
    followUpMinutes: minutes,
    followUpDueAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    replyConfidence: {
      level: 'bridge_only',
      score: scenario === 'general_unknown' ? 0.35 : 0.55,
      reason: '这是一条不承诺业务事实的安全承接话术；真实答案等待人工确认',
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
  if (scenario === 'customization_or_packaging') {
    return /\b(?:private[ -]?label|oem|odm|custom packaging|bilingual|arabic packaging)\b|贴牌|代工|定制包装|双语包装|阿拉伯语包装/.test(source);
  }
  if (scenario === 'product_availability') {
    return /"(?:color|size|material)"\s*:\s*"(?!\s*")[^"]+"/i.test(source);
  }
  return false;
}
