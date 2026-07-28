import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { r2Download, r2Head, r2Upload } from '../server/storage/r2.js';

type Material = { name: string; type: string; objectKey?: string; posterObjectKey?: string };
const materials = JSON.parse(fs.readFileSync('data/materials.json', 'utf8')) as Material[];

function extractPoster(videoPath: string, posterPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) { reject(new Error('ffmpeg unavailable')); return; }
    const child = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', '0', '-i', videoPath, '-frames:v', '1', '-q:v', '3', '-y', posterPath]);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
  });
}

let repaired = 0;
let skipped = 0;
let failed = 0;
for (const material of materials) {
  if (material.type !== 'video' || !material.objectKey || !material.posterObjectKey) continue;
  if (await r2Head(material.posterObjectKey)) { skipped += 1; continue; }
  const media = await r2Download(material.objectKey);
  if (!media?.buf.length) { failed += 1; console.error(`missing video: ${material.name}`); continue; }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-poster-'));
  const videoPath = path.join(tempDir, 'source.mp4');
  const posterPath = path.join(tempDir, 'poster.jpg');
  try {
    fs.writeFileSync(videoPath, media.buf);
    await extractPoster(videoPath, posterPath);
    await r2Upload({ key: material.posterObjectKey, body: fs.readFileSync(posterPath), contentType: 'image/jpeg' });
    if (!await r2Head(material.posterObjectKey)) throw new Error('poster verification failed');
    repaired += 1;
    console.log(`repaired ${repaired}: ${material.name}`);
  } catch (error) {
    failed += 1;
    console.error(`failed: ${material.name}: ${error instanceof Error ? error.message : error}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ repaired, skipped, failed }));
