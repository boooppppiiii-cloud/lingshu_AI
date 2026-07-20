/* 混剪工作台 AI 接口封装 */
import { authHeader } from './auth';

async function post<T>(path: string, body: unknown, fallback: T): Promise<T & { source?: string }> {
  try {
    const r = await fetch(`/api/overseas/studio/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    });
    if (r.status === 402 || r.status === 429) {
      const j = await r.json().catch(() => ({}));
      throw new Error(formatDemoQuotaError(j));
    }
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as T & { source?: string };
  } catch (err: any) {
    const message = String(err?.message || '');
    if (message.includes('Demo') || message.includes('试用') || message.includes('额度') || message.includes('到期')) throw err;
    return { ...fallback, source: 'local', error: message || 'request_failed' };
  }
}

function formatDemoQuotaError(j: any): string {
  if (j?.error === 'demo_expired') return '试用已到期，请联系服务顾问开通或延长试用。';
  if (j?.error === 'demo_token_quota_exceeded') return '今日 Token 额度已用完，请明天再试或联系服务顾问开通更多额度。';
  if (j?.quota === 'generation') return '今日普通生成额度已用完，脚本/封面/配音等 AI 生成请明天再试或联系服务顾问开通更多额度。';
  if (j?.quota === 'render') return '今日成片预览额度已用完，请明天再试或联系服务顾问开通更多额度。';
  if (j?.quota === 'videoGeneration') return '今日视频生成额度已用完，请明天再试或联系服务顾问开通更多额度。';
  return '今日试用额度已用完，请明天再试或联系服务顾问开通更多额度。';
}

async function get<T>(path: string, fallback: T): Promise<T & { source?: string }> {
  try {
    const r = await fetch(`/api/overseas/studio/${path}`, { headers: authHeader() });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as T & { source?: string };
  } catch {
    return { ...fallback, source: 'local' };
  }
}

async function postSeedanceVideo(body: unknown): Promise<SeedanceVideoResult> {
  try {
    const r = await fetch('/api/overseas/studio/seedance-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    });
    if (r.status === 402 || r.status === 429) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error === 'demo_expired' ? '试用已到期，请联系服务顾问开通或延长试用。' : '今日试用额度已用完，请明天再试或联系服务顾问开通更多额度。');
    }
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as SeedanceVideoResult;
  } catch (err: any) {
    if (String(err?.message || '').includes('Demo')) throw err;
    return { ok: false, source: 'seedance', error: String(err?.message || err || 'Seedance video request failed') };
  }
}

export interface SelectInput { materials: { id: string; name: string; type: string; duration: number }[]; duration: number }

// 字幕 cue：start/end 为相对成片起点的秒数；zh 为可选中文译文（双语字幕）
export interface SubCue { start: number; end: number; text: string; zh?: string; words?: Array<{ text: string; start: number; end: number }> }
export interface TtsStyleOptions {
  preset: 'tiktok_excited' | 'authentic_review' | 'professional_b2b' | 'warm_story' | 'urgent_cta';
  emotion: string;
  emotionIntensity: number;
  speed: number;
  targetDuration: number;
  pauseStyle: 'few' | 'natural' | 'dramatic';
  pronunciations: Array<{ word: string; pronunciation: string }>;
}
export interface TtsAudioResult {
  ok: boolean;
  source?: string;
  url?: string;
  duration?: number;
  error?: string;
  text?: string;
  adjusted?: boolean;
  targetDuration?: number;
  cues?: SubCue[];
  alignmentSource?: 'audio_ai' | 'proportional' | 'minimax_native';
  customVoiceStatus?: 'activated';
}
export interface StudioAudioCapabilities {
  ok: boolean;
  customVoice: {
    upload: boolean;
    synthesis: boolean;
    engines: { minimax: boolean; xtts: boolean };
    message: string;
  };
  minimax?: {
    configured: boolean;
    baseUrl: string;
    model: string;
    diagnosticAvailable: boolean;
  };
  subtitles: {
    automatic: boolean;
    audioTranscription: boolean;
    wordAlignment: boolean;
    fallback: 'proportional';
  };
}
export interface SubtitleSpec {
  mode: 'off' | 'target' | 'bilingual';
  cues: SubCue[];
  style: Partial<CoverStyle>;     // 沿用封面样式体系（字体 / 颜色 / 粗细）
}

export interface RenderSpec {
  materials: string[];
  timeline?: {
    name: string;
    trimStart?: number;
    trimEnd?: number;
    speed?: number;
    targetStart?: number;
    targetEnd?: number;
    targetDuration?: number;
  }[];
  script: string;
  voice: string;
  bgm: string;
  bgmVol: number;
  voiceVol: number;
  coverId: string;
  coverTitle: string;
  ratio: string;
  duration: number;
  platform: string;
  language: string;
  voiceoverUrl?: string;
  coverUrl?: string;
  subtitles?: SubtitleSpec;       // 字幕轨（桌面端 ffmpeg 烧录）
}

export interface RenderManifest {
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

export interface RenderAuthorization {
  token: string | null;        // 短期签名令牌；离线兜底为 null
  expiresAt: string | null;
  manifest: RenderManifest;
}

/* 桌面客户端（Electron）注入的本机 ffmpeg 合成桥；纯网页里为 undefined */
export interface DesktopRenderBridge {
  available: boolean;
  render: (manifest: RenderManifest) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
  openInCapcut?: (payload: Record<string, unknown>) => Promise<{ ok: boolean; dir?: string; appOpened?: boolean; draftCreated?: boolean; createDraftError?: string; error?: string }>;
  showItemInFolder?: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  onProgress: (cb: (pct: number) => void) => () => void; // 返回取消订阅函数
}

declare global {
  interface Window { desktopRender?: DesktopRenderBridge }
}

/** 取桌面端本机合成桥（仅 Electron 客户端有） */
export function getDesktopRender(): DesktopRenderBridge | undefined {
  return typeof window !== 'undefined' ? window.desktopRender : undefined;
}

/** 离线 / 未授权时的本地兜底 manifest，桥接服务端 buildManifest 的结构 */
function localManifest(spec: RenderSpec): RenderManifest {
  return {
    jobId: `local-${Date.now()}`,
    spec: {
      ratio: spec.ratio || '9:16',
      duration: spec.duration ?? 20,
      platform: spec.platform || 'tiktok',
      language: spec.language || 'en',
      bgmVol: spec.bgmVol ?? 35,
      voiceVol: spec.voiceVol ?? 100,
    },
    script: spec.script ?? '',
    timeline: (spec.timeline?.length ? spec.timeline : (spec.materials ?? []).map(name => ({ name })))
      .map((item, index) => ({ index, ...item, url: null })),
    voiceover: { voice: spec.voice ?? null, url: null },
    cover: { id: spec.coverId ?? null, title: spec.coverTitle ?? '', url: null },
    bgm: { id: spec.bgm ?? null, url: null },
    subtitles: spec.subtitles,
  };
}

export interface StudioProject {
  id: string;
  title: string;
  status: 'draft' | 'published' | 'template';
  spec: Record<string, unknown>;
  thumbSeed?: string;
  createdAt: string;
  updatedAt: string;
}
export interface VariationBatch {
  id: string;
  title: string;
  status: 'queued' | 'running' | 'review' | 'completed' | 'paused';
  estimatedCostCny: number;
  plan?: {
    platform?: string; ratio?: string; contentMode?: string; mode?: string; strategy?: string;
    duration?: number; maxItems?: number; dimensions?: Record<string, string[]>;
    productInfo?: string; productSelectMode?: string; selectedProductIds?: string[];
    audience?: string; sellingPoints?: string; tone?: string; language?: string; provider?: string;
  };
  items: { id: string; variables: Record<string, string>; status: string; qualityScore?: number; note?: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface SeedanceVideoResult {
  ok: boolean;
  source?: string;
  id?: string;
  taskId?: string;
  title?: string;
  url?: string;
  poster?: string;
  duration?: number;
  model?: string;
  material?: Material;
  error?: string;
  createdAt?: string;
}

export interface StoryboardQualityResult {
  score: number;
  passed: boolean;
  issues: string[];
  strengths: string[];
  recommendation: string;
  checks: Record<string, number>;
  checkedAt: string;
}

export interface FbPosterBrief {
  headline: string;
  subheadline: string;
  originBadge: string;
  trustBadges: string[];
  sellingPoints: string[];
  process: string[];
  categories: { name: string; description: string }[];
  bottomBar: string[];
  cta: string;
}

export interface FbPosterResult {
  ok: boolean;
  source?: 'ai' | 'fallback' | 'local';
  layoutModules?: {
    module: string;
    referencePattern: string;
    localAssetRole: string;
    replacementInstruction: string;
  }[];
  poster: FbPosterBrief;
  caption: string;
  hashtags: string[];
  commentCta: string;
  dmOpening: string;
  fieldsToConfirm: string[];
  imagePrompt: string;
  error?: string;
}

export interface FbPosterRenderResult {
  ok: boolean;
  source?: 'gemini' | 'seedream' | 'local';
  model?: string;
  url?: string;
  material?: Material;
  references?: number;
  error?: string;
}

function productCategoryFromInfo(productInfo?: string): string {
  const text = String(productInfo || '');
  const match = text.match(/(?:产品类目|所属类目|产品名称|主推产品|category|product)[：:]\s*([^\n]+)/i);
  return String(match?.[1] || 'Private Label Product').trim().slice(0, 60) || 'Private Label Product';
}

function localPosterFallback(input: {
  productInfo?: string;
  ratio?: string;
  posterStyle?: string;
}): FbPosterResult {
  const category = productCategoryFromInfo(input.productInfo);
  const poster: FbPosterBrief = {
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
    cta: 'Comment "CATALOG" or DM us for sample details',
  };
  return {
    ok: true,
    source: 'local',
    layoutModules: [
      {
        module: 'headline zone',
        referencePattern: 'Use a strong OEM/ODM value hook or clone-mode viral opening structure.',
        localAssetRole: 'none',
        replacementInstruction: 'Rewrite with verified product category and buyer pain point.',
      },
      {
        module: 'product hero',
        referencePattern: 'Premium central product display with clean catalog composition.',
        localAssetRole: 'product photo',
        replacementInstruction: 'Replace competitor/product placeholder with selected local product images.',
      },
      {
        module: 'proof modules',
        referencePattern: 'Factory proof, badges, process row, category cards, and CTA bar.',
        localAssetRole: 'factory image / certificate image / packaging image / scene image',
        replacementInstruction: 'Map local assets to each proof module and keep commercial claims verified.',
      },
    ],
    poster,
    caption: `Looking to launch your own ${category} brand?\n\nWe support OEM/ODM, private label packaging, product customization, and export-ready supply for overseas buyers.\n\nComment "CATALOG" or DM us to get product options and sample details.`,
    hashtags: ['OEM', 'ODM', 'PrivateLabel', 'B2B', 'Wholesale', 'FactoryDirect'],
    commentCta: 'Comment "CATALOG" to get the product list and sample details.',
    dmOpening: 'Hi, thanks for your interest. May I know your target market, product type, expected MOQ, and whether you need private label packaging?',
    fieldsToConfirm: ['MOQ', 'certifications', 'lead time', 'price range', 'export countries', 'factory qualifications'],
    imagePrompt: `Create a high-end B2B OEM/ODM social media poster for ${category}. Ratio ${String(input.ratio || '1:1')}. Style ${String(input.posterStyle || 'oem-factory')}. Include the exact poster text from the JSON brief, product hero area, factory proof area, trust badges, process row, product category cards, and bottom CTA bar. Premium catalog quality, clean layout, no unreadable tiny text.`,
  };
}

async function del(path: string): Promise<{ ok: boolean }> {
  try {
    const r = await fetch(`/api/overseas/studio/${path}`, { method: 'DELETE', headers: authHeader() });
    return { ok: r.ok };
  } catch {
    return { ok: false };
  }
}

export const studioApi = {
  script: (b: {
    materials: string[];
    productInfo?: string;
    language: string;
    platform: string;
    duration: number;
    scriptType?: 'voiceover' | 'storyboard';
    generationMode?: 'material' | 'product' | 'clone';
    materialInfos?: Array<{ name: string; type: string; folder: string; duration: number; effectiveDuration?: number; role?: string; targetStart?: number; targetEnd?: number; industry?: string; shotFunction?: string; tags?: string; observations?: string[] }>;
    provider?: 'gemini' | 'qwen';
    audience?: string;
    sellingPoints?: string;
    tone?: string;
    referenceTitle?: string;
    referenceAnalysis?: string;
    referenceHighlights?: string[];
  }, fb: string) =>
    post<{ script: string; source?: 'ai' | 'fallback' | 'local'; fallbackReason?: string; validationIssues?: string[] }>('script', b, { script: fb }),

  covers: (b: { script?: string; productInfo?: string; language: string; provider?: 'gemini' | 'qwen'; tone?: string }, fb: string[]) =>
    post<{ covers: string[] }>('covers', b, { covers: fb }),

  caption: (b: {
    script?: string;
    productInfo?: string;
    platform: string;
    language: string;
    provider?: 'gemini' | 'qwen';
    audience?: string;
    sellingPoints?: string;
    tone?: string;
  }, fb: { caption: string; hashtags: string[] }) =>
    post<{ caption: string; hashtags: string[] }>('caption', b, fb),

  fbPoster: (b: {
    mode: 'material' | 'clone' | 'product';
    productInfo?: string;
    platform: string;
    ratio: string;
    posterStyle: string;
    language: string;
    provider?: 'gemini' | 'qwen';
    materials?: Array<{ id?: string; name: string; type?: string; folder?: string; role?: string }>;
    referenceNotes?: string;
  }) =>
    post<FbPosterResult>('fb-poster', b, localPosterFallback(b)),

  fbPosterRender: (b: {
    poster: FbPosterBrief;
    caption?: string;
    imagePrompt?: string;
    ratio: string;
    materialIds?: string[];
  }) =>
    post<FbPosterRenderResult>('fb-poster/render', b, { ok: false }),

  select: (b: SelectInput, fb: string[]) =>
    post<{ selectedIds: string[]; reason: string }>('select', b, { selectedIds: fb, reason: '本地按视频优先选取' }),

  // 配音 TTS
  tts: (b: { script?: string; text?: string; voice: string; language: string; style?: Partial<TtsStyleOptions> }) =>
    post<TtsAudioResult>('tts', b, { ok: false }),
  ttsBatch: (b: { voice: string; items: { code: string; text: string; language?: string }[]; style?: Partial<TtsStyleOptions> }) =>
    post<{ ok: boolean; audios: Record<string, TtsAudioResult>; error?: string }>('tts/batch', b, { ok: false, audios: {} }),
  alignTts: (b: { text: string; url: string; duration: number }) =>
    post<{ ok: boolean; cues: SubCue[]; source?: 'audio_ai' | 'proportional'; error?: string }>('tts/align', b, { ok: false, cues: [] }),
  transcribeVoiceover: (b: { url: string; duration: number; language?: string; transcriptHint?: string }) =>
    post<{ ok: boolean; text: string; cues: SubCue[]; source?: 'audio_ai' | 'proportional'; error?: string }>('tts/transcribe', b, { ok: false, text: '', cues: [] }),
  audioCapabilities: async () => {
    try {
      const r = await fetch('/api/overseas/studio/tts/capabilities', { headers: authHeader() });
      if (!r.ok) throw new Error(String(r.status));
      return await r.json() as StudioAudioCapabilities;
    } catch {
      return {
        ok: false,
        customVoice: { upload: true, synthesis: false, engines: { minimax: false, xtts: false }, message: '暂时无法读取真人音色引擎状态。' },
        subtitles: { automatic: true, audioTranscription: false, wordAlignment: false, fallback: 'proportional' },
      } as StudioAudioCapabilities;
    }
  },
  diagnoseMinimax: () =>
    post<{ ok: boolean; configured: boolean; latencyMs?: number; model?: string; clonedVoices?: number; message?: string; error?: string }>(
      'tts/minimax/diagnose', {}, { ok: false, configured: false, error: 'MiniMax 诊断请求失败' },
    ),
  uploadVoiceSample: (b: { name: string; dataBase64: string; mimeType?: string; duration?: number; replacesVoiceId?: string }) =>
    post<{ ok: boolean; id?: string; voiceId?: string; name?: string; url?: string; duration?: number; synthesisReady?: boolean; engine?: 'minimax' | 'xtts'; warning?: string; error?: string }>('voice-samples', b, { ok: false }),
  uploadVoiceover: (b: { name: string; dataBase64: string; mimeType?: string; duration?: number }) =>
    post<{ ok: boolean; url?: string; duration?: number; error?: string }>('voiceover', b, { ok: false }),

  // 封面 SVG
  cover: (b: { title: string; ratio: string; accent: string; bgImageUrl?: string } & Partial<CoverStyle>) =>
    post<{ ok: boolean; url?: string }>('cover', b, { ok: false }),

  // 文本翻译（默认译成简体中文，供用户确认外语文案）
  translate: (b: { text: string; target?: string; source?: string }) =>
    post<{ ok: boolean; text: string }>('translate', b, { ok: false, text: '' }),
  translateBatch: (b: { text: string; targets: string[]; source?: string }) =>
    post<{ ok: boolean; translations: Record<string, string>; error?: string }>('translate/batch', b, { ok: false, translations: {} }),

  // Seedance 视频生成
  seedanceVideo: (b: {
    script: string;
    productInfo?: string;
    language: string;
    ratio?: string;
    duration?: number;
    resolution?: string;
    title?: string;
    referenceImageUrl?: string;
  }) =>
    postSeedanceVideo(b),

  storyboardQualityCheck: (b: { materialId: string; storyboard: string; productInfo?: string; critical?: boolean }) =>
    post<{ ok: boolean; quality?: StoryboardQualityResult; error?: string }>('storyboard-quality-check', b, { ok: false }),

  // 数据看板 AI 结论
  insight: (b: { scope: string; metrics: Record<string, unknown> }) =>
    post<{ ok: boolean; summary: string; actions: string[] }>('insight', b, { ok: false, summary: '', actions: [] }),

  // ⑥ 渲染授权：服务器下发原料 manifest + 短期令牌，合成交给客户端本机 ffmpeg
  render: async (spec: RenderSpec): Promise<RenderAuthorization & { source?: string }> => {
    try {
      const r = await fetch('/api/overseas/studio/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(spec),
      });
      if (r.status === 402 || r.status === 429) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error === 'demo_expired' ? '试用已到期，请联系服务顾问开通或延长试用。' : '今日视频预览额度已用完，请明天再试或联系服务顾问开通更多额度。');
      }
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as RenderAuthorization;
    } catch (err: any) {
      if (String(err?.message || '').includes('Demo')) throw err;
      return { source: 'local', token: null, expiresAt: null, manifest: localManifest(spec) };
    }
  },

  renderLocal: async (manifest: RenderManifest): Promise<{ ok: boolean; outputPath?: string; error?: string }> => {
    try {
      const r = await fetch('/api/overseas/studio/render/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(manifest),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || String(r.status));
      return data as { ok: boolean; outputPath?: string; error?: string };
    } catch (err: any) {
      return { ok: false, error: err?.message || '本地 MP4 导出失败' };
    }
  },

  openRenderOutput: async (path: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const r = await fetch('/api/overseas/studio/render/open-output', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ path }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: data?.error || `打开本地文件夹失败（${r.status}）` };
      return data as { ok: boolean; error?: string };
    } catch (err: any) {
      return { ok: false, error: err?.message || '打开本地文件夹失败' };
    }
  },

  openCapcut: (payload: Record<string, unknown>) =>
    post<{ ok: boolean; dir?: string; appOpened?: boolean; draftCreated?: boolean; folderOpened?: boolean; createDraftError?: string; error?: string }>('capcut/open', payload, { ok: false, error: '剪映跳转失败' }),

  // 草稿 / 作品
  listProjects: async (): Promise<StudioProject[]> => {
    try {
      const r = await fetch('/api/overseas/studio/projects', { headers: authHeader() });
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      return Array.isArray(data) ? (data as StudioProject[]) : [];
    } catch {
      return [];
    }
  },
  saveProject: (b: { id?: string; title: string; status: 'draft' | 'published' | 'template'; spec: Record<string, unknown>; thumbSeed?: string }) =>
    post<{ ok: boolean; project: StudioProject }>('projects', b, { ok: false, project: null as unknown as StudioProject }),
  deleteProject: (id: string) => del(`projects/${id}`),
  createVariationBatch: (b: { title: string; templateProjectId?: string; duration: number; maxItems: number; dimensions: Record<string, string[]>; plan?: VariationBatch['plan'] }) =>
    post<{ ok: boolean; batch: VariationBatch }>('variation-batches', b, { ok: false, batch: null as unknown as VariationBatch }),
  listVariationBatches: async (): Promise<VariationBatch[]> => {
    try { const r = await fetch('/api/overseas/studio/variation-batches', { headers: authHeader() }); return r.ok ? await r.json() as VariationBatch[] : []; } catch { return []; }
  },
  updateVariationItem: async (batchId: string, itemId: string, body: { status: string; note?: string }) => {
    try {
      const r = await fetch(`/api/overseas/studio/variation-batches/${batchId}/items/${itemId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(body) });
      return await r.json() as { ok: boolean; batch?: VariationBatch };
    } catch { return { ok: false }; }
  },

  // 素材库
  listMaterials: async (): Promise<Material[]> => {
    try {
      const r = await fetch('/api/overseas/studio/materials', { headers: authHeader() });
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      return Array.isArray(data) ? (data as Material[]) : [];
    } catch {
      return [];
    }
  },
  uploadMaterial: (b: { name: string; folder?: string; type: 'video' | 'image' | 'audio'; duration?: number; dataBase64: string; mimeType?: string }) =>
    post<{ ok: boolean; material: Material }>('materials', b, { ok: false, material: null as unknown as Material }),
  analyzeMaterialSegments: (id: string) =>
    post<{ ok: boolean; material?: Material; segments?: MaterialSegment[]; error?: string }>(`materials/${id}/analyze-segments`, {}, { ok: false, error: '片段分析失败' }),
  updateMaterialSegment: async (materialId: string, segmentId: string, patch: Partial<MaterialSegment>) => {
    try {
      const response = await fetch(`/api/overseas/studio/materials/${materialId}/segments/${segmentId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(patch),
      });
      return await response.json() as { ok: boolean; material?: Material; segment?: MaterialSegment; error?: string };
    } catch { return { ok: false, error: '片段更新失败' }; }
  },
  deleteMaterial: (id: string) => del(`materials/${id}`),

  // BGM 曲库
  listBgm: async (): Promise<BgmTrack[]> => {
    try {
      const r = await fetch('/api/overseas/studio/bgm', { headers: authHeader() });
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      return Array.isArray(data) ? (data as BgmTrack[]) : [];
    } catch {
      return [];
    }
  },
  uploadBgm: (b: { name: string; mood?: string; duration?: number; dataBase64: string; mimeType?: string }) =>
    post<{ ok: boolean; track: BgmTrack }>('bgm', b, { ok: false, track: null as unknown as BgmTrack }),
  deleteBgm: (id: string) => del(`bgm/${id}`),
};

export interface BgmTrack {
  id: string;
  name: string;
  mood: string;
  duration: number;
  url: string;
  recommended?: boolean;
  builtin?: boolean;
  scope?: 'shared' | 'tenant';
  uploadedBy?: string;
}

// 封面标题样式（同时驱动网页预览与服务端 SVG 生成）
export type CoverFont = 'sans' | 'impact' | 'serif' | 'rounded' | 'mono';
export interface CoverStyle {
  color: string;                        // 标题颜色 hex
  size: 'S' | 'M' | 'L';                // 字号档位
  position: 'top' | 'center' | 'bottom';// 垂直位置
  align: 'left' | 'center';             // 水平对齐
  font: CoverFont;                      // 字体（系统字体栈，预览与 SVG 一致）
  weight?: 'regular' | 'bold' | 'heavy';// 粗细档位（缺省 bold）
  fontFamily?: string;                  // 自定义导入字体的 family（覆盖 font 字体栈）
  artPreset?: 'clean' | 'outline' | 'highlight' | 'magazine' | 'neon' | 'sticker'; // 艺术字效果
}

export interface Material {
  id: string;
  name: string;
  folder: string;
  type: 'video' | 'image' | 'audio';
  duration: number;
  size: string;
  file: string;
  url: string;
  poster?: string;
  scope?: 'shared' | 'own';
  usage?: 'editable' | 'reference_only';
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

export interface MaterialSegment {
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
}
