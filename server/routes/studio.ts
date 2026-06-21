import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';
import { callLLM } from '../agents/llm.js';
import { buildEnterpriseContext } from './enterprise.js';
import { auth } from '../storage/index.js';
import {
  entitlementGate,
  getTenantSubscription,
  isEntitled,
  isSubscriptionEnforced,
} from '../middleware/subscription.js';
import { signRenderToken } from '../lib/renderToken.js';

/* ──────────────────────────────────────────────────────────────────────────
   Studio 路由 —— 服务于「社媒 / AI 生成内容」混剪工作台
   只负责纯 AI 文本环节（脚本 / 文案 / 封面标题 / 智能选材），无需 PocketBase 鉴权。
   未配置 GEMINI_API_KEY 时自动降级为本地生成，接口始终可用。
─────────────────────────────────────────────────────────────────────────── */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTERPRISE_FILE = path.join(__dirname, '../../data/enterprise.json');

function enterpriseCtx(): string {
  try {
    return buildEnterpriseContext(JSON.parse(fs.readFileSync(ENTERPRISE_FILE, 'utf8')));
  } catch {
    return '';
  }
}

const LANG_NAME: Record<string, string> = {
  en: 'English', es: 'Spanish', ar: 'Arabic', zh: 'Chinese',
  fr: 'French', de: 'German', pt: 'Portuguese', ru: 'Russian',
  ja: 'Japanese', ko: 'Korean',
};

function langName(code: string): string {
  return LANG_NAME[code] ?? 'English';
}

/** 从 LLM 输出里抽取第一个 JSON（对象或数组） */
function extractJSON<T>(text: string): T | null {
  const match = text.match(/[[{][\s\S]*[\]}]/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

export const studioRouter = Router();

/* ── 订阅状态查询 ──────────────────────────────────────────────────────────
   放在收费墙之前：即使未订阅，用户/客户端也要能查到自己的状态与原因。
   返回 entitled，供桌面客户端在合成前判断是否放行。
─────────────────────────────────────────────────────────────────────────── */
// GET /studio/subscription → { ok, enforced, entitled, status, plan, expiresAt }
studioRouter.get('/subscription', async (req, res) => {
  const enforced = isSubscriptionEnforced();

  // 未启用强制：一律视为有权限（保持开放）
  if (!enforced) {
    res.json({ ok: true, enforced: false, entitled: true, status: 'active', plan: null, expiresAt: null });
    return;
  }

  const result = await auth.verifyToken(req.headers.authorization);
  if (!result) {
    res.status(401).json({ ok: false, enforced: true, entitled: false, error: 'Unauthorized' });
    return;
  }

  const sub = await getTenantSubscription(result.tenantId);
  res.json({
    ok: true,
    enforced: true,
    entitled: isEntitled(sub),
    status: sub.status,
    plan: sub.plan,
    expiresAt: sub.expiresAt,
  });
});

/* 收费墙：以下所有 AI / 渲染路由都需有效订阅（未启用强制时直通）。 */
studioRouter.use(entitlementGate());

/* ── ③ 口播脚本 ────────────────────────────────────────────────────────── */
// POST /studio/script  Body: { materials?, productInfo?, language?, platform?, duration? }
studioRouter.post('/script', async (req, res) => {
  const { materials = [], productInfo = '', language = 'en', platform = 'tiktok', duration = 20, scriptType = 'voiceover' } = req.body ?? {};
  const lang = langName(language);
  const clips = (materials as string[]).join(', ') || '(generic product clips)';
  const product = productInfo || '(use the enterprise profile)';

  const prompt = scriptType === 'storyboard'
    ? `You are a short-video director for a Chinese cross-border (overseas) e-commerce seller.
Write a ${duration}-second ${platform} storyboard in ${lang}, broken into 4-6 scenes.

Selected clips: ${clips}
Product info: ${product}

For EACH scene use this exact block format (no markdown symbols):
Scene N (start-end s)
Shot: <close-up/medium/wide> | Camera: <static/push/pan>
Visual: <what's on screen>
Voiceover: <spoken line>

Strong scroll-stopping opener; clear ending with a call to action. Output ONLY the storyboard.`
    : `You are a short-video copywriter for a Chinese cross-border (overseas) e-commerce seller.
Write a ${duration}-second ${platform} voiceover script in ${lang}.

Selected clips: ${clips}
Product info: ${product}

Requirements:
- Exactly three sections, each on its own block, labelled like "[Hook · 0-3s]", "[Body · 3-${duration - 5}s]", "[CTA · ${duration - 5}-${duration}s]".
- A scroll-stopping hook in the first 3 seconds.
- Punchy, spoken, conversion-oriented. No markdown symbols.
- Output ONLY the script text.`;

  try {
    const text = await callLLM(prompt, { systemPrompt: enterpriseCtx() || undefined });
    res.json({ ok: true, source: 'ai', script: text.trim() });
  } catch {
    res.json({ ok: true, source: 'fallback', script: scriptType === 'storyboard' ? fallbackStoryboard(duration) : fallbackScript(productInfo, duration) });
  }
});

/* ── ⑤ 封面标题候选 ────────────────────────────────────────────────────── */
// POST /studio/covers  Body: { script?, productInfo?, language? }
studioRouter.post('/covers', async (req, res) => {
  const { script = '', productInfo = '', language = 'en' } = req.body ?? {};
  const lang = langName(language);

  const prompt = `Generate 3 punchy ${lang} video cover titles (max 6 words each) for an overseas e-commerce short video.
Context — product: ${productInfo || '(see enterprise profile)'} ; script: ${script.slice(0, 300)}
Return ONLY a JSON array of 3 strings. No other text.`;

  try {
    const text = await callLLM(prompt, { systemPrompt: enterpriseCtx() || undefined });
    const arr = extractJSON<string[]>(text);
    if (arr && arr.length) {
      res.json({ ok: true, source: 'ai', covers: arr.slice(0, 3) });
      return;
    }
    throw new Error('parse');
  } catch {
    res.json({ ok: true, source: 'fallback', covers: FALLBACK_COVERS });
  }
});

/* ── ⑦ 发布文案 + 话题标签 ─────────────────────────────────────────────── */
// POST /studio/caption  Body: { script?, productInfo?, platform?, language? }
studioRouter.post('/caption', async (req, res) => {
  const { script = '', productInfo = '', platform = 'tiktok', language = 'en' } = req.body ?? {};
  const lang = langName(language);

  const prompt = `Write a ${platform} post caption in ${lang} for this overseas e-commerce video.
Product: ${productInfo || '(see enterprise profile)'} ; script: ${script.slice(0, 300)}
Return ONLY JSON: { "caption": string (1-2 sentences, may include 1-2 emojis), "hashtags": string[] (5-8 trending tags, no # prefix) }`;

  try {
    const text = await callLLM(prompt, { systemPrompt: enterpriseCtx() || undefined });
    const obj = extractJSON<{ caption: string; hashtags: string[] }>(text);
    if (obj?.caption) {
      res.json({ ok: true, source: 'ai', caption: obj.caption, hashtags: obj.hashtags ?? [] });
      return;
    }
    throw new Error('parse');
  } catch {
    res.json({ ok: true, source: 'fallback', caption: FALLBACK_CAPTION, hashtags: FALLBACK_TAGS });
  }
});

/* ── ② AI 智能选材 ─────────────────────────────────────────────────────── */
// POST /studio/select  Body: { materials: {id,name,type,duration}[], duration? }
studioRouter.post('/select', async (req, res) => {
  const { materials = [], duration = 20 } = req.body ?? {};
  const list = materials as { id: string; name: string; type: string; duration: number }[];

  const prompt = `From the clip library below, pick and order the best clips to build a ${duration}s product short video.
Prefer a strong opener, varied shots, and a clear ending. Keep total length close to ${duration}s.
Clips: ${JSON.stringify(list)}
Return ONLY JSON: { "selectedIds": string[] (ordered), "reason": string (one short sentence) }`;

  try {
    const text = await callLLM(prompt, { systemPrompt: enterpriseCtx() || undefined });
    const obj = extractJSON<{ selectedIds: string[]; reason: string }>(text);
    const valid = obj?.selectedIds?.filter(id => list.some(c => c.id === id));
    if (valid && valid.length) {
      res.json({ ok: true, source: 'ai', selectedIds: valid, reason: obj!.reason ?? '' });
      return;
    }
    throw new Error('parse');
  } catch {
    res.json({ ok: true, source: 'fallback', ...fallbackSelect(list, duration) });
  }
});

/* ── ⑥ 成片合成（渲染授权）─────────────────────────────────────────────────
   合成在客户端本机用原生 ffmpeg 完成（桌面端）。服务器只负责「授权」：
   下发 ① 合成所需原料清单（manifest：脚本 / 片段时间轴 / 配音 / 封面 / BGM 的
   URL）② 一个短期签名令牌。客户端凭 manifest 本地拼接出 MP4。
   注：配音(TTS)/封面出图/BGM 曲库尚未实现，相关 url 暂为 null，桌面端用占位合成；
   接入后只需把对应 url 填上，对外契约不变。
─────────────────────────────────────────────────────────────────────────── */

interface RenderSpec {
  materials?: string[];
  script?: string;
  voice?: string;
  bgm?: string;
  bgmVol?: number;
  coverId?: string;
  coverTitle?: string;
  ratio?: string;
  duration?: number;
  platform?: string;
  language?: string;
}

interface RenderManifest {
  jobId: string;
  spec: { ratio: string; duration: number; platform: string; language: string; bgmVol: number };
  script: string;
  timeline: { index: number; name: string; url: string | null }[];
  voiceover: { voice: string | null; url: string | null };
  cover: { id: string | null; title: string; url: string | null };
  bgm: { id: string | null; url: string | null };
}

function buildManifest(jobId: string, spec: RenderSpec): RenderManifest {
  return {
    jobId,
    spec: {
      ratio: spec.ratio || '9:16',
      duration: spec.duration ?? 20,
      platform: spec.platform || 'tiktok',
      language: spec.language || 'en',
      bgmVol: spec.bgmVol ?? 35,
    },
    script: spec.script ?? '',
    timeline: (spec.materials ?? []).map((name, index) => ({ index, name, url: null })),
    voiceover: { voice: spec.voice ?? null, url: null }, // TTS 未接入
    cover: { id: spec.coverId ?? null, title: spec.coverTitle ?? '', url: null }, // 封面出图未接入
    bgm: { id: spec.bgm ?? null, url: null }, // BGM 曲库未接入
  };
}

// POST /studio/render  Body: RenderSpec → { ok, token, expiresAt, manifest }
studioRouter.post('/render', (req, res) => {
  const spec = (req.body ?? {}) as RenderSpec;
  const jobId = randomUUID();
  const manifest = buildManifest(jobId, spec);

  const { token, payload } = signRenderToken({ jti: jobId, ratio: manifest.spec.ratio, duration: manifest.spec.duration });

  res.status(201).json({
    ok: true,
    token,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    manifest,
  });
});

/* ── 草稿 / 作品持久化（平铺 JSON 文件，无需数据库）─────────────────────────
   对应前端「我的草稿 / 我的作品」。save 既可新建也可更新（带 id 即更新）。
─────────────────────────────────────────────────────────────────────────── */

const PROJECTS_FILE = path.join(__dirname, '../../data/studio-projects.json');

interface StudioProject {
  id: string;
  title: string;
  status: 'draft' | 'published';
  spec: Record<string, unknown>;
  thumbSeed?: string;
  createdAt: string;
  updatedAt: string;
}

function loadProjects(): StudioProject[] {
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8')) as StudioProject[];
  } catch {
    return [];
  }
}
function persistProjects(list: StudioProject[]): void {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// GET /studio/projects → 列表（更新时间倒序）
studioRouter.get('/projects', (_req, res) => {
  res.json(loadProjects().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
});

// POST /studio/projects  Body: { id?, title?, status?, spec, thumbSeed? } → 新建或更新
studioRouter.post('/projects', (req, res) => {
  const { id, title, status = 'draft', spec = {}, thumbSeed } = req.body ?? {};
  const list = loadProjects();
  const now = new Date().toISOString();

  if (id) {
    const idx = list.findIndex(p => p.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], title: title ?? list[idx].title, status, spec, thumbSeed, updatedAt: now };
      persistProjects(list);
      res.json({ ok: true, project: list[idx] });
      return;
    }
  }

  const project: StudioProject = {
    id: randomUUID(),
    title: title || '未命名草稿',
    status,
    spec,
    thumbSeed,
    createdAt: now,
    updatedAt: now,
  };
  list.push(project);
  persistProjects(list);
  res.status(201).json({ ok: true, project });
});

// GET /studio/projects/:id → 单个（用于再编辑）
studioRouter.get('/projects/:id', (req, res) => {
  const p = loadProjects().find(x => x.id === req.params.id);
  if (!p) { res.status(404).json({ ok: false, error: 'Project not found' }); return; }
  res.json(p);
});

// DELETE /studio/projects/:id
studioRouter.delete('/projects/:id', (req, res) => {
  const list = loadProjects();
  const next = list.filter(p => p.id !== req.params.id);
  if (next.length === list.length) { res.status(404).json({ ok: false, error: 'Project not found' }); return; }
  persistProjects(next);
  res.json({ ok: true });
});

/* ── 本地降级生成 ──────────────────────────────────────────────────────── */

function fallbackScript(productInfo: string, duration: number): string {
  const p = productInfo || 'this product';
  return `[Hook · 0-3s]
Stop scrolling — this is the one everyone keeps asking about.

[Body · 3-${duration - 5}s]
Straight from our factory, ${p} delivers premium quality at factory-direct prices, shipped worldwide in 24 hours. Thousands of buyers already made the switch.

[CTA · ${duration - 5}-${duration}s]
Tap the link to grab yours before they sell out again.`;
}

function fallbackStoryboard(duration: number): string {
  const mid = Math.round(duration / 2);
  return `Scene 1 (0-3s)
Shot: close-up | Camera: static
Visual: Product hero shot, bright lighting, hands enter frame.
Voiceover: Stop scrolling — you need to see this.

Scene 2 (3-${mid}s)
Shot: medium | Camera: push
Visual: Product in use, before/after comparison.
Voiceover: Factory-direct quality, a fraction of the price.

Scene 3 (${mid}-${duration - 4}s)
Shot: close-up | Camera: pan
Visual: Key feature demo, detail texture.
Voiceover: This is the detail everyone's talking about.

Scene 4 (${duration - 4}-${duration}s)
Shot: wide | Camera: static
Visual: Packaging + brand, link sticker pops in.
Voiceover: Tap the link before they sell out again.`;
}

const FALLBACK_COVERS = ['You NEED this in 2026', 'Factory price, 24h ship', 'Why everyone is obsessed'];
const FALLBACK_CAPTION = 'Factory-direct home essentials shipped worldwide in 24h 🏠✨';
const FALLBACK_TAGS = ['tiktokmademebuyit', 'homefinds', 'amazonfinds', 'smallbusiness', 'viral', 'musthave'];

function fallbackSelect(list: { id: string; type: string; duration: number }[], target: number) {
  // 视频优先、累计接近目标时长
  const ordered = [...list].sort((a, b) => (a.type === 'video' ? -1 : 1) - (b.type === 'video' ? -1 : 1));
  const picked: string[] = [];
  let acc = 0;
  for (const c of ordered) {
    if (acc >= target) break;
    picked.push(c.id);
    acc += c.type === 'image' ? 3 : c.duration;
  }
  return { selectedIds: picked.length ? picked : list.slice(0, 3).map(c => c.id), reason: '按视频优先、贴合目标时长自动选取' };
}
