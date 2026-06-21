import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { pbCreate, pbGet, pbPatch, pbList } from '../storage/pb.js';
import { r2Upload, r2Download } from '../storage/r2.js';
import { analyzeVideo } from '../agents/gemini.js';
import type { Platform, VideoStatus } from '../types/index.js';

export const videosRouter = Router();
videosRouter.use(requireAuth);

const COL = 'trend_videos';

// ─── POST /videos/ingest ──────────────────────────────────────────────────────
// Body: { platform, title?, tags?, sourceUrl?, videoBase64?, mimeType?, r2Key? }
videosRouter.post('/ingest', async (req, res) => {
  const { userId, tenantId } = res.locals as AuthLocals;
  const { platform, title, tags, sourceUrl, videoBase64, mimeType, r2Key } = req.body as {
    platform?: Platform;
    title?: string;
    tags?: string[];
    sourceUrl?: string;
    videoBase64?: string;
    mimeType?: string;
    r2Key?: string;
  };

  if (!platform) {
    res.status(400).json({ error: 'platform is required' });
    return;
  }

  let fileId: string | undefined = r2Key;
  let thumbnailUrl = '';

  // If base64 video provided, upload to R2
  if (videoBase64 && !r2Key) {
    const buf = Buffer.from(videoBase64.replace(/^data:[^,]+,/, ''), 'base64');
    const ext = (mimeType ?? 'video/mp4').split('/')[1] ?? 'mp4';
    fileId = `${tenantId}/${Date.now()}.${ext}`;
    try {
      await r2Upload({ key: fileId, body: buf, contentType: mimeType ?? 'video/mp4' });
    } catch (e) {
      res.status(500).json({ error: 'R2 upload failed', detail: String(e) });
      return;
    }
  }

  const record = await pbCreate(COL, {
    tenantId,
    platform: platform ?? 'tiktok',
    title: title ?? '',
    thumbnailUrl,
    videoFileId: fileId ?? '',
    duration: 0,
    sourceUrl: sourceUrl ?? '',
    tags: JSON.stringify(tags ?? []),
    aiAnalysis: JSON.stringify({}),
    status: 'pending' as VideoStatus,
    crawledAt: new Date().toISOString(),
  });

  if (!record) {
    res.status(500).json({ error: 'Failed to create video record' });
    return;
  }

  // Trigger analysis async (fire and forget)
  void triggerVideoAnalysis(record.id as string, fileId, mimeType, userId);

  res.status(201).json({ id: record.id, status: 'pending' });
});

// ─── GET /videos ──────────────────────────────────────────────────────────────
// Query: page, perPage, platform, status
videosRouter.get('/', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { page = '1', perPage = '20', platform, status } = req.query as Record<string, string>;

  const filterParts = [`tenantId = "${tenantId}"`];
  if (platform) filterParts.push(`platform = "${platform}"`);
  if (status) filterParts.push(`status = "${status}"`);

  const result = await pbList(COL, {
    filter: filterParts.join(' && '),
    sort: '-crawledAt',
    page: Number(page),
    perPage: Math.min(100, Number(perPage)),
  });

  res.json(result);
});

// ─── GET /videos/:id ──────────────────────────────────────────────────────────
videosRouter.get('/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await pbGet(COL, req.params.id);

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.json(record);
});

// ─── PATCH /videos/:id/reanalyze ─────────────────────────────────────────────
videosRouter.patch('/:id/reanalyze', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const record = await pbGet(COL, req.params.id);

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const fileId = record.videoFileId as string | undefined;
  if (!fileId) {
    res.status(400).json({ error: 'No video file attached to this record' });
    return;
  }

  await pbPatch(COL, req.params.id, { status: 'pending', aiAnalysis: JSON.stringify({}) });
  void triggerVideoAnalysis(req.params.id, fileId, undefined, userId);

  res.json({ status: 'pending' });
});

// ─── Internal: async AI analysis ─────────────────────────────────────────────
async function triggerVideoAnalysis(
  recordId: string,
  fileId: string | undefined,
  mimeType: string | undefined,
  _userId: string,
): Promise<void> {
  if (!fileId) {
    await pbPatch(COL, recordId, { status: 'failed' });
    return;
  }

  try {
    const dl = await r2Download(fileId);
    if (!dl) throw new Error('R2 download failed');

    const analysis = await analyzeVideo({
      videoBase64: dl.buf.toString('base64'),
      mimeType: mimeType ?? dl.contentType,
    });

    await pbPatch(COL, recordId, {
      aiAnalysis: JSON.stringify(analysis),
      status: 'analyzed',
    });
    console.log(`[videos] analyzed ${recordId}`);
  } catch (e) {
    console.error(`[videos] analysis failed for ${recordId}:`, e);
    await pbPatch(COL, recordId, { status: 'failed' });
  }
}
