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
export interface SubCue { start: number; end: number; text: string; zh?: string }
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
  status: 'draft' | 'published';
  spec: Record<string, unknown>;
  thumbSeed?: string;
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
  poster: FbPosterBrief;
  caption: string;
  hashtags: string[];
  commentCta: string;
  dmOpening: string;
  fieldsToConfirm: string[];
  imagePrompt: string;
  error?: string;
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
    materialInfos?: Array<{ name: string; type: string; folder: string; duration: number; role?: string; targetStart?: number; targetEnd?: number }>;
    provider?: 'gemini' | 'qwen';
    audience?: string;
    sellingPoints?: string;
    tone?: string;
    referenceTitle?: string;
    referenceAnalysis?: string;
    referenceHighlights?: string[];
  }, fb: string) =>
    post<{ script: string; source?: 'ai' | 'fallback' | 'local' }>('script', b, { script: fb }),

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
    post<FbPosterResult>('fb-poster', b, {
      ok: false,
      poster: {
        headline: '',
        subheadline: '',
        originBadge: '',
        trustBadges: [],
        sellingPoints: [],
        process: [],
        categories: [],
        bottomBar: [],
        cta: '',
      },
      caption: '',
      hashtags: [],
      commentCta: '',
      dmOpening: '',
      fieldsToConfirm: [],
      imagePrompt: '',
    }),

  select: (b: SelectInput, fb: string[]) =>
    post<{ selectedIds: string[]; reason: string }>('select', b, { selectedIds: fb, reason: '本地按视频优先选取' }),

  // 配音 TTS
  tts: (b: { script?: string; text?: string; voice: string; language: string }) =>
    post<{ ok: boolean; url?: string; duration?: number; error?: string }>('tts', b, { ok: false }),
  ttsBatch: (b: { voice: string; items: { code: string; text: string; language?: string }[] }) =>
    post<{ ok: boolean; audios: Record<string, { ok: boolean; source?: string; url?: string; duration?: number; error?: string }>; error?: string }>('tts/batch', b, { ok: false, audios: {} }),
  uploadVoiceSample: (b: { name: string; dataBase64: string; mimeType?: string; duration?: number }) =>
    post<{ ok: boolean; id?: string; voiceId?: string; name?: string; url?: string; duration?: number; error?: string }>('voice-samples', b, { ok: false }),
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
  }) =>
    postSeedanceVideo(b),

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
  saveProject: (b: { id?: string; title: string; status: 'draft' | 'published'; spec: Record<string, unknown>; thumbSeed?: string }) =>
    post<{ ok: boolean; project: StudioProject }>('projects', b, { ok: false, project: null as unknown as StudioProject }),
  deleteProject: (id: string) => del(`projects/${id}`),

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
  createdAt: string;
}
