/**
 * 浏览器只调用同源 /api/gemini，由 Node 服务代持 GEMINI_API_KEY。
 * @license SPDX-License-Identifier: Apache-2.0
 */

import type {
  BuyingPageAssistantContext,
  BuyingPageAssistantMessage,
} from '../lib/buyingPageAssistantContext';
import type { ThemeTagCatalogEntry } from '../lib/buyingThemeTagCatalog';
import type { GameProfileId } from '../lib/gameProfiles';
import {
  type GeminiModelChoice,
  readGeminiModelChoice,
} from '../lib/geminiModelSelection';

export type FlashInspirationIdea = { title: string; concept: string; hook: string };

export type VideoHighlights = {
  theme: string[];
  plot: string[];
  mood: string[];
  hook: string[];
};

export type ThemeCard = { title: string; description: string };

/** 买量大屏 /api/gemini op `analyzeBuyingVideo` 返回结构 */
export type BuyingVideoAiAnalysis = {
  /** [题材标签, 主题标签1, 主题标签2] */
  scriptTags: [string, string, string];
  hookAnalysis: {
    first3sVisual: string;
    first3sDialogue: string;
    first3sHookType: string;
    first3sHookTypeOther: string;
    coreGameplaySellingPoints: string;
    coreWelfareSellingPoints: string;
    endingGuidance: string;
    reusableViralPattern: string;
    fullAnalysis?: {
      totalSeconds: number;
      emotionCurve: FlashEmotionPoint[];
      peak3sSec: number;
      peakFullSec: number;
      firstSellingPointSec: number;
    };
  };
};

export type FlashEmotionPoint = { t: number; intensity: number; note?: string };
export type FlashScriptAxisDiag = {
  status: 'strong' | 'ok' | 'weak';
  score: number;
  finding: string;
  suggestions: string[];
};
export type FlashScriptDiagnosis = {
  totalSeconds: number;
  emotionCurve: FlashEmotionPoint[];
  hook3s: FlashScriptAxisDiag;
  selling8s: FlashScriptAxisDiag;
};

export const FLASH_SCRIPT_DURATION_PRESETS = ['1-5', '5-10', '10-15', '15-25', '50-60'] as const;
export type FlashScriptDurationPreset = (typeof FLASH_SCRIPT_DURATION_PRESETS)[number];

/** 灵光一闪脚本时长选项的界面文案（与 API `durationPreset` 键一致） */
export const FLASH_SCRIPT_DURATION_LABEL: Record<FlashScriptDurationPreset, string> = {
  '1-5': '1-5秒',
  '5-10': '5-10秒',
  '10-15': '10-15秒',
  '15-25': '15-25秒',
  '50-60': '50-60秒',
};

export type GeminiCallOptions = {
  onRetryAttempt?: (attempt: number, maxAttempts: number) => void;
  /** 登录用户 id，供服务端写入 `gemini.call` 流水 */
  analyticsUserId?: string;
  /** 与创意工坊左上角游戏切换一致；缺省为种花 flower */
  gameProfileId?: GameProfileId;
  /** 买量分析：优先复用的历史主题标签 */
  existingThemeTags?: ThemeTagCatalogEntry[];
  /** 模型档位：preview / 3.1pro / 3.5flash */
  modelChoice?: GeminiModelChoice;
};

export type GeminiStreamCallOptions = GeminiCallOptions & {
  /** 每收到一段增量文本回调（delta 为当次片段，accumulated 为当前全文） */
  onDelta?: (delta: string, accumulated: string) => void;
  /** 视频二进制预上传进度（loaded/total 字节） */
  onUploadProgress?: (loaded: number, total: number) => void;
  /** 视频预上传完成、即将发起流式分析 */
  onStagingComplete?: () => void;
};

const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = [3000, 8000, 15000, 30000, 60000] as const;
const STAGE_MAX_ATTEMPTS = 4;
const STAGE_RETRY_MS = [1500, 3000, 6000] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(): number {
  return Math.random() * 400;
}

function isRetriable(err: unknown, status?: number): boolean {
  if (status === 429) return true;
  if (status !== undefined && status >= 500 && status <= 599) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /busy|RESOURCE_EXHAUSTED|too many|rate limit|rate[-_ ]?limit|ECONNRESET|ETIMEDOUT|socket|network|fetch failed|load failed|aborted|限流|繁忙|过载|请稍后/i.test(
      msg,
    ) || /503|502|504|429/.test(msg)
  );
}

function uploadVideoBlobXHR(
  url: string,
  blob: Blob,
  mimeType: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ stagingId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Video-Mime', mimeType);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress?.(ev.loaded, ev.total);
    };
    xhr.onload = () => {
      const raw = xhr.responseText ?? '';
      let json: { ok?: boolean; stagingId?: string; error?: string };
      try {
        json = JSON.parse(raw) as { ok?: boolean; stagingId?: string; error?: string };
      } catch {
        const err = new Error(`视频预上传返回异常 (${xhr.status}): ${raw.slice(0, 200)}`) as Error & {
          status?: number;
        };
        err.status = xhr.status;
        reject(err);
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300 || !json.ok || !json.stagingId) {
        const err = new Error(json.error || xhr.statusText || '视频预上传失败') as Error & {
          status?: number;
        };
        err.status = xhr.status;
        reject(err);
        return;
      }
      resolve({ stagingId: json.stagingId });
    };
    xhr.onerror = () => reject(new TypeError('Failed to fetch'));
    xhr.onabort = () => reject(new Error('aborted'));
    xhr.send(blob);
  });
}

async function stageVideoBlob(
  blob: Blob,
  mimeType: string,
  options?: Pick<GeminiStreamCallOptions, 'onUploadProgress' | 'onRetryAttempt'>,
): Promise<string> {
  const url = `${apiBase}/api/gemini/stage-video`;
  for (let attempt = 1; attempt <= STAGE_MAX_ATTEMPTS; attempt++) {
    options?.onRetryAttempt?.(attempt, STAGE_MAX_ATTEMPTS);
    try {
      const { stagingId } = await uploadVideoBlobXHR(url, blob, mimeType, options?.onUploadProgress);
      return stagingId;
    } catch (e) {
      const status = (e as Error & { status?: number }).status;
      if (!isRetriable(e, status) || attempt >= STAGE_MAX_ATTEMPTS) {
        const hint =
          '无法上传视频到 AI 服务。请确认 API 已启动，且网络稳定；大文件上传失败时可换更小视频或稍后重试。';
        const msg = e instanceof Error ? e.message : String(e);
        const looksNetwork =
          msg === 'Failed to fetch' ||
          /fetch|network|load failed|aborted/i.test(msg) ||
          e instanceof TypeError;
        throw new Error(looksNetwork ? `${hint}（原始错误：${msg}）` : `${hint} (${msg})`);
      }
      const base = STAGE_RETRY_MS[attempt - 1] ?? STAGE_RETRY_MS[STAGE_RETRY_MS.length - 1];
      await sleep(base + jitterMs());
    }
  }
  throw new Error('视频预上传失败，请检查网络后重试。');
}

async function singleFetch<T>(body: object): Promise<T> {
  const url = `${apiBase}/api/gemini`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const hint =
      '无法连接 AI 服务。请确认已运行 npm run dev（会同时启动 API），' +
      '或单独执行 npm run dev:api，并保证 Vite 代理 /api 指向 127.0.0.1:8787。';
    const msg = e instanceof Error ? e.message : String(e);
    const looksNetwork =
      msg === 'Failed to fetch' ||
      /fetch|network|load failed|aborted/i.test(msg) ||
      e instanceof TypeError;
    throw new Error(looksNetwork ? `${hint}（原始错误：${msg}）` : `${hint} (${msg})`);
  }

  const raw = await res.text();
  let json: { ok: boolean; data?: T; error?: string };
  try {
    json = JSON.parse(raw) as { ok: boolean; data?: T; error?: string };
  } catch {
    const e = new Error(`AI 接口返回异常 (${res.status}): ${raw.slice(0, 200)}`) as Error & {
      status?: number;
    };
    e.status = res.status;
    throw e;
  }
  if (!res.ok || !json.ok) {
    const e = new Error(
      json.error || res.statusText || 'Gemini API request failed',
    ) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  return json.data as T;
}

async function callGemini<T>(body: object, options?: GeminiCallOptions): Promise<T> {
  const { analyticsUserId, onRetryAttempt, gameProfileId, existingThemeTags, modelChoice } = options ?? {};
  const payload = {
    ...body,
    ...(analyticsUserId ? { analyticsUserId } : {}),
    ...(gameProfileId ? { gameProfileId } : {}),
    ...(existingThemeTags?.length ? { existingThemeTags } : {}),
    modelChoice: modelChoice ?? readGeminiModelChoice(),
  };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onRetryAttempt?.(attempt, MAX_ATTEMPTS);
    try {
      return await singleFetch<T>(payload);
    } catch (e) {
      const status = (e as Error & { status?: number }).status;
      if (!isRetriable(e, status)) {
        throw e;
      }
      if (attempt >= MAX_ATTEMPTS) {
        break;
      }
      const base = RETRY_BASE_MS[attempt - 1] ?? RETRY_BASE_MS[RETRY_BASE_MS.length - 1];
      await sleep(base + jitterMs());
    }
  }

  throw new Error(
    '已重试多次仍无法完成请求，服务可能繁忙、遇到限流或网络不稳定，请稍后再试。',
  );
}

async function consumeGeminiNdjsonStream(
  body: object,
  options?: Pick<GeminiStreamCallOptions, 'onDelta'>,
): Promise<string> {
  const url = `${apiBase}/api/gemini/stream`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const hint =
      '无法连接 AI 服务。请确认已运行 npm run dev（会同时启动 API），' +
      '或单独执行 npm run dev:api，并保证 Vite 代理 /api 指向 127.0.0.1:8787。';
    const msg = e instanceof Error ? e.message : String(e);
    const looksNetwork =
      msg === 'Failed to fetch' ||
      /fetch|network|load failed|aborted/i.test(msg) ||
      e instanceof TypeError;
    throw new Error(looksNetwork ? `${hint}（原始错误：${msg}）` : `${hint} (${msg})`);
  }

  if (!res.ok) {
    const raw = await res.text();
    let errMsg = raw.slice(0, 800);
    try {
      const j = JSON.parse(raw) as { error?: string };
      if (typeof j.error === 'string' && j.error) errMsg = j.error;
    } catch {
      /* 非 JSON */
    }
    const err = new Error(errMsg || res.statusText || 'Gemini stream request failed') as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }

  if (!res.body) {
    throw new Error('无响应体');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const idx = buffer.indexOf('\n');
      if (idx < 0) break;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let ev: { type?: string; text?: string; message?: string };
      try {
        ev = JSON.parse(line) as { type?: string; text?: string; message?: string };
      } catch {
        throw new Error(`流式响应解析失败: ${line.slice(0, 120)}`);
      }
      if (ev.type === 'delta' && typeof ev.text === 'string') {
        full += ev.text;
        options?.onDelta?.(ev.text, full);
      } else if (ev.type === 'error') {
        throw new Error(ev.message || 'Stream error');
      } else if (ev.type === 'done') {
        return full;
      }
    }
  }

  const tail = buffer.trim();
  if (tail) {
    try {
      const ev = JSON.parse(tail) as { type?: string; message?: string };
      if (ev.type === 'done') return full;
      if (ev.type === 'error') throw new Error(ev.message || 'Stream error');
    } catch (e) {
      if (e instanceof SyntaxError) {
        return full;
      }
      throw e;
    }
  }
  return full;
}

async function callGeminiNdjsonStream(
  body: object,
  options?: GeminiStreamCallOptions,
): Promise<string> {
  const { analyticsUserId, onRetryAttempt, onDelta, gameProfileId, modelChoice } = options ?? {};
  const payload = {
    ...body,
    ...(analyticsUserId ? { analyticsUserId } : {}),
    ...(gameProfileId ? { gameProfileId } : {}),
    modelChoice: modelChoice ?? readGeminiModelChoice(),
  };
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onRetryAttempt?.(attempt, MAX_ATTEMPTS);
    try {
      return await consumeGeminiNdjsonStream(payload, { onDelta });
    } catch (e) {
      lastErr = e;
      const status = (e as Error & { status?: number }).status;
      if (!isRetriable(e, status)) {
        throw e;
      }
      if (attempt >= MAX_ATTEMPTS) {
        break;
      }
      const base = RETRY_BASE_MS[attempt - 1] ?? RETRY_BASE_MS[RETRY_BASE_MS.length - 1];
      await sleep(base + jitterMs());
    }
  }

  throw new Error(
    'Gemini 当前繁忙，已尝试备用模型仍失败。请 1 分钟后重试，或换短一点的视频。',
  );
}

export const geminiService = {
  async generateFlashInspiration(
    prompt: string,
    sellingPoints: string,
    style: string,
    moods: string,
    options?: GeminiCallOptions,
    durationPreset: FlashScriptDurationPreset = '10-15',
  ) {
    return callGemini<string | undefined>(
      {
        op: 'generateFlashInspiration',
        prompt,
        sellingPoints,
        style,
        moods,
        durationPreset,
      },
      options,
    );
  },

  async generateVoiceoverScript(
    prompt: string,
    flowerGame: boolean,
    voiceIdentity: string,
    voiceScene: string,
    voiceEmotion: string,
    options?: GeminiCallOptions,
    durationPreset: FlashScriptDurationPreset = '10-15',
  ) {
    return callGemini<string | undefined>(
      {
        op: 'generateVoiceoverScript',
        prompt,
        flowerGame,
        voiceIdentity,
        voiceScene,
        voiceEmotion,
        durationPreset,
      },
      options,
    );
  },

  async generateInspirationIdeas(
    prompt: string,
    sellingPoints: string,
    style: string,
    moods: string,
    options?: GeminiCallOptions,
  ) {
    return callGemini<FlashInspirationIdea[]>(
      {
        op: 'generateInspirationIdeas',
        prompt,
        sellingPoints,
        style,
        moods,
      },
      options,
    );
  },

  async generateImageDescription(
    imageBase64: string | null,
    prompt: string,
    sellingPoints: string,
    style: string,
    moods: string,
    options?: GeminiCallOptions,
  ) {
    return callGemini<string | undefined>(
      {
        op: 'generateImageDescription',
        imageBase64,
        prompt,
        sellingPoints,
        style,
        moods,
      },
      options,
    );
  },

  async generateDisplayProductionScript(
    motionCardText: string,
    durationSeconds: number,
    visualDescription: string,
    sellingPoints: string,
    style: string,
    moods: string,
    options?: GeminiCallOptions,
  ) {
    return callGemini<string | undefined>(
      {
        op: 'generateDisplayProductionScript',
        motionCardText,
        durationSeconds,
        visualDescription,
        sellingPoints,
        style,
        moods,
      },
      options,
    );
  },

  async generateDisplayProductionScriptStream(
    motionCardText: string,
    durationSeconds: number,
    visualDescription: string,
    sellingPoints: string,
    style: string,
    moods: string,
    options?: GeminiStreamCallOptions,
  ) {
    return callGeminiNdjsonStream(
      {
        op: 'generateDisplayProductionScript',
        motionCardText,
        durationSeconds,
        visualDescription,
        sellingPoints,
        style,
        moods,
      },
      options,
    );
  },

  async analyzeVideoIterationStream(
    video: string | Blob,
    mimeType: string,
    style: string,
    moods: string,
    options?: GeminiStreamCallOptions,
  ) {
    const common = { mimeType, style, moods };
    if (typeof video !== 'string') {
      const stagingId = await stageVideoBlob(video, mimeType, options);
      options?.onStagingComplete?.();
      return callGeminiNdjsonStream(
        {
          op: 'analyzeVideoIteration',
          videoStagingId: stagingId,
          ...common,
        },
        options,
      );
    }
    return callGeminiNdjsonStream(
      {
        op: 'analyzeVideoIteration',
        videoBase64: video,
        ...common,
      },
      options,
    );
  },

  async analyzeVideoIteration(
    videoBase64: string,
    mimeType: string,
    style: string,
    moods: string,
    options?: GeminiCallOptions,
  ) {
    return callGemini<string | undefined>(
      {
        op: 'analyzeVideoIteration',
        videoBase64,
        mimeType,
        style,
        moods,
      },
      options,
    );
  },

  async extractHighlights(videoBase64: string, mimeType: string, options?: GeminiCallOptions) {
    return callGemini<VideoHighlights | null>(
      {
        op: 'extractHighlights',
        videoBase64,
        mimeType,
      },
      options,
    );
  },

  async analyzeBuyingVideo(
    videoBase64: string,
    mimeType: string,
    fileName: string,
    _includeHookDeepAnalysis?: boolean,
    options?: GeminiCallOptions,
  ) {
    return callGemini<BuyingVideoAiAnalysis>(
      {
        op: 'analyzeBuyingVideo',
        videoBase64,
        mimeType,
        fileName,
      },
      options,
    );
  },

  async generateThemes(
    selectedHighlights: string[],
    sellingPoints: string,
    options?: GeminiCallOptions,
  ) {
    return callGemini<ThemeCard[]>(
      {
        op: 'generateThemes',
        selectedHighlights,
        sellingPoints,
      },
      options,
    );
  },

  async generateFinalScript(
    themeTitle: string,
    themeDescription: string,
    style: string,
    moods: string,
    options?: GeminiCallOptions,
    extraPrompt?: string,
  ) {
    const trimmed = extraPrompt?.trim();
    return callGemini<string | undefined>(
      {
        op: 'generateFinalScript',
        themeTitle,
        themeDescription,
        style,
        moods,
        ...(trimmed ? { extraPrompt: trimmed } : {}),
      },
      options,
    );
  },

  async extractInspiration(
    videoBase64: string,
    mimeType: string,
    style: string,
    moods: string,
    options?: GeminiCallOptions,
  ) {
    return callGemini<string | undefined>(
      {
        op: 'extractInspiration',
        videoBase64,
        mimeType,
        style,
        moods,
      },
      options,
    );
  },

  async diagnoseFlashScript(
    script: string,
    sellingPoints: string | undefined,
    options?: GeminiCallOptions,
  ) {
    return callGemini<FlashScriptDiagnosis | null>(
      {
        op: 'diagnoseFlashScript',
        script,
        sellingPoints: sellingPoints?.trim() || undefined,
      },
      options,
    );
  },

  async askBuyingPageAssistant(
    question: string,
    context: BuyingPageAssistantContext,
    messages: BuyingPageAssistantMessage[] | undefined,
    options?: GeminiCallOptions,
  ) {
    return callGemini<{ reply: string; usedWebSearch?: boolean }>(
      {
        op: 'askBuyingPageAssistant',
        question: question.trim(),
        context,
        messages,
      },
      options,
    );
  },
};
