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

export function conciseGreetingReply(language: unknown, returningCustomer: boolean): string {
  const normalized = String(language || '').toLowerCase();
  if (normalized.includes('arabic') || normalized.includes('阿拉伯')) {
    return returningCustomer ? 'مرحبًا مجددًا! كيف يمكنني مساعدتك اليوم؟' : 'مرحبًا! كيف يمكنني مساعدتك؟';
  }
  if (normalized.includes('spanish') || normalized.includes('español') || normalized.includes('西语')) {
    return returningCustomer ? '¡Hola de nuevo! ¿En qué puedo ayudarte hoy?' : '¡Hola! ¿En qué puedo ayudarte?';
  }
  return returningCustomer ? 'Hi again! How can I help today?' : 'Hi! How can I help?';
}

export function conversationToneGuidance(timeline: TimelineLike[], latestMessage: string): string {
  const returningCustomer = hasPreviousConversation(timeline);
  const latestIsGreeting = isSimpleGreetingMessage(latestMessage);
  return [
    `Conversation status: ${returningCustomer ? 'continuing conversation with an existing customer' : 'first contact with this customer'}.`,
    returningCustomer
      ? 'Continue from the timeline. Do not introduce the company again, repeat the previous reply, or say “thanks for reaching out”.'
      : 'This is the first contact. Keep any greeting welcoming but do not recite a company profile.',
    latestIsGreeting
      ? `The latest message is only a greeting. Reply casually in no more than twelve words. ${returningCustomer ? 'Acknowledge that they are back and ask how you can help today.' : 'Greet them and ask how you can help.'}`
      : 'Answer the latest message using relevant earlier details; do not restart qualification questions that the buyer already answered.',
    'Human tone rules: use one or two short sentences, no more than thirty-five words total, and at most one question. Avoid formal filler, sales slogans, and phrases such as “happy to assist”.',
  ].join('\n');
}

