/* eslint-disable */
/**
 * 本机原生 ffmpeg 合成器（桌面端）。
 * 按服务器下发的 manifest 把「素材片段 → 拼接 → 烧录封面标题/口播 Hook → 混入 BGM」
 * 合成一条真实 MP4。素材 / BGM 通过 manifest 里的 url 现拉到临时目录再喂给 ffmpeg。
 *
 * manifest 字段缺失时优雅退化：
 *   - 没有素材片段 → 用纯色背景兜底，仍出片
 *   - 没有 BGM     → 用静音轨
 *   - 没有字体     → 不烧字
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

/** 找一个存在的系统字体给 drawtext 用；优先 CJK 字体，找不到则返回 null（退化为不烧字） */
function findFont() {
  const candidates = [
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf', // mac，含中文
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc', // linux CJK
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    'C:\\Windows\\Fonts\\msyh.ttc',                            // windows 微软雅黑
    'C:\\Windows\\Fonts\\arial.ttf',
  ];
  return candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

/** 取脚本第一行非标签文本作为 Hook */
function firstHook(script) {
  const lines = String(script || '').split('\n').map(s => s.trim());
  for (const l of lines) {
    if (l && !/^\[.*\]$/.test(l) && !/^scene\s/i.test(l)) return l;
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

const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|svg)(\?|$)/i;

/** 下载远端 url 到本地文件（桌面端与本机 express 同机，localhost 直连） */
async function downloadTo(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} -> ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

/**
 * 合成成片。
 * @param {object} manifest 服务器下发的渲染清单
 * @param {(pct:number)=>void} onProgress 进度回调（0-100）
 * @param {string} [outDir] 输出目录，默认系统临时目录
 * @returns {Promise<{ok:boolean, outputPath?:string, error?:string}>}
 */
async function composite(manifest, onProgress = () => {}, outDir) {
  if (!ffmpegPath) {
    return { ok: false, error: 'ffmpeg-static binary not found（请先 npm install ffmpeg-static）' };
  }

  const spec = (manifest && manifest.spec) || {};
  const duration = Math.max(1, Number(spec.duration) || 20);
  const [w, h] = resolution(spec.ratio);
  const font = findFont();
  const jobId = (manifest && manifest.jobId) || `job-${Date.now()}`;
  const dir = outDir || os.tmpdir();
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
      try { await downloadTo(u, dest); localClips.push({ file: dest, image: IMAGE_RE.test(u) }); } catch { /* 跳过失败片段 */ }
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

    if (process.env.RENDER_DEBUG) console.error(`[render] downloaded clips=${localClips.length} bgm=${bgmFile ? 'yes' : 'no'}`);

    // 2) 组装 ffmpeg 参数
    const n = localClips.length;
    const args = ['-hide_banner', '-nostdin']; // -nostdin：别等键盘输入，否则 spawn 的 stdin 管道会让 ffmpeg 永久挂起
    const filters = [];
    let vlabel;

    if (n > 0) {
      const seg = Math.max(1, duration / n);
      localClips.forEach(c => {
        if (c.image) args.push('-loop', '1', '-t', seg.toFixed(3), '-i', c.file);
        else args.push('-stream_loop', '-1', '-t', seg.toFixed(3), '-i', c.file); // 短片循环填满本段
      });
      localClips.forEach((_, i) => {
        // 先 scale 到「不超过目标」再居中铺底，规避 1×1 等退化尺寸把缩放器拖死；不足处用黑边 pad 填满
        filters.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x141A2E,setsar=1,fps=30,format=yuv420p[v${i}]`);
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

    // 3) 烧录标题 + Hook
    const title = (manifest && manifest.cover && manifest.cover.title) || '';
    const hook = firstHook(manifest && manifest.script);
    const titleFile = path.join(tmp, 'title.txt');
    const hookFile = path.join(tmp, 'hook.txt');
    fs.writeFileSync(titleFile, title, 'utf8');
    fs.writeFileSync(hookFile, hook, 'utf8');
    const dt = [];
    if (title) dt.push(drawtext({ font, textfile: titleFile, fontsize: Math.round(w / 16), y: 'h*0.10' }));
    if (hook) dt.push(drawtext({ font, textfile: hookFile, fontsize: Math.round(w / 26), y: 'h*0.80' }));
    filters.push(`${vlabel}${dt.length ? dt.join(',') : 'null'}[vout]`);

    // 4) 音轨混音：有配音时把 BGM 压低垫底，配音满音量叠上
    const vol = Math.min(1, Math.max(0, (Number(spec.bgmVol) || 35) / 100));
    if (voFile) {
      const duck = (vol * 0.5).toFixed(2); // 有人声时 BGM 再降一档
      filters.push(`[${bgmIdx}:a]volume=${duck},aformat=sample_rates=44100:channel_layouts=stereo[abgm]`);
      filters.push(`[${voIdx}:a]volume=1.0,aformat=sample_rates=44100:channel_layouts=stereo[avo]`);
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
