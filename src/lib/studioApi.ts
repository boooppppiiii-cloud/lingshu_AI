/* 混剪工作台 AI 接口封装 —— 任何失败都回退本地，保证 UI 永不中断 */

async function post<T>(path: string, body: unknown, fallback: T): Promise<T & { source?: string }> {
  try {
    const r = await fetch(`/api/overseas/studio/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as T & { source?: string };
  } catch {
    return { ...fallback, source: 'local' };
  }
}

async function get<T>(path: string, fallback: T): Promise<T & { source?: string }> {
  try {
    const r = await fetch(`/api/overseas/studio/${path}`);
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as T & { source?: string };
  } catch {
    return { ...fallback, source: 'local' };
  }
}

export interface SelectInput { materials: { id: string; name: string; type: string; duration: number }[]; duration: number }

export interface RenderSpec {
  materials: string[];
  script: string;
  voice: string;
  bgm: string;
  bgmVol: number;
  coverId: string;
  coverTitle: string;
  ratio: string;
  duration: number;
  platform: string;
  language: string;
}

export interface RenderManifest {
  jobId: string;
  spec: { ratio: string; duration: number; platform: string; language: string; bgmVol: number };
  script: string;
  timeline: { index: number; name: string; url: string | null }[];
  voiceover: { voice: string | null; url: string | null };
  cover: { id: string | null; title: string; url: string | null };
  bgm: { id: string | null; url: string | null };
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
    },
    script: spec.script ?? '',
    timeline: (spec.materials ?? []).map((name, index) => ({ index, name, url: null })),
    voiceover: { voice: spec.voice ?? null, url: null },
    cover: { id: spec.coverId ?? null, title: spec.coverTitle ?? '', url: null },
    bgm: { id: spec.bgm ?? null, url: null },
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

async function del(path: string): Promise<{ ok: boolean }> {
  try {
    const r = await fetch(`/api/overseas/studio/${path}`, { method: 'DELETE' });
    return { ok: r.ok };
  } catch {
    return { ok: false };
  }
}

export const studioApi = {
  script: (b: { materials: string[]; productInfo?: string; language: string; platform: string; duration: number; scriptType?: 'voiceover' | 'storyboard' }, fb: string) =>
    post<{ script: string }>('script', b, { script: fb }),

  covers: (b: { script?: string; productInfo?: string; language: string }, fb: string[]) =>
    post<{ covers: string[] }>('covers', b, { covers: fb }),

  caption: (b: { script?: string; productInfo?: string; platform: string; language: string }, fb: { caption: string; hashtags: string[] }) =>
    post<{ caption: string; hashtags: string[] }>('caption', b, fb),

  select: (b: SelectInput, fb: string[]) =>
    post<{ selectedIds: string[]; reason: string }>('select', b, { selectedIds: fb, reason: '本地按视频优先选取' }),

  // ⑥ 渲染授权：服务器下发原料 manifest + 短期令牌，合成交给客户端本机 ffmpeg
  render: async (spec: RenderSpec): Promise<RenderAuthorization & { source?: string }> => {
    try {
      const r = await fetch('/api/overseas/studio/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
      });
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as RenderAuthorization;
    } catch {
      return { source: 'local', token: null, expiresAt: null, manifest: localManifest(spec) };
    }
  },

  // 草稿 / 作品
  listProjects: async (): Promise<StudioProject[]> => {
    try {
      const r = await fetch('/api/overseas/studio/projects');
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
};
