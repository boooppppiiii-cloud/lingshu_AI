export const GEMINI_MODEL_STORAGE_KEY = 'lingqi.geminiModelChoice';

export const GEMINI_MODEL_OPTIONS = [
  { value: 'preview', label: 'Preview（默认）' },
  { value: '2.5flash', label: '2.5 Flash（最快，推荐迭代）' },
  { value: '2.5pro', label: '2.5 Pro（高质量）' },
  { value: '3.5flash', label: '3.5 Flash' },
  { value: 'flash-latest', label: 'Flash Latest（最新）' },
  { value: 'lite', label: 'Lite（极快）' },
] as const;

export type GeminiModelChoice = (typeof GEMINI_MODEL_OPTIONS)[number]['value'];

const GEMINI_MODEL_SET = new Set<GeminiModelChoice>(GEMINI_MODEL_OPTIONS.map((o) => o.value));

export function normalizeGeminiModelChoice(raw: unknown): GeminiModelChoice {
  const value = typeof raw === 'string' ? raw : '';
  if (GEMINI_MODEL_SET.has(value as GeminiModelChoice)) {
    return value as GeminiModelChoice;
  }
  return 'preview';
}

export function readGeminiModelChoice(): GeminiModelChoice {
  if (typeof window === 'undefined') return 'preview';
  try {
    return normalizeGeminiModelChoice(window.localStorage.getItem(GEMINI_MODEL_STORAGE_KEY));
  } catch {
    return 'preview';
  }
}

export function writeGeminiModelChoice(choice: GeminiModelChoice): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, normalizeGeminiModelChoice(choice));
  } catch {
    // 忽略浏览器存储异常，不影响主流程。
  }
}
