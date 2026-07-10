import { Router } from 'express';
import { callLLM } from '../agents/llm.js';

export const draftReplyRouter = Router();

const SYSTEM_PROMPT = `You are Lingshu AI's My Customers conversion assistant for Yiwu cross-border sellers.
Write exactly one concise customer-facing reply that can be sent in WhatsApp.
Do not include explanations, markdown, labels, alternatives, or quotation marks.
Never include Chinese UI labels, Chinese internal notes, or Chinese internal product names in the customer-facing reply unless the customer's language is Chinese.
Use the Product field as the customer-facing product name. Treat Internal product name and Specific instruction as private seller context only.
If the customer asks for a call, confirm manager follow-up and ask for the best time.
If details are missing, ask one or two concrete qualification questions.
Match the customer's language when clear from the request; otherwise use English.`;

function cleanDraft(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, block => block.replace(/```[a-z]*|```/gi, '').trim())
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

draftReplyRouter.post('/conversion/draft', async (req, res) => {
  const body = req.body ?? {};
  const timeline = Array.isArray(body.timeline) ? body.timeline.slice(-8) : [];
  const intent = normalizeIntent(body.intent || body.mode);
  const prompt = [
    `Customer ID: ${String(body.customerId ?? '')}`,
    `Product: ${String(body.product ?? '')}`,
    body.internalProduct ? `Internal product name: ${String(body.internalProduct)}` : '',
    `Language: ${String(body.language ?? '')}`,
    `Stage: ${String(body.stage ?? '')}`,
    `Intent: ${intent}`,
    body.mode ? `Mode: ${String(body.mode)}` : '',
    intentInstruction(intent),
    body.instruction ? `Specific instruction: ${String(body.instruction)}` : '',
    'Recent timeline:',
    timeline.map((event: any) => {
      const actor = String(event?.actor ?? 'unknown');
      const type = String(event?.type ?? 'message');
      const text = String(event?.body ?? '');
      return `- ${actor}/${type}: ${text}`;
    }).join('\n'),
    '',
    intent === 'polish'
      ? 'Return only the polished seller reply. Keep it customer-facing and do not add explanations.'
      : 'Return one directly-sendable reply only.',
  ].filter(Boolean).join('\n');

  try {
    const raw = await callLLM(prompt, { systemPrompt: SYSTEM_PROMPT });
    const draft = cleanDraft(raw);
    res.json({ draft: draft || fallbackDraft(body, intent) });
  } catch (error) {
    res.json({ draft: fallbackDraft(body, intent) });
  }
});

function normalizeIntent(value: unknown): 'reply'|'opener'|'followup'|'reactivate'|'post_call'|'polish' {
  const v = String(value || '').trim();
  if (['opener', 'followup', 'reactivate', 'post_call', 'polish'].includes(v)) return v as any;
  return 'reply';
}

function intentInstruction(intent: ReturnType<typeof normalizeIntent>): string {
  if (intent === 'opener') return 'Intent instruction: Write a warm opener with a short self-introduction and a product hook. Ask one easy qualification question.';
  if (intent === 'followup') return 'Intent instruction: Write a light follow-up that gently moves the deal forward without pressure. Mention the prior quote or product context.';
  if (intent === 'reactivate') return 'Intent instruction: Write a reactivation message for an old customer. Refer to past order or interest when available and offer a useful update.';
  if (intent === 'post_call') return 'Intent instruction: Write a follow-up based on the latest call event. Use any call result or note in the timeline, and propose the next concrete step.';
  if (intent === 'polish') return 'Intent instruction: Polish the seller draft. Keep the same meaning, make it more natural, concise, and customer-facing.';
  return 'Intent instruction: Reply to the latest customer message naturally and helpfully.';
}

function fallbackDraft(body: any, intent: ReturnType<typeof normalizeIntent>): string {
  const product = String(body.product ?? 'the product');
  if (intent === 'opener') return `Hi, this is our sales team. We can support wholesale supply for ${product}. May I know your target quantity and market?`;
  if (intent === 'followup') return `Just following up on ${product}. If the quantity or packaging requirements are clear, I can confirm the best price and delivery time for you.`;
  if (intent === 'reactivate') return `Hi, we recently updated our options for ${product}. If you are still interested, I can send the latest catalog and wholesale offer for your review.`;
  if (intent === 'post_call') return `Thanks for the call. I will follow up on the details we discussed and send you the next step shortly.`;
  return `Thanks for your message. I will confirm the MOQ, best price, and delivery time for ${product}, then send you the details shortly.`;
}
