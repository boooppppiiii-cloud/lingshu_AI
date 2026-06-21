import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import {
  generateVoiceoverScript,
  generateStoryboardScript,
  generateFromProduct,
  translateScript,
} from '../agents/gemini.js';
import type { ScriptType, Language, VideoAiAnalysis } from '../types/index.js';
import { SUPPORTED_LANGUAGES } from '../types/index.js';

export const scriptsRouter = Router();
scriptsRouter.use(requireAuth);

const COL = 'scripts';
const VIDEO_COL = 'trend_videos';

// ─── POST /scripts/generate ───────────────────────────────────────────────────
// Body: { videoId, type, language?, productInfo? }
scriptsRouter.post('/generate', async (req, res) => {
  const { userId, tenantId } = res.locals as AuthLocals;
  const { videoId, type, language = 'en', productInfo } = req.body as {
    videoId?: string;
    type?: ScriptType;
    language?: Language;
    productInfo?: string;
  };

  if (!videoId) { res.status(400).json({ error: 'videoId is required' }); return; }
  if (!type || !['voiceover', 'storyboard'].includes(type)) {
    res.status(400).json({ error: 'type must be voiceover or storyboard' });
    return;
  }
  if (!SUPPORTED_LANGUAGES.includes(language as Language)) {
    res.status(400).json({ error: `Unsupported language: ${language}` });
    return;
  }

  const videoRecord = await store.getById(VIDEO_COL, videoId);
  if (!videoRecord || videoRecord.tenantId !== tenantId) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }
  if (videoRecord.status !== 'analyzed') {
    res.status(409).json({ error: 'Video not yet analyzed', status: videoRecord.status });
    return;
  }

  let analysis: VideoAiAnalysis;
  try {
    analysis = JSON.parse(videoRecord.aiAnalysis as string) as VideoAiAnalysis;
  } catch {
    res.status(500).json({ error: 'Video analysis data is corrupted' });
    return;
  }

  try {
    const content =
      type === 'voiceover'
        ? await generateVoiceoverScript({ analysis, language: language as Language, productInfo })
        : await generateStoryboardScript({ analysis, language: language as Language, productInfo });

    const record = await store.create(COL, {
      tenantId,
      userId,
      sourceVideoId: videoId,
      type,
      language,
      content: JSON.stringify(content),
      productInfo: productInfo ?? '',
      status: 'draft',
      createdAt: new Date().toISOString(),
    });

    if (!record) { res.status(500).json({ error: 'Failed to save script' }); return; }
    res.status(201).json({ id: record.id, type, language, content });
  } catch (e) {
    console.error('[scripts] generate failed:', e);
    res.status(500).json({ error: 'Script generation failed', detail: String(e) });
  }
});

// ─── POST /scripts/generate-from-product ─────────────────────────────────────
// Body: { sourceScriptId, productInfo, language? }
scriptsRouter.post('/generate-from-product', async (req, res) => {
  const { userId, tenantId } = res.locals as AuthLocals;
  const { sourceScriptId, productInfo, language } = req.body as {
    sourceScriptId?: string;
    productInfo?: string;
    language?: Language;
  };

  if (!sourceScriptId) { res.status(400).json({ error: 'sourceScriptId is required' }); return; }
  if (!productInfo) { res.status(400).json({ error: 'productInfo is required' }); return; }

  const sourceRecord = await store.getById(COL, sourceScriptId);
  if (!sourceRecord || sourceRecord.tenantId !== tenantId) {
    res.status(404).json({ error: 'Source script not found' });
    return;
  }

  const targetLang = (language ?? sourceRecord.language ?? 'en') as Language;
  const type = sourceRecord.type as ScriptType;

  try {
    const sourceContent = JSON.parse(sourceRecord.content as string) as object;
    const newContent = await generateFromProduct({
      sourceScript: { type, content: sourceContent as never },
      productInfo,
      language: targetLang,
    });

    const record = await store.create(COL, {
      tenantId,
      userId,
      sourceVideoId: sourceRecord.sourceVideoId ?? '',
      type,
      language: targetLang,
      content: JSON.stringify(newContent),
      productInfo,
      status: 'draft',
      createdAt: new Date().toISOString(),
    });

    if (!record) { res.status(500).json({ error: 'Failed to save script' }); return; }
    res.status(201).json({ id: record.id, type, language: targetLang, content: newContent });
  } catch (e) {
    console.error('[scripts] generate-from-product failed:', e);
    res.status(500).json({ error: 'Script generation failed', detail: String(e) });
  }
});

// ─── GET /scripts ─────────────────────────────────────────────────────────────
scriptsRouter.get('/', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { page = '1', perPage = '20', type, status } = req.query as Record<string, string>;

  const where: Record<string, string> = { tenantId };
  if (type) where.type = type;
  if (status) where.status = status;

  const result = await store.list(COL, {
    where,
    sort: '-createdAt',
    page: Number(page),
    perPage: Math.min(100, Number(perPage)),
  });

  res.json(result);
});

// ─── GET /scripts/:id ─────────────────────────────────────────────────────────
scriptsRouter.get('/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id);

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(record);
});

// ─── PATCH /scripts/:id ───────────────────────────────────────────────────────
// Body: { content?, status? }
scriptsRouter.patch('/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id);

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const { content, status } = req.body as { content?: object; status?: string };
  const update: Record<string, unknown> = {};
  if (content !== undefined) update.content = JSON.stringify(content);
  if (status !== undefined) update.status = status;

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: 'Nothing to update' });
    return;
  }

  await store.update(COL, req.params.id, update);
  res.json({ ok: true });
});

// ─── DELETE /scripts/:id ──────────────────────────────────────────────────────
scriptsRouter.delete('/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id);

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  await store.delete(COL, req.params.id);
  res.json({ ok: true });
});

// ─── POST /scripts/:id/translate ─────────────────────────────────────────────
// Body: { targetLanguage }
scriptsRouter.post('/:id/translate', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const { targetLanguage } = req.body as { targetLanguage?: Language };

  if (!targetLanguage || !SUPPORTED_LANGUAGES.includes(targetLanguage)) {
    res.status(400).json({ error: `Unsupported targetLanguage: ${targetLanguage}` });
    return;
  }

  const record = await store.getById(COL, req.params.id);
  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  try {
    const sourceContent = JSON.parse(record.content as string) as object;
    const translated = await translateScript({
      script: sourceContent as never,
      targetLanguage,
    });

    const newRecord = await store.create(COL, {
      tenantId,
      userId,
      sourceVideoId: record.sourceVideoId ?? '',
      type: record.type,
      language: targetLanguage,
      content: JSON.stringify(translated),
      productInfo: record.productInfo ?? '',
      status: 'draft',
      createdAt: new Date().toISOString(),
    });

    if (!newRecord) { res.status(500).json({ error: 'Failed to save translated script' }); return; }
    res.status(201).json({ id: newRecord.id, language: targetLanguage, content: translated });
  } catch (e) {
    console.error('[scripts] translate failed:', e);
    res.status(500).json({ error: 'Translation failed', detail: String(e) });
  }
});
