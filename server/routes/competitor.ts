import { Router } from 'express';
import { callLLM } from '../agents/llm.js';
import { buildCompetitorAnalysisPrompt, buildAdCreativeInsightPrompt } from '../prompts/competitorPrompts.js';

export const competitorRouter = Router();

competitorRouter.post('/analyze', async (req, res) => {
  const { competitorName, category, content, targetMarket, backend, model } = req.body as {
    competitorName: string; category: string; content: string; targetMarket?: string; backend?: string; model?: string;
  };

  if (!competitorName || !category || !content) {
    res.status(400).json({ error: 'competitorName, category, content are required' });
    return;
  }

  try {
    const prompt = buildCompetitorAnalysisPrompt({ competitorName, category, content, targetMarket });
    const raw = await callLLM(prompt, { backend: backend as any, model });
    const match = raw.match(/\{[\s\S]*\}/);
    const data = match ? JSON.parse(match[0]) : { raw };
    res.json({ ok: true, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'internal error' });
  }
});

competitorRouter.post('/creative-insight', async (req, res) => {
  const { adContent, platform, category, backend, model } = req.body as {
    adContent: string; platform: string; category?: string; backend?: string; model?: string;
  };

  if (!adContent || !platform) {
    res.status(400).json({ error: 'adContent and platform are required' });
    return;
  }

  try {
    const prompt = buildAdCreativeInsightPrompt({ adContent, platform, category });
    const raw = await callLLM(prompt, { backend: backend as any, model });
    const match = raw.match(/\{[\s\S]*\}/);
    const data = match ? JSON.parse(match[0]) : { raw };
    res.json({ ok: true, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'internal error' });
  }
});
