import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config({ path: path.join(process.cwd(), '.env'), quiet: true });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true, quiet: true });

function fail(message, detail) {
  const error = detail ? `${message}: ${String(detail).slice(0, 500)}` : message;
  process.stdout.write(JSON.stringify({ ok: false, source: 'gemini', error }));
  process.exit(0);
}

async function main() {
  const jobPath = process.argv[2];
  if (!jobPath) fail('Missing Gemini video job file');

  let job;
  try {
    job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  } catch (e) {
    fail('Cannot read Gemini video job file', e?.message ?? e);
  }

  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) fail('GEMINI_API_KEY not set');

  const model = String(job.model || process.env.GEMINI_VIDEO_MODEL || 'veo-2.0-generate-001').trim();
  const outputDir = String(job.outputDir || path.join(process.cwd(), 'data/media/generated'));
  const duration = Math.max(5, Math.min(8, Math.round(Number(job.duration) || 8)));
  const timeoutMs = Math.max(30_000, Number(process.env.GEMINI_VIDEO_TIMEOUT_MS || job.timeoutMs || 360_000));
  const intervalMs = Math.max(3_000, Number(process.env.GEMINI_VIDEO_POLL_INTERVAL_MS || job.intervalMs || 10_000));

  fs.mkdirSync(outputDir, { recursive: true });
  const ai = new GoogleGenAI({ apiKey });

  let operation;
  try {
    operation = await ai.models.generateVideos({
      model,
      source: { prompt: String(job.prompt || '').slice(0, 8000) },
      config: {
        numberOfVideos: 1,
        durationSeconds: duration,
        aspectRatio: job.ratio || '9:16',
        resolution: job.resolution || '720p',
        personGeneration: 'allow_adult',
        enhancePrompt: true,
      },
    });
  } catch (e) {
    fail('Gemini 视频生成请求失败', e?.message ?? e);
  }

  const deadline = Date.now() + timeoutMs;
  try {
    while (!operation.done && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      operation = await ai.operations.getVideosOperation({ operation });
    }
  } catch (e) {
    fail('Gemini 视频生成轮询失败', e?.message ?? e);
  }

  if (!operation.done) fail('Gemini video generation timed out');
  if (operation.error) {
    const msg = operation.error?.message || JSON.stringify(operation.error);
    fail('Gemini 视频生成失败', msg);
  }

  const generated = operation.response?.generatedVideos?.[0];
  const videoFile = generated?.video;
  if (!videoFile) {
    const reasons = operation.response?.raiMediaFilteredReasons?.join('；');
    fail(reasons || 'Gemini did not return a generated video');
  }

  const id = randomUUID();
  const file = `${id}.mp4`;
  const outputPath = path.join(outputDir, file);
  try {
    await ai.files.download({ file: videoFile, downloadPath: outputPath });
  } catch (e) {
    fail('Gemini 视频文件下载失败', e?.message ?? e);
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    source: 'gemini',
    id,
    file,
    title: job.title || 'Gemini 生成视频',
    url: `/media/generated/${file}`,
    duration,
    model,
    createdAt: new Date().toISOString(),
  }));
}

main().catch(e => fail('Gemini video worker crashed', e?.message ?? e));
