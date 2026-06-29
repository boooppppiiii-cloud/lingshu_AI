import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { generateImagePrompt } from '../agents/gemini.js';
import type { AssetType, StoryboardContent } from '../types/index.js';

export const assetsRouter = Router();
assetsRouter.use(requireAuth);

const COL = 'generated_assets';
const SCRIPT_COL = 'scripts';

// ─── POST /assets/generate ────────────────────────────────────────────────────
// Body: { scriptId, sceneIndex, type }
assetsRouter.post('/generate', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { scriptId, sceneIndex, type } = req.body as {
    scriptId?: string;
    sceneIndex?: number;
    type?: AssetType;
  };

  if (!scriptId) { res.status(400).json({ error: 'scriptId is required' }); return; }
  if (sceneIndex === undefined) { res.status(400).json({ error: 'sceneIndex is required' }); return; }
  if (!type || !['image', 'video'].includes(type)) {
    res.status(400).json({ error: 'type must be image or video' });
    return;
  }

  const scriptRecord = await store.getById(SCRIPT_COL, scriptId);
  if (!scriptRecord || scriptRecord.tenantId !== tenantId) {
    res.status(404).json({ error: 'Script not found' });
    return;
  }
  if (scriptRecord.type !== 'storyboard') {
    res.status(400).json({ error: 'Asset generation is only supported for storyboard scripts' });
    return;
  }

  let content: StoryboardContent;
  try {
    content = JSON.parse(scriptRecord.content as string) as StoryboardContent;
  } catch {
    res.status(500).json({ error: 'Script content is corrupted' });
    return;
  }

  const scene = content.scenes[sceneIndex];
  if (!scene) {
    res.status(400).json({ error: `Scene ${sceneIndex} not found in script` });
    return;
  }

  // Create asset record in "generating" state
  const record = await store.create(COL, {
    tenantId,
    scriptId,
    sceneIndex,
    type,
    fileId: '',
    prompt: '',
    status: 'generating',
    createdAt: new Date().toISOString(),
  });

  if (!record) {
    res.status(500).json({ error: 'Failed to create asset record' });
    return;
  }

  // Kick off async generation
  void generateAssetAsync(
    record.id as string,
    { action: scene.action, shot: scene.shot },
    scriptRecord.productInfo as string ?? '',
    type,
  );

  res.status(201).json({ id: record.id, status: 'generating' });
});

// ─── GET /assets/:scriptId ────────────────────────────────────────────────────
assetsRouter.get('/:scriptId', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;

  const scriptRecord = await store.getById(SCRIPT_COL, req.params.scriptId);
  if (!scriptRecord || scriptRecord.tenantId !== tenantId) {
    res.status(404).json({ error: 'Script not found' });
    return;
  }

  const result = await store.list(COL, {
    where: { tenantId, scriptId: req.params.scriptId },
    sort: 'sceneIndex',
    perPage: 100,
  });

  res.json(result);
});

// ─── Async generation ─────────────────────────────────────────────────────────
async function generateAssetAsync(
  recordId: string,
  scene: { action: string; shot: string },
  productInfo: string,
  type: AssetType,
): Promise<void> {
  try {
    const prompt = await generateImagePrompt({ scene, productInfo });

    // Update record with prompt; actual image/video generation would call
    // an external image/video generation API here (e.g. Imagen, Runway).
    // For now we store the prompt and mark as done to signal the frontend.
    await store.update(COL, recordId, {
      prompt,
      status: 'done',
    });

    console.log(`[assets] generated prompt for ${recordId} (${type})`);
  } catch (e) {
    console.error(`[assets] generation failed for ${recordId}:`, e);
    await store.update(COL, recordId, { status: 'failed' });
  }
}
