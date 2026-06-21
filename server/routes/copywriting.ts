import { Router } from 'express';
import { callLLM } from '../agents/llm.js';
import { buildCopywritingPrompt, type CopywritingParams } from '../prompts/copyPrompts.js';

export const copywritingRouter = Router();

copywritingRouter.post('/generate', async (req, res) => {
  const { productName, description, targetMarket, targetAudience, platform, tone, language, backend, model } = req.body as CopywritingParams & { backend?: string; model?: string };

  if (!productName || !description || !targetMarket || !platform || !language) {
    res.status(400).json({ error: 'productName, description, targetMarket, platform, language are required' });
    return;
  }

  try {
    const prompt = buildCopywritingPrompt({ productName, description, targetMarket, targetAudience, platform, tone, language });
    const raw = await callLLM(prompt, { backend: backend as any, model });
    const json = extractJSON(raw);
    res.json({ ok: true, data: json });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'internal error' });
  }
});

function extractJSON(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { raw: text };
  try {
    return JSON.parse(match[0]);
  } catch {
    return { raw: text };
  }
}
