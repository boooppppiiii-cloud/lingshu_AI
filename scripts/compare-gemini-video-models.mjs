import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { GoogleGenAI } from '@google/genai';

loadEnv();

const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

const outputDir = path.resolve(process.cwd(), 'data/media/generated/model-comparison');
fs.mkdirSync(outputDir, { recursive: true });

const prompt = `Create a single continuous 4-second vertical 9:16 photorealistic handheld selfie video in an indoor livestream setting. Use a real adult male performer. Extreme close-up focused on his eyes. He leans down very close to the phone camera while a pale blue tissue covers his nose and mouth, leaving only his forehead, eyebrows, and both eyes visible. During the first 1.5 seconds he looks slightly downward. Then he slowly raises his gaze directly into the lens and deliberately widens his eyes, creating suspense. Fixed handheld phone camera with subtle natural shake. Authentic smartphone livestream aesthetic, natural skin texture, realistic eyes, consistent identity and anatomy. No captions, no text, no logos, no watermark, no social-media UI, no cuts.`;

const ai = new GoogleGenAI({ apiKey });

async function generateOmni() {
  const startedAt = Date.now();
  const interaction = await ai.interactions.create({
    model: 'gemini-omni-flash-preview',
    input: prompt,
    response_format: { type: 'video', aspect_ratio: '9:16' },
  });
  const data = interaction.output_video?.data;
  if (!data) throw new Error(`Omni returned no inline video (status: ${interaction.status || 'unknown'})`);
  const file = path.join(outputDir, 'omni-flash-opening-4s.mp4');
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return { model: 'gemini-omni-flash-preview', file, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) };
}

async function generateVeoLite() {
  const startedAt = Date.now();
  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-lite-generate-preview',
    prompt,
    config: { numberOfVideos: 1, durationSeconds: 4, aspectRatio: '9:16', resolution: '720p' },
  });
  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 10_000));
    operation = await ai.operations.getVideosOperation({ operation });
  }
  if (operation.error) throw new Error(`Veo failed: ${JSON.stringify(operation.error)}`);
  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video) throw new Error('Veo returned no video');
  const file = path.join(outputDir, 'veo-3.1-lite-opening-4s.mp4');
  await ai.files.download({ file: video, downloadPath: file });
  return { model: 'veo-3.1-lite-generate-preview', file, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) };
}

const results = [];
const requestedModel = String(process.argv[2] || 'both').toLowerCase();
const generators = requestedModel === 'omni'
  ? [generateOmni]
  : requestedModel === 'veo'
    ? [generateVeoLite]
    : [generateOmni, generateVeoLite];
for (const generate of generators) {
  try {
    const result = await generate();
    results.push({ ok: true, ...result });
    process.stdout.write(`${JSON.stringify(results.at(-1))}\n`);
  } catch (error) {
    const result = { ok: false, model: generate === generateOmni ? 'gemini-omni-flash-preview' : 'veo-3.1-lite-generate-preview', error: String(error?.message || error) };
    results.push(result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

process.exitCode = results.some(result => !result.ok) ? 1 : 0;
