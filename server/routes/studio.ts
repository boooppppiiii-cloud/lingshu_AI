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
const { composite, exportCapcutPackage } = require('../../desktop/render.cjs') as {
  composite: (manifest: unknown, onProgress?: (pct: number) => void, outDir?: string) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
  exportCapcutPackage: (payload: unknown) => Promise<{ ok: boolean; dir?: string; appOpened?: boolean; draftCreated?: boolean; createDraftError?: string; error?: string }>;
};

function execFileAsync(file: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout }, (err, stdout) => (err ? reject(err) : resolve(String(stdout || ''))));
  });
}

async function findMacAppBySpotlight(names: string[]): Promise<string[]> {
  if (process.platform !== 'darwin') return [];
  const found = new Set<string>();
  for (const name of names) {
    try {
      const stdout = await execFileAsync('mdfind', [`kMDItemKind == "Application" && kMDItemFSName == "${name}.app"`], 4000);
      stdout.split('\n').map(line => line.trim()).filter(Boolean).forEach(item => found.add(item));
    } catch {
      // Spotlight may be disabled or unavailable; app-name and bundle-id attempts still cover common installs.
    }
  }
  return [...found];
}

async function openMacCapcutApp(): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  const openCommand = (args: string[]) => execFileAsync('open', args, 5000).then(() => true).catch(() => false);
  const appNames = ['剪映专业版', '剪映', 'CapCut', 'CapCut Global', 'JianyingPro', 'Jianying'];
  const bundleIds = [
    'com.lemon.lvpro',
    'com.lemon.lvpro-intl',
    'com.lemon.lvoverseas',
    'com.lemon.capcut',
    'com.bytedance.CapCut',
    'com.bytedance.capcut',
  ];

  for (const appName of appNames) {
    if (await openCommand(['-a', appName])) return true;
  }
  for (const bundleId of bundleIds) {
    if (await openCommand(['-b', bundleId])) return true;
  }
  for (const appPath of await findMacAppBySpotlight(appNames)) {
    if (await openCommand([appPath])) return true;
  }
  return false;
}

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
  for (const term of ['CeraVe', 'TikTok', 'Instagram', 'Facebook', 'YouTube']) {
    if (raw.toLowerCase().includes(term.toLowerCase())) terms.add(term);
  }
  return Array.from(terms)
    .map(term => term.replace(/^#/, '').trim())
    .filter(term => term.length >= 3)
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

type ScriptMaterialInfo = {
  name?: string;
  type?: string;
  folder?: string;
  duration?: number;
  role?: string;
  targetStart?: number;
  targetEnd?: number;
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
      role: String(obj.role || ''),
      targetStart: Number.isFinite(Number(obj.targetStart)) ? Number(obj.targetStart) : +(index * slot).toFixed(1),
      targetEnd: Number.isFinite(Number(obj.targetEnd)) ? Number(obj.targetEnd) : +(index === raw.length - 1 ? totalDuration : (index + 1) * slot).toFixed(1),
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
    `建议时间段：${Number(info.targetStart || 0).toFixed(1)}-${Number(info.targetEnd || 0).toFixed(1)}s`,
  ].join('；')).join('\n');
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
    generationMode = '',
    audience = '',
    sellingPoints = '',
    tone = 'high-converting',
    referenceTitle = '',
    referenceAnalysis = '',
    referenceHighlights = [],
    materialInfos = [],
    provider,
  } = req.body ?? {};
  const lang = langName(language);
  const clips = (materials as string[]).join(', ') || '(generic product clips)';
  const normalizedMaterialInfos = normalizeMaterialInfos(materialInfos, materials, Number(duration) || 20);
  const structuredMaterials = materialInfoLines(normalizedMaterialInfos);
  const product = productInfo || '';
  const reference = String(referenceAnalysis || '').slice(0, 2500) || '(no detailed reference analysis provided)';
  const highlights = Array.isArray(referenceHighlights) && referenceHighlights.length
    ? referenceHighlights.slice(0, 8).map((item: unknown) => `- ${String(item).slice(0, 180)}`).join('\n')
    : '- No reliable highlights. Infer a simple product-first structure from title, platform, and product info.';
  const forbiddenTerms = referenceForbiddenTerms({ referenceTitle, materials, referenceHighlights, referenceAnalysis });
  const forbiddenIndustryTerms = referenceIndustryLeakTerms(`${referenceTitle}\n${referenceAnalysis}\n${highlights}`, productInfo);
  const forbiddenLine = forbiddenTerms.length
    ? `Reference-only forbidden terms: ${forbiddenTerms.join(', ')}. Do not output these words, hashtags, brand names, original captions, or original product claims.`
    : 'Do not output reference-video brand names, hashtags, original captions, or original product claims.';
  const providerOpt = provider === 'qwen' || provider === 'gemini' ? provider : undefined;
  const selectedProductBrief = productBrief(productInfo);
  const selectedProductCategory = selectedProductBrief.category || compactBriefCategory(selectedProductBrief);
  const cloneFusionRules = `爆款结构和产品卖点融合流程（必须内化执行，不要把这段流程输出给用户）：
1. 先抽取对标视频的可迁移骨架：开头钩子/人物关系/日常场景/产品出场/使用证明/反差或问题/CTA。
2. 再把产品信息分层映射到骨架：
   - 前 5 秒只放 1 个最强痛点、反差或结果证明。
   - 5-12 秒只放 2-3 个可视化卖点，用动作或测试证明，不复述长资料。
   - MOQ、认证、交期、BSCI、REACH、RoHS、报价等采购信息只能放在最后 CTA 或短字幕里。
3. 生成脚本前，先完成内部映射表：每个分镜只承载一个产品信息点。
4. 生成脚本后，内部自检：是否保留爆款钩子/情绪/人物关系/反转机制；是否产品信息过载；是否像真人口播；是否每段可拍。
5. 如果自检不合格，直接重写最终脚本。最终输出只给成稿，不输出映射表、自检过程或解释。
6. 禁止整段复述产品资料；禁止把“主推品：”“适合展示……”这类原始资料句式直接放进口播。
7. 每个分镜必须承担不同任务：开场钩子、细节证明、对比/测试、定制/包装、采购信息、CTA 不得重复。
8. 相邻分镜不得使用相同环境、相同画面动作、相同台词句式；不能只替换一个卖点词。
9. 最终脚本必须是纯净新脚本：不要输出“基础要求、分析摘要、竞品识别、产品替换、参考爆款、成片目标、指定画风、核心情绪”等分析说明。
10. 行业锁定：模式1选定产品所属类目是「${selectedProductCategory || '未提供'}」。当爬取视频所属行业与该类目不一致时，仍然必须逐段依据“对标视频脚本详析”生成：时间段、环境、景别、运镜、配乐音效、画面动作、色彩质感、卡点节奏优先保持原详析。
11. 行业冲突时，只替换画面里的产品对象、行业对象、产品功效和字幕/台词中的产品词；不要把原详析改写成完全不同的场地、镜头或剧情。
12. 替换示例：原详析“多个粉色饺子造型的护肤美妆纸艺品（眼膜、唇膏、面霜、安瓶）以卡点方式快速弹出画面”，如果我方产品是灯具，应改成“多个粉色饺子造型的灯具产品纸艺品以卡点方式快速弹出画面”，而不是改成展厅、样板间或安装测试。`;

  const productScriptRules = `你是在为我方产品重新创作一条外贸社媒口播视频脚本。

输出必须满足：
1. 每段包含：时间 / 画面 / 人物说 / 字幕。
2. 人物说必须是镜头里真人能直接说出口的话，不得包含“镜头、画面、字幕、参考节奏、展示卖点”等制作指令。
3. 每段画面必须是具体可拍动作，必须包含手部动作、产品动作、对比测试、包装/定制展示或使用场景之一。
4. 第一段必须是痛点、对比、测试或结果 hook，不能用“这款产品适合……”平铺开场。
5. 至少包含两个 B2B 采购信息：MOQ、尺寸、克重、承重、logo 定制、打样、包装、交期、报价。未提供具体值时写“可按需求确认”，不要编具体数字。
6. 结尾 CTA 必须要求买家提供具体采购信息，例如尺寸、数量、logo 文件、目标克重、包装方式或交期。
7. 参考视频只允许借用节奏、镜头顺序和信息密度；不得输出参考视频标题、原 caption、原品牌、原 hashtag、原品类、原场景词或原产品功效。
8. 不得编造未提供的数据；缺失时写“可按需求确认”。禁止新增任何未提供的数字、单位或周期，例如瓶数、重量、容量、天数、秒数、百分比、价格、MOQ 数量。
9. 不得输出制作说明，不得解释规则，只输出成稿。
10. 原始卖点如果包含夸张绝对化表达，必须降级成可验证表述，例如“不易撕裂”“抗拉表现可打样测试”“承重可按需求确认”，不得写“不破、不裂、纹丝不动、吹不烂”等绝对承诺。
11. 只能使用下方“产品信息”里列出的选定产品。不得改成企业中心其它产品，不得写“企业产品组合/主推产品/this product”，不得使用对标视频原产品。
12. 多选产品时，脚本必须围绕这些选定产品组合呈现，至少在画面或字幕中覆盖每个选定产品的名称或明确细节，不得擅自新增未选择产品。
13. ${forbiddenLine}

固定格式：
[0-2s]
画面：<具体可拍动作>
人物说：“<真人口播，只说给买家听的话>”
字幕：<短字幕>

请生成 5 段左右，总时长约 ${duration} 秒，语言为${lang}。`;

  const materialScriptRules = `你是在为“已选素材库片段”编排一条时间戳快剪脚本，不是凭空写产品销售稿。

核心原则：
1. 每个时间戳段必须绑定一个具体素材名，不能只写泛泛产品话术。
2. 只能根据素材元信息做保守推断：素材名、类型、角色、原始时长、建议时间段。没有真实画面识别时，不得编造画面里出现的人、场景、动作或效果。
3. 画面字段必须写“使用素材《素材名》...”并说明剪辑重点，例如截取开头、细节处、动作最清楚处、包装/样品处。
4. 每段承担不同剪辑任务：开场、细节、使用/对比、供应能力、定制/包装、CTA。
5. 口播必须承接该素材的角色，不能每段复用同一句式。
6. 如果素材信息不足，只能写“按该素材可见内容剪辑”，不能伪装已经识别出画面。
7. 必须严格按素材顺序生成 ${Math.max(1, normalizedMaterialInfos.length)} 段左右，时间段优先使用“建议时间段”。
8. 输出只给成稿，不解释规则。

固定格式：
[start-end s]
素材：<素材名>
画面：<基于该素材的剪辑方式，必须提到素材名>
人物说：“<真人能说出口的一句话>”
字幕：<短字幕>`;

  const prompt = generationMode === 'material'
    ? `${materialScriptRules}

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

	产品信息：
	${product || '未选择产品。请拒绝生成具体产品脚本。'}

目标平台：${platform}
目标受众：${audience || '海外 B2B 买家、小批量试单买家、渠道采购商'}
补充卖点：${sellingPoints || '仅使用产品信息中已提供的卖点'}
风格：${tone || '真实、可拍、询盘导向'}
素材信息：${clips}

请直接输出脚本。`
    : scriptType === 'storyboard'
    ? `你是中国跨境电商卖家的资深短视频导演，尤其擅长把“爆款视频脚本详析”和“我方产品对象”融合成可拍脚本。
请生成一条约 ${duration} 秒的 ${platform} 分镜脚本，语言为 ${lang}，分镜数量和时间段必须优先跟随对标视频脚本详析。

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

每个场景必须严格对应“对标视频脚本详析”的同一时间段，不要合并、跳段或擅自重排。使用以下固定格式，不要 markdown 符号，不要缺字段：
[start-end s]
环境：<照抄或贴近原详析环境>
景别：<照抄原详析景别>
运镜：<照抄原详析运镜>
画面：<保留原详析动作、色彩、材质、卡点节奏和构图，只把原产品/行业对象替换成我方产品对象>
配乐：<照抄或贴近原详析配乐音效>
台词：<真人口播，只说给买家听的话；必须是一个具体采购痛点、需求洞察、证明点或 CTA>
字幕：<短字幕>

硬性规则：
- 逐段复刻对标视频脚本详析：时间段、环境、景别、运镜、配乐、画面动作、色彩质感和卡点节奏必须尽量与原详析一致。
- 如果爬取视频行业和模式1产品所属行业不一致，只替换原产品/原行业对象为模式1选定产品；不要改变原详析的场地、构图、镜头节奏和创意动作。
- 不得出现对标视频原行业、原品类、原产品功效；但可以保留无行业冲突的环境、色彩、造型、动作、音效和节奏描述。
- 前 5 秒必须像真实社媒爆款 hook：指出具体买家踩坑/采购风险/场景反差，例如“订购一大批吸顶灯，结果灯光实际效果和图文严重不符？我们拒绝照骗，所见即所得！”。不能平铺“这款产品适合...”或“采购这类产品先看效果”。
- 前 12 秒禁止出现 MOQ、认证、BSCI、REACH、RoHS、交期、报价等采购参数；这些只能放最后 CTA 或短字幕。
- 每段只表达一个信息点；口播每句尽量短，像真人现场说话。
- 台词必须像人话，不能把专业名词、认证名、型号、参数连成清单朗读。CE/RoHS/UKCA/ETL/IES/LDT/IP65/MOQ/OEM/ODM 这类词最多一条台词出现 1 个；超过 1 个时改写成“资料能不能一次给齐”“现场效果能不能对得上”“样品和大货会不会一致”。
- 专业名词清单只能放在“字幕”或最后 CTA 的画面资料里，不要放进“台词”。
- 台词句与句之间要有因果承接：先说买家担心什么，再说镜头正在证明什么，最后说下一步怎么确认。
- 每段的环境、景别、运镜、画面、配乐、台词必须明显不同：不得连续复用同一个骨架，不得只替换数字或卖点词。
- 按顺序分配不同剧情功能：1 钩子，2 细节证明，3 使用或测试，4 定制/包装，5 采购信任或 CTA。
- 画面不能写“真实使用场景”“痛点特写”这种空泛词，必须写清楚人物在什么环境里做什么动作，镜头拍到什么具体物件或结果。
- 台词必须来自客户需求洞察：效果不符、参数不透明、样品和大货不一致、认证资料缺失、安装/包装/市场适配不确定、低价供应商翻车等。结合产品信息选择最相关痛点。
- 不要写 generic phrases like "premium quality", "high conversion", "boost sales", "worth buying"，除非绑定具体产品细节。
- 不得复制或提及对标视频标题、原 caption、hashtag、品牌名、原品类、原产品功效。
- 不得输出分析摘要、基础要求、竞品识别、产品替换说明、成片目标或任何“对标视频”说明，只输出新的可拍分镜。
- 每个场景必须小商家用手机也能拍出来。
- 缺少数据时，写保守的样品/报价/按需求确认 CTA，不要编造。
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
    const text = await callLLM(prompt, { backend: providerOpt, systemPrompt: enterpriseCtx() || undefined });
    const script = enforceProductNameInScript(stripScriptAnalysisSummary(text), productInfo);
    const selectedNames = selectedProductNames(productInfo);
    const unsupportedNumberClaims = Array.from(script.matchAll(/\d+(?:\.\d+)?\s*(?:瓶|ml|ML|毫升|kg|KG|g|克|斤|cm|厘米|mm|毫米|天|day|days|Days|秒|%|个|pcs|件|箱|元|美元)/g))
      .map(match => match[0])
      .filter(claim => !String(productInfo).includes(claim));
    const missingProduct = !String(productInfo || '').trim();
    const missingSelectedProduct = selectedNames.length > 0
      && selectedNames.some(name => !script.toLowerCase().includes(name.toLowerCase()));
    const incompleteCloneStoryboard = generationMode === 'clone'
      && (!/环境[：:]/.test(script)
        || !/景别[：:]/.test(script)
        || !/运镜[：:]/.test(script)
        || !/配乐[：:]/.test(script)
        || !/台词[：:]/.test(script));
    const genericCloneStoryboard = generationMode === 'clone'
      && /真实使用场景|痛点特写|买家最关心的结果|采购这类|先看真实使用效果|把「[^」]+」放到真实使用场景/.test(script);
    const unsafeScript = missingProduct
      || missingSelectedProduct
      || /参考节奏|Reference video|对标视频|基础要求|分析摘要|竞品识别|产品替换|参考爆款|成片目标|指定画风|核心情绪|行业锁定|结构迁移|不迁移行业|不继承原视频|企业产品组合|主推产品|<具体|不得|必须满足/.test(script)
      || /不破|不裂|纹丝不动|吹不烂|保证|最快|最低价|全网|no tear|won'?t tear|never breaks?|unbreakable/i.test(script)
      || unsupportedNumberClaims.length > 0
      || incompleteCloneStoryboard
      || genericCloneStoryboard
      || hasRepetitiveStoryboard(script)
      || hasUnnaturalVoiceover(script);
    const invalidProductScript = generationMode === 'product'
      && (/人物说[：:][^\n]*(镜头|画面|字幕|参考节奏|展示卖点|制作)/.test(script)
        || /Scene N/.test(script));
    const leakedReference = forbiddenTerms.some(term => new RegExp(`(^|[^A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9])`, 'i').test(script))
      || forbiddenIndustryTerms.some(term => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(script))
      || /#[A-Za-z][A-Za-z0-9_-]{2,}/.test(script);
    const shouldFallback = invalidProductScript || unsafeScript || leakedReference;
    const fallback = generationMode === 'material'
      ? fallbackMaterialStoryboard(normalizedMaterialInfos, Number(duration) || 20, productInfo)
      : fallbackStoryboard(duration, productInfo);
    res.json({
      ok: true,
      source: shouldFallback ? 'fallback' : 'ai',
      script: shouldFallback ? fallback : script,
    });
  } catch {
    res.json({
      ok: true,
      source: 'fallback',
      script: generationMode === 'material'
        ? fallbackMaterialStoryboard(normalizedMaterialInfos, Number(duration) || 20, productInfo)
        : scriptType === 'storyboard' ? fallbackStoryboard(duration, productInfo) : fallbackScript(productInfo, duration),
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
    ? 'Use the reference poster only for structure: headline pattern, module order, visual style, CTA, and caption framework. Do not copy false claims.'
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
- Poster text should be concise enough for a dense B2B OEM poster.
- Use exact English text for poster fields when language is English.
- Return ONLY valid JSON. No markdown.

Schema:
{
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
  "imagePrompt": "detailed prompt for a no-extra-text B2B OEM poster image model; include all poster text exactly as above; mention style, sections, product references, and layout"
}`;

  try {
    const text = await callLLM(prompt, { backend: providerOpt, systemPrompt: enterpriseCtx() || undefined });
    const obj = extractJSON<any>(text);
    if (obj?.poster?.headline && obj?.caption) {
      res.json({
        ok: true,
        source: 'ai',
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
    throw new Error('parse');
  } catch {
    res.json({ ok: true, source: 'fallback', ...fallbackPosterBrief({ productInfo, platform, ratio, posterStyle, language }) });
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
  const { text = '', targets = [] } = req.body ?? {};
  const src = String(text).trim();
  const targetCodes = Array.isArray(targets)
    ? targets.map(item => String(item || '').trim()).filter(Boolean).filter(code => code !== 'zh').slice(0, 8)
    : [];
  if (!src) { res.json({ ok: true, source: 'noop', translations: {} }); return; }
  if (targetCodes.length === 0) { res.json({ ok: true, source: 'noop', translations: {} }); return; }

  const prompt = `You are a native short-video voiceover localization editor for cross-border B2B commerce.

Task:
Translate and lightly localize these timestamped Chinese spoken lines into natural, human-sounding target-language voiceover. This is NOT literal translation. Make it sound like a real person speaking in a short product video.

Target languages:
${targetCodes.map(code => `- ${code}: ${langName(code)}`).join('\n')}

Rules:
- Return ONLY valid JSON.
- JSON shape: {"en":"[0-3s] translated line\\n[3-8s] translated line","es":"..."}.
- Preserve every timestamp label exactly, such as [0-3s].
- Translate only the spoken text after each timestamp.
- Keep one output line per input line for every language.
- Omit short sound-effect lines or onomatopoeia such as “噗噗/砰砰/咚咚/咯吱”; they are audio SFX, not voiceover subtitles.
- Do not leave Chinese text in non-Chinese outputs.
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
    if (code !== 'zh' && /[\u4e00-\u9fff]/.test(textValue)) return true;
    if (/translation unavailable|无法翻译|不能翻译|作为AI|Here is|```/i.test(textValue)) return true;
    return false;
  };

  const run = async (backend: 'qwen' | 'gemini') => {
    const out = await callLLM(prompt, { backend, model: backend === 'qwen' ? 'qwen-plus' : undefined });
    const parsed = extractJSON<Record<string, unknown>>(out) ?? {};
    const translations: Record<string, string> = {};
    for (const code of targetCodes) {
      const value = String(parsed[code] ?? '').trim();
      if (!invalid(value, code)) translations[code] = value;
    }
    return translations;
  };

  const runSingle = async (backend: 'qwen' | 'gemini', code: string) => {
    const singlePrompt = `You are a native short-video voiceover localization editor for cross-border B2B commerce.

Translate and lightly localize the timestamped Chinese spoken lines into ${langName(code)}.
Preserve every timestamp label exactly. Translate only spoken text after each timestamp.
Keep one output line per input line. Do not leave Chinese text. Use natural conversational wording.
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
  timeline?: {
    name: string;
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
  const urlByName = new Map(loadMaterials().map(m => [m.name, m.url]));
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
      return { index, ...item, url: rel ? `${base}${rel}` : null }; // 库里有真实文件→真实 URL，否则 null（mock 占位素材）
    }),
    voiceover: { voice: spec.voice ?? null, url: absoluteAssetUrl(base, spec.voiceoverUrl) },
    cover: { id: spec.coverId ?? null, title: spec.coverTitle ?? '', url: absoluteAssetUrl(base, spec.coverUrl) },
    bgm: (() => {
      const track = spec.bgm ? withRecommendedBgmNames(userBgms()).find(t => t.id === spec.bgm) : null;
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
    const result = await composite(req.body);
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
	    : `<rect width="${w}" height="${h}" fill="#111827"/>`;

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
	    const dataUri = inlineFrame(bgImageUrl);
      if (!dataUri) {
        res.status(400).json({ ok: false, error: 'cover_frame_required' });
        return;
      }
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
const VOICE_SAMPLES_DIR = path.join(__dirname, '../../data/voice-samples');
const MINIMAX_VOICE_CACHE_FILE = path.join(VOICE_SAMPLES_DIR, 'minimax-voice-cache.json');

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

function readMinimaxVoiceCache(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(MINIMAX_VOICE_CACHE_FILE, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeMinimaxVoiceCache(cache: Record<string, string>) {
  try {
    fs.mkdirSync(VOICE_SAMPLES_DIR, { recursive: true });
    fs.writeFileSync(MINIMAX_VOICE_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    // Cache is only an optimization. If it cannot be written, synthesis can still proceed.
  }
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
    const files = fs.readdirSync(VOICE_SAMPLES_DIR);
    const found = files.find(file => file.startsWith(`${id}.`));
    return found ? path.join(VOICE_SAMPLES_DIR, found) : null;
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
  try { fs.mkdirSync(TTS_DIR, { recursive: true }); } catch { /* ignore */ }
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
  fs.writeFileSync(path.join(TTS_DIR, file), wavFromPcm(pcm, sampleRate));
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

async function generateMinimaxTts(text: string, voiceId: string, language: string): Promise<{ url: string; duration: number; source: string } | null> {
  const apiKey = process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '';
  if (!apiKey) return null;
  try { fs.mkdirSync(TTS_DIR, { recursive: true }); } catch { /* ignore */ }
  const format = (process.env.MINIMAX_TTS_FORMAT || 'mp3').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp3';
  const outputFormat = (process.env.MINIMAX_TTS_OUTPUT_FORMAT || 'hex').toLowerCase();
  const sampleRate = Math.min(44100, Math.max(16000, Number(process.env.MINIMAX_TTS_SAMPLE_RATE || 32000) || 32000));
  const bitrate = Math.min(256000, Math.max(32000, Number(process.env.MINIMAX_TTS_BITRATE || 128000) || 128000));
  const speed = Math.min(2, Math.max(0.5, Number(process.env.MINIMAX_TTS_SPEED || 1) || 1));
  const volume = Math.min(10, Math.max(0.1, Number(process.env.MINIMAX_TTS_VOLUME || 1) || 1));
  const pitch = Math.min(12, Math.max(-12, Number(process.env.MINIMAX_TTS_PITCH || 0) || 0));
  const emotion = String(process.env.MINIMAX_TTS_EMOTION || 'happy').trim();
  const model = process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd';
  const payload: Record<string, unknown> = {
    model,
    text: text.slice(0, 5000),
    stream: false,
    language_boost: minimaxLanguageBoost(language),
    output_format: outputFormat,
    voice_setting: {
      voice_id: voiceId,
      speed,
      vol: volume,
      pitch,
      ...(emotion ? { emotion } : {}),
    },
    audio_setting: {
      sample_rate: sampleRate,
      bitrate,
      format,
      channel: 1,
    },
  };
  const json = await minimaxFetchJson('/v1/t2a_v2', payload, Number(process.env.MINIMAX_TTS_TIMEOUT_MS || 90_000));
  const audio = String(json?.data?.audio || '');
  const remoteUrl = outputFormat === 'url' && /^https?:\/\//i.test(audio) ? audio : '';
  const duration = Math.max(1, Math.round(Number(json?.extra_info?.audio_length || 0) / 1000) || durationFromText(text));
  if (remoteUrl) return { url: remoteUrl, duration, source: 'minimax' };

  const buf = bufferFromMinimaxAudio(audio, outputFormat);
  if (!buf?.length) throw new Error('MiniMax did not return audio data');
  const file = `${randomUUID()}.${format}`;
  fs.writeFileSync(path.join(TTS_DIR, file), buf);
  return { url: `/tts/${file}`, duration, source: 'minimax' };
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

async function ensureMinimaxClonedVoice(voice: string, language: string): Promise<string | null> {
  const apiKey = process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '';
  if (!apiKey) return null;
  const samplePath = voiceSamplePathFromId(voice);
  if (!samplePath) return null;
  const cacheKey = `${voice}:${fs.statSync(samplePath).mtimeMs}:${fs.statSync(samplePath).size}`;
  const cache = readMinimaxVoiceCache();
  if (cache[cacheKey]) return cache[cacheKey];

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
  cache[cacheKey] = voiceId;
  writeMinimaxVoiceCache(cache);
  return voiceId;
}

async function generatePiperTts(text: string, language: string): Promise<{ url: string; duration: number; source: string } | null> {
  const piperBin = process.env.PIPER_BIN || process.env.PIPER_PATH || '';
  const modelPath = piperModelForLanguage(language);
  if (!piperBin || !modelPath) return null;
  try { fs.mkdirSync(TTS_DIR, { recursive: true }); } catch { /* ignore */ }
  const file = `${randomUUID()}.wav`;
  const outPath = path.join(TTS_DIR, file);
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
  return ok ? { url: `/tts/${file}`, duration: durationFromText(text), source: 'piper' } : null;
}

async function generateXttsCloneTts(text: string, voice: string, language: string): Promise<{ url: string; duration: number; source: string } | null> {
  const samplePath = voiceSamplePathFromId(voice);
  const xttsBin = process.env.XTTS_BIN || process.env.COQUI_TTS_BIN || '';
  if (!samplePath || !xttsBin) return null;
  try { fs.mkdirSync(TTS_DIR, { recursive: true }); } catch { /* ignore */ }
  const file = `${randomUUID()}.wav`;
  const outPath = path.join(TTS_DIR, file);
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
  return ok ? { url: `/tts/${file}`, duration: durationFromText(text), source: 'xtts_clone' } : null;
}

async function generateLocalSayTts(text: string, voice: string, language: string): Promise<{ url: string; duration: number; source: string } | null> {
  if (process.platform !== 'darwin') return null;
  try { fs.mkdirSync(TTS_DIR, { recursive: true }); } catch { /* ignore */ }
  const base = randomUUID();
  const aiffFile = `${base}.aiff`;
  const wavFile = `${base}.wav`;
  const aiffPath = path.join(TTS_DIR, aiffFile);
  const wavPath = path.join(TTS_DIR, wavFile);
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
    return { url: `/tts/${wavFile}`, duration: durationFromText(text), source: 'local_say' };
  }
  return { url: `/tts/${aiffFile}`, duration: durationFromText(text), source: 'local_say' };
}

async function generateTtsAudio(spoken: string, voice: string, language = 'zh'): Promise<{ ok: boolean; source: string; url?: string; duration?: number; error?: string }> {
  if (String(voice || '').startsWith('custom:')) {
    let minimaxError = '';
    try {
      const minimaxVoiceId = await ensureMinimaxClonedVoice(voice, language);
      if (minimaxVoiceId) {
        const minimax = await generateMinimaxTts(spoken, minimaxVoiceId, language);
        if (minimax) return { ok: true, ...minimax };
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
    const minimax = await generateMinimaxTts(spoken, minimaxVoiceId, language);
    if (minimax) return { ok: true, ...minimax };
  } catch (e: any) {
    aiError = `MiniMax: ${String(e?.message ?? e).slice(0, 200)}`;
  }

  if (apiKey) {
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
      return { ok: true, source: 'ai', url: `/tts/${file}`, duration: Math.round(pcm.length / (sampleRate * 2)) };
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
  return { ok: true, source: 'local_tone', url: `/tts/${tone.file}`, duration: tone.duration, error: aiError || 'local speech unavailable' };
}

// POST /studio/tts  Body: { script?, text?, voice?, language? } → { ok, url, duration }
studioRouter.post('/tts', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { script = '', text = '', voice = 'v1', language = 'zh' } = req.body ?? {};
  const spoken = (text || spokenText(script)).trim();
  if (!spoken) { res.status(400).json({ ok: false, error: 'no spoken text' }); return; }

  try {
    res.json(await generateTtsAudio(spoken, voice, language));
  } catch (e: any) {
    res.json({ ok: false, source: 'fallback', error: String(e?.message ?? e).slice(0, 200) });
  }
});

// POST /studio/tts/batch  Body: { voice?, items: [{ code, text }] } → 批量生成，多语种只扣一次生成额度
studioRouter.post('/tts/batch', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { voice = 'v1', items = [] } = req.body ?? {};
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
    audios[code] = await generateTtsAudio(spoken.slice(0, 1500), voice, language);
  }
  res.json({ ok: Object.values(audios).some(item => item.ok && item.url), audios });
});

// POST /studio/voice-samples Body: { name, dataBase64, mimeType?, duration? } → 录入真人音色样本
studioRouter.post('/voice-samples', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { name = 'voice-sample.wav', dataBase64, mimeType, duration = 0 } = req.body ?? {};
  if (!dataBase64) { res.status(400).json({ ok: false, error: 'dataBase64 required' }); return; }
  try {
    fs.mkdirSync(VOICE_SAMPLES_DIR, { recursive: true });
    const match = String(dataBase64).match(/^data:([^;]+);base64,(.+)$/);
    const b64 = match ? match[2] : String(dataBase64);
    const type = String(mimeType || match?.[1] || '').toLowerCase();
    const ext = type.includes('mpeg') || type.includes('mp3') ? 'mp3'
      : type.includes('m4a') || type.includes('mp4') ? 'm4a'
      : type.includes('ogg') ? 'ogg'
      : type.includes('webm') ? 'webm'
      : 'wav';
    const id = randomUUID();
    const file = `${id}.${ext}`;
    fs.writeFileSync(path.join(VOICE_SAMPLES_DIR, file), Buffer.from(b64, 'base64'));
    res.json({
      ok: true,
      id,
      voiceId: `custom:${id}`,
      name: String(name || '真人音色').replace(/\.[^.]+$/, ''),
      url: `/voice-samples/${file}`,
      duration: Number(duration) || 0,
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e).slice(0, 300) });
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

/* ── ④ BGM 曲库（本地磁盘，仅保留用户上传音乐）───────────────────────────────
   渲染时 buildManifest 把选中 BGM 映射成真实 URL。
─────────────────────────────────────────────────────────────────────────── */

const BGM_DIR = path.join(__dirname, '../../data/bgm');
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
  createdAt: string;
}

function loadBgm(): BgmTrack[] {
  try { return JSON.parse(fs.readFileSync(BGM_FILE, 'utf8')) as BgmTrack[]; } catch { return []; }
}
function persistBgm(list: BgmTrack[]): void {
  try { fs.mkdirSync(path.dirname(BGM_FILE), { recursive: true }); } catch { /* ignore */ }
  fs.writeFileSync(BGM_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function userBgms(): BgmTrack[] {
  return loadBgm().filter(track => !track.builtin);
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
  }));
}

// GET /studio/bgm → BgmTrack[]（仅用户上传音乐）
studioRouter.get('/bgm', (_req, res) => {
  res.json(withRecommendedBgmNames(userBgms()));
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
  const list = userBgms();
  const track: BgmTrack = {
    id,
    name: `灵枢推荐配乐${String(list.length + 1).padStart(2, '0')}`,
    mood,
    duration: Number(duration) || 0,
    file,
    url: `/bgm/${file}`,
    createdAt: new Date().toISOString(),
  };
  list.push(track);
  persistBgm(list);
  res.status(201).json({ ok: true, track });
});

// DELETE /studio/bgm/:id
studioRouter.delete('/bgm/:id', (req, res) => {
  const list = userBgms();
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

// POST /studio/capcut/open → 网页端兜底：导出剪映手动精修包，并打开文件夹
studioRouter.post('/capcut/open', async (req, res) => {
  try {
    const pkg = await exportCapcutPackage(req.body);
    if (!pkg.ok || !pkg.dir) {
      res.status(500).json({ ok: false, error: pkg.error || '剪映精修包导出失败' });
      return;
    }

    let folderOpened = false;
    const errors: string[] = [];
    const openCommand = (args: string[]) => execFileAsync('open', args, 5000);

    try {
      await openCommand([pkg.dir]);
      folderOpened = true;
    } catch (err: any) {
      errors.push(`打开精修包失败：${err?.message || err}`);
    }

    res.json({
      ok: folderOpened,
      dir: pkg.dir,
      appOpened: !!pkg.appOpened,
      draftCreated: !!pkg.draftCreated,
      folderOpened,
      error: pkg.createDraftError || (folderOpened ? undefined : '已导出剪映精修包，但未能自动打开文件夹；请手动打开该目录后导入 assets 文件夹素材。'),
      details: errors,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || '剪映精修包导出失败' });
  }
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
  const pointList = [
    ...highlights.split(/[、,，;；\n]/).map(item => item.trim()).filter(Boolean),
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
    naturalTrustPoint: cert && cert !== '可按需求确认' ? '认证和检测资料能不能一次给齐' : '样品和资料能不能按需求确认',
  };
}

function compactBriefCategory(p: ReturnType<typeof productBrief>): string {
  const items = String(p.category || '').split(/[、,，/]/).map(item => item.trim()).filter(Boolean);
  if (p.name && items.some(item => p.name.includes(item) || item.includes(p.name))) return p.name;
  return items[0] || p.name || '产品';
}

function buyerPainForBrief(p: ReturnType<typeof productBrief>): string {
  const text = `${p.name} ${p.category} ${p.highlights}`.toLowerCase();
  if (/灯|照明|light|lighting|轨道|筒灯|线性|庭院|调光/.test(text)) {
    return '订购一大批灯具，结果现场亮度、色温和图文效果严重不符';
  }
  if (/包装|袋|盒|纸|paper|bag|box|package/.test(text)) {
    return '下单后才发现包装材质、尺寸和印刷效果跟样图不一样';
  }
  if (/美妆|护肤|cream|serum|cosmetic|skincare/.test(text)) {
    return '选品时只看图片，结果质地、包装和市场卖点都对不上';
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
  const category = compactBriefCategory(p);
  const pain = buyerPainForBrief(p);
  const lastStart = Math.max(17, Number(duration) - 3);
  return `[0-5s]
环境：${sceneEnvironmentForBrief(p, 0)}；
景别：中景；
运镜：固定镜头直拍；
画面：人物站在样板间或展示台旁，先指向实际点亮/使用效果，再转头对镜头自然发问。
配乐：口播 + 舒缓递进，开头保留半秒停顿制造问题感；
台词：${pain}？我们拒绝照骗，所见即所得！
字幕：拒绝照骗，所见即所得

[5-9s]
环境：${sceneEnvironmentForBrief(p, 1)}；
景别：近景；
运镜：缓慢推进到产品细节；
画面：手部把「${p.name}」移到镜头前，切到${p.firstPoint}对应的可见细节或实际效果。
配乐：口播 + 轻节奏鼓点，细节出现时轻微加强；
台词：客户真正要确认的不是宣传图，是${p.firstPoint}能不能在现场看得出来。
字幕：${p.firstPoint}

[9-13s]
环境：${sceneEnvironmentForBrief(p, 2)}；
景别：特写；
运镜：俯拍固定，动作完成后停留 1 秒；
画面：把普通款/图片参数和「${p.name}」实物放在一起，做一次开合、点亮、安装、按压或效果对比。
配乐：口播 + 短促转场音，对比瞬间降低背景音；
台词：不确定大货会不会翻车？先用这个动作打样测试，再谈批量订单。
字幕：先打样，再批量

[13-${lastStart}s]
环境：${sceneEnvironmentForBrief(p, 3)}；
景别：中近景；
运镜：横向平移扫过选项；
画面：把不同规格、色温/颜色、外壳、包装标签或 logo 位置排开，手指逐一指出可定制项。
配乐：口播 + 稳定节奏，配合手指移动做轻快切点；
台词：你的市场需要什么规格、包装和标签，不用照搬库存款，可以按项目需求确认。
字幕：规格 / 包装 / LOGO

[${lastStart}-${duration}s]
环境：${sceneEnvironmentForBrief(p, 4)}；
景别：中景；
运镜：固定镜头，最后轻推到资料页或询盘窗口；
画面：展示样品、资料页或包装箱，屏幕短字幕放 MOQ、认证、报价和打样信息，最后停在询盘动作。
配乐：口播 + 收束感配乐，结尾留出 CTA 停顿；
台词：最后确认一下${p.naturalTrustPoint}。把数量、目标市场和包装要求发我，我给你整理报价和打样方案。
字幕：${p.moq !== '可按需求确认' ? `MOQ ${p.moq}` : category} / ${p.cert !== '可按需求确认' ? '认证资料可确认' : '参数可确认'}`;
}

function fallbackMaterialStoryboard(infos: ScriptMaterialInfo[], duration: number, productInfo = ''): string {
  const p = compactProductLabel(productInfo);
  const usable = infos.length ? infos.slice(0, 8) : [{
    name: '待上传素材',
    type: 'video',
    folder: 'upload',
    duration,
    role: '素材片段',
    targetStart: 0,
    targetEnd: duration,
  }];
  const tasks = ['开场钩子', '细节证明', '使用/对比', '供应能力', '定制/包装', '询盘 CTA'];
  return usable.map((info, index) => {
    const start = Number.isFinite(Number(info.targetStart)) ? Number(info.targetStart) : +(index * duration / usable.length).toFixed(1);
    const end = Number.isFinite(Number(info.targetEnd)) ? Number(info.targetEnd) : +(index === usable.length - 1 ? duration : (index + 1) * duration / usable.length).toFixed(1);
    const role = materialRoleFromFolder(info);
    const task = tasks[Math.min(index, tasks.length - 1)] || '素材承接';
    const voice = index === 0
      ? `先看这段素材里最适合做开场的真实内容。`
      : index === usable.length - 1
        ? `把你的数量、规格和包装要求发我，我给你整理方案。`
        : `这一段用来承接${p}的${role}，按可见细节来剪。`;
    return `[${start}-${Math.max(start + 0.5, end)}s]
素材：${info.name}
画面：使用素材《${info.name}》作为${task}，按该素材可见内容剪辑，优先截取信息最清楚、动作最完整或产品最明显的位置。
人物说：“${voice}”
字幕：${task}`;
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
