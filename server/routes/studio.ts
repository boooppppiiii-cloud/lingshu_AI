import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
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
import { consumeDemoQuota, isDemoMode } from '../lib/demo.js';

/* ──────────────────────────────────────────────────────────────────────────
   Studio 路由 —— 服务于「社媒 / AI 生成内容」混剪工作台
   负责脚本 / 文案 / 封面标题 / 智能选材 / Seedance 视频生成等工作台能力。
   视频生成必须真实调用外部模型；失败时返回明确错误，不生成本地假预览。
─────────────────────────────────────────────────────────────────────────── */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ENTERPRISE_FILE = path.join(__dirname, '../../data/enterprise.json');
const { exportCapcutPackage } = require('../../desktop/render.cjs') as {
  exportCapcutPackage: (payload: unknown) => Promise<{ ok: boolean; dir?: string; error?: string }>;
};

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

const GENERATED_MEDIA_DIR = path.join(__dirname, '../../data/media/generated');
const GEMINI_VIDEO_WORKER = path.join(__dirname, '../../scripts/gemini-video-worker.mjs');
const SEEDANCE_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';

function geminiVideoConfig() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const model = (process.env.GEMINI_VIDEO_MODEL || 'veo-2.0-generate-001').trim();
  return { apiKey, model };
}

function isGeminiVideoEnabled(): boolean {
  return process.env.GEMINI_VIDEO_ENABLED === 'true';
}

function seedanceVideoConfig() {
  const apiKey = (process.env.SEEDANCE_API_KEY || '').trim();
  const baseUrl = (process.env.SEEDANCE_BASE_URL || SEEDANCE_BASE_URL).replace(/\/+$/, '');
  const model = (process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-fast-260128').trim();
  const timeoutMs = Math.max(60_000, Number(process.env.SEEDANCE_VIDEO_TIMEOUT_MS || 600_000));
  const pollIntervalMs = Math.max(2_000, Number(process.env.SEEDANCE_VIDEO_POLL_INTERVAL_MS || 8_000));
  return { apiKey, baseUrl, model, timeoutMs, pollIntervalMs };
}

function isSeedanceVideoEnabled(): boolean {
  return process.env.SEEDANCE_VIDEO_ENABLED === 'true';
}

function normalizeGeminiVideoDuration(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 8;
  // Current Gemini/Veo API accepts only 5-8 seconds for durationSeconds.
  return Math.max(5, Math.min(8, Math.round(n)));
}

function normalizeSeedanceVideoDuration(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 8;
  // Seedance 2.0 supports integer durations from 4 to 15 seconds.
  return Math.max(4, Math.min(15, Math.round(n)));
}

function generatedMediaUrl(file: string): string {
  return `/media/generated/${file}`;
}

async function createGeneratedVideoMaterial(input: {
  title: string;
  filename: string;
  duration: number;
}): Promise<Material | null> {
  const filePath = path.join(GENERATED_MEDIA_DIR, input.filename);
  if (!fs.existsSync(filePath)) return null;
  const id = randomUUID();
  const posterFile = `${id}.poster.jpg`;
  const posterPath = path.join(GENERATED_MEDIA_DIR, posterFile);
  const material: Material = {
    id,
    name: input.title || 'Seedance 生成视频',
    folder: 'upload',
    type: 'video',
    duration: Number(input.duration) || 0,
    size: humanSize(fs.statSync(filePath).size),
    file: `generated/${input.filename}`,
    url: generatedMediaUrl(input.filename),
    scope: 'own',
    createdAt: new Date().toISOString(),
  };
  const posterOk = await extractPoster(filePath, posterPath, material.duration > 1 ? 1 : 0);
  if (posterOk) material.poster = generatedMediaUrl(posterFile);
  const list = loadMaterials().filter(item => item.url !== material.url);
  list.push(material);
  persistMaterials(list);
  return material;
}

async function seedanceFetchJson(url: string, apiKey: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const detail = json?.error?.message || json?.message || json?.error || text || response.statusText;
    throw new Error(`Seedance API ${response.status}: ${String(detail).slice(0, 500)}`);
  }
  return json;
}

function findUrlDeep(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return /^https?:\/\/.+/i.test(value) ? value : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUrlDeep(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['url', 'video_url', 'videoUrl', 'content_url', 'contentUrl']) {
      const found = findUrlDeep(obj[key]);
      if (found) return found;
    }
    for (const item of Object.values(obj)) {
      const found = findUrlDeep(item);
      if (found) return found;
    }
  }
  return null;
}

function seedanceTaskStatus(task: any): string {
  return String(task?.status || task?.data?.status || task?.task?.status || '').toLowerCase();
}

function seedanceTaskId(task: any): string {
  return String(task?.id || task?.data?.id || task?.task?.id || '').trim();
}

function summarizeSeedanceError(error: unknown): string {
  const text = String((error as any)?.message ?? error);
  if (/not activated the model|do not have access|model or endpoint/i.test(text)) {
    return '当前方舟账号尚未开通所选 Seedance 模型服务。请在火山方舟控制台开通 Seedance 2.0 模型，或把 SEEDANCE_MODEL 改成已开通的模型/接入点 ID。';
  }
  if (/api key/i.test(text)) {
    return 'Seedance API Key 无效或不属于当前区域，请检查火山方舟 API Key 和 SEEDANCE_BASE_URL。';
  }
  return text.slice(0, 500);
}

async function waitForSeedanceTask(config: ReturnType<typeof seedanceVideoConfig>, taskId: string): Promise<any> {
  const deadline = Date.now() + config.timeoutMs;
  let lastTask: any = null;
  while (Date.now() < deadline) {
    lastTask = await seedanceFetchJson(`${config.baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`, config.apiKey);
    const status = seedanceTaskStatus(lastTask);
    if (['succeeded', 'success', 'completed', 'done'].includes(status)) return lastTask;
    if (['failed', 'error', 'expired', 'cancelled', 'canceled'].includes(status)) {
      const reason = lastTask?.error?.message || lastTask?.message || lastTask?.error || status;
      throw new Error(`Seedance 任务失败：${String(reason).slice(0, 500)}`);
    }
    await new Promise(resolve => setTimeout(resolve, config.pollIntervalMs));
  }
  throw new Error(`Seedance 任务超时${lastTask ? `，最后状态：${seedanceTaskStatus(lastTask) || 'unknown'}` : ''}`);
}

async function downloadGeneratedVideo(url: string, filename: string): Promise<string> {
  fs.mkdirSync(GENERATED_MEDIA_DIR, { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`视频下载失败：${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(path.join(GENERATED_MEDIA_DIR, filename), Buffer.from(arrayBuffer));
  return generatedMediaUrl(filename);
}

function proxyEnvDefaults() {
  const proxy = process.env.GEMINI_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7890';
  return {
    NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || '1',
    HTTPS_PROXY: process.env.HTTPS_PROXY || proxy,
    HTTP_PROXY: process.env.HTTP_PROXY || proxy,
    https_proxy: process.env.https_proxy || process.env.HTTPS_PROXY || proxy,
    http_proxy: process.env.http_proxy || process.env.HTTP_PROXY || proxy,
  };
}

async function runGeminiVideoWorker(job: Record<string, unknown>, timeoutMs: number) {
  fs.mkdirSync(GENERATED_MEDIA_DIR, { recursive: true });
  const jobFile = path.join(GENERATED_MEDIA_DIR, `gemini-job-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(jobFile, JSON.stringify(job), 'utf8');
  try {
    const result = await new Promise<any>((resolve, reject) => {
      const child = spawn(process.execPath, [GEMINI_VIDEO_WORKER, jobFile], {
        cwd: path.join(__dirname, '../..'),
        env: { ...process.env, ...proxyEnvDefaults() },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Gemini video worker timed out'));
      }, timeoutMs + 30_000);
      child.stdout.on('data', chunk => { stdout += chunk.toString(); });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.on('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', code => {
        clearTimeout(timer);
        const text = stdout.trim();
        if (!text) {
          reject(new Error((stderr || `Gemini video worker exited with code ${code}`).slice(0, 500)));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          const jsonStart = text.lastIndexOf('{"ok"');
          if (jsonStart >= 0) {
            try {
              resolve(JSON.parse(text.slice(jsonStart)));
              return;
            } catch {}
          }
          reject(new Error(`Gemini video worker returned invalid JSON: ${text.slice(0, 300)}`));
        }
      });
    });
    return result;
  } finally {
    try { fs.unlinkSync(jobFile); } catch {}
  }
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

// POST /studio/map-product-columns Body: { headers, sampleRows }
studioRouter.post('/map-product-columns', async (req, res) => {
  const headers = Array.isArray(req.body?.headers) ? req.body.headers.map(String) : [];
  const sampleRows = Array.isArray(req.body?.sampleRows) ? req.body.sampleRows.slice(0, 5) : [];
  if (!headers.length) {
    res.status(400).json({ ok: false, error: 'headers required' });
    return;
  }

  const allowed = new Set(['sku', 'name', 'color', 'size', 'tagPrice', 'material', 'imageUrl', 'highlights', '']);
  try {
    const text = await callLLM(JSON.stringify({ headers, sampleRows }), {
      systemPrompt: `你是 B2B 商品表格字段映射助手。只根据用户给出的表头和前 5 行样本，把客户列名映射到产品 schema。
可用目标字段：
- sku: 货号/款号/SKU/商品编码，用于 upsert 去重
- name: 商品名称
- color: 颜色
- size: 尺码/规格
- tagPrice: 吊牌价/价格
- material: 面料/材质/成分
- imageUrl: 图片 URL/主图链接
- highlights: 一句话卖点/描述
不确定或无关列映射为空字符串。只输出 JSON，不要 markdown。格式：
{"mapping":{"客户列名":"sku"},"notes":"简短说明"}`,
    });
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) as { mapping?: Record<string, unknown>; notes?: unknown } : {};
    const mapping: Record<string, string> = {};
    for (const header of headers) {
      const value = parsed.mapping?.[header];
      mapping[header] = typeof value === 'string' && allowed.has(value) ? value : '';
    }
    res.json({ ok: true, mapping, notes: typeof parsed.notes === 'string' ? parsed.notes : '' });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

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

/* ── Seedance 视频生成 ─────────────────────────────────────────────────── */
// POST /studio/seedance-video  Body: { script, productInfo, language, ratio, duration, resolution, title? }
studioRouter.post('/seedance-video', async (req, res) => {
  if (!isSeedanceVideoEnabled()) {
    res.status(423).json({
      ok: false,
      locked: true,
      source: 'seedance',
      error: 'Seedance 视频生成接口未启用。请配置 SEEDANCE_API_KEY 并设置 SEEDANCE_VIDEO_ENABLED=true。',
    });
    return;
  }
  const {
    script = '',
    productInfo = '',
    language = 'en',
    ratio = '9:16',
    duration: rawDuration = 8,
    resolution = '720p',
    title = 'Seedance 生成视频',
  } = req.body ?? {};
  const duration = normalizeSeedanceVideoDuration(rawDuration);
  const config = seedanceVideoConfig();
  if (!config.apiKey) {
    res.json({ ok: false, source: 'seedance', error: 'SEEDANCE_API_KEY not set' });
    return;
  }
  if (!await consumeDemoQuota(req, res, 'videoGeneration')) return;

  const prompt = [
    `Create a ${duration}-second vertical commercial social video in ${langName(language)}.`,
    `Aspect ratio: ${ratio}. Resolution: ${resolution}.`,
    `Use this script/storyboard as the primary direction:\n${String(script).slice(0, 4000)}`,
    productInfo ? `Product and brand context:\n${String(productInfo).slice(0, 1800)}` : '',
    'Style: realistic UGC product video, clear product focus, clean lighting, smooth camera movement, high conversion pacing.',
    'Generate synchronized natural audio. Dialogue or voiceover lines should follow the quoted script language.',
    '固定提示词：全程不要出现任何文字、符号、标识。',
    'No text, symbols, logos, captions, subtitles, labels, UI, watermarks, brand marks, written characters, numbers, or signage may appear at any point in the video.',
    'Keep visual actions aligned with the spoken lines.',
  ].filter(Boolean).join('\n\n');

  try {
    const created = await seedanceFetchJson(`${config.baseUrl}/contents/generations/tasks`, config.apiKey, {
      method: 'POST',
      body: JSON.stringify({
        model: config.model,
        content: [{ type: 'text', text: prompt }],
        ratio,
        duration,
        resolution,
        generate_audio: true,
        watermark: false,
      }),
    });
    const taskId = seedanceTaskId(created);
    if (!taskId) throw new Error('Seedance 未返回任务 ID');
    const task = await waitForSeedanceTask(config, taskId);
    const remoteUrl = findUrlDeep(task);
    if (!remoteUrl) throw new Error('Seedance 未返回可下载的视频地址');
    const filename = `seedance-${taskId.replace(/[^\w.-]+/g, '-')}-${Date.now()}.mp4`;
    let url = remoteUrl;
    let material: Material | null = null;
    try {
      url = await downloadGeneratedVideo(remoteUrl, filename);
      material = await createGeneratedVideoMaterial({ title, filename, duration });
    } catch (downloadError) {
      console.warn('[studio] Seedance video download failed, returning remote url:', downloadError);
    }
    res.json({
      ok: true,
      source: 'seedance',
      id: material?.id || taskId,
      taskId,
      title,
      url,
      poster: material?.poster,
      duration,
      model: config.model,
      material,
      createdAt: new Date().toISOString(),
    });
  } catch (e: any) {
    const reason = summarizeSeedanceError(e);
    console.error('[studio] Seedance video generation failed:', e);
    res.json({ ok: false, source: 'seedance', error: `Seedance 视频生成失败：${reason}` });
  }
});

/* ── Gemini / Veo 视频生成 ──────────────────────────────────────────────── */
// POST /studio/gemini-video  Body: { script, productInfo, language, ratio, duration, resolution, title? }
studioRouter.post('/gemini-video', async (req, res) => {
  if (!isGeminiVideoEnabled() || isDemoMode()) {
    res.status(423).json({
      ok: false,
      locked: true,
      source: 'gemini',
      error: '当前视频生成服务暂未启用。请先配置可用的生成模型 Key 后重试。',
    });
    return;
  }
  const {
    script = '',
    productInfo = '',
    language = 'zh',
    ratio = '9:16',
    duration: rawDuration = 8,
    resolution = '720p',
    title = 'Gemini 生成视频',
  } = req.body ?? {};
  const duration = normalizeGeminiVideoDuration(rawDuration);
  if (!await consumeDemoQuota(req, res, 'videoGeneration')) return;
  const { apiKey, model } = geminiVideoConfig();
  if (!apiKey) {
    res.json({ ok: false, source: 'gemini', error: 'GEMINI_API_KEY not set' });
    return;
  }

  const prompt = [
    `Create a short commercial social video in ${langName(language)}.`,
    `Use this script/storyboard as the primary direction:\n${String(script).slice(0, 4000)}`,
    productInfo ? `Product and brand context:\n${String(productInfo).slice(0, 1800)}` : '',
    'Style: realistic UGC product video, clear product focus, clean lighting, smooth camera movement, high conversion pacing.',
    'Avoid unreadable text overlays. Keep visual actions aligned with the spoken lines.',
  ].filter(Boolean).join('\n\n');

  try {
    const timeoutMs = Math.max(30_000, Number(process.env.GEMINI_VIDEO_TIMEOUT_MS || 360_000));
    const output = await runGeminiVideoWorker({
      prompt,
      model,
      title,
      ratio,
      duration,
      resolution,
      outputDir: GENERATED_MEDIA_DIR,
      timeoutMs,
    }, timeoutMs);
    res.json(output);
  } catch (e: any) {
    const reason = String(e?.message ?? e).slice(0, 500);
    console.error('[studio] Gemini video generation failed:', e);
    res.json({ ok: false, source: 'gemini', error: `Gemini 视频生成失败：${reason}` });
  }
});

/* ── ③ 口播脚本 ────────────────────────────────────────────────────────── */
// POST /studio/script  Body: { materials?, productInfo?, language?, platform?, duration? }
studioRouter.post('/script', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const {
    materials = [],
    productInfo = '',
    language = 'en',
    platform = 'tiktok',
    duration = 20,
    scriptType = 'voiceover',
    audience = '',
    sellingPoints = '',
    tone = 'high-converting',
    provider,
  } = req.body ?? {};
  const lang = langName(language);
  const clips = (materials as string[]).join(', ') || '(generic product clips)';
  const product = productInfo || '(use the enterprise profile)';
  const providerOpt = provider === 'qwen' || provider === 'gemini' ? provider : undefined;

  const prompt = scriptType === 'storyboard'
    ? `You are a short-video director for a Chinese cross-border (overseas) e-commerce seller.
Write a ${duration}-second ${platform} storyboard in ${lang}, broken into 4-6 scenes.

Selected clips: ${clips}
Product info: ${product}
Target audience: ${audience || '(infer from product and platform)'}
Key selling points: ${sellingPoints || '(infer from product info)'}
Tone/style: ${tone}

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
Target audience: ${audience || '(infer from product and platform)'}
Key selling points: ${sellingPoints || '(infer from product info)'}
Tone/style: ${tone}

Requirements:
- Exactly three sections, each on its own block, labelled like "[Hook · 0-3s]", "[Body · 3-${duration - 5}s]", "[CTA · ${duration - 5}-${duration}s]".
- A scroll-stopping hook in the first 3 seconds.
- Punchy, spoken, conversion-oriented. No markdown symbols.
- Output ONLY the script text.`;

  try {
    const text = await callLLM(prompt, { backend: providerOpt, systemPrompt: enterpriseCtx() || undefined });
    res.json({ ok: true, source: 'ai', script: text.trim() });
  } catch {
    res.json({ ok: true, source: 'fallback', script: scriptType === 'storyboard' ? fallbackStoryboard(duration) : fallbackScript(productInfo, duration) });
  }
});

/* ── ⑤ 封面标题候选 ────────────────────────────────────────────────────── */
// POST /studio/covers  Body: { script?, productInfo?, language? }
studioRouter.post('/covers', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { script = '', productInfo = '', language = 'en', provider, tone = '' } = req.body ?? {};
  const lang = langName(language);
  const providerOpt = provider === 'qwen' || provider === 'gemini' ? provider : undefined;

  const prompt = `Generate 3 punchy ${lang} video cover titles (max 6 words each) for an overseas e-commerce short video.
Context — product: ${productInfo || '(see enterprise profile)'} ; tone: ${tone || '(fit platform)'} ; script: ${script.slice(0, 300)}
Return ONLY a JSON array of 3 strings. No other text.`;

  try {
    const text = await callLLM(prompt, { backend: providerOpt, systemPrompt: enterpriseCtx() || undefined });
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
  const { script = '', productInfo = '', platform = 'tiktok', language = 'en', provider, audience = '', sellingPoints = '', tone = '' } = req.body ?? {};
  const lang = langName(language);
  const providerOpt = provider === 'qwen' || provider === 'gemini' ? provider : undefined;

  const prompt = `Write a ${platform} post caption in ${lang} for this overseas e-commerce video.
Product: ${productInfo || '(see enterprise profile)'} ; audience: ${audience || '(infer)'} ; selling points: ${sellingPoints || '(infer)'} ; tone: ${tone || '(fit platform)'} ; script: ${script.slice(0, 300)}
Return ONLY JSON: { "caption": string (1-2 sentences, may include 1-2 emojis), "hashtags": string[] (5-8 trending tags, no # prefix) }`;

  try {
    const text = await callLLM(prompt, { backend: providerOpt, systemPrompt: enterpriseCtx() || undefined });
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
  const scope = req.query.scope as string | undefined;
  let list = loadMaterials().filter(m => !isMockMaterial(m));
  if (scope === 'shared' || scope === 'own') list = list.filter(m => (m.scope ?? 'own') === scope);
  res.json(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

function isMockMaterial(m: Material): boolean {
  return (m.scope ?? 'own') === 'shared'
    || /^sh-/.test(m.id)
    || /^示例[·・]/.test(m.name)
    || m.folder === 'sample';
}

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

// POST /studio/voiceover  Body: { name, dataBase64, mimeType?, duration? } → 上传本地口播音频
studioRouter.post('/voiceover', async (req, res) => {
  const { name = 'voiceover.wav', dataBase64, mimeType, duration = 0 } = req.body ?? {};
  if (!dataBase64) { res.status(400).json({ ok: false, error: 'dataBase64 required' }); return; }
  try { fs.mkdirSync(TTS_DIR, { recursive: true }); } catch { /* ignore */ }
  try {
    const extFromMime = (mimeType as string | undefined)?.split('/')[1]?.replace('mpeg', 'mp3').replace('x-wav', 'wav');
    const extFromName = String(name).split('.').pop();
    const ext = (extFromMime || extFromName || 'wav').replace(/[^\w]+/g, '').slice(0, 8) || 'wav';
    const file = `${randomUUID()}.${ext}`;
    const buf = Buffer.from(String(dataBase64).replace(/^data:[^,]+,/, ''), 'base64');
    fs.writeFileSync(path.join(TTS_DIR, file), buf);
    res.json({ ok: true, url: `/tts/${file}`, duration: Number(duration) || 0 });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
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

// POST /studio/capcut/open → 网页端兜底：导出剪映精修包，并尝试打开剪映/CapCut
studioRouter.post('/capcut/open', async (req, res) => {
  try {
    const pkg = await exportCapcutPackage(req.body);
    if (!pkg.ok || !pkg.dir) {
      res.status(500).json({ ok: false, error: pkg.error || '剪映精修包导出失败' });
      return;
    }

    let folderOpened = false;
    let appOpened = false;
    const errors: string[] = [];
    const openCommand = (args: string[]) => new Promise<void>((resolve, reject) => {
      execFile('open', args, { timeout: 5000 }, err => (err ? reject(err) : resolve()));
    });

    try {
      await openCommand([pkg.dir]);
      folderOpened = true;
    } catch (err: any) {
      errors.push(`打开精修包失败：${err?.message || err}`);
    }

    for (const appName of ['剪映专业版', '剪映', 'CapCut', 'JianyingPro', 'Jianying']) {
      try {
        await openCommand(['-a', appName]);
        appOpened = true;
        break;
      } catch {
        // Try next known app name.
      }
    }

    res.json({
      ok: folderOpened || appOpened,
      dir: pkg.dir,
      appOpened,
      folderOpened,
      error: appOpened ? undefined : '本机没有找到剪映/CapCut 应用，已导出精修包文件夹，请安装剪映后手动导入。',
      details: errors,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || '剪映跳转失败' });
  }
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
