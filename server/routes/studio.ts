import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { GoogleGenAI } from '@google/genai';
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
import { consumeDemoQuota } from '../lib/demo.js';

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
  en: 'English', zh: 'Chinese (Simplified)', es: 'Spanish', fr: 'French',
  de: 'German', pt: 'Portuguese', it: 'Italian', ru: 'Russian',
  ja: 'Japanese', ko: 'Korean', ar: 'Arabic', hi: 'Hindi',
  id: 'Indonesian', th: 'Thai', vi: 'Vietnamese', tr: 'Turkish',
  nl: 'Dutch', pl: 'Polish', sv: 'Swedish', fil: 'Filipino',
  ms: 'Malay', uk: 'Ukrainian', el: 'Greek', cs: 'Czech',
  ro: 'Romanian', hu: 'Hungarian',
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
  if (!await consumeDemoQuota(req, res, 'generation')) return;
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
  if (!await consumeDemoQuota(req, res, 'generation')) return;
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
  if (!await consumeDemoQuota(req, res, 'generation')) return;
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

/* ── 文本翻译（默认译成简体中文，给用户确认外语文案） ───────────────────── */
// POST /studio/translate  Body: { text, target?, source? }
studioRouter.post('/translate', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { text = '', target = 'zh' } = req.body ?? {};
  const src = String(text).trim();
  if (!src) { res.json({ ok: true, source: 'noop', text: '' }); return; }
  const targetLang = langName(target);

  const prompt = `Translate the following text into ${targetLang}. Return ONLY the translation, no quotes, no explanation.
Text: ${src}`;

  try {
    const out = await callLLM(prompt);
    res.json({ ok: true, source: 'ai', text: out.trim() });
  } catch {
    res.json({ ok: false, source: 'fallback', text: '' });
  }
});

/* ── 数据看板 AI 结论 ──────────────────────────────────────────────────── */
// POST /studio/insight  Body: { scope, metrics } → { summary, actions[] }
studioRouter.post('/insight', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { scope = 'traffic', metrics = {} } = req.body ?? {};
  const prompt = `你是跨境电商社媒操盘手。根据以下「${scope}」当期数据（JSON），给运营一句中文洞察 + 2-3 条可执行建议。
数据：${JSON.stringify(metrics)}
只返回 JSON：{ "summary": string（一句话核心结论，≤40 字）, "actions": string[]（2-3 条，每条≤18 字，动词开头，具体到内容方向/平台/语言/投流） }`;
  try {
    const text = await callLLM(prompt, { systemPrompt: enterpriseCtx() || undefined });
    const obj = extractJSON<{ summary: string; actions: string[] }>(text);
    if (obj?.summary) {
      res.json({ ok: true, source: 'ai', summary: obj.summary, actions: (obj.actions ?? []).slice(0, 3) });
      return;
    }
    throw new Error('parse');
  } catch {
    res.json({ ok: true, source: 'fallback', summary: '', actions: [] });
  }
});

/* ── ② AI 智能选材 ─────────────────────────────────────────────────────── */
// POST /studio/select  Body: { materials: {id,name,type,duration}[], duration? }
studioRouter.post('/select', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
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

interface SubCue { start: number; end: number; text: string; zh?: string }
interface SubtitleSpec { mode: 'off' | 'target' | 'bilingual'; cues: SubCue[]; style: Record<string, unknown> }

interface RenderSpec {
  materials?: string[];
  script?: string;
  voice?: string;
  bgm?: string;
  bgmVol?: number;
  coverId?: string;
  coverTitle?: string;
  coverUrl?: string; // 前端封面步生成的 /covers/xxx.svg
  ratio?: string;
  duration?: number;
  platform?: string;
  language?: string;
  voiceoverUrl?: string; // 前端在脚本步生成配音后回传的 /tts/xxx.wav
  subtitles?: SubtitleSpec; // 字幕轨：桌面端 ffmpeg 按 cue 烧录
}

interface RenderManifest {
  jobId: string;
  spec: { ratio: string; duration: number; platform: string; language: string; bgmVol: number };
  script: string;
  timeline: { index: number; name: string; url: string | null }[];
  voiceover: { voice: string | null; url: string | null };
  cover: { id: string | null; title: string; url: string | null };
  bgm: { id: string | null; url: string | null };
  subtitles?: SubtitleSpec;
}

function buildManifest(jobId: string, spec: RenderSpec, base: string): RenderManifest {
  // 选中素材按名称映射到素材库的真实 URL（已上传的给绝对地址，ffmpeg 可直接拉取）
  const urlByName = new Map(loadMaterials().map(m => [m.name, m.url]));
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
    timeline: (spec.materials ?? []).map((name, index) => {
      const rel = urlByName.get(name);
      return { index, name, url: rel ? `${base}${rel}` : null }; // 库里有真实文件→真实 URL，否则 null（mock 占位素材）
    }),
    voiceover: { voice: spec.voice ?? null, url: spec.voiceoverUrl ? `${base}${spec.voiceoverUrl}` : null },
    cover: { id: spec.coverId ?? null, title: spec.coverTitle ?? '', url: spec.coverUrl ? `${base}${spec.coverUrl}` : null },
    bgm: (() => {
      const track = spec.bgm ? loadBgm().find(t => t.id === spec.bgm) : null;
      return { id: spec.bgm ?? null, url: track ? `${base}${track.url}` : null };
    })(),
    subtitles: spec.subtitles && spec.subtitles.mode !== 'off' ? spec.subtitles : undefined,
  };
}

// POST /studio/render  Body: RenderSpec → { ok, token, expiresAt, manifest }
studioRouter.post('/render', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'render')) return;
  const spec = (req.body ?? {}) as RenderSpec;
  const jobId = randomUUID();
  const base = `${req.protocol}://${req.get('host')}`;
  const manifest = buildManifest(jobId, spec, base);

  const { token, payload } = signRenderToken({ jti: jobId, ratio: manifest.spec.ratio, duration: manifest.spec.duration });

  res.status(201).json({
    ok: true,
    token,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    manifest,
  });
});

/* ── 素材库（本地磁盘存储，无需 R2）───────────────────────────────────────
   文件存 data/media/，索引存 data/materials.json，由 index.ts 静态托管 /media/*。
   渲染时 buildManifest 按名称把选中素材映射到这里的真实 URL。
─────────────────────────────────────────────────────────────────────────── */

const MEDIA_DIR = path.join(__dirname, '../../data/media');
const MATERIALS_FILE = path.join(__dirname, '../../data/materials.json');

interface Material {
  id: string;
  name: string;
  folder: string;
  type: 'video' | 'image' | 'audio';
  duration: number; // 秒，图片为 0
  size: string;
  file: string;     // data/media 下的文件名
  url: string;      // /media/<file>
  poster?: string;  // 封面用的帧画面：视频抽首帧，图片即自身
  scope: 'shared' | 'own'; // shared=公共库（运营预置），own=用户自己上传
  createdAt: string;
}

const ffmpegBin = ffmpegStatic as unknown as string | null;

/** 跑一条 ffmpeg 命令，成功返回 true */
function runFfmpeg(args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    if (!ffmpegBin) { resolve(false); return; }
    const p = spawn(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'ignore'] });
    p.on('error', () => resolve(false));
    p.on('close', code => resolve(code === 0));
  });
}

/** 用 ffmpeg 从视频抽一帧存成 JPG（封面候选用）。无 ffmpeg 或失败返回 false */
async function extractPoster(videoPath: string, outPath: string, atSec = 1): Promise<boolean> {
  const ok = await runFfmpeg(['-ss', String(atSec), '-i', videoPath, '-frames:v', '1', '-q:v', '3', '-y', outPath]);
  return ok && fs.existsSync(outPath);
}

/* 公共库种子：首次无公共素材时用 ffmpeg 生成几条示例资产（图片/短视频），幂等 */
const SHARED_SEED: { id: string; name: string; folder: string; type: 'image' | 'video'; c0: string; c1: string }[] = [
  { id: 'sh-warm',   name: '示例·暖阳渐变', folder: 'sample', type: 'image', c0: '0xfbbf24', c1: '0xd97706' },
  { id: 'sh-blue',   name: '示例·静谧蓝',   folder: 'sample', type: 'image', c0: '0x60a5fa', c1: '0x1e3a8a' },
  { id: 'sh-stripe', name: '示例·流光条纹', folder: 'sample', type: 'video', c0: '0x16a34a', c1: '0x064e3b' },
];
let sharedSeeded = false;
async function ensureSharedSeed(): Promise<void> {
  if (sharedSeeded) return;
  const list = loadMaterials();
  if (list.some(m => m.scope === 'shared') || !ffmpegBin) { sharedSeeded = true; return; }
  try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); } catch { /* ignore */ }

  const added: Material[] = [];
  for (const s of SHARED_SEED) {
    if (s.type === 'image') {
      const file = `${s.id}.jpg`;
      const ok = await runFfmpeg(['-f', 'lavfi', '-i', `gradients=s=1080x1920:c0=${s.c0}:c1=${s.c1}:type=linear`, '-frames:v', '1', '-y', path.join(MEDIA_DIR, file)]);
      if (!ok) continue;
      added.push({ id: s.id, name: s.name, folder: s.folder, type: 'image', duration: 0, size: humanSize(fs.statSync(path.join(MEDIA_DIR, file)).size), file, url: `/media/${file}`, poster: `/media/${file}`, scope: 'shared', createdAt: new Date().toISOString() });
    } else {
      const file = `${s.id}.mp4`;
      const ok = await runFfmpeg(['-f', 'lavfi', '-i', `gradients=s=1080x1920:c0=${s.c0}:c1=${s.c1}:type=linear:d=4:r=24`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', '4', '-y', path.join(MEDIA_DIR, file)]);
      if (!ok) continue;
      const posterFile = `${s.id}.poster.jpg`;
      const pok = await extractPoster(path.join(MEDIA_DIR, file), path.join(MEDIA_DIR, posterFile), 1);
      added.push({ id: s.id, name: s.name, folder: s.folder, type: 'video', duration: 4, size: humanSize(fs.statSync(path.join(MEDIA_DIR, file)).size), file, url: `/media/${file}`, poster: pok ? `/media/${posterFile}` : undefined, scope: 'shared', createdAt: new Date().toISOString() });
    }
  }
  if (added.length) persistMaterials([...loadMaterials(), ...added]);
  sharedSeeded = true;
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

// GET /studio/materials?scope=shared|own → Material[]（按上传时间倒序）
studioRouter.get('/materials', async (req, res) => {
  await ensureSharedSeed();
  const scope = req.query.scope as string | undefined;
  let list = loadMaterials();
  if (scope === 'shared' || scope === 'own') list = list.filter(m => (m.scope ?? 'own') === scope);
  res.json(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

// POST /studio/materials  Body: { name, folder?, type, duration?, dataBase64, mimeType?, scope? } → 上传单个文件
studioRouter.post('/materials', async (req, res) => {
  const { name, folder = 'upload', type, duration = 0, dataBase64, mimeType, scope = 'own' } = req.body ?? {};
  if (!dataBase64 || !type) { res.status(400).json({ ok: false, error: 'dataBase64 and type required' }); return; }
  if (!['video', 'image', 'audio'].includes(type)) { res.status(400).json({ ok: false, error: 'invalid type' }); return; }

  try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); } catch { /* ignore */ }

  const id = randomUUID();
  const extFromMime = (mimeType as string | undefined)?.split('/')[1]?.replace('quicktime', 'mov');
  const ext = extFromMime || (type === 'image' ? 'jpg' : type === 'audio' ? 'mp3' : 'mp4');
  const file = `${id}.${ext}`;
  const buf = Buffer.from(String(dataBase64).replace(/^data:[^,]+,/, ''), 'base64');
  fs.writeFileSync(path.join(MEDIA_DIR, file), buf);

  // 封面用帧画面：视频抽首帧（≈1s 处，太短则取 0），图片用自身，音频无
  let poster: string | undefined;
  if (type === 'image') {
    poster = `/media/${file}`;
  } else if (type === 'video') {
    const posterFile = `${id}.poster.jpg`;
    const at = (Number(duration) || 0) > 1 ? 1 : 0;
    const ok = await extractPoster(path.join(MEDIA_DIR, file), path.join(MEDIA_DIR, posterFile), at);
    if (ok) poster = `/media/${posterFile}`;
  }

  const material: Material = {
    id,
    name: name || file,
    folder,
    type,
    duration: Number(duration) || 0,
    size: humanSize(buf.length),
    file,
    url: `/media/${file}`,
    poster,
    scope: scope === 'shared' ? 'shared' : 'own',
    createdAt: new Date().toISOString(),
  };
  const list = loadMaterials();
  list.push(material);
  persistMaterials(list);
  res.status(201).json({ ok: true, material });
});

// DELETE /studio/materials/:id
studioRouter.delete('/materials/:id', (req, res) => {
  const list = loadMaterials();
  const m = list.find(x => x.id === req.params.id);
  if (!m) { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
  try { fs.unlinkSync(path.join(MEDIA_DIR, m.file)); } catch { /* file may be gone */ }
  if (m.poster && m.poster !== m.url) { try { fs.unlinkSync(path.join(MEDIA_DIR, path.basename(m.poster))); } catch { /* ignore */ } }
  persistMaterials(list.filter(x => x.id !== req.params.id));
  res.json({ ok: true });
});

/* ── ⑤ 封面图层（零依赖 SVG，作发布缩略图）─────────────────────────────────
   按标题 + 配色（或选中的图片素材作底图）生成一张 9:16 / 1:1 / 16:9 的 SVG 封面，
   浏览器原生渲染、CJK/emoji 可显。作为发布缩略图，ffmpeg 不参与，零栅格化依赖。
─────────────────────────────────────────────────────────────────────────── */

const COVERS_DIR = path.join(__dirname, '../../data/covers');

function coverResolution(ratio: string): [number, number] {
  if (ratio === '1:1') return [1080, 1080];
  if (ratio === '16:9') return [1920, 1080];
  return [1080, 1920];
}
function xmlEscape(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));
}
/** 把 hex 颜色按比例压暗，用于生成渐变的暗色端 */
function darken(hex: string, k = 0.62): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#b45309';
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
/** 按每行字符预算把标题贪心折成 ≤3 行 */
function wrapTitle(title: string, perLine: number): string[] {
  const words = String(title).trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur.length + 1 + w.length) > perLine) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
    if (lines.length === 2 && cur.length > perLine) break;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

type CoverFont = 'sans' | 'impact' | 'serif' | 'rounded' | 'mono';
interface CoverStyle { color: string; size: 'S' | 'M' | 'L'; position: 'top' | 'center' | 'bottom'; align: 'left' | 'center'; font: CoverFont }

// 字体栈用系统字体（SVG 经 <img> 加载无法用网页字体），均带 CJK 回退
const COVER_FONT_STACK: Record<CoverFont, string> = {
  sans:    `'Arial Unicode MS','PingFang SC','Microsoft YaHei',sans-serif`,
  impact:  `'Arial Black','Impact','Heiti SC','Microsoft YaHei',sans-serif`,
  serif:   `'Songti SC','SimSun','Times New Roman',serif`,
  rounded: `'Arial Rounded MT Bold','PingFang SC','Microsoft YaHei',sans-serif`,
  mono:    `'Menlo','Consolas','DejaVu Sans Mono',monospace`,
};

function buildCoverSvg(opts: { title: string; ratio: string; accent: string; bgImageUrl?: string } & Partial<CoverStyle>): string {
  const [w, h] = coverResolution(opts.ratio);
  const c0 = opts.accent || '#d97706';
  const c1 = darken(c0);
  const color = opts.color || '#ffffff';
  const size = opts.size || 'M';
  const position = opts.position || 'bottom';
  const align = opts.align || 'left';
  const fontStack = COVER_FONT_STACK[opts.font || 'sans'] || COVER_FONT_STACK.sans;
  const weight = opts.font === 'serif' ? 700 : 800;

  const scale = size === 'S' ? 0.062 : size === 'L' ? 0.098 : 0.078;
  const fontSize = Math.round(w * scale);
  const lineH = Math.round(fontSize * 1.18);
  const pad = Math.round(w * 0.045);
  const lines = wrapTitle(opts.title || '', Math.floor(w / (fontSize * 0.6)));
  const totalH = (lines.length - 1) * lineH;

  const firstBaseline =
    position === 'top' ? Math.round(h * 0.1) + fontSize
    : position === 'center' ? Math.round((h - totalH) / 2)
    : h - Math.round(h * 0.06) - totalH;

  const anchor = align === 'center' ? 'middle' : 'start';
  const tx = align === 'center' ? Math.round(w / 2) : pad;

  const bg = opts.bgImageUrl
    ? `<image href="${xmlEscape(opts.bgImageUrl)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="${w}" height="${h}" fill="url(#g)"/>`;

  const half = Math.round(h * 0.5);
  const scrim =
    position === 'top' ? `<rect x="0" y="0" width="${w}" height="${half}" fill="url(#scrimT)"/>`
    : position === 'center' ? `<rect width="${w}" height="${h}" fill="#000" fill-opacity="0.3"/>`
    : `<rect x="0" y="${half}" width="${w}" height="${half}" fill="url(#scrimB)"/>`;

  const texts = lines.map((ln, i) =>
    `<text x="${tx}" y="${firstBaseline + i * lineH}" text-anchor="${anchor}" font-family="${fontStack}" font-size="${fontSize}" font-weight="${weight}" fill="${color}" paint-order="stroke" stroke="#000" stroke-opacity="0.25" stroke-width="${Math.round(fontSize * 0.04)}">${xmlEscape(ln)}</text>`
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient>
<linearGradient id="scrimB" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.7"/></linearGradient>
<linearGradient id="scrimT" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.7"/><stop offset="0.55" stop-color="#000" stop-opacity="0"/></linearGradient>
</defs>
${bg}
${scrim}
${texts}
</svg>`;
}

/** 把本地 /media 帧文件读成 data URI 内嵌进 SVG（SVG 经 <img> 加载时无法引用外部图片） */
function inlineFrame(bgImageUrl?: string): string | undefined {
  if (!bgImageUrl) return undefined;
  try {
    const local = path.join(MEDIA_DIR, path.basename(bgImageUrl.split('?')[0]));
    if (!fs.existsSync(local)) return undefined;
    const ext = path.extname(local).slice(1).toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(local).toString('base64')}`;
  } catch { return undefined; }
}

// POST /studio/cover  Body: { title, ratio?, accent?, bgImageUrl?, color?, size?, position?, align? } → { ok, url }
studioRouter.post('/cover', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { title = '', ratio = '9:16', accent = '#d97706', bgImageUrl, color, size, position, align, font } = req.body ?? {};
  try {
    fs.mkdirSync(COVERS_DIR, { recursive: true });
    const file = `${randomUUID()}.svg`;
    const dataUri = inlineFrame(bgImageUrl); // 有真实帧就内嵌，否则用渐变底
    fs.writeFileSync(path.join(COVERS_DIR, file), buildCoverSvg({ title, ratio, accent, bgImageUrl: dataUri, color, size, position, align, font }), 'utf8');
    res.json({ ok: true, url: `/covers/${file}`, hasFrame: !!dataUri });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/* ── 配音 TTS（Gemini 语音合成 → WAV，本地托管）────────────────────────────
   把脚本里的"口语内容"抽出来送 Gemini TTS，得到 24kHz PCM，封成 WAV 存 data/tts/。
   渲染时由 buildManifest 映射成 voiceover.url，桌面端 ffmpeg 把它压过 BGM 混进成片。
─────────────────────────────────────────────────────────────────────────── */

const TTS_DIR = path.join(__dirname, '../../data/tts');

// 工作台 4 个音色 → Gemini 预置嗓音
const TTS_VOICE_MAP: Record<string, string> = {
  v1: 'Kore',    // 女声 · 亲和
  v2: 'Charon',  // 男声 · 沉稳
  v3: 'Aoede',   // 女声 · 温暖
};

/** 从脚本里提取可朗读的口语文本（去掉 [Hook]、Scene、Shot/Camera/Visual 等标注） */
function spokenText(script: string): string {
  const out: string[] = [];
  for (let line of String(script || '').split('\n')) {
    line = line.trim();
    if (!line) continue;
    if (/^\[.*\]$/.test(line)) continue;
    if (/^scene\s*\d/i.test(line)) continue;
    const vo = line.match(/^(voiceover|vo)\s*[:：]\s*(.+)$/i);
    if (vo) { out.push(vo[2]); continue; }
    if (/^(shot|camera|visual|画面|镜头|运镜|景别)\s*[:：]/i.test(line)) continue;
    out.push(line);
  }
  return out.join(' ').slice(0, 1500);
}

/** PCM(16-bit LE) → WAV 容器 */
function wavFromPcm(pcm: Buffer, sampleRate: number, channels = 1, bits = 16): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bits / 8, 28);
  header.writeUInt16LE(channels * bits / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// POST /studio/tts  Body: { script?, text?, voice?, language? } → { ok, url, duration }
studioRouter.post('/tts', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { script = '', text = '', voice = 'v1' } = req.body ?? {};
  const spoken = (text || spokenText(script)).trim();
  if (!spoken) { res.status(400).json({ ok: false, error: 'no spoken text' }); return; }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { res.json({ ok: false, source: 'fallback', error: 'GEMINI_API_KEY not set' }); return; }

  const voiceName = TTS_VOICE_MAP[voice] || 'Kore';
  try {
    const ai = new GoogleGenAI({ apiKey });
    const r = await ai.models.generateContent({
      model: process.env.GEMINI_TTS_MODEL ?? 'gemini-2.5-flash-preview-tts',
      contents: spoken,
      config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
    } as any);
    const b64 = (r as any).candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64) throw new Error('no audio in response');

    const pcm = Buffer.from(b64, 'base64');
    const sampleRate = 24000;
    try { fs.mkdirSync(TTS_DIR, { recursive: true }); } catch { /* ignore */ }
    const file = `${randomUUID()}.wav`;
    fs.writeFileSync(path.join(TTS_DIR, file), wavFromPcm(pcm, sampleRate));

    res.json({ ok: true, source: 'ai', url: `/tts/${file}`, duration: Math.round(pcm.length / (sampleRate * 2)) });
  } catch (e: any) {
    res.json({ ok: false, source: 'fallback', error: String(e?.message ?? e).slice(0, 200) });
  }
});

/* ── ④ BGM 曲库（本地磁盘，开箱自带种子曲）─────────────────────────────────
   种子曲用 Node 直接合成 WAV（无需 ffmpeg/外部下载），浏览器可播、ffmpeg 可混音。
   用户也可上传真实音乐。渲染时 buildManifest 把选中 BGM 映射成真实 URL。
─────────────────────────────────────────────────────────────────────────── */

const BGM_DIR = path.join(__dirname, '../../data/bgm');
const BGM_FILE = path.join(__dirname, '../../data/bgm.json');
const BGM_SEED_DUR = 16; // 秒

interface BgmTrack {
  id: string;
  name: string;
  mood: string;
  duration: number;
  file: string;
  url: string;
  recommended?: boolean;
  builtin?: boolean;
  createdAt: string;
}

const BGM_SEED: { id: string; name: string; mood: string; freq: number; beat: number; recommended?: boolean }[] = [
  { id: 'b1', name: 'Upbeat Pop Energy',  mood: '活力 · 快节奏', freq: 330, beat: 2.0, recommended: true },
  { id: 'b2', name: 'Chill Lo-Fi Vibes',  mood: '舒缓 · 治愈',   freq: 220, beat: 0.5 },
  { id: 'b3', name: 'Cinematic Inspire',  mood: '大气 · 高级感', freq: 262, beat: 0.8 },
  { id: 'b4', name: 'Trendy TikTok Beat', mood: '潮流 · 卡点',   freq: 294, beat: 2.6 },
];

/** 合成一段 16kHz/16-bit 单声道 PCM，正弦+谐波叠加 + 节拍包络，输出完整 WAV Buffer */
function synthWav(baseFreq: number, beatHz: number, durationSec: number): Buffer {
  const sampleRate = 16000;
  const n = Math.floor(sampleRate * durationSec);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const beat = 0.35 + 0.65 * Math.abs(Math.sin(Math.PI * beatHz * t));
    const tone =
      Math.sin(2 * Math.PI * baseFreq * t) +
      0.5 * Math.sin(2 * Math.PI * baseFreq * 2 * t) +
      0.25 * Math.sin(2 * Math.PI * baseFreq * 3 * t);
    const s = Math.max(-1, Math.min(1, (tone / 1.75) * beat * 0.5));
    pcm.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);       // PCM
  header.writeUInt16LE(1, 22);       // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byteRate
  header.writeUInt16LE(2, 32);       // blockAlign
  header.writeUInt16LE(16, 34);      // bits
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function loadBgm(): BgmTrack[] {
  try { return JSON.parse(fs.readFileSync(BGM_FILE, 'utf8')) as BgmTrack[]; } catch { return []; }
}
function persistBgm(list: BgmTrack[]): void {
  fs.writeFileSync(BGM_FILE, JSON.stringify(list, null, 2), 'utf8');
}
/** 确保内置种子曲存在（文件缺失则合成，索引缺失则补登记），幂等 */
function ensureBgmSeed(): BgmTrack[] {
  const list = loadBgm();
  try { fs.mkdirSync(BGM_DIR, { recursive: true }); } catch { /* ignore */ }
  let changed = false;
  for (const s of BGM_SEED) {
    const file = `${s.id}.wav`;
    const filePath = path.join(BGM_DIR, file);
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, synthWav(s.freq, s.beat, BGM_SEED_DUR));
    if (!list.some(t => t.id === s.id)) {
      list.push({ id: s.id, name: s.name, mood: s.mood, duration: BGM_SEED_DUR, file, url: `/bgm/${file}`, recommended: s.recommended, builtin: true, createdAt: new Date().toISOString() });
      changed = true;
    }
  }
  if (changed) persistBgm(list);
  return list;
}

// GET /studio/bgm → BgmTrack[]（推荐置顶）
studioRouter.get('/bgm', (_req, res) => {
  res.json(ensureBgmSeed().sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0)));
});

// POST /studio/bgm  Body: { name, mood?, duration?, dataBase64, mimeType? } → 上传真实音乐
studioRouter.post('/bgm', (req, res) => {
  const { name, mood = '自定义', duration = 0, dataBase64, mimeType } = req.body ?? {};
  if (!dataBase64) { res.status(400).json({ ok: false, error: 'dataBase64 required' }); return; }
  try { fs.mkdirSync(BGM_DIR, { recursive: true }); } catch { /* ignore */ }
  const id = randomUUID();
  const ext = (mimeType as string | undefined)?.split('/')[1]?.replace('mpeg', 'mp3') || 'mp3';
  const file = `${id}.${ext}`;
  const buf = Buffer.from(String(dataBase64).replace(/^data:[^,]+,/, ''), 'base64');
  fs.writeFileSync(path.join(BGM_DIR, file), buf);
  const track: BgmTrack = {
    id, name: name || file, mood, duration: Number(duration) || 0, file, url: `/bgm/${file}`, createdAt: new Date().toISOString(),
  };
  const list = ensureBgmSeed();
  list.push(track);
  persistBgm(list);
  res.status(201).json({ ok: true, track });
});

// DELETE /studio/bgm/:id（删内置曲会在下次启动重新播种）
studioRouter.delete('/bgm/:id', (req, res) => {
  const list = loadBgm();
  const t = list.find(x => x.id === req.params.id);
  if (!t) { res.status(404).json({ ok: false, error: 'BGM not found' }); return; }
  try { fs.unlinkSync(path.join(BGM_DIR, t.file)); } catch { /* ignore */ }
  persistBgm(list.filter(x => x.id !== req.params.id));
  res.json({ ok: true });
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
