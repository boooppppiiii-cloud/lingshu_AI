type TimelineLike = {
  actor?: unknown;
  type?: unknown;
  body?: unknown;
  timestamp?: unknown;
  time?: unknown;
};

export type ConversationPhase = 'first_contact' | 'ongoing' | 'resumed';

export const CONVERSATION_RESUME_GAP_MS = 30 * 60 * 1000;

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

export function timelineTimestampMs(event: TimelineLike): number | null {
  const raw = event.timestamp ?? event.time;
  if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw.trim()))) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(raw || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function conversationPhase(
  timeline: TimelineLike[],
  resumeGapMs = CONVERSATION_RESUME_GAP_MS,
): ConversationPhase {
  const latestBuyerIndex = timeline.map(isBuyer).lastIndexOf(true);
  if (latestBuyerIndex < 0) return 'first_contact';
  let previousSellerIndex = -1;
  for (let index = latestBuyerIndex - 1; index >= 0; index -= 1) {
    if (isSeller(timeline[index])) {
      previousSellerIndex = index;
      break;
    }
  }
  if (previousSellerIndex < 0) return 'first_contact';
  const previousSellerAt = timelineTimestampMs(timeline[previousSellerIndex]);
  const latestBuyerAt = timelineTimestampMs(timeline[latestBuyerIndex]);
  if (previousSellerAt !== null && latestBuyerAt !== null && latestBuyerAt - previousSellerAt > resumeGapMs) {
    return 'resumed';
  }
  // Missing or unreliable timestamps must never create a false "Hi again" inside a live chat.
  return 'ongoing';
}

export function hasPreviousConversation(timeline: TimelineLike[]): boolean {
  return conversationPhase(timeline) !== 'first_contact';
}

export function conciseGreetingReply(language: unknown, phase: ConversationPhase, rememberedTopic = ''): string {
  const normalized = String(language || '').toLowerCase();
  const topic = String(rememberedTopic || '').trim();
  const resumed = phase === 'resumed';
  const ongoing = phase === 'ongoing';
  if (normalized.includes('arabic') || normalized.includes('阿拉伯')) {
    if (resumed && topic) return `أهلًا من جديد! هل نكمل بخصوص ${topic}؟`;
    if (resumed) return 'أهلًا من جديد! قل لي، أين نكمل؟';
    if (ongoing && topic) return `أكيد، نكمل بخصوص ${topic}. ماذا تريد أن نراجع؟`;
    if (ongoing) return 'أكيد، أنا معك. ماذا تريد أن نراجع؟';
    return 'أهلًا! قل لي، ماذا تبحث عنه؟';
  }
  if (normalized.includes('spanish') || normalized.includes('español') || normalized.includes('西语')) {
    if (resumed && topic) return `¡Hola de nuevo! ¿Seguimos con ${topic}?`;
    if (resumed) return '¡Hola de nuevo! Cuéntame, ¿por dónde seguimos?';
    if (ongoing && topic) return `Claro, seguimos con ${topic}. ¿Qué quieres revisar?`;
    if (ongoing) return 'Claro, sigo aquí. ¿Qué quieres revisar?';
    return '¡Hola! Cuéntame, ¿qué estás buscando?';
  }
  if (resumed && topic) return `Hi again! Shall we continue with ${topic}?`;
  if (resumed) return 'Hi again! Where shall we pick up?';
  if (ongoing && topic) return `Sure, let's continue with ${topic}. What do you want to check?`;
  if (ongoing) return "Sure, I'm with you. What do you want to check?";
  return 'Hey! What are you looking for today?';
}

export function conversationToneGuidance(timeline: TimelineLike[], latestMessage: string): string {
  const phase = conversationPhase(timeline);
  const latestIsGreeting = isSimpleGreetingMessage(latestMessage);
  const relationshipInstruction = phase === 'resumed'
    ? 'This buyer is returning after a pause of more than 30 minutes. A brief natural welcome-back is appropriate once, then continue the unfinished topic.'
    : phase === 'ongoing'
    ? 'This is the next message in the same live conversation. Reply directly to what the buyer just said. Do not greet again, say hi again, welcome them back, or restart the conversation; chat exactly like consecutive WeChat or WhatsApp messages.'
    : 'This is the first contact in the available timeline. Open warmly and make it easy for the buyer to say what they need.';
  return [
    `Conversation phase: ${phase}. A conversation counts as resumed only when the latest buyer message is more than 30 minutes after the preceding seller message; otherwise it is ongoing.`,
    relationshipInstruction,
    phase === 'first_contact'
      ? 'Make the first contact warm and easy to answer, like an experienced salesperson opening a real chat rather than delivering a company introduction.'
      : 'Talk like someone who remembers this buyer. Pick up naturally from what they already asked about, viewed, needed, or agreed to, so the next reply feels like the same person continuing the same deal.',
    latestIsGreeting
      ? phase === 'ongoing'
        ? 'The buyer sent a greeting inside an active chat. Acknowledge it without another greeting and reconnect directly to the current topic.'
        : 'The buyer only sent a greeting. Keep the reply light, natural, and easy to continue.'
      : 'Use the relevant details already present in the conversation and move the deal one natural step forward. Ask for information only when it is genuinely the next missing piece.',
    'Match the length to the moment: a casual one-line question deserves a short reply; a serious product question can take a little more space to explain clearly. Keep the warmth that belongs in the situation, and leave out anything that does not help the buyer or move the conversation forward.',
    'Chat like a capable trading partner on WhatsApp or WeChat: friendly when friendliness helps, direct when the next step is clear, and always natural in the buyer’s language.',
  ].join('\n');
}
