type TimelineLike = {
  actor?: unknown;
  type?: unknown;
  body?: unknown;
  timestamp?: unknown;
  time?: unknown;
};

export function isSimpleGreetingMessage(value: unknown): boolean {
  const text = String(value || '').trim().toLowerCase();
  return /^(hi|hello|hey|hi there|hello there|good morning|good afternoon|good evening|hola|buenas|你好|您好)[\s!,.?。！？]*$/i.test(text);
}

function isBuyer(event: TimelineLike): boolean {
  return String(event.actor || '').toLowerCase() === 'buyer' || String(event.type || '').includes('msg_in');
}

function isSeller(event: TimelineLike): boolean {
  return !isBuyer(event) && String(event.type || '') !== 'system';
}

export function hasPreviousConversation(timeline: TimelineLike[]): boolean {
  const latestBuyerIndex = timeline.map(isBuyer).lastIndexOf(true);
  const beforeLatest = latestBuyerIndex >= 0 ? timeline.slice(0, latestBuyerIndex) : timeline;
  return beforeLatest.some(event => isSeller(event) && String(event.body || '').trim());
}

export function conciseGreetingReply(language: unknown, returningCustomer: boolean, rememberedTopic = ''): string {
  const normalized = String(language || '').toLowerCase();
  const topic = String(rememberedTopic || '').trim();
  if (normalized.includes('arabic') || normalized.includes('阿拉伯')) {
    if (returningCustomer && topic) return `أهلًا من جديد! هل ما زلت مهتمًا بـ ${topic}؟`;
    return returningCustomer ? 'أهلًا من جديد! قل لي، أين نكمل اليوم؟' : 'أهلًا! قل لي، ماذا تبحث عنه؟';
  }
  if (normalized.includes('spanish') || normalized.includes('español') || normalized.includes('西语')) {
    if (returningCustomer && topic) return `¡Qué gusto verte de nuevo! ¿Sigues mirando ${topic}?`;
    return returningCustomer ? '¡Qué gusto verte de nuevo! Cuéntame, ¿por dónde seguimos?' : '¡Hola! Cuéntame, ¿qué estás buscando?';
  }
  if (returningCustomer && topic) return `Hey, good to hear from you again! Still looking at ${topic}?`;
  return returningCustomer ? 'Hey, good to hear from you again! What are we working on today?' : 'Hey! What are you looking for today?';
}

export function conversationToneGuidance(timeline: TimelineLike[], latestMessage: string): string {
  const returningCustomer = hasPreviousConversation(timeline);
  const latestIsGreeting = isSimpleGreetingMessage(latestMessage);
  return [
    `Relationship context: ${returningCustomer ? 'this is an ongoing conversation with a customer you already know' : 'this is the first conversation with this customer'}.`,
    returningCustomer
      ? 'Talk like someone who remembers this buyer. Pick up naturally from what they already asked about, viewed, needed, or agreed to, so the next reply feels like the same person continuing the same deal.'
      : 'Make the first contact warm and easy to answer, like an experienced salesperson opening a real chat rather than delivering a company introduction.',
    latestIsGreeting
      ? `The buyer only sent a greeting. Keep the reply light, natural, and easy to continue. ${returningCustomer ? 'Let the warmth show that you recognize them and gently reconnect with the unfinished topic when the timeline provides one.' : 'Open the door for them to say what they need without sounding like a scripted receptionist.'}`
      : 'Use the relevant details already present in the conversation and move the deal one natural step forward. Ask for information only when it is genuinely the next missing piece.',
    'Match the length to the moment: a casual one-line question deserves a short reply; a serious product question can take a little more space to explain clearly. Keep the warmth that belongs in the situation, and leave out anything that does not help the buyer or move the conversation forward.',
    'Chat like a capable trading partner on WhatsApp or WeChat: friendly when friendliness helps, direct when the next step is clear, and always natural in the buyer’s language.',
  ].join('\n');
}

