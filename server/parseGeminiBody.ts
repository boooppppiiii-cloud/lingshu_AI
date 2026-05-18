import type { GeminiOpBody } from './geminiBackend';

const VALID_OPS = new Set<string>([
  'generateFlashInspiration',
  'generateVoiceoverScript',
  'generateInspirationIdeas',
  'generateImageDescription',
  'generateDisplayProductionScript',
  'analyzeVideoIteration',
  'extractHighlights',
  'generateThemes',
  'generateFinalScript',
  'extractInspiration',
  'diagnoseFlashScript',
  'analyzeBuyingVideo',
]);

export function parseGeminiRequest(raw: unknown): { opBody: GeminiOpBody; analyticsUserId?: string } {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid body');
  }
  const r = raw as Record<string, unknown>;
  const op = r.op;
  if (typeof op !== 'string' || !VALID_OPS.has(op)) {
    throw new Error('Invalid or unknown op');
  }
  const analyticsUserId =
    typeof r.analyticsUserId === 'string' && r.analyticsUserId.length > 0 ? r.analyticsUserId : undefined;
  const rest = { ...r };
  delete rest.analyticsUserId;
  return { opBody: rest as GeminiOpBody, analyticsUserId };
}
