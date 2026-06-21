/* eslint-disable */
/**
 * 本机原生 ffmpeg 合成器（桌面端）。
 * 直接调用 ffmpeg-static 自带的二进制，按服务器下发的 manifest 合成一条 MP4。
 *
 * 现阶段 manifest 里的素材/配音/封面/BGM 的 url 都还是 null（TTS、出图、曲库未接入），
 * 因此这里用「纯色背景 + 烧录封面标题/口播 Hook + 静音音轨」合成一条真实可播放的占位成片，
 * 证明本机合成链路打通。等原料 url 填上后，把 color 背景换成封面图/片段、anullsrc 换成
 * 配音+BGM 混流即可，函数签名不变。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ffmpegPath = require('ffmpeg-static');

/** 画面比例 → 分辨率 */
function resolution(ratio) {
  switch (ratio) {
    case '1:1': return [1080, 1080];
    case '16:9': return [1920, 1080];
    case '9:16':
    default: return [1080, 1920];
  }
}

/** 找一个存在的系统字体给 drawtext 用；找不到则返回 null（退化为不烧字） */
function findFont() {
  const candidates = [
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/Library/Fonts/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', // linux
    'C:\\Windows\\Fonts\\arial.ttf',                    // windows
  ];
  return candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

/** 取脚本的第一行非空文本作为 Hook */
function firstHook(script) {
  const lines = String(script || '').split('\n').map(s => s.trim());
  for (const l of lines) {
    if (l && !/^\[.*\]$/.test(l)) return l;        // 跳过 [Hook · 0-3s] 这类标签行
  }
  return lines.find(Boolean) || '';
}

/** 构造 drawtext 片段（用 textfile 规避特殊字符转义） */
function drawtext({ font, textfile, fontsize, y }) {
  const parts = [
    font ? `fontfile='${font.replace(/'/g, "\\'")}'` : null,
    `textfile='${textfile.replace(/'/g, "\\'")}'`,
    'fontcolor=white',
    `fontsize=${fontsize}`,
    'x=(w-text_w)/2',
    `y=${y}`,
    'line_spacing=12',
    'box=1',
    'boxcolor=black@0.38',
    'boxborderw=22',
  ].filter(Boolean);
  return `drawtext=${parts.join(':')}`;
}

/**
 * 合成成片。
 * @param {object} manifest  服务器下发的渲染清单
 * @param {(pct:number)=>void} onProgress  进度回调（0-100）
 * @param {string} [outDir]  输出目录，默认系统临时目录
 * @returns {Promise<{ok:boolean, outputPath?:string, error?:string}>}
 */
function composite(manifest, onProgress = () => {}, outDir) {
  return new Promise(resolve => {
    if (!ffmpegPath) {
      resolve({ ok: false, error: 'ffmpeg-static binary not found' });
      return;
    }

    const spec = (manifest && manifest.spec) || {};
    const duration = Math.max(1, Number(spec.duration) || 20);
    const [w, h] = resolution(spec.ratio);
    const font = findFont();

    const jobId = (manifest && manifest.jobId) || `job-${Date.now()}`;
    const dir = outDir || os.tmpdir();
    const outputPath = path.join(dir, `studio-${jobId}.mp4`);

    // 把要烧录的文字写到临时文件（避免 filtergraph 转义问题）
    const titleFile = path.join(os.tmpdir(), `studio-title-${jobId}.txt`);
    const hookFile = path.join(os.tmpdir(), `studio-hook-${jobId}.txt`);
    const title = (manifest && manifest.cover && manifest.cover.title) || '';
    const hook = firstHook(manifest && manifest.script);
    try {
      fs.writeFileSync(titleFile, title, 'utf8');
      fs.writeFileSync(hookFile, hook, 'utf8');
    } catch { /* ignore，退化为不烧字 */ }

    const filters = [];
    if (title) filters.push(drawtext({ font, textfile: titleFile, fontsize: Math.round(w / 16), y: 'h*0.12' }));
    if (hook) filters.push(drawtext({ font, textfile: hookFile, fontsize: Math.round(w / 26), y: 'h*0.78' }));

    const args = [
      '-f', 'lavfi', '-i', `color=c=0x141A2E:s=${w}x${h}:r=30:d=${duration}`,
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    ];
    if (filters.length) args.push('-vf', filters.join(','));
    args.push(
      '-map', '0:v', '-map', '1:a',
      '-t', String(duration),
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', outputPath,
    );

    const proc = spawn(ffmpegPath, args);
    let stderr = '';

    proc.stderr.on('data', chunk => {
      const s = chunk.toString();
      stderr += s;
      // 解析 time=HH:MM:SS.xx 计算进度
      const m = s.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m) {
        const secs = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        onProgress(Math.min(99, (secs / duration) * 100));
      }
    });

    proc.on('error', err => resolve({ ok: false, error: String(err) }));
    proc.on('close', code => {
      try { fs.unlinkSync(titleFile); fs.unlinkSync(hookFile); } catch { /* noop */ }
      if (code === 0) {
        onProgress(100);
        resolve({ ok: true, outputPath });
      } else {
        resolve({ ok: false, error: `ffmpeg exited ${code}\n${stderr.slice(-800)}` });
      }
    });
  });
}

module.exports = { composite, resolution, ffmpegPath };
