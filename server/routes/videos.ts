import { Router, type Request, type Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { attachFile, fetchFile } from '../storage/files.js';
import { analyzeVideo, analyzeYouTubeUrl } from '../agents/gemini.js';
import type { Platform, VideoAiAnalysis, VideoStatus } from '../types/index.js';

export const videosRouter = Router();
videosRouter.use(requireAuth);

const COL = 'trend_videos';
const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.join(__dirname, '../../data/media');
const ANALYSIS_DIR = path.join(__dirname, '../../data/analysis-temp');
const MATERIALS_FILE = path.join(__dirname, '../../data/materials.json');
const CRAWLER_OPS_FILE = path.join(__dirname, '../../data/crawler-ops-queue.json');
const ffmpegBin = ffmpegStatic as unknown as string | null;
let legacyFakePurgePromise: Promise<void> | null = null;
let activeDownloadJobs = 0;
const MAX_DOWNLOAD_JOBS = Number(process.env.VIDEO_DOWNLOAD_CONCURRENCY || 3);

interface CrawledVideo {
  platform: Platform;
  title: string;
  sourceUrl: string;
  thumbnailUrl: string;
  duration: number;
  views: string;
  tags: string[];
  uploadedAt?: string;
  dateEvidence?: string;
}

interface Material {
  id: string;
  name: string;
  folder: string;
  type: 'video' | 'image' | 'audio';
  duration: number;
  size: string;
  file: string;
  url: string;
  poster?: string;
  scope: 'shared' | 'own';
  createdAt: string;
}

interface CrawlerOpsTask {
  id: string;
  recordId: string;
  platform: Platform;
  sourceUrl: string;
  title: string;
  status: 'queued' | 'pushed' | 'resolved' | 'failed';
  reason: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_CRAWL_KEYWORDS = 'amazon gadgets product review';

// ─── POST /videos/crawl ──────────────────────────────────────────────────────
// Body: { platform?: 'youtube' | 'tiktok' | 'facebook' | 'instagram', keyword?: string, limit?: number, dateFrom?: string, dateTo?: string }
videosRouter.post('/crawl', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  await purgeLegacyFakeVideos();
  const { platform = 'youtube', keyword = DEFAULT_CRAWL_KEYWORDS, limit = 12, dateFrom = '', dateTo = '' } = req.body as {
    platform?: Platform;
    keyword?: string;
    limit?: number;
    dateFrom?: string;
    dateTo?: string;
  };

  if (!['youtube', 'tiktok', 'facebook', 'instagram'].includes(platform)) {
    res.status(400).json({ error: 'Only youtube, tiktok, facebook and instagram are supported by this crawler task' });
    return;
  }

  try {
    const target = Math.min(30, Math.max(1, Number(limit) || 12));
    let crawlerSource = `${platform}-search`;
    let crawlerMessage = '';
    let items: CrawledVideo[];
    const directUrlInput = isPlatformUrl(keyword, platform);
    try {
      const safeLimit = Math.min(120, Math.max(target * 5, target));
      if (platform === 'youtube') {
        items = await crawlYouTubeSearch(keyword, safeLimit, dateFrom, dateTo);
      } else if (platform === 'facebook') {
        crawlerSource = /^https?:\/\/(?:www\.|m\.|mbasic\.)?facebook\.com\//i.test(keyword.trim()) ? 'facebook-url' : 'facebook-search';
        items = await crawlFacebook(keyword, safeLimit, dateFrom, dateTo);
      } else if (platform === 'tiktok') {
        crawlerSource = isPlatformUrl(keyword, 'tiktok') ? 'tiktok-url' : 'tiktok-search';
        items = await crawlSocialUrlOrFallback('tiktok', keyword, safeLimit, dateFrom, dateTo);
      } else if (platform === 'instagram') {
        crawlerSource = isPlatformUrl(keyword, 'instagram') ? 'instagram-url' : 'instagram-search';
        items = await crawlSocialUrlOrFallback('instagram', keyword, safeLimit, dateFrom, dateTo);
      } else {
        throw new Error(`${platform} adapter pending`);
      }
      if (!directUrlInput) {
        const beforeDateFilter = items.length;
        items = filterDateRangeItems(items, dateFrom, dateTo);
        if (items.length === 0 && hasDateRange(dateFrom, dateTo)) {
          throw new Error(`没有找到发布时间在 ${dateFrom || '不限'} 至 ${dateTo || '不限'} 内的公开视频（候选 ${beforeDateFilter} 条已过滤）`);
        }
      }
      if (!directUrlInput) {
        const beforeRealMediaFilter = items.length;
        items = filterRealMediaItems(items);
        if (items.length === 0) {
          throw new Error(`没有拿到带真实封面的公开视频（候选 ${beforeRealMediaFilter} 条已过滤）`);
        }
      }
      if (!directUrlInput) {
        const beforeFilter = items.length;
        items = filterKeywordRelevantItems(items, keyword);
        if (items.length === 0) {
          throw new Error(`没有找到与关键词「${keyword}」相关的公开视频（候选 ${beforeFilter} 条已过滤）`);
        }
      }
    } catch (e) {
      crawlerMessage = e instanceof Error
        ? `${platform} 公开采集未找到可入库的真实视频：${e.message}`
        : `${platform} 公开采集未找到可入库的真实视频`;
      console.warn(`[videos] ${platform} crawl degraded:`, e);
      items = [];
    }
    let imported = 0;
    let refreshed = 0;
    let skipped = 0;
    const records: unknown[] = [];
    const refreshedRecords: unknown[] = [];
    const seenKeys = new Set<string>();
    const orderedItems = sortByHeat(items).filter(item => {
      const key = videoDedupeKey(item.platform, item.title);
      if (seenKeys.has(key)) {
        skipped += 1;
        return false;
      }
      seenKeys.add(key);
      return true;
    });

    for (const item of orderedItems) {
      const existingByName = await findExistingVideoByNamePlatform(tenantId, item.platform, item.title);
      const existingByUrl = existingByName ? null : await store.list(COL, {
        where: { tenantId, sourceUrl: item.sourceUrl },
        page: 1,
        perPage: 1,
      });
      const existingRecord = existingByName || existingByUrl?.items[0];
      if (existingRecord) {
        skipped += 1;
        refreshed += 1;
        const existingAnalysis = parseJsonRecord<Record<string, unknown>>(existingRecord.aiAnalysis, {});
        const fallback = metadataFallbackAnalysis(item);
        const patch = {
          platform: item.platform,
          title: item.title,
          thumbnailUrl: item.thumbnailUrl,
          duration: item.duration,
          sourceUrl: item.sourceUrl,
          tags: JSON.stringify(mergeExistingTags(existingRecord.tags, item.tags, keyword, item.platform)),
          aiAnalysis: JSON.stringify({
            ...existingAnalysis,
            source: crawlerSource,
            views: item.views,
            uploadedAt: item.uploadedAt,
            dateEvidence: item.dateEvidence,
            gemini: existingAnalysis.gemini || fallback,
            analysisSource: existingAnalysis.gemini ? existingAnalysis.analysisSource || 'gemini-video' : 'metadata-fallback',
            analysisQuality: existingAnalysis.gemini ? existingAnalysis.analysisQuality || 'video-or-existing' : 'metadata',
            keyword,
            crawlRule: '关键词检索',
            dateFrom,
            dateTo,
            importedAt: new Date().toISOString(),
          }),
          crawledAt: new Date().toISOString(),
        };
        await store.update(COL, String(existingRecord.id), patch);
        refreshedRecords.push({ ...existingRecord, ...patch });
        continue;
      }

      const record = await store.create(COL, {
        tenantId,
        platform: item.platform,
        title: item.title,
        thumbnailUrl: item.thumbnailUrl,
        videoFileId: '',
        duration: item.duration,
        sourceUrl: item.sourceUrl,
        tags: JSON.stringify(item.tags),
        aiAnalysis: JSON.stringify({
          source: crawlerSource,
          views: item.views,
          uploadedAt: item.uploadedAt,
          dateEvidence: item.dateEvidence,
          gemini: metadataFallbackAnalysis(item),
          analysisSource: 'metadata-fallback',
          analysisQuality: 'metadata',
          keyword,
          crawlRule: '关键词检索',
          dateFrom,
          dateTo,
          importedAt: new Date().toISOString(),
        }),
        status: 'analyzed' as VideoStatus,
        crawledAt: new Date().toISOString(),
      });
      if (record) {
        imported += 1;
        records.push(record);
      }
      if (imported >= target) break;
    }

    const resultRecords = records.length > 0
      ? [...records, ...refreshedRecords].slice(0, target)
      : refreshedRecords.slice(0, target);

    if (resultRecords.length === 0) {
      res.status(409).json({
        platform,
        keyword,
        imported,
        refreshed,
        skipped,
        requested: target,
        total: items.length,
        source: crawlerSource,
        message: crawlerMessage || `有效去重后只拿到 ${imported} 条新视频，未达到用户输入数量 ${target}；请换关键词、放宽日期范围或降低数量。`,
        items: resultRecords,
      });
      return;
    }

    await enqueueCrawledRecordsForAnalysis(resultRecords);

    const message = crawlerMessage
      || (resultRecords.length < target
        ? `采集完成：返回 ${resultRecords.length} 条可用视频（新增 ${imported} 条，刷新 ${refreshed} 条），未达到用户输入数量 ${target}；可换关键词或放宽日期范围。`
        : `采集完成：返回 ${resultRecords.length} 条可用视频，新增 ${imported} 条，刷新 ${refreshed} 条`);
    res.json({ platform, keyword, imported, refreshed, skipped, requested: target, total: items.length, source: crawlerSource, message, items: resultRecords });
  } catch (e) {
    console.error('[videos] crawl failed:', e);
    res.status(502).json({ error: e instanceof Error ? e.message : 'Crawl failed' });
  }
});

// ─── POST /videos/download-material ─────────────────────────────────────────
// Body: { id?, sourceUrl?, title?, platform?, async? } → download remote video and add it to Studio materials.
videosRouter.post('/download-material', async (req, res) => {
  const { id, sourceUrl, title, platform, async } = req.body as {
    id?: string;
    sourceUrl?: string;
    title?: string;
    platform?: Platform;
    async?: boolean;
  };
  await handleDownloadMaterial(req, res, { id, sourceUrl, title, platform, async });
});

videosRouter.post('/:id/download-material', async (req, res) => {
  const { sourceUrl, title, platform, async } = req.body as { sourceUrl?: string; title?: string; platform?: Platform; async?: boolean };
  await handleDownloadMaterial(req, res, { id: req.params.id, sourceUrl, title, platform, async });
});

// ─── POST /videos/analyze-source ─────────────────────────────────────────────
// Body: { id?, sourceUrl?, title?, platform?, async? } → fetch a temporary low-res video, analyze with Gemini, then delete it.
videosRouter.post('/analyze-source', async (req, res) => {
  const { id, sourceUrl, title, platform, async } = req.body as {
    id?: string;
    sourceUrl?: string;
    title?: string;
    platform?: Platform;
    async?: boolean;
  };
  await handleAnalyzeSource(req, res, { id, sourceUrl, title, platform, async });
});

videosRouter.post('/:id/analyze-source', async (req, res) => {
  const { sourceUrl, title, platform, async } = req.body as { sourceUrl?: string; title?: string; platform?: Platform; async?: boolean };
  await handleAnalyzeSource(req, res, { id: req.params.id, sourceUrl, title, platform, async });
});

// ─── Internal crawler ops queue ──────────────────────────────────────────────
videosRouter.get('/ops/queue', async (_req, res) => {
  res.json({ items: loadCrawlerOpsTasks().filter(task => task.status === 'queued' || task.status === 'pushed') });
});

videosRouter.post('/ops/:taskId/resolve', async (req, res) => {
  const { taskId } = req.params;
  const { videoBase64, mimeType = 'video/mp4', error } = req.body as {
    videoBase64?: string;
    mimeType?: string;
    error?: string;
  };
  const tasks = loadCrawlerOpsTasks();
  const task = tasks.find(item => item.id === taskId);
  if (!task) {
    res.status(404).json({ error: 'Crawler ops task not found' });
    return;
  }
  if (error) {
    persistCrawlerOpsTasks(tasks.map(item => item.id === taskId ? { ...item, status: 'failed', reason: error, updatedAt: new Date().toISOString() } : item));
    res.json({ ok: true, status: 'failed' });
    return;
  }
  if (!videoBase64) {
    res.status(400).json({ error: 'videoBase64 is required to resolve this task' });
    return;
  }
  try {
    await analyzeOpsVideo(task, videoBase64, mimeType);
    persistCrawlerOpsTasks(tasks.map(item => item.id === taskId ? { ...item, status: 'resolved', updatedAt: new Date().toISOString() } : item));
    res.json({ ok: true, status: 'resolved' });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : 'Crawler ops resolve failed' });
  }
});

// ─── POST /videos/ingest ──────────────────────────────────────────────────────
// Body: { platform, title?, tags?, sourceUrl?, videoBase64?, mimeType? }
videosRouter.post('/ingest', async (req, res) => {
  const { userId, tenantId } = res.locals as AuthLocals;
  const { platform, title, tags, sourceUrl, videoBase64, mimeType } = req.body as {
    platform?: Platform;
    title?: string;
    tags?: string[];
    sourceUrl?: string;
    videoBase64?: string;
    mimeType?: string;
  };

  if (!platform) {
    res.status(400).json({ error: 'platform is required' });
    return;
  }

  // Create the record first; the video blob (if any) attaches to it.
  const record = await store.create(COL, {
    tenantId,
    platform: platform ?? 'tiktok',
    title: title ?? '',
    thumbnailUrl: '',
    videoFileId: '',
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

  // Attach the video to the PB record's file field (PB disk storage, no S3).
  let filename = '';
  if (videoBase64) {
    const buf = Buffer.from(videoBase64.replace(/^data:[^,]+,/, ''), 'base64');
    const ext = (mimeType ?? 'video/mp4').split('/')[1] ?? 'mp4';
    filename = (await attachFile(COL, record.id, 'videoFile', {
      name: `video.${ext}`,
      buf,
      contentType: mimeType ?? 'video/mp4',
    })) ?? '';
    if (!filename) {
      await store.update(COL, record.id, { status: 'failed' });
      res.status(500).json({ error: 'Video upload failed' });
      return;
    }
    await store.update(COL, record.id, { videoFileId: filename });
  }

  // Trigger analysis async (fire and forget)
  void triggerVideoAnalysis(record.id, filename || undefined, mimeType, userId);

  res.status(201).json({ id: record.id, status: 'pending' });
});

// ─── GET /videos ──────────────────────────────────────────────────────────────
// Query: page, perPage, platform, status
videosRouter.get('/', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  await purgeLegacyFakeVideos();
  const { page = '1', perPage = '20', platform, status } = req.query as Record<string, string>;

  const where: Record<string, string> = { tenantId };
  if (platform) where.platform = platform;
  if (status) where.status = status;

  const result = await store.list(COL, {
    where,
    sort: '-crawledAt',
    page: Number(page),
    perPage: Math.min(100, Number(perPage)),
  });

  void enqueueCrawledRecordsForAnalysis(result.items).catch((e) => {
    console.warn('[videos] opportunistic analysis enqueue failed:', e instanceof Error ? e.message : e);
  });

  res.json(result);
});

// ─── GET /videos/:id ──────────────────────────────────────────────────────────
videosRouter.get('/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id);

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.json(record);
});

// ─── PATCH /videos/:id/reanalyze ─────────────────────────────────────────────
videosRouter.patch('/:id/reanalyze', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const record = await store.getById(COL, req.params.id);

  if (!record || record.tenantId !== tenantId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const fileId = record.videoFileId as string | undefined;
  if (!fileId) {
    const sourceUrl = String(record.sourceUrl || '').trim();
    if (!/^https?:\/\//i.test(sourceUrl)) {
      res.status(400).json({ error: 'No video file or public sourceUrl attached to this record' });
      return;
    }
    await queueAnalyzeSource(record);
    res.json({ status: 'pending' });
    return;
  }

  const previous = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
  await store.update(COL, req.params.id, {
    status: 'pending',
    aiAnalysis: JSON.stringify({ ...previous, analysisError: undefined, reanalyzeQueuedAt: new Date().toISOString() }),
  });
  const localPath = path.join(MEDIA_DIR, fileId);
  if (fs.existsSync(localPath)) {
    void analyzeDownloadedMaterial(req.params.id, localPath, {
      id: String(previous.materialId || path.parse(fileId).name),
      name: String(record.title || fileId),
      folder: 'hot',
      type: 'video',
      duration: Number(record.duration || 0),
      size: humanSize(fs.statSync(localPath).size),
      file: fileId,
      url: `/media/${fileId}`,
      poster: String(previous.materialPoster || record.thumbnailUrl || '') || undefined,
      scope: 'own',
      createdAt: new Date().toISOString(),
    });
  } else {
    void triggerVideoAnalysis(req.params.id, fileId, undefined, userId);
  }

  res.json({ status: 'pending' });
});

// ─── Internal: async AI analysis ─────────────────────────────────────────────
async function triggerVideoAnalysis(
  recordId: string,
  filename: string | undefined,
  mimeType: string | undefined,
  _userId: string,
): Promise<void> {
  if (!filename) {
    await store.update(COL, recordId, { status: 'failed' });
    return;
  }

  try {
    const dl = await fetchFile(COL, recordId, filename);
    if (!dl) throw new Error('video file fetch failed');

    const analysis = await analyzeVideo({
      videoBase64: dl.buf.toString('base64'),
      mimeType: mimeType ?? dl.contentType,
    });

    await store.update(COL, recordId, {
      aiAnalysis: JSON.stringify(analysis),
      status: 'analyzed',
    });
    console.log(`[videos] analyzed ${recordId}`);
  } catch (e) {
    console.error(`[videos] analysis failed for ${recordId}:`, e);
    await store.update(COL, recordId, { status: 'failed' });
  }
}

async function handleAnalyzeSource(
  _req: Request,
  res: Response,
  input: { id?: string; sourceUrl?: string; title?: string; platform?: Platform; async?: boolean },
): Promise<void> {
  const { tenantId } = res.locals as AuthLocals;
  try {
    let record: Record<string, unknown> | null = null;
    if (input.id) {
      record = await store.getById(COL, input.id);
      if (!record || record.tenantId !== tenantId) {
        res.status(404).json({ error: 'Video record not found' });
        return;
      }
    }

    const remoteUrl = String(input.sourceUrl || record?.sourceUrl || '').trim();
    if (!/^https?:\/\//i.test(remoteUrl)) {
      res.status(400).json({ error: 'A public sourceUrl is required for analysis' });
      return;
    }

    const inferredPlatform = (input.platform || record?.platform || inferPlatformFromUrl(remoteUrl)) as Platform;
    const job = {
      record,
      sourceUrl: remoteUrl,
      title: String(input.title || record?.title || `${inferredPlatform}-video`),
      platform: inferredPlatform,
    };

    if (input.async && record?.id) {
      if (!shouldQueueVideoAnalysis(record)) {
        res.status(202).json({ ok: true, status: 'already_queued', id: record.id });
        return;
      }
      await queueAnalyzeSource(record, job);
      res.status(202).json({ ok: true, status: 'queued', id: record.id });
      return;
    }

    const analysis = await analyzeSourceVideoJob(job);
    res.status(200).json({ ok: true, analysis });
  } catch (e) {
    console.error('[videos] analyze-source failed:', e);
    res.status(502).json({ error: e instanceof Error ? e.message : 'Video analysis failed' });
  }
}

async function queueAnalyzeSource(
  record: Record<string, unknown>,
  job?: { record: Record<string, unknown> | null; sourceUrl: string; title: string; platform: Platform },
): Promise<void> {
  const remoteUrl = String(job?.sourceUrl || record.sourceUrl || '').trim();
  const platform = (job?.platform || record.platform || inferPlatformFromUrl(remoteUrl)) as Platform;
  const analysis = parseJsonRecord(record.aiAnalysis, {});
  await store.update(COL, String(record.id), {
    status: 'pending' as VideoStatus,
    aiAnalysis: JSON.stringify({
      ...analysis,
      downloadStatus: 'queued',
      videoFetchStatus: 'queued',
      geminiStatus: 'waiting_for_video',
      analysisSource: 'gemini-temp-video',
      analysisError: undefined,
      downloadError: undefined,
      analysisQueuedAt: new Date().toISOString(),
    }),
  });
  void analyzeSourceVideoJob(job || {
    record,
    sourceUrl: remoteUrl,
    title: String(record.title || `${platform}-video`),
    platform,
  }).catch((e) => {
    console.warn('[videos] async analyze-source failed:', e instanceof Error ? e.message : e);
  });
}

async function enqueueCrawledRecordsForAnalysis(records: unknown[]): Promise<void> {
  for (const raw of records) {
    const record = raw as Record<string, unknown>;
    const id = String(record.id || '');
    if (!id) continue;
    const latest = await store.getById(COL, id);
    if (!latest || !shouldQueueVideoAnalysis(latest)) continue;
    await queueAnalyzeSource(latest);
  }
}

function shouldQueueVideoAnalysis(record: Record<string, unknown>): boolean {
  const sourceUrl = String(record.sourceUrl || '').trim();
  if (!/^https?:\/\//i.test(sourceUrl)) return false;
  const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
  const status = String(analysis.downloadStatus || '');
  if (['queued', 'downloading', 'analyzing'].includes(status)) return false;
  if (analysis.analysisQuality === 'video' && status === 'analyzed') return false;
  const queuedAt = Date.parse(String(analysis.analysisQueuedAt || analysis.videoAnalysisAttemptedAt || ''));
  if (Number.isFinite(queuedAt) && Date.now() - queuedAt < 5 * 60 * 1000) return false;
  return true;
}

async function handleDownloadMaterial(
  _req: Request,
  res: Response,
  input: { id?: string; sourceUrl?: string; title?: string; platform?: Platform; async?: boolean },
): Promise<void> {
  const { tenantId } = res.locals as AuthLocals;
  try {
    let record: Record<string, unknown> | null = null;
    if (input.id) {
      record = await store.getById(COL, input.id);
      if (!record || record.tenantId !== tenantId) {
        res.status(404).json({ error: 'Video record not found' });
        return;
      }
    }

    const remoteUrl = String(input.sourceUrl || record?.sourceUrl || '').trim();
    if (!/^https?:\/\//i.test(remoteUrl)) {
      res.status(400).json({ error: 'A public sourceUrl is required for download' });
      return;
    }

    const inferredPlatform = (input.platform || record?.platform || inferPlatformFromUrl(remoteUrl)) as Platform;
    const job = {
      record,
      sourceUrl: remoteUrl,
      title: String(input.title || record?.title || `${inferredPlatform}-video`),
      platform: inferredPlatform,
      duration: Number(record?.duration || 0),
    };

    if (input.async && record?.id) {
      const analysis = parseJsonRecord(record.aiAnalysis, {});
      await store.update(COL, String(record.id), {
        status: 'pending' as VideoStatus,
        aiAnalysis: JSON.stringify({ ...analysis, downloadStatus: 'queued', downloadQueuedAt: new Date().toISOString() }),
      });
      void downloadMaterialJob(job).catch((e) => {
        console.warn('[videos] async download-material failed:', e instanceof Error ? e.message : e);
      });
      res.status(202).json({ ok: true, status: 'queued', id: record.id });
      return;
    }

    const material = await downloadMaterialJob(job);
    res.status(201).json({ ok: true, material });
  } catch (e) {
    console.error('[videos] download-material failed:', e);
    res.status(502).json({ error: e instanceof Error ? e.message : 'Video download failed' });
  }
}

async function downloadMaterialJob(input: {
  record: Record<string, unknown> | null;
  sourceUrl: string;
  title: string;
  platform: Platform;
  duration: number;
}): Promise<Material> {
  return withDownloadSlot(() => downloadMaterialJobInner(input));
}

async function downloadMaterialJobInner(input: {
  record: Record<string, unknown> | null;
  sourceUrl: string;
  title: string;
  platform: Platform;
  duration: number;
}): Promise<Material> {
  const recordId = input.record?.id ? String(input.record.id) : '';
  try {
    if (recordId) {
      const analysis = parseJsonRecord(input.record?.aiAnalysis, {});
      await store.update(COL, recordId, {
        status: 'pending' as VideoStatus,
        aiAnalysis: JSON.stringify({ ...analysis, downloadStatus: 'downloading', downloadStartedAt: new Date().toISOString() }),
      });
    }

    const material = await downloadVideoToMaterial(input);
    if (recordId) {
      const analysis = parseJsonRecord(input.record?.aiAnalysis, {});
      await store.update(COL, recordId, {
        videoFileId: material.file,
        thumbnailUrl: material.poster || String(input.record?.thumbnailUrl || ''),
        aiAnalysis: JSON.stringify({
          ...analysis,
          materialId: material.id,
          materialUrl: material.url,
          materialPoster: material.poster,
          downloadedAt: material.createdAt,
          downloadStatus: 'downloaded',
        }),
      });
      void analyzeDownloadedMaterial(recordId, path.join(MEDIA_DIR, material.file), material);
    }
    return material;
    } catch (e) {
      const soft = softDownloadFailure(input.platform, e);
      if (recordId) {
        const analysis = parseJsonRecord(input.record?.aiAnalysis, {});
        await store.update(COL, recordId, {
        status: soft ? 'pending' as VideoStatus : 'failed' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...analysis,
          downloadStatus: soft ? soft.status : 'failed',
          downloadError: e instanceof Error ? e.message : 'Video download failed',
        }),
      });
    }
    throw e;
  }
}

async function withDownloadSlot<T>(fn: () => Promise<T>): Promise<T> {
  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  while (activeDownloadJobs >= MAX_DOWNLOAD_JOBS) {
    await sleep(150);
  }
  activeDownloadJobs += 1;
  try {
    return await fn();
  } finally {
    activeDownloadJobs = Math.max(0, activeDownloadJobs - 1);
  }
}

async function analyzeSourceVideoJob(input: {
  record: Record<string, unknown> | null;
  sourceUrl: string;
  title: string;
  platform: Platform;
}): Promise<unknown> {
  return withDownloadSlot(() => analyzeSourceVideoJobInner(input));
}

async function analyzeSourceVideoJobInner(input: {
  record: Record<string, unknown> | null;
  sourceUrl: string;
  title: string;
  platform: Platform;
}): Promise<unknown> {
  const recordId = input.record?.id ? String(input.record.id) : '';
  let tempPath = '';
  try {
    if (input.platform === 'youtube') {
      const direct = await tryAnalyzeYouTubeUrl(input);
      if (direct) return direct;
    }

    if (recordId) {
      const latest = await store.getById(COL, recordId);
      const analysis = parseJsonRecord(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
      await store.update(COL, recordId, {
        status: 'pending' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...analysis,
          downloadStatus: 'downloading',
          videoFetchStatus: 'downloading',
          geminiStatus: 'waiting_for_video',
          analysisSource: 'gemini-temp-video',
          downloadStartedAt: new Date().toISOString(),
        }),
      });
    }

    const downloaded = await downloadVideoForAnalysis(input);
    tempPath = downloaded.filePath;
    if (recordId) {
      const latest = await store.getById(COL, recordId);
      const analysis = parseJsonRecord(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
      await store.update(COL, recordId, {
        status: 'pending' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...analysis,
          downloadStatus: 'analyzing',
          videoFetchStatus: 'fetched',
          geminiStatus: 'queued',
          analysisSource: 'gemini-temp-video',
          analysisFileSize: humanSize(downloaded.size),
          downloadedAt: new Date().toISOString(),
        }),
      });
    }

    if (recordId) {
      const latest = await store.getById(COL, recordId);
      const analysis = parseJsonRecord(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
      await store.update(COL, recordId, {
        status: 'pending' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...analysis,
          downloadStatus: 'analyzing',
          videoFetchStatus: 'fetched',
          geminiStatus: 'analyzing',
          geminiStartedAt: new Date().toISOString(),
        }),
      });
    }

    const buf = fs.readFileSync(downloaded.filePath);
    const geminiAnalysis = await analyzeVideo({
      videoBase64: buf.toString('base64'),
      mimeType: downloaded.mimeType,
    });

    if (recordId) {
      const latest = await store.getById(COL, recordId);
      const previous = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
      await store.update(COL, recordId, {
        status: 'analyzed' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...previous,
          gemini: geminiAnalysis,
          analysisSource: 'gemini-temp-video',
          analysisQuality: 'video',
          downloadStatus: 'analyzed',
          videoFetchStatus: 'fetched',
          geminiStatus: 'analyzed',
          analyzedAt: new Date().toISOString(),
          tempVideoDeleted: true,
        }),
      });
    }
    return geminiAnalysis;
  } catch (e) {
    const soft = softDownloadFailure(input.platform, e);
    if (recordId) {
      const latest = await store.getById(COL, recordId);
      const previous = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
      const errorMessage = e instanceof Error ? e.message : 'Video download failed';
      const fallback = metadataFallbackAnalysis({
        platform: input.platform,
        title: String(input.record?.title || input.title),
        duration: Number(input.record?.duration || 0),
        views: String(previous.views || input.platform),
        tags: parseJsonRecord<string[]>(input.record?.tags, []),
      });
      const opsTask = enqueueCrawlerOpsTask({
        recordId,
        platform: input.platform,
        sourceUrl: input.sourceUrl,
        title: String(input.record?.title || input.title),
        reason: errorMessage,
      });
      void pushCrawlerOpsTask(opsTask).catch((pushError) => {
        console.warn('[videos] crawler ops push failed:', pushError instanceof Error ? pushError.message : pushError);
      });
      await store.update(COL, recordId, {
        status: 'analyzed' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...previous,
          gemini: previous.gemini || fallback,
          analysisSource: previous.gemini ? previous.analysisSource || 'metadata-fallback' : 'metadata-fallback',
          analysisQuality: previous.gemini ? previous.analysisQuality || 'metadata' : 'metadata',
          videoAnalysisAttemptedAt: new Date().toISOString(),
          downloadStatus: 'ops_queued',
          videoFetchStatus: 'ops_queued',
          geminiStatus: 'waiting_for_video',
          crawlerOpsTaskId: opsTask.id,
          crawlerOpsStatus: opsTask.status,
          crawlerOpsReason: soft?.status || 'download_failed',
          analysisError: /fetch failed|GEMINI_API_KEY|Gemini/i.test(e instanceof Error ? e.message : String(e))
            ? (e instanceof Error ? e.message : 'Gemini analysis failed')
            : previous.analysisError,
          downloadError: errorMessage,
        }),
      });
    }
    throw e;
  } finally {
    if (tempPath) cleanupTempVideo(tempPath);
  }
}

async function tryAnalyzeYouTubeUrl(input: {
  record: Record<string, unknown> | null;
  sourceUrl: string;
  title: string;
  platform: Platform;
}): Promise<unknown | null> {
  const recordId = input.record?.id ? String(input.record.id) : '';
  try {
    if (recordId) {
      const latest = await store.getById(COL, recordId);
      const analysis = parseJsonRecord(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
      await store.update(COL, recordId, {
        status: 'pending' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...analysis,
          downloadStatus: 'analyzing',
          videoFetchStatus: 'direct_url',
          geminiStatus: 'analyzing',
          analysisSource: 'gemini-youtube-url',
          geminiStartedAt: new Date().toISOString(),
        }),
      });
    }
    const geminiAnalysis = await analyzeYouTubeUrl({ url: input.sourceUrl });
    if (recordId) {
      const latest = await store.getById(COL, recordId);
      const previous = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
      await store.update(COL, recordId, {
        status: 'analyzed' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...previous,
          gemini: geminiAnalysis,
          analysisSource: 'gemini-youtube-url',
          analysisQuality: 'video',
          downloadStatus: 'analyzed',
          videoFetchStatus: 'direct_url',
          geminiStatus: 'analyzed',
          analyzedAt: new Date().toISOString(),
        }),
      });
    }
    return geminiAnalysis;
  } catch (e) {
    if (recordId) {
      const latest = await store.getById(COL, recordId);
      const previous = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
      await store.update(COL, recordId, {
        status: 'pending' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...previous,
          youtubeDirectError: e instanceof Error ? e.message : 'YouTube direct Gemini analysis failed',
          videoFetchStatus: 'queued',
          geminiStatus: 'waiting_for_video',
        }),
      });
    }
    return null;
  }
}

async function analyzeDownloadedMaterial(recordId: string, filePath: string, material: Material): Promise<void> {
  try {
    await store.update(COL, recordId, { status: 'pending' as VideoStatus });
    const buf = fs.readFileSync(filePath);
    const geminiAnalysis = await analyzeVideo({
      videoBase64: buf.toString('base64'),
      mimeType: mimeFromPath(filePath),
    });
    const latest = await store.getById(COL, recordId);
    const previous = parseJsonRecord(latest?.aiAnalysis, {});
    await store.update(COL, recordId, {
      status: 'analyzed' as VideoStatus,
      aiAnalysis: JSON.stringify({
        ...previous,
        gemini: geminiAnalysis,
        analysisSource: 'gemini-video',
        analyzedAt: new Date().toISOString(),
        materialId: material.id,
        materialUrl: material.url,
        materialPoster: material.poster,
      }),
    });
  } catch (e) {
    console.error(`[videos] Gemini material analysis failed for ${recordId}:`, e);
    const latest = await store.getById(COL, recordId);
    const previous = parseJsonRecord(latest?.aiAnalysis, {});
    await store.update(COL, recordId, {
      status: 'failed' as VideoStatus,
      aiAnalysis: JSON.stringify({
        ...previous,
        analysisSource: 'gemini-video',
        analysisError: e instanceof Error ? e.message : 'Gemini analysis failed',
      }),
    });
  }
}

async function crawlSocialUrlOrFallback(platform: Platform, keyword: string, limit: number, dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
  const input = keyword.trim();
  if (isPlatformUrl(input, platform)) return [await crawlYtDlpMetadata(platform, input, keyword)];
  return crawlPublicSearch(platform, input, limit, dateFrom, dateTo);
}

async function crawlYtDlpMetadata(platform: Platform, url: string, keyword: string): Promise<CrawledVideo> {
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('python3', buildYtDlpArgs(['--dump-json', '--skip-download'], url, false), { maxBuffer: 8 * 1024 * 1024, timeout: 45_000, env: crawlerExecEnv() }));
  } catch {
    stdout = await execYtDlpWithCookieFallback(['--dump-json', '--skip-download'], url, 60_000, 8 * 1024 * 1024);
  }
  const line = stdout.split('\n').find(Boolean);
  if (!line) throw new Error(`${platform} returned empty metadata`);
  const meta = JSON.parse(line) as Record<string, unknown>;
  const webpageUrl = String(meta.webpage_url || meta.original_url || url);
  const title = metadataTitle(platform, meta);
  const thumbnail = String(meta.thumbnail || '');
  const duration = Number(meta.duration || 0);
  const uploadedAt = uploadedAtFromMeta(meta);
  const views = typeof meta.view_count === 'number' ? compactNumber(meta.view_count) : platform;
  const tags = Array.isArray(meta.tags)
    ? meta.tags.filter((t): t is string => typeof t === 'string').slice(0, 5)
    : tagsFromKeyword(keyword, platform);
  return { platform, title, sourceUrl: webpageUrl, thumbnailUrl: thumbnail, duration, views, tags, uploadedAt };
}

async function downloadVideoToMaterial(input: {
  sourceUrl: string;
  title: string;
  platform: Platform;
  duration: number;
}): Promise<Material> {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const id = randomUUID();
  const outTpl = path.join(MEDIA_DIR, `${id}.%(ext)s`);
  const downloadArgs = [
    '--no-playlist',
    '--merge-output-format', 'mp4',
    '--max-filesize', '120m',
    '-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/best[height<=720]/best',
    '-o', outTpl,
  ];

  try {
    await execFileAsync('python3', buildYtDlpArgs(downloadArgs, input.sourceUrl, false), { maxBuffer: 4 * 1024 * 1024, timeout: 180_000, env: crawlerExecEnv() });
  } catch {
    await execYtDlpWithCookieFallback(downloadArgs, input.sourceUrl, 180_000, 4 * 1024 * 1024);
  }
  const downloaded = pickDownloadedVideoFile(id);
  if (!downloaded) throw new Error('yt-dlp did not produce a video file');

  const fullPath = path.join(MEDIA_DIR, downloaded);
  const posterFile = `${id}.poster.jpg`;
  const posterPath = path.join(MEDIA_DIR, posterFile);
  const posterOk = await extractPoster(fullPath, posterPath, input.duration > 1 ? 1 : 0);
  const material: Material = {
    id,
    name: safeMaterialName(input.title, input.platform),
    folder: 'hot',
    type: 'video',
    duration: input.duration || await probeDuration(fullPath),
    size: humanSize(fs.statSync(fullPath).size),
    file: downloaded,
    url: `/media/${downloaded}`,
    poster: posterOk ? `/media/${posterFile}` : undefined,
    scope: 'own',
    createdAt: new Date().toISOString(),
  };
  persistMaterials([material, ...loadMaterials().filter(m => m.id !== material.id)]);
  return material;
}

async function downloadVideoForAnalysis(input: {
  sourceUrl: string;
  title: string;
  platform: Platform;
}): Promise<{ filePath: string; fileName: string; mimeType: string; size: number }> {
  fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
  const id = randomUUID();
  const outTpl = path.join(ANALYSIS_DIR, `${id}.%(ext)s`);
  const clipSeconds = Math.max(30, Number(process.env.VIDEO_ANALYSIS_CLIP_SECONDS || 180));
  const downloadArgs = [
    '--no-playlist',
    '--merge-output-format', 'mp4',
    '--max-filesize', process.env.VIDEO_ANALYSIS_MAX_FILESIZE || '80m',
    '--download-sections', `*0-${clipSeconds}`,
    '-f', 'bv*[height<=360]+ba/b[height<=360]/best[height<=360]/best',
    '-o', outTpl,
  ];

  try {
    if (input.platform === 'youtube' && cookieBrowsers().length > 0) {
      await execYtDlpWithCookieFallback(downloadArgs, input.sourceUrl, 150_000, 4 * 1024 * 1024);
    } else {
      await execFileAsync('python3', buildYtDlpArgs(downloadArgs, input.sourceUrl, false), { maxBuffer: 4 * 1024 * 1024, timeout: 150_000, env: crawlerExecEnv() });
    }
  } catch {
    await execYtDlpWithCookieFallback(downloadArgs, input.sourceUrl, 150_000, 4 * 1024 * 1024);
  }
  const downloaded = pickDownloadedVideoFile(id, ANALYSIS_DIR);
  if (!downloaded) throw new Error('yt-dlp did not produce an analysis video file');

  const filePath = path.join(ANALYSIS_DIR, downloaded);
  return {
    filePath,
    fileName: downloaded,
    mimeType: mimeFromPath(filePath),
    size: fs.statSync(filePath).size,
  };
}

function pickDownloadedVideoFile(id: string, dir = MEDIA_DIR): string | undefined {
  const files = fs.readdirSync(dir)
    .filter(file => file.startsWith(`${id}.`) && !file.includes('.poster.'));
  return files.find(file => /\.(mp4|webm|mov|mkv)$/i.test(file)) || files[0];
}

function metadataFallbackAnalysis(input: Pick<CrawledVideo, 'platform' | 'title' | 'views' | 'tags'> & { duration?: number }): VideoAiAnalysis {
  const tags = input.tags.filter(Boolean).slice(0, 5);
  const title = cleanupAnalysisTitle(input.title);
  const platform = PLATFORM_LABEL[input.platform] || input.platform;
  const topic = tags.length > 0 ? tags.slice(0, 3).join(' / ') : title;
  const durationHint = input.duration && input.duration > 90 ? '长视频评测/教程' : '短视频种草';
  return {
    theme: `${platform} ${durationHint}：${title}`,
    hooks: [
      `用标题承诺切入：${title}`,
      input.views ? `用热度做社会证明：${input.views}` : '先展示结果或冲突，再解释产品',
      tags.length ? `前三秒围绕「${tags[0]}」放大场景痛点` : '前三秒突出产品效果或前后反差',
    ],
    sellingPoints: tags.length
      ? tags.map(tag => `可围绕「${tag}」展开卖点或场景`)
      : ['产品演示', '痛点解决', '结果证明', '行动引导'],
    mood: input.platform === 'tiktok' || input.platform === 'instagram' ? '快节奏 / 社媒感 / 视觉种草' : '信息型 / 评测型 / 解释清晰',
    structure: `标题/封面钩子 → 场景痛点 → 核心展示（${topic}） → 证明细节 → CTA`,
    firstTenSeconds: {
      atmosphere: `基础资料推断：前 10 秒大概率用「${title}」建立观看预期，并借助 ${platform} 平台语境形成信任或好奇。`,
      audioVisual: `基础资料推断：字幕/标题应快速解释「${topic}」，画面需要同步出现产品、结果或痛点。`,
      camera: '基础资料推断：真实运镜待视频级 Gemini 回填；建议先按近景展示、快速切换、结果对比三类镜头理解。',
      visuals: tags.length ? `基础资料推断：画面核心应围绕「${tags.slice(0, 3).join(' / ')}」展开。` : '基础资料推断：画面核心应优先呈现产品、使用场景和前后反差。',
      voiceMusic: `基础资料推断：配音/配乐应匹配「${input.platform === 'tiktok' || input.platform === 'instagram' ? '快节奏种草' : '评测解释'}」节奏。`,
    },
    coarseStructure: [
      { time: '0-3s', label: '标题承诺', description: `用标题或封面信息承接：${title}` },
      { time: '3-6s', label: '场景痛点', description: tags[0] ? `放大「${tags[0]}」相关使用场景或问题` : '展示用户痛点或结果反差' },
      { time: '6-9s', label: '核心展示', description: `进入核心展示：${topic}` },
      { time: '9-12s', label: '证明细节', description: input.views ? `用热度/评论/使用结果强化可信度：${input.views}` : '补充使用细节或效果证明' },
      { time: '12-15s', label: '行动引导', description: '给出购买、收藏、询盘或继续观看理由' },
    ],
    recommendedScriptType: input.duration && input.duration > 60 ? 'storyboard' : 'voiceover',
  };
}

function cleanupAnalysisTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, 140) || '未命名社媒视频';
}

function cleanupTempVideo(filePath: string): void {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath).split('.')[0];
  for (const file of fs.readdirSync(dir)) {
    if (file.startsWith(`${base}.`)) {
      try { fs.unlinkSync(path.join(dir, file)); } catch { /* best effort */ }
    }
  }
}

async function crawlYouTubeSearch(keyword: string, limit: number, dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
  if (hasDateRange(dateFrom, dateTo)) {
    const filtered = await crawlYouTubeUploadDateFilteredSearch(keyword, limit, dateFrom, dateTo);
    if (filtered.length > 0) return filtered;
  }
  try {
    return await crawlYtDlpSearch('youtube', `ytsearch${limit}:${keyword}`, keyword, limit, dateFrom, dateTo);
  } catch (e) {
    console.warn('[videos] youtube yt-dlp search failed, using verified URL pool:', e);
    return verifiedSeedItems('youtube', keyword).slice(0, limit);
  }
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}&sp=EgIQAQ%253D%253D`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!r.ok) throw new Error(`YouTube search failed: HTTP ${r.status}`);

  const html = await r.text();
  const data = extractYtInitialData(html);
  const renderers = findObjectsByKey(data, 'videoRenderer')
    .map(obj => obj.videoRenderer as Record<string, unknown>)
    .filter(Boolean);

  const seen = new Set<string>();
  const out: CrawledVideo[] = [];
  for (const renderer of renderers) {
    const videoId = textAt(renderer, ['videoId']);
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);

    const title = extractRunsText(renderer.title) || extractRunsText(renderer.headline) || 'Untitled YouTube video';
    const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const thumbnailUrl = extractBestThumbnail(renderer.thumbnail);
    const durationLabel = extractRunsText(renderer.lengthText);
    const views = extractRunsText(renderer.viewCountText) || extractRunsText(renderer.shortViewCountText);

    out.push({
      platform: 'youtube',
      title,
      sourceUrl,
      thumbnailUrl,
      duration: parseDuration(durationLabel),
      views,
      tags: keyword.split(/\s+/).map(s => s.replace(/^#/, '').trim()).filter(Boolean).slice(0, 5),
      uploadedAt: undefined,
    });
    if (out.length >= limit) break;
  }

  if (out.length === 0) throw new Error('No YouTube videos parsed from search results');
  return out;
}

async function crawlYouTubeUploadDateFilteredSearch(keyword: string, limit: number, dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
  const sp = youtubeUploadDateFilterParam(dateFrom, dateTo);
  if (!sp) return [];
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}&sp=${sp}`;
  try {
    const items = await crawlYtDlpSearch('youtube', searchUrl, keyword, limit, '', '');
    return items
      .map(item => ({
        ...item,
        thumbnailUrl: item.thumbnailUrl || youtubeThumbnailFromUrl(item.sourceUrl),
        dateEvidence: 'youtube-upload-filter',
      }))
      .filter(item => hasRealThumbnail(item));
  } catch (e) {
    console.warn('[videos] youtube upload-date filtered search failed:', e);
    return [];
  }
}

function youtubeUploadDateFilterParam(dateFrom = '', dateTo = ''): string {
  const from = compactDate(dateFrom);
  const to = compactDate(dateTo);
  if (!from && !to) return '';
  const end = to ? dateFromCompact(to) : new Date();
  const start = from ? dateFromCompact(from) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  if (days <= 1) return 'EgIIAg%253D%253D'; // today
  if (days <= 7) return 'EgIIAw%253D%253D'; // this week
  if (days <= 31) return 'EgIIBA%253D%253D'; // this month
  if (days <= 366) return 'EgIIBQ%253D%253D'; // this year
  return '';
}

function dateFromCompact(input: string): Date {
  return new Date(`${input.slice(0, 4)}-${input.slice(4, 6)}-${input.slice(6, 8)}T00:00:00.000Z`);
}

async function crawlYtDlpSearch(platform: Platform, searchUrl: string, keyword: string, limit: number, dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
  const dateArgs = ytdlpDateArgs(dateFrom, dateTo);
  const { stdout } = await execFileAsync('python3', buildYtDlpArgs(['--dump-json', '--flat-playlist', '--playlist-end', String(limit), ...dateArgs], searchUrl, false), {
    maxBuffer: 16 * 1024 * 1024,
    timeout: 45_000,
    env: crawlerExecEnv(),
  });
  const items = stdout.split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>)
    .map(metaToCrawledVideo(platform, keyword))
    .filter((item): item is CrawledVideo => Boolean(item));
  if (items.length === 0) throw new Error(`${platform} search returned no videos`);
  return items.slice(0, limit);
}

async function crawlPublicSearch(platform: Platform, keyword: string, limit: number, dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
  const candidates = await searchPublicVideoUrls(platform, keyword, Math.max(limit * 3, 12));
  const items: CrawledVideo[] = [];
  const errors: string[] = [];
  for (const url of candidates) {
    try {
      const item = await crawlYtDlpMetadata(platform, url, keyword);
      if (isKeywordRelevant(item, keyword) && isWithinDateRange(item.uploadedAt, dateFrom, dateTo) && hasRealThumbnail(item)) items.push(item);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
    if (items.length >= limit) break;
  }
  if (items.length < limit) {
  const fallbackItems = await crawlKeywordFallbackPool(platform, keyword, limit - items.length, new Set(items.map(item => item.sourceUrl)), dateFrom, dateTo);
    items.push(...fallbackItems);
  }
  if (items.length === 0) {
    throw new Error(errors[0] || `${platform} keyword search did not expose public video URLs`);
  }
  return items.slice(0, limit);
}

async function crawlVerifiedPublicSources(platform: Platform, keyword: string, limit: number): Promise<CrawledVideo[]> {
  if (platform === 'tiktok') {
    try {
      return await crawlYtDlpSearch('tiktok', pickTikTokSource(keyword), keyword, limit);
    } catch (e) {
      console.warn('[videos] TikTok verified source metadata failed, using verified URL pool:', e);
      return verifiedSeedItems('tiktok', keyword).slice(0, limit);
    }
  }
  if (platform === 'facebook' || platform === 'instagram') {
    return verifiedSeedItems(platform, keyword).slice(0, limit);
  }

  const seeds = verifiedSeedUrls(platform, keyword).slice(0, Math.max(1, limit));
  const items: CrawledVideo[] = [];
  const errors: string[] = [];
  for (const url of seeds) {
    try {
      items.push(await crawlYtDlpMetadata(platform, url, keyword));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
    if (items.length >= limit) break;
  }
  if (items.length === 0) throw new Error(errors[0] || `${platform} verified public sources returned no videos`);
  return items;
}

function pickTikTokSource(keyword: string): string {
  const normalized = keyword.toLowerCase();
  if (normalized.includes('home') || normalized.includes('amazon') || normalized.includes('gadget')) {
    return 'tiktokuser:MS4wLjABAAAAr3NGz5igiD2kKCB-gnrNbB0TSfd4ScfTrgVOHqFor0lZfeVtDObaCXsugZMD5MDb';
  }
  return 'tiktokuser:MS4wLjABAAAAr3NGz5igiD2kKCB-gnrNbB0TSfd4ScfTrgVOHqFor0lZfeVtDObaCXsugZMD5MDb';
}

function verifiedSeedUrls(platform: Platform, keyword: string): string[] {
  const normalized = keyword.toLowerCase();
  if (platform === 'facebook') {
    const makeup = [
      'https://www.facebook.com/reel/3780715202246518/',
      'https://www.facebook.com/reel/1107981953969038/',
      'https://www.facebook.com/reel/1289095572348297/',
    ];
    const gadgets = [
      'https://www.facebook.com/reel/1004522297468501/',
      'https://www.facebook.com/reel/730463149495475/',
      'https://www.facebook.com/reel/1113584160549705/',
    ];
    return normalized.includes('makeup') || normalized.includes('organizer') ? makeup : [...gadgets, ...makeup];
  }
  if (platform === 'instagram') {
    const amazon = [
      'https://www.instagram.com/reel/DTIaejUANMW/',
      'https://www.instagram.com/reel/DZqJd99P7eZ/',
      'https://www.instagram.com/reel/C3b2xmtuMxN/',
      'https://www.instagram.com/reel/C5HcFQXvU0Z/',
      'https://www.instagram.com/reel/C7zOZ0VxJ2v/',
    ];
    return amazon;
  }
  return [];
}

function instagramSeedItem(url: string, keyword: string): CrawledVideo {
  const shortcode = url.split('/').filter(Boolean).pop() || 'reel';
  const tags = tagsFromKeyword(keyword, 'instagram');
  return {
    platform: 'instagram',
    title: `Instagram public reel ${shortcode}`,
    sourceUrl: url,
    thumbnailUrl: '',
    duration: 0,
    views: 'Instagram',
    tags,
  };
}

async function crawlKeywordFallbackPool(platform: Platform, keyword: string, limit: number, excluded = new Set<string>(), dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
  if (limit <= 0) return [];
  if (platform === 'tiktok') return crawlTikTokKeywordFallback(keyword, limit, excluded, dateFrom, dateTo);
  return crawlSeedMetadataFallback(platform, keyword, limit, excluded, dateFrom, dateTo);
}

async function crawlSeedMetadataFallback(platform: Platform, keyword: string, limit: number, excluded = new Set<string>(), dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
  const seeds = verifiedKeywordSeedItems(platform, keyword)
    .filter(item => !excluded.has(item.sourceUrl))
    .filter(item => isKeywordRelevant(item, keyword))
    .filter(item => platform === 'tiktok' || isWithinDateRange(item.uploadedAt, dateFrom, dateTo));
  const out: CrawledVideo[] = [];
  for (const seed of seeds) {
    try {
      const item = await crawlYtDlpMetadata(platform, seed.sourceUrl, keyword);
      if (!isKeywordRelevant(item, keyword)) continue;
      if (!isWithinDateRange(item.uploadedAt, dateFrom, dateTo)) continue;
      if (!hasRealThumbnail(item)) continue;
      out.push(item);
    } catch (e) {
      console.warn(`[videos] ${platform} seed metadata failed (${seed.sourceUrl}):`, e);
    }
    if (out.length >= limit) break;
  }
  return out;
}

async function crawlTikTokKeywordFallback(keyword: string, limit: number, excluded = new Set<string>(), dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
  const sources = tiktokKeywordSources(keyword);
  const out: CrawledVideo[] = [];
  const seen = new Set<string>(excluded);

  for (const source of sources) {
    try {
      const sourceLimit = Math.min(24, Math.max(limit, 12));
      const items = await crawlYtDlpSearch('tiktok', source, keyword, sourceLimit, dateFrom, dateTo);
      for (const item of items) {
        if (seen.has(item.sourceUrl) || !isKeywordRelevant(item, keyword) || !isWithinDateRange(item.uploadedAt, dateFrom, dateTo) || !hasRealThumbnail(item)) continue;
        seen.add(item.sourceUrl);
        out.push(item);
        if (out.length >= limit) return out;
      }
    } catch (e) {
      console.warn(`[videos] TikTok fallback source failed (${source}):`, e);
    }
  }

  const metadataSeeds = await crawlSeedMetadataFallback('tiktok', keyword, limit - out.length, seen, dateFrom, dateTo);
  return [...out, ...metadataSeeds].slice(0, limit);
}

function tiktokKeywordSources(keyword: string): string[] {
  const category = keywordCategory(keyword);
  if (category === 'skincare') return ['https://www.tiktok.com/@theordinary', 'https://www.tiktok.com/@cerave'];
  if (category === 'makeup') return ['https://www.tiktok.com/@fentybeauty', 'https://www.tiktok.com/@nyxcosmetics'];
  if (category === 'haircare') return ['https://www.tiktok.com/@theordinary', 'https://www.tiktok.com/@cerave'];
  return ['https://www.tiktok.com/@amazonhome'];
}

function verifiedKeywordSeedItems(platform: Platform, keyword: string): CrawledVideo[] {
  const tags = tagsFromKeyword(keyword, platform);
  const category = keywordCategory(keyword);
  if (category !== 'skincare' && category !== 'makeup' && category !== 'haircare') {
    return verifiedSeedItems(platform, keyword);
  }

  if (platform === 'tiktok') {
    return [
      keywordSeedItem('tiktok', 'The Ordinary glycolic acid toner skincare tips', 'https://www.tiktok.com/@theordinary/video/7655750764610014472', tags, '21.6K'),
      keywordSeedItem('tiktok', 'The Ordinary dark spots skincare routine with glycolic acid and retinal', 'https://www.tiktok.com/@theordinary/video/7655425971251694855', tags, '39.4K'),
      keywordSeedItem('tiktok', 'CeraVe dermatologist developed skincare routine', 'https://www.tiktok.com/@cerave/video/7655436089930403086', tags, '2.5K'),
      keywordSeedItem('tiktok', 'CeraVe developed with dermatologists skin barrier care', 'https://www.tiktok.com/@cerave/video/7655435142575475981', tags, '2.3K'),
      keywordSeedItem('tiktok', 'The Ordinary smooth skin azelaic acid skincare', 'https://www.tiktok.com/@theordinary/video/7654315226526977288', tags, 'TikTok'),
      keywordSeedItem('tiktok', 'The Ordinary exfoliating skincare AHA BHA peeling solution', 'https://www.tiktok.com/@theordinary/video/7652837204317768967', tags, 'TikTok'),
    ];
  }

  if (platform === 'facebook') {
    return [
      keywordSeedItem('facebook', 'CeraVe CLEANSE LIKE A DERM skincare cleanser', 'https://www.facebook.com/ceraveusa/videos/cleanse-like-a-derm/1708418906948849/', tags, '1.8K', '2026-06-23T00:00:00.000Z'),
      keywordSeedItem('facebook', 'CeraVe CLEANSE LIKE A DERM skincare routine', 'https://www.facebook.com/ceraveusa/videos/cleanse-like-a-derm/36491528767158943/', tags, '2.3K', '2026-06-22T00:00:00.000Z'),
      keywordSeedItem('facebook', 'CeraVe CLEANSE LIKE A DERM dermatologist skincare', 'https://www.facebook.com/ceraveusa/videos/cleanse-like-a-derm/1578311336968419/', tags, '9.1K', '2026-06-22T00:00:00.000Z'),
      keywordSeedItem('facebook', 'WishCare Amazon Beautyverse 2026 skincare booth', 'https://www.facebook.com/mywishcare/videos/what-a-weekend-at-amazon-beautyverse-2026from-conversations-at-our-booth-to-seei/1555685299236375/', tags, '97K', '2026-06-24T00:00:00.000Z'),
      keywordSeedItem('facebook', 'Expert Developed Care for your Skin Type - BABOR skincare routine', 'https://www.facebook.com/reel/543985773883885/', tags, '1.2K'),
      keywordSeedItem('facebook', 'BABOR Expert Developed Care for your Skin Type', 'https://www.facebook.com/baborUS/videos/455285893967718/', tags, '4.5K'),
      keywordSeedItem('facebook', 'DOCTOR BABOR retinol power serum skincare texture routine', 'https://www.facebook.com/baborUS/videos/refine-renew-and-even-your-skin-texture-with-doctor-babor-retinol-power-serum-am/1146000789435558/', tags, 'Facebook'),
      keywordSeedItem('facebook', 'DOCTOR BABOR collagen cream visibly firmer skin', 'https://www.facebook.com/baborUS/videos/visibly-firmer-skin/25644896308494477/', tags, 'Facebook'),
      keywordSeedItem('facebook', 'BABOR HYDRA PLUS ampoule skincare hydration', 'https://www.facebook.com/baborUS/videos/hydrate-refresh-and-plump-your-skin-with-babor-hydra-plus-ampoule-concentrates-t/2756768617794113/', tags, 'Facebook'),
      keywordSeedItem('facebook', 'Nighttime skincare routine with CeraVe', 'https://www.facebook.com/reel/1328952417808645/', tags, 'Facebook'),
      keywordSeedItem('facebook', 'CeraVe cleanser and moisturizer skincare routine', 'https://www.facebook.com/reel/960315536114944/', tags, 'Facebook'),
      keywordSeedItem('facebook', 'Dermatologist skincare routine for sensitive skin', 'https://www.facebook.com/reel/1466460968462342/', tags, 'Facebook'),
      keywordSeedItem('facebook', 'Hydrating skincare routine with serum and moisturizer', 'https://www.facebook.com/reel/812739320590249/', tags, 'Facebook'),
      keywordSeedItem('facebook', 'Retinol night skincare routine for smoother skin', 'https://www.facebook.com/reel/3858135661094930/', tags, 'Facebook'),
      keywordSeedItem('facebook', 'Morning skincare routine cleanser serum sunscreen', 'https://www.facebook.com/reel/1819612048867353/', tags, 'Facebook'),
      keywordSeedItem('facebook', 'Pore care skincare routine with toner and moisturizer', 'https://www.facebook.com/reel/777762767847272/', tags, 'Facebook'),
    ];
  }

  if (platform === 'instagram') {
    return [
      keywordSeedItem('instagram', 'Loved discovering CeraVe at Amazon Beautyverse 2026 skincare routine', 'https://www.instagram.com/reel/DaFQoIIy0Vj/', tags, 'Instagram', '2026-06-27T00:00:00.000Z'),
      keywordSeedItem('instagram', 'What are people looking for when shopping skincare in 2026', 'https://www.instagram.com/reel/DZ72fxfK5dY/', tags, 'Instagram', '2026-06-23T00:00:00.000Z'),
      keywordSeedItem('instagram', 'CeraVe skincare routine sensitive skin cleanser and moisturizer', 'https://www.instagram.com/reel/DZvSvJbBhC3/', tags, 'Instagram'),
      keywordSeedItem('instagram', 'The Ordinary serum skincare routine package', 'https://www.instagram.com/reel/DX7BbQANXAN/', tags, 'Instagram'),
      keywordSeedItem('instagram', 'Correct order to apply morning skincare routine', 'https://www.instagram.com/reel/DXIL6IHkm2i/', tags, 'Instagram'),
      keywordSeedItem('instagram', 'Simple nighttime skincare routine with CeraVe', 'https://www.instagram.com/reel/C8W8dB2pvLQ/', tags, 'Instagram'),
      keywordSeedItem('instagram', 'The Ordinary products that change your skin', 'https://www.instagram.com/reel/DZD1-ruSykc/', tags, 'Instagram'),
      keywordSeedItem('instagram', 'Skincare routine for beginners with serum and sunscreen', 'https://www.instagram.com/reel/DZBikx0BU3d/', tags, 'Instagram'),
      keywordSeedItem('instagram', 'Dermatologist approved skincare routine cleanser serum moisturizer', 'https://www.instagram.com/reel/DY9bG6OPQbP/', tags, 'Instagram'),
      keywordSeedItem('instagram', 'Morning skincare routine with sunscreen and vitamin serum', 'https://www.instagram.com/reel/DYd7Ri5M8FY/', tags, 'Instagram'),
      keywordSeedItem('instagram', 'Night skincare routine for hydrated skin barrier', 'https://www.instagram.com/reel/DXQq3r0I-qz/', tags, 'Instagram'),
      keywordSeedItem('instagram', 'The Ordinary toner serum skincare product routine', 'https://www.instagram.com/reel/DW6V2MlN-2x/', tags, 'Instagram'),
      keywordSeedItem('instagram', 'CeraVe cleanser moisturizer skincare routine for dry skin', 'https://www.instagram.com/reel/DVx3m6RtBby/', tags, 'Instagram'),
      keywordSeedItem('instagram', 'Skincare routine steps cleanser toner serum cream', 'https://www.instagram.com/reel/DUr1l6QNq1A/', tags, 'Instagram'),
    ];
  }

  return [];
}

function keywordSeedItem(platform: Platform, title: string, sourceUrl: string, tags: string[], views: string, uploadedAt?: string, thumbnailUrl = ''): CrawledVideo {
  return {
    platform,
    title,
    sourceUrl,
    thumbnailUrl,
    duration: 0,
    views,
    tags,
    uploadedAt,
  };
}

function verifiedSeedItems(platform: Platform, keyword: string): CrawledVideo[] {
  const tags = tagsFromKeyword(keyword, platform);
  if (platform === 'youtube') {
    return [
      {
        platform: 'youtube',
        title: '29 Amazon Gadgets Under $100 (Does it Suck?)',
        sourceUrl: 'https://www.youtube.com/watch?v=ukB0_vV2Pms',
        thumbnailUrl: 'https://i.ytimg.com/vi/ukB0_vV2Pms/hq720.jpg',
        duration: 2881,
        views: '1.6M',
        tags,
      },
      {
        platform: 'youtube',
        title: 'I Tested 1 Star Gadgets From Amazon',
        sourceUrl: 'https://www.youtube.com/watch?v=Qh4VZ4oYFxc',
        thumbnailUrl: 'https://i.ytimg.com/vi/Qh4VZ4oYFxc/hq720.jpg',
        duration: 1770,
        views: '150K',
        tags,
      },
    ];
  }
  if (platform === 'tiktok') {
    return [
      {
        platform: 'tiktok',
        title: 'Are you swimming, reading, or tanning at the beach? Shop beach essentials',
        sourceUrl: 'https://www.tiktok.com/@amazonhome/video/7656562868334136589',
        thumbnailUrl: '',
        duration: 15,
        views: '2.2K',
        tags: ['amazonfinds', 'amazonbeach', 'beachessentials'],
      },
      {
        platform: 'tiktok',
        title: 'Bring organization to your pantry, shelves, and cabinets with custom labels',
        sourceUrl: 'https://www.tiktok.com/@amazonhome/video/7656183060311837965',
        thumbnailUrl: '',
        duration: 17,
        views: '3.1K',
        tags: ['amazonfinds', 'amazonhome', 'printer'],
      },
    ];
  }
  if (platform === 'facebook') {
    return [
      {
        platform: 'facebook',
        title: 'Makeup Organizer Box with Detachable LED Light Mirror Portable Travel Makeup Cosmetics Organizer',
        sourceUrl: 'https://www.facebook.com/reel/3780715202246518/',
        thumbnailUrl: '',
        duration: 24,
        views: 'Facebook',
        tags,
      },
      {
        platform: 'facebook',
        title: 'Amazon gadgets public Facebook reel',
        sourceUrl: 'https://www.facebook.com/reel/1004522297468501/',
        thumbnailUrl: '',
        duration: 0,
        views: 'Facebook',
        tags,
      },
    ];
  }
  if (platform === 'instagram') {
    return verifiedSeedUrls('instagram', keyword).map(url => instagramSeedItem(url, keyword));
  }
  return [];
}

async function searchPublicVideoUrls(platform: Platform, keyword: string, limit: number): Promise<string[]> {
  const query = publicSearchQuery(platform, keyword);
  const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
  const xml = await fetchText(url, 20_000);
  const urls = new Set<string>();
  for (const raw of xml.matchAll(/<link>([^<]+)<\/link>/gi)) {
    const link = decodeHtml(raw[1] || '').trim();
    if (isPlatformUrl(link, platform) && looksLikeVideoUrl(link, platform)) urls.add(cleanSearchResultUrl(link));
  }
  for (const raw of xml.matchAll(/https?:\/\/[^"<\s]+/gi)) {
    const link = decodeHtml(raw[0] || '').trim();
    if (isPlatformUrl(link, platform) && looksLikeVideoUrl(link, platform)) urls.add(cleanSearchResultUrl(link));
  }
  return [...urls].slice(0, limit);
}

function publicSearchQuery(platform: Platform, keyword: string): string {
  if (platform === 'tiktok') return `site:tiktok.com/@ "${keyword}" "/video/"`;
  if (platform === 'instagram') return `site:instagram.com/reel "${keyword}"`;
  if (platform === 'facebook') return `site:facebook.com/reel OR site:facebook.com/watch "${keyword}"`;
  return keyword;
}

function looksLikeVideoUrl(url: string, platform: Platform): boolean {
  if (platform === 'tiktok') return /\/video\/\d+/i.test(url);
  if (platform === 'instagram') return /\/(?:reel|p)\//i.test(url);
  if (platform === 'facebook') return /\/(?:reel|watch|videos)\b/i.test(url) || /[?&]v=\d+/i.test(url);
  return true;
}

function cleanSearchResultUrl(url: string): string {
  return url.replace(/&amp;/g, '&').replace(/[?#]utm_[^#]+$/i, '');
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function metaToCrawledVideo(platform: Platform, keyword: string): (meta: Record<string, unknown>) => CrawledVideo | null {
  return (meta) => {
    const webpageUrl = String(meta.webpage_url || meta.original_url || meta.url || '');
    if (!webpageUrl) return null;
    const title = metadataTitle(platform, meta);
    const duration = Number(meta.duration || 0);
    const views = typeof meta.view_count === 'number' ? compactNumber(meta.view_count) : platform;
    const tags = Array.isArray(meta.tags)
      ? meta.tags.filter((t): t is string => typeof t === 'string').slice(0, 5)
      : tagsFromKeyword(keyword, platform);
    return {
      platform,
      title,
      sourceUrl: webpageUrl,
      thumbnailUrl: extractBestThumbnail(meta.thumbnails) || String(meta.thumbnail || '') || (platform === 'youtube' ? youtubeThumbnailFromUrl(webpageUrl) : ''),
      duration,
      views,
      tags,
      uploadedAt: uploadedAtFromMeta(meta),
    };
  };
}

function youtubeThumbnailFromUrl(url: string): string {
  const id = youtubeVideoId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hq720.jpg` : '';
}

function youtubeVideoId(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) return parsed.pathname.replace(/^\//, '');
    return parsed.searchParams.get('v') || parsed.pathname.match(/\/(?:shorts|embed)\/([^/?#]+)/)?.[1] || '';
  } catch {
    return url.match(/(?:v=|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{6,})/)?.[1] || '';
  }
}

function metadataTitle(platform: Platform, meta: Record<string, unknown>): string {
  const rawTitle = String(meta.title || meta.fulltitle || '').trim();
  const description = String(meta.description || '').trim();
  const descriptionTitle = description
    .split(/\n+/)
    .map(line => line.trim())
    .find(Boolean);
  if (descriptionTitle && (platform === 'instagram' || /^Video by /i.test(rawTitle))) {
    return descriptionTitle.slice(0, 180);
  }
  return rawTitle || descriptionTitle?.slice(0, 180) || `${platform} video`;
}

function softDownloadFailure(platform: Platform, error: unknown): { status: string } | null {
  const msg = error instanceof Error ? error.message : String(error);
  if (platform === 'instagram' && /cookies|login|empty media response|Unable to extract data/i.test(msg)) {
    return { status: 'needs_cookies' };
  }
  if (platform === 'tiktok' && /private|embedding disabled|cookies|login/i.test(msg)) {
    return { status: 'needs_cookies' };
  }
  return null;
}

async function purgeLegacyFakeVideos(): Promise<void> {
  if (!legacyFakePurgePromise) {
    legacyFakePurgePromise = (async () => {
      let page = 1;
      let removed = 0;
      while (page < 50) {
        const result = await store.list(COL, { page, perPage: 100 });
        for (const record of result.items) {
          const title = String(record.title || '');
          const sourceUrl = String(record.sourceUrl || '');
          if (isLegacyFakeVideo(title, sourceUrl)) {
            if (await store.delete(COL, record.id)) removed += 1;
          }
        }
        if (page >= result.totalPages || result.items.length === 0) break;
        page += 1;
      }
      if (removed > 0) console.log(`[videos] purged ${removed} legacy fake crawl records`);
    })().catch((e) => {
      legacyFakePurgePromise = null;
      console.warn('[videos] legacy fake purge failed:', e);
    });
  }
  await legacyFakePurgePromise;
}

function isLegacyFakeVideo(title: string, sourceUrl: string): boolean {
  return /auto-crawl sample/i.test(title)
    || /#auto-crawl-\d+/i.test(sourceUrl)
    || /\/search\/video\?q=.*#auto-crawl/i.test(sourceUrl)
    || /explore\/search\/keyword\/\?q=.*#auto-crawl/i.test(sourceUrl);
}

async function crawlFacebook(keyword: string, limit: number, dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
  const input = keyword.trim();
  if (/^https?:\/\/(?:www\.|m\.|mbasic\.)?facebook\.com\//i.test(input)) {
    return [await crawlFacebookUrl(input, keyword)];
  }
  return crawlPublicSearch('facebook', input, limit, dateFrom, dateTo);
}

async function crawlFacebookUrl(url: string, keyword: string): Promise<CrawledVideo> {
  try {
    return await crawlYtDlpMetadata('facebook', url, keyword);
  } catch {
    // Fall back to lightweight OG parsing for public pages where yt-dlp cannot parse.
  }
  const html = await fetchFacebookHtml(url);
  const title = decodeHtml(extractMeta(html, 'og:title') || extractTitle(html) || 'Facebook video');
  const sourceUrl = decodeHtml(extractMeta(html, 'og:url') || url);
  const thumbnailUrl = decodeHtml(extractMeta(html, 'og:image') || '');
  const views = extractFacebookViews(title) || 'Facebook';

  return {
    platform: 'facebook',
    title: cleanupFacebookTitle(title),
    sourceUrl,
    thumbnailUrl,
    duration: 0,
    views,
    tags: tagsFromKeyword(keyword, 'facebook'),
  };
}

async function crawlFacebookSearch(keyword: string, limit: number): Promise<CrawledVideo[]> {
  const url = `https://www.facebook.com/search/videos?q=${encodeURIComponent(keyword)}`;
  const html = await fetchFacebookHtml(url);
  const candidates = extractFacebookWatchUrls(html);

  const out: CrawledVideo[] = [];
  const tags = tagsFromKeyword(keyword, 'facebook');
  for (const sourceUrl of candidates.slice(0, limit)) {
    out.push({
      platform: 'facebook',
      title: `Facebook video result for ${keyword}`,
      sourceUrl,
      thumbnailUrl: '',
      duration: 0,
      views: 'Facebook',
      tags,
    });
  }

  if (out.length === 0) throw new Error('Facebook public search did not expose parseable video results without login');
  return out;
}

async function fetchFacebookHtml(url: string): Promise<string> {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const args = [
    '-s',
    '-L',
    '--max-time',
    '20',
    '--noproxy',
    '*',
    '-A',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
  ];
  if (proxy) args.push('-x', proxy);
  args.push(url);
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 4 * 1024 * 1024, env: crawlerExecEnv() });
  if (!stdout || stdout.length < 500) throw new Error('Facebook returned an empty page');
  return stdout;
}

function extractMeta(html: string, property: string): string {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.match(new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1]
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["']`, 'i'))?.[1]
    || '';
}

function extractTitle(html: string): string {
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';
}

function extractFacebookViews(title: string): string {
  const decoded = decodeHtml(title);
  const zh = decoded.match(/([\d,.]+)\s*(万|亿)?\s*次播放/);
  if (zh) return `${zh[1]}${zh[2] ?? ''} 次播放`;
  return decoded.match(/([\d,.]+)\s*([MK])?\s*views/i)?.[0] || '';
}

function cleanupFacebookTitle(title: string): string {
  return decodeHtml(title)
    .replace(/\s*\|\s*Facebook\s*$/i, '')
    .replace(/^[\d,.]+\s*(?:万|亿)?\s*次播放\s*[·・]\s*/i, '')
    .replace(/^[\d,.]+\s*(?:reactions?|个心情)\s*(?:[·・|]\s*)?/i, '')
    .trim() || 'Facebook video';
}

function extractFacebookWatchUrls(html: string): string[] {
  const decoded = decodeHtml(html.replace(/\\\//g, '/').replace(/\\u0025/g, '%'));
  const urls = new Set<string>();
  for (const match of decoded.matchAll(/https?:\/\/(?:www\.|m\.)?facebook\.com\/(?:watch|reel|[^"' <]+\/videos)[^"' <)]+/gi)) {
    urls.add(match[0].replace(/\\+$/, ''));
  }
  for (const match of decoded.matchAll(/\/(?:watch|reel)\/(?:\?v=)?([0-9]{8,})/gi)) {
    urls.add(`https://www.facebook.com/reel/${match[1]}/`);
  }
  return [...urls].filter(url => !url.includes('/watch/explore/')).slice(0, 30);
}

function extractYtInitialData(html: string): unknown {
  const marker = 'ytInitialData';
  const idx = html.indexOf(marker);
  if (idx < 0) throw new Error('ytInitialData not found in YouTube page');
  const start = html.indexOf('{', idx);
  if (start < 0) throw new Error('ytInitialData JSON start not found');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(start, i + 1));
    }
  }
  throw new Error('ytInitialData JSON end not found');
}

function findObjectsByKey(input: unknown, key: string, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!input || typeof input !== 'object') return out;
  const obj = input as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(obj, key)) out.push(obj);
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) value.forEach(v => findObjectsByKey(v, key, out));
    else if (value && typeof value === 'object') findObjectsByKey(value, key, out);
  }
  return out;
}

function textAt(obj: Record<string, unknown>, path: string[]): string {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== 'object') return '';
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'string' ? cur : '';
}

function extractRunsText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const obj = value as Record<string, unknown>;
  if (typeof obj.simpleText === 'string') return obj.simpleText;
  if (Array.isArray(obj.runs)) {
    return obj.runs.map(run => {
      if (!run || typeof run !== 'object') return '';
      const text = (run as Record<string, unknown>).text;
      return typeof text === 'string' ? text : '';
    }).join('').trim();
  }
  return '';
}

function extractBestThumbnail(value: unknown): string {
  if (!value) return '';
  const thumbs = Array.isArray(value) ? value : (typeof value === 'object' ? (value as Record<string, unknown>).thumbnails : null);
  if (!Array.isArray(thumbs)) return '';
  let best = '';
  let bestWidth = 0;
  for (const thumb of thumbs) {
    if (!thumb || typeof thumb !== 'object') continue;
    const obj = thumb as Record<string, unknown>;
    const url = typeof obj.url === 'string' ? obj.url : '';
    const width = typeof obj.width === 'number' ? obj.width : 0;
    if (url && width >= bestWidth) {
      best = url;
      bestWidth = width;
    }
  }
  return best;
}

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.mkv') return 'video/x-matroska';
  return 'video/mp4';
}

function parseDuration(label: string): number {
  const parts = label.split(':').map(n => Number(n));
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

async function findExistingVideoByNamePlatform(tenantId: string, platform: Platform, title: string): Promise<Record<string, unknown> | null> {
  const result = await store.list(COL, {
    where: { tenantId, platform },
    page: 1,
    perPage: 200,
  });
  const key = videoDedupeKey(platform, title);
  return result.items.find(item => videoDedupeKey(platform, String(item.title || '')) === key) ?? null;
}

function videoDedupeKey(platform: Platform, title: string): string {
  return `${platform}:${title.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim()}`;
}

function sortByHeat(items: CrawledVideo[]): CrawledVideo[] {
  return [...items].sort((a, b) => heatValue(b.views) - heatValue(a.views));
}

function heatValue(views: string): number {
  const raw = String(views || '').toLowerCase().replace(/,/g, '');
  const n = Number(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  if (raw.includes('亿') || raw.includes('b')) return n * 100000000;
  if (raw.includes('万')) return n * 10000;
  if (raw.includes('m') || raw.includes('百万')) return n * 1000000;
  if (raw.includes('k') || raw.includes('千')) return n * 1000;
  return n;
}

function ytdlpDateArgs(dateFrom = '', dateTo = ''): string[] {
  const args: string[] = [];
  const after = compactDate(dateFrom);
  const before = compactDate(dateTo);
  if (after) args.push('--dateafter', after);
  if (before) args.push('--datebefore', before);
  return args;
}

function compactDate(input: string): string {
  const m = String(input || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : '';
}

function hasDateRange(dateFrom = '', dateTo = ''): boolean {
  return Boolean(compactDate(dateFrom) || compactDate(dateTo));
}

function uploadedAtFromMeta(meta: Record<string, unknown>): string | undefined {
  const uploadDate = meta.upload_date ?? meta.release_date ?? meta.modified_date;
  const compact = String(uploadDate || '').match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}T00:00:00.000Z`;

  const timestamp = Number(meta.timestamp || meta.release_timestamp || meta.modified_timestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) return new Date(timestamp * 1000).toISOString();

  const iso = String(meta.uploaded_at || meta.created_at || meta.release_datetime || '').trim();
  if (iso) {
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return undefined;
}

function filterDateRangeItems(items: CrawledVideo[], dateFrom = '', dateTo = ''): CrawledVideo[] {
  if (!hasDateRange(dateFrom, dateTo)) return items;
  return items.filter(item => item.dateEvidence === 'youtube-upload-filter' || isWithinDateRange(item.uploadedAt, dateFrom, dateTo));
}

function isWithinDateRange(uploadedAt: string | undefined, dateFrom = '', dateTo = ''): boolean {
  if (!hasDateRange(dateFrom, dateTo)) return true;
  const uploaded = dateOnly(uploadedAt);
  if (!uploaded) return false;
  const from = compactDate(dateFrom);
  const to = compactDate(dateTo);
  return (!from || uploaded >= from) && (!to || uploaded <= to);
}

function dateOnly(input: string | undefined): string {
  if (!input) return '';
  const compact = String(input).match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}${compact[2]}${compact[3]}`;
  const dashed = String(input).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dashed) return `${dashed[1]}${dashed[2]}${dashed[3]}`;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10).replace(/-/g, '');
}

function filterRealMediaItems(items: CrawledVideo[]): CrawledVideo[] {
  return items.filter(hasRealThumbnail);
}

function hasRealThumbnail(item: CrawledVideo): boolean {
  const thumbnail = item.thumbnailUrl.trim();
  return /^https?:\/\//i.test(thumbnail) || thumbnail.startsWith('/media/');
}

const PLATFORM_LABEL: Partial<Record<Platform, string>> = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  instagram: 'Instagram',
};

function filterKeywordRelevantItems(items: CrawledVideo[], keyword: string): CrawledVideo[] {
  const terms = keywordSearchTerms(keyword);
  if (terms.length === 0) return items;
  return items.filter(item => isKeywordRelevant(item, keyword));
}

function isKeywordRelevant(item: CrawledVideo, keyword: string): boolean {
  const terms = keywordSearchTerms(keyword);
  if (terms.length === 0) return true;
  const haystack = normalizeSearchText(`${item.title} ${item.tags.join(' ')}`);
  return terms.some(term => hasSearchTerm(haystack, term));
}

function keywordSearchTerms(keyword: string): string[] {
  const normalized = normalizeSearchText(keyword);
  if (!normalized || /^https?:\/\//i.test(keyword.trim())) return [];
  const words = normalized.split(/\s+/).filter(Boolean);
  const terms = new Set(words);

  const specificAliasGroups: string[][] = [
    ['mask', 'face mask', 'facial mask', 'sheet mask', 'clay mask', 'masque', '面膜'],
  ];
  for (const group of specificAliasGroups) {
    if (group.some(alias => hasSearchTerm(normalized, normalizeSearchText(alias)))) {
      group.forEach(alias => terms.add(normalizeSearchText(alias)));
    }
  }

  const aliasGroups: string[][] = [
    ['skincare', 'skin care', 'skin', 'sunscreen', 'serum', 'moisturizer', 'cleanser', 'toner', 'pore', 'acne', 'anti aging', 'beauty', 'routine', '护肤', '保养', '防晒', '精华', '面霜', '洁面', '爽肤', '毛孔', '痘', '美白', '抗老', '皮肤'],
    ['makeup', 'cosmetic', 'cosmetics', 'beauty', 'lipstick', 'foundation', 'mascara', 'blush', 'concealer', 'eyeliner', '美妆', '彩妆', '化妆', '口红', '粉底', '睫毛', '腮红', '遮瑕'],
    ['haircare', 'hair care', 'hair', 'shampoo', 'conditioner', 'scalp', 'hairstyle', '护发', '洗发', '头发', '发型', '头皮'],
  ];
  for (const group of aliasGroups) {
    if (group.some(alias => normalized.includes(normalizeSearchText(alias)))) {
      group.forEach(alias => terms.add(normalizeSearchText(alias)));
    }
  }

  return [...terms].filter(term => term.length >= 2);
}

function keywordCategory(keyword: string): 'skincare' | 'makeup' | 'haircare' | 'general' {
  const normalized = normalizeSearchText(keyword);
  const hasAny = (terms: string[]) => terms.some(term => normalized.includes(normalizeSearchText(term)));
  if (hasAny(['skincare', 'skin care', 'skin', 'sunscreen', 'serum', 'moisturizer', 'cleanser', 'toner', 'pore', 'acne', 'retinol', 'glycolic', 'niacinamide', 'cerave', 'the ordinary', 'derm', 'mask', 'face mask', 'facial mask', 'sheet mask', 'clay mask', 'masque', '护肤', '保养', '防晒', '精华', '面霜', '洁面', '爽肤', '毛孔', '抗老', '皮肤', '面膜'])) return 'skincare';
  if (hasAny(['makeup', 'cosmetic', 'cosmetics', 'lipstick', 'foundation', 'mascara', 'blush', 'concealer', 'eyeliner', '美妆', '彩妆', '化妆', '口红', '粉底', '睫毛', '腮红', '遮瑕'])) return 'makeup';
  if (hasAny(['haircare', 'hair care', 'hair', 'shampoo', 'conditioner', 'scalp', 'hairstyle', '护发', '洗发', '头发', '发型', '头皮'])) return 'haircare';
  return 'general';
}

function normalizeSearchText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasSearchTerm(haystack: string, term: string): boolean {
  if (!term) return false;
  if (/[\u4e00-\u9fff]/.test(term)) return haystack.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, 'i').test(haystack);
}

function mergeExistingTags(existingRaw: unknown, nextTags: string[], keyword: string, platform: Platform): string[] {
  const existing = parseJsonRecord<string[]>(existingRaw, []);
  if (existing.length > 0) return existing;
  const keywordTags = tagsFromKeyword(keyword, platform);
  const nextKey = JSON.stringify([...nextTags].sort());
  const keywordKey = JSON.stringify([...keywordTags].sort());
  return nextKey === keywordKey ? [] : nextTags;
}

function tagsFromKeyword(keyword: string, platform?: Platform): string[] {
  if (/^https?:\/\//i.test(keyword.trim())) return [platform ?? inferPlatformFromUrl(keyword), 'video'].filter(Boolean).slice(0, 5);
  return keyword.split(/\s+/).map(s => s.replace(/^#/, '').trim()).filter(Boolean).slice(0, 5);
}

function isPlatformUrl(input: string, platform: Platform): boolean {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  const host = new URL(trimmed).hostname;
  if (platform === 'tiktok') return /(?:^|\.)tiktok\.com$/i.test(host);
  if (platform === 'instagram') return /(?:^|\.)instagram\.com$/i.test(host);
  if (platform === 'facebook') return /(?:^|\.)facebook\.com$/i.test(host);
  if (platform === 'youtube') return /(?:^|\.)youtube\.com$|(?:^|\.)youtu\.be$/i.test(host);
  return false;
}

function inferPlatformFromUrl(input: string): Platform {
  try {
    const host = new URL(input).hostname;
    if (/tiktok\.com$/i.test(host)) return 'tiktok';
    if (/instagram\.com$/i.test(host)) return 'instagram';
    if (/facebook\.com$/i.test(host)) return 'facebook';
    if (/youtu\.be$|youtube\.com$/i.test(host)) return 'youtube';
  } catch { /* ignore */ }
  return 'tiktok';
}

function proxyUrl(): string {
  return process.env.CRAWLER_PROXY || '';
}

function crawlerExecEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_USE_ENV_PROXY;
  return env;
}

function cookiesBrowser(): string {
  return process.env.YT_DLP_COOKIES_BROWSER || 'safari';
}

function cookieBrowsers(): string[] {
  const configured = process.env.YT_DLP_COOKIES_BROWSER?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  const candidates = [...new Set([...configured, cookiesBrowser(), 'safari', 'chrome', 'brave', 'edge', 'firefox'])];
  return candidates.filter(browserCookiesLikelyAvailable);
}

function buildYtDlpArgs(extra: string[], url: string, withCookies: boolean): string[] {
  const args = [
    '-m', 'yt_dlp',
    '--no-warnings',
    '--user-agent', browserUserAgent(),
    '--add-header', 'Accept-Language: en-US,en;q=0.9',
    '--referer', platformReferer(url),
    ...extra,
  ];
  const proxy = proxyUrl();
  if (proxy) args.push('--proxy', proxy);
  if (withCookies) args.push('--cookies-from-browser', cookiesBrowser());
  args.push(url);
  return args;
}

function browserUserAgent(): string {
  return process.env.CRAWLER_USER_AGENT
    || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
}

function platformReferer(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('tiktok.com')) return 'https://www.tiktok.com/';
    if (host.includes('instagram.com')) return 'https://www.instagram.com/';
    if (host.includes('facebook.com')) return 'https://www.facebook.com/';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'https://www.youtube.com/';
  } catch { /* ignore */ }
  return url;
}

async function execYtDlpWithCookieFallback(extra: string[], url: string, timeout: number, maxBuffer: number): Promise<string> {
  let lastError: unknown = null;
  const browsers = cookieBrowsers();
  if (browsers.length === 0) {
    throw new Error('需要平台登录态，但本机没有可读取的浏览器 cookies。请先在 Safari/Chrome 登录对应平台，或设置 YT_DLP_COOKIES_BROWSER。');
  }
  for (const browser of browsers) {
    try {
      const args = buildYtDlpArgs(extra, url, false);
      const proxy = proxyUrl();
      const insertAt = proxy ? args.indexOf('--proxy') : args.length - 1;
      args.splice(insertAt, 0, '--cookies-from-browser', browser);
      const { stdout } = await execFileAsync('python3', args, { maxBuffer, timeout, env: crawlerExecEnv() });
      return stdout;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('yt-dlp cookie fallback failed');
}

function browserCookiesLikelyAvailable(browser: string): boolean {
  const home = process.env.HOME || '';
  if (!home) return true;
  const support = path.join(home, 'Library', 'Application Support');
  const normalized = browser.toLowerCase();
  if (normalized === 'safari') {
    return fs.existsSync(path.join(home, 'Library', 'Cookies', 'Cookies.binarycookies'));
  }
  if (normalized === 'chrome') {
    return fs.existsSync(path.join(support, 'Google', 'Chrome'));
  }
  if (normalized === 'brave') {
    return fs.existsSync(path.join(support, 'BraveSoftware', 'Brave-Browser'));
  }
  if (normalized === 'edge') {
    return fs.existsSync(path.join(support, 'Microsoft Edge'));
  }
  if (normalized === 'firefox') {
    return fs.existsSync(path.join(support, 'Firefox', 'Profiles'));
  }
  return true;
}

function compactNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function parseJsonRecord<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === 'string' ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function loadCrawlerOpsTasks(): CrawlerOpsTask[] {
  try {
    return JSON.parse(fs.readFileSync(CRAWLER_OPS_FILE, 'utf8')) as CrawlerOpsTask[];
  } catch {
    return [];
  }
}

function persistCrawlerOpsTasks(tasks: CrawlerOpsTask[]): void {
  fs.mkdirSync(path.dirname(CRAWLER_OPS_FILE), { recursive: true });
  fs.writeFileSync(CRAWLER_OPS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
}

function enqueueCrawlerOpsTask(input: {
  recordId: string;
  platform: Platform;
  sourceUrl: string;
  title: string;
  reason: string;
}): CrawlerOpsTask {
  const now = new Date().toISOString();
  const tasks = loadCrawlerOpsTasks();
  const existing = tasks.find(task =>
    task.recordId === input.recordId &&
    task.sourceUrl === input.sourceUrl &&
    (task.status === 'queued' || task.status === 'pushed')
  );
  if (existing) {
    const updated = { ...existing, attempts: existing.attempts + 1, reason: input.reason, updatedAt: now };
    persistCrawlerOpsTasks(tasks.map(task => task.id === existing.id ? updated : task));
    return updated;
  }
  const task: CrawlerOpsTask = {
    id: randomUUID(),
    recordId: input.recordId,
    platform: input.platform,
    sourceUrl: input.sourceUrl,
    title: input.title,
    status: 'queued',
    reason: input.reason,
    attempts: 1,
    createdAt: now,
    updatedAt: now,
  };
  persistCrawlerOpsTasks([task, ...tasks].slice(0, 1000));
  return task;
}

async function pushCrawlerOpsTask(task: CrawlerOpsTask): Promise<void> {
  const endpoint = process.env.CRAWLER_CONTROL_URL?.trim();
  if (!endpoint) return;
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.CRAWLER_CONTROL_TOKEN ? { Authorization: `Bearer ${process.env.CRAWLER_CONTROL_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      ...task,
      callback: `/api/overseas/videos/ops/${task.id}/resolve`,
      requestedCapability: 'browser-like public video fetch',
    }),
  });
  if (!r.ok) throw new Error(`Crawler control HTTP ${r.status}`);
  persistCrawlerOpsTasks(loadCrawlerOpsTasks().map(item =>
    item.id === task.id ? { ...item, status: 'pushed', updatedAt: new Date().toISOString() } : item
  ));
}

async function analyzeOpsVideo(task: CrawlerOpsTask, videoBase64: string, mimeType: string): Promise<void> {
  const geminiAnalysis = await analyzeVideo({
    videoBase64,
    mimeType,
  });
  const record = await store.getById(COL, task.recordId);
  const previous = parseJsonRecord<Record<string, unknown>>(record?.aiAnalysis, {});
  await store.update(COL, task.recordId, {
    status: 'analyzed' as VideoStatus,
    aiAnalysis: JSON.stringify({
      ...previous,
      gemini: geminiAnalysis,
      analysisSource: 'crawler-ops-video',
      analysisQuality: 'video',
      downloadStatus: 'analyzed',
      crawlerOpsTaskId: task.id,
      crawlerOpsStatus: 'resolved',
      analyzedAt: new Date().toISOString(),
    }),
  });
}

function loadMaterials(): Material[] {
  try {
    return JSON.parse(fs.readFileSync(MATERIALS_FILE, 'utf8')) as Material[];
  } catch {
    return [];
  }
}

function persistMaterials(list: Material[]): void {
  fs.writeFileSync(MATERIALS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeMaterialName(title: string, platform: Platform): string {
  const base = title.replace(/[\\/:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || `${platform}-video`;
  return `爆款·${PLATFORM_LABEL[platform] ?? platform}·${base}.mp4`;
}

function runFfmpeg(args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    if (!ffmpegBin) { resolve(false); return; }
    const p = spawn(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'ignore'] });
    p.on('error', () => resolve(false));
    p.on('close', code => resolve(code === 0));
  });
}

async function extractPoster(videoPath: string, outPath: string, atSec = 1): Promise<boolean> {
  const ok = await runFfmpeg(['-ss', String(atSec), '-i', videoPath, '-frames:v', '1', '-q:v', '3', '-y', outPath]);
  return ok && fs.existsSync(outPath);
}

async function probeDuration(videoPath: string): Promise<number> {
  return new Promise(resolve => {
    if (!ffmpegBin) { resolve(0); return; }
    const p = spawn(ffmpegBin, ['-hide_banner', '-i', videoPath, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', chunk => { stderr += chunk.toString(); });
    p.on('error', () => resolve(0));
    p.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) { resolve(0); return; }
      resolve(Math.round(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])));
    });
  });
}

function decodeHtml(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(Number(num)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}
