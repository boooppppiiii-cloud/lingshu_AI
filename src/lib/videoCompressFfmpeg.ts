/**
 * 使用 ffmpeg.wasm 在浏览器端压缩大于 10MB 的视频，目标 720p 且尽量压到 10MB 以下。
 *
 * core 必须使用 ESM 构建：worker 内对 core 走 dynamic import()，UMD 无 default 会报
 * "failed to import ffmpeg-core.js"。用 Vite ?url 同源托管，避免 CDN/blob 在部分环境下失败。
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import coreJsUrl from '@ffmpeg/core?url';
import coreWasmUrl from '@ffmpeg/core/wasm?url';
import { isLikelyVideoFile } from './isLikelyVideoFile';

export { isLikelyVideoFile };

/** 超过此大小的视频在客户端预压缩 */
const COMPRESS_INPUT_THRESHOLD = 10 * 1024 * 1024;
const TEN_MB = 10 * 1024 * 1024;

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

function resetFfmpegLoadState() {
  loadPromise = null;
  ffmpegInstance = null;
}

export function inferVideoMimeType(file: File): string {
  if (file.type.startsWith('video/')) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    mpeg: 'video/mpeg',
    mpg: 'video/mpeg',
    '3gp': 'video/3gpp',
    ogv: 'video/ogg',
  };
  if (ext && map[ext]) return map[ext]!;
  return file.type || 'video/mp4';
}

export function shouldCompressVideo(
  file: File,
  thresholdBytes: number = COMPRESS_INPUT_THRESHOLD,
): boolean {
  return file.size > thresholdBytes && isLikelyVideoFile(file);
}

async function loadFfmpeg(onPhase: (phase: 'load', p01: number) => void): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (!loadPromise) {
    loadPromise = (async () => {
      const ffmpeg = new FFmpeg();
      onPhase('load', 0.05);
      await ffmpeg.load({
        coreURL: coreJsUrl,
        wasmURL: coreWasmUrl,
      });
      onPhase('load', 1);
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })();
  } else {
    // 已有加载任务在跑（可能是页面预热触发的），立即给调用方一个初始进度，避免卡在 0%
    onPhase('load', 0.05);
  }
  try {
    return await loadPromise;
  } catch (e) {
    resetFfmpegLoadState();
    throw e;
  }
}

/**
 * 页面预热：提前加载 ffmpeg core/wasm，避免首次上传时长时间停在低进度。
 * 失败时交给调用方决定是否提示，避免影响页面正常使用。
 */
export async function warmupFfmpeg(): Promise<void> {
  await loadFfmpeg(() => undefined);
}

type ProgressCb = (info: { overall: number; phase: 'load' | 'encode' }) => void;

/** 多档尝试：720p 为主，逐步提高 crf / 降分辨率直至达标或用尽档位 */
const ENCODE_PRESETS_DEFAULT: { height: number; crf: number }[] = [
  { height: 720, crf: 26 },
  { height: 720, crf: 30 },
  { height: 720, crf: 34 },
  { height: 720, crf: 38 },
  { height: 540, crf: 32 },
  { height: 480, crf: 34 },
  { height: 480, crf: 40 },
  { height: 480, crf: 45 },
];

/** 创意迭代：360p 起，尽量压到 4MB 以下 */
export const ENCODE_PRESETS_ITERATION: { height: number; crf: number }[] = [
  { height: 360, crf: 28 },
  { height: 360, crf: 32 },
  { height: 360, crf: 36 },
  { height: 360, crf: 40 },
  { height: 288, crf: 34 },
  { height: 240, crf: 36 },
  { height: 240, crf: 42 },
  { height: 240, crf: 45 },
];

export type CompressVideoOptions = {
  /** 超过该大小才压缩；与调用方 shouldCompressVideo 一致 */
  thresholdBytes?: number;
  /** 达标即停止尝试下一档；默认 10MB */
  targetMaxBytes?: number;
  encodePresets?: { height: number; crf: number }[];
};

export async function compressVideoWithFfmpeg(
  file: File,
  onProgress: ProgressCb,
  options?: CompressVideoOptions,
): Promise<{ blob: Blob; mimeType: string }> {
  const thresholdBytes = options?.thresholdBytes ?? COMPRESS_INPUT_THRESHOLD;
  const targetMaxBytes = options?.targetMaxBytes ?? TEN_MB;
  const encodePresets = options?.encodePresets ?? ENCODE_PRESETS_DEFAULT;

  if (!shouldCompressVideo(file, thresholdBytes)) {
    onProgress({ overall: 1, phase: 'encode' });
    return { blob: file, mimeType: inferVideoMimeType(file) };
  }

  const ffmpeg = await loadFfmpeg((phase, p) => {
    if (phase === 'load') onProgress({ overall: p * 0.12, phase: 'load' });
  });

  const inputName = 'input.mp4';
  const outputName = 'output.mp4';

  await ffmpeg.writeFile(inputName, await fetchFile(file));

  let best: Uint8Array | null = null;
  let bestLen = Infinity;
  const n = encodePresets.length;

  for (let i = 0; i < n; i++) {
    const { height, crf } = encodePresets[i]!;
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
        `scale=-2:${height}:flags=bicubic`,
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
    if (len <= targetMaxBytes) {
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

const POSTER_JPG = 'poster.jpg';
const PREVIEW_OUT = 'preview_buying.mp4';

/**
 * 买量大屏：用 FFmpeg 从视频中截 JPG 封面，并生成低码率 MP4 预览（浏览器端 wasm）。
 * 同一输入文件顺序执行，避免重复 writeFile。
 */
export async function generateBuyingVideoMediaArtifacts(
  file: File,
  onProgress: (info: { overall: number; phase: 'load' | 'poster' | 'preview' }) => void,
): Promise<{ posterJpeg: Blob; previewMp4: Blob }> {
  const ffmpeg = await loadFfmpeg((phase, p01) => {
    if (phase === 'load') onProgress({ overall: p01 * 0.12, phase: 'load' });
  });

  const inputName = 'input.mp4';
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  try {
    await ffmpeg.deleteFile(POSTER_JPG).catch(() => undefined);
    await ffmpeg.deleteFile(PREVIEW_OUT).catch(() => undefined);

    onProgress({ overall: 0.14, phase: 'poster' });
    const exitPoster = await ffmpeg.exec([
      '-ss',
      '0.5',
      '-i',
      inputName,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      POSTER_JPG,
    ]);
    if (exitPoster !== 0) {
      throw new Error(`ffmpeg 截封面失败（退出码 ${exitPoster}）`);
    }
    const posterRaw = await ffmpeg.readFile(POSTER_JPG);
    if (!(posterRaw instanceof Uint8Array)) {
      throw new Error('无法读取封面图');
    }
    const posterJpeg = new Blob([posterRaw], { type: 'image/jpeg' });
    onProgress({ overall: 0.35, phase: 'poster' });

    const onProg = ({ progress }: { progress: number }) => {
      onProgress({ overall: Math.min(0.98, 0.35 + progress * 0.63), phase: 'preview' });
    };
    ffmpeg.on('progress', onProg);
    let exitPreview = 1;
    try {
      exitPreview = await ffmpeg.exec([
        '-i',
        inputName,
        '-vf',
        'scale=-2:480:flags=bicubic',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '35',
        '-c:a',
        'aac',
        '-b:a',
        '48k',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        '-pix_fmt',
        'yuv420p',
        PREVIEW_OUT,
      ]);
    } finally {
      ffmpeg.off('progress', onProg);
    }
    if (exitPreview !== 0) {
      throw new Error(`ffmpeg 预览转码失败（退出码 ${exitPreview}）`);
    }
    const previewRaw = await ffmpeg.readFile(PREVIEW_OUT);
    if (!(previewRaw instanceof Uint8Array)) {
      throw new Error('无法读取预览视频');
    }
    const previewMp4 = new Blob([previewRaw], { type: 'video/mp4' });
    onProgress({ overall: 1, phase: 'preview' });
    return { posterJpeg, previewMp4 };
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => undefined);
    await ffmpeg.deleteFile(POSTER_JPG).catch(() => undefined);
    await ffmpeg.deleteFile(PREVIEW_OUT).catch(() => undefined);
  }
}
