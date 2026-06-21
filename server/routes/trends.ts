import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { pbCreate, pbGet, pbPatch, pbList } from '../storage/pb.js';

export const trendsRouter = Router();
trendsRouter.use(requireAuth);

const COL = 'daily_trends';
const VIDEO_COL = 'trend_videos';

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── POST /trends/push ────────────────────────────────────────────────────────
// Trigger today's trend push (picks latest 10 analyzed videos)
trendsRouter.post('/push', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const date = todayDate();

  // Check if today's push already exists
  const existing = await pbList(COL, {
    filter: `tenantId = "${tenantId}" && date = "${date}"`,
    perPage: 1,
  });

  if (existing.items.length > 0) {
    res.status(409).json({ error: 'Trend push already exists for today', id: (existing.items[0] as Record<string, unknown>).id });
    return;
  }

  // Pick latest 10 analyzed videos
  const videos = await pbList(VIDEO_COL, {
    filter: `tenantId = "${tenantId}" && status = "analyzed"`,
    sort: '-crawledAt',
    perPage: 10,
  });

  const videoIds = videos.items.map((v) => (v as Record<string, unknown>).id as string);

  const record = await pbCreate(COL, {
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

  const result = await pbList(COL, {
    filter: `tenantId = "${tenantId}" && date = "${date}"`,
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
    videoIds.map((id) => pbGet(VIDEO_COL, id)),
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

  const record = await pbGet(COL, req.params.id);
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

  await pbPatch(COL, req.params.id, {
    selectedIds: JSON.stringify(selectedIds),
    status: 'selected',
  });

  res.json({ ok: true, selectedIds });
});

function parseJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
