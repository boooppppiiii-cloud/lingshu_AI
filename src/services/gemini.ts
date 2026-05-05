/**
 * 浏览器只调用同源 /api/gemini，由 Node 服务代持 GEMINI_API_KEY。
 * @license SPDX-License-Identifier: Apache-2.0
 */

export type FlashInspirationIdea = { title: string; concept: string; hook: string };

export type VideoHighlights = {
  theme: string[];
  plot: string[];
  mood: string[];
  hook: string[];
};

export type ThemeCard = { title: string; description: string };

const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

async function callGemini<T>(body: object): Promise<T> {
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
    throw new Error(`AI 接口返回异常 (${res.status}): ${raw.slice(0, 200)}`);
  }
  if (!res.ok || !json.ok) {
    throw new Error(json.error || res.statusText || 'Gemini API request failed');
  }
  return json.data as T;
}

export const geminiService = {
  async generateFlashInspiration(prompt: string, sellingPoints: string, style: string, moods: string) {
    return callGemini<string | undefined>({
      op: 'generateFlashInspiration',
      prompt,
      sellingPoints,
      style,
      moods,
    });
  },

  async generateInspirationIdeas(prompt: string, sellingPoints: string, style: string, moods: string) {
    return callGemini<FlashInspirationIdea[]>({
      op: 'generateInspirationIdeas',
      prompt,
      sellingPoints,
      style,
      moods,
    });
  },

  async generateImageDescription(
    imageBase64: string | null,
    prompt: string,
    sellingPoints: string,
    style: string,
    moods: string,
  ) {
    return callGemini<string | undefined>({
      op: 'generateImageDescription',
      imageBase64,
      prompt,
      sellingPoints,
      style,
      moods,
    });
  },

  async analyzeVideoIteration(videoBase64: string, mimeType: string, style: string, moods: string) {
    return callGemini<string | undefined>({
      op: 'analyzeVideoIteration',
      videoBase64,
      mimeType,
      style,
      moods,
    });
  },

  async extractHighlights(videoBase64: string, mimeType: string) {
    return callGemini<VideoHighlights | null>({
      op: 'extractHighlights',
      videoBase64,
      mimeType,
    });
  },

  async generateThemes(selectedHighlights: string[], sellingPoints: string) {
    return callGemini<ThemeCard[]>({
      op: 'generateThemes',
      selectedHighlights,
      sellingPoints,
    });
  },

  async generateFinalScript(themeTitle: string, themeDescription: string, style: string, moods: string) {
    return callGemini<string | undefined>({
      op: 'generateFinalScript',
      themeTitle,
      themeDescription,
      style,
      moods,
    });
  },

  async extractInspiration(videoBase64: string, mimeType: string, style: string, moods: string) {
    return callGemini<string | undefined>({
      op: 'extractInspiration',
      videoBase64,
      mimeType,
      style,
      moods,
    });
  },
};
