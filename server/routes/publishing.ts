import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { callLLM } from '../agents/llm.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { getBestTimeScores } from '../publishing/bestTime.js';
import { createTrackedPostDraft, type PostRecord } from '../publishing/waLink.js';
import { store } from '../storage/index.js';

export const publishingRouter = Router();

type PlatformCopy = {
  title?: string;
  description?: string;
  caption?: string;
  text?: string;
  tags?: string[];
  hashtags?: string[];
  firstComment?: string;
};

interface RecycleListRecord {
  id: string;
  tenant_id: string;
  name: string;
  enabled?: boolean;
  items?: Array<{ contentId: string; paused?: boolean; title?: string; coverUrl?: string }>;
  slots?: Array<{ weekday: number; time: string; platforms: string[] }>;
  refresh_mode?: 'copy' | 'copy_cover' | 'copy_cover_hook';
  cursor?: number;
  created?: string;
  updated?: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number {
  const next = Number(value || 0);
  return Number.isFinite(next) ? next : 0;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function publicPost(post: PostRecord) {
  const stats = parseJson<Record<string, unknown>>(post.stats, {});
  return {
    id: post.id,
    tenantId: post.tenant_id,
    contentId: text(post.content_id),
    platform: text(post.platform),
    platformPostId: text(post.platform_post_id),
    title: text(post.title) || text(post.track_code),
    publishedAt: text(post.published_at || post.created),
    trackCode: text(post.track_code),
    waLink: text(post.wa_link),
    stats,
    status: text(stats.status) || (post.platform_post_id ? 'published' : 'scheduled'),
    coverUrl: text(stats.coverUrl),
    firstComment: text(stats.firstComment),
    warnings: Array.isArray(stats.warnings) ? stats.warnings : [],
    isRecycle: Boolean(stats.isRecycle),
    inquiries: numberValue(post.inquiries),
    deals: numberValue(post.deals),
  };
}

function platformCopyFallback(platform: string, title: string, description: string): PlatformCopy {
  const base = description || title || 'New product update';
  if (platform === 'youtube') {
    return {
      title: title.slice(0, 70) || 'Product update',
      description: `${base}\n\nContact us on WhatsApp for wholesale details.`,
      tags: ['wholesale', 'factory', 'export'],
      firstComment: '#wholesale #factory',
    };
  }
  if (platform === 'tiktok') {
    return {
      caption: `${base.slice(0, 100)} DM us for catalog.`,
      hashtags: ['#wholesale', '#factory', '#export'],
      firstComment: '#wholesale #factory #export',
    };
  }
  if (platform === 'instagram') {
    return {
      caption: `${base}\n\nAsk us for MOQ and catalog.`,
      hashtags: ['#wholesale', '#export'],
      firstComment: '#wholesale #export',
    };
  }
  return {
    text: `${base}\n\nMessage us on WhatsApp for price and MOQ.`,
    hashtags: ['#wholesale', '#factory'],
    firstComment: '',
  };
}

function normalizeCopy(raw: any, platforms: string[], title: string, description: string): Record<string, PlatformCopy> {
  const out: Record<string, PlatformCopy> = {};
  for (const platform of platforms) {
    const value = raw?.[platform] && typeof raw[platform] === 'object' ? raw[platform] : {};
    out[platform] = { ...platformCopyFallback(platform, title, description), ...value };
  }
  return out;
}

publishingRouter.use(requireAuth);

publishingRouter.post('/local-videos', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const encodedName = text(req.headers['x-file-name']);
  let originalName = 'video.mp4';
  try {
    originalName = decodeURIComponent(encodedName || originalName);
  } catch {
    originalName = encodedName || originalName;
  }
  originalName = path.basename(originalName).replace(/[^\w.\-\u4e00-\u9fff]+/g, '-');
  const ext = path.extname(originalName).toLowerCase();
  if (!['.mp4', '.mov', '.webm', '.mkv', '.avi'].includes(ext)) {
    res.status(400).json({ error: '仅支持 mp4、mov、webm、mkv、avi 视频文件' });
    return;
  }
  const maxBytes = Math.max(50, Number(process.env.PUBLISH_UPLOAD_MAX_MB || 2048)) * 1024 * 1024;
  const declaredBytes = Number(req.headers['content-length'] || 0);
  if (declaredBytes > maxBytes) {
    res.status(413).json({ error: `视频不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB` });
    return;
  }
  const tenantFolder = String(tenantId || 'local').replace(/[^\w.-]+/g, '-');
  const outputDir = path.resolve(process.cwd(), 'data', 'publishing-uploads', tenantFolder);
  const outputPath = path.join(outputDir, `${randomUUID()}-${originalName}`);
  fs.mkdirSync(outputDir, { recursive: true });
  let receivedBytes = 0;
  const limiter = async function* (source: AsyncIterable<Buffer>) {
    for await (const chunk of source) {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) throw Object.assign(new Error('video_too_large'), { statusCode: 413 });
      yield chunk;
    }
  };
  try {
    await pipeline(req, limiter, fs.createWriteStream(outputPath));
    if (!receivedBytes) throw new Error('empty_video');
    res.status(201).json({
      ok: true,
      video: { name: originalName, videoPath: outputPath, size: receivedBytes },
    });
  } catch (error: any) {
    try { fs.rmSync(outputPath, { force: true }); } catch { /* ignore */ }
    const status = Number(error?.statusCode) || 400;
    res.status(status).json({ error: error?.message === 'empty_video' ? '视频文件为空' : error?.message === 'video_too_large' ? '视频文件过大' : '视频接收失败' });
  }
});

publishingRouter.get('/best-time', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const platform = text(req.query.platform) || 'tiktok';
  const weekday = Math.max(0, Math.min(6, Number(req.query.weekday ?? new Date().getDay()) || 0));
  res.json({ platform, weekday, scores: getBestTimeScores(tenantId, platform, weekday) });
});

publishingRouter.get('/calendar', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const from = Date.parse(text(req.query.from)) || Date.now() - 7 * 86_400_000;
  const to = Date.parse(text(req.query.to)) || Date.now() + 35 * 86_400_000;
  const result = await store.list<PostRecord>('posts', { where: { tenant_id: tenantId }, perPage: 500, sort: 'published_at' });
  const items = result.items
    .map(publicPost)
    .filter(item => {
      const time = Date.parse(item.publishedAt || '');
      return Number.isFinite(time) && time >= from && time <= to;
    });
  res.json({ items });
});

publishingRouter.post('/calendar', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const scheduledAt = text(req.body?.scheduledAt);
  const platform = text(req.body?.platform) || 'tiktok';
  const title = text(req.body?.title) || 'Untitled content';
  if (!scheduledAt) {
    res.status(400).json({ error: 'scheduled_at_required' });
    return;
  }
  const tracked = await createTrackedPostDraft(tenantId, {
    contentId: text(req.body?.contentId),
    platform,
    title,
    language: text(req.body?.language),
    enabled: req.body?.trackWaLink !== false,
  });
  await store.update('posts', tracked.id, {
    published_at: scheduledAt,
    stats: {
      status: 'scheduled',
      coverUrl: text(req.body?.coverUrl),
      firstComment: text(req.body?.firstComment),
      warnings: [],
    },
  });
  const saved = await store.getById<PostRecord>('posts', tracked.id);
  res.status(201).json({ item: saved ? publicPost(saved) : publicPost(tracked) });
});

publishingRouter.patch('/calendar/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const post = await store.getById<PostRecord>('posts', String(req.params.id));
  if (!post || post.tenant_id !== tenantId) {
    res.status(404).json({ error: 'post_not_found' });
    return;
  }
  if (post.platform_post_id) {
    res.status(409).json({ error: 'published_post_cannot_be_rescheduled' });
    return;
  }
  const scheduledAt = text(req.body?.scheduledAt);
  if (!scheduledAt) {
    res.status(400).json({ error: 'scheduled_at_required' });
    return;
  }
  await store.update('posts', post.id, { published_at: scheduledAt });
  const saved = await store.getById<PostRecord>('posts', post.id);
  res.json({ item: saved ? publicPost(saved) : null });
});

publishingRouter.post('/adapt-copy', async (req, res) => {
  const title = text(req.body?.title);
  const description = text(req.body?.description);
  const language = text(req.body?.language) || 'English';
  const platforms = Array.isArray(req.body?.platforms)
    ? req.body.platforms.map(String).map(text).filter(Boolean)
    : ['youtube', 'tiktok', 'instagram', 'facebook'];
  const single = text(req.body?.platform);
  const targetPlatforms = single ? [single] : platforms;
  const prompt = [
    'Generate platform-native publishing copy as strict JSON only.',
    `Target language: ${language}`,
    `Title: ${title}`,
    `Draft copy: ${description}`,
    'Required keys: youtube, tiktok, instagram, facebook when requested.',
    'youtube: { title <=70 chars, description, tags[], firstComment }',
    'tiktok: { caption <=120 chars, hashtags[], firstComment }',
    'instagram: { caption, hashtags[], firstComment }',
    'facebook: { text, hashtags[], firstComment }',
    'Make every platform different. Put hashtags and wa.me link friendly text in firstComment when useful.',
  ].join('\n');
  try {
    const raw = await callLLM(prompt);
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
    res.json({ copy: normalizeCopy(parsed, targetPlatforms, title, description) });
  } catch {
    res.json({ copy: normalizeCopy({}, targetPlatforms, title, description) });
  }
});

publishingRouter.get('/posts/effects', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<PostRecord>('posts', { where: { tenant_id: tenantId }, perPage: 200, sort: '-published_at' });
  const items = result.items.map(publicPost)
    .sort((a, b) => b.inquiries - a.inquiries || Date.parse(b.publishedAt || '') - Date.parse(a.publishedAt || ''));
  const cutoff = Date.now() - 30 * 86_400_000;
  const recent = items.filter(item => {
    const time = Date.parse(item.publishedAt || '');
    return Number.isFinite(time) && time >= cutoff;
  });
  res.json({
    items,
    summary: {
      posts30d: recent.length,
      inquiries30d: recent.reduce((sum, item) => sum + item.inquiries, 0),
      deals30d: recent.reduce((sum, item) => sum + item.deals, 0),
    },
  });
});

publishingRouter.get('/briefing', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<PostRecord>('posts', { where: { tenant_id: tenantId }, perPage: 50, sort: '-updated' });
  const top = result.items
    .map(publicPost)
    .filter(item => item.inquiries > 0)
    .sort((a, b) => b.inquiries - a.inquiries)[0];
  res.json({ item: top || null });
});

publishingRouter.get('/recycle-lists', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<RecycleListRecord>('recycle_lists', { where: { tenant_id: tenantId }, perPage: 100, sort: '-updated' });
  res.json({ items: result.items });
});

publishingRouter.post('/recycle-lists', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const created = await store.create<RecycleListRecord>('recycle_lists', {
    tenant_id: tenantId,
    name: text(req.body?.name) || 'Recycle list',
    enabled: Boolean(req.body?.enabled),
    items: Array.isArray(req.body?.items) ? req.body.items.slice(0, 60) : [],
    slots: Array.isArray(req.body?.slots) ? req.body.slots : [],
    refresh_mode: text(req.body?.refreshMode || req.body?.refresh_mode) || 'copy',
    cursor: Number(req.body?.cursor || 0) || 0,
  });
  res.status(201).json({ item: created });
});

publishingRouter.patch('/recycle-lists/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const existing = await store.getById<RecycleListRecord>('recycle_lists', String(req.params.id));
  if (!existing || existing.tenant_id !== tenantId) {
    res.status(404).json({ error: 'recycle_list_not_found' });
    return;
  }
  const patch: Record<string, unknown> = {};
  if (req.body?.name !== undefined) patch.name = text(req.body.name);
  if (req.body?.enabled !== undefined) patch.enabled = Boolean(req.body.enabled);
  if (req.body?.items !== undefined) patch.items = Array.isArray(req.body.items) ? req.body.items.slice(0, 60) : [];
  if (req.body?.slots !== undefined) patch.slots = Array.isArray(req.body.slots) ? req.body.slots : [];
  if (req.body?.refreshMode !== undefined || req.body?.refresh_mode !== undefined) patch.refresh_mode = text(req.body.refreshMode || req.body.refresh_mode);
  if (req.body?.cursor !== undefined) patch.cursor = Number(req.body.cursor || 0) || 0;
  await store.update('recycle_lists', existing.id, patch);
  const item = await store.getById<RecycleListRecord>('recycle_lists', existing.id);
  res.json({ item });
});
