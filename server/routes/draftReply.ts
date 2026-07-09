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
  const prompt = [
    `Customer ID: ${String(body.customerId ?? '')}`,
    `Product: ${String(body.product ?? '')}`,
    body.internalProduct ? `Internal product name: ${String(body.internalProduct)}` : '',
    `Language: ${String(body.language ?? '')}`,
    `Stage: ${String(body.stage ?? '')}`,
    body.mode ? `Mode: ${String(body.mode)}` : '',
    body.instruction ? `Specific instruction: ${String(body.instruction)}` : '',
    'Recent timeline:',
    timeline.map((event: any) => {
      const actor = String(event?.actor ?? 'unknown');
      const type = String(event?.type ?? 'message');
      const text = String(event?.body ?? '');
      return `- ${actor}/${type}: ${text}`;
    }).join('\n'),
    '',
    body.mode === 'polish'
      ? 'Return only the polished seller reply. Keep it customer-facing and do not add explanations.'
      : 'Return one directly-sendable reply only.',
  ].filter(Boolean).join('\n');

  try {
    const raw = await callLLM(prompt, { systemPrompt: SYSTEM_PROMPT });
    const draft = cleanDraft(raw);
    res.json({ draft: draft || fallbackDraft(body) });
  } catch (error) {
    res.json({ draft: fallbackDraft(body) });
  }
});

function fallbackDraft(body: any): string {
  const product = String(body.product ?? 'the product');
  return `Thanks for your message. I will confirm the MOQ, best price, and delivery time for ${product}, then send you the details shortly.`;
}
