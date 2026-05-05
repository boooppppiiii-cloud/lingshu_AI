/**
 * 使用 ffmpeg.wasm 在浏览器端压缩大于 10MB 的视频，目标 720p 且尽量压到 10MB 以下。
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

/** 超过此大小的视频在客户端预压缩 */
const COMPRESS_INPUT_THRESHOLD = 10 * 1024 * 1024;
const TEN_MB = 10 * 1024 * 1024;
const CORE_VERSION = '0.12.6';
const CORE_CDN = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

function resetFfmpegLoadState() {
  loadPromise = null;
  ffmpegInstance = null;
}

export function shouldCompressVideo(file: File): boolean {
  return file.size > COMPRESS_INPUT_THRESHOLD && file.type.startsWith('video/');
}

async function loadFfmpeg(onPhase: (phase: 'load', p01: number) => void): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (!loadPromise) {
    loadPromise = (async () => {
      const ffmpeg = new FFmpeg();
      onPhase('load', 0.05);
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_CDN}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE_CDN}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      onPhase('load', 1);
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })();
  }
  try {
    return await loadPromise;
  } catch (e) {
    resetFfmpegLoadState();
    throw e;
  }
}

type ProgressCb = (info: { overall: number; phase: 'load' | 'encode' }) => void;

/** 多档尝试：720p 为主，逐步提高 crf / 降分辨率直至 ≤10MB 或用尽档位 */
const ENCODE_PRESETS: { height: number; crf: number }[] = [
  { height: 720, crf: 26 },
  { height: 720, crf: 30 },
  { height: 720, crf: 34 },
  { height: 720, crf: 38 },
  { height: 540, crf: 32 },
  { height: 480, crf: 34 },
  { height: 480, crf: 40 },
  { height: 480, crf: 45 },
];

export async function compressVideoWithFfmpeg(
  file: File,
  onProgress: ProgressCb,
): Promise<{ blob: Blob; mimeType: string }> {
  if (!shouldCompressVideo(file)) {
    onProgress({ overall: 1, phase: 'encode' });
    return { blob: file, mimeType: file.type || 'video/mp4' };
  }

  const ffmpeg = await loadFfmpeg((phase, p) => {
    if (phase === 'load') onProgress({ overall: p * 0.12, phase: 'load' });
  });

  const inputName = 'input.mp4';
  const outputName = 'output.mp4';

  await ffmpeg.writeFile(inputName, await fetchFile(file));

  let best: Uint8Array | null = null;
  let bestLen = Infinity;
  const n = ENCODE_PRESETS.length;

  for (let i = 0; i < n; i++) {
    const { height, crf } = ENCODE_PRESETS[i]!;
    await ffmpeg.deleteFile(outputName).catch(() => undefined);

    const segment = 0.88 / n;
    const base = 0.12 + i * segment;

    const onProg = ({ progress }: { progress: number }) => {
      onProgress({ overall: Math.min(0.995, base + progress * segment), phase: 'encode' });
    };
    ffmpeg.on('progress', onProg);
    try {
      const exitCode = await ffmpeg.exec([
        '-i',
        inputName,
        '-vf',
        `scale=-2:${height}:flags=lanczos`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        String(crf),
        '-c:a',
        'aac',
        '-b:a',
        '64k',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        '-pix_fmt',
        'yuv420p',
        outputName,
      ]);
      if (exitCode !== 0) {
        throw new Error(`ffmpeg 编码失败（退出码 ${exitCode}）`);
      }
    } finally {
      ffmpeg.off('progress', onProg);
    }

    const raw = await ffmpeg.readFile(outputName);
    if (!(raw instanceof Uint8Array)) {
      throw new Error('无法读取压缩后的视频数据');
    }
    const data = raw;
    const len = data.byteLength;
    if (len < bestLen) {
      bestLen = len;
      best = data;
    }
    if (len <= TEN_MB) {
      await ffmpeg.deleteFile(inputName).catch(() => undefined);
      await ffmpeg.deleteFile(outputName).catch(() => undefined);
      onProgress({ overall: 1, phase: 'encode' });
      return { blob: new Blob([data], { type: 'video/mp4' }), mimeType: 'video/mp4' };
    }
  }

  await ffmpeg.deleteFile(inputName).catch(() => undefined);
  await ffmpeg.deleteFile(outputName).catch(() => undefined);

  if (!best || bestLen === Infinity) {
    throw new Error('视频压缩失败，未得到输出文件');
  }

  onProgress({ overall: 1, phase: 'encode' });
  return { blob: new Blob([best], { type: 'video/mp4' }), mimeType: 'video/mp4' };
}
