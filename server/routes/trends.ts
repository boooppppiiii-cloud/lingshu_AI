import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';

export const trendsRouter = Router();
trendsRouter.use(requireAuth);

const COL = 'daily_trends';
const VIDEO_COL = 'trend_videos';

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === 'string' ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function isVideoLevelRecord(record: Record<string, unknown>): boolean {
  const analysis = parseJson<Record<string, unknown>>(record.aiAnalysis, {});
  return analysis.analysisQuality === 'video'
    && Boolean(analysis.gemini)
    && analysis.userVisible !== false;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── POST /trends/push ────────────────────────────────────────────────────────
// Trigger today's trend push (picks latest 10 analyzed videos)
trendsRouter.post('/push', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const date = todayDate();

  // Check if today's push already exists
  const existing = await store.list(COL, {
    where: { tenantId, date },
    perPage: 1,
  });

  if (existing.items.length > 0) {
    res.status(409).json({ error: 'Trend push already exists for today', id: (existing.items[0] as Record<string, unknown>).id });
    return;
  }

  // Pick latest 10 video-level analyzed videos
  const videos = await store.list(VIDEO_COL, {
    where: { tenantId, status: 'analyzed' },
    sort: '-crawledAt',
    perPage: 100,
  });

  const videoIds = videos.items
    .filter((v): v is Record<string, unknown> & { id: string } => Boolean((v as Record<string, unknown>).id) && isVideoLevelRecord(v as Record<string, unknown>))
    .slice(0, 10)
    .map((v) => v.id);

  const record = await store.create(COL, {
    tenantId,
    date,
    videoIds: JSON.stringify(videoIds),
    selectedIds: JSON.stringify([]),
    status: 'pending',
  });

  if (!record) {
    res.status(500).json({ error: 'Failed to create trend push' });
    return;
  }

  res.status(201).json({ id: record.id, date, videoIds, status: 'pending' });
});

// ─── GET /trends/today ────────────────────────────────────────────────────────
trendsRouter.get('/today', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const date = todayDate();

  const result = await store.list(COL, {
    where: { tenantId, date },
    perPage: 1,
  });

  if (result.items.length === 0) {
    res.status(404).json({ error: 'No trend push for today', date });
    return;
  }

  const trend = result.items[0] as Record<string, unknown>;
  const videoIds = parseJson<string[]>(trend.videoIds as string, []);

  // Fetch the actual video records
  const videoRecords = await Promise.all(
    videoIds.map((id) => store.getById(VIDEO_COL, id)),
  );

  res.json({
    ...trend,
    videoIds,
    selectedIds: parseJson<string[]>(trend.selectedIds as string, []),
    videos: videoRecords.filter(Boolean),
  });
});

// ─── PATCH /trends/:id/select ─────────────────────────────────────────────────
// Body: { selectedIds: string[] }
trendsRouter.patch('/:id/select', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { selectedIds } = req.body as { selectedIds?: string[] };

  if (!Array.isArray(selectedIds)) {
    res.status(400).json({ error: 'selectedIds must be an array' });
    return;
  }

  const record = await store.getById(COL, req.params.id);
  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const allVideoIds = parseJson<string[]>(record.videoIds as string, []);
  const invalid = selectedIds.filter((id) => !allVideoIds.includes(id));
  if (invalid.length > 0) {
    res.status(400).json({ error: `IDs not in this trend push: ${invalid.join(', ')}` });
    return;
  }

  await store.update(COL, req.params.id, {
    selectedIds: JSON.stringify(selectedIds),
    status: 'selected',
  });

  res.json({ ok: true, selectedIds });
});
