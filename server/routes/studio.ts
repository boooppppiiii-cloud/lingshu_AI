import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { AsyncLocalStorage } from 'node:async_hooks';
import ffmpegStatic from 'ffmpeg-static';
import { GoogleGenAI } from '@google/genai';
import { callLLM } from '../agents/llm.js';
import { buildEnterpriseContext, readTenantEnterpriseProfile } from './enterprise.js';
import { auth, store } from '../storage/index.js';
import {
  entitlementGate,
  getTenantSubscription,
  isEntitled,
  isSubscriptionEnforced,
} from '../middleware/subscription.js';
import { signRenderToken } from '../lib/renderToken.js';
import { consumeDemoQuota, isDemoMode } from '../lib/demo.js';
import { generatePosterImage, imageExt, type ReferenceImage } from '../lib/imageGen.js';
import { getPublicOrigin } from '../lib/oauthConfig.js';
import { releaseSeedanceBudget, reserveSeedanceBudget, type SeedanceBudgetReservation } from '../lib/seedanceBudget.js';
import { canAppearInSharedLibrary, isReferenceOnlyMaterial, materialUsage, type MaterialUsage } from '../lib/materialPolicy.js';
import { fetchCloudMaterial, getCloudMaterialRecord, listCloudMaterials, updateCloudMaterial } from '../lib/cloudMaterials.js';
import { analyzeVideo } from '../agents/gemini.js';
import { analyzeVideoFramesWithQwen, classifyMaterialFramesWithQwen } from '../agents/qwen.js';
import { extractQwenAnalysisFrames } from './videos.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { signAssetUrl, signPathAssetUrl, sharedAssetRelativePath, tenantAssetDir, tenantAssetRelativePath } from '../lib/assetAccess.js';
import { requireAdminUser } from '../lib/demoAccounts.js';
import { listPublishRecords, recommendPublish, type PublishPlatform } from '../lib/publishHistory.js';
import { objectStorageEnabled, r2Delete, r2Download, r2GetObject, r2Head, r2SignedGetUrl, r2Upload } from '../storage/r2.js';
import { materialAssetContentType, materialAssetObjectKey, materialAssetTypeAllowed, sharedObjectKey, tenantPrivateObjectKey } from '../storage/materialAssets.js';

/* ──────────────────────────────────────────────────────────────────────────
   Studio 路由 —— 服务于「社媒 / AI 生成内容」混剪工作台
   负责脚本 / 文案 / 封面标题 / 智能选材 / Seedance 视频生成等工作台能力。
   视频生成必须真实调用外部模型；失败时返回明确错误，不生成本地假预览。
─────────────────────────────────────────────────────────────────────────── */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioTenantContext = new AsyncLocalStorage<string>();
function scopedStudioAssetDir(root: string): string {
  const tenantId = studioTenantContext.getStore();
  if (!tenantId) throw new Error('studio tenant context unavailable');
  return tenantAssetDir(root, tenantId);
}
function scopedStudioAssetUrl(prefix: string, file: string): string {
  const tenantId = studioTenantContext.getStore();
  if (!tenantId) throw new Error('studio tenant context unavailable');
  return signAssetUrl(`/${prefix}/${tenantAssetRelativePath(tenantId, file)}`, tenantId);
}
const require = createRequire(import.meta.url);
const { composite } = require('../../desktop/render.cjs') as {
  composite: (manifest: unknown, onProgress?: (pct: number) => void, outDir?: string) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
};

function execFileAsync(file: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout }, (err, stdout) => (err ? reject(err) : resolve(String(stdout || ''))));
  });
}

async function enterpriseCtx(): Promise<string> {
  const tenantId = studioTenantContext.getStore();
  if (!tenantId) return '';
  try { return buildEnterpriseContext(await readTenantEnterpriseProfile(tenantId)); }
  catch { return ''; }
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

type ReferenceTimelineRange = { start: number; end: number };

function referenceTimelineQuality(referenceAnalysis: unknown, requestedDuration: unknown): {
  valid: boolean;
  issues: string[];
  ranges: ReferenceTimelineRange[];
  duration: number;
} {
  const raw = String(referenceAnalysis || '');
  // Only treat a line-leading range as a shot. Beat timestamps embedded inside
  // the shot description must not inflate density or create false overlaps.
  const ranges = Array.from(raw.matchAll(/^\s*\[\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—~至]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\]/gim))
    .map(match => ({ start: Number(match[1]), end: Number(match[2]) }))
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const requested = Number(requestedDuration || 0);
  const analyzedEnd = ranges.reduce((max, item) => Math.max(max, item.end), 0);
  // The source duration is normally reflected by the last exact-analysis range.
  // Do not let the studio's default target duration make a shorter source look incomplete.
  const duration = analyzedEnd > 0 ? analyzedEnd : Math.max(0, requested);
  const issues: string[] = [];
  if (!ranges.length) issues.push('缺少可解析的逐镜时间戳');
  if (ranges.length && ranges[0]!.start > 0.75) issues.push(`时间线未从片头开始（首段 ${ranges[0]!.start.toFixed(1)}s）`);
  for (let index = 0; index < ranges.length; index += 1) {
    const item = ranges[index]!;
    if (item.end - item.start > 5.5) issues.push(`存在过长分镜 [${item.start}-${item.end}s]`);
    const next = ranges[index + 1];
    if (next && next.start - item.end > 0.75) issues.push(`时间线存在空档 ${item.end.toFixed(1)}-${next.start.toFixed(1)}s`);
    if (next && item.end - next.start > 0.75) issues.push(`时间线存在重叠 ${next.start.toFixed(1)}-${item.end.toFixed(1)}s`);
  }
  const minShots = duration > 0 ? Math.ceil(duration / 5) : 1;
  if (ranges.length < minShots) issues.push(`分镜密度不足（${ranges.length} 段，至少需要 ${minShots} 段）`);
  if (/人工复核[：:]\s*是|needsReview["']?\s*[：:]\s*true|分析超时|待人工复核|缺少真实片段/.test(raw)) {
    issues.push('分析包含超时、降级或待人工复核片段');
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)], ranges, duration };
}

function analysisDetailsTimelineQuality(details: unknown, duration: unknown) {
  const rows = Array.isArray(details)
    ? details.map(item => `[${String((item as { time?: unknown })?.time || '').replace(/^\s*\[|\]\s*$/g, '')}]`).join('\n')
    : '';
  return referenceTimelineQuality(rows, duration);
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

function generatedMediaUrl(tenantId: string, file: string): string {
  return `/media/${tenantAssetRelativePath(tenantId, file)}`;
}

async function createGeneratedVideoMaterial(input: {
  title: string;
  filename: string;
  duration: number;
  tenantId: string;
  sourceType?: string;
}): Promise<Material | null> {
  const filePath = path.join(tenantAssetDir(MEDIA_DIR, input.tenantId), input.filename);
  if (!fs.existsSync(filePath)) return null;
  const id = randomUUID();
  const posterFile = `${id}.poster.jpg`;
  const posterPath = path.join(tenantAssetDir(MEDIA_DIR, input.tenantId), posterFile);
  const material: Material = {
    id,
    name: input.title || 'Seedance 生成视频',
    folder: 'upload',
    type: 'video',
    duration: Number(input.duration) || 0,
    size: humanSize(fs.statSync(filePath).size),
    file: tenantAssetRelativePath(input.tenantId, input.filename),
    url: generatedMediaUrl(input.tenantId, input.filename),
    scope: 'own',
    tenantId: input.tenantId,
    sourceType: input.sourceType || 'ai-generated',
    createdAt: new Date().toISOString(),
  };
  const posterOk = await extractPoster(filePath, posterPath, material.duration > 1 ? 1 : 0);
  if (posterOk) material.poster = generatedMediaUrl(input.tenantId, posterFile);
  if (objectStorageEnabled()) {
    material.objectKey = materialAssetObjectKey(input.tenantId, input.filename);
    await r2Upload({ key: material.objectKey, body: fs.readFileSync(filePath), contentType: materialAssetContentType(input.filename) });
    material.url = '';
    if (posterOk) {
      material.posterObjectKey = materialAssetObjectKey(input.tenantId, posterFile);
      await r2Upload({ key: material.posterObjectKey, body: fs.readFileSync(posterPath), contentType: 'image/jpeg' });
      material.poster = undefined;
    }
    fs.rmSync(filePath, { force: true });
    fs.rmSync(posterPath, { force: true });
  }
  const list = loadMaterials().filter(item => item.url !== material.url);
  list.push(material);
  persistMaterials(list);
  return material;
}

async function createGeneratedImageMaterial(input: {
  title: string;
  bytes: Buffer;
  mimeType: string;
  source?: string;
  tenantId: string;
}): Promise<Material> {
  const outputDir = tenantAssetDir(MEDIA_DIR, input.tenantId);
  fs.mkdirSync(outputDir, { recursive: true });
  const id = randomUUID();
  const ext = imageExt(input.mimeType);
  const filename = `${id}.${ext}`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, input.bytes);
  const material: Material = {
    id,
    name: input.title || 'AI 图文海报',
    folder: 'product',
    type: 'image',
    duration: 0,
    size: humanSize(input.bytes.length),
    file: tenantAssetRelativePath(input.tenantId, filename),
    url: generatedMediaUrl(input.tenantId, filename),
    poster: generatedMediaUrl(input.tenantId, filename),
    scope: 'own',
    tenantId: input.tenantId,
    createdAt: new Date().toISOString(),
  };
  if (objectStorageEnabled()) {
    material.objectKey = materialAssetObjectKey(input.tenantId, filename);
    material.posterObjectKey = material.objectKey;
    await r2Upload({ key: material.objectKey, body: input.bytes, contentType: input.mimeType });
    material.url = '';
    material.poster = undefined;
    fs.rmSync(filePath, { force: true });
  }
  const list = loadMaterials().filter(item => item.url !== material.url);
  list.push(material);
  persistMaterials(list);
  console.log(`[studio] generated poster image material ${material.id} via ${input.source || 'image-model'}`);
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

async function downloadGeneratedVideo(url: string, filename: string, tenantId: string): Promise<string> {
  const outputDir = tenantAssetDir(MEDIA_DIR, tenantId);
  fs.mkdirSync(outputDir, { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`视频下载失败：${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(path.join(outputDir, filename), Buffer.from(arrayBuffer));
  return generatedMediaUrl(tenantId, filename);
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

function referenceForbiddenTerms(input: {
  referenceTitle?: unknown;
  materials?: unknown;
  referenceHighlights?: unknown;
  referenceAnalysis?: unknown;
}): string[] {
  const raw = [
    input.referenceTitle,
    ...(Array.isArray(input.materials) ? input.materials : []),
    ...(Array.isArray(input.referenceHighlights) ? input.referenceHighlights : []),
    input.referenceAnalysis,
  ].map(String).join('\n');
  const terms = new Set<string>();
  for (const match of raw.matchAll(/#([A-Za-z][A-Za-z0-9_-]{2,})/g)) terms.add(match[1]!);
  for (const match of raw.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)+\b/g)) terms.add(match[0]!);
  for (const match of raw.matchAll(/\b[A-Z][a-z]+(?:[A-Z][a-zA-Z0-9]*)+\b/g)) terms.add(match[0]!);
  // Competitor names often use a single leading capital (for example
  // "Sinotruk"). Capture title-like Latin tokens too; common platform words
  // are removed below so they cannot leak through a local fallback.
  for (const match of raw.matchAll(/\b[A-Z][a-z][A-Za-z0-9-]{3,}\b/g)) terms.add(match[0]!);
  for (const term of ['CeraVe', 'TikTok', 'Instagram', 'Facebook', 'YouTube']) {
    if (raw.toLowerCase().includes(term.toLowerCase())) terms.add(term);
  }
  return Array.from(terms)
    .map(term => term.replace(/^#/, '').trim())
    .filter(term => term.length >= 3 && !/^(TikTok|Instagram|Facebook|YouTube|Video|Official|Factory|Product)$/i.test(term))
    .slice(0, 24);
}

function referenceIndustryLeakTerms(referenceText: string, productInfo: string): string[] {
  const reference = String(referenceText || '').toLowerCase();
  const product = String(productInfo || '').toLowerCase();
  const groups = [
    ['护肤', '美妆', '面霜', '眼霜', '防晒', '精华', '皮肤', 'skincare', 'cosmetic', 'cream', 'serum', 'sunscreen'],
    ['包装', '纸袋', '纸盒', '礼盒', '印刷', 'paper bag', 'paper box', 'package', 'packaging'],
    ['灯具', '照明', '轨道灯', '筒灯', '吸顶灯', '色温', '亮度', 'lighting', 'light fixture', 'track light'],
    ['服装', '面料', '连衣裙', 't恤', 'apparel', 'fabric', 'garment'],
    ['家具', '沙发', '椅子', '桌子', 'furniture', 'sofa', 'chair'],
  ];
  const leaked = new Set<string>();
  for (const group of groups) {
    const referenceHasGroup = group.some(term => reference.includes(term.toLowerCase()));
    const productHasGroup = group.some(term => product.includes(term.toLowerCase()));
    if (referenceHasGroup && !productHasGroup) {
      group.forEach(term => leaked.add(term));
    }
  }
  return Array.from(leaked);
}

function productSupportsNumericClaim(claim: string, productInfo: string): boolean {
  const source = String(productInfo).normalize('NFKC');
  if (source.toLowerCase().includes(String(claim).normalize('NFKC').toLowerCase())) return true;
  const parsed = String(claim).match(/(\d+(?:\.\d+)?)\s*(瓶|ml|毫升|kg|g|克|斤|cm|厘米|mm|毫米|天|day|days|秒|%|个|pcs|件|箱|元|美元)/i);
  if (!parsed) return false;
  const value = parsed[1];
  const unit = parsed[2].toLowerCase();
  const equivalents: Record<string, string[]> = {
    ml: ['ml', '毫升'], 毫升: ['ml', '毫升'],
    kg: ['kg', '千克', '公斤'], g: ['g', '克'], 克: ['g', '克'],
    cm: ['cm', '厘米'], 厘米: ['cm', '厘米'], mm: ['mm', '毫米'], 毫米: ['mm', '毫米'],
    day: ['day', 'days', '天'], days: ['day', 'days', '天'], 天: ['day', 'days', '天'],
    pcs: ['pcs?', 'pieces?', '个', '件'], 个: ['pcs?', 'pieces?', '个', '件'], 件: ['pcs?', 'pieces?', '个', '件'],
    瓶: ['瓶', 'bottles?'], 箱: ['箱', 'cartons?', 'boxes?'],
    秒: ['秒', 's', 'sec(?:ond)?s?'],
    '%': ['%', 'percent'],
  };
  if (unit === '美元') {
    return [
      `\\$\\s*${value}`,
      `(?:usd|us\\$)\\s*${value}`,
      `${value}\\s*(?:usd|us\\$|美元)`,
    ].some(pattern => new RegExp(pattern, 'i').test(source));
  }
  if (unit === '元') {
    return [
      `[¥￥]\\s*${value}`,
      `(?:rmb|cny)\\s*${value}`,
      `${value}\\s*(?:rmb|cny|元)`,
    ].some(pattern => new RegExp(pattern, 'i').test(source));
  }
  const candidates = equivalents[unit] || [unit];
  if (candidates.some(candidate => new RegExp(`${value.replace('.', '\\.')}\\s*${candidate}`, 'i').test(source))) return true;
  // 结构化产品资料有时把单位放在字段名里，例如“起订量：50”“价格(USD)：20”。
  if (['pcs', '个', '件', '瓶', '箱'].includes(unit)) {
    return new RegExp(`(?:起订量|MOQ)[^\\n]{0,30}\\b${value}\\b`, 'i').test(source);
  }
  return false;
}

function stripScriptAnalysisSummary(text: string): string {
  const value = String(text || '').trim();
  const forbiddenBlockRe = /^\s*(?:【?\s*)?(?:基础要求|分析摘要|竞品识别|产品替换|参考爆款|成片目标|指定画风|核心情绪|参考品牌|口播语言|爆点拆解|产品承接|Purpose|Creative style|Core emotion|Product replacement|Voiceover language|Goal|Storyboard)(?:\s*】)?\s*[：:].*$/i;
  const firstTimestamp = value.search(/(?:^|\n)\s*(?:\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\]|Scene\s+\d+\s*\()/i);
  if (firstTimestamp > 0) {
    const head = value.slice(0, firstTimestamp);
    if (/基础要求|分析摘要|竞品识别|产品替换|参考爆款|成片目标|指定画风|核心情绪|对标视频|参考品牌|口播语言/.test(head)) {
      return value.slice(firstTimestamp).trim();
    }
  }
  return value
    .split(/\n+/)
    .filter(line => !forbiddenBlockRe.test(line))
    .join('\n')
    .trim();
}

function normalizeScriptTimestamps(value: string): string {
  const clean = (raw: string) => {
    const number = Number(raw);
    return Number.isFinite(number)
      ? number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
      : raw;
  };
  return String(value || '').replace(
    /\[\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\]/gi,
    (_match, start, end) => `[${clean(start)}-${clean(end)}s]`,
  );
}

function enforceProductNameInScript(script: string, productInfo: string): string {
  const productName = compactProductLabel(productInfo).trim();
  if (!productName || /^(this product|主推产品|企业产品组合)$/i.test(productName)) return script;
  return String(script || '')
    .replace(/「企业产品组合」|“企业产品组合”|企业产品组合/g, `「${productName}」`)
    .replace(/「主推产品」|“主推产品”|主推产品/g, `「${productName}」`)
    .replace(/\bthis product\b/gi, productName);
}

function selectedProductNames(productInfo: string): string[] {
  return Array.from(String(productInfo || '').matchAll(/产品名称[：:]\s*([^\n]+)/g))
    .map(match => String(match[1] || '').trim())
    .filter(Boolean);
}

function normalizeScriptPart(value: string): string {
  return String(value || '')
    .replace(/\d+(?:\.\d+)?\s*(?:s|秒|天|day|days|%|个|pcs|件|箱|元|美元)?/gi, '#')
    .replace(/[「」"“”'（）()【】\[\],，。；;：:\s/]+/g, '')
    .replace(/企业产品组合|主推产品|thisproduct/gi, '产品')
    .toLowerCase();
}

function extractField(block: string, labels: string[]): string {
  for (const label of labels) {
    const match = block.match(new RegExp(`${label}\\s*[：:]\\s*([^\\n]+)`, 'i'));
    if (match?.[1]) return match[1].trim();
  }
  return block.trim();
}

function jaccardSimilarity(a: string, b: string): number {
  const grams = (text: string) => {
    const normalized = normalizeScriptPart(text);
    const out = new Set<string>();
    for (let i = 0; i < Math.max(1, normalized.length - 1); i += 1) out.add(normalized.slice(i, i + 2));
    return out;
  };
  const left = grams(a);
  const right = grams(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  left.forEach(item => { if (right.has(item)) overlap += 1; });
  return overlap / Math.max(left.size, right.size);
}

function hasRepetitiveStoryboard(script: string): boolean {
  const blocks = String(script || '')
    .split(/(?=\n?\s*(?:\[\s*\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*s?\s*\]|Scene\s+\d+\s*\())/i)
    .map(item => item.trim())
    .filter(item => item.length > 20);
  if (blocks.length < 3) return false;
  const visualKeys = blocks.map(block => normalizeScriptPart(extractField(block, ['画面', 'Visual'])));
  const voiceKeys = blocks.map(block => normalizeScriptPart(extractField(block, ['人物说', '台词', 'Voiceover'])));
  const repeatedVisuals = visualKeys.filter((key, index) => key && visualKeys.indexOf(key) !== index).length;
  const repeatedVoices = voiceKeys.filter((key, index) => key && voiceKeys.indexOf(key) !== index).length;
  if (repeatedVisuals >= 2 || repeatedVoices >= 2) return true;
  let similarPairs = 0;
  for (let i = 1; i < blocks.length; i += 1) {
    if (jaccardSimilarity(blocks[i - 1]!, blocks[i]!) > 0.72) similarPairs += 1;
  }
  return similarPairs >= Math.max(2, Math.floor(blocks.length / 2));
}

const TECH_TERM_RE = /\b(?:CE|RoHS|UKCA|ETL|IES\/?LDT|LDT|IP\d{2,}|BSCI|REACH|ISO\d*|MOQ|OEM|ODM|SKU)\b|认证资质|认证|型号|光学文件|检测报告|参数|色温|显指|防护等级/gi;

function techTermCount(value: string): number {
  return Array.from(String(value || '').matchAll(TECH_TERM_RE)).length;
}

function hasUnnaturalVoiceover(script: string): boolean {
  return String(script || '')
    .split(/\n+/)
    .some(line => {
      const match = line.match(/(?:台词|人物说|Voiceover|VO|口播)\s*[：:]\s*(.+)$/i);
      if (!match?.[1]) return false;
      const text = match[1].replace(/\s+/g, ' ').trim();
      return techTermCount(text) >= 3 || text.length > 72 || /CE[、,，\s]+RoHS[、,，\s]+UKCA/i.test(text);
    });
}

function storyboardSpeechIssues(script: string): string[] {
  const issues: string[] = [];
  const blocks = String(script || '').split(/(?=\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\])/i);
  for (const block of blocks) {
    const range = block.match(/\[\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\]/i);
    const voice = block.match(/(?:人物说|台词|Voiceover|VO|口播)\s*[：:]\s*[“"]?([^\n”"]+)/i)?.[1]?.trim();
    if (!range || !voice) continue;
    const duration = Math.max(0, Number(range[2]) - Number(range[1]));
    if (!duration) {
      issues.push(`${range[0]} 时间段无效`);
      continue;
    }
    const cjkChars = Array.from(voice.replace(/[\s，。！？、；：,.!?;:“”"'（）()]/g, '')).length;
    const wordCount = voice.split(/\s+/).filter(Boolean).length;
    const estimated = /[\u3400-\u9fff]/.test(voice)
      ? cjkChars / 4.5 + 0.6
      : wordCount / 2.5 + 0.5;
    if (estimated > duration + 0.35) {
      issues.push(`${range[0]} 口播预计${estimated.toFixed(1)}秒，超过镜头${duration.toFixed(1)}秒`);
    }
  }
  return issues;
}

function materialGroundingIssues(script: string, productInfo: string, materialsText: string): string[] {
  const evidence = `${productInfo}\n${materialsText}`.toLowerCase();
  const claimGroups = [
    ['迅速吸收', '快速吸收', '瞬时渗透', '即时渗透', '一触即融', '吸收', '渗透'],
    ['淡纹', '去皱', '紧致', '抗衰', '抗老'],
    ['美白', '提亮', '祛斑'],
    ['祛痘', '抗炎', '修复屏障', '无刺激', '敏感肌可用'],
    ['防水', '耐摔', '不易破损', '承重'],
  ];
  const issues: string[] = [];
  for (const group of claimGroups) {
    const used = group.filter(term => script.toLowerCase().includes(term.toLowerCase()));
    if (used.length && !group.some(term => evidence.includes(term.toLowerCase()))) {
      issues.push(`素材/产品资料未支持的效果描述：${used.join('、')}`);
    }
  }
  return issues;
}

type ScriptMaterialInfo = {
  name?: string;
  type?: string;
  folder?: string;
  duration?: number;
  effectiveDuration?: number;
  role?: string;
  targetStart?: number;
  targetEnd?: number;
  industry?: string;
  shotFunction?: string;
  tags?: string;
  observations?: string[];
};

function normalizeMaterialInfos(value: unknown, fallbackNames: unknown, totalDuration: number): ScriptMaterialInfo[] {
  const raw = Array.isArray(value) ? value : [];
  const fromInfos = raw.reduce<ScriptMaterialInfo[]>((acc, item, index) => {
    const obj = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const name = String(obj.name || '').trim();
    if (!name) return acc;
    const slot = Math.max(2, totalDuration / Math.max(1, raw.length || 1));
    acc.push({
      name,
      type: String(obj.type || 'video'),
      folder: String(obj.folder || 'upload'),
      duration: Number(obj.duration) || slot,
      effectiveDuration: Number(obj.effectiveDuration) || Number(obj.duration) || slot,
      role: String(obj.role || ''),
      targetStart: Number.isFinite(Number(obj.targetStart)) ? Number(obj.targetStart) : +(index * slot).toFixed(1),
      targetEnd: Number.isFinite(Number(obj.targetEnd)) ? Number(obj.targetEnd) : +(index === raw.length - 1 ? totalDuration : (index + 1) * slot).toFixed(1),
      industry: String(obj.industry || ''),
      shotFunction: String(obj.shotFunction || ''),
      tags: String(obj.tags || ''),
      observations: Array.isArray(obj.observations) ? obj.observations.map(String).filter(Boolean).slice(0, 6) : [],
    });
    return acc;
  }, []);
  if (fromInfos.length) return fromInfos.slice(0, 8);

  const names = Array.isArray(fallbackNames) ? fallbackNames.map(String).filter(Boolean) : [];
  const slot = Math.max(2, totalDuration / Math.max(1, names.length || 1));
  return names.slice(0, 8).map((name, index) => ({
    name,
    type: 'video',
    folder: 'upload',
    duration: slot,
    effectiveDuration: slot,
    role: '素材片段',
    targetStart: +(index * slot).toFixed(1),
    targetEnd: +(index === names.length - 1 ? totalDuration : (index + 1) * slot).toFixed(1),
  }));
}

function materialRoleFromFolder(info: ScriptMaterialInfo): string {
  if (info.role) return info.role;
  if (info.folder === 'presenter') return '真人口播素材';
  if (info.folder === 'detail') return '产品细节素材';
  if (info.folder === 'factory') return '工厂/实力素材';
  if (info.folder === 'scene') return '场景使用素材';
  if (info.folder === 'model') return '模特/效果素材';
  if (info.type === 'image') return '静态产品图';
  return '产品展示素材';
}

function materialInfoLines(infos: ScriptMaterialInfo[]): string {
  return infos.map((info, index) => [
    `${index + 1}. 素材名：${info.name}`,
    `类型：${info.type || 'video'}`,
    `角色：${materialRoleFromFolder(info)}`,
    `原始时长：${Number(info.duration || 0).toFixed(1)}s`,
    `建议有效时长：${Number(info.effectiveDuration || Math.max(0, Number(info.targetEnd || 0) - Number(info.targetStart || 0))).toFixed(1)}s`,
    `建议时间段：${Number(info.targetStart || 0).toFixed(1)}-${Number(info.targetEnd || 0).toFixed(1)}s`,
    info.industry ? `行业：${info.industry}` : '',
    info.shotFunction ? `镜头功能标签：${info.shotFunction}` : '',
    info.tags ? `人工/运营标签：${info.tags}` : '',
    info.observations?.length ? `已确认或待复核的分段观察：${info.observations.join(' | ')}` : '没有视频级分段观察，只能依据素材名和标签做保守剪辑',
  ].filter(Boolean).join('；')).join('\n');
}

export const studioRouter = Router();
studioRouter.use(requireAuth);
studioRouter.use((_req, res, next) => {
  studioTenantContext.run((res.locals as AuthLocals).tenantId, next);
});

// POST /studio/map-product-columns Body: { headers, sampleRows, candidateRows?, currentHeaderRowIndex? }
studioRouter.post('/map-product-columns', async (req, res) => {
  const headers = Array.isArray(req.body?.headers) ? req.body.headers.map(String) : [];
  const sampleRows = Array.isArray(req.body?.sampleRows) ? req.body.sampleRows.slice(0, 5) : [];
  const candidateRows = Array.isArray(req.body?.candidateRows)
    ? req.body.candidateRows.slice(0, 10).map((row: unknown) => Array.isArray(row) ? row.map(String) : [])
    : [];
  const currentHeaderRowIndex = Number.isInteger(req.body?.currentHeaderRowIndex) ? Number(req.body.currentHeaderRowIndex) : 0;
  if (!headers.length) {
    res.status(400).json({ ok: false, error: 'headers required' });
    return;
  }

  const allowed = new Set(['sku', 'name', 'color', 'size', 'tagPrice', 'retailPrice', 'moq', 'brand', 'material', 'imageUrl', 'highlights', '']);
  try {
    const text = await callLLM(JSON.stringify({ headers, sampleRows, candidateRows, currentHeaderRowIndex }), {
      systemPrompt: `你是 B2B 商品表格字段映射助手。先检查 currentHeaderRowIndex 指向的是否是真正表头；如果 headers 看起来是货号、商品内容或数字而不是列名，就从 candidateRows 中找出真正表头的 0 基行号。然后根据表头和前 5 行样本，把客户列名映射到产品 schema。
真正表头通常包含货号、品名、颜色、尺码、价格、材质、图片等字段名；公司抬头、Logo、大标题和第一条商品数据都不是表头。
可用目标字段：
- sku: 货号/款号/SKU/商品编码，用于 upsert 去重
- name: 商品名称
- color: 颜色
- size: 尺码/规格
- tagPrice: 吊牌价/标签价
- retailPrice: 零售价/建议零售价
- moq: 起订量/最小订单量
- brand: 品牌
- material: 面料/材质/成分
- imageUrl: 图片 URL/主图链接
- highlights: 一句话卖点/描述
不确定或无关列映射为空字符串。只输出 JSON，不要 markdown。headerRowIndex 必须是 candidateRows 的 0 基行号；当前表头正确时沿用 currentHeaderRowIndex。格式：
{"headerRowIndex":2,"mapping":{"客户列名":"sku"},"notes":"简短说明"}`,
    });
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) as { headerRowIndex?: unknown; mapping?: Record<string, unknown>; notes?: unknown } : {};
    const mapping: Record<string, string> = {};
    for (const header of headers) {
      const value = parsed.mapping?.[header];
      mapping[header] = typeof value === 'string' && allowed.has(value) ? value : '';
    }
    const headerRowIndex = Number.isInteger(parsed.headerRowIndex)
      && Number(parsed.headerRowIndex) >= 0
      && Number(parsed.headerRowIndex) < candidateRows.length
      ? Number(parsed.headerRowIndex)
      : currentHeaderRowIndex;
    res.json({ ok: true, headerRowIndex, mapping, notes: typeof parsed.notes === 'string' ? parsed.notes : '' });
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
  const { tenantId } = res.locals as AuthLocals;
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
    referenceImageUrl = '',
    generationGroupKey = '',
    generationContext = {},
    parentVersionId = '',
  } = req.body ?? {};
  const duration = normalizeSeedanceVideoDuration(rawDuration);
  const config = seedanceVideoConfig();
  if (!config.apiKey) {
    res.json({ ok: false, source: 'seedance', error: 'SEEDANCE_API_KEY not set' });
    return;
  }
  if (!await consumeDemoQuota(req, res, 'videoGeneration')) return;

  const identity = await auth.verifyToken(req.headers.authorization);
  const subscription = identity?.tenantId ? await getTenantSubscription(identity.tenantId) : null;
  const plan = String(subscription?.plan || '').toLowerCase();
  const isFormalTenant = subscription?.status === 'active' && !['admin', 'local', 'trial'].includes(plan);
  let budget: SeedanceBudgetReservation | null = null;
  if (isFormalTenant && identity?.tenantId) {
    budget = reserveSeedanceBudget({ tenantId: identity.tenantId, duration, resolution: String(resolution) });
    if (!budget.ok) {
      res.status(429).json({
        ok: false,
        code: 'seedance_monthly_budget_exceeded',
        error: `本月 Seedance 成本额度已不足：剩余 ¥${budget.remainingCny.toFixed(2)}，本次预计需要 ¥${budget.reservedCny.toFixed(2)}。`,
        message: `本月 Seedance 预算剩余 ¥${budget.remainingCny.toFixed(2)}，本次预计需要 ¥${budget.reservedCny.toFixed(2)}。`,
        budget,
      });
      return;
    }
  }

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

  let taskAccepted = false;
  try {
    const content: any[] = [{ type: 'text', text: prompt }];
    const rawReferenceImageUrl = String(referenceImageUrl).trim();
    const resolvedReferenceImageUrl = rawReferenceImageUrl.startsWith('/')
      ? `${getPublicOrigin(req)}${signAssetUrl(rawReferenceImageUrl, tenantId)}`
      : rawReferenceImageUrl;
    if (resolvedReferenceImageUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: resolvedReferenceImageUrl },
      });
    }
    const created = await seedanceFetchJson(`${config.baseUrl}/contents/generations/tasks`, config.apiKey, {
      method: 'POST',
      body: JSON.stringify({
        model: config.model,
        content,
        ratio,
        duration,
        resolution,
        generate_audio: true,
        watermark: false,
      }),
    });
    const taskId = seedanceTaskId(created);
    if (!taskId) throw new Error('Seedance 未返回任务 ID');
    taskAccepted = true;
    const task = await waitForSeedanceTask(config, taskId);
    const remoteUrl = findUrlDeep(task);
    if (!remoteUrl) throw new Error('Seedance 未返回可下载的视频地址');
    const filename = `seedance-${taskId.replace(/[^\w.-]+/g, '-')}-${Date.now()}.mp4`;
    let url = remoteUrl;
    let material: Material | null = null;
    try {
      url = await downloadGeneratedVideo(remoteUrl, filename, tenantId);
      material = await createGeneratedVideoMaterial({ title, filename, duration, tenantId, sourceType: 'ai-seedance' });
    } catch (downloadError) {
      console.warn('[studio] Seedance video download failed, returning remote url:', downloadError);
    }
    const version = String(generationGroupKey).trim()
      ? appendVideoVersion({
          tenantId,
          groupKey: String(generationGroupKey).trim(),
          parentVersionId: String(parentVersionId).trim() || undefined,
          materialId: material?.id,
          taskId,
          title: String(title),
          url,
          poster: material?.poster,
          duration,
          source: 'seedance',
          model: config.model,
          promptSnapshot: {
            script: String(script), productInfo: String(productInfo), language: String(language),
            ratio: String(ratio), resolution: String(resolution),
          },
          context: generationContext && typeof generationContext === 'object' && !Array.isArray(generationContext)
            ? generationContext as Record<string, unknown> : {},
        })
      : undefined;
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
      budget,
      material,
      version,
      createdAt: new Date().toISOString(),
    });
  } catch (e: any) {
    if (!taskAccepted && budget?.reservationId && identity?.tenantId) {
      releaseSeedanceBudget(identity.tenantId, budget.reservationId);
    }
    const reason = summarizeSeedanceError(e);
    console.error('[studio] Seedance video generation failed:', e);
    res.json({ ok: false, source: 'seedance', error: `Seedance 视频生成失败：${reason}` });
  }
});

// POST /studio/storyboard-quality-check
// 对单个已生成分镜抽帧质检，返回结构化评分和需要人工关注的问题。
studioRouter.post('/storyboard-quality-check', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { materialId = '', storyboard = '', productInfo = '', critical = false } = req.body ?? {};
  const material = loadMaterials().find(item => item.id === String(materialId) && (item.scope === 'shared' || item.tenantId === tenantId));
  if (!material || material.type !== 'video' || !material.file) {
    res.status(404).json({ ok: false, error: '找不到可质检的本地视频素材' });
    return;
  }
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    res.status(423).json({ ok: false, error: 'GEMINI_API_KEY 未配置，无法执行视觉质检' });
    return;
  }
  fs.mkdirSync(GENERATED_MEDIA_DIR, { recursive: true });
  const cosTempPath = material.objectKey ? path.join(GENERATED_MEDIA_DIR, `quality-source-${material.id}${path.extname(material.file) || '.mp4'}`) : '';
  const filePath = cosTempPath || path.join(MEDIA_DIR, material.file);
  if (material.objectKey) {
    const downloaded = await r2Download(material.objectKey);
    if (downloaded?.buf.length) fs.writeFileSync(filePath, downloaded.buf);
  }
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ ok: false, error: '质检视频文件不存在' });
    return;
  }
  const tempDir = fs.mkdtempSync(path.join(GENERATED_MEDIA_DIR, 'quality-'));
  try {
    const framePattern = path.join(tempDir, 'frame-%02d.jpg');
    await execFileAsync(String(ffmpegStatic), [
      '-hide_banner', '-loglevel', 'error', '-i', filePath,
      '-vf', 'fps=1/2,scale=640:-2', '-frames:v', '5', '-q:v', '4', framePattern,
    ], 90_000);
    const frames = fs.readdirSync(tempDir)
      .filter(name => /^frame-\d+\.jpg$/i.test(name))
      .sort()
      .slice(0, 5)
      .map(name => ({ inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(path.join(tempDir, name)).toString('base64') } }));
    if (!frames.length) throw new Error('没有提取到可分析画面');
    const prompt = `你是电商短视频质检员。根据连续抽帧检查这个分镜是否可用于发布。
分镜要求：${String(storyboard).slice(0, 1800)}
产品真实资料：${String(productInfo).slice(0, 1600)}
是否关键真实性镜头：${critical ? '是' : '否'}

重点检查：商品外观/颜色/包装一致性、错误文字或Logo、人物脸手异常、黑帧闪烁迹象、画面连续性、是否符合分镜动作、是否出现未经资料支持的证书参数或工厂声明。
只返回JSON：{"score":0-100,"passed":boolean,"issues":["问题"],"strengths":["优点"],"recommendation":"通过/人工复核/重新生成","checks":{"productConsistency":0-100,"visualIntegrity":0-100,"storyboardMatch":0-100,"textSafety":0-100,"authenticity":0-100}}。关键镜头有真实性疑点时 passed 必须为 false。`;
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_QUALITY_MODEL || 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }, ...frames] }],
      config: { responseMimeType: 'application/json', temperature: 0.1 },
    } as any);
    const raw = String((response as any).text || '').trim();
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
    const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
    res.json({
      ok: true,
      quality: {
        score,
        passed: Boolean(parsed.passed) && score >= (critical ? 85 : 75),
        issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 8).map(String) : [],
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 6).map(String) : [],
        recommendation: String(parsed.recommendation || ''),
        checks: parsed.checks && typeof parsed.checks === 'object' ? parsed.checks : {},
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : '分镜质检失败' });
  } finally {
    try {
      for (const name of fs.readdirSync(tempDir)) fs.unlinkSync(path.join(tempDir, name));
      fs.rmdirSync(tempDir);
    } catch { /* best effort */ }
    if (cosTempPath) fs.rmSync(cosTempPath, { force: true });
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
    `Generate one ${duration}-second vertical commercial social video in ${langName(language)}, aspect ratio ${ratio}.`,
    'Treat the storyboard timecodes and the fields named Omni prompt / Omni negative prompt as the highest-priority visual instructions.',
    `Storyboard:\n${String(script).slice(0, 7000)}`,
    productInfo ? `Identity and product context (preserve appearance exactly; do not invent claims):\n${String(productInfo).slice(0, 1800)}` : '',
    'Reproduce only explicitly observed actions. An inferred intent explains why an image works, but it is not permission to invent a missing action. Never turn a causal gap into an on-screen event.',
    'For every beat, preserve the exact object state before and after the action, hand visibility, physical contact, gaze direction, head pose, framing, and whether the camera is static. Fast actions must start and end at the written sub-second boundary.',
    'Use realistic UGC optics, skin texture, eye reflections, tissue deformation and moisture. Preserve temporal continuity and subject identity. Do not beautify, recolor eyes, add tears, wiping, extra fingers, extra hand motion, camera moves, captions, platform UI, logos, or transitions unless explicitly requested.',
    'Do not render interface overlays or unreadable text into the video; overlays and verified captions are added in post-production.',
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
    console.log(`[studio] TTS response sent headers=${res.headersSent} ended=${res.writableEnded}`);
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
    generationMode = '',
    audience = '',
    sellingPoints = '',
    tone = 'high-converting',
    videoTheme = {},
    referenceTitle = '',
    referenceAnalysis = '',
    referenceHighlights = [],
    materialInfos = [],
    existingScripts = [],
    variantSeed = 0,
    provider,
  } = req.body ?? {};
  const lang = langName(language);
  const clips = (materials as string[]).join(', ') || '(generic product clips)';
  const normalizedMaterialInfos = normalizeMaterialInfos(materialInfos, materials, Number(duration) || 20);
  const structuredMaterials = materialInfoLines(normalizedMaterialInfos);
  const product = productInfo || '';
  // Long benchmark videos can easily exceed 8k characters once every shot,
  // beat, dialogue and sound cue is serialized. Preserve the full working
  // timeline instead of silently dropping the latter half before generation.
  const reference = String(referenceAnalysis || '').slice(0, 40_000) || '(no detailed reference analysis provided)';
  if (generationMode === 'clone') {
    const timelineQuality = referenceTimelineQuality(referenceAnalysis, duration);
    if (!timelineQuality.valid) {
      res.status(422).json({
        ok: false,
        error: `对标逐镜分析不满足脚本生成标准：${timelineQuality.issues.join('；')}。请先完成全片精确分析。`,
        code: 'REFERENCE_EXACT_ANALYSIS_REQUIRED',
        requiresExactAnalysis: true,
        validationIssues: timelineQuality.issues,
      });
      return;
    }
  }
  const highlights = Array.isArray(referenceHighlights) && referenceHighlights.length
    ? referenceHighlights.slice(0, 8).map((item: unknown) => `- ${String(item).slice(0, 180)}`).join('\n')
    : '- No reliable highlights. Infer a simple product-first structure from title, platform, and product info.';
  const forbiddenTerms = referenceForbiddenTerms({ referenceTitle, materials, referenceHighlights, referenceAnalysis });
  const forbiddenIndustryTerms = referenceIndustryLeakTerms(`${referenceTitle}\n${referenceAnalysis}\n${highlights}`, productInfo);
  const forbiddenLine = forbiddenTerms.length
    ? `Reference-only forbidden terms: ${forbiddenTerms.join(', ')}. Do not output these words, hashtags, brand names, original captions, or original product claims.`
    : 'Do not output reference-video brand names, hashtags, original captions, or original product claims.';
  // 产品分镜固定走千问，避免跟随工作台的全局模型选择误切到 Gemini。
  const effectiveProvider = generationMode === 'product' ? 'qwen' : provider;
  const providerOpt = effectiveProvider === 'qwen' || effectiveProvider === 'gemini' ? effectiveProvider : undefined;
  const selectedProductBrief = productBrief(productInfo);
  const selectedProductCategory = selectedProductBrief.category || compactBriefCategory(selectedProductBrief);
  const normalizedVideoTheme = typeof videoTheme === 'object' && videoTheme ? videoTheme as Record<string, unknown> : {};
  const videoThemeId = String(normalizedVideoTheme.id || 'buyer_pain');
  const videoThemeTitle = String(normalizedVideoTheme.title || '买家痛点');
  const videoThemePainPoint = String(normalizedVideoTheme.painPoint || '').trim();
  const videoThemeConversionGoal = String(normalizedVideoTheme.conversionGoal || '').trim();
  const themeDirectives: Record<string, string> = {
    buyer_pain: '以一个具体的买家顾虑开场，后续至少两个镜头必须用可见证据回应同一个顾虑。',
    product_proof: '先提出“仅凭图片难判断”的问题，再用规格、包装、细节或真实素材逐项建立证据。',
    use_case: '只围绕一个已被资料或素材支持的使用场景，用动作解释产品价值，不能虚构效果。',
    supplier_capability: '围绕批量供货或质量稳定顾虑，只使用已有工厂、产线、质检、产能和交付证据。',
    customization: '围绕品牌适配顾虑，只展示资料明确提供的包装、标识、规格或定制选项。',
    faq: '用一个真实采购问题作为开场，每段只回答一个相关信息点，答案必须来自企业资料。',
    comparison: '使用统一、可验证的维度帮助选型，不贬低竞品，不引入资料外参数。',
    customer_case: '仅使用已确认并可公开的客户问题、过程和结果；缺少案例证据时不得编造故事。',
    trend: '趋势只作为切入角度，必须有输入来源；产品结论仍只能来自企业资料和素材证据。',
  };
  const videoThemeRules = `本条视频主题（系统已自动匹配脚本策略，不要在输出中解释）：
- 主题：${videoThemeTitle}
- 潜在客户痛点：${videoThemePainPoint || '根据企业资料做保守判断，不得虚构市场结论'}
- 转化目标：${videoThemeConversionGoal || '使用一个低门槛、不过度承诺的会话式行动'}
- 主题叙事要求：${themeDirectives[videoThemeId] || themeDirectives.buyer_pain}
- 痛点必须由后续证据回应，不能只出现在第一句；CTA必须承接同一问题。`;
  const humanVoiceRules = `真人表达规则（仅作用于台词、口播和字幕，不改变时间轴及机器字段）：
- 像一个懂产品的人对一个具体买家说话，一句话只完成一个沟通动作；中文优先短句，英文通常每句7-16词。
- 先说买家在意的判断，再说产品；不要朗读资料表，不要连续使用“先看、再看、最后”。
- 禁止“革命性、颠覆、卓越解决方案、Meet our、Are you ready、Look no further、Contact us today”等模板广告腔。
- 不得把“未提供、待确认、没有素材、资料不足、系统检查”等内部审核语言说给客户；未知信息直接省略。
- CTA像正常商务邀请，只保留一个动作，不虚构样品、MOQ、库存、交期或经销政策。`;
  const cloneMigrationMode = String(tone).includes('高保真复刻')
    ? 'fidelity'
    : String(tone).includes('机制借鉴')
    ? 'mechanism'
    : 'structure';
  const cloneMigrationPolicy = cloneMigrationMode === 'fidelity'
    ? '当前为“高保真复刻”：产品展示逻辑兼容，可保留环境、动作、构图和镜头顺序，但必须替换竞品品牌、型号、参数与不支持的事实。'
    : cloneMigrationMode === 'mechanism'
    ? '当前为“机制借鉴”：只保留钩子类型、信息揭示顺序、证明位置和节奏；环境、主体动作、构图与细节证明均按企业产品和现有素材重建。'
    : '当前为“结构迁移”：保留原片的时长比例、镜头功能、证明顺序、景别节奏与音画密度；必须按企业产品重建环境、主体动作和可见证据，禁止沿用跨品类场景和物体。';
  const cloneFusionRules = `爆款素材迭代规则（只在内部执行，不要输出规则或解释）：
0. ${cloneMigrationPolicy}
1. REFERENCE_ANALYSIS 是灵感大屏已经完成的原视频分析，是原片结构、音画和爆点的唯一事实来源；禁止重新分析、重新定义或套用固定营销模板。
2. 原分析有多少段就输出多少段；逐段保留时间、顺序、时长比例、镜头功能、景别节奏、配乐和节拍。环境、构图与动作是否保留必须服从第 0 条迁移方式。不得合并、补段、重排或改成固定 5 段。
3. 爆点可能是视觉揭晓、动作、反差、细节、音效、卡点、人物反应、字幕或 CTA，不得把“采购痛点”默认当作爆点。
4. 只做受约束的产品替换：把原产品对象、品牌和型号替换为“产品信息”中的选定产品；没有冲突的场景、动作、镜头关系和节奏全部保留。
5. 原片没有口播就输出“台词：无”；原片没有屏幕文字就输出“字幕：无”；原片没有 CTA 就不得新增 CTA。
6. 不得新增人物、剧情、CTA 或镜头功能。但必须在原片现有的产品展示、细节特写、口播或字幕位中，写入选定产品名称和至少 1 个企业中心已核实事实（如规格、材质、定制能力、MOQ 或认证）；只能使用产品资料中真实存在的字段。
7. 不得把分析中的表达意图、改编建议、未展示因果写进实际画面；只允许使用原分析记录的可见、可听内容。
8. 缺失信息用“无”或“沿用原片”表达，禁止用想象补齐。分析缺少逐镜详情时应拒绝生成，不得降级为自由创作。
9. 输出必须干净：只输出时间戳分镜成稿，不输出标题、前言、总结、映射表、自检、Markdown、代码围栏或分析说明。`;
  const previousCloneScripts = Array.isArray(existingScripts)
    ? existingScripts.map(item => String(item || '').trim()).filter(Boolean).slice(-4)
    : [];
  const cloneDiversityRules = previousCloneScripts.length
    ? `\n当前生成第 ${Math.max(1, Number(variantSeed) + 1)} 版。以下是已经生成的版本，仅用于排重，严禁复制：\n${previousCloneScripts.map((item, index) => `--- 已有版本 ${index + 1} ---\n${item.slice(0, 6000)}`).join('\n')}\n新版本必须保持原片时间轴和镜头功能，但至少改变以下三项：开场呈现动作、产品证明动作、场景陈设、镜头内产品顺序、台词句式、字幕表达。不得只替换同义词。`
    : '';

  const productDuration = Math.max(10, Number(duration) || 20);
  const productBoundaries = [0, .18, .4, .62, .82, 1].map(value => +(value * productDuration).toFixed(1));
  const productTimeline = productBoundaries.slice(0, -1).map((start, index) => {
    const end = productBoundaries[index + 1];
    const maxChars = Math.max(4, Math.floor(Math.max(0.5, end - start - 0.5) * 4));
    return `第${index + 1}段：[${start}-${end}s]，中文台词最多${maxChars}字（不含标点）`;
  }).join('\n');
  const productScriptRules = `你是严谨的商业短视频分镜导演。请为我方产品创作一条真实、可拍、音画时长成立的社媒带货/外贸留资视频，不是在朗读产品资料。

以下约束是输出协议，不是建议；任何一项不满足都视为无效脚本：
1. 必须恰好输出5段，严格使用下方给定时间段，不得改时间、重叠、留空或额外增加段落：
${productTimeline}
2. 每段必须依次包含且只包含：时间、环境、景别、运镜、镜头功能、画面、配乐、台词、字幕。不得缺字段，不得输出标题、解释、自检、Markdown或代码围栏。
3. 台词必须是镜头中真人能直接说出口的话，不得包含“镜头、画面、字幕、参考节奏、展示卖点”等制作指令；必须严格低于对应段落字数上限，宁可短句或写“无”，不可超时。
3. 每段画面必须是具体可拍动作，必须包含手部动作、产品动作、对比测试、包装/定制展示或使用场景之一。
4. 第一段必须是痛点、对比、测试或结果 hook，不能用“这款产品适合……”平铺开场。
5. 先判断转化目标：面向消费者时使用“场景痛点 → 使用动作 → 可见结果 → 购买理由”；面向采购商时使用“采购顾虑 → 实物证据 → 定制/交付能力 → 低门槛询盘”。不要混写两套话术。
6. 至少包含两个已核实的商业信息，但优先放在短字幕和画面资料卡里；口播只说买家最关心的好处，不朗读 MOQ、认证和参数清单。
7. 结尾 CTA 只要求一个低门槛动作，例如“发我数量和目标市场”“留言拿报价”“发包装需求看样”，不要一次索要五六项资料。
8. 参考视频只允许借用节奏、镜头顺序和信息密度；不得输出参考视频标题、原 caption、原品牌、原 hashtag、原品类、原场景词或原产品功效。
9. 产品事实采用封闭世界规则：只有“产品信息”明确提供的名称、数字、单位、周期、价格、MOQ、材质、规格、认证、功效和定制项才允许写入。允许不改变含义的单位转换（如 $20→20美元、50 pcs→50件），禁止创造资料中没有的数字（例如3天、12天、提升30%）；缺失信息直接省略，不得猜测。
10. 不得输出制作说明，不得解释规则，只输出成稿。
11. 原始卖点如果包含夸张绝对化表达，必须降级成可验证表述，例如“不易撕裂”“抗拉表现可打样测试”“承重可按需求确认”，不得写“不破、不裂、纹丝不动、吹不烂”等绝对承诺。
12. 只能使用下方“产品信息”里列出的选定产品。不得改成企业中心其它产品，不得写“企业产品组合/主推产品/this product”，不得使用对标视频原产品。
13. 多选产品时，脚本必须围绕这些选定产品组合呈现，至少在画面或字幕中覆盖每个选定产品的名称或明确细节，不得擅自新增未选择产品。
14. ${forbiddenLine}
15. 中文口播按每秒4字计算并预留0.5秒停顿；输出前必须在内部逐段计算字数，超出上限就缩短。优先短句、反问、口语停顿，避免“先看、再确认、逐项确认、可按需求确认”连续出现。
16. 优先使用产品资料中已经提供的容量、材质、充电方式、规格和定制项；把参数翻译成使用利益或采购价值，但不得用跨品类的点亮、色温、安装、护肤功效等动作替代真实产品细节。
17. 五段情绪应有推进：意外/顾虑 → 看见亮点 → 证据加深 → 品牌想象 → 立即行动。相邻两段不能用相同句式开头。

固定格式（每段完整重复，不得省略）：
[start-end s]
环境：<具体地点与可见陈设>
景别：<远景/全景/中景/中近景/近景/特写之一>
运镜：<固定/推进/拉远/横移/跟拍/环绕之一，并说明动作>
镜头功能：<单一功能>
画面：<主体+动作+可见结果，不能写抽象意图>
配乐：<音乐或音效及其节奏>
台词：<字数不超过本段上限；没有必要则写“无”>
字幕：<短字幕；不能引入产品资料以外的新事实>

最终输出前在内部检查但不要输出检查过程：字段完整；时间连续；台词不超时；所有产品数字均可在产品信息中逐字找到；没有编造效果与承诺。语言为${lang}。`;

  const materialScriptRules = `你是在把“已选素材库片段”剪成一条有销售情绪的社媒带货/外贸留资视频。素材约束留在画面说明中，人物口播必须始终面向潜在买家，不能说后台审核语言。

核心原则：
1. 每个时间戳段必须绑定一个具体素材名，不能只写泛泛产品话术。
2. 只能根据素材元信息做保守推断：素材名、类型、角色、原始时长、建议时间段。没有真实画面识别时，不得编造画面里出现的人、场景、动作或效果。
3. “原始时长”只是文件长度，“建议有效时长”才是当前脚本可使用的动作长度。禁止为了填满目标时长而慢放、循环或重复同一个动作，除非分段观察明确支持。
4. 画面字段必须写“使用素材《素材名》...”并说明剪辑重点，例如截取开头、细节处、动作最清楚处、包装/样品处。
5. 每段承担不同剪辑任务：开场、细节、使用/对比、供应能力、定制/包装、CTA。
6. 口播必须承接该素材的角色并形成连续销售逻辑：第一段让人停留，中段把可见细节变成购买理由，最后一段只给一个低门槛行动。不能每段复用同一句式。
7. 如果素材信息不足，只能写“按该素材可见内容剪辑”，不能伪装已经识别出画面。尤其禁止从液体滴落推断吸收、渗透、淡纹、美白、祛痘或其它功效。
8. “按可见内容剪辑、不得推断、资料可确认”只能写进画面字段，禁止出现在人物说中。禁止口播“先看素材、这段只按可见内容、逐项确认”等制作/审核腔。
9. 中文口播按每秒约4-5字并预留0.5秒停顿；优先使用短反问、短判断和自然停顿，让相邻台词有因果承接。
10. 必须严格按素材顺序生成 ${Math.max(1, normalizedMaterialInfos.length)} 段左右，时间段必须使用“建议时间段”，不得把单一动作擅自扩写到整个目标时长。
11. 输出只给成稿，不解释规则。

固定格式：
[start-end s]
素材：<素材名>
画面：<基于该素材的剪辑方式，必须提到素材名>
人物说：“<真人能说出口的一句话>”
字幕：<短字幕>`;

  const prompt = generationMode === 'material'
    ? `${materialScriptRules}

${videoThemeRules}

${humanVoiceRules}

素材清单：
${structuredMaterials || '无可用素材。请拒绝生成，并提示先上传素材。'}

产品信息：
${product || '未选择产品。只能围绕素材做保守剪辑建议，不得编具体产品。'}

目标平台：${platform}
目标受众：${audience || '海外 B2B 买家、小批量试单买家、渠道采购商'}
补充卖点：${sellingPoints || '仅使用产品信息中已提供的卖点'}
风格：${tone || '真实、可拍、素材优先、询盘导向'}

请直接输出按素材逐段绑定的时间戳脚本。`
    : generationMode === 'product'
    ? `${productScriptRules}

${videoThemeRules}

${humanVoiceRules}

	产品信息：
	${product || '未选择产品。请拒绝生成具体产品脚本。'}

目标平台：${platform}
目标受众：${audience || '海外 B2B 买家、小批量试单买家、渠道采购商'}
补充卖点：${sellingPoints || '仅使用产品信息中已提供的卖点'}
风格：${tone || '真实、可拍、询盘导向'}
素材信息：${clips}

请直接输出脚本。`
    : scriptType === 'storyboard'
    ? `你是爆款参考视频的受约束迭代导演。你不负责重新设计营销结构，只负责在保留原片结构和爆点的前提下完成最小必要的产品替换。
请生成 ${platform} 分镜脚本，语言为 ${lang}。总时长、分镜数量和时间段必须跟随对标视频脚本详析，不得套用 ${duration} 秒或固定段数模板。

已选素材：${clips}
产品信息：
	${product || '未选择产品。请拒绝生成具体产品脚本。'}
产品行业锁定：${selectedProductCategory || '以产品信息为准'}
目标受众：${audience || '根据产品和平台推断'}
核心卖点：${sellingPoints || '从产品信息中提炼，不得编造'}
风格：${tone}
对标视频标题：已隐藏，禁止猜测或补写
对标视频分析：
${reference}
可复用的爆款亮点：
${highlights}
${forbiddenLine}

${cloneFusionRules}
${cloneDiversityRules}

${videoThemeRules}
注意：爆款裂变中，主题只能适配原片已有的钩子、口播、字幕和证明位置；不得为了套主题新增镜头、CTA或改变原片爆点机制。

${humanVoiceRules}

每个场景必须严格对应“对标视频脚本详析”的同一时间段，不要合并、跳段或擅自重排。使用以下固定格式，不要 markdown 符号，不要缺字段：
[start-end s]
环境：<按迁移方式保留原环境，或重建为适合企业产品的可拍场景>
景别：<照抄原详析景别>
运镜：<照抄原详析运镜>
镜头功能：<钩子/效果证明/价格反差/产品介绍/信任证明/CTA等单一主要功能>
画面：<保留该段镜头功能与卡点节奏；高保真时做产品替换，结构迁移/机制借鉴时必须按企业产品重建可执行动作与可见证据>
配乐：<照抄或贴近原详析配乐音效>
台词：<仅当原分析同一镜头存在口播/对白时保留或做必要产品替换，否则写“无”>
字幕：<仅当原分析同一镜头存在屏幕文字时保留或做必要产品替换，否则写“无”>

硬性规则：
- 逐段保留对标视频的时间段、镜头功能、景别节奏、配乐形态和卡点密度；环境、动作、构图和产品证据必须服从“${cloneMigrationMode}”迁移策略。
- “可见事实”优先级高于标题、口播和表达意图。必须依据相邻密集帧定位动作边界；首帧已经存在的湿润、遮挡、手势或物体状态必须写成初始状态，不能倒推出未拍到的形成过程。
- “表达意图”和“未展示因果”只能帮助理解创意，不得进入实际画面；禁止把推断写成已发生的动作。
- 如果对标视频与选定产品跨品类，不得直接做名词替换；必须保留镜头功能和节奏，重建与企业产品相符的场景、动作、构图和证明内容。
- 不得出现对标视频原行业、原品类、原产品功效；但可以保留无行业冲突的环境、色彩、造型、动作、音效和节奏描述。
- 原片开头依靠什么形成 hook，就保留什么；禁止默认改成采购顾虑或销售口播。
- 原片相邻镜头允许使用相同环境和机位；不得为了“丰富”而擅自改场景、加动作或增加剧情功能。
- 原片镜头数量、切点和内容功能优先级高于目标时长参数；目标时长仅在原分析明确缺失时作为兜底。
- 画面不能写“真实使用场景”“痛点特写”这种空泛词，必须写清楚人物在什么环境里做什么动作，镜头拍到什么具体物件或结果。
- 不要写 generic phrases like "premium quality", "high conversion", "boost sales", "worth buying"，除非绑定具体产品细节。
- 不得复制或提及对标视频标题、原 caption、hashtag、品牌名、原品类、原产品功效。
- 成稿必须出现选定产品名称，并至少使用 1 个“产品信息”中的已核实卖点或规格；不能只把竞品名换成泛称。
- 不得输出分析摘要、基础要求、竞品识别、产品替换说明、成片目标或任何“对标视频”说明，只输出新的可拍分镜。
- 缺少数据时写“无”或“沿用原片”，不得新增样品、报价或 CTA。
- 最终只输出 storyboard 成稿。`
    : `You are a senior short-video copywriter for a Chinese cross-border e-commerce seller.
Write a practical ${duration}-second ${platform} voiceover script in ${lang}.

Selected clips: ${clips}
	Product info: ${product || 'No selected product. Do not invent a product.'}
Target audience: ${audience || '(infer from product and platform)'}
Key selling points: ${sellingPoints || '(infer from product info)'}
Tone/style: ${tone}
Reference video title: ${referenceTitle || '(unknown)'}
Reference video analysis:
${reference}
Reference highlights to reuse:
${highlights}
${forbiddenLine}

${videoThemeRules}

${humanVoiceRules}

Requirements:
- Exactly three sections, each on its own block, labelled like "[Hook · 0-3s]", "[Body · 3-${duration - 5}s]", "[CTA · ${duration - 5}-${duration}s]".
- Each section must contain 1-3 short spoken lines only, in ${lang}.
- The hook must mention a concrete buyer pain, use case, visible product result, or sourcing problem in the first line.
- The body must include at least two concrete details from product info, such as MOQ, material, packaging, certification, market, sample speed, shade/range, usage result, or delivery condition.
- The CTA must ask for a specific B2B action: sample, quote, catalog, color list, packaging plan, or MOQ confirmation.
- Do NOT write generic phrases like "premium quality", "stable solution", "high conversion", "everyone is asking", unless backed by a concrete detail.
- Reuse the reference video's rhythm, not its exact product or claims.
- Do not copy or mention the reference video's title, original caption, hashtags, brand names, original product category, or original product claims.
- Output ONLY the script text.`;

  try {
    const text = await callLLM(prompt, { backend: providerOpt, systemPrompt: await enterpriseCtx() || undefined });
    const script = normalizeScriptTimestamps(enforceProductNameInScript(stripScriptAnalysisSummary(text), productInfo));
    const selectedNames = selectedProductNames(productInfo);
    const unsupportedNumberClaims = Array.from(script.matchAll(/\d+(?:\.\d+)?\s*(?:瓶|ml|ML|毫升|kg|KG|g|克|斤|cm|厘米|mm|毫米|天|day|days|Days|秒|%|个|pcs|件|箱|元|美元)/g))
      .map(match => match[0])
      .filter(claim => !productSupportsNumericClaim(claim, productInfo));
    const missingProduct = !String(productInfo || '').trim();
    const missingSelectedProduct = selectedNames.length > 0
      && selectedNames.some(name => !script.toLowerCase().includes(name.toLowerCase()));
    const speechIssues = storyboardSpeechIssues(script);
    const groundingIssues = generationMode === 'material'
      ? materialGroundingIssues(script, productInfo, structuredMaterials)
      : [];
    const incompleteCloneStoryboard = generationMode === 'clone'
      && (!/环境[：:]/.test(script)
        || !/景别[：:]/.test(script)
        || !/运镜[：:]/.test(script)
        || !/配乐[：:]/.test(script)
        || !/台词[：:]/.test(script));
    const genericCloneStoryboard = generationMode === 'clone'
      && /真实使用场景|痛点特写|买家最关心的结果|采购这类|先看真实使用效果|把「[^」]+」放到真实使用场景/.test(script);
    const productStoryboardFields = ['环境', '景别', '运镜', '镜头功能', '画面', '配乐', '台词', '字幕'];
    const productStoryboardBlocks = script.split(/(?=^\[[^\]]+\]\s*$)/m).filter(block => /^\[[^\]]+\]/.test(block.trim()));
    const incompleteProductStoryboard = generationMode === 'product'
      && (productStoryboardBlocks.length !== 5
        || productStoryboardBlocks.some(block => productStoryboardFields.some(field => !new RegExp(`^${field}[：:]`, 'm').test(block))));
    const unsafeScript = missingProduct
      || missingSelectedProduct
      || /参考节奏|Reference video|对标视频|基础要求|分析摘要|竞品识别|产品替换|参考爆款|成片目标|指定画风|核心情绪|行业锁定|结构迁移|不迁移行业|不继承原视频|企业产品组合|主推产品|<具体|不得|必须满足/.test(script)
      || /不破|不裂|纹丝不动|吹不烂|保证|最快|最低价|全网|no tear|won'?t tear|never breaks?|unbreakable/i.test(script)
      || unsupportedNumberClaims.length > 0
      || incompleteCloneStoryboard
      || incompleteProductStoryboard
      || genericCloneStoryboard
      || hasRepetitiveStoryboard(script)
      || hasUnnaturalVoiceover(script)
      || speechIssues.length > 0
      || groundingIssues.length > 0;
    const invalidProductScript = generationMode === 'product'
      && (/人物说[：:][^\n]*(镜头|画面|字幕|参考节奏|展示卖点|制作)/.test(script)
        || /Scene N/.test(script));
    const leakedReference = forbiddenTerms.some(term => new RegExp(`(^|[^A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9])`, 'i').test(script))
      || forbiddenIndustryTerms.some(term => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(script))
      || /#[A-Za-z][A-Za-z0-9_-]{2,}/.test(script);
    const validationIssues = [
      missingProduct ? '缺少产品信息' : '',
      missingSelectedProduct ? `脚本未完整覆盖选定产品名称：${selectedNames.join('、')}` : '',
      unsupportedNumberClaims.length ? `出现产品资料未提供的数字：${unsupportedNumberClaims.join('、')}` : '',
      incompleteCloneStoryboard ? '爆款分镜缺少环境、景别、运镜、配乐或台词字段' : '',
      incompleteProductStoryboard ? '产品分镜必须为5段，且每段完整包含环境、景别、运镜、镜头功能、画面、配乐、台词和字幕' : '',
      genericCloneStoryboard ? '爆款分镜包含不可执行的泛化镜头描述' : '',
      hasRepetitiveStoryboard(script) ? '分镜或口播内容重复度过高' : '',
      hasUnnaturalVoiceover(script) ? '口播过长或堆叠过多技术名词' : '',
      invalidProductScript ? '产品模式把制作指令写进了人物口播' : '',
      leakedReference ? '脚本包含对标来源、品牌、行业或Hashtag泄漏' : '',
      ...speechIssues,
      ...groundingIssues,
      /参考节奏|Reference video|对标视频|基础要求|分析摘要|竞品识别|产品替换|参考爆款|成片目标|指定画风|核心情绪|行业锁定|结构迁移|不迁移行业|不继承原视频|企业产品组合|主推产品|<具体|不得|必须满足/.test(script) ? '脚本泄漏了生成规则或占位说明' : '',
      /不破|不裂|纹丝不动|吹不烂|保证|最快|最低价|全网|no tear|won'?t tear|never breaks?|unbreakable/i.test(script) ? '脚本包含绝对化或不可验证承诺' : '',
    ].filter(Boolean);
    const shouldFallback = validationIssues.length > 0 || unsafeScript;
    const fallback = generationMode === 'material'
      ? fallbackMaterialStoryboard(normalizedMaterialInfos, Number(duration) || 20, productInfo)
      : fallbackStoryboard(duration, productInfo);
    res.json({
      ok: true,
      source: shouldFallback ? 'fallback' : 'ai',
      script: shouldFallback ? (generationMode === 'clone' ? '' : fallback) : script,
      fallbackReason: shouldFallback ? validationIssues[0] || '脚本未通过安全与可执行性检查' : undefined,
      validationIssues: shouldFallback ? validationIssues : [],
    });
  } catch (error) {
    const rawError = String(error instanceof Error ? error.message : error);
    console.warn('[studio] script generation fell back:', rawError.slice(0, 500));
    const publicFailureReason = /429|RESOURCE_EXHAUSTED|prepayment credits|quota|billing/i.test(rawError)
      ? '上游模型额度不足，已自动切换为安全兜底稿'
      : /401|403|api.?key|unauthorized|permission/i.test(rawError)
        ? '上游模型授权暂不可用，已自动切换为安全兜底稿'
        : /timeout|timed out|超时|503|502|504|UNAVAILABLE/i.test(rawError)
          ? '上游模型暂时繁忙，已自动切换为安全兜底稿'
          : '上游模型生成失败，已自动切换为安全兜底稿';
    res.json({
      ok: true,
      source: 'fallback',
      script: generationMode === 'clone'
        ? ''
        : generationMode === 'material'
        ? fallbackMaterialStoryboard(normalizedMaterialInfos, Number(duration) || 20, productInfo)
        : scriptType === 'storyboard' ? fallbackStoryboard(duration, productInfo) : fallbackScript(productInfo, duration),
      fallbackReason: publicFailureReason,
      validationIssues: [publicFailureReason],
    });
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
    const text = await callLLM(prompt, { backend: providerOpt, systemPrompt: await enterpriseCtx() || undefined });
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
// POST /studio/fb-poster  Body: { mode, productInfo, platform, ratio, posterStyle, language, materials? }
studioRouter.post('/fb-poster', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const {
    mode = 'product',
    productInfo = '',
    platform = 'facebook',
    ratio = '1:1',
    posterStyle = 'oem-factory',
    language = 'en',
    provider,
    materials = [],
    referenceNotes = '',
  } = req.body ?? {};
  const providerOpt = provider === 'qwen' || provider === 'gemini' ? provider : undefined;
  const lang = langName(language);
  const materialLines = Array.isArray(materials)
    ? materials.slice(0, 8).map((item: any, index: number) => `${index + 1}. ${String(item?.name || item || '').slice(0, 120)}${item?.role ? ` (${item.role})` : ''}`).join('\n')
    : '';
  const modeGuide = mode === 'clone'
    ? [
        'First modularly deconstruct the reference poster into reusable layout modules: headline zone, product hero, background atmosphere, factory/proof strip, badges, process row, category cards, CTA/bottom bar, and caption framework.',
        'Then map each reusable module to local/enterprise assets: replace competitor product with our product photo, reuse only generic background/composition style, match factory/proof modules with factory/certificate assets, and rebuild copy from verified enterprise/product info.',
        'Do not copy competitor brand, logo, certifications, price, MOQ, lead time, export country, factory qualification, or any unverified commercial promise.',
      ].join(' ')
    : mode === 'material'
      ? 'Use selected material names as evidence for product photo, factory photo, packaging, certificate, and scene sections.'
      : 'Use enterprise profile and product info as the primary source.';

  const prompt = `You are a senior B2B social media creative director for overseas OEM/ODM suppliers.
Create a structured poster brief and ${platform} caption in ${lang}.

Generation channel: ${mode}
Channel rule: ${modeGuide}
Poster style: ${posterStyle}
Canvas ratio: ${ratio}
Product / enterprise info:
${productInfo || '(use enterprise profile if available)'}

Selected material references:
${materialLines || '(none selected yet)'}

Reference / inspiration notes:
${String(referenceNotes || '').slice(0, 1500) || '(none)'}

Hard rules:
- AI may optimize expression, but must not invent commercial promises.
- MOQ, certifications, lead time, price, export countries, factory qualifications must come from product / enterprise info or be placed in fieldsToConfirm.
- If Generation channel is clone, output a module-level deconstruction and local asset matching plan. The final poster must be a new composition using our product/materials, not a copy of the competitor poster.
- Poster text should be concise enough for a dense B2B OEM poster.
- Use exact English text for poster fields when language is English.
- Return ONLY valid JSON. No markdown.

Schema:
{
  "layoutModules": [
    {
      "module": "headline zone / product hero / background / factory proof / badges / process row / category cards / CTA bar",
      "referencePattern": "what to reuse from the viral poster structure or style",
      "localAssetRole": "product photo / factory image / packaging image / certificate image / scene image / brand visual / none",
      "replacementInstruction": "how to replace competitor content with our verified assets and copy"
    }
  ],
  "poster": {
    "headline": "string",
    "subheadline": "string",
    "originBadge": "string",
    "trustBadges": ["GMP", "ISO"],
    "sellingPoints": ["Natural Ingredients"],
    "process": ["Consultation", "Formula Development", "Packaging Design", "Production", "Quality Control", "Delivery"],
    "categories": [{"name":"Essential Oil","description":"short text"}],
    "bottomBar": ["Low MOQ from ..."],
    "cta": "string"
  },
  "caption": "3 short paragraphs with emoji hooks and CTA",
  "hashtags": ["oem", "privatelabel"],
  "commentCta": "string",
  "dmOpening": "string",
  "fieldsToConfirm": ["MOQ", "certifications"],
  "imagePrompt": "detailed prompt for a no-extra-text B2B OEM poster image model; include layoutModules as composition guidance, include all poster text exactly as above, mention product replacement, background/style reuse, local material roles, sections, and layout"
}`;

  const backends = providerOpt
    ? [providerOpt, providerOpt === 'qwen' ? 'gemini' : 'qwen'] as const
    : ['qwen', 'gemini'] as const;
  const failures: string[] = [];
  for (const backend of backends) {
    try {
      const text = await callLLM(prompt, { backend, systemPrompt: await enterpriseCtx() || undefined });
      const obj = extractJSON<any>(text);
      if (obj?.poster?.headline && obj?.caption) {
        res.json({
          ok: true,
          source: 'ai',
          provider: backend,
          layoutModules: Array.isArray(obj.layoutModules) ? obj.layoutModules.slice(0, 12) : [],
          poster: normalizePosterBrief(obj.poster),
          caption: String(obj.caption || ''),
          hashtags: Array.isArray(obj.hashtags) ? obj.hashtags.map(String).slice(0, 10) : [],
          commentCta: String(obj.commentCta || ''),
          dmOpening: String(obj.dmOpening || ''),
          fieldsToConfirm: Array.isArray(obj.fieldsToConfirm) ? obj.fieldsToConfirm.map(String).slice(0, 12) : [],
          imagePrompt: String(obj.imagePrompt || ''),
        });
        return;
      }
      failures.push(`${backend}: parse_failed`);
    } catch (err: any) {
      failures.push(`${backend}: ${String(err?.message || err).slice(0, 180)}`);
    }
  }
  console.warn('[studio] fb-poster LLM fallback:', failures.join(' | '));
  res.json({ ok: true, source: 'fallback', ...fallbackPosterBrief({ productInfo, platform, ratio, posterStyle, language }) });
});

// POST /studio/lead-content-package
// 基于竞品公开图文证据 + 企业中心真实资料，生成“吸引—解释—信任”三条连续获客内容。
studioRouter.post('/lead-content-package', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { productInfo = '', platform = 'instagram', language = 'en', ratio = '4:5', referenceEvidence = null, referenceTitle = '' } = req.body ?? {};
  if (!referenceEvidence?.observedFacts?.length) { res.status(400).json({ error: '缺少可信的竞品逐图证据，不能生成获客内容包' }); return; }
  const enterprise = await enterpriseCtx();
  const prompt = `你是外贸 B2B 社媒获客内容总监。请基于企业真实资料和竞品公开图文的结构化证据，生成三条连续图文内容：吸引目标买家、解释合作能力、建立供应商信任。

企业资料（唯一商业事实来源）：
${enterprise || '(企业中心资料为空)'}

当前选择产品：
${String(productInfo || '(未选择产品)').slice(0, 5000)}

竞品标题（仅用于定位参考，不得复制）：${String(referenceTitle || '').slice(0, 300)}
竞品证据：
${JSON.stringify(referenceEvidence).slice(0, 12000)}

平台：${platform}；语言：${langName(language)}；比例：${ratio}

硬规则：
- 只复用竞品的通用布局、信息层级、色彩关系和轮播功能；禁止复制竞品品牌、Logo、产品、包装、联系方式和原句。
- MOQ、价格、认证、交期、出口国家、工厂年限等只能来自企业资料；缺失时写入 fieldsToConfirm，不能出现在 poster 或 caption。
- 三条内容必须分别服务 buyer_attention、capability_explanation、supplier_trust，不是三张相似 A/B 图。
- 每条建议 5 张轮播，每张都必须有明确 role、headline、body、assetRole；文字简洁。
- 输出合法 JSON，不要 markdown。

Schema:
{
  "strategySummary":"string",
  "referenceModulesUsed":[{"module":"string","evidence":"string","application":"string"}],
  "items":[{
    "role":"buyer_attention|capability_explanation|supplier_trust",
    "title":"string",
    "objective":"string",
    "slides":[{"index":1,"role":"attention|product|detail|process|proof|cta","headline":"string","body":"string","assetRole":"product image|factory image|certificate image|packaging image|scene image|brand visual|none"}],
    "caption":"string",
    "hashtags":["string"],
    "cta":"string",
    "dmOpening":"string",
    "imagePrompt":"string"
  }],
  "fieldsToConfirm":["string"]
}`;
  const failures: string[] = [];
  for (const backend of ['qwen', 'gemini'] as const) {
    try {
      const text = await callLLM(prompt, { backend, systemPrompt: enterprise || undefined });
      const parsed = extractJSON<any>(text);
      if (Array.isArray(parsed?.items) && parsed.items.length >= 3) {
        res.json({ ok: true, source: 'ai', provider: backend, strategySummary: String(parsed.strategySummary || ''), referenceModulesUsed: Array.isArray(parsed.referenceModulesUsed) ? parsed.referenceModulesUsed.slice(0, 12) : [], items: parsed.items.slice(0, 3), fieldsToConfirm: Array.isArray(parsed.fieldsToConfirm) ? parsed.fieldsToConfirm.map(String).slice(0, 20) : [] });
        return;
      }
      failures.push(`${backend}: parse_failed`);
    } catch (error) { failures.push(`${backend}: ${String((error as Error)?.message || error).slice(0, 180)}`); }
  }
  res.status(502).json({ error: '获客内容包生成失败', details: failures });
});

// POST /studio/fb-poster/render  Body: { poster, caption, imagePrompt, ratio, materialIds? }
studioRouter.post('/fb-poster/render', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const {
    poster = null,
    imagePrompt = '',
    ratio = '1:1',
    materialIds = [],
  } = req.body ?? {};
  const normalizedPoster = normalizePosterBrief(poster || {});
  const headline = normalizedPoster.headline || 'AI 图文海报';
  const references = await resolveReferenceImages(materialIds, tenantId);
  const prompt = [
    String(imagePrompt || '').trim(),
    'Generate one finished high-end B2B OEM/ODM social media poster image.',
    `Use this exact poster JSON as the content source:\n${JSON.stringify(normalizedPoster, null, 2)}`,
    `Aspect ratio: ${ratio}.`,
    'Layout should look like a premium Facebook/Instagram B2B supplier poster: product hero area, factory proof area, badges, process row, category cards, bottom CTA bar.',
    'All visible text must match the JSON exactly. Avoid extra fake certifications, fake numbers, fake flags, watermarks, or unreadable tiny claims.',
    references.length ? `Use the ${references.length} reference image(s) for product/factory visual guidance.` : 'No reference image was provided; create a realistic generic product/factory visual without brand-specific false claims.',
  ].filter(Boolean).join('\n\n');

  try {
    const generated = await generatePosterImage({ prompt, ratio: String(ratio || '1:1'), references });
    const material = await createGeneratedImageMaterial({
      title: `AI 图文海报 · ${headline}`.slice(0, 120),
      bytes: generated.bytes,
      mimeType: generated.mimeType,
      source: generated.source,
      tenantId,
    });
    res.json({
      ok: true,
      source: generated.source,
      model: generated.model,
      url: material.url,
      material,
      references: references.length,
    });
  } catch (err: any) {
    res.status(502).json({ ok: false, error: String(err?.message || err || 'image_generation_failed') });
  }
});

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
    const text = await callLLM(prompt, { backend: providerOpt, systemPrompt: await enterpriseCtx() || undefined });
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
  const { text = '', target = 'zh' } = req.body ?? {};
  const src = String(text).trim();
  if (!src) { res.json({ ok: true, source: 'noop', text: '' }); return; }
  const targetLang = langName(target);

  const prompt = `Translate the following voiceover lines into ${targetLang}.
Rules:
- Preserve every timestamp label exactly, such as [0-3s].
- Translate only the spoken text after each timestamp.
- If a line contains production labels such as 画面, 字幕, Shot, Camera, Visual, Subtitle, or note text, ignore those labels and translate only the actual spoken voiceover.
- Keep one output line per input line.
- Do not merge lines, repeat lines, add quotes, or add explanations.
- Do not leave any Chinese text in the output unless the target language is Chinese.
- Do not add new product claims, MOQ, certifications, pricing, shipping promises, or CTA lines that are not present in the source line.
- If the input has no timestamp, still translate line by line.
Return ONLY the translated lines.
Text: ${src}`;

  try {
    const out = await callLLM(prompt, { backend: 'qwen', model: 'qwen-plus' }).catch(() => callLLM(prompt, { backend: 'gemini' }));
    res.json({ ok: true, source: 'ai', text: out.trim() });
  } catch (error) {
    res.json({ ok: false, source: 'fallback', text: '', error: error instanceof Error ? error.message : String(error) });
  }
});

// POST /studio/translate/batch Body: { text, targets: ['en', 'es'] }
studioRouter.post('/translate/batch', async (req, res) => {
  const { text = '', targets = [], source = 'zh' } = req.body ?? {};
  const sourceCode = String(source || 'zh').trim();
  const src = String(text).trim();
  const targetCodes = Array.isArray(targets)
    ? targets.map(item => String(item || '').trim()).filter(Boolean).filter(code => code !== sourceCode).slice(0, 8)
    : [];
  if (!src) { res.json({ ok: true, source: 'noop', translations: {} }); return; }
  if (targetCodes.length === 0) { res.json({ ok: true, source: 'noop', translations: {} }); return; }

  const prompt = `You are a native short-video voiceover localization editor for cross-border B2B commerce.

Task:
Translate and lightly localize these timestamped ${langName(sourceCode)} spoken lines into natural, human-sounding target-language voiceover. This is NOT literal translation. Make it sound like a real person speaking in a short product video.

Target languages:
${targetCodes.map(code => `- ${code}: ${langName(code)}`).join('\n')}

Rules:
- Return ONLY valid JSON.
- JSON shape: {"en":"[0-3s] translated line\\n[3-8s] translated line","es":"..."}.
- Preserve every timestamp label exactly, such as [0-3s].
- Translate only the spoken text after each timestamp.
- Keep one output line per input line for every language.
- Omit short sound-effect lines or onomatopoeia such as “噗噗/砰砰/咚咚/咯吱”; they are audio SFX, not voiceover subtitles.
- Do not leave source-language text in translated outputs unless it is a product name or proper noun.
- Use natural conversational wording, not stiff word-for-word translation.
- Repair Chinese short-video slang into idiomatic buyer-facing wording based on product context. For example, for non-cosmetic products, “上脸质感” should become “feels good in hand” or “looks premium on camera”, not “on the skin”.
- Keep product names, numbers, ranges, units, MOQ, material terms, and certification names accurate.
- Do not add explanations, quotes, markdown, product claims, prices, certifications, or new CTAs.
- If a Chinese line is too long, make it concise but keep the meaning and buyer-facing tone.

Source:
${src}`;

  const invalid = (value: string, code: string) => {
    const textValue = String(value || '').trim();
    if (!textValue) return true;
    const spokenValue = textValue
      .replace(/\[[^\]]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!spokenValue) return true;
    if (code !== 'zh' && /[\u4e00-\u9fff]/.test(textValue)) return true;
    if (/translation unavailable|无法翻译|不能翻译|作为AI|Here is|```/i.test(textValue)) return true;
    return false;
  };

  const run = async (backend: 'qwen' | 'gemini') => {
    const out = await callLLM(prompt, { backend, model: backend === 'qwen' ? 'qwen-plus' : undefined });
    const parsed = extractJSON<Record<string, unknown> | Array<Record<string, unknown>>>(out) ?? {};
    const sourceTimestamps = src.split(/\n+/).map(line =>
      line.match(/^\s*(\[[^\]]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*\])/)?.[1] || '',
    ).filter(Boolean);
    const translations: Record<string, string> = {};
    for (const code of targetCodes) {
      let value = '';
      if (Array.isArray(parsed)) {
        // Qwen occasionally returns one object per source line even when an
        // object-of-strings was requested. Rebuild the expected timestamped
        // text instead of discarding an otherwise valid translation.
        value = parsed.map((row, index) => {
          const line = String(row?.[code] ?? '').trim();
          if (!line) return '';
          const timestamp = sourceTimestamps[index] || '';
          return timestamp && !/^\s*\[[^\]]+\]/.test(line) ? `${timestamp} ${line}` : line;
        }).filter(Boolean).join('\n');
      } else {
        const raw = parsed[code];
        value = Array.isArray(raw) ? raw.map(String).join('\n') : String(raw ?? '').trim();
      }
      if (!invalid(value, code)) translations[code] = value;
    }
    return translations;
  };

  const runSingle = async (backend: 'qwen' | 'gemini', code: string) => {
    const singlePrompt = `You are a native short-video voiceover localization editor for cross-border B2B commerce.

Translate and lightly localize the timestamped ${langName(sourceCode)} spoken lines into ${langName(code)}.
Preserve every timestamp label exactly. Translate only spoken text after each timestamp.
Keep one output line per input line. Do not leave source-language text except product names or proper nouns. Use natural conversational wording.
Omit short sound-effect lines or onomatopoeia such as “噗噗/砰砰/咚咚/咯吱”; they are audio SFX, not voiceover subtitles.
Repair Chinese short-video slang into idiomatic buyer-facing wording based on product context. For non-cosmetic products, avoid literal phrases like “on the skin”.
Return ONLY the translated timestamped lines, no markdown and no explanations.

Source:
${src}`;
    const out = await callLLM(singlePrompt, { backend, model: backend === 'qwen' ? 'qwen-plus' : undefined });
    const value = out.trim();
    return invalid(value, code) ? '' : value;
  };

  const errors: string[] = [];
  const translations: Record<string, string> = {};
  for (const backend of ['qwen', 'gemini'] as const) {
    try {
      const result = await run(backend);
      Object.assign(translations, result);
      if (targetCodes.every(code => translations[code])) break;
    } catch (error) {
      errors.push(`${backend}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const missing = targetCodes.filter(code => !translations[code]);
  for (const code of missing) {
    for (const backend of ['qwen', 'gemini'] as const) {
      try {
        const value = await runSingle(backend, code);
        if (value) {
          translations[code] = value;
          break;
        }
      } catch (error) {
        errors.push(`${backend}/${code}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const ok = targetCodes.every(code => Boolean(translations[code]));
  res.json({
    ok,
    source: ok ? 'ai' : 'partial',
    translations,
    error: ok ? undefined : (errors[0] || `missing translations: ${targetCodes.filter(code => !translations[code]).join(', ')}`),
  });
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
    const text = await callLLM(prompt, { systemPrompt: await enterpriseCtx() || undefined });
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
    const text = await callLLM(prompt, { systemPrompt: await enterpriseCtx() || undefined });
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
  timeline?: {
    name: string;
    url?: string;
    trimStart?: number;
    trimEnd?: number;
    speed?: number;
    targetStart?: number;
    targetEnd?: number;
    targetDuration?: number;
  }[];
  script?: string;
  voice?: string;
  bgm?: string;
  bgmVol?: number;
  voiceVol?: number;
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
  spec: { ratio: string; duration: number; platform: string; language: string; bgmVol: number; voiceVol: number };
  script: string;
  timeline: {
    index: number;
    name: string;
    url: string | null;
    trimStart?: number;
    trimEnd?: number;
    speed?: number;
    targetStart?: number;
    targetEnd?: number;
    targetDuration?: number;
  }[];
  voiceover: { voice: string | null; url: string | null };
  cover: { id: string | null; title: string; url: string | null };
  bgm: { id: string | null; url: string | null };
  subtitles?: SubtitleSpec;
}

function absoluteAssetUrl(base: string, value?: string | null): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
  return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function buildManifest(jobId: string, spec: RenderSpec, base: string): RenderManifest {
  // 选中素材按名称映射到素材库的真实 URL（已上传的给绝对地址，ffmpeg 可直接拉取）
  const tenantId = studioTenantContext.getStore();
  const urlByName = new Map(loadMaterials()
    .filter(m => m.scope === 'shared' || (tenantId && m.tenantId === tenantId))
    .map(m => [m.name, m.url]));
  return {
    jobId,
    spec: {
      ratio: spec.ratio || '9:16',
      duration: spec.duration ?? 20,
      platform: spec.platform || 'tiktok',
      language: spec.language || 'en',
      bgmVol: spec.bgmVol ?? 35,
      voiceVol: spec.voiceVol ?? 100,
    },
    script: spec.script ?? '',
    timeline: (spec.timeline?.length ? spec.timeline : (spec.materials ?? []).map(name => ({ name }))).map((item, index) => {
      const rel = urlByName.get(item.name);
      const directUrl = 'url' in item && typeof item.url === 'string' ? item.url : undefined;
      const resolvedUrl = absoluteAssetUrl(base, directUrl || rel);
      return { index, ...item, url: resolvedUrl }; // 优先使用逐镜传入 URL，避免 AI/临时素材被名称映射覆盖
    }),
    voiceover: { voice: spec.voice ?? null, url: absoluteAssetUrl(base, spec.voiceoverUrl) },
    cover: { id: spec.coverId ?? null, title: spec.coverTitle ?? '', url: absoluteAssetUrl(base, spec.coverUrl) },
    bgm: (() => {
      const track = spec.bgm && tenantId ? withRecommendedBgmNames(userBgms(tenantId)).find(t => t.id === spec.bgm) : null;
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

// POST /studio/render/local  Body: RenderManifest → { ok, outputPath }
// 网页端兜底：没有 Electron 桥时，直接让本机后端调用同一套 ffmpeg 合成器导出 MP4。
studioRouter.post('/render/local', async (req, res) => {
  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    const result = await composite({
      ...(req.body || {}),
      assetOrigin: origin,
      assetHeaders: {
        ...(req.get('authorization') ? { authorization: req.get('authorization') } : {}),
        ...(req.get('cookie') ? { cookie: req.get('cookie') } : {}),
      },
    });
    if (!result.ok) {
      res.status(500).json({ ok: false, error: result.error || '本地 MP4 导出失败' });
      return;
    }
    res.json({ ok: true, outputPath: result.outputPath });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : '本地 MP4 导出失败' });
  }
});

// POST /studio/render/open-output Body: { path }
// 网页端无法直接打开 file:// 本地路径时，交给本机后端打开文件所在目录。
studioRouter.post('/render/open-output', async (req, res) => {
  const rawPath = String(req.body?.path || '').trim().replace(/^file:\/\//, '').replace(/^["']|["']$/g, '');
  if (!rawPath) {
    res.status(400).json({ ok: false, error: '缺少本地文件路径' });
    return;
  }
  const filePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(rawPath);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ ok: false, error: '本地成片文件不存在，请重新导出。' });
    return;
  }
  try {
    if (process.platform === 'darwin') {
      await execFileAsync('open', ['-R', filePath], 5000);
    } else if (process.platform === 'win32') {
      await execFileAsync('explorer.exe', ['/select,', filePath], 5000);
    } else {
      await execFileAsync('xdg-open', [path.dirname(filePath)], 5000);
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || '打开本地文件夹失败' });
  }
});

/* ── 素材库───────────────────────────────────────────────────────────────
   配置对象存储时，租户素材写入私有 COS 的 materials/tenants/<tenant>/ 前缀；
   未配置时保留 data/media 本地回退。索引仍存 data/materials.json。
─────────────────────────────────────────────────────────────────────────── */

const MEDIA_DIR = path.join(__dirname, '../../data/media');
const MATERIALS_FILE = path.join(__dirname, '../../data/materials.json');
const VIDEO_VERSIONS_FILE = path.join(__dirname, '../../data/studio-video-versions.json');

interface VideoGenerationVersion {
  id: string;
  tenantId: string;
  groupKey: string;
  versionNumber: number;
  parentVersionId?: string;
  materialId?: string;
  taskId?: string;
  title: string;
  url?: string;
  poster?: string;
  duration: number;
  source: string;
  model?: string;
  promptSnapshot: {
    script: string;
    productInfo: string;
    language: string;
    ratio: string;
    resolution: string;
  };
  context?: Record<string, unknown>;
  isSelected: boolean;
  createdAt: string;
}

function loadVideoVersions(): VideoGenerationVersion[] {
  try { return JSON.parse(fs.readFileSync(VIDEO_VERSIONS_FILE, 'utf8')) as VideoGenerationVersion[]; }
  catch { return []; }
}

function persistVideoVersions(list: VideoGenerationVersion[]): void {
  fs.mkdirSync(path.dirname(VIDEO_VERSIONS_FILE), { recursive: true });
  fs.writeFileSync(VIDEO_VERSIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function appendVideoVersion(input: Omit<VideoGenerationVersion, 'id' | 'versionNumber' | 'isSelected' | 'createdAt'>): VideoGenerationVersion {
  const list = loadVideoVersions();
  const siblings = list.filter(item => item.tenantId === input.tenantId && item.groupKey === input.groupKey);
  siblings.forEach(item => { item.isSelected = false; });
  const version: VideoGenerationVersion = {
    ...input,
    id: randomUUID(),
    versionNumber: Math.max(0, ...siblings.map(item => item.versionNumber)) + 1,
    isSelected: true,
    createdAt: new Date().toISOString(),
  };
  list.push(version);
  persistVideoVersions(list);
  return version;
}

interface Material {
  id: string;
  name: string;
  folder: string;
  type: 'video' | 'image' | 'audio';
  duration: number; // 秒，图片为 0
  width?: number;
  height?: number;
  aspectRatio?: number;
  size: string;
  file: string;     // data/media 下的文件名
  url: string;      // /media/<file>
  poster?: string;  // 封面用的帧画面：视频抽首帧，图片即自身
  objectKey?: string;
  posterObjectKey?: string;
  scope: 'shared' | 'own'; // shared=公共库（运营预置），own=用户自己上传
  tenantId?: string;
  usage?: MaterialUsage;   // editable=可剪辑；reference_only=仅供对标分析，禁止进入公共下载库
  sourceType?: string;
  sourceUrl?: string;
  pinned?: boolean;
  industry?: string;
  shotFunction?: string;
  applicability?: string;
  tags?: string;
  segmentAnalysisStatus?: 'pending' | 'analyzing' | 'completed' | 'failed';
  segmentAnalysisError?: string;
  segments?: MaterialSegment[];
  createdAt: string;
}

interface MaterialSegment {
  id: string;
  start: number;
  end: number;
  duration: number;
  poster?: string;
  subject: string[];
  action: string;
  productVisible: boolean;
  productClarity: 'none' | 'low' | 'medium' | 'high';
  shot: string;
  angle: string;
  composition: string;
  camera: string;
  environment: string;
  quality: number;
  ocrText: string;
  hasPerson: boolean;
  hasLogo: boolean;
  logoText: string[];
  recommendedFunctions: string[];
  authenticity: string;
  confidence: number;
  needsReview: boolean;
  manualConfirmed?: boolean;
  posterObjectKey?: string;
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

function materialSignedUrlTtlSeconds(): number {
  const configured = Number(process.env.MATERIAL_SIGNED_URL_TTL_SECONDS || 900);
  return Number.isFinite(configured) ? Math.max(60, Math.min(3600, configured)) : 900;
}

async function signedMaterialObjectUrl(key?: string): Promise<string | undefined> {
  return key && objectStorageEnabled() ? r2SignedGetUrl(key, materialSignedUrlTtlSeconds()) : undefined;
}

async function materialResponse(material: Material, tenantId: string): Promise<Material> {
  const url = material.objectKey
    ? await signedMaterialObjectUrl(material.objectKey)
    : /^\/cloud-files\//.test(material.url)
      ? signPathAssetUrl(material.url, tenantId)
      : /^\/(?:media|api\/overseas\/studio\/materials\/pb)\//.test(material.url) ? signAssetUrl(material.url, tenantId) : material.url;
  const poster = material.posterObjectKey
    ? await signedMaterialObjectUrl(material.posterObjectKey)
    : material.poster && /^\/cloud-files\//.test(material.poster)
      ? signPathAssetUrl(material.poster, tenantId, 24 * 60 * 60 * 1000)
      : material.poster && /^\/(?:media|api\/overseas\/studio\/materials\/pb)\//.test(material.poster)
        ? signAssetUrl(material.poster, tenantId, 24 * 60 * 60 * 1000)
        : material.poster;
  const segments = await Promise.all((material.segments || []).map(async segment => ({
    ...segment,
    poster: segment.posterObjectKey ? await signedMaterialObjectUrl(segment.posterObjectKey) : segment.poster,
    posterObjectKey: undefined,
  })));
  return { ...material, url: url || material.url, poster, segments, objectKey: undefined, posterObjectKey: undefined };
}

// Video generation history. A groupKey identifies one logical output slot
// (for example an inspiration video or a storyboard shot); regenerations append
// versions and never replace the previous material.
studioRouter.get('/video-versions', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const groupKey = String(req.query.groupKey || '').trim();
  const projectId = String(req.query.projectId || '').trim();
  if (!groupKey && !projectId) { res.status(400).json({ error: 'groupKey or projectId is required' }); return; }
  const versions = loadVideoVersions()
    .filter(item => item.tenantId === tenantId)
    .filter(item => groupKey ? item.groupKey === groupKey : String(item.context?.projectId || '') === projectId)
    .sort((a, b) => b.versionNumber - a.versionNumber);
  res.json(versions);
});

studioRouter.patch('/video-versions/:id/select', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const list = loadVideoVersions();
  const target = list.find(item => item.id === req.params.id && item.tenantId === tenantId);
  if (!target) { res.status(404).json({ ok: false, error: 'version_not_found' }); return; }
  list.forEach(item => {
    if (item.tenantId === tenantId && item.groupKey === target.groupKey) item.isSelected = item.id === target.id;
  });
  persistVideoVersions(list);
  res.json({ ok: true, version: target });
});

function parseAnalysisRange(value: string, fallbackStart: number, totalDuration: number): { start: number; end: number } {
  const values = Array.from(String(value || '').matchAll(/(\d+(?:\.\d+)?)/g)).map(match => Number(match[1]));
  const start = Math.max(0, Math.min(totalDuration || Number.MAX_SAFE_INTEGER, values[0] ?? fallbackStart));
  const fallbackEnd = start + 3;
  const end = Math.max(start + 0.3, Math.min(totalDuration || fallbackEnd, values[1] ?? fallbackEnd));
  return { start: +start.toFixed(2), end: +end.toFixed(2) };
}

function includesAny(text: string, pattern: RegExp): boolean {
  return pattern.test(String(text || '').toLowerCase());
}

function analysisDetailToSegment(material: Material, detail: NonNullable<Awaited<ReturnType<typeof analyzeVideo>>['scriptDetails15s']>[number], index: number, fallbackStart: number): MaterialSegment {
  const range = parseAnalysisRange(String(detail.time || ''), fallbackStart, material.duration);
  const visual = `${detail.visual || ''} ${detail.observedFacts || ''}`;
  const productVisible = includesAny(visual, /产品|包装|瓶|罐|盒|膏|液|product|package|bottle|jar|tube/);
  const hasPerson = includesAny(visual, /人物|真人|男性|女性|手|脸|眼|皮肤|person|man|woman|hand|face|eye|skin/);
  const ocrText = String(detail.onScreenText || detail.subtitle || '').trim();
  const logoText = Array.from(new Set((ocrText.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) || []).slice(0, 6)));
  const purpose = String(detail.purpose || '').trim();
  const clarity: MaterialSegment['productClarity'] = !productVisible ? 'none'
    : includesAny(`${detail.shot} ${visual}`, /大特写|特写|close-up|清晰|完整/) ? 'high'
    : includesAny(`${detail.shot} ${visual}`, /近景|中近景|medium/) ? 'medium' : 'low';
  return {
    id: `${material.id}-segment-${index + 1}`,
    start: range.start,
    end: range.end,
    duration: +(range.end - range.start).toFixed(2),
    subject: [productVisible ? '产品' : '', hasPerson ? '人物' : ''].filter(Boolean),
    action: String(detail.beats?.map(beat => beat.action).filter(Boolean).join(' → ') || detail.visual || ''),
    productVisible,
    productClarity: clarity,
    shot: String(detail.shot || ''),
    angle: String(detail.angle || ''),
    composition: String(detail.composition || ''),
    camera: String(detail.camera || ''),
    environment: String(detail.environment || ''),
    quality: Math.max(0, Math.min(100, Math.round(Number(detail.confidence ?? 0.7) * 100))),
    ocrText,
    hasPerson,
    hasLogo: logoText.length > 0,
    logoText,
    recommendedFunctions: purpose ? [purpose] : [],
    authenticity: String(detail.authenticity || ''),
    confidence: Math.max(0, Math.min(1, Number(detail.confidence ?? 0.7))),
    needsReview: Boolean(detail.needsReview || !purpose || clarity === 'low'),
  };
}

// GET /studio/materials?scope=shared|own&purpose=library|reference|all
// 默认只返回可剪辑素材；reference 专供对标分析。reference_only 永不进入 shared 公共库。
studioRouter.get('/materials', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const scope = req.query.scope as string | undefined;
  const purpose = String(req.query.purpose || 'library');
  let list = [
    ...await listCloudMaterials(),
    ...loadMaterials().filter(m => !isMockMaterial(m) && (m.scope === 'shared' || m.tenantId === tenantId)),
  ] as Material[];
  if (scope === 'shared') list = list.filter(canAppearInSharedLibrary);
  else if (scope === 'own') list = list.filter(m => (m.scope ?? 'own') === 'own');
  if (purpose === 'reference') list = list.filter(isReferenceOnlyMaterial);
  else if (purpose !== 'all') list = list.filter(m => !isReferenceOnlyMaterial(m));
  const sorted = list.sort((a, b) => (Date.parse(String(b.createdAt || '')) || 0) - (Date.parse(String(a.createdAt || '')) || 0));
  const response = await Promise.all(sorted.map(async m => ({
    ...(await materialResponse(m, tenantId)),
    usage: materialUsage(m),
  })));
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.json(response);
});

studioRouter.get('/materials/pb/:id/:kind', async (req, res) => {
  const field = req.params.kind === 'poster' ? 'posterFile' : req.params.kind === 'media' ? 'videoFile' : null;
  if (!field) { res.status(404).end(); return; }
  let upstream = await fetchCloudMaterial(req.params.id, field, req.headers.range);
  if (!upstream && field === 'posterFile') {
    const cacheDir = path.join(MEDIA_DIR, 'cloud-poster-cache');
    const cachePath = path.join(cacheDir, `${req.params.id}.jpg`);
    if (!fs.existsSync(cachePath)) {
      const video = await fetchCloudMaterial(req.params.id, 'videoFile');
      if (video?.ok) {
        fs.mkdirSync(cacheDir, { recursive: true });
        const tempPath = path.join(cacheDir, `${req.params.id}.${Date.now()}.mp4`);
        try {
          fs.writeFileSync(tempPath, Buffer.from(await video.arrayBuffer()));
          await extractPoster(tempPath, cachePath, 1);
        } finally {
          fs.rmSync(tempPath, { force: true });
        }
      }
    }
    if (fs.existsSync(cachePath)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.sendFile(cachePath);
      return;
    }
  }
  if (!upstream || !upstream.body) { res.status(404).end(); return; }
  for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }
  res.setHeader('Cache-Control', field === 'posterFile' ? 'public, max-age=86400' : 'private, max-age=3600');
  res.status(upstream.status);
  Readable.fromWeb(upstream.body as any).pipe(res);
});

function isMockMaterial(m: Material): boolean {
  return (m.scope ?? 'own') === 'shared'
    || /^sh-/.test(m.id)
    || /^示例[·・]/.test(m.name)
    || m.folder === 'sample';
}

// POST /studio/materials  Body: { name, folder?, type, duration?, dataBase64, mimeType?, scope? } → 上传单个文件
studioRouter.post('/materials', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { name, folder = 'upload', type, duration = 0, width = 0, height = 0, dataBase64, mimeType, scope = 'own', usage, sourceType, sourceUrl } = req.body ?? {};
  if (!dataBase64 || !type) { res.status(400).json({ ok: false, error: 'dataBase64 and type required' }); return; }
  if (!['video', 'image', 'audio'].includes(type)) { res.status(400).json({ ok: false, error: 'invalid type' }); return; }

  const uploadDir = tenantAssetDir(MEDIA_DIR, tenantId);
  try { fs.mkdirSync(uploadDir, { recursive: true }); } catch { /* ignore */ }

  const id = randomUUID();
  const extFromMime = (mimeType as string | undefined)?.split('/')[1]?.replace('quicktime', 'mov');
  const ext = extFromMime || (type === 'image' ? 'jpg' : type === 'audio' ? 'mp3' : 'mp4');
  const file = `${id}.${ext}`;
  const buf = Buffer.from(String(dataBase64).replace(/^data:[^,]+,/, ''), 'base64');
  const relativeFile = tenantAssetRelativePath(tenantId, file);
  const contentType = materialAssetContentType(file, String(mimeType || ''));
  if (!materialAssetTypeAllowed(contentType)) { res.status(415).json({ ok: false, error: 'unsupported material type' }); return; }
  if (!buf.length || buf.length > 110 * 1024 * 1024) { res.status(413).json({ ok: false, error: 'material must be between 1 byte and 110 MB' }); return; }
  const useObjectStorage = objectStorageEnabled();
  const objectKey = useObjectStorage ? materialAssetObjectKey(tenantId, file) : undefined;
  const tempDir = path.join(MEDIA_DIR, '../material-upload-temp');
  const tempFile = path.join(tempDir, file);
  if (useObjectStorage) {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(tempFile, buf);
  } else {
    fs.writeFileSync(path.join(MEDIA_DIR, relativeFile), buf);
  }

  // 封面用帧画面：视频抽首帧（≈1s 处，太短则取 0），图片用自身，音频无
  let poster: string | undefined;
  let posterObjectKey: string | undefined;
  let posterBuffer: Buffer | undefined;
  if (type === 'image') {
    poster = useObjectStorage ? undefined : `/media/${relativeFile}`;
    posterObjectKey = objectKey;
  } else if (type === 'video') {
    const posterFile = `${id}.poster.jpg`;
    const relativePoster = tenantAssetRelativePath(tenantId, posterFile);
    const posterPath = useObjectStorage ? path.join(tempDir, posterFile) : path.join(MEDIA_DIR, relativePoster);
    const at = (Number(duration) || 0) > 1 ? 1 : 0;
    const ok = await extractPoster(useObjectStorage ? tempFile : path.join(MEDIA_DIR, relativeFile), posterPath, at);
    if (ok) {
      if (useObjectStorage) {
        posterObjectKey = materialAssetObjectKey(tenantId, posterFile);
        posterBuffer = fs.readFileSync(posterPath);
        fs.rmSync(posterPath, { force: true });
      } else poster = `/media/${relativePoster}`;
    }
  }

  try {
    if (objectKey) await r2Upload({ key: objectKey, body: buf, contentType });
    if (posterObjectKey && posterObjectKey !== objectKey && posterBuffer) {
      await r2Upload({ key: posterObjectKey, body: posterBuffer, contentType: 'image/jpeg' });
      if (!await r2Head(posterObjectKey)) throw new Error('material poster upload verification failed');
    }
  } catch (error) {
    if (posterObjectKey && posterObjectKey !== objectKey) await r2Delete(posterObjectKey).catch(() => undefined);
    if (objectKey) await r2Delete(objectKey).catch(() => undefined);
    fs.rmSync(tempFile, { force: true });
    console.error('[materials] COS upload failed', error instanceof Error ? error.message : error);
    res.status(503).json({ ok: false, error: 'material storage unavailable' });
    return;
  } finally {
    if (useObjectStorage) fs.rmSync(tempFile, { force: true });
  }

  const requestedUsage: MaterialUsage = usage === 'reference_only' || sourceType === 'youtube' || /youtube\.com|youtu\.be/i.test(String(sourceUrl || ''))
    ? 'reference_only'
    : 'editable';
  const material: Material = {
    id,
    name: name || file,
    folder,
    type,
    duration: Number(duration) || 0,
    width: Math.max(0, Math.round(Number(width) || 0)) || undefined,
    height: Math.max(0, Math.round(Number(height) || 0)) || undefined,
    aspectRatio: Number(width) > 0 && Number(height) > 0 ? +(Number(width) / Number(height)).toFixed(4) : undefined,
    size: humanSize(buf.length),
    file: relativeFile,
    url: useObjectStorage ? '' : `/media/${relativeFile}`,
    poster,
    objectKey,
    posterObjectKey,
    // Reference material must never be promoted into the shared download library.
    scope: 'own',
    tenantId,
    usage: requestedUsage,
    sourceType: sourceType ? String(sourceType) : undefined,
    sourceUrl: sourceUrl ? String(sourceUrl) : undefined,
    createdAt: new Date().toISOString(),
  };
  const list = loadMaterials();
  list.push(material);
  persistMaterials(list);
  res.status(201).json({ ok: true, material: await materialResponse(material, tenantId) });
});

// POST /studio/materials/:id/analyze-segments
// Gemini 按动作/主体/镜头功能切片；截取区间来自实际视频时间轴，不再用比例猜测。
/**
 * 素材片段分析的模型选择。
 *
 * 此前这里直接调 Gemini，绕过了 VIDEO_ANALYSIS_PROVIDER 开关——对标视频分析早已切到千问，
 * 素材分镜却还在打 Gemini，额度耗尽后固定返回 429。改为与视频分析同一套选择逻辑：
 * 千问吃关键帧（需先抽帧），Gemini 吃整段视频。
 */
async function analyzeMaterialVideo(videoPath: string, buffer: Buffer, duration: number) {
  if (process.env.VIDEO_ANALYSIS_PROVIDER?.trim().toLowerCase() === 'qwen') {
    const frames = await extractQwenAnalysisFrames(videoPath, 30, duration);
    if (frames.length) {
      const strategy = await analyzeVideoFramesWithQwen({ frames, duration, analysisMode: 'strategy' });
      const strategyQuality = analysisDetailsTimelineQuality(strategy.scriptDetails15s, duration);
      if (strategyQuality.valid) return strategy;
      console.warn(`[studio] 策略档时间轴不合格，改用精确档重试：${strategyQuality.issues.join('；')}`);
      const exact = await analyzeVideoFramesWithQwen({ frames, duration, analysisMode: 'exact' });
      const exactQuality = analysisDetailsTimelineQuality(exact.scriptDetails15s, duration);
      if (exactQuality.valid) return exact;
      console.warn(`[studio] 千问精确档时间轴仍不合格，回退 Gemini：${exactQuality.issues.join('；')}`);
    } else {
      console.warn('[studio] 抽帧为空，回退 Gemini 分析素材片段');
    }
  }
  const gemini = await analyzeVideo({ videoBase64: buffer.toString('base64'), mimeType: 'video/mp4' });
  const geminiQuality = analysisDetailsTimelineQuality(gemini.scriptDetails15s, duration);
  if (!geminiQuality.valid) {
    throw new Error(`素材逐镜分析未达到可匹配标准：${geminiQuality.issues.join('；')}`);
  }
  return gemini;
}

/**
 * 云端素材的片段分析。
 *
 * 本地路径依赖 data/materials.json 与 data/media 下的实体文件，而云端素材两者都没有，
 * 且没有 tenantId 字段，走本地分支必然 404。这里改为：从 PocketBase 取视频 →
 * 分析 → 片段和状态写回同一条记录，让云端素材也能进入分镜匹配池。
 */
async function analyzeCloudMaterialSegments(pbId: string, tenantId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const record = await getCloudMaterialRecord(pbId);
  if (!record) return { status: 404, body: { ok: false, error: 'Material not found' } };
  if (String(record.type || 'video') !== 'video') {
    return { status: 400, body: { ok: false, error: '仅视频素材支持片段分析' } };
  }

  await updateCloudMaterial(pbId, { segmentAnalysisStatus: 'analyzing', segmentAnalysisError: '' });
  const tempDir = path.join(MEDIA_DIR, '../analysis-temp');
  const tempPath = path.join(tempDir, `material-${pbId}.mp4`);
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    const media = await fetchCloudMaterial(pbId, 'videoFile');
    if (!media?.ok) throw new Error('云端素材文件不可读');
    const buffer = Buffer.from(await media.arrayBuffer());
    if (!buffer.length) throw new Error('云端素材文件为空');
    fs.writeFileSync(tempPath, buffer);

    const analysis = await analyzeMaterialVideo(tempPath, buffer, Number(record.duration || 0));
    const details = analysis.scriptDetails15s || [];
    if (!details.length) throw new Error('模型未返回可用的片段时间轴');

    // analysisDetailToSegment 只用到 id 与 duration，构造最小对象即可。
    const material = { id: `pb-${pbId}`, duration: Number(record.duration || 0) } as Material;
    const segments: MaterialSegment[] = [];
    let fallbackStart = 0;
    for (let index = 0; index < details.length; index++) {
      const segment = analysisDetailToSegment(material, details[index]!, index, fallbackStart);
      const posterFile = tenantAssetRelativePath(tenantId, `${material.id}.segment-${index + 1}.jpg`);
      if (await extractPoster(tempPath, path.join(MEDIA_DIR, posterFile), Math.min(segment.end, segment.start + 0.2))) {
        segment.poster = `/media/${posterFile}`;
      }
      segments.push(segment);
      fallbackStart = segment.end;
    }

    const saved = await updateCloudMaterial(pbId, { segments, segmentAnalysisStatus: 'completed', segmentAnalysisError: '' });
    if (!saved) throw new Error('片段写回云端失败');
    return { status: 200, body: { ok: true, materialId: material.id, segments } };
  } catch (error: any) {
    const message = String(error?.message || error || '片段分析失败').slice(0, 500);
    await updateCloudMaterial(pbId, { segmentAnalysisStatus: 'failed', segmentAnalysisError: message });
    return { status: 500, body: { ok: false, error: message } };
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

studioRouter.post('/materials/:id/analyze-segments', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  if (req.params.id.startsWith('pb-')) {
    const result = await analyzeCloudMaterialSegments(req.params.id.slice(3), tenantId);
    res.status(result.status).json(result.body);
    return;
  }
  const list = loadMaterials();
  const material = list.find(item => item.id === req.params.id && item.tenantId === tenantId);
  if (!material) { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
  if (material.type !== 'video') { res.status(400).json({ ok: false, error: '仅视频素材支持片段分析' }); return; }
  const tempDir = path.join(MEDIA_DIR, '../analysis-temp');
  fs.mkdirSync(tempDir, { recursive: true });
  const mediaPath = material.objectKey ? path.join(tempDir, `tenant-material-${material.id}${path.extname(material.file) || '.mp4'}`) : path.join(MEDIA_DIR, material.file);
  let mediaBuffer: Buffer;
  if (material.objectKey) {
    const downloaded = await r2Download(material.objectKey);
    if (!downloaded?.buf.length) { res.status(404).json({ ok: false, error: 'COS 素材文件不存在' }); return; }
    mediaBuffer = downloaded.buf;
    fs.writeFileSync(mediaPath, mediaBuffer);
  } else {
    if (!fs.existsSync(mediaPath)) { res.status(404).json({ ok: false, error: '素材文件不存在' }); return; }
    mediaBuffer = fs.readFileSync(mediaPath);
  }

  material.segmentAnalysisStatus = 'analyzing';
  material.segmentAnalysisError = undefined;
  persistMaterials(list);
  try {
    const extension = path.extname(material.file).slice(1).toLowerCase();
    const mimeType = extension === 'mov' ? 'video/quicktime' : extension === 'webm' ? 'video/webm' : 'video/mp4';
    const analysis = await analyzeMaterialVideo(mediaPath, mediaBuffer, material.duration);
    const details = analysis.scriptDetails15s || [];
    if (!details.length) throw new Error('模型未返回可用的片段时间轴');
    const segments: MaterialSegment[] = [];
    let fallbackStart = 0;
    for (let index = 0; index < details.length; index++) {
      const segment = analysisDetailToSegment(material, details[index]!, index, fallbackStart);
      const posterName = `${material.id}.segment-${index + 1}.jpg`;
      const posterFile = tenantAssetRelativePath(tenantId, posterName);
      const posterPath = material.objectKey ? path.join(tempDir, posterName) : path.join(MEDIA_DIR, posterFile);
      if (await extractPoster(mediaPath, posterPath, Math.min(segment.end, segment.start + 0.2))) {
        if (material.objectKey) {
          segment.posterObjectKey = materialAssetObjectKey(tenantId, posterName);
          await r2Upload({ key: segment.posterObjectKey, body: fs.readFileSync(posterPath), contentType: 'image/jpeg' });
          fs.rmSync(posterPath, { force: true });
        } else segment.poster = `/media/${posterFile}`;
      }
      segments.push(segment);
      fallbackStart = segment.end;
    }
    material.segments = segments;
    const classificationText = `${material.name} ${JSON.stringify(analysis)} ${segments.map(segment => `${segment.subject.join(' ')} ${segment.action} ${segment.shot}`).join(' ')}`.toLowerCase();
    material.industry = /护肤|面膜|精华|面霜|防晒|洗发|沐浴|美容|skin|serum|cream|shampoo|beauty/.test(classificationText)
      ? 'beauty_skincare'
      : /服装|面料|纺织|衣服|apparel|textile|fabric/.test(classificationText)
        ? 'apparel_textile'
        : /金属|五金|机加工|焊接|metal|welding|machining/.test(classificationText)
          ? 'metalworking'
          : 'universal_manufacturing';
    material.applicability = material.industry === 'universal_manufacturing' ? 'cross_industry' : 'industry_specific';
    material.shotFunction = [...new Set(segments.flatMap(segment => segment.recommendedFunctions || []))].slice(0, 5).join(',');
    material.tags = [...new Set(segments.flatMap(segment => [...segment.subject, segment.action, segment.shot]).map(value => String(value || '').trim()).filter(Boolean))].slice(0, 10).join(',');
    material.segmentAnalysisStatus = 'completed';
    material.segmentAnalysisError = undefined;
    persistMaterials(list);
    const responseMaterial = await materialResponse(material, tenantId);
    res.json({ ok: true, material: responseMaterial, segments: responseMaterial.segments });
  } catch (error: any) {
    material.segmentAnalysisStatus = 'failed';
    material.segmentAnalysisError = String(error?.message || error || '片段分析失败').slice(0, 500);
    persistMaterials(list);
    res.status(500).json({ ok: false, error: material.segmentAnalysisError });
  } finally {
    if (material.objectKey) fs.rmSync(mediaPath, { force: true });
  }
});

studioRouter.post('/materials/:id/classify', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const list = loadMaterials();
  const material = list.find(item => item.id === req.params.id && item.tenantId === tenantId);
  if (!material) { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
  if (material.type !== 'video') { res.status(400).json({ ok: false, error: '仅视频素材支持智能分类' }); return; }
  const tempDir = path.join(MEDIA_DIR, '../analysis-temp');
  fs.mkdirSync(tempDir, { recursive: true });
  const mediaPath = material.objectKey ? path.join(tempDir, `classify-${material.id}${path.extname(material.file) || '.mp4'}`) : path.join(MEDIA_DIR, material.file);
  material.segmentAnalysisStatus = 'analyzing';
  material.segmentAnalysisError = undefined;
  persistMaterials(list);
  try {
    if (material.objectKey) {
      const downloaded = await r2Download(material.objectKey);
      if (!downloaded?.buf.length) throw new Error('COS 素材文件不存在');
      fs.writeFileSync(mediaPath, downloaded.buf);
    }
    const frames = await extractQwenAnalysisFrames(mediaPath, 8, material.duration);
    const classified = await classifyMaterialFramesWithQwen({ name: material.name, frames });
    material.industry = classified.industry;
    material.applicability = classified.applicability;
    material.shotFunction = classified.shotFunctions.join(',');
    material.tags = classified.tags.join(',');
    material.segmentAnalysisStatus = 'completed';
    material.segmentAnalysisError = undefined;
    persistMaterials(list);
    res.json({ ok: true, material: await materialResponse(material, tenantId) });
  } catch (error) {
    material.segmentAnalysisStatus = 'failed';
    material.segmentAnalysisError = String(error instanceof Error ? error.message : error).slice(0, 500);
    persistMaterials(list);
    res.status(500).json({ ok: false, error: material.segmentAnalysisError });
  } finally {
    if (material.objectKey) fs.rmSync(mediaPath, { force: true });
  }
});

// PATCH /studio/materials/:id/segments/:segmentId — 人工修正并确认 AI 片段标签。
studioRouter.patch('/materials/:id/segments/:segmentId', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const list = loadMaterials();
  const material = list.find(item => item.id === req.params.id && item.tenantId === tenantId);
  const segment = material?.segments?.find(item => item.id === req.params.segmentId);
  if (!material || !segment) { res.status(404).json({ ok: false, error: 'Material segment not found' }); return; }
  const editable = ['start', 'end', 'subject', 'action', 'productVisible', 'productClarity', 'shot', 'angle', 'composition', 'camera', 'environment', 'quality', 'ocrText', 'hasPerson', 'hasLogo', 'logoText', 'recommendedFunctions', 'authenticity', 'needsReview', 'manualConfirmed'] as const;
  for (const key of editable) if (key in (req.body || {})) (segment as any)[key] = req.body[key];
  segment.start = Math.max(0, Number(segment.start) || 0);
  segment.end = Math.max(segment.start + 0.3, Number(segment.end) || segment.start + 0.3);
  segment.duration = +(segment.end - segment.start).toFixed(2);
  if (segment.manualConfirmed) segment.needsReview = false;
  persistMaterials(list);
  res.json({ ok: true, material, segment });
});

studioRouter.patch('/materials/:id/pin', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const pinned = req.body?.pinned !== false;
  // 云端素材同样不在 data/materials.json 里，直接写回 PocketBase。
  if (req.params.id.startsWith('pb-')) {
    const pbId = req.params.id.slice(3);
    if (!await getCloudMaterialRecord(pbId)) { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
    const saved = await updateCloudMaterial(pbId, { pinned });
    if (!saved) { res.status(500).json({ ok: false, error: '置顶写回云端失败' }); return; }
    res.json({ ok: true, material: { id: req.params.id, pinned } });
    return;
  }
  const list = loadMaterials();
  const material = list.find(item => item.id === req.params.id && item.tenantId === tenantId);
  if (!material) { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
  material.pinned = pinned;
  persistMaterials(list);
  res.json({ ok: true, material });
});

// DELETE /studio/materials/:id
studioRouter.delete('/materials/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const list = loadMaterials();
  const m = list.find(x => x.id === req.params.id && x.tenantId === tenantId);
  if (!m) { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
  if (m.objectKey) await r2Delete(m.objectKey).catch(error => console.error('[materials] COS delete failed', error));
  else try { fs.unlinkSync(path.join(MEDIA_DIR, m.file)); } catch { /* file may be gone */ }
  if (m.posterObjectKey && m.posterObjectKey !== m.objectKey) await r2Delete(m.posterObjectKey).catch(error => console.error('[materials] COS poster delete failed', error));
  if (m.poster && m.poster !== m.url) { try { fs.unlinkSync(path.join(MEDIA_DIR, m.poster.replace(/^\/media\//, ''))); } catch { /* ignore */ } }
  for (const segment of m.segments || []) {
    if (segment.posterObjectKey) await r2Delete(segment.posterObjectKey).catch(error => console.error('[materials] COS segment poster delete failed', error));
    else if (segment.poster) try { fs.unlinkSync(path.join(MEDIA_DIR, segment.poster.replace(/^\/media\//, ''))); } catch { /* ignore */ }
  }
  persistMaterials(list.filter(x => x.id !== req.params.id));
  res.json({ ok: true });
});

/* ── ⑤ 封面图层（零依赖 SVG，作发布缩略图）─────────────────────────────────
   按标题 + 配色（或选中的图片素材作底图）生成一张 9:16 / 1:1 / 16:9 的 SVG 封面，
   浏览器原生渲染、CJK/emoji 可显。作为发布缩略图，ffmpeg 不参与，零栅格化依赖。
─────────────────────────────────────────────────────────────────────────── */

const COVERS_ROOT = path.join(__dirname, '../../data/covers');

function coverResolution(ratio: string): [number, number] {
  if (ratio === '1:1') return [1080, 1080];
  if (ratio === '16:9') return [1920, 1080];
  return [1080, 1920];
}
function xmlEscape(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));
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
interface CoverStyle {
  color: string;
  size: 'S' | 'M' | 'L';
  position: 'top' | 'center' | 'bottom';
  verticalPosition?: number;
  align: 'left' | 'center';
  font: CoverFont;
  weight?: 'regular' | 'bold' | 'heavy';
  artPreset?: 'clean' | 'outline' | 'highlight' | 'magazine' | 'neon' | 'sticker';
}

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
	  const color = opts.color || '#ffffff';
  const size = opts.size || 'M';
  const position = opts.position || 'bottom';
  const align = opts.align || 'left';
  const fontStack = COVER_FONT_STACK[opts.font || 'sans'] || COVER_FONT_STACK.sans;
  const weight = opts.weight === 'regular' ? 600 : opts.weight === 'heavy' ? 900 : opts.font === 'serif' ? 700 : 800;
  const artPreset = opts.artPreset || 'clean';

  const scale = size === 'S' ? 0.062 : size === 'L' ? 0.098 : 0.078;
  const fontSize = Math.round(w * scale);
  const lineH = Math.round(fontSize * 1.18);
  const pad = Math.round(w * 0.045);
  const displayTitle = artPreset === 'magazine' ? String(opts.title || '').toUpperCase() : opts.title || '';
  const lines = wrapTitle(displayTitle, Math.floor(w / (fontSize * 0.6)));
  const totalH = (lines.length - 1) * lineH;

  const requestedVerticalPosition = Number(opts.verticalPosition);
  const verticalPosition = Number.isFinite(requestedVerticalPosition)
    ? Math.max(8, Math.min(92, requestedVerticalPosition))
    : position === 'top' ? 14 : position === 'center' ? 50 : 86;
  const firstBaseline = Math.round(h * verticalPosition / 100 - (fontSize + totalH) / 2 + fontSize * 0.8);

  const anchor = align === 'center' ? 'middle' : 'start';
  const tx = align === 'center' ? Math.round(w / 2) : pad;

	  const bg = opts.bgImageUrl
	    ? `<image href="${xmlEscape(opts.bgImageUrl)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
	    : `<rect width="${w}" height="${h}" fill="#111827"/>`;

  const half = Math.round(h * 0.5);
  const scrim =
    position === 'top' ? `<rect x="0" y="0" width="${w}" height="${half}" fill="url(#scrimT)"/>`
    : position === 'center' ? `<rect width="${w}" height="${h}" fill="#000" fill-opacity="0.3"/>`
    : `<rect x="0" y="${half}" width="${w}" height="${half}" fill="url(#scrimB)"/>`;

	  const texts = lines.map((ln, i) => {
    const y = firstBaseline + i * lineH;
    const escaped = xmlEscape(ln);
    const estimatedWidth = Math.min(w - pad * 2, Math.max(fontSize * 1.4, ln.length * fontSize * 0.58));
    const rectX = align === 'center' ? Math.round((w - estimatedWidth) / 2) : pad;
    if (artPreset === 'highlight') {
      return `<rect x="${rectX - Math.round(fontSize * 0.12)}" y="${y - Math.round(fontSize * 0.9)}" width="${Math.round(estimatedWidth + fontSize * 0.24)}" height="${Math.round(fontSize * 1.08)}" rx="${Math.round(fontSize * 0.1)}" fill="#facc15"/><text x="${tx}" y="${y}" text-anchor="${anchor}" font-family="${fontStack}" font-size="${fontSize}" font-weight="${weight}" fill="#111827">${escaped}</text>`;
    }
    if (artPreset === 'sticker') {
      return `<text x="${tx + Math.round(fontSize * 0.1)}" y="${y + Math.round(fontSize * 0.1)}" text-anchor="${anchor}" font-family="${fontStack}" font-size="${fontSize}" font-weight="${weight}" fill="#16a34a" stroke="#16a34a" stroke-width="${Math.round(fontSize * 0.15)}" paint-order="stroke fill">${escaped}</text><text x="${tx}" y="${y}" text-anchor="${anchor}" font-family="${fontStack}" font-size="${fontSize}" font-weight="${weight}" fill="#111827" stroke="#fff" stroke-width="${Math.round(fontSize * 0.16)}" paint-order="stroke fill">${escaped}</text>`;
    }
    const strokeWidth = artPreset === 'outline' ? Math.round(fontSize * 0.12) : Math.round(fontSize * 0.04);
    const strokeOpacity = artPreset === 'outline' ? 0.95 : 0.25;
    const filter = artPreset === 'neon' ? ' filter="url(#neonGlow)"' : '';
    const italic = artPreset === 'magazine' ? ' font-style="italic"' : '';
    return `<text x="${tx}" y="${y}" text-anchor="${anchor}" font-family="${fontStack}" font-size="${fontSize}" font-weight="${weight}" fill="${color}" paint-order="stroke" stroke="#000" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}"${filter}${italic}>${escaped}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<defs>
	<linearGradient id="scrimB" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.7"/></linearGradient>
<linearGradient id="scrimT" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.7"/><stop offset="0.55" stop-color="#000" stop-opacity="0"/></linearGradient>
<filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
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
    // 浏览器从视频抽出的静态帧可直接作为封面底图；限制格式和体积，避免任意 data URI 写入。
    if (/^data:image\/(?:jpeg|png|webp);base64,/i.test(bgImageUrl)) {
      return bgImageUrl.length <= 8 * 1024 * 1024 ? bgImageUrl : undefined;
    }
    const tenantId = studioTenantContext.getStore();
    if (!tenantId) return undefined;
    const relative = bgImageUrl.split('?')[0].replace(/^.*\/media\//, '');
    if (!relative.startsWith(`tenants/${tenantId}/`) && !relative.startsWith('shared/')) return undefined;
    const local = path.join(MEDIA_DIR, relative);
    if (!fs.existsSync(local)) return undefined;
    const ext = path.extname(local).slice(1).toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(local).toString('base64')}`;
  } catch { return undefined; }
}

// POST /studio/cover  Body: { title, ratio?, accent?, bgImageUrl?, color?, size?, position?, align? } → { ok, url }
studioRouter.post('/cover', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { title = '', ratio = '9:16', accent = '#d97706', bgImageUrl, color, size, position, verticalPosition, align, font, weight, artPreset } = req.body ?? {};
  try {
    fs.mkdirSync(scopedStudioAssetDir(COVERS_ROOT), { recursive: true });
    const file = `${randomUUID()}.svg`;
	    const dataUri = inlineFrame(bgImageUrl);
      if (!dataUri) {
        res.status(400).json({ ok: false, error: 'cover_frame_required' });
        return;
      }
		    const filePath = path.join(scopedStudioAssetDir(COVERS_ROOT), file);
		    fs.writeFileSync(filePath, buildCoverSvg({ title, ratio, accent, bgImageUrl: dataUri, color, size, position, verticalPosition, align, font, weight, artPreset }), 'utf8');
	    res.json({ ok: true, url: await persistPrivateStudioAsset('covers', tenantId, filePath, 'image/svg+xml'), hasFrame: !!dataUri });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/* ── 配音 TTS（Gemini 语音合成 → WAV，本地托管）────────────────────────────
   把脚本里的"口语内容"抽出来送 Gemini TTS，得到 24kHz PCM，封成 WAV 存 data/tts/。
   渲染时由 buildManifest 映射成 voiceover.url，桌面端 ffmpeg 把它压过 BGM 混进成片。
─────────────────────────────────────────────────────────────────────────── */

const TTS_ROOT = path.join(__dirname, '../../data/tts');
const VOICE_SAMPLES_ROOT = path.join(__dirname, '../../data/voice-samples');

function privateStudioAssetUrl(namespace: string, tenantId: string, file: string): string {
  return signAssetUrl(`/api/overseas/studio/private-assets/${namespace}/${path.basename(file)}`, tenantId);
}

async function persistPrivateStudioAsset(namespace: string, tenantId: string, filePath: string, contentType?: string): Promise<string> {
  const file = path.basename(filePath);
  if (!objectStorageEnabled()) return scopedStudioAssetUrl(namespace, file);
  const key = tenantPrivateObjectKey(namespace, tenantId, file);
  await r2Upload({ key, body: fs.readFileSync(filePath), contentType: materialAssetContentType(file, contentType || '') });
  return privateStudioAssetUrl(namespace, tenantId, file);
}

studioRouter.get('/private-assets/:namespace/:file', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const namespace = String(req.params.namespace || '');
  if (!['tts', 'voice-samples', 'covers', 'exports'].includes(namespace)) { res.status(404).end(); return; }
  const object = await r2GetObject(tenantPrivateObjectKey(namespace, tenantId, req.params.file), req.headers.range);
  if (!object) { res.status(404).end(); return; }
  res.setHeader('Content-Type', object.contentType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  if (object.contentLength !== undefined) res.setHeader('Content-Length', String(object.contentLength));
  if (object.contentRange) { res.status(206); res.setHeader('Content-Range', object.contentRange); }
  for await (const chunk of object.body) res.write(chunk);
  res.end();
});
interface StoredVoiceSample { voiceId: string; name: string; file: string; duration: number; createdAt: string }
function voiceSampleIndexFile(): string { return path.join(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), 'voice-samples.json'); }
function readVoiceSampleIndex(): StoredVoiceSample[] {
  try { return JSON.parse(fs.readFileSync(voiceSampleIndexFile(), 'utf8')) as StoredVoiceSample[]; } catch { return []; }
}
function writeVoiceSampleIndex(items: StoredVoiceSample[]): void {
  fs.mkdirSync(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), { recursive: true });
  fs.writeFileSync(voiceSampleIndexFile(), JSON.stringify(items, null, 2), 'utf8');
}
function minimaxVoiceCacheFile(): string {
  return path.join(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), 'minimax-voice-cache.json');
}

type TtsPreset = 'tiktok_excited' | 'authentic_review' | 'professional_b2b' | 'warm_story' | 'urgent_cta';
interface TtsStyleOptions {
  preset?: TtsPreset;
  emotion?: string;
  emotionIntensity?: number;
  speed?: number;
  targetDuration?: number;
  pauseStyle?: 'few' | 'natural' | 'dramatic';
  pronunciations?: Array<{ word: string; pronunciation: string }>;
}
interface AlignedWord { text: string; start: number; end: number }
interface AlignedCue { text: string; start: number; end: number; words?: AlignedWord[] }

const TTS_PRESET_GUIDE: Record<TtsPreset, string> = {
  tiktok_excited: 'High-energy TikTok product recommendation. Start with excited surprise, use crisp emphasis and quick but intelligible pacing, then land the CTA strongly.',
  authentic_review: 'Authentic personal product review. Sound conversational, specific and pleasantly surprised, never like a hard-sell announcer.',
  professional_b2b: 'Professional cross-border B2B presenter. Sound confident, credible and restrained, with clear pronunciation of specifications and sourcing terms.',
  warm_story: 'Warm lifestyle storytelling. Use a gentle smile, natural breathing and slightly slower emotional pacing.',
  urgent_cta: 'Conversion-focused call to action. Build urgency without shouting, emphasize the offer and finish decisively.',
};

function normalizeTtsStyle(input: unknown): TtsStyleOptions {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const preset = String(raw.preset || '') as TtsPreset;
  return {
    preset: preset in TTS_PRESET_GUIDE ? preset : 'authentic_review',
    emotion: String(raw.emotion || '自然可信').slice(0, 40),
    emotionIntensity: Math.max(0, Math.min(100, Number(raw.emotionIntensity ?? 65) || 65)),
    speed: Math.max(0.75, Math.min(1.35, Number(raw.speed ?? 1) || 1)),
    targetDuration: Math.max(0, Math.min(180, Number(raw.targetDuration ?? 0) || 0)),
    pauseStyle: raw.pauseStyle === 'few' || raw.pauseStyle === 'dramatic' ? raw.pauseStyle : 'natural',
    pronunciations: Array.isArray(raw.pronunciations) ? raw.pronunciations.slice(0, 20).map(item => {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      return { word: String(row.word || '').trim().slice(0, 60), pronunciation: String(row.pronunciation || '').trim().slice(0, 120) };
    }).filter(item => item.word && item.pronunciation) : [],
  };
}

function ttsPerformancePrompt(text: string, style: TtsStyleOptions): string {
  const guide = TTS_PRESET_GUIDE[style.preset || 'authentic_review'];
  const durationGuide = style.targetDuration ? ` Aim for about ${style.targetDuration} seconds by adjusting natural pauses only; never add words.` : '';
  return `${guide}\nEmotion: ${style.emotion || 'natural and credible'}; intensity ${Math.round(style.emotionIntensity || 65)}/100; speaking rate ${Number(style.speed || 1).toFixed(2)}x.${durationGuide} Use meaningful pauses at punctuation and emphasize concrete product benefits. Speak only the script below; never read these directions aloud.\n\nSCRIPT:\n${text}`;
}

// 工作台 4 个音色 → Gemini 预置嗓音
const TTS_VOICE_MAP: Record<string, string> = {
  v1: 'Kore',    // 女声 · 亲和
  v2: 'Charon',  // 男声 · 沉稳
  v3: 'Aoede',   // 女声 · 温暖
};

const MINIMAX_VOICE_MAP: Record<string, Record<string, string>> = {
  zh: {
    v1: 'Chinese (Mandarin)_Warm_Bestie',
    v2: 'Chinese (Mandarin)_Reliable_Executive',
    v3: 'Chinese (Mandarin)_Warm_Girl',
  },
  en: {
    v1: 'English_FriendlyPerson',
    v2: 'English_Trustworth_Man',
    v3: 'English_CalmWoman',
  },
  es: {
    v1: 'Spanish_SereneWoman',
    v2: 'Spanish_MaturePartner',
    v3: 'Spanish_ConfidentWoman',
  },
  ar: {
    v1: 'Arabic_CalmWoman',
    v2: 'Arabic_FriendlyGuy',
    v3: 'Arabic_CalmWoman',
  },
  pt: {
    v1: 'Portuguese_SentimentalLady',
    v2: 'Portuguese_Deep-VoicedGentleman',
    v3: 'Portuguese_ConfidentWoman',
  },
  id: {
    v1: 'Indonesian_SweetGirl',
    v2: 'Indonesian_ReservedYoungMan',
    v3: 'Indonesian_CalmWoman',
  },
  fr: {
    v1: 'French_MovieLeadFemale',
    v2: 'French_MaleNarrator',
    v3: 'French_FemaleAnchor',
  },
  de: {
    v1: 'German_SweetLady',
    v2: 'German_FriendlyMan',
    v3: 'German_SweetLady',
  },
};

const SAY_VOICE_MAP: Record<string, string[]> = {
  v1: ['Samantha', 'Ting-Ting'],
  v2: ['Daniel', 'Alex'],
  v3: ['Karen', 'Samantha'],
};

const SAY_LANGUAGE_VOICE_MAP: Record<string, Record<string, string[]>> = {
  zh: {
    v1: ['Ting-Ting', 'Mei-Jia', 'Sin-ji'],
    v2: ['Sin-ji', 'Ting-Ting', 'Mei-Jia'],
    v3: ['Mei-Jia', 'Ting-Ting', 'Sin-ji'],
  },
  en: {
    v1: ['Samantha', 'Karen', 'Moira'],
    v2: ['Daniel', 'Alex', 'Fred'],
    v3: ['Karen', 'Samantha', 'Moira'],
  },
  es: {
    v1: ['Monica', 'Paulina', 'Samantha'],
    v2: ['Jorge', 'Juan', 'Diego'],
    v3: ['Paulina', 'Monica', 'Samantha'],
  },
  ar: {
    v1: ['Maged', 'Samantha'],
    v2: ['Maged', 'Daniel'],
    v3: ['Maged', 'Karen'],
  },
  pt: {
    v1: ['Luciana', 'Joana', 'Samantha'],
    v2: ['Felipe', 'Daniel'],
    v3: ['Joana', 'Luciana'],
  },
  id: {
    v1: ['Damayanti', 'Samantha'],
    v2: ['Damayanti', 'Daniel'],
    v3: ['Damayanti', 'Karen'],
  },
  fr: {
    v1: ['Amelie', 'Thomas', 'Samantha'],
    v2: ['Thomas', 'Daniel'],
    v3: ['Amelie', 'Karen'],
  },
  de: {
    v1: ['Anna', 'Markus', 'Samantha'],
    v2: ['Markus', 'Daniel'],
    v3: ['Anna', 'Karen'],
  },
};

function normalizeTtsLanguage(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'zh';
  if (raw.startsWith('zh') || raw.includes('chinese') || raw.includes('中文')) return 'zh';
  if (raw.startsWith('en') || raw.includes('english')) return 'en';
  if (raw.startsWith('es') || raw.includes('spanish')) return 'es';
  if (raw.startsWith('ar') || raw.includes('arabic')) return 'ar';
  if (raw.startsWith('pt') || raw.includes('portuguese')) return 'pt';
  if (raw.startsWith('id') || raw.includes('indonesian')) return 'id';
  if (raw.startsWith('fr') || raw.includes('french')) return 'fr';
  if (raw.startsWith('de') || raw.includes('german')) return 'de';
  return raw.split(/[-_]/)[0] || 'zh';
}

function piperModelForLanguage(language: string): string {
  const code = normalizeTtsLanguage(language).toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return process.env[`PIPER_MODEL_${code}`] || process.env.PIPER_MODEL || '';
}

function piperConfigForLanguage(language: string, modelPath: string): string {
  const code = normalizeTtsLanguage(language).toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return process.env[`PIPER_CONFIG_${code}`] || process.env.PIPER_CONFIG || `${modelPath}.json`;
}

function xttsLanguageCode(language: string): string {
  const code = normalizeTtsLanguage(language);
  if (code === 'zh') return 'zh-cn';
  return code;
}

function minimaxLanguageBoost(language: string): string {
  const code = normalizeTtsLanguage(language);
  const map: Record<string, string> = {
    zh: 'Chinese',
    en: 'English',
    es: 'Spanish',
    ar: 'Arabic',
    pt: 'Portuguese',
    id: 'Indonesian',
    fr: 'French',
    de: 'German',
  };
  return map[code] || 'auto';
}

function minimaxEndpoint(pathname: string): string {
  const base = (process.env.MINIMAX_BASE_URL || 'https://api.minimax.io').replace(/\/+$/, '');
  const url = new URL(`${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`);
  const groupId = process.env.MINIMAX_GROUP_ID || process.env.MINIMAX_GROUPID || '';
  if (groupId) url.searchParams.set(process.env.MINIMAX_GROUP_ID_PARAM || 'GroupId', groupId);
  return url.toString();
}

function minimaxVoiceFor(voice: string, language: string): string {
  const lang = normalizeTtsLanguage(language);
  const envCode = lang.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const voiceCode = String(voice || 'v1').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return process.env[`MINIMAX_VOICE_${envCode}_${voiceCode}`]
    || process.env[`MINIMAX_VOICE_${voiceCode}`]
    || MINIMAX_VOICE_MAP[lang]?.[voice]
    || MINIMAX_VOICE_MAP.en?.[voice]
    || 'English_FriendlyPerson';
}

interface MinimaxVoiceCacheEntry {
  voiceId: string;
  clonedAt: string;
  activatedAt?: string;
  lastSynthesizedAt?: string;
  lastActivationAttemptAt?: string;
  activationState: 'pending' | 'activated';
  lastError?: string;
}

function readMinimaxVoiceCache(): Record<string, MinimaxVoiceCacheEntry> {
  try {
    const raw = JSON.parse(fs.readFileSync(minimaxVoiceCacheFile(), 'utf8')) as Record<string, string | MinimaxVoiceCacheEntry>;
    return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, typeof value === 'string'
      ? { voiceId: value, clonedAt: '', activationState: 'pending' as const }
      : value]));
  } catch {
    return {};
  }
}

function writeMinimaxVoiceCache(cache: Record<string, MinimaxVoiceCacheEntry>) {
  try {
    fs.mkdirSync(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), { recursive: true });
    fs.writeFileSync(minimaxVoiceCacheFile(), JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    // Cache is only an optimization. If it cannot be written, synthesis can still proceed.
  }
}

function minimaxVoiceCacheKey(voice: string, samplePath: string): string {
  const stat = fs.statSync(samplePath);
  return `${voice}:${stat.mtimeMs}:${stat.size}`;
}

function updateMinimaxVoiceCache(cacheKey: string, patch: Partial<MinimaxVoiceCacheEntry>) {
  const cache = readMinimaxVoiceCache();
  const current = cache[cacheKey];
  if (!current) return;
  cache[cacheKey] = { ...current, ...patch };
  writeMinimaxVoiceCache(cache);
}

function clearMinimaxVoiceCache(cacheKey: string) {
  const cache = readMinimaxVoiceCache();
  if (!cache[cacheKey]) return;
  delete cache[cacheKey];
  writeMinimaxVoiceCache(cache);
}

function minimaxCustomVoiceId(voice: string): string {
  const id = String(voice || '').replace(/^custom:/, '').replace(/[^a-zA-Z0-9_-]/g, '');
  const normalized = `lingshu_${id}`.replace(/[-_]+$/g, '');
  return normalized.length >= 8 ? normalized.slice(0, 120) : `lingshu_${randomUUID().replace(/-/g, '')}`;
}

function bufferFromMinimaxAudio(audio: string, outputFormat: string): Buffer | null {
  const raw = String(audio || '').trim();
  if (!raw) return null;
  if (outputFormat === 'url' || /^https?:\/\//i.test(raw)) return null;
  if (/^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0) return Buffer.from(raw, 'hex');
  try {
    return Buffer.from(raw.replace(/^data:audio\/[^;]+;base64,/, ''), 'base64');
  } catch {
    return null;
  }
}

function voiceSamplePathFromId(voice: string): string | null {
  const id = String(voice || '').replace(/^custom:/, '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) return null;
  try {
    const files = fs.readdirSync(scopedStudioAssetDir(VOICE_SAMPLES_ROOT));
    const found = files.find(file => file.startsWith(`${id}.`));
    return found ? path.join(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), found) : null;
  } catch {
    return null;
  }
}

function isNonSpeechSfxText(text: string): boolean {
  const normalized = String(text || '')
    .replace(/[\s"'“”‘’.,，。!！?？~～…·:：;；-]/g, '')
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  if (/^(噗|噗噗|砰|砰砰|咚|咚咚|哒|哒哒|啪|啪啪|嗒|嗒嗒|咔|咔哒|咔嚓|咯吱|嘎吱|吱呀|叮|叮咚|嘀|滴滴|唰|嗖|嗡|嗡嗡|轰|轰隆|沙沙|刷刷)$/i.test(normalized)) return true;
  if (/^(whoosh|swoosh|pop|popop|bang|boom|ding|beep|click|clack|creak|crack|snap|buzz|whirr|rustle)$/i.test(normalized)) return true;
  if (normalized.length <= 4 && /^([\u54c8\u563f\u5566\u5662\u7830\u549a\u53ee\u6ef4\u54d2\u55d2\u556a\u54d7\u55d2\u5530\u55e1\u5431\u5494\u55d2])\1+$/.test(normalized)) return true;
  return false;
}

/** 从脚本里提取可朗读的口语文本（去掉 [Hook]、Scene、Shot/Camera/Visual 等标注） */
function spokenText(script: string): string {
  const out: string[] = [];
  for (let line of String(script || '').split('\n')) {
    line = line.trim();
    if (!line) continue;
    if (/^\[.*\]$/.test(line)) continue;
    line = line.replace(/^\[[^\]]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*\]\s*/i, '').trim();
    if (!line) continue;
    if (/^scene\s*\d/i.test(line)) continue;
    const vo = line.match(/^(voiceover|vo|台词|人物说|口播)\s*[:：]\s*(.+)$/i);
    if (vo) {
      if (!isNonSpeechSfxText(vo[2])) out.push(vo[2]);
      continue;
    }
    if (/^(shot|camera|visual|music|environment|subtitle|caption|画面|镜头|运镜|景别|环境|配乐|字幕)\s*[:：]/i.test(line)) continue;
    if (!/[：:]/.test(line) && !isNonSpeechSfxText(line)) out.push(line);
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

function execFileOk(file: string, args: string[], timeout = 45_000): Promise<boolean> {
  return new Promise(resolve => {
    execFile(file, args, { timeout }, err => resolve(!err));
  });
}

function durationFromText(text: string): number {
  const chars = String(text || '').replace(/\s+/g, '').length;
  return Math.max(2, Math.min(60, Math.ceil(chars / 9)));
}

function fallbackToneWav(text: string): { file: string; duration: number } {
  try { fs.mkdirSync(scopedStudioAssetDir(TTS_ROOT), { recursive: true }); } catch { /* ignore */ }
  const sampleRate = 24000;
  const duration = durationFromText(text);
  const samples = sampleRate * duration;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, i / 1600, (samples - i) / 1600);
    const freq = 210 + (i % sampleRate) / sampleRate * 90;
    const value = Math.sin(2 * Math.PI * freq * t) * 0.12 * Math.max(0, envelope);
    pcm.writeInt16LE(Math.max(-1, Math.min(1, value)) * 32767, i * 2);
  }
  const file = `${randomUUID()}.wav`;
  fs.writeFileSync(path.join(scopedStudioAssetDir(TTS_ROOT), file), wavFromPcm(pcm, sampleRate));
  return { file, duration };
}

async function minimaxFetchJson(pathname: string, body: Record<string, unknown>, timeoutMs = 90_000): Promise<any> {
  const apiKey = process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '';
  if (!apiKey) throw new Error('MINIMAX_API_KEY not set');
  const response = await fetch(minimaxEndpoint(pathname), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`MiniMax HTTP ${response.status}: ${JSON.stringify(json).slice(0, 240)}`);
  const statusCode = Number(json?.base_resp?.status_code ?? 0);
  if (statusCode !== 0) {
    throw new Error(`MiniMax ${statusCode}: ${String(json?.base_resp?.status_msg || 'request failed')}`);
  }
  return json;
}

function minimaxSpeechText(text: string, style: TtsStyleOptions): string {
  const clean = String(text || '').replace(/<#\d+(?:\.\d+)?#>/g, '').trim();
  if (style.pauseStyle === 'few') return clean;
  // Slightly varied pauses sound less metronomic than applying one fixed gap
  // after every comma/full stop. The sequence is deterministic so regenerating
  // the same copy remains predictable.
  const sentencePauses = style.pauseStyle === 'dramatic'
    ? [0.34, 0.46, 0.39, 0.52]
    : [0.18, 0.27, 0.22, 0.31];
  const clausePauses = style.pauseStyle === 'dramatic'
    ? [0.16, 0.24, 0.19]
    : [0.07, 0.13, 0.09];
  let sentenceIndex = 0;
  let clauseIndex = 0;
  return clean
    .replace(/([。！？!?；;])(?=\s*\S)/g, punctuation => {
      const pause = sentencePauses[sentenceIndex++ % sentencePauses.length];
      return `${punctuation}<#${pause.toFixed(2)}#>`;
    })
    .replace(/([，,：:])(?=\s*\S)/g, punctuation => {
      const pause = clausePauses[clauseIndex++ % clausePauses.length];
      return `${punctuation}<#${pause.toFixed(2)}#>`;
    });
}

function minimaxVoiceModify(style: TtsStyleOptions): { pitch: number; intensity: number; timbre: number } {
  const preset = style.preset || 'authentic_review';
  const presetShape: Record<TtsPreset, { pitch: number; timbre: number }> = {
    tiktok_excited: { pitch: 2, timbre: 2 },
    authentic_review: { pitch: 0, timbre: 1 },
    professional_b2b: { pitch: -1, timbre: -2 },
    warm_story: { pitch: -1, timbre: 3 },
    urgent_cta: { pitch: 1, timbre: -1 },
  };
  // Keep modification restrained: large values make speech processed rather
  // than expressive. This makes the UI emotion control affect MiniMax while
  // preserving the selected speaker's identity.
  const intensity = Math.max(-8, Math.min(14, Math.round(((style.emotionIntensity ?? 65) - 50) * 0.35)));
  return { ...presetShape[preset], intensity };
}

function minimaxPronunciationDict(style: TtsStyleOptions): { tone: string[] } | undefined {
  const tone = (style.pronunciations || [])
    .map(item => `${item.word}/${item.pronunciation}`)
    .filter(item => !/[\r\n]/.test(item));
  return tone.length ? { tone } : undefined;
}

async function minimaxSubtitleCues(url: unknown, duration: number): Promise<AlignedCue[]> {
  if (!/^https?:\/\//i.test(String(url || ''))) return [];
  try {
    const response = await fetch(String(url), { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return [];
    const json = await response.json().catch(() => null) as any;
    const rows = Array.isArray(json) ? json
      : [json?.subtitles, json?.subtitle, json?.sentences, json?.words, json?.data].find(Array.isArray) || [];
    const normalized = rows.map((row: any) => {
      const text = String(row?.text ?? row?.word ?? row?.content ?? '').trim();
      const startMs = Number(row?.start_time ?? row?.begin_time ?? row?.start ?? row?.startTime ?? 0);
      const endMs = Number(row?.end_time ?? row?.end ?? row?.endTime ?? startMs);
      return { text, start: Math.max(0, startMs / 1000), end: Math.min(duration, Math.max(startMs + 80, endMs) / 1000) };
    }).filter((row: AlignedCue) => row.text && row.end > row.start);
    return normalized;
  } catch {
    return [];
  }
}

async function generateMinimaxTts(text: string, voiceId: string, language: string, style: TtsStyleOptions = {}): Promise<{ url: string; duration: number; source: string; cues?: AlignedCue[]; alignmentSource?: 'minimax_native' } | null> {
  const apiKey = process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '';
  if (!apiKey) return null;
  try { fs.mkdirSync(scopedStudioAssetDir(TTS_ROOT), { recursive: true }); } catch { /* ignore */ }
  const format = (process.env.MINIMAX_TTS_FORMAT || 'mp3').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp3';
  const outputFormat = (process.env.MINIMAX_TTS_OUTPUT_FORMAT || 'hex').toLowerCase();
  const sampleRate = Math.min(44100, Math.max(16000, Number(process.env.MINIMAX_TTS_SAMPLE_RATE || 32000) || 32000));
  const bitrate = Math.min(256000, Math.max(32000, Number(process.env.MINIMAX_TTS_BITRATE || 128000) || 128000));
  const speed = Math.min(2, Math.max(0.5, Number(style.speed ?? process.env.MINIMAX_TTS_SPEED ?? 1) || 1));
  const volume = Math.min(10, Math.max(0.1, Number(process.env.MINIMAX_TTS_VOLUME || 1) || 1));
  const pitch = Math.min(12, Math.max(-12, Number(process.env.MINIMAX_TTS_PITCH || 0) || 0));
  const model = process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd';
  const spokenText = minimaxSpeechText(text, style);
  const payload: Record<string, unknown> = {
    model,
    text: spokenText.slice(0, 5000),
    stream: false,
    language_boost: minimaxLanguageBoost(language),
    output_format: outputFormat,
    voice_setting: {
      voice_id: voiceId,
      speed,
      vol: volume,
      pitch,
    },
    voice_modify: minimaxVoiceModify(style),
    audio_setting: {
      sample_rate: sampleRate,
      bitrate,
      format,
      channel: 1,
    },
    ...(minimaxPronunciationDict(style) ? { pronunciation_dict: minimaxPronunciationDict(style) } : {}),
    subtitle_enable: true,
    subtitle_type: 'word',
  };
  const json = await minimaxFetchJson('/v1/t2a_v2', payload, Number(process.env.MINIMAX_TTS_TIMEOUT_MS || 90_000));
  const audio = String(json?.data?.audio || '');
  const remoteUrl = outputFormat === 'url' && /^https?:\/\//i.test(audio) ? audio : '';
  const duration = Math.max(1, Math.round(Number(json?.extra_info?.audio_length || 0) / 1000) || durationFromText(text));
  const cues = await minimaxSubtitleCues(json?.data?.subtitle_file, duration);
  if (remoteUrl) return { url: remoteUrl, duration, source: 'minimax', ...(cues.length ? { cues, alignmentSource: 'minimax_native' as const } : {}) };

  const buf = bufferFromMinimaxAudio(audio, outputFormat);
  if (!buf?.length) throw new Error('MiniMax did not return audio data');
  const file = `${randomUUID()}.${format}`;
  fs.writeFileSync(path.join(scopedStudioAssetDir(TTS_ROOT), file), buf);
  return { url: scopedStudioAssetUrl('tts', file), duration, source: 'minimax', ...(cues.length ? { cues, alignmentSource: 'minimax_native' as const } : {}) };
}

async function uploadMinimaxVoiceSample(samplePath: string): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '';
  if (!apiKey) throw new Error('MINIMAX_API_KEY not set');
  const ext = path.extname(samplePath).toLowerCase();
  if (!['.mp3', '.m4a', '.wav'].includes(ext)) {
    throw new Error('MiniMax 真人音色录入仅支持 mp3/m4a/wav，请重新上传清晰录音。');
  }
  const buf = fs.readFileSync(samplePath);
  const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.m4a' ? 'audio/mp4' : 'audio/wav';
  const form = new FormData();
  form.append('purpose', 'voice_clone');
  form.append('file', new Blob([new Uint8Array(buf)], { type: mime }), path.basename(samplePath));
  const response = await fetch(minimaxEndpoint('/v1/files/upload'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(Number(process.env.MINIMAX_UPLOAD_TIMEOUT_MS || 90_000)),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`MiniMax upload HTTP ${response.status}: ${JSON.stringify(json).slice(0, 240)}`);
  const statusCode = Number(json?.base_resp?.status_code ?? 0);
  if (statusCode !== 0) throw new Error(`MiniMax upload ${statusCode}: ${String(json?.base_resp?.status_msg || 'request failed')}`);
  const fileId = String(json?.file?.file_id || '').trim();
  if (!fileId) throw new Error('MiniMax upload did not return file_id');
  return fileId;
}

async function ensureMinimaxClonedVoice(voice: string, language: string): Promise<{ voiceId: string; cacheKey: string } | null> {
  const apiKey = process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '';
  if (!apiKey) return null;
  const samplePath = voiceSamplePathFromId(voice);
  if (!samplePath) return null;
  const cacheKey = minimaxVoiceCacheKey(voice, samplePath);
  const cache = readMinimaxVoiceCache();
  if (cache[cacheKey]?.voiceId) {
    const existing = cache[cacheKey];
    if (existing.activationState !== 'activated') {
      const attemptedAt = Date.parse(existing.lastActivationAttemptAt || '');
      if (!Number.isFinite(attemptedAt) || Date.now() - attemptedAt > 60 * 60 * 1000) {
        updateMinimaxVoiceCache(cacheKey, { lastActivationAttemptAt: new Date().toISOString() });
        try {
          const activation = await generateMinimaxTts(
            process.env.MINIMAX_ACTIVATION_TEXT || '你好，这是我的品牌授权音色。',
            existing.voiceId,
            language,
            { preset: 'authentic_review', emotion: '自然可信', emotionIntensity: 55, speed: 1 },
          );
          if (activation) {
            const now = new Date().toISOString();
            updateMinimaxVoiceCache(cacheKey, { activationState: 'activated', activatedAt: now, lastSynthesizedAt: now, lastError: undefined });
          }
        } catch (error) {
          updateMinimaxVoiceCache(cacheKey, { lastError: String(error instanceof Error ? error.message : error).slice(0, 240) });
        }
      }
    }
    return { voiceId: existing.voiceId, cacheKey };
  }

  const voiceId = minimaxCustomVoiceId(voice);
  const fileId = await uploadMinimaxVoiceSample(samplePath);
  try {
    await minimaxFetchJson('/v1/voice_clone', {
      file_id: Number(fileId),
      voice_id: voiceId,
      text: process.env.MINIMAX_CLONE_PREVIEW_TEXT || '这是一段用于确认真人音色的试读音频。',
      model: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
      language_boost: minimaxLanguageBoost(language),
    }, Number(process.env.MINIMAX_CLONE_TIMEOUT_MS || 120_000));
  } catch (error: any) {
    const message = String(error?.message || error);
    if (!/duplicate|already exists|exist|重复/i.test(message)) throw error;
  }
  cache[cacheKey] = {
    voiceId,
    clonedAt: new Date().toISOString(),
    activationState: 'pending',
  };
  writeMinimaxVoiceCache(cache);
  updateMinimaxVoiceCache(cacheKey, { lastActivationAttemptAt: new Date().toISOString() });
  try {
    const activation = await generateMinimaxTts(
      process.env.MINIMAX_ACTIVATION_TEXT || '你好，这是我的品牌授权音色。',
      voiceId,
      language,
      { preset: 'authentic_review', emotion: '自然可信', emotionIntensity: 55, speed: 1 },
    );
    if (activation) {
      const now = new Date().toISOString();
      updateMinimaxVoiceCache(cacheKey, { activationState: 'activated', activatedAt: now, lastSynthesizedAt: now, lastError: undefined });
    }
  } catch (error) {
    updateMinimaxVoiceCache(cacheKey, { lastError: String(error instanceof Error ? error.message : error).slice(0, 240) });
  }
  return { voiceId, cacheKey };
}

function minimaxVoiceNeedsReclone(error: unknown): boolean {
  return /voice[^\n]*(?:not found|does not exist|invalid|expired|deleted)|(?:not found|不存在|已删除|过期)[^\n]*voice|voice_id[^\n]*(?:invalid|不存在)/i.test(String(error instanceof Error ? error.message : error));
}

async function generatePiperTts(text: string, language: string): Promise<{ url: string; duration: number; source: string } | null> {
  const piperBin = process.env.PIPER_BIN || process.env.PIPER_PATH || '';
  const modelPath = piperModelForLanguage(language);
  if (!piperBin || !modelPath) return null;
  try { fs.mkdirSync(scopedStudioAssetDir(TTS_ROOT), { recursive: true }); } catch { /* ignore */ }
  const file = `${randomUUID()}.wav`;
  const outPath = path.join(scopedStudioAssetDir(TTS_ROOT), file);
  const args = ['--model', modelPath, '--output_file', outPath];
  const configPath = piperConfigForLanguage(language, modelPath);
  if (configPath && fs.existsSync(configPath)) args.splice(2, 0, '--config', configPath);
  const spoken = text.slice(0, 1500);
  const ok = await new Promise<boolean>(resolve => {
    const child = spawn(piperBin, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve(false);
    }, 60_000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve(code === 0 && fs.existsSync(outPath));
    });
    child.stdin.end(spoken);
  });
  return ok ? { url: scopedStudioAssetUrl('tts', file), duration: durationFromText(text), source: 'piper' } : null;
}

async function generateXttsCloneTts(text: string, voice: string, language: string): Promise<{ url: string; duration: number; source: string } | null> {
  const samplePath = voiceSamplePathFromId(voice);
  const xttsBin = process.env.XTTS_BIN || process.env.COQUI_TTS_BIN || '';
  if (!samplePath || !xttsBin) return null;
  try { fs.mkdirSync(scopedStudioAssetDir(TTS_ROOT), { recursive: true }); } catch { /* ignore */ }
  const file = `${randomUUID()}.wav`;
  const outPath = path.join(scopedStudioAssetDir(TTS_ROOT), file);
  const modelName = process.env.XTTS_MODEL_NAME || 'tts_models/multilingual/multi-dataset/xtts_v2';
  const args = [
    '--model_name', modelName,
    '--text', text.slice(0, 1500),
    '--speaker_wav', samplePath,
    '--language_idx', xttsLanguageCode(language),
    '--out_path', outPath,
  ];
  const ok = await new Promise<boolean>(resolve => {
    const child = spawn(xttsBin, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve(false);
    }, Number(process.env.XTTS_TIMEOUT_MS || 120_000));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve(code === 0 && fs.existsSync(outPath));
    });
  });
  return ok ? { url: scopedStudioAssetUrl('tts', file), duration: durationFromText(text), source: 'xtts_clone' } : null;
}

async function generateLocalSayTts(text: string, voice: string, language: string): Promise<{ url: string; duration: number; source: string } | null> {
  if (process.platform !== 'darwin') return null;
  try { fs.mkdirSync(scopedStudioAssetDir(TTS_ROOT), { recursive: true }); } catch { /* ignore */ }
  const base = randomUUID();
  const aiffFile = `${base}.aiff`;
  const wavFile = `${base}.wav`;
  const aiffPath = path.join(scopedStudioAssetDir(TTS_ROOT), aiffFile);
  const wavPath = path.join(scopedStudioAssetDir(TTS_ROOT), wavFile);
  const lang = normalizeTtsLanguage(language);
  const candidates = SAY_LANGUAGE_VOICE_MAP[lang]?.[voice] ?? SAY_VOICE_MAP[voice] ?? [];
  const spoken = text.slice(0, 1500);

  let made = false;
  for (const candidate of candidates) {
    made = await execFileOk('/usr/bin/say', ['-v', candidate, '-o', aiffPath, spoken]);
    if (made && fs.existsSync(aiffPath)) break;
  }
  if (!made) made = await execFileOk('/usr/bin/say', ['-o', aiffPath, spoken]);
  if (!made || !fs.existsSync(aiffPath)) return null;

  const converted = await runFfmpeg(['-i', aiffPath, '-ar', '24000', '-ac', '1', '-y', wavPath]);
  try { fs.unlinkSync(aiffPath); } catch { /* ignore */ }
  if (converted && fs.existsSync(wavPath)) {
    return { url: scopedStudioAssetUrl('tts', wavFile), duration: durationFromText(text), source: 'local_say' };
  }
  return { url: scopedStudioAssetUrl('tts', aiffFile), duration: durationFromText(text), source: 'local_say' };
}

async function generateTtsAudio(spoken: string, voice: string, language = 'zh', style: TtsStyleOptions = {}): Promise<{ ok: boolean; source: string; url?: string; duration?: number; error?: string; customVoiceStatus?: 'activated'; cues?: AlignedCue[]; alignmentSource?: 'minimax_native' }> {
  if (String(voice || '').startsWith('custom:')) {
    let minimaxError = '';
    try {
      let clonedVoice = await ensureMinimaxClonedVoice(voice, language);
      if (clonedVoice) {
        let minimax: Awaited<ReturnType<typeof generateMinimaxTts>> = null;
        try {
          minimax = await generateMinimaxTts(spoken, clonedVoice.voiceId, language, style);
        } catch (error) {
          if (!minimaxVoiceNeedsReclone(error)) throw error;
          clearMinimaxVoiceCache(clonedVoice.cacheKey);
          clonedVoice = await ensureMinimaxClonedVoice(voice, language);
          if (!clonedVoice) throw error;
          minimax = await generateMinimaxTts(spoken, clonedVoice.voiceId, language, style);
        }
        if (minimax) {
          const now = new Date().toISOString();
          updateMinimaxVoiceCache(clonedVoice.cacheKey, {
            activationState: 'activated',
            activatedAt: now,
            lastSynthesizedAt: now,
            lastError: undefined,
          });
          return { ok: true, ...minimax, customVoiceStatus: 'activated' };
        }
      }
    } catch (e: any) {
      minimaxError = String(e?.message ?? e).slice(0, 240);
    }
    const cloned = await generateXttsCloneTts(spoken, voice, language);
    if (cloned) return { ok: true, ...cloned, error: minimaxError };
    return {
      ok: false,
      source: 'custom_voice_unavailable',
      error: minimaxError
        ? `已录入真人音色，但 MiniMax 克隆/合成失败：${minimaxError}。若要本地兜底，请配置 XTTS/Coqui（XTTS_BIN/COQUI_TTS_BIN）。`
        : '已录入真人音色，但后端未配置 MiniMax（MINIMAX_API_KEY）或 XTTS/Coqui 音色克隆引擎，无法用该音色合成。',
    };
  }
  const voiceName = TTS_VOICE_MAP[voice] || 'Kore';
  const apiKey = process.env.GEMINI_API_KEY;
  let aiError = '';

  try {
    const minimaxVoiceId = minimaxVoiceFor(voice, language);
    const minimax = await generateMinimaxTts(spoken, minimaxVoiceId, language, style);
    if (minimax) return { ok: true, ...minimax };
  } catch (e: any) {
    aiError = `MiniMax: ${String(e?.message ?? e).slice(0, 200)}`;
  }

  if (apiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const r = await ai.models.generateContent({
        model: process.env.GEMINI_TTS_MODEL ?? 'gemini-2.5-flash-preview-tts',
        contents: ttsPerformancePrompt(spoken, style),
        config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
      } as any);
      const b64 = (r as any).candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!b64) throw new Error('no audio in response');

      const pcm = Buffer.from(b64, 'base64');
      const sampleRate = 24000;
      try { fs.mkdirSync(scopedStudioAssetDir(TTS_ROOT), { recursive: true }); } catch { /* ignore */ }
      const file = `${randomUUID()}.wav`;
      fs.writeFileSync(path.join(scopedStudioAssetDir(TTS_ROOT), file), wavFromPcm(pcm, sampleRate));
      return { ok: true, source: 'ai', url: scopedStudioAssetUrl('tts', file), duration: Math.round(pcm.length / (sampleRate * 2)) };
    } catch (e: any) {
      aiError = [aiError, `Gemini: ${String(e?.message ?? e).slice(0, 200)}`].filter(Boolean).join('；');
    }
  } else {
    aiError = [aiError, 'GEMINI_API_KEY not set'].filter(Boolean).join('；');
  }

  const piper = await generatePiperTts(spoken, language);
  if (piper) return { ok: true, ...piper, error: aiError };

  const local = await generateLocalSayTts(spoken, voice, language);
  if (local) return { ok: true, ...local, error: aiError };

  const tone = fallbackToneWav(spoken);
  return { ok: true, source: 'local_tone', url: scopedStudioAssetUrl('tts', tone.file), duration: tone.duration, error: aiError || 'local speech unavailable' };
}

function splitSubtitleText(text: string): string[] {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^。！？!?；;,.，]+[。！？!?；;,.，]?/g)?.map(item => item.trim()).filter(Boolean) || [normalized];
  const result: string[] = [];
  for (const sentence of sentences) {
    const max = /[\u3400-\u9fff]/.test(sentence) ? 16 : 42;
    if (sentence.length <= max) { result.push(sentence); continue; }
    for (let cursor = 0; cursor < sentence.length; cursor += max) result.push(sentence.slice(cursor, cursor + max));
  }
  return result;
}

function proportionalCues(text: string, duration: number): AlignedCue[] {
  const parts = splitSubtitleText(text);
  const totalWeight = parts.reduce((sum, item) => sum + Math.max(1, item.replace(/\s/g, '').length), 0) || 1;
  let cursor = 0;
  return parts.map((item, index) => {
    const start = cursor;
    const end = index === parts.length - 1
      ? duration
      : Math.min(duration, start + duration * Math.max(1, item.replace(/\s/g, '').length) / totalWeight);
    cursor = end;
    return { text: item, start: +start.toFixed(2), end: +Math.max(start + 0.2, end).toFixed(2) };
  });
}

function localTtsFile(url?: string): { bytes: Buffer; mimeType: string } | null {
  if (!url || (!url.startsWith('/tts/') && !url.includes('/private-assets/tts/'))) return null;
  const filePath = path.join(scopedStudioAssetDir(TTS_ROOT), path.basename(new URL(url, 'http://local').pathname));
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.mp3' ? 'audio/mpeg'
    : ext === '.m4a' || ext === '.mp4' ? 'audio/mp4'
      : ext === '.ogg' ? 'audio/ogg'
        : ext === '.webm' ? 'audio/webm'
          : ext === '.aac' ? 'audio/aac'
            : 'audio/wav';
  return { bytes: fs.readFileSync(filePath), mimeType };
}

function studioAudioCapabilities() {
  const minimax = Boolean((process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '').trim());
  const xtts = Boolean((process.env.XTTS_BIN || process.env.COQUI_TTS_BIN || '').trim());
  const gemini = Boolean(process.env.GEMINI_API_KEY?.trim());
  return {
    customVoice: {
      upload: true,
      synthesis: minimax || xtts,
      engines: { minimax, xtts },
      message: minimax || xtts
        ? `真人音色合成可用（${minimax ? 'MiniMax' : 'XTTS/Coqui'}）`
        : '可以保存声音样本，但服务器尚未配置 MiniMax 或 XTTS/Coqui，暂不能用该音色生成配音。',
    },
    minimax: {
      configured: minimax,
      baseUrl: process.env.MINIMAX_BASE_URL || 'https://api.minimax.io',
      model: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
      diagnosticAvailable: minimax,
    },
    subtitles: {
      automatic: true,
      audioTranscription: gemini,
      wordAlignment: gemini,
      fallback: 'proportional',
    },
  };
}

studioRouter.get('/tts/capabilities', (_req, res) => {
  res.json({ ok: true, ...studioAudioCapabilities() });
});

// POST /studio/tts/minimax/diagnose → validates key/network without synthesizing billable audio.
studioRouter.post('/tts/minimax/diagnose', async (_req, res) => {
  const configured = Boolean((process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '').trim());
  if (!configured) {
    res.status(503).json({ ok: false, configured: false, error: 'MINIMAX_API_KEY 未配置。' });
    return;
  }
  const startedAt = Date.now();
  try {
    const result = await minimaxFetchJson('/v1/get_voice', { voice_type: 'all' }, 20_000);
    const clonedVoices = Array.isArray(result?.voice_cloning) ? result.voice_cloning.length : 0;
    res.json({
      ok: true,
      configured: true,
      latencyMs: Date.now() - startedAt,
      model: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
      clonedVoices,
      message: `MiniMax Key 与网络正常，当前账号可查询到 ${clonedVoices} 个已激活克隆音色。`,
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      configured: true,
      latencyMs: Date.now() - startedAt,
      error: String(error instanceof Error ? error.message : error).slice(0, 300),
    });
  }
});

function normalizeAlignedCues(raw: unknown, transcript: string, duration: number): AlignedCue[] {
  const source = Array.isArray(raw) ? raw : [];
  let previousEnd = 0;
  const cues = source.map(item => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const text = String(row.text || '').trim();
    const start = Math.max(previousEnd, Math.min(duration, Number(row.start) || 0));
    const end = Math.max(start + 0.12, Math.min(duration, Number(row.end) || start + 0.5));
    previousEnd = end;
    const words = Array.isArray(row.words) ? row.words.map(word => {
      const value = word && typeof word === 'object' ? word as Record<string, unknown> : {};
      return {
        text: String(value.text || '').trim(),
        start: Math.max(start, Math.min(end, Number(value.start) || start)),
        end: Math.max(start, Math.min(end, Number(value.end) || end)),
      };
    }).filter(word => word.text) : undefined;
    return text ? { text, start: +start.toFixed(2), end: +end.toFixed(2), ...(words?.length ? { words } : {}) } : null;
  }).filter((item): item is AlignedCue => Boolean(item));
  return cues.length ? cues : proportionalCues(transcript, duration);
}

async function alignTtsAudio(transcript: string, url: string | undefined, duration: number): Promise<{ cues: AlignedCue[]; source: 'audio_ai' | 'proportional' }> {
  const media = localTtsFile(url);
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!media || !apiKey) return { cues: proportionalCues(transcript, duration), source: 'proportional' };
  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Align this exact transcript to the supplied speech audio. Return sentence-level subtitle cues and word-level timestamps. Do not paraphrase, translate, add or remove words. Times are seconds from audio start and must be monotonic within 0-${duration.toFixed(2)}. Split Chinese subtitles to about 8-16 characters and other languages to about 4-9 words. Return JSON only: {"cues":[{"text":"...","start":0.0,"end":1.2,"words":[{"text":"...","start":0.0,"end":0.3}]}]}.\n\nExact transcript:\n${transcript.slice(0, 6000)}`;
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_ALIGNMENT_MODEL || 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: media.mimeType, data: media.bytes.toString('base64') } }] }],
      config: { responseMimeType: 'application/json', temperature: 0 },
    } as any);
    const parsed = extractJSON<{ cues?: unknown[] } | unknown[]>(String((response as any).text || ''));
    const rawCues = Array.isArray(parsed) ? parsed : parsed?.cues;
    const cues = normalizeAlignedCues(rawCues, transcript, duration);
    return { cues, source: rawCues?.length ? 'audio_ai' : 'proportional' };
  } catch (error) {
    console.warn('[studio] TTS alignment fallback:', error instanceof Error ? error.message : error);
    return { cues: proportionalCues(transcript, duration), source: 'proportional' };
  }
}

async function rewriteVoiceoverToDuration(text: string, language: string, currentDuration: number, targetDuration: number): Promise<string> {
  const targetChars = Math.max(8, Math.round(text.replace(/\s/g, '').length * targetDuration / Math.max(1, currentDuration)));
  const prompt = `Rewrite this spoken short-video voiceover to fit about ${targetDuration} seconds and approximately ${targetChars} non-space characters at normal speech speed. Language: ${langName(language)}. Preserve every verified product fact, brand name, number and CTA. Do not invent claims. Keep the same emotional arc. Output only the revised spoken copy, without labels, timestamps, quotation marks or explanation.\n\n${text}`;
  try {
    const rewritten = (await callLLM(prompt, { backend: 'gemini' })).trim();
    return rewritten || text;
  } catch {
    return text;
  }
}

async function generateFittedTts(spoken: string, voice: string, language: string, styleInput: unknown) {
  const style = normalizeTtsStyle(styleInput);
  let finalText = spoken;
  console.log(`[studio] TTS start language=${language} target=${style.targetDuration || 0}s preset=${style.preset}`);
  let result = await generateTtsAudio(finalText, voice, language, style);
  console.log(`[studio] TTS audio source=${result.source} duration=${result.duration || 0}s`);
  let adjusted = false;
  const target = style.targetDuration || 0;
  if (result.ok && result.url && result.duration && target > 0 && Math.abs(result.duration - target) > Math.max(0.8, target * 0.08)) {
    // Short audio must not be expanded with invented selling points. Slow it
    // down and let the TTS model add pauses. Only overlong copy is rewritten.
    if (result.duration > target) finalText = await rewriteVoiceoverToDuration(finalText, language, result.duration, target);
    const requestedSpeed = style.speed || 1;
    const fittedSpeed = requestedSpeed * (result.duration / target) * (finalText.length / Math.max(1, spoken.length));
    // Wide time-stretching is one of the strongest sources of robotic speech.
    // Rewrite overlong copy first, then keep automatic fitting within ±8% of
    // the user's chosen delivery speed. Remaining mismatch is handled by edit
    // timing instead of distorting the voice.
    const adjustedSpeed = Math.max(0.75, Math.min(1.35, Math.max(requestedSpeed * 0.92, Math.min(requestedSpeed * 1.08, fittedSpeed))));
    result = await generateTtsAudio(finalText, voice, language, { ...style, speed: adjustedSpeed });
    console.log(`[studio] TTS fitted source=${result.source} duration=${result.duration || 0}s adjusted=${adjustedSpeed.toFixed(2)}x`);
    adjusted = finalText !== spoken || Math.abs(adjustedSpeed - (style.speed || 1)) > 0.02;
  }
  const cues = result.ok && result.duration ? (result.cues?.length ? result.cues : proportionalCues(finalText, result.duration)) : [];
  return { ...result, text: finalText, adjusted, targetDuration: target || undefined, cues, alignmentSource: result.alignmentSource || 'proportional' as const };
}

async function persistTtsResult<T extends { url?: string }>(result: T, tenantId: string): Promise<T> {
  if (!result.url || !objectStorageEnabled()) return result;
  const file = path.basename(new URL(result.url, 'http://local').pathname);
  const filePath = path.join(tenantAssetDir(TTS_ROOT, tenantId), file);
  if (!fs.existsSync(filePath)) return result;
  return { ...result, url: await persistPrivateStudioAsset('tts', tenantId, filePath) };
}

// POST /studio/tts  Body: { script?, text?, voice?, language? } → { ok, url, duration }
studioRouter.post('/tts', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { script = '', text = '', voice = 'v1', language = 'zh', style = {} } = req.body ?? {};
  const spoken = (text || spokenText(script)).trim();
  if (!spoken) { res.status(400).json({ ok: false, error: 'no spoken text' }); return; }

  try {
    const output = await persistTtsResult(await generateFittedTts(spoken, voice, language, style), tenantId);
    const payload = JSON.stringify(output);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(payload));
    res.end(payload);
  } catch (e: any) {
    console.error('[studio] TTS request failed:', e);
    res.json({ ok: false, source: 'fallback', error: String(e?.message ?? e).slice(0, 200) });
  }
});

// POST /studio/tts/align Body: { text, url, duration }
// Kept separate from synthesis so slow alignment never discards a valid audio result.
studioRouter.post('/tts/align', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const url = String(req.body?.url || '').trim();
  const duration = Math.max(0.2, Math.min(180, Number(req.body?.duration) || 0));
  if (!text || (!url.startsWith('/tts/') && !url.includes('/private-assets/tts/')) || !duration) {
    res.status(400).json({ ok: false, error: 'text, local tts url and duration required', cues: [] });
    return;
  }
  const fallback = { cues: proportionalCues(text, duration), source: 'proportional' as const };
  try {
    const aligned = await Promise.race([
      alignTtsAudio(text, url, duration),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('alignment timeout')), 45_000)),
    ]);
    res.json({ ok: true, ...aligned });
  } catch (error) {
    console.warn('[studio] TTS alignment request fallback:', error instanceof Error ? error.message : error);
    res.json({ ok: true, ...fallback });
  }
});

// POST /studio/tts/transcribe Body: { url, duration, language?, transcriptHint? }
// Used for user-uploaded voiceovers: recognize the real audio and create editable subtitle cues.
studioRouter.post('/tts/transcribe', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  const duration = Math.max(0.2, Math.min(180, Number(req.body?.duration) || 0));
  const language = String(req.body?.language || 'auto').trim();
  const transcriptHint = String(req.body?.transcriptHint || '').trim().slice(0, 6000);
  const media = localTtsFile(url);
  if (!media || !duration) {
    res.status(400).json({ ok: false, error: 'local audio url and duration required', text: '', cues: [] });
    return;
  }
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    if (transcriptHint) {
      res.json({ ok: true, text: transcriptHint, cues: proportionalCues(transcriptHint, duration), source: 'proportional' });
    } else {
      res.status(503).json({ ok: false, error: 'GEMINI_API_KEY not set; uploaded audio cannot be transcribed', text: '', cues: [] });
    }
    return;
  }
  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Transcribe the supplied spoken audio and create subtitle timestamps. Language hint: ${language}. Return only JSON: {"text":"exact transcript","cues":[{"text":"subtitle","start":0.0,"end":1.2,"words":[{"text":"word","start":0.0,"end":0.3}]}]}. Do not translate, paraphrase, add sales claims, infer inaudible words, or include music and sound effects. Times must be monotonic within 0-${duration.toFixed(2)} seconds. Split Chinese subtitles to about 8-16 characters and other languages to about 4-9 words.${transcriptHint ? `\nThe current editor script is only a spelling/context hint; follow the actual audio when they differ:\n${transcriptHint}` : ''}`;
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_ALIGNMENT_MODEL || 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: media.mimeType, data: media.bytes.toString('base64') } }] }],
      config: { responseMimeType: 'application/json', temperature: 0 },
    } as any);
    const parsed = extractJSON<{ text?: string; cues?: unknown[] }>(String((response as any).text || ''));
    const text = String(parsed?.text || transcriptHint || '').trim();
    if (!text) throw new Error('audio transcription returned no text');
    const cues = normalizeAlignedCues(parsed?.cues, text, duration);
    res.json({ ok: true, text, cues, source: parsed?.cues?.length ? 'audio_ai' : 'proportional' });
  } catch (error) {
    if (transcriptHint) {
      res.json({ ok: true, text: transcriptHint, cues: proportionalCues(transcriptHint, duration), source: 'proportional', error: String(error instanceof Error ? error.message : error).slice(0, 240) });
    } else {
      res.status(502).json({ ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 240), text: '', cues: [] });
    }
  }
});

// POST /studio/tts/batch  Body: { voice?, items: [{ code, text }] } → 批量生成，多语种只扣一次生成额度
studioRouter.post('/tts/batch', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { voice = 'v1', items = [], style = {} } = req.body ?? {};
  const input = Array.isArray(items) ? items.slice(0, 8) : [];
  if (input.length === 0) { res.status(400).json({ ok: false, error: 'items required', audios: {} }); return; }

  const audios: Record<string, { ok: boolean; source: string; url?: string; duration?: number; error?: string }> = {};
  for (const item of input) {
    const code = String(item?.code || item?.language || '').trim() || 'zh';
    const language = String(item?.language || code).trim() || code;
    const spoken = String(item?.text || '').trim();
    if (!spoken) {
      audios[code] = { ok: false, source: 'empty', error: 'no spoken text' };
      continue;
    }
    audios[code] = await persistTtsResult(await generateFittedTts(spoken.slice(0, 1500), voice, language, style), tenantId);
  }
  res.json({ ok: Object.values(audios).some(item => item.ok && item.url), audios });
});

studioRouter.get('/voice-samples', (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const items = readVoiceSampleIndex().map(item => ({
    ...item,
    url: objectStorageEnabled() ? privateStudioAssetUrl('voice-samples', tenantId, item.file) : scopedStudioAssetUrl('voice-samples', item.file),
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(items);
});

// POST /studio/voice-samples Body: { name, dataBase64, mimeType?, duration? } → 新增真人音色样本
studioRouter.post('/voice-samples', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { name = 'voice-sample.wav', dataBase64, mimeType, duration = 0, replacesVoiceId = '' } = req.body ?? {};
  if (!dataBase64) { res.status(400).json({ ok: false, error: 'dataBase64 required' }); return; }
  try {
    fs.mkdirSync(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), { recursive: true });
    const match = String(dataBase64).match(/^data:([^;]+);base64,(.+)$/);
    const b64 = match ? match[2] : String(dataBase64);
    const type = String(mimeType || match?.[1] || '').toLowerCase();
    const ext = type.includes('mpeg') || type.includes('mp3') ? 'mp3'
      : type.includes('m4a') || type.includes('mp4') ? 'm4a'
      : 'wav';
    if (!['mp3', 'm4a', 'wav'].includes(ext) || /ogg|webm/i.test(type)) {
      res.status(400).json({ ok: false, error: '真人音色样本仅支持 mp3、m4a、wav。' });
      return;
    }
    const seconds = Number(duration) || 0;
    if (seconds > 0 && seconds < 10) {
      res.status(400).json({ ok: false, error: '真人音色样本需要至少 10 秒清晰人声。' });
      return;
    }
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length < 1024 || bytes.length > 20 * 1024 * 1024) {
      res.status(400).json({ ok: false, error: '真人音色样本文件需在 1KB 到 20MB 之间。' });
      return;
    }
    const id = randomUUID();
    const file = `${id}.${ext}`;
    const samplePath = path.join(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), file);
    fs.writeFileSync(samplePath, bytes);
    const storedUrl = await persistPrivateStudioAsset('voice-samples', tenantId, samplePath, type);
    const replacedId = String(replacesVoiceId || '');
    if (replacedId.startsWith('custom:')) {
      const previousPath = voiceSamplePathFromId(replacedId);
      const cache = readMinimaxVoiceCache();
      const replacedEntries = Object.entries(cache).filter(([key]) => key.startsWith(`${replacedId}:`));
      for (const [key, entry] of replacedEntries) {
        if ((process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN) && entry.voiceId) {
          await minimaxFetchJson('/v1/delete_voice', { voice_type: 'voice_cloning', voice_id: entry.voiceId }, 30_000).catch(() => null);
        }
        delete cache[key];
      }
      writeMinimaxVoiceCache(cache);
      if (previousPath && previousPath !== path.join(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), file)) {
        try { fs.unlinkSync(previousPath); } catch { /* replacement already succeeded; stale sample cleanup is best effort */ }
      }
    }
    const voiceId = `custom:${id}`;
    const voiceName = String(name || '真人音色').replace(/\.[^.]+$/, '');
    const index = readVoiceSampleIndex().filter(item => item.voiceId !== replacedId);
    index.push({ voiceId, name: voiceName, file, duration: seconds, createdAt: new Date().toISOString() });
    writeVoiceSampleIndex(index);
    const capabilities = studioAudioCapabilities();
    res.json({
      ok: true,
      id,
      voiceId,
      name: voiceName,
      url: storedUrl,
      duration: seconds,
      synthesisReady: capabilities.customVoice.synthesis,
      engine: capabilities.customVoice.engines.minimax ? 'minimax' : capabilities.customVoice.engines.xtts ? 'xtts' : undefined,
      warning: capabilities.customVoice.synthesis ? undefined : capabilities.customVoice.message,
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e).slice(0, 300) });
  }
});

// POST /studio/voiceover  Body: { name, dataBase64, mimeType?, duration? } → 上传本地口播音频
studioRouter.post('/voiceover', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { name = 'voiceover.wav', dataBase64, mimeType, duration = 0 } = req.body ?? {};
  if (!dataBase64) { res.status(400).json({ ok: false, error: 'dataBase64 required' }); return; }
  try { fs.mkdirSync(scopedStudioAssetDir(TTS_ROOT), { recursive: true }); } catch { /* ignore */ }
  try {
    const extFromMime = (mimeType as string | undefined)?.split('/')[1]?.replace('mpeg', 'mp3').replace('x-wav', 'wav');
    const extFromName = String(name).split('.').pop();
    const ext = (extFromMime || extFromName || 'wav').replace(/[^\w]+/g, '').slice(0, 8) || 'wav';
    const file = `${randomUUID()}.${ext}`;
    const buf = Buffer.from(String(dataBase64).replace(/^data:[^,]+,/, ''), 'base64');
    const filePath = path.join(scopedStudioAssetDir(TTS_ROOT), file);
    fs.writeFileSync(filePath, buf);
    res.json({ ok: true, url: await persistPrivateStudioAsset('tts', tenantId, filePath, String(mimeType || '')), duration: Number(duration) || 0 });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
  }
});

/* ── ④ BGM 曲库（本地磁盘，仅保留用户上传音乐）───────────────────────────────
   渲染时 buildManifest 把选中 BGM 映射成真实 URL。
─────────────────────────────────────────────────────────────────────────── */

const BGM_ROOT = path.join(__dirname, '../../data/bgm');
const BGM_FILE = path.join(__dirname, '../../data/bgm.json');

interface BgmTrack {
  id: string;
  name: string;
  mood: string;
  duration: number;
  file: string;
  url: string;
  recommended?: boolean;
  builtin?: boolean;
  tenantId?: string;
  scope?: 'shared' | 'tenant';
  uploadedBy?: string;
  createdAt: string;
  objectKey?: string;
}

function loadBgm(): BgmTrack[] {
  try { return JSON.parse(fs.readFileSync(BGM_FILE, 'utf8')) as BgmTrack[]; } catch { return []; }
}
function persistBgm(list: BgmTrack[]): void {
  try { fs.mkdirSync(path.dirname(BGM_FILE), { recursive: true }); } catch { /* ignore */ }
  fs.writeFileSync(BGM_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function userBgms(tenantId: string): BgmTrack[] {
  // Pre-isolation uploads have no tenantId and live at data/bgm/<file>.
  // Keep those legacy tracks visible as the authenticated shared library;
  // new uploads remain strictly scoped to their owning tenant.
  return loadBgm().filter(track => !track.builtin && (track.scope === 'shared' || !track.tenantId || track.tenantId === tenantId));
}

function sortBgmTracks(list: BgmTrack[]): BgmTrack[] {
  return [...list].sort((a, b) => {
    const recommendedDelta = (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0);
    if (recommendedDelta) return recommendedDelta;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id);
  });
}

function withRecommendedBgmNames(list: BgmTrack[]): BgmTrack[] {
  return sortBgmTracks(list).map((track, index) => ({
    ...track,
    name: `灵枢推荐配乐${String(index + 1).padStart(2, '0')}`,
    scope: track.scope || (!track.tenantId ? 'shared' : 'tenant'),
    uploadedBy: track.uploadedBy || (!track.tenantId ? '灵枢管理员上传' : '客户上传'),
  }));
}

// GET /studio/bgm → BgmTrack[]（仅用户上传音乐）
studioRouter.get('/bgm', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.json(await Promise.all(withRecommendedBgmNames(userBgms(tenantId)).map(async track => ({
    ...track,
    url: track.objectKey ? await r2SignedGetUrl(track.objectKey, materialSignedUrlTtlSeconds()) : track.url ? signAssetUrl(track.url, tenantId) : track.url,
    objectKey: undefined,
  }))));
});

// POST /studio/bgm  Body: { name, mood?, duration?, dataBase64, mimeType? } → 上传真实音乐
studioRouter.post('/bgm', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const admin = await requireAdminUser(req);
  const { name, mood = '自定义', duration = 0, dataBase64, mimeType } = req.body ?? {};
  if (!dataBase64) { res.status(400).json({ ok: false, error: 'dataBase64 required' }); return; }
  const assetDir = admin ? path.join(BGM_ROOT, 'shared') : scopedStudioAssetDir(BGM_ROOT);
  try { fs.mkdirSync(assetDir, { recursive: true }); } catch { /* ignore */ }
  const id = randomUUID();
  const ext = (mimeType as string | undefined)?.split('/')[1]?.replace('mpeg', 'mp3') || 'mp3';
  const file = `${id}.${ext}`;
  const buf = Buffer.from(String(dataBase64).replace(/^data:[^,]+,/, ''), 'base64');
  const objectKey = objectStorageEnabled() ? (admin ? sharedObjectKey('bgm', file) : tenantPrivateObjectKey('bgm', tenantId, file)) : undefined;
  if (objectKey) await r2Upload({ key: objectKey, body: buf, contentType: materialAssetContentType(file, String(mimeType || '')) });
  else fs.writeFileSync(path.join(assetDir, file), buf);
  const list = loadBgm();
  const tenantTracks = userBgms(tenantId);
  const track: BgmTrack = {
    id,
    name: `灵枢推荐配乐${String(tenantTracks.length + 1).padStart(2, '0')}`,
    mood,
    duration: Number(duration) || 0,
    file,
    url: objectKey ? '' : admin ? `/bgm/${sharedAssetRelativePath(file)}` : scopedStudioAssetUrl('bgm', file),
    objectKey,
    tenantId: admin ? undefined : tenantId,
    scope: admin ? 'shared' : 'tenant',
    uploadedBy: admin ? '灵枢管理员上传' : '客户上传',
    createdAt: new Date().toISOString(),
  };
  list.push(track);
  persistBgm(list);
  res.status(201).json({ ok: true, track });
});

// DELETE /studio/bgm/:id
studioRouter.delete('/bgm/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const list = loadBgm();
  const candidate = list.find(x => x.id === req.params.id);
  const shared = Boolean(candidate && (candidate.scope === 'shared' || !candidate.tenantId));
  const admin = shared ? await requireAdminUser(req) : null;
  const t = candidate && (candidate.tenantId === tenantId || (shared && admin)) ? candidate : undefined;
  if (!t) { res.status(404).json({ ok: false, error: 'BGM not found' }); return; }
  const assetPath = t.scope === 'shared'
    ? path.join(BGM_ROOT, 'shared', t.file)
    : !t.tenantId
      ? path.join(BGM_ROOT, t.file)
      : path.join(scopedStudioAssetDir(BGM_ROOT), t.file);
  if (t.objectKey) await r2Delete(t.objectKey).catch(() => undefined);
  else try { fs.unlinkSync(assetPath); } catch { /* ignore */ }
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
  status: 'draft' | 'published' | 'template';
  spec: Record<string, unknown>;
  thumbSeed?: string;
  createdAt: string;
  updatedAt: string;
}

type StoredStudioProject = StudioProject & { tenant_id: string };

function projectFromRecord(record: any): StudioProject {
  return { id: String(record.id), title: String(record.title || '未命名草稿'), status: record.status || 'draft', spec: record.spec || {}, thumbSeed: record.thumb_seed || undefined, createdAt: String(record.created_at || record.created || ''), updatedAt: String(record.updated_at || record.updated || '') };
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
studioRouter.get('/projects', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<StoredStudioProject>('studio_projects', { where: { tenant_id: tenantId }, sort: '-updated_at', perPage: 500 });
  res.json(result.items.map(projectFromRecord));
});

// POST /studio/projects  Body: { id?, title?, status?, spec, thumbSeed? } → 新建或更新
studioRouter.post('/projects', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { id, title, status = 'draft', spec = {}, thumbSeed } = req.body ?? {};
  const now = new Date().toISOString();

  if (id) {
    const existing = await store.getById<any>('studio_projects', String(id));
    if (existing?.tenant_id === tenantId) {
      await store.update('studio_projects', String(id), { title: title ?? existing.title, status, spec, thumb_seed: thumbSeed || '', updated_at: now });
      res.json({ ok: true, project: projectFromRecord({ ...existing, title: title ?? existing.title, status, spec, thumb_seed: thumbSeed, updated_at: now }) });
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
  const created = await store.create<any>('studio_projects', { tenant_id: tenantId, title: project.title, status, spec, thumb_seed: thumbSeed || '', created_at: now, updated_at: now });
  if (!created) { res.status(503).json({ ok: false, error: 'project storage unavailable' }); return; }
  res.status(201).json({ ok: true, project: projectFromRecord(created) });
});

// GET /studio/projects/:id → 单个（用于再编辑）
studioRouter.get('/projects/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const p = await store.getById<any>('studio_projects', req.params.id);
  if (!p || p.tenant_id !== tenantId) { res.status(404).json({ ok: false, error: 'Project not found' }); return; }
  res.json(projectFromRecord(p));
});

// DELETE /studio/projects/:id
studioRouter.delete('/projects/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const existing = await store.getById<any>('studio_projects', req.params.id);
  if (!existing || existing.tenant_id !== tenantId) { res.status(404).json({ ok: false, error: 'Project not found' }); return; }
  await store.delete('studio_projects', req.params.id);
  res.json({ ok: true });
});

/* ── 爆款裂变批量队列：持久化组合、执行状态与人工审核结果 ─────────────── */
const BATCHES_FILE = path.join(__dirname, '../../data/studio-variation-batches.json');
type BatchItemStatus = 'pending' | 'running' | 'quality_check' | 'review' | 'approved' | 'rejected' | 'failed';
interface VariationBatchItem { id: string; variables: Record<string, string>; status: BatchItemStatus; outputProjectId?: string; qualityScore?: number; note?: string; updatedAt: string }
interface VariationBatch { id: string; tenantId: string; title: string; templateProjectId?: string; status: 'queued' | 'running' | 'review' | 'completed' | 'paused'; estimatedCostCny: number; plan?: Record<string, unknown>; createdAt: string; updatedAt: string; items: VariationBatchItem[] }
function loadVariationBatches(): VariationBatch[] { try { return JSON.parse(fs.readFileSync(BATCHES_FILE, 'utf8')) as VariationBatch[]; } catch { return []; } }
function persistVariationBatches(list: VariationBatch[]): void { fs.mkdirSync(path.dirname(BATCHES_FILE), { recursive: true }); fs.writeFileSync(BATCHES_FILE, JSON.stringify(list, null, 2), 'utf8'); }

studioRouter.get('/variation-batches', (_req, res) => { const { tenantId } = res.locals as AuthLocals; res.json(loadVariationBatches().filter(item => item.tenantId === tenantId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); });
studioRouter.post('/variation-batches', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const body = req.body ?? {};
  const dimensions = body.dimensions && typeof body.dimensions === 'object' ? body.dimensions as Record<string, unknown> : {};
  const values = (key: string) => Array.isArray(dimensions[key]) && (dimensions[key] as unknown[]).length ? (dimensions[key] as unknown[]).map(String) : ['默认'];
  const products = values('product'); const people = values('person'); const scenes = values('scene'); const languages = values('language'); const hooks = values('hook');
  const limit = Math.max(1, Math.min(200, Number(body.maxItems) || 20));
  const now = new Date().toISOString(); const items: VariationBatchItem[] = [];
  outer: for (const product of products) for (const person of people) for (const scene of scenes) for (const language of languages) for (const hook of hooks) {
    items.push({ id: randomUUID(), variables: { product, person, scene, language, hook }, status: 'pending', updatedAt: now });
    if (items.length >= limit) break outer;
  }
  const duration = Math.max(1, Number(body.duration) || 20);
  const batch: VariationBatch = { id: randomUUID(), tenantId, title: String(body.title || '未命名裂变批次'), templateProjectId: body.templateProjectId ? String(body.templateProjectId) : undefined, status: 'queued', estimatedCostCny: Math.ceil(items.length * duration * 1.5 * 100) / 100, plan: body.plan && typeof body.plan === 'object' ? body.plan as Record<string, unknown> : { duration, maxItems: limit, dimensions }, createdAt: now, updatedAt: now, items };
  const list = loadVariationBatches(); list.push(batch); persistVariationBatches(list); res.status(201).json({ ok: true, batch });
});
studioRouter.patch('/variation-batches/:batchId', (req, res) => {
  const { tenantId } = res.locals as AuthLocals; const list = loadVariationBatches(); const batch = list.find(item => item.id === req.params.batchId && item.tenantId === tenantId);
  if (!batch) { res.status(404).json({ ok: false, error: 'Batch not found' }); return; }
  if (['queued', 'running', 'review', 'completed', 'paused'].includes(String(req.body?.status))) batch.status = req.body.status;
  batch.updatedAt = new Date().toISOString(); persistVariationBatches(list); res.json({ ok: true, batch });
});
studioRouter.patch('/variation-batches/:batchId/items/:itemId', (req, res) => {
  const { tenantId } = res.locals as AuthLocals; const list = loadVariationBatches(); const batch = list.find(entry => entry.id === req.params.batchId && entry.tenantId === tenantId); const item = batch?.items.find(entry => entry.id === req.params.itemId);
  if (!batch || !item) { res.status(404).json({ ok: false, error: 'Batch item not found' }); return; }
  const allowed: BatchItemStatus[] = ['pending', 'running', 'quality_check', 'review', 'approved', 'rejected', 'failed'];
  if (allowed.includes(req.body?.status)) item.status = req.body.status;
  if (req.body?.outputProjectId) item.outputProjectId = String(req.body.outputProjectId);
  if (Number.isFinite(Number(req.body?.qualityScore))) item.qualityScore = Number(req.body.qualityScore);
  if (typeof req.body?.note === 'string') item.note = req.body.note;
  item.updatedAt = new Date().toISOString(); batch.updatedAt = item.updatedAt;
  if (batch.items.every(entry => entry.status === 'approved' || entry.status === 'rejected')) batch.status = 'completed'; else if (batch.items.some(entry => entry.status === 'review')) batch.status = 'review';
  persistVariationBatches(list); res.json({ ok: true, batch, item });
});
studioRouter.post('/variation-batches/:batchId/claim-next', (req, res) => {
  const { tenantId } = res.locals as AuthLocals; const list = loadVariationBatches(); const batch = list.find(entry => entry.id === req.params.batchId && entry.tenantId === tenantId);
  if (!batch) { res.status(404).json({ ok: false, error: 'Batch not found' }); return; }
  if (batch.status === 'paused' || batch.status === 'completed') { res.json({ ok: true, item: null, batch }); return; }
  const staleBefore = Date.now() - 30 * 60 * 1000;
  const item = batch.items.find(entry => entry.status === 'pending' || (entry.status === 'running' && new Date(entry.updatedAt).getTime() < staleBefore));
  if (!item) { batch.status = batch.items.some(entry => entry.status === 'review') ? 'review' : batch.status; persistVariationBatches(list); res.json({ ok: true, item: null, batch }); return; }
  item.status = 'running'; item.updatedAt = new Date().toISOString(); batch.status = 'running'; batch.updatedAt = item.updatedAt; persistVariationBatches(list); res.json({ ok: true, item, batch });
});
studioRouter.post('/variation-batches/:batchId/retry-failed', (req, res) => {
  const { tenantId } = res.locals as AuthLocals; const list = loadVariationBatches(); const batch = list.find(entry => entry.id === req.params.batchId && entry.tenantId === tenantId);
  if (!batch) { res.status(404).json({ ok: false, error: 'Batch not found' }); return; }
  let count = 0; const now = new Date().toISOString(); batch.items.forEach(item => { if (item.status === 'failed' || item.status === 'rejected') { item.status = 'pending'; item.updatedAt = now; count += 1; } });
  if (count) batch.status = 'queued'; batch.updatedAt = now; persistVariationBatches(list); res.json({ ok: true, retried: count, batch });
});

const PUBLISH_LINKS_FILE = path.join(__dirname, '../../data/studio-publish-links.json');
studioRouter.get('/publish-records', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.json(listPublishRecords(tenantId, req.query.accountId ? String(req.query.accountId) : undefined));
});
studioRouter.post('/publish-recommendations', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];
  const recommendations = targets
    .filter((target: any) => ['youtube', 'tiktok', 'instagram', 'facebook'].includes(String(target?.platform)))
    .map((target: any) => ({
      accountId: String(target.accountId || ''),
      platform: String(target.platform),
      ...recommendPublish({
        tenantId,
        platform: String(target.platform) as PublishPlatform,
        accountId: String(target.accountId || ''),
        videoPath: String(req.body?.videoPath || ''),
        projectId: req.body?.projectId ? String(req.body.projectId) : undefined,
        generationVersionId: req.body?.generationVersionId ? String(req.body.generationVersionId) : undefined,
        title: String(req.body?.title || ''),
        ratio: req.body?.ratio ? String(req.body.ratio) : undefined,
        language: req.body?.language ? String(req.body.language) : undefined,
      }),
    }));
  res.json({ recommendations });
});
studioRouter.get('/publish-links', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try { res.json((JSON.parse(fs.readFileSync(PUBLISH_LINKS_FILE, 'utf8')) as any[]).filter(item => item.tenantId === tenantId)); } catch { res.json([]); }
});
studioRouter.post('/publish-links', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  let list: Record<string, unknown>[] = []; try { list = JSON.parse(fs.readFileSync(PUBLISH_LINKS_FILE, 'utf8')) as Record<string, unknown>[]; } catch { /* empty */ }
  const link = { id: randomUUID(), tenantId, projectId: String(req.body?.projectId || ''), batchId: req.body?.batchId ? String(req.body.batchId) : undefined, variantId: req.body?.variantId ? String(req.body.variantId) : undefined, accountId: String(req.body?.accountId || ''), platform: String(req.body?.platform || ''), title: String(req.body?.title || ''), publishResult: req.body?.publishResult || null, publishedAt: new Date().toISOString() };
  if (!link.projectId) { res.status(400).json({ ok: false, error: 'projectId required' }); return; }
  list.push(link); fs.mkdirSync(path.dirname(PUBLISH_LINKS_FILE), { recursive: true }); fs.writeFileSync(PUBLISH_LINKS_FILE, JSON.stringify(list, null, 2), 'utf8'); res.status(201).json({ ok: true, link });
});
studioRouter.patch('/publish-links/:id/metrics', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  let list: Record<string, any>[] = []; try { list = JSON.parse(fs.readFileSync(PUBLISH_LINKS_FILE, 'utf8')) as Record<string, any>[]; } catch { /* empty */ }
  const link = list.find(item => item.id === req.params.id && item.tenantId === tenantId); if (!link) { res.status(404).json({ ok: false, error: 'Publish link not found' }); return; }
  link.metrics = { views: Number(req.body?.views) || 0, likes: Number(req.body?.likes) || 0, comments: Number(req.body?.comments) || 0, shares: Number(req.body?.shares) || 0, leads: Number(req.body?.leads) || 0, updatedAt: new Date().toISOString() };
  fs.writeFileSync(PUBLISH_LINKS_FILE, JSON.stringify(list, null, 2), 'utf8'); res.json({ ok: true, link });
});
studioRouter.get('/publish-performance', (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  let list: Record<string, any>[] = []; try { list = JSON.parse(fs.readFileSync(PUBLISH_LINKS_FILE, 'utf8')) as Record<string, any>[]; } catch { /* empty */ }
  const grouped: Record<string, any> = {};
  for (const link of list.filter(item => item.tenantId === tenantId)) { const key = String(link.projectId || 'unknown'); const row = grouped[key] ||= { projectId: key, posts: 0, views: 0, likes: 0, comments: 0, shares: 0, leads: 0 }; row.posts += 1; for (const metric of ['views', 'likes', 'comments', 'shares', 'leads']) row[metric] += Number(link.metrics?.[metric]) || 0; }
  res.json(Object.values(grouped).map((row: any) => ({ ...row, engagementRate: row.views ? Math.round(((row.likes + row.comments + row.shares) / row.views) * 10000) / 100 : 0 })).sort((a: any, b: any) => b.views - a.views));
});

/* ── 本地降级生成 ──────────────────────────────────────────────────────── */

function compactProductLabel(productInfo: string): string {
  const names = Array.from(String(productInfo || '').matchAll(/产品名称[：:]\s*([^\n]+)/g))
    .map(match => String(match[1] || '').trim())
    .filter(name => name && !/^(this product|主推产品|企业产品组合)$/i.test(name));
  if (names.length) return names.join(' + ').slice(0, 120);
  const match = String(productInfo || '').match(/(?:主推品|产品类目|所属类目|Product|product)\s*[：:]\s*([^\n]+)/i);
  const fallback = String(match?.[1] || String(productInfo || '').split('\n')[0] || '').trim();
  return fallback && !/^(this product|主推产品|企业产品组合)$/i.test(fallback) ? fallback.slice(0, 80) : '选定产品';
}

function productField(productInfo: string, label: string): string {
  const match = String(productInfo || '').match(new RegExp(`${label}[：:]\\s*([^\\n]+)`));
  return match?.[1]?.trim() || '';
}

function firstProductField(productInfo: string, labels: string[]): string {
  for (const label of labels) {
    const value = productField(productInfo, label);
    if (value) return value;
  }
  return '';
}

function productBrief(productInfo: string) {
  const name = compactProductLabel(productInfo);
  const category = firstProductField(productInfo, ['所属类目', '产品类目']) || '目标采购场景';
  const highlights = conservativeClaim(firstProductField(productInfo, ['产品卖点', '核心优势']) || '真实材质和使用细节');
  const moq = firstProductField(productInfo, ['起订量', 'MOQ']) || '可按需求确认';
  const cert = firstProductField(productInfo, ['认证资质', '认证']) || '可按需求确认';
  const price = firstProductField(productInfo, ['价格区间', '价格']);
  const detailPoints = [
    ['容量', firstProductField(productInfo, ['容量'])],
    ['杯体材质', firstProductField(productInfo, ['杯体材质'])],
    ['刀片材质', firstProductField(productInfo, ['刀片材质'])],
    ['材质', firstProductField(productInfo, ['材质', '产品材质'])],
    ['充电方式', firstProductField(productInfo, ['充电方式'])],
    ['尺寸', firstProductField(productInfo, ['尺寸', '产品尺寸'])],
    ['规格', firstProductField(productInfo, ['规格'])],
  ].filter((item): item is string[] => Boolean(item[1])).map(([label, value]) => `${label} ${value}`);
  const highlightPoints = highlights.split(/[、,，;；\n]/).map(item => item.trim()).filter(Boolean);
  const pointList = [
    ...detailPoints,
    ...highlightPoints,
    cert && cert !== '可按需求确认' ? `认证 ${cert}` : '',
    moq && moq !== '可按需求确认' ? `起订量 ${moq}` : '',
    price ? `报价 ${price}` : '',
  ].filter(Boolean);
  return {
    name,
    category,
    highlights,
    moq,
    cert,
    price,
    firstPoint: pointList[0] || highlights || category,
    secondPoint: pointList[1] || cert || '样品和资料可确认',
    thirdPoint: pointList[2] || highlightPoints[0] || '实际操作可打样确认',
    detailPoints,
    highlightPoints,
    naturalTrustPoint: cert && cert !== '可按需求确认' ? '认证和检测资料能不能一次给齐' : '样品和资料能不能按需求确认',
  };
}

function compactBriefCategory(p: ReturnType<typeof productBrief>): string {
  const items = String(p.category || '').split(/[、,，/]/).map(item => item.trim()).filter(Boolean);
  if (p.name && items.some(item => p.name.includes(item) || item.includes(p.name))) return p.name;
  return items[0] || p.name || '产品';
}

function buyerPainForBrief(p: ReturnType<typeof productBrief>): string {
  const text = `${p.name} ${p.category}`.toLowerCase();
  if (/灯|照明|light|lighting|轨道|筒灯|线性|庭院|调光/.test(text)) {
    return '订购一大批灯具，结果现场亮度、色温和图文效果严重不符';
  }
  if (/包装|袋|盒|纸|paper|bag|box|package/.test(text)) {
    return '下单后才发现包装材质、尺寸和印刷效果跟样图不一样';
  }
  if (/美妆|护肤|cream|serum|cosmetic|skincare/.test(text)) {
    return '选品时只看图片，结果质地、包装和市场卖点都对不上';
  }
  if (/榨汁|果汁|搅拌|小家电|blender|juicer|appliance/.test(text)) {
    return '样品看着可以，大货的结构和操作细节会不会不一致';
  }
  return `批量采购${compactBriefCategory(p)}，最怕样品看着可以，大货效果和描述不一致`;
}

function sceneEnvironmentForBrief(p: ReturnType<typeof productBrief>, index: number): string {
  const text = `${p.name} ${p.category}`.toLowerCase();
  if (/灯|照明|light|lighting|轨道|筒灯|线性|庭院|调光/.test(text)) {
    return [
      '现代简约室内展厅，白墙和木色桌面，顶部已安装一段轨道灯',
      '半暗室内样板间，墙面保留一块明暗对比区域',
      '安装台面旁，样品、驱动、电源线和参数卡整齐摆放',
      '工程客户选型桌面，色温样品、外壳色卡和包装标签并排',
      '工厂老化测试架或样品打包台，背景能看到成排灯具点亮',
    ][index] || '真实产品演示场景';
  }
  if (/榨汁|果汁|搅拌|小家电|blender|juicer|appliance/.test(text)) {
    return [
      '干净桌面演示区，榨汁杯、产品资料和一杯清水放在同一画面',
      '产品细节台，杯体、杯盖和参数卡整齐摆放',
      '俯拍操作台，杯体与刀头结构保持清晰可见',
      '定制样品桌，LOGO位置和彩盒样并排展示',
      '样品打包台或询盘电脑旁，画面收束到资料确认动作',
    ][index] || '真实产品演示场景';
  }
  return [
    '干净桌面实拍场景，产品和采购资料放在同一画面',
    '近距离样品展示台，手边放着规格卡和包装样',
    '简单对比测试台，保留一个普通款作为参照',
    '定制选项展示桌，颜色、尺寸、包装或 logo 样并排',
    '样品打包台或询盘电脑旁，画面收束到留言动作',
  ][index] || '真实产品演示场景';
}

function conservativeClaim(value: string): string {
  return String(value || '')
    .replace(/大风吹不烂/g, '不易撕裂，抗拉表现可打样测试')
    .replace(/吹不烂|不破|不裂|纹丝不动/g, '不易撕裂')
    .replace(/最耐用|最便宜|全网|保证/g, '可按需求确认')
    .trim();
}

function fallbackScript(productInfo: string, duration: number): string {
  const p = productBrief(productInfo);
  return `[Hook · 0-3s]
If you source ${p.category}, do not judge ${p.name} by photos only. Check the real detail first.

[Body · 3-${duration - 5}s]
Show ${p.firstPoint}, then confirm sample, packaging, MOQ and certification details on screen.

[CTA · ${duration - 5}-${duration}s]
Send your quantity, size or packaging request, and we will prepare the quote and sample plan.`;
}

function fallbackStoryboard(duration: number, productInfo = ''): string {
  const p = productBrief(productInfo);
  const pain = buyerPainForBrief(p);
  const total = Math.max(10, Number(duration) || 20);
  const boundaries = [0, 0.18, 0.4, 0.62, 0.82, 1].map(value => +(value * total).toFixed(1));
  const time = (index: number) => `${boundaries[index]}-${boundaries[index + 1]}s`;
  const categoryText = `${p.name} ${p.category}`.toLowerCase();
  const appliance = /榨汁|果汁|搅拌|小家电|blender|juicer|appliance/.test(categoryText);
  const detailAction = appliance
    ? `手部依次拿起「${p.name}」的杯体和杯盖，镜头停留在参数卡与可拆结构；只呈现资料已确认的${p.firstPoint}和${p.secondPoint}。`
    : `手部把「${p.name}」移到镜头前，展示${p.firstPoint}和${p.secondPoint}对应的实物或资料卡。`;
  const proofAction = appliance
    ? `俯拍拆开杯体与刀头组件，再按原方向装回；如果没有真实操作素材，只展示实物与${p.thirdPoint}资料卡，不模拟性能结果。`
    : `用一个完整、可复现的开合、按压、装配或样品对照动作确认${p.thirdPoint}；没有真实素材时只展示资料卡。`;
  const customization = p.highlightPoints.slice(0, 2).join('、') || '定制项可按需求确认';
  const shortPoint = (value: string, max = 14) => Array.from(String(value || '')).slice(0, max).join('');
  const openingVoice = appliance ? '榨汁杯好看，不好洗也白搭。' : `${shortPoint(compactBriefCategory(p), 6)}只看图片，真不够。`;
  const firstVoice = appliance && /容量\s*420/i.test(p.firstPoint)
    ? '420毫升，通勤一杯刚刚好。'
    : `${shortPoint(p.firstPoint, 12)}，细节拍给你看。`;
  const proofVoice = appliance && /可拆洗|拆洗/.test(`${p.highlights} ${p.thirdPoint}`)
    ? '杯体能拆，清洗不用绕弯。'
    : /304/.test(p.thirdPoint) ? '刀头用料，拆开给你看。' : `${shortPoint(p.thirdPoint, 10)}，实物更有说服力。`;
  const customizationVoice = /logo|包装|彩盒/i.test(customization)
    ? 'LOGO和彩盒，都能做成你的品牌。'
    : '想做自己的版本？样品可以先聊。';
  return `[${time(0)}]
环境：${sceneEnvironmentForBrief(p, 0)}；
景别：中景；
运镜：固定镜头直拍；
画面：人物把「${p.name}」和采购资料放到桌面，先指向实物，再转向镜头发问，最后把杯体拆开放在镜头前。
配乐：口播 + 舒缓递进，开头保留半秒停顿制造问题感；
台词：${openingVoice}
字幕：${appliance ? '好看 ≠ 好清洗' : pain}

[${time(1)}]
环境：${sceneEnvironmentForBrief(p, 1)}；
景别：近景；
运镜：缓慢推进到产品细节；
画面：${detailAction.replace('；只呈现资料已确认的', '；参数卡同步标出')}
配乐：口播 + 轻节奏鼓点，细节出现时轻微加强；
台词：${firstVoice}
字幕：${appliance ? '420mL · 通勤随行' : `${p.firstPoint} / ${p.secondPoint}`}

[${time(2)}]
环境：${sceneEnvironmentForBrief(p, 2)}；
景别：特写；
运镜：俯拍固定，动作完成后短暂停留；
画面：${proofAction}
配乐：口播 + 短促转场音，操作瞬间降低背景音；
台词：${proofVoice}
字幕：${appliance ? '可拆杯体 · 清洗省事' : '实物确认 / 支持打样'}

[${time(3)}]
环境：${sceneEnvironmentForBrief(p, 3)}；
景别：中近景；
运镜：横向平移扫过选项；
画面：把已有的包装样和LOGO位置并排放好，手指从产品移到彩盒，镜头跟随横移。
配乐：口播 + 稳定节奏，配合手指移动做轻快切点；
台词：${customizationVoice}
字幕：${/logo|包装|彩盒/i.test(customization) ? 'LOGO / 彩盒定制' : '先看定制样'}

[${time(4)}]
环境：${sceneEnvironmentForBrief(p, 4)}；
景别：中景；
运镜：固定镜头，最后轻推到资料页或询盘窗口；
画面：展示样品、资料页或包装箱，屏幕短字幕放 MOQ、认证、报价和打样信息，最后停在询盘动作。
配乐：口播 + 收束感配乐，结尾留出 CTA 停顿；
台词：想测样？发我数量和市场。
字幕：${p.moq !== '可按需求确认' ? `发数量 · MOQ ${p.moq}` : '发数量 · 拿样品报价'}`;
}

function fallbackMaterialStoryboard(infos: ScriptMaterialInfo[], duration: number, productInfo = ''): string {
  const p = compactProductLabel(productInfo);
  const brief = productBrief(productInfo);
  const usable = infos.length ? infos.slice(0, 8) : [{
    name: '待上传素材',
    type: 'video',
    folder: 'upload',
    duration,
    role: '素材片段',
    targetStart: 0,
    targetEnd: duration,
  }];
  const tasks = ['开场钩子', '细节证明', '使用场景', '供应能力', '定制/包装', '询盘 CTA'];
  return usable.map((info, index) => {
    const start = Number.isFinite(Number(info.targetStart)) ? Number(info.targetStart) : +(index * duration / usable.length).toFixed(1);
    const end = Number.isFinite(Number(info.targetEnd)) ? Number(info.targetEnd) : +(index === usable.length - 1 ? duration : (index + 1) * duration / usable.length).toFixed(1);
    const role = materialRoleFromFolder(info);
    const roleTask = info.folder === 'detail' ? (index === 0 ? '开场细节' : '细节证明')
      : info.folder === 'product' ? '产品展示'
        : info.folder === 'model' || info.folder === 'scene' ? '使用场景'
          : info.folder === 'factory' ? '供应能力'
            : info.folder === 'packaging' ? '定制/包装'
              : info.folder === 'certificate' ? '资质证明'
                : '';
    const task = roleTask || tasks[Math.min(index, tasks.length - 1)] || '素材承接';
    const materialText = `${info.name} ${info.tags || ''} ${info.shotFunction || ''}`;
    const isBeauty = /精华|护肤|美容|serum|skincare|cosmetic/i.test(`${p} ${brief.category} ${materialText}`);
    const voice = index === 0
      ? (/滴|液体|质地/i.test(materialText)
        ? '这一滴的质感，开场就很抓眼。'
        : `${Array.from(p).slice(0, 7).join('')}，第一眼就得抓人。`)
      : index === usable.length - 1
        ? (isBeauty ? '想做自有品牌？发数量，给你配方案。' : '想测样？发我数量和市场。')
        : info.folder === 'product'
          ? (isBeauty ? '瓶身和滴管一入镜，品牌感就来了。' : '外观和结构，镜头里一次看清。')
          : info.folder === 'factory'
            ? '样品能打，大货也要接得住。'
            : info.folder === 'packaging'
              ? '换上你的LOGO，才是你的产品。'
              : info.folder === 'scene' || info.folder === 'model'
                ? '放进真实场景，客户更容易代入。'
                : '细节拍到位，卖点自然站得住。';
    const salesSubtitle = index === 0
      ? (/滴|液体|质地/i.test(materialText) ? '一滴抓住注意力' : '第一眼就要抓人')
      : index === usable.length - 1
        ? '发数量 · 拿方案'
        : info.folder === 'product' ? '质感就是品牌感'
          : info.folder === 'factory' ? '样品到大货都能接'
            : info.folder === 'packaging' ? '做成你的品牌'
              : info.folder === 'scene' || info.folder === 'model' ? '让客户看见使用场景'
                : task;
    return `[${start}-${Math.max(start + 0.5, end)}s]
素材：${info.name}
画面：使用素材《${info.name}》作为「${p}」的${task}，原速截取主体最清楚、动作最完整的位置，并在动作结束点切入下一镜。
人物说：“${voice}”
字幕：${salesSubtitle}`;
  }).join('\n\n');
}

const FALLBACK_COVERS = ['You NEED this in 2026', 'Factory price, 24h ship', 'Why everyone is obsessed'];
const FALLBACK_CAPTION = 'Factory-direct home essentials shipped worldwide in 24h 🏠✨';
const FALLBACK_TAGS = ['tiktokmademebuyit', 'homefinds', 'amazonfinds', 'smallbusiness', 'viral', 'musthave'];

function normalizePosterBrief(raw: any) {
  const categories = Array.isArray(raw?.categories) ? raw.categories : [];
  return {
    headline: String(raw?.headline || 'OEM/ODM Private Label Solution').slice(0, 120),
    subheadline: String(raw?.subheadline || 'Build your brand with factory support').slice(0, 140),
    originBadge: String(raw?.originBadge || '').slice(0, 80),
    trustBadges: Array.isArray(raw?.trustBadges) ? raw.trustBadges.map(String).slice(0, 8) : [],
    sellingPoints: Array.isArray(raw?.sellingPoints) ? raw.sellingPoints.map(String).slice(0, 8) : [],
    process: Array.isArray(raw?.process) ? raw.process.map(String).slice(0, 8) : [],
    categories: categories.slice(0, 8).map((item: any) => ({
      name: String(item?.name || item || '').slice(0, 80),
      description: String(item?.description || '').slice(0, 140),
    })).filter((item: { name: string }) => item.name),
    bottomBar: Array.isArray(raw?.bottomBar) ? raw.bottomBar.map(String).slice(0, 8) : [],
    cta: String(raw?.cta || 'DM us for catalog and sample quote').slice(0, 120),
  };
}

function mimeFromFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

function materialLocalFile(material: Material): string | null {
  const raw = material.type === 'image'
    ? material.file
    : material.poster ? material.poster.replace(/^\/media\//, '').split('?')[0] : '';
  if (!raw) return null;
  if (raw.includes('/')) return path.join(MEDIA_DIR, raw);
  const generatedCandidate = path.join(GENERATED_MEDIA_DIR, raw);
  if (fs.existsSync(generatedCandidate)) return generatedCandidate;
  return path.join(MEDIA_DIR, raw);
}

async function resolveReferenceImages(materialIds: unknown, tenantId: string): Promise<ReferenceImage[]> {
  const ids = new Set(Array.isArray(materialIds) ? materialIds.map(String) : []);
  if (!ids.size) return [];
  const refs: ReferenceImage[] = [];
  for (const material of loadMaterials()) {
    if (!ids.has(material.id)) continue;
    if (material.scope !== 'shared' && material.tenantId !== tenantId) continue;
    if (material.objectKey) {
      try {
        const key = material.type === 'image' ? material.objectKey : material.posterObjectKey;
        if (!key) continue;
        const downloaded = await r2Download(key);
        if (!downloaded?.buf.length) continue;
        refs.push({ mimeType: downloaded.contentType, base64: downloaded.buf.toString('base64') });
      } catch {
        continue;
      }
      if (refs.length >= 4) break;
      continue;
    }
    const filePath = materialLocalFile(material);
    if (!filePath || !fs.existsSync(filePath)) continue;
    try {
      refs.push({
        mimeType: mimeFromFile(filePath),
        base64: fs.readFileSync(filePath).toString('base64'),
      });
    } catch {
      // Skip unreadable references; generation can still proceed with remaining assets.
    }
    if (refs.length >= 4) break;
  }
  return refs;
}

function fallbackPosterBrief(input: { productInfo?: unknown; platform?: unknown; ratio?: unknown; posterStyle?: unknown; language?: unknown }) {
  const productText = String(input.productInfo || '');
  const categoryMatch = productText.match(/(?:产品类目|产品名称|主推产品|category|product)[：:]\s*([^\n]+)/i);
  const category = (categoryMatch?.[1] || 'Private Label Product').trim().slice(0, 60);
  const poster = normalizePosterBrief({
    headline: `OEM/ODM ${category}`,
    subheadline: 'Private label solution for overseas brands',
    originBadge: 'Global export support',
    trustBadges: ['GMP', 'ISO', 'FDA-ready'],
    sellingPoints: ['Custom Formula', 'Premium Packaging', 'Factory Support', 'Global Export'],
    process: ['Consultation', 'Formula Development', 'Packaging Design', 'Production', 'Quality Control', 'Delivery'],
    categories: [
      { name: category, description: 'Customizable product line for brand owners and distributors' },
      { name: 'Private Label', description: 'Logo, packaging and formula support for market testing' },
      { name: 'OEM/ODM', description: 'One-stop manufacturing service from sample to bulk order' },
    ],
    bottomBar: ['Low MOQ', 'Custom Formula', 'Premium Packaging', 'Fast Turnaround', 'Dedicated Support'],
    cta: 'Comment “CATALOG” or DM us for sample details',
  });
  return {
    layoutModules: [
      {
        module: 'headline zone',
        referencePattern: 'Use the viral poster hook structure if clone mode is selected; otherwise use a clear OEM/ODM value proposition.',
        localAssetRole: 'none',
        replacementInstruction: 'Rewrite with verified product category, target buyer pain point, and CTA.',
      },
      {
        module: 'product hero',
        referencePattern: 'Large center product display with premium catalog lighting.',
        localAssetRole: 'product photo',
        replacementInstruction: 'Replace competitor product with selected local product images.',
      },
      {
        module: 'background and proof areas',
        referencePattern: 'Reuse only the generic background mood, module order, and information hierarchy.',
        localAssetRole: 'factory image / certificate image / packaging image / scene image',
        replacementInstruction: 'Match factory, certificate, packaging, and scene assets to the corresponding poster modules.',
      },
    ],
    poster,
    caption: `🌿 Looking to launch your own ${category} brand?\n\n🚀 We support OEM/ODM, private label packaging, product customization, and export-ready supply for overseas buyers.\n\n💎 Comment “CATALOG” or DM us to get product options and sample details.`,
    hashtags: ['OEM', 'ODM', 'PrivateLabel', 'B2B', 'Wholesale', 'FactoryDirect'],
    commentCta: 'Comment “CATALOG” to get the product list and sample details.',
    dmOpening: 'Hi, thanks for your interest. May I know your target market, product type, expected MOQ, and whether you need private label packaging?',
    fieldsToConfirm: ['MOQ', 'certifications', 'lead time', 'price range', 'export countries', 'factory qualifications'],
    imagePrompt: `Create a high-end B2B OEM/ODM social media poster for ${category}. Ratio ${String(input.ratio || '1:1')}. Style ${String(input.posterStyle || 'oem-factory')}. Include the exact poster text from the JSON brief, product hero area, factory proof area, trust badges, process row, product category cards, and bottom CTA bar. Premium catalog quality, clean layout, no unreadable tiny text.`,
  };
}

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
