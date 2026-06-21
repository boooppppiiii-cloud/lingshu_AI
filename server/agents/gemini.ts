import { GoogleGenAI, type Content } from '@google/genai';
import type { VideoAiAnalysis, VoiceoverContent, StoryboardContent, ScriptType, Language } from '../types/index.js';

const MODEL = () => (process.env.GEMINI_MODEL ?? 'gemini-2.0-flash').trim();

function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  return new GoogleGenAI({ apiKey });
}

// ─── Concurrency queue ────────────────────────────────────────────────────────

const MAX_CONCURRENT = 2;
const WINDOW_MS = 60_000;
const MAX_STARTS_PER_WINDOW = 15;

let activeCount = 0;
const startTimestamps: number[] = [];
let mutex: Promise<void> = Promise.resolve();

function pruneTsWindow(now: number): void {
  const cutoff = now - WINDOW_MS;
  while (startTimestamps.length > 0 && startTimestamps[0]! < cutoff) startTimestamps.shift();
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const next = new Promise<void>((r) => { release = r; });
  const prev = mutex;
  mutex = next;
  await prev;
  try { return await fn(); } finally { release(); }
}

async function tryAdmit(): Promise<boolean> {
  return withLock(async () => {
    const now = Date.now();
    pruneTsWindow(now);
    if (activeCount < MAX_CONCURRENT && startTimestamps.length < MAX_STARTS_PER_WINDOW) {
      activeCount++;
      startTimestamps.push(Date.now());
      return true;
    }
    return false;
  });
}

async function releaseSlot(): Promise<void> {
  await withLock(async () => { activeCount = Math.max(0, activeCount - 1); });
}

async function throughQueue<T>(fn: () => Promise<T>): Promise<T> {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  while (!(await tryAdmit())) {
    await sleep(50 + Math.random() * 200);
  }
  try { return await fn(); } finally { await releaseSlot(); }
}

// ─── Retry ────────────────────────────────────────────────────────────────────

function isRetriable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /503|502|504|429|UNAVAILABLE|high demand|RESOURCE_EXHAUSTED/i.test(msg);
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const delays = [2000, 5000, 10000];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await throughQueue(fn);
    } catch (e) {
      lastErr = e;
      if (!isRetriable(e) || attempt >= maxAttempts) throw e;
      await sleep(delays[attempt - 1] ?? 10000);
    }
  }
  throw lastErr;
}

// ─── Core generate helpers ────────────────────────────────────────────────────

async function generateText(opts: {
  contents: string | Content[];
  systemInstruction?: string;
  jsonMode?: boolean;
}): Promise<string> {
  const ai = client();
  const response = await ai.models.generateContent({
    model: MODEL(),
    contents: opts.contents as string,
    config: {
      ...(opts.systemInstruction ? { systemInstruction: opts.systemInstruction } : {}),
      ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  });
  return response.text ?? '';
}

function parseJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

// ─── Public AI operations ─────────────────────────────────────────────────────

/** Analyze a video file (provided as base64) and return structured metadata */
export async function analyzeVideo(opts: {
  videoBase64: string;
  mimeType: string;
}): Promise<VideoAiAnalysis> {
  const systemInstruction = `You are an expert short-video content analyst for overseas e-commerce marketing.
Analyze the provided video and extract structured metadata. Output ONLY valid JSON — no markdown, no code blocks, no preamble.

Required JSON fields:
- theme: string, one-line description of the video's core topic/product
- hooks: string[], 2–4 specific attention-grabbing opening techniques used
- sellingPoints: string[], 3–6 key product benefits or features demonstrated
- mood: string, emotional tone (e.g. "energetic", "aspirational", "educational", "humorous")
- structure: string, narrative flow description (e.g. "problem → solution → CTA", "demo → testimonial → offer")
- recommendedScriptType: "voiceover" | "storyboard"`;

  const raw = await withRetry(() =>
    generateText({
      contents: [
        {
          parts: [
            { inlineData: { data: opts.videoBase64.replace(/^data:[^,]+,/, ''), mimeType: opts.mimeType } },
            { text: 'Analyze this video and return the JSON.' },
          ],
        },
      ] as Content[],
      systemInstruction,
      jsonMode: true,
    }),
  );

  const parsed = parseJson<Partial<VideoAiAnalysis>>(raw, {});
  return {
    theme: String(parsed.theme ?? ''),
    hooks: Array.isArray(parsed.hooks) ? parsed.hooks.map(String) : [],
    sellingPoints: Array.isArray(parsed.sellingPoints) ? parsed.sellingPoints.map(String) : [],
    mood: String(parsed.mood ?? ''),
    structure: String(parsed.structure ?? ''),
    recommendedScriptType: parsed.recommendedScriptType === 'storyboard' ? 'storyboard' : 'voiceover',
  };
}

/** Generate a voiceover script from video analysis */
export async function generateVoiceoverScript(opts: {
  analysis: VideoAiAnalysis;
  language: Language;
  productInfo?: string;
}): Promise<VoiceoverContent> {
  const { analysis, language, productInfo } = opts;

  const systemInstruction = `You are a top-tier overseas marketing copywriter specializing in short-video voiceover scripts for e-commerce.
Output ONLY valid JSON — no markdown, no preamble.

JSON structure:
{
  "hook": "Opening line (≤15 words, grabs attention immediately)",
  "body": ["paragraph 1", "paragraph 2", "paragraph 3"],
  "cta": "Call-to-action line (≤10 words)",
  "duration": "estimated total duration in seconds (15–60)",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"]
}

Write everything in ${language === 'zh' ? 'Chinese (Simplified)' : `language code: ${language}`}.
The script must be natural for voiceover delivery — conversational, energetic, persuasive.`;

  const userPrompt = `Video analysis:
- Theme: ${analysis.theme}
- Hooks used: ${analysis.hooks.join(', ')}
- Selling points: ${analysis.sellingPoints.join(', ')}
- Mood: ${analysis.mood}
- Structure: ${analysis.structure}
${productInfo ? `\nProduct information (prioritize this):\n${productInfo}` : ''}

Generate a voiceover script that captures this video's energy while promoting the product effectively.`;

  const raw = await withRetry(() =>
    generateText({ contents: userPrompt, systemInstruction, jsonMode: true }),
  );

  const parsed = parseJson<Partial<VoiceoverContent>>(raw, {});
  return {
    hook: String(parsed.hook ?? ''),
    body: Array.isArray(parsed.body) ? parsed.body.map(String) : [],
    cta: String(parsed.cta ?? ''),
    duration: String(parsed.duration ?? '30'),
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String) : [],
  };
}

/** Generate a storyboard script from video analysis */
export async function generateStoryboardScript(opts: {
  analysis: VideoAiAnalysis;
  language: Language;
  productInfo?: string;
}): Promise<StoryboardContent> {
  const { analysis, language, productInfo } = opts;

  const systemInstruction = `You are a professional short-video storyboard director for overseas e-commerce ads.
Output ONLY valid JSON — no markdown, no preamble.

JSON structure:
{
  "scenes": [
    {
      "index": 1,
      "duration": 3,
      "shot": "close-up | medium | wide | extreme close-up",
      "camera": "static | push-in | pull-out | pan | tilt | handheld",
      "action": "What happens on screen (describe visuals)",
      "voiceover": "Voiceover text for this scene",
      "caption": "On-screen text caption"
    }
  ]
}

Write voiceover and captions in ${language === 'zh' ? 'Chinese (Simplified)' : `language code: ${language}`}.
Target: 6–10 scenes, total 15–45 seconds.`;

  const userPrompt = `Video analysis:
- Theme: ${analysis.theme}
- Hooks: ${analysis.hooks.join(', ')}
- Selling points: ${analysis.sellingPoints.join(', ')}
- Mood: ${analysis.mood}
- Structure: ${analysis.structure}
${productInfo ? `\nProduct information (prioritize this):\n${productInfo}` : ''}

Create a storyboard that replicates the video's winning structure while promoting the product.`;

  const raw = await withRetry(() =>
    generateText({ contents: userPrompt, systemInstruction, jsonMode: true }),
  );

  const parsed = parseJson<Partial<StoryboardContent>>(raw, {});
  const scenes = Array.isArray(parsed.scenes)
    ? parsed.scenes.map((s, i) => {
        const scene = s as unknown as Record<string, unknown>;
        return {
          index: Number(scene.index ?? i + 1),
          duration: Number(scene.duration ?? 3),
          shot: String(scene.shot ?? 'medium'),
          camera: String(scene.camera ?? 'static'),
          action: String(scene.action ?? ''),
          voiceover: String(scene.voiceover ?? ''),
          caption: String(scene.caption ?? ''),
        };
      })
    : [];
  return { scenes };
}

/** Generate a new script from an existing script's structure + new product info */
export async function generateFromProduct(opts: {
  sourceScript: { type: ScriptType; content: VoiceoverContent | StoryboardContent };
  productInfo: string;
  language: Language;
}): Promise<VoiceoverContent | StoryboardContent> {
  const { sourceScript, productInfo, language } = opts;

  const systemInstruction = `You are an overseas marketing script writer. You will receive a reference script and new product information.
Extract the structural framework and emotional pattern from the reference script, then rewrite it entirely for the new product.
Output ONLY valid JSON in the same schema as the input script — no markdown, no preamble.
Write in ${language === 'zh' ? 'Chinese (Simplified)' : `language code: ${language}`}.`;

  const userPrompt = `Reference script (${sourceScript.type}):
${JSON.stringify(sourceScript.content, null, 2)}

New product information:
${productInfo}

Rewrite the script entirely for this new product, keeping the same structural framework.`;

  const raw = await withRetry(() =>
    generateText({ contents: userPrompt, systemInstruction, jsonMode: true }),
  );

  return parseJson<VoiceoverContent | StoryboardContent>(raw, sourceScript.content);
}

/** Translate an existing script to a target language */
export async function translateScript(opts: {
  script: VoiceoverContent | StoryboardContent;
  targetLanguage: Language;
}): Promise<VoiceoverContent | StoryboardContent> {
  const { script, targetLanguage } = opts;

  const systemInstruction = `You are a professional marketing translator specializing in e-commerce content.
Translate all text fields in the provided JSON to ${targetLanguage}.
Preserve the JSON structure exactly. Output ONLY valid JSON — no markdown, no preamble.
Localize idioms and CTAs for the target culture, not just literal translation.`;

  const userPrompt = `Translate this script to ${targetLanguage}:\n${JSON.stringify(script, null, 2)}`;

  const raw = await withRetry(() =>
    generateText({ contents: userPrompt, systemInstruction, jsonMode: true }),
  );

  return parseJson<VoiceoverContent | StoryboardContent>(raw, script);
}

/** Generate an image prompt for a storyboard scene (Pro mode) */
export async function generateImagePrompt(opts: {
  scene: { action: string; shot: string; mood?: string };
  productInfo: string;
}): Promise<string> {
  const systemInstruction = `You are a visual art director for e-commerce ads.
Generate a detailed image generation prompt for the described scene.
Output ONLY the prompt text — no JSON, no explanation.`;

  const userPrompt = `Scene: ${opts.scene.shot} shot. ${opts.scene.action}
Product: ${opts.productInfo}
${opts.scene.mood ? `Mood: ${opts.scene.mood}` : ''}
Write a Stable Diffusion / Imagen prompt (≤100 words) that would produce a compelling ad image for this scene.`;

  return withRetry(() => generateText({ contents: userPrompt, systemInstruction }));
}
