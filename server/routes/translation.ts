import { Router } from 'express';
import { callLLM } from '../agents/llm.js';
import { buildTranslationPrompt, buildMultiLanguageBatchPrompt } from '../prompts/translationPrompts.js';

export const translationRouter = Router();

translationRouter.post('/single', async (req, res) => {
  const { text, targetLanguage, targetMarket, context, backend, model } = req.body as {
    text: string; targetLanguage: string; targetMarket?: string; context?: string; backend?: string; model?: string;
  };

  if (!text || !targetLanguage) {
    res.status(400).json({ error: 'text and targetLanguage are required' });
    return;
  }

  try {
    const prompt = buildTranslationPrompt({ text, targetLanguage, targetMarket, context });
    const result = await callLLM(prompt, { backend: backend as any, model });
    res.json({ ok: true, data: { translation: result.trim() } });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'internal error' });
  }
});

translationRouter.post('/batch', async (req, res) => {
  const { text, languages, targetMarket, context, backend, model } = req.body as {
    text: string; languages: string[]; targetMarket?: string; context?: string; backend?: string; model?: string;
  };

  if (!text || !Array.isArray(languages) || languages.length === 0) {
    res.status(400).json({ error: 'text and languages[] are required' });
    return;
  }

  try {
    const prompt = buildMultiLanguageBatchPrompt({ text, languages, targetMarket, context });
    const raw = await callLLM(prompt, { backend: backend as any, model });
    const match = raw.match(/\{[\s\S]*\}/);
    const data = match ? JSON.parse(match[0]) : { raw };
    res.json({ ok: true, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'internal error' });
  }
});
