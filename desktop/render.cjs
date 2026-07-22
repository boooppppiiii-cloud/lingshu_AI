/* eslint-disable */
/**
 * 本机原生 ffmpeg 合成器（桌面端）。
 * 按服务器下发的 manifest 把「素材片段 → 拼接 → 烧录字幕 → 混入 BGM」
 * 合成一条真实 MP4。素材 / BGM 通过 manifest 里的 url 现拉到临时目录再喂给 ffmpeg。
 *
 * manifest 字段缺失时优雅退化：
 *   - 没有素材片段 → 用纯色背景兜底，仍出片
 *   - 没有 BGM     → 用静音轨
 * 等 cover.url / voiceover.url 接入后，再把封面图叠层、把配音混进音轨即可，签名不变。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let ffmpegPath = null;
try { ffmpegPath = require('ffmpeg-static'); } catch { ffmpegPath = null; }

/** 画面比例 → 分辨率 */
function resolution(ratio) {
  switch (ratio) {
    case '1:1': return [1080, 1080];
    case '16:9': return [1920, 1080];
    case '9:16':
    default: return [1080, 1920];
  }
}

const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|svg)(\?|$)/i;

/** 下载远端 url 到本地文件（桌面端与本机 express 同机，localhost 直连） */
async function downloadTo(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} -> ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function assTime(sec) {
  const n = Math.max(0, Number(sec) || 0);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = Math.floor(n % 60);
  const cs = Math.floor((n - Math.floor(n)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function assText(value) {
  return String(value || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[{}]/g, '')
    .trim();
}

function filterPath(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,');
}

function cuesToAss(cues, width, height) {
  const valid = (Array.isArray(cues) ? cues : [])
    .map(cue => ({
      start: Math.max(0, Number(cue && cue.start) || 0),
      end: Math.max(0, Number(cue && cue.end) || 0),
      text: assText(cue && cue.text),
    }))
    .filter(cue => cue.text && cue.end > cue.start);
  if (!valid.length) return '';

  const fontSize = Math.max(34, Math.round(width / 22));
  const marginV = Math.round(height / 3);
  const events = valid.map(cue =>
    `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${cue.text}`
  );
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Arial Unicode MS,${fontSize},&H00FFFFFF,&H00FFFFFF,&HAA000000,&H66000000,-1,0,0,0,100,100,0,0,1,4,1,2,80,80,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}

/**
 * 合成成片。
 * @param {object} manifest 服务器下发的渲染清单
 * @param {(pct:number)=>void} onProgress 进度回调（0-100）
 * @param {string} [outDir] 输出目录，默认 ~/Downloads/lingshu-ai-exports
 * @returns {Promise<{ok:boolean, outputPath?:string, error?:string}>}
 */
async function composite(manifest, onProgress = () => {}, outDir) {
  if (!ffmpegPath) {
    return { ok: false, error: 'ffmpeg-static binary not found（请先 npm install ffmpeg-static）' };
  }

  const spec = (manifest && manifest.spec) || {};
  const duration = Math.max(1, Number(spec.duration) || 20);
  const [w, h] = resolution(spec.ratio);
  const jobId = (manifest && manifest.jobId) || `job-${Date.now()}`;
  const dir = outDir || path.join(os.homedir(), 'Downloads', 'lingshu-ai-exports');
  fs.mkdirSync(dir, { recursive: true });
  const outputPath = path.join(dir, `studio-${jobId}.mp4`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));

  try {
    // 1) 拉取真实素材片段与 BGM
    const timeline = (manifest && manifest.timeline ? manifest.timeline : []).filter(t => t && t.url);
    const localClips = [];
    for (let i = 0; i < timeline.length; i++) {
      const u = timeline[i].url;
      const ext = (u.split('?')[0].split('.').pop() || 'mp4').toLowerCase();
      const dest = path.join(tmp, `clip${i}.${ext}`);
      try { await downloadTo(u, dest); localClips.push({ ...timeline[i], file: dest, image: IMAGE_RE.test(u) }); } catch { /* 跳过失败片段 */ }
    }

    let bgmFile = null;
    const bgmUrl = manifest && manifest.bgm && manifest.bgm.url;
    if (bgmUrl) {
      try {
        bgmFile = path.join(tmp, `bgm${path.extname(bgmUrl.split('?')[0]) || '.wav'}`);
        await downloadTo(bgmUrl, bgmFile);
      } catch { bgmFile = null; }
    }

    let voFile = null;
    const voUrl = manifest && manifest.voiceover && manifest.voiceover.url;
    if (voUrl) {
      try {
        voFile = path.join(tmp, `vo${path.extname(voUrl.split('?')[0]) || '.wav'}`);
        await downloadTo(voUrl, voFile);
      } catch { voFile = null; }
    }

    if (process.env.RENDER_DEBUG) console.error(`[render] downloaded clips=${localClips.length} bgm=${bgmFile ? 'yes' : 'no'} voiceover=${voFile ? 'yes' : 'no'}`);

    // 2) 组装 ffmpeg 参数
    const n = localClips.length;
    const args = ['-hide_banner', '-nostdin']; // -nostdin：别等键盘输入，否则 spawn 的 stdin 管道会让 ffmpeg 永久挂起
    const filters = [];
    let vlabel;

    if (n > 0) {
      localClips.forEach(c => {
        const target = Math.max(0.5, finiteNumber(c.targetDuration, duration / n));
        if (c.image) args.push('-loop', '1', '-t', target.toFixed(3), '-i', c.file);
        else args.push('-i', c.file);
      });
      localClips.forEach((c, i) => {
        const target = Math.max(0.5, finiteNumber(c.targetDuration, duration / n));
        const trimStart = Math.max(0, finiteNumber(c.trimStart, 0));
        const rawTrimEnd = finiteNumber(c.trimEnd, trimStart + target);
        const trimEnd = Math.max(trimStart + 0.1, rawTrimEnd);
        const speed = Math.min(4, Math.max(0.25, finiteNumber(c.speed, 1)));
        // 所有素材统一铺满目标画幅，避免横竖素材混用时出现黑边和画面尺寸跳变。
        const source = c.image
          ? `[${i}:v]trim=duration=${target.toFixed(3)},setpts=PTS-STARTPTS`
          : `[${i}:v]trim=start=${trimStart.toFixed(3)}:end=${trimEnd.toFixed(3)},setpts=(PTS-STARTPTS)/${speed.toFixed(3)},tpad=stop_mode=clone:stop_duration=${target.toFixed(3)},trim=duration=${target.toFixed(3)},setpts=PTS-STARTPTS`;
        filters.push(`${source},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30,format=yuv420p[v${i}]`);
      });
      filters.push(`${localClips.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0[vcat]`);
      vlabel = '[vcat]';
    } else {
      // 兜底：纯色背景
      args.push('-f', 'lavfi', '-t', String(duration), '-i', `color=c=0x141A2E:s=${w}x${h}:r=30`);
      vlabel = '[0:v]';
    }

    // 音轨输入：BGM(或静音) 固定一路，配音可选第二路。视频输入占 0..(vInputs-1)
    const vInputs = n > 0 ? n : 1;
    const bgmIdx = vInputs;
    if (bgmFile) args.push('-stream_loop', '-1', '-i', bgmFile);
    else args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    let voIdx = -1;
    if (voFile) { args.push('-i', voFile); voIdx = bgmIdx + 1; }

    // 3) 烧录口播字幕。每条 cue 单行显示，位置在画面下方 1/3。
    const subtitleCues = manifest && manifest.subtitles && manifest.subtitles.mode !== 'off'
      ? manifest.subtitles.cues
      : [];
    const ass = cuesToAss(subtitleCues, w, h);
    if (ass) {
      const assFile = path.join(tmp, 'subtitles.ass');
      fs.writeFileSync(assFile, ass, 'utf8');
      filters.push(`${vlabel}subtitles='${filterPath(assFile)}'[vout]`);
    } else {
      filters.push(`${vlabel}null[vout]`);
    }

    // 4) 音轨混音：有配音时把 BGM 压低垫底，配音按用户设置音量叠上
    const rawBgmVol = Number(spec.bgmVol);
    const rawVoiceVol = Number(spec.voiceVol);
    const vol = Math.min(1, Math.max(0, (Number.isFinite(rawBgmVol) ? rawBgmVol : 35) / 100));
    const voiceVol = Math.min(1.5, Math.max(0, (Number.isFinite(rawVoiceVol) ? rawVoiceVol : 100) / 100));
    if (voFile) {
      const duck = (vol * 0.5).toFixed(2); // 有人声时 BGM 再降一档
      filters.push(`[${bgmIdx}:a]volume=${duck},aformat=sample_rates=44100:channel_layouts=stereo[abgm]`);
      filters.push(`[${voIdx}:a]volume=${voiceVol.toFixed(2)},aformat=sample_rates=44100:channel_layouts=stereo[avo]`);
      filters.push(`[abgm][avo]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0[aout]`);
    } else {
      filters.push(`[${bgmIdx}:a]volume=${vol.toFixed(2)},aformat=sample_rates=44100:channel_layouts=stereo[aout]`);
    }

    args.push(
      '-filter_complex', filters.join(';'),
      '-map', '[vout]', '-map', '[aout]',
      '-t', String(duration),
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', outputPath,
    );

    // 5) 跑 ffmpeg
    if (process.env.RENDER_DEBUG) console.error('[render] ARGV=' + JSON.stringify(args));

    return await new Promise(resolve => {
      // stdin 忽略（双保险防挂起）、stdout 忽略、只读 stderr 解析进度
      const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', chunk => {
        const s = chunk.toString();
        stderr += s;
        const m = s.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          const secs = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
          onProgress(Math.min(99, (secs / duration) * 100));
        }
      });
      proc.on('error', err => resolve({ ok: false, error: String(err) }));
      proc.on('close', code => {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
        if (code === 0) {
          onProgress(100);
          resolve({ ok: true, outputPath });
        } else {
          resolve({ ok: false, error: `ffmpeg exited ${code}\n${stderr.slice(-1200)}` });
        }
      });
    });
  } catch (err) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
    return { ok: false, error: String(err && err.message || err) };
  }
}

module.exports = { composite, resolution, ffmpegPath };
