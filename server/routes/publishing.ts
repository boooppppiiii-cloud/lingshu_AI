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

interface PostingScheduleRecord {
  id: string;
  tenant_id: string;
  platform: string;
  market: string;
  time_zone: string;
  utc_offset: number;
  preset: 'light' | 'standard' | 'high';
  slots: Array<{ weekday: number; time: string }>;
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
    description: text(stats.description),
    publishedAt: text(post.published_at || post.created),
    trackCode: text(post.track_code),
    waLink: text(post.wa_link),
    stats,
    status: text(stats.status) || (post.platform_post_id ? 'published' : 'scheduled'),
    coverUrl: text(stats.coverUrl),
    videoUrl: text(stats.videoUrl || stats.mediaUrl || stats.url),
    duration: numberValue(stats.duration),
    firstComment: text(stats.firstComment),
    videoPath: text(stats.videoPath),
    targetAccountIds: Array.isArray(stats.targetAccountIds) ? stats.targetAccountIds.map(String).map(text).filter(Boolean) : [],
    targetAccountLabels: Array.isArray(stats.targetAccountLabels) ? stats.targetAccountLabels.map(String).map(text).filter(Boolean) : [],
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

function presetSchedule(preset: PostingScheduleRecord['preset'] = 'standard'): Array<{ weekday: number; time: string }> {
  const weekdays = preset === 'light' ? [1, 3, 5] : preset === 'high' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
  return weekdays.map(weekday => ({ weekday, time: '20:00' }));
}

function normalizeScheduleSlots(value: unknown, preset: PostingScheduleRecord['preset']): Array<{ weekday: number; time: string }> {
  if (!Array.isArray(value)) return presetSchedule(preset);
  const slots = value
    .map(slot => ({
      weekday: Math.max(0, Math.min(6, Number(slot?.weekday) || 0)),
      time: /^\d{2}:\d{2}$/.test(text(slot?.time)) ? text(slot?.time) : '20:00',
    }))
    .filter((slot, index, list) => list.findIndex(item => item.weekday === slot.weekday && item.time === slot.time) === index)
    .sort((left, right) => left.weekday - right.weekday || left.time.localeCompare(right.time));
  return slots.length ? slots : presetSchedule(preset);
}

function fallbackQueueSuggestion(input: {
  currentTitle: string;
  feedback: string;
  festival: string;
}): { title: string; brief: string; tags: string[] } {
  const variants = [
    { title: '主推产品：3 个采购决策点', brief: '用买家视角拆解用途、采购关注点和询盘入口，不补写未确认参数。', tags: ['主推品', '采购决策'] },
    { title: '工厂能力：从打样到交付', brief: '展示流程与交付节点，企业资料缺失的部分保持待确认。', tags: ['工厂实力', '交付'] },
    { title: '采购 FAQ：MOQ、定制与样品', brief: '围绕高频询盘组织短内容，引导买家索取目录和报价。', tags: ['采购FAQ', '询盘'] },
    { title: '质量证明：细节、包装与检验', brief: '用可拍摄的细节建立信任，只引用企业中心已有事实。', tags: ['质量', '信任'] },
    { title: '应用场景：买家如何使用这款产品', brief: '从真实使用场景切入，结尾保留清晰的 WhatsApp 询盘动作。', tags: ['场景', '转化'] },
  ];
  const currentIndex = variants.findIndex(item => item.title === input.currentTitle);
  const selected = variants[(currentIndex + 1 + variants.length) % variants.length];
  if (input.feedback) {
    return {
      title: selected.title,
      brief: `${selected.brief} 修改要求：${input.feedback.slice(0, 120)}`,
      tags: selected.tags,
    };
  }
  if (input.festival) {
    return {
      title: `${input.festival}：采购准备清单`,
      brief: '围绕节庆采购窗口组织备货、交付与询盘内容，不虚构折扣或库存。',
      tags: ['节庆', '备货'],
    };
  }
  return selected;
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
  const offsetValue = text(req.query.utcOffset);
  const parsedOffset = offsetValue ? Number(offsetValue) : Number.NaN;
  const utcOffset = Number.isFinite(parsedOffset) ? Math.max(-12, Math.min(14, parsedOffset)) : undefined;
  res.json({
    platform,
    weekday,
    scores: getBestTimeScores(tenantId, platform, weekday, utcOffset),
    source: 'platform_reference',
    confidence: 'reference',
    utcOffset: utcOffset ?? null,
  });
});

publishingRouter.get('/posting-schedule', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const platform = text(req.query.platform) || 'tiktok';
  const result = await store.list<PostingScheduleRecord>('publishing_schedules', {
    where: { tenant_id: tenantId, platform },
    perPage: 1,
    sort: '-updated',
  });
  const item = result.items[0];
  res.json({
    item: item || {
      id: '',
      tenant_id: tenantId,
      platform,
      market: 'global',
      time_zone: 'UTC',
      utc_offset: 0,
      preset: 'standard',
      slots: presetSchedule('standard'),
    },
  });
});

publishingRouter.put('/posting-schedule', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const platform = text(req.body?.platform) || 'tiktok';
  const requestedPreset = text(req.body?.preset);
  const preset: PostingScheduleRecord['preset'] = requestedPreset === 'light' || requestedPreset === 'high' ? requestedPreset : 'standard';
  const next = {
    tenant_id: tenantId,
    platform,
    market: text(req.body?.market) || 'global',
    time_zone: text(req.body?.timeZone || req.body?.time_zone) || 'UTC',
    utc_offset: Math.max(-12, Math.min(14, numberValue(req.body?.utcOffset ?? req.body?.utc_offset))),
    preset,
    slots: normalizeScheduleSlots(req.body?.slots, preset),
  };
  const result = await store.list<PostingScheduleRecord>('publishing_schedules', {
    where: { tenant_id: tenantId, platform },
    perPage: 1,
    sort: '-updated',
  });
  const existing = result.items[0];
  if (existing) {
    await store.update('publishing_schedules', existing.id, next);
    const item = await store.getById<PostingScheduleRecord>('publishing_schedules', existing.id);
    res.json({ item: item || { ...existing, ...next } });
    return;
  }
  const item = await store.create<PostingScheduleRecord>('publishing_schedules', next);
  res.status(201).json({ item: item || { id: '', ...next } });
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
      description: text(req.body?.description),
      firstComment: text(req.body?.firstComment),
      videoPath: text(req.body?.videoPath),
      targetAccountIds: Array.isArray(req.body?.targetAccountIds)
        ? req.body.targetAccountIds.map(String).map(text).filter(Boolean)
        : [],
      targetAccountLabels: Array.isArray(req.body?.targetAccountLabels)
        ? req.body.targetAccountLabels.map(String).map(text).filter(Boolean)
        : [],
      warnings: [],
    },
  });
  const saved = await store.getById<PostRecord>('posts', tracked.id);
  res.status(201).json({ item: saved ? publicPost(saved) : publicPost(tracked) });
});

publishingRouter.delete('/calendar/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const post = await store.getById<PostRecord>('posts', String(req.params.id));
  if (!post || post.tenant_id !== tenantId) {
    res.status(404).json({ error: 'post_not_found' });
    return;
  }
  if (post.platform_post_id) {
    res.status(409).json({ error: 'published_post_cannot_be_removed' });
    return;
  }
  await store.delete('posts', post.id);
  res.status(204).end();
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

publishingRouter.post('/queue/suggestions/regenerate', async (req, res) => {
  const platform = text(req.body?.platform) || 'tiktok';
  const market = text(req.body?.market) || '综合市场';
  const scheduledAt = text(req.body?.scheduledAt);
  const festival = text(req.body?.festival);
  const feedback = text(req.body?.feedback);
  const currentTitle = text(req.body?.currentTitle);
  const fallback = fallbackQueueSuggestion({ currentTitle, feedback, festival });
  const prompt = [
    '你是 B2B 外贸社媒内容排产助手。请只返回严格 JSON。',
    `平台：${platform}`,
    `目标市场：${market}`,
    `建议发布时间：${scheduledAt}`,
    festival ? `关联节庆：${festival}` : '',
    currentTitle ? `当前选题：${currentTitle}` : '',
    feedback ? `老板修改意见：${feedback}` : '',
    '输出字段：title（20字以内）、brief（60字以内）、tags（2个短标签）。',
    '不得虚构企业产品参数、认证、价格、库存、客户案例或优惠；缺失事实用内容结构表达。',
    '选题要适合短视频并自然引导采购商询盘。',
  ].filter(Boolean).join('\n');
  try {
    const raw = await callLLM(prompt);
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
    res.json({
      suggestion: {
        title: text(parsed?.title) || fallback.title,
        brief: text(parsed?.brief) || fallback.brief,
        tags: Array.isArray(parsed?.tags) ? parsed.tags.map(String).map(text).filter(Boolean).slice(0, 3) : fallback.tags,
      },
    });
  } catch {
    res.json({ suggestion: fallback });
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
