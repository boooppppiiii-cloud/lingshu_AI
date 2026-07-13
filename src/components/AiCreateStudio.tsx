import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutGrid, Film, FileText, Music, Image as ImageIcon, Play, Send,
  Check, ChevronLeft, ChevronRight, Folder, Search, Volume2, Globe,
  Mic, Download, Loader2, Sparkles, Wand2, Copy, RefreshCw, Clock,
  Upload, X, Plus, List, Save, FolderOpen, Trash2, Pause, ChevronDown, Heart, ExternalLink, Languages,
} from 'lucide-react';
import { studioApi, getDesktopRender, type StudioProject, type Material, type BgmTrack, type CoverStyle, type SubCue, type FbPosterResult } from '../lib/studioApi';
import type { Page } from '../App';
import { completeDemoStep } from '../lib/demoProgress';

/* ──────────────────────────────────────────────────────────────────────────
   AI 生成内容工作台 — 社媒（流量）页子模块
   流程：选模式 → 口播脚本 → 选素材 → 配乐 → 封面 → 成片预览
   两栏布局：① 步骤导航  ② 操作区
─────────────────────────────────────────────────────────────────────────── */

const TRAFFIC_GREEN = '#16a34a';
const CANVA_VIDEO_COVER_URL = 'https://www.canva.cn/create/video-covers/';
const CANVA_COVER_RETURN_KEY = 'ow_canva_cover_return';
const CANVA_COVER_RETURN_TTL = 6 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const mediaType = (f: File): 'video' | 'image' | 'audio' =>
  f.type.startsWith('video') ? 'video' : f.type.startsWith('audio') ? 'audio' : 'image';

const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = rej;
  r.readAsDataURL(f);
});

const blobToDataUrl = (blob: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = rej;
  r.readAsDataURL(blob);
});

const localFileName = (filePath: string) => filePath.split(/[\\/]/).pop() || filePath;

// 客户端读取视频时长，避免服务端依赖 ffprobe
const probeDuration = (f: File) => new Promise<number>(res => {
  if (!f.type.startsWith('video')) { res(0); return; }
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); res(Math.round(v.duration) || 0); };
  v.onerror = () => res(0);
  v.src = URL.createObjectURL(f);
});

const probeAudioDuration = (f: File) => new Promise<number>(res => {
  if (!f.type.startsWith('audio')) { res(0); return; }
  const a = document.createElement('audio');
  a.preload = 'metadata';
  a.onloadedmetadata = () => { URL.revokeObjectURL(a.src); res(Math.round(a.duration) || 0); };
  a.onerror = () => res(0);
  a.src = URL.createObjectURL(f);
});

const materialToClip = (m: Material): Clip => ({
  id: m.id, name: m.name, folder: m.folder, type: m.type, duration: m.duration, size: m.size, url: m.url, poster: m.poster, scope: m.scope ?? 'own',
});

type StepId = 'mode' | 'material' | 'script' | 'bgm' | 'cover' | 'preview';

const STEPS: { id: StepId; label: string; icon: typeof LayoutGrid; hint: string }[] = [
  { id: 'mode',     label: '选模式',  icon: LayoutGrid, hint: '选择生成起点与全局参数' },
  { id: 'script',   label: '口播脚本', icon: FileText,   hint: '提取口播、字幕与智能配音' },
  { id: 'material', label: '选素材',  icon: Film,       hint: '按脚本挑选并排序片段' },
  { id: 'bgm',      label: '配乐',     icon: Music,      hint: 'AI 推荐背景乐与音量平衡' },
  { id: 'cover',    label: '封面',     icon: ImageIcon,  hint: '生成封面候选并选定标题' },
  { id: 'preview',  label: '成片预览', icon: Play,       hint: '确认成片并进入剪映/发布' },
];
const COVER_STEP_INDEX = STEPS.findIndex(s => s.id === 'cover');

interface CanvaCoverReturnState {
  at: number;
  stepId: StepId;
  projectId: string | null;
  projectTitle: string;
  coverUrl: string | null;
  spec: Record<string, unknown>;
}

interface MaterialFolder { id: string; name: string; count: number }
const FOLDERS: MaterialFolder[] = [
  { id: 'recommend', name: '素材推荐', count: 0 },
  { id: 'all',     name: '全部素材',   count: 0 },
  { id: 'hot',     name: '爆款素材',   count: 0 },
  { id: 'upload',  name: '我的上传',   count: 0 },
  { id: 'presenter', name: '真人口播', count: 0 },
  { id: 'product', name: '产品主图',   count: 0 },
  { id: 'factory', name: '工厂实拍',   count: 0 },
  { id: 'scene',   name: '使用场景',   count: 0 },
  { id: 'model',   name: '模特出镜',   count: 0 },
  { id: 'detail',  name: '细节特写',   count: 0 },
];

interface Clip {
  id: string;
  name: string;
  folder: string;
  type: 'video' | 'image' | 'audio';
  duration: number; // seconds
  size: string;
  url?: string;     // 真实素材的可访问地址（mock 占位素材无此字段）
  poster?: string;  // 封面帧画面（视频抽帧 / 图片自身）
  scope?: 'shared' | 'own'; // 公共库 / 我的（缺省按 own）
}

interface ClipEdit {
  trimStart: number;
  trimEnd: number;
  speed: number;
  transition: string;
  note: string;
}
interface StoryboardSlot {
  id: string;
  time: string;
  start: number;
  end: number;
  title: string;
  detail: string;
}
const CLIPS: Clip[] = [];

interface Bgm { id: string; name: string; mood: string; duration: number; url?: string; recommended?: boolean }
// 已移除内置曲库（生成质量不达标）；仅展示用户自行上传的音乐
const BGMS: Bgm[] = [];
const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const fmtTime = (s: number) => `0:${String(Math.round(s)).padStart(2, '0')}`;

function pickMaterialClipsLocally(pool: Clip[], targetDuration: number, preferredIds: string[] = [], targetCount?: number) {
  const folderWeight: Record<string, number> = {
    presenter: 9,
    product: 8,
    detail: 7,
    scene: 6,
    factory: 5,
    model: 4,
    upload: 3,
  };
  const preferred = new Set(preferredIds);
  const ordered = [...pool].sort((a, b) => {
    const preferredDelta = Number(preferred.has(b.id)) - Number(preferred.has(a.id));
    if (preferredDelta) return preferredDelta;
    const typeDelta = Number(b.type === 'video') - Number(a.type === 'video');
    if (typeDelta) return typeDelta;
    const folderDelta = (folderWeight[b.folder] || 0) - (folderWeight[a.folder] || 0);
    if (folderDelta) return folderDelta;
    const aDur = a.type === 'image' ? 3 : a.duration || 0;
    const bDur = b.type === 'image' ? 3 : b.duration || 0;
    return Math.abs(aDur - targetDuration / 4) - Math.abs(bDur - targetDuration / 4);
  });
  const desiredCount = Math.max(1, Math.min(targetCount || 6, ordered.length || pool.length || 1));
  const picked: string[] = [];
  let total = 0;
  for (const clip of ordered) {
    if (picked.length >= desiredCount || (!targetCount && total >= targetDuration)) break;
    picked.push(clip.id);
    total += clip.type === 'image' ? 3 : Math.max(1, clip.duration || 3);
  }
  return {
    selectedIds: picked.length ? picked : pool.slice(0, desiredCount).map(clip => clip.id),
    reason: targetCount
      ? `按 ${targetCount} 个分镜匹配素材候选`
      : preferredIds.length ? '沿用已选素材并补齐镜头顺序' : '按真人/产品/细节/场景和目标时长快速排序',
  };
}

// 句子切分（中英日通用：按句末标点 / 换行）
const splitSentences = (text: string): string[] =>
  text.replace(/\s+/g, ' ').split(/(?<=[.!?。！？…])\s+/).map(s => s.trim()).filter(Boolean);

const subtitleCharLimit = (text: string) => /[\u4e00-\u9fff]/.test(text) ? 18 : 42;

function splitLongSubtitle(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const limit = subtitleCharLimit(normalized);
  if (normalized.length <= limit) return [normalized];

  const clauses = normalized
    .split(/(?<=[,，;；、:：.!?。！？…])\s*/)
    .map(item => item.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const clause of clauses.length > 1 ? clauses : [normalized]) {
    if ((current + clause).length <= limit) {
      current = current ? `${current} ${clause}` : clause;
      continue;
    }
    pushCurrent();
    if (clause.length <= limit) {
      current = clause;
      continue;
    }
    const words = clause.includes(' ') ? clause.split(/\s+/) : clause.match(new RegExp(`.{1,${limit}}`, 'g')) || [];
    for (const word of words) {
      if ((current ? `${current} ${word}` : word).length <= limit) {
        current = current ? `${current} ${word}` : word;
      } else {
        pushCurrent();
        current = word;
      }
    }
  }
  pushCurrent();
  return chunks;
}

// 把一段文本在 [start,end] 区间内按字数比例分配成多条单行 cue
function distribute(text: string, start: number, end: number): SubCue[] {
  const safeStart = Math.max(0, Number(start) || 0);
  const safeEnd = Math.max(safeStart + 0.3, Number(end) || safeStart + 0.3);
  const sents = splitSentences(text).flatMap(splitLongSubtitle);
  const total = sents.reduce((n, s) => n + Math.max(1, s.length), 0) || 1;
  let t = safeStart;
  return sents.map(s => {
    const dur = (safeEnd - safeStart) * (Math.max(1, s.length) / total);
    const cue = { start: +t.toFixed(2), end: +(t + dur).toFixed(2), text: s.replace(/\n+/g, ' ') };
    t += dur;
    return cue;
  });
}

function parseCueRange(value: string): { start: number; end: number } | null {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?/i);
  if (!match) return null;
  const start = Number(match[1]);
  const rawEnd = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(rawEnd)) return null;
  return { start: Math.max(0, start), end: Math.max(start + 0.3, rawEnd) };
}

function normalizeCueTimeline(cues: SubCue[], totalDur: number): SubCue[] {
  const clean = cues
    .map(cue => ({
      ...cue,
      start: Math.max(0, Number(cue.start) || 0),
      end: Math.max(Math.max(0, Number(cue.start) || 0) + 0.25, Number(cue.end) || 0),
      text: String(cue.text || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter(cue => cue.text);
  if (!clean.length) return [];
  let cursor = 0;
  const monotonic = clean.map(cue => {
    const start = Math.max(cursor, cue.start);
    const end = Math.max(start + 0.25, cue.end, cursor + 0.25);
    cursor = end;
    return { ...cue, start, end };
  });
  const sourceEnd = Math.max(...monotonic.map(cue => cue.end));
  const targetEnd = Math.max(0, Number(totalDur) || 0);
  const scale = targetEnd > 0 && sourceEnd > 0 && Math.abs(targetEnd - sourceEnd) > 0.8
    ? targetEnd / sourceEnd
    : 1;
  return monotonic.map(cue => ({
    ...cue,
    start: +(cue.start * scale).toFixed(2),
    end: +Math.max(cue.start * scale + 0.25, cue.end * scale).toFixed(2),
  }));
}

/* 由口播脚本生成字幕 cue（A 层兜底对齐：优先脚本时间标记，否则按 TTS 时长字数比例；
   桌面端 ASR 回传逐词时间戳后会替换为精确对齐——共用同一 SubCue 结构）。 */
function buildCues(script: string, totalDur: number): SubCue[] {
  const timestamped = parseTimestampedVoiceover(script).filter(item => !isNonSpeechSfx(item.text));
  if (timestamped.length) {
    const cues = timestamped.flatMap(item => {
      const range = parseCueRange(item.time);
      return range ? distribute(item.text, range.start, range.end) : [];
    });
    if (cues.length) return normalizeCueTimeline(cues, totalDur);
  }

  const lines = script.split('\n');
  // 形如 [Hook · 0-3s] / [Body · 3-15s] 的时间段标记
  const headerRe = /\[([^\]]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*)\]/i;
  const sections: { start: number; end: number; text: string }[] = [];
  let cur: { start: number; end: number; text: string } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(headerRe);
    if (m) {
      const range = parseCueRange(m[1] || '');
      if (range) {
        cur = { start: range.start, end: range.end, text: line.replace(m[0], '').trim() };
        sections.push(cur);
      }
    } else if (line && cur) {
      cur.text += (cur.text ? ' ' : '') + line.replace(/^\[.*?\]\s*/, '');
    }
  }
  if (sections.length && sections.some(s => s.text)) {
    return normalizeCueTimeline(sections.filter(s => s.text).flatMap(s => distribute(s.text, s.start, s.end)), totalDur);
  }
  // 无时间标记：清掉所有方括号标记后整体按时长分配
  const clean = script.replace(/\[[^\]]*\]/g, ' ').trim();
  return clean ? normalizeCueTimeline(distribute(clean, 0, totalDur || 20), totalDur || 20) : [];
}

function parseTimeRangeLabel(value: string): { label: string; start: number; end: number } | null {
  const normalized = value.replace(/秒/g, 's');
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*s?\s*[-–]\s*(\d+(?:\.\d+)?)\s*s?/i);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { label: `${match[1]}s-${match[2]}s`, start, end: Math.max(start + 0.5, end) };
}

function parseStoryboardSlots(value: string, totalDuration: number): StoryboardSlot[] {
  const lines = String(value || '').split('\n');
  const slots: StoryboardSlot[] = [];
  let current: { range: { label: string; start: number; end: number }; lines: string[] } | null = null;
  const push = () => {
    if (!current) return;
    const joined = current.lines.join(' ').replace(/\s+/g, ' ').trim();
    const title = joined.match(/(?:景别|Shot)\s*[：:]\s*([^；;。]+)/i)?.[1]
      || joined.match(/(?:画面|Visual)\s*[：:]\s*([^；;。]+)/i)?.[1]
      || joined.split(/[；;。]/)[0]
      || '分镜';
    slots.push({
      id: `slot-${slots.length + 1}`,
      time: current.range.label,
      start: current.range.start,
      end: current.range.end,
      title: title.trim().slice(0, 24),
      detail: joined || '按当前时间戳放入对应素材',
    });
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const bracket = line.match(/\[([^\]]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*)\]/i);
    const scene = line.match(/Scene\s+\d+\s*\(([^)]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^)]*)\)/i);
    const inline = !bracket && !scene ? parseTimeRangeLabel(line) : null;
    const range = bracket ? parseTimeRangeLabel(bracket[1]) : scene ? parseTimeRangeLabel(scene[1]) : inline;
    if (range) {
      push();
      current = { range, lines: [line.replace(bracket?.[0] || scene?.[0] || '', '').trim()].filter(Boolean) };
    } else if (current) {
      current.lines.push(line);
    }
  }
  push();

  if (slots.length) return slots.slice(0, 12);
  const cues = buildCues(value, totalDuration || 20).slice(0, 8);
  if (cues.length) {
    return cues.map((cue, index) => ({
      id: `slot-${index + 1}`,
      time: `${cue.start}s-${cue.end}s`,
      start: cue.start,
      end: cue.end,
      title: `口播分镜 ${index + 1}`,
      detail: cue.text,
    }));
  }
  const count = Math.max(4, Math.min(6, Math.ceil((totalDuration || 20) / 4)));
  return Array.from({ length: count }, (_, index) => {
    const start = Math.round(index * (totalDuration || 20) / count);
    const end = Math.round((index + 1) * (totalDuration || 20) / count);
    return { id: `slot-${index + 1}`, time: `${start}s-${end}s`, start, end, title: `分镜 ${index + 1}`, detail: '将素材拖到这里' };
  });
}

// 封面字体（系统字体栈，预览与 SVG 一致）
const COVER_FONTS: { id: CoverStyle['font']; label: string; css: string }[] = [
  { id: 'sans',    label: '黑体', css: `'PingFang SC','Microsoft YaHei',ui-sans-serif,sans-serif` },
  { id: 'impact',  label: '粗黑', css: `'Arial Black',Impact,'Heiti SC','Microsoft YaHei',sans-serif` },
  { id: 'serif',   label: '衬线', css: `Georgia,'Songti SC','SimSun',serif` },
  { id: 'rounded', label: '圆润', css: `'Arial Rounded MT Bold','PingFang SC','Microsoft YaHei',sans-serif` },
  { id: 'mono',    label: '等宽', css: `ui-monospace,Menlo,Consolas,monospace` },
];
const fontCss = (id: CoverStyle['font']) => COVER_FONTS.find(f => f.id === id)?.css ?? COVER_FONTS[0].css;

interface Voice { id: string; name: string; tag: string }
// 音色与语言解耦：名称只描述性别 + 音色，实际发音语言跟随所选目标语言
const VOICES: Voice[] = [
  { id: 'v1', name: 'Emma（女声 · 柔美）', tag: '亲和' },
  { id: 'v2', name: 'James（男声 · 沉稳）', tag: '浑厚' },
  { id: 'v3', name: 'Sara（女声 · 温暖）',  tag: '治愈' },
];

const COVERS = [
  { id: 'cv1', title: 'You NEED this in 2026', accent: '#16a34a' },
  { id: 'cv2', title: 'Factory price, 24h ship', accent: '#16a34a' },
  { id: 'cv3', title: 'Why everyone is obsessed', accent: '#c13584' },
];

interface SocialAccount { id: string; platform: string; handle: string; color: string }
const ACCOUNTS: SocialAccount[] = [
  { id: 'a1', platform: 'TikTok',    handle: '@yiwu_home',     color: '#010101' },
  { id: 'a2', platform: 'Instagram', handle: '@yiwu.official', color: '#c13584' },
  { id: 'a3', platform: 'YouTube',   handle: 'Yiwu Trading',   color: '#ff0000' },
];

type ModeCard = { id: 'material' | 'clone' | 'product'; icon: typeof Film; title: string; desc: string };
const MODES: ModeCard[] = [
  { id: 'material', icon: Film,    title: '素材库智能生成', desc: '挑选本地素材，AI 智能编排成视频素材' },
  { id: 'clone',    icon: Wand2,   title: '爆款素材迭代',   desc: '复用已分析爆款的结构、节奏和素材表达' },
  { id: 'product',  icon: Sparkles,title: '产品信息生成',   desc: '输入商品信息，一键生成视频素材脚本和画面 brief' },
] as const;
const POSTER_MODES: ModeCard[] = [
  { id: 'clone',    icon: Wand2,   title: '爆款图文迭代', desc: '抓取参考海报，复用其信息架构、视觉风格和转化话术' },
  { id: 'material', icon: Film,    title: '素材库选择',   desc: '选择产品实拍、工厂图和证书素材，生成高质感 B2B 海报' },
  { id: 'product',  icon: Sparkles,title: '产品信息生成', desc: '从企业中心产品资料出发，自动生成海报文案和配图 brief' },
] as const;
const POSTER_MODE_GUIDES: Record<'material' | 'clone' | 'product', { source: string; iterate: string; confirm: string }> = {
  clone: {
    source: '主要吃竞品/爆款海报的结构信息：标题句式、模块顺序、视觉风格、CTA 和配文框架。',
    iterate: 'AI 复用爆款的表达方式，再回填企业中心里的真实产品线、公司名和供应链能力。',
    confirm: 'MOQ、认证、交期、出口国家、工厂资质必须来自企业中心或由用户确认，不能凭空生成。',
  },
  material: {
    source: '主要吃素材库里的产品图、工厂图、包装图、证书图和使用场景图。',
    iterate: 'AI 根据素材判断更适合做工厂背书图、产品矩阵图还是私标招商图，再补齐海报文案。',
    confirm: '用户需要确认本次选用的 1-4 张产品/工厂参考图，以及哪些证书或工厂能力可以公开展示。',
  },
  product: {
    source: '主要吃企业中心资料：产品类目、MOQ、认证、目标客户、卖点、出口市场。',
    iterate: '适合没准备爆款参考和素材时，先生成海报 brief、FB/IG caption，再引导用户补图。',
    confirm: '商业承诺类字段必须确认后再进入海报 JSON，包括价格、MOQ、交期、认证和出口国家。',
  },
};
const POSTER_STYLES = [
  { id: 'oem-factory', label: 'OEM 工厂风' },
  { id: 'promo', label: '促销招商风' },
  { id: 'holiday', label: '节日营销风' },
  { id: 'premium', label: '高端品牌风' },
] as const;

const PLATFORMS = [
  { id: 'tiktok',    label: 'TikTok',    ratio: '9:16' },
  { id: 'instagram', label: 'Instagram', ratio: '9:16' },
  { id: 'youtube',   label: 'YouTube',   ratio: '16:9' },
  { id: 'facebook',  label: 'Facebook',  ratio: '9:16' },
];
const RATIOS = ['9:16', '1:1', '16:9'];
const POSTER_RATIOS = ['1:1', '4:5'];
const LANGS = [
  { code: 'en',    label: 'English - 英语' },
  { code: 'zh',    label: '简体中文 - 中文' },
  { code: 'es',    label: 'Español - 西班牙语' },
  { code: 'fr',    label: 'Français - 法语' },
  { code: 'de',    label: 'Deutsch - 德语' },
  { code: 'pt',    label: 'Português - 葡萄牙语' },
  { code: 'it',    label: 'Italiano - 意大利语' },
  { code: 'ru',    label: 'Русский - 俄语' },
  { code: 'ja',    label: '日本語 - 日语' },
  { code: 'ko',    label: '한국어 - 韩语' },
  { code: 'ar',    label: 'العربية - 阿拉伯语' },
  { code: 'hi',    label: 'हिन्दी - 印地语' },
  { code: 'id',    label: 'Bahasa Indonesia - 印尼语' },
  { code: 'th',    label: 'ภาษาไทย - 泰语' },
  { code: 'vi',    label: 'Tiếng Việt - 越南语' },
  { code: 'tr',    label: 'Türkçe - 土耳其语' },
  { code: 'nl',    label: 'Nederlands - 荷兰语' },
  { code: 'pl',    label: 'Polski - 波兰语' },
  { code: 'sv',    label: 'Svenska - 瑞典语' },
  { code: 'fil',   label: 'Filipino - 菲律宾语' },
  { code: 'ms',    label: 'Bahasa Melayu - 马来语' },
  { code: 'uk',    label: 'Українська - 乌克兰语' },
  { code: 'el',    label: 'Ελληνικά - 希腊语' },
  { code: 'cs',    label: 'Čeština - 捷克语' },
  { code: 'ro',    label: 'Română - 罗马尼亚语' },
  { code: 'hu',    label: 'Magyar - 匈牙利语' },
];
// 取语言的中文名（label 形如 "Deutsch - 德语" → "德语"）
const langZh = (code: string) => {
  const label = LANGS.find(l => l.code === code)?.label ?? '';
  return label.split(' - ')[1] ?? label;
};

const LANG_ALIASES: Record<string, string> = {
  英语: 'en', english: 'en', en: 'en',
  中文: 'zh', 简体中文: 'zh', chinese: 'zh', zh: 'zh',
  西语: 'es', 西班牙语: 'es', spanish: 'es', es: 'es',
  法语: 'fr', french: 'fr', fr: 'fr',
  德语: 'de', german: 'de', de: 'de',
  葡语: 'pt', 葡萄牙语: 'pt', portuguese: 'pt', pt: 'pt',
  意大利语: 'it', italian: 'it', it: 'it',
  俄语: 'ru', russian: 'ru', ru: 'ru',
  日语: 'ja', japanese: 'ja', ja: 'ja',
  韩语: 'ko', korean: 'ko', ko: 'ko',
  阿语: 'ar', 阿拉伯语: 'ar', arabic: 'ar', ar: 'ar',
  印地语: 'hi', hindi: 'hi', hi: 'hi',
  印尼语: 'id', 印度尼西亚语: 'id', indonesian: 'id', id: 'id',
  泰语: 'th', thai: 'th', th: 'th',
  越南语: 'vi', vietnamese: 'vi', vi: 'vi',
  土耳其语: 'tr', turkish: 'tr', tr: 'tr',
  荷兰语: 'nl', dutch: 'nl', nl: 'nl',
  波兰语: 'pl', polish: 'pl', pl: 'pl',
};

function languageTextToCode(text = '') {
  const first = text.split(/[、,，/|;；\s]+/).map(s => s.trim()).find(Boolean) ?? '';
  const normalized = first.toLowerCase();
  return LANG_ALIASES[first] ?? LANG_ALIASES[normalized] ?? 'en';
}

interface EnterpriseProfileLite {
  company?: { industry?: string; mainMarkets?: string; primaryLanguages?: string };
  products?: {
    categories?: string;
    priceRange?: string;
    moq?: string;
    certifications?: string;
    highlights?: string;
    items?: Array<{
      name?: string;
      category?: string;
      priceRange?: string;
      moq?: string;
      certifications?: string;
      highlights?: string;
    }>;
  };
  brand?: { tone?: string; usp?: string; preferredLanguages?: string };
  strategy?: { focusProducts?: string; focusMarkets?: string };
  customers?: { targetProfiles?: string };
}

interface VideoKickoff {
  source?: 'inspiration_analysis' | 'seedance_video' | string;
  script?: string;
  scriptType?: 'voiceover' | 'storyboard';
  language?: string;
  productInfo?: string;
  referenceAnalysis?: {
    title?: string;
    visualStyle?: string;
    coreEmotion?: string;
    details?: { time: string; environment?: string; shot: string; camera: string; visual: string; subtitle?: string; audio?: string; note?: string }[];
  };
  generatedVideo?: {
    id?: string;
    title?: string;
    url?: string;
    poster?: string;
    duration?: number;
    createdAt?: string;
    material?: Material;
  };
  video?: {
    title?: string;
    platform?: string;
    videoUrl?: string;
    thumbnail?: string;
    duration?: number;
    aiAnalysis?: { materialUrl?: string; materialPoster?: string };
  };
}

interface ProductOption { id: string; label: string; info: string }
interface ModeScriptOutput { id: string; title: string; script: string; mode: 'material' | 'product' | 'clone' }
type EnterpriseProductItem = NonNullable<NonNullable<EnterpriseProfileLite['products']>['items']>[number];

const compact = (value?: string) => String(value || '').trim();
const PLACEHOLDER_PRODUCT_RE = /^(主推产品|this product|企业产品组合)$/i;
const modeScriptNumber = (item: ModeScriptOutput, fallbackIndex = 0): number => {
  const match = item.title.match(/脚本\s*(\d+)/);
  return match ? Number(match[1]) || fallbackIndex + 1 : fallbackIndex + 1;
};
const uniqueLangs = (primary: string, count: number) => {
  const base = [primary, 'en', 'es', 'ar', 'pt', 'id', 'fr', 'de'].filter(Boolean);
  return Array.from(new Set(base)).slice(0, Math.max(1, count));
};

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      value => {
        window.clearTimeout(timer);
        resolve(value);
      },
      error => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function formatSelectedProductInfo(options: ProductOption[]): string {
  return options.map((option, index) => [
    options.length > 1 ? `选定产品 ${index + 1}：${option.label}` : '',
    option.info,
  ].filter(Boolean).join('\n')).join('\n\n');
}

function selectedProductLabel(productInfo: string): string {
  const names = Array.from(String(productInfo || '').matchAll(/产品名称[：:]\s*([^\n]+)/g))
    .map(match => compact(match[1]))
    .filter(name => name && !PLACEHOLDER_PRODUCT_RE.test(name));
  if (names.length) return names.join(' + ');
  const brief = parseProductBrief(productInfo);
  return brief.name && !PLACEHOLDER_PRODUCT_RE.test(brief.name) ? brief.name : '';
}

function productOptionFromInfo(info: string, id = 'kickoff-product'): ProductOption | null {
  const label = selectedProductLabel(info);
  if (!label) return null;
  return { id, label, info: String(info || '').trim() };
}

function buildAiProductOptions(profile: EnterpriseProfileLite): ProductOption[] {
  const categories = compact(profile.products?.categories);
  const fallbackNames = compact(profile.strategy?.focusProducts || categories)
    .split(/[、,，\n]/)
    .map(item => item.trim())
    .filter(Boolean);
  const rawItems: EnterpriseProductItem[] = profile.products?.items?.length
    ? profile.products.items
    : fallbackNames.map(name => ({ name }));
  return rawItems
    .map((item, index) => {
      const name = compact(item.name);
      if (!name || /^产品\d+$/.test(name)) return null;
      const category = compact(item.category || categories);
      const highlights = compact(item.highlights || profile.products?.highlights || profile.brand?.usp);
      const price = compact(item.priceRange || profile.products?.priceRange);
      const moq = compact(item.moq || profile.products?.moq);
      const certifications = compact(item.certifications || profile.products?.certifications);
      return {
        id: `product-${index}-${name}`,
        label: name,
        info: [
          `产品名称：${name}`,
          category ? `所属类目：${category}` : '',
          highlights ? `产品卖点：${highlights}` : '',
          price ? `价格区间：${price}` : '',
          moq ? `起订量：${moq}` : '',
          certifications ? `认证资质：${certifications}` : '',
        ].filter(Boolean).join('\n'),
      };
    })
    .filter(Boolean) as ProductOption[];
}

function parseProductBrief(productInfo: string) {
  const lines = String(productInfo || '').split('\n').map(line => line.trim()).filter(Boolean);
  const pick = (label: string) => {
    const line = lines.find(item => item.startsWith(`${label}：`) || item.startsWith(`${label}:`));
    return compact(line?.replace(new RegExp(`^${label}[：:]\\s*`), ''));
  };
  const firstProductName = Array.from(String(productInfo || '').matchAll(/产品名称[：:]\s*([^\n]+)/g))
    .map(match => compact(match[1]))
    .filter(Boolean)
    .join(' + ');
  const first = compact(lines[0]?.replace(/^[^：:]+[：:]\s*/, ''));
  return {
    name: firstProductName || pick('产品名称') || pick('主推品') || first || '主推产品',
    category: pick('所属类目') || pick('产品类目') || '待补充类目',
    highlights: pick('产品卖点') || pick('核心优势') || '待补充真实卖点',
    price: pick('价格区间'),
    moq: pick('起订量'),
    certifications: pick('认证资质'),
  };
}

function compactCategory(product: ReturnType<typeof parseProductBrief>): string {
  const name = compact(product.name);
  const items = compact(product.category).split(/[、,，/]/).map(item => item.trim()).filter(Boolean);
  if (name && items.some(item => name.includes(item) || item.includes(name))) return name;
  return items[0] || name || '产品';
}

function buyerPainForProduct(product: ReturnType<typeof parseProductBrief>): string {
  const text = `${product.name} ${product.category} ${product.highlights}`.toLowerCase();
  if (/灯|照明|light|lighting|轨道|筒灯|线性|庭院|调光/.test(text)) {
    return '订购一大批灯具，结果现场亮度、色温和图文效果严重不符';
  }
  if (/包装|袋|盒|纸|paper|bag|box|package/.test(text)) {
    return '下单后才发现包装材质、尺寸和印刷效果跟样图不一样';
  }
  if (/美妆|护肤|cream|serum|cosmetic|skincare/.test(text)) {
    return '选品时只看图片，结果质地、包装和市场卖点都对不上';
  }
  return `批量采购${compactCategory(product)}，最怕样品看着可以，大货效果和描述不一致`;
}

function sceneEnvironmentForProduct(product: ReturnType<typeof parseProductBrief>, index: number): string {
  const text = `${product.name} ${product.category}`.toLowerCase();
  const lighting = /灯|照明|light|lighting|轨道|筒灯|线性|庭院|调光/.test(text);
  if (lighting) {
    return [
      '现代简约室内展厅，白墙和木色桌面，顶部已安装一段轨道灯',
      '半暗室内样板间，墙面保留一块明暗对比区域',
      '安装台面旁，样品、驱动、电源线和参数卡整齐摆放',
      '工程客户选型桌面，色温样品、外壳色卡和包装标签并排',
      '工厂老化测试架或样品打包台，背景能看到成排灯具点亮',
    ][index] || '真实产品演示场景';
  }
  return [
    '干净桌面实拍场景，产品和采购资料放在同一画面',
    '近距离样品展示台，手边放着规格卡和包装样',
    '简单对比测试台，保留一个普通款作为参照',
    '定制选项展示桌，颜色、尺寸、包装或 logo 样并排',
    '样品打包台或询盘电脑旁，画面收束到留言动作',
  ][index] || '真实产品演示场景';
}

function cloneReferenceAnalysisText(kickoff: VideoKickoff): string {
  const ref = kickoff.referenceAnalysis;
  if (!ref) return '';
  const details = (ref.details || [])
    .map(item => [
      `[${item.time}]`,
      item.environment ? `环境：${item.environment}` : '',
      item.visual ? `画面：${item.visual}` : '',
      item.shot ? `景别：${item.shot}` : '',
      item.camera ? `运镜：${item.camera}` : '',
      item.audio ? `配乐：${item.audio}` : '',
      item.subtitle ? `字幕：${item.subtitle}` : '',
      item.note ? `备注：${item.note}` : '',
    ].filter(Boolean).join('；'))
    .join('\n');
  return [
    ref.visualStyle ? `结构风格：${ref.visualStyle}` : '',
    ref.coreEmotion ? `情绪节奏：${ref.coreEmotion}` : '',
    details ? `对标视频脚本详析（必须逐段依据，时间/环境/景别/运镜/配乐/动作节奏优先保持）：\n${details}` : '',
  ].filter(Boolean).join('\n\n');
}

function cloneReferenceHighlights(kickoff: VideoKickoff): string[] {
  const ref = kickoff.referenceAnalysis;
  const out = [
    ref?.visualStyle ? `画风：${ref.visualStyle}` : '',
    ref?.coreEmotion ? `情绪：${ref.coreEmotion}` : '',
    ...(ref?.details || []).slice(0, 12).map(item => `${item.time} ${item.environment || ''} ${item.shot}/${item.camera}：${item.visual || item.note || item.subtitle || '按原分镜动作节奏复刻'}`),
  ].filter(Boolean);
  return out.length ? out : ['复刻对标视频的开头钩子、情绪节奏、镜头关系和转化 CTA。'];
}

function adaptReferenceVisualToProduct(visual: string, product: ReturnType<typeof parseProductBrief>): string {
  const productObject = `${compactCategory(product)}产品`;
  const productName = product.name && product.name !== productObject ? product.name : productObject;
  let next = compact(visual) || `展示${productName}的外观、细节和实际效果`;
  next = next
    .replace(/护肤美妆纸艺品（[^）]*）/g, `${productObject}纸艺品`)
    .replace(/护肤美妆纸艺品\([^)]*\)/g, `${productObject}纸艺品`)
    .replace(/护肤美妆产品|护肤品|美妆品|美妆产品|眼膜|唇膏|面霜|安瓶|指甲油|蒸笼/g, productObject)
    .replace(/饺子造型的[^，。；;]*?(?:纸艺品|产品)/g, `饺子造型的${productObject}纸艺品`)
    .replace(/多个[^，。；;]*?(?:产品|纸艺品)/, `多个${productObject}纸艺品`)
    .replace(/一双[^，。；;]*?手/g, '一双手')
    .replace(/粉色大饺子/g, `粉色${productObject}`)
    .replace(/可爱的饺子造型纸艺品/g, `可爱的${productObject}纸艺品`);
  if (!next.includes(productObject) && !next.includes(product.name)) {
    next = next.replace(/画面中出现/, `画面中出现${productName}，`);
  }
  return next;
}

function buildLocalCloneScript(kickoff: VideoKickoff, productInfo: string, languageCode: string, variant = 0): string {
  const product = parseProductBrief(productInfo);
  const details = (kickoff.referenceAnalysis?.details?.length ? kickoff.referenceAnalysis.details : []).slice(0, 12);
  const highlights = compact(product.highlights).split(/[、,，;；\n]/).map(item => item.trim()).filter(Boolean);
  const points = [
    ...highlights,
    product.moq ? `起订量 ${product.moq}` : '',
    product.certifications ? `认证资质 ${product.certifications}` : '',
    product.price ? `价格区间 ${product.price}` : '',
  ].filter(Boolean);
  const primaryPoint = points[0] || product.highlights || product.category || product.name;
  const trustPoint = points.find(point => /认证|CE|RoHS|ETL|BSCI|REACH|UKCA|IP\d+/i.test(point)) || product.certifications || '样品和资料可确认';
  const naturalTrustPoint = trustPoint && trustPoint !== '样品和资料可确认' ? '认证和检测资料能不能一次给齐' : '样品和资料能不能按需求确认';
  const category = compactCategory(product);
  const pain = buyerPainForProduct(product);
  const hookVariants = [
    {
      pain,
      subtitle: '拒绝照骗，所见即所得',
      proof: `客户真正要确认的不是宣传图，是${primaryPoint}能不能在现场看得出来。`,
      test: '不确定大货会不会翻车？先用这个动作打样测试，再谈批量订单。',
      cta: `${trustPoint}，把数量、目标市场和包装要求发我，我给你整理报价和打样方案。`,
    },
    {
      pain: `样品看着不错，批量交付时${primaryPoint}却对不上项目要求`,
      subtitle: '样品到大货，别踩坑',
      proof: `这一段直接拍${primaryPoint}，让买家先确认可见标准，再谈订单。`,
      test: '我们把测试动作拍清楚，你不用只靠参数表判断供应商。',
      cta: `把项目清单和目标市场发来，我按${trustPoint}帮你整理确认项。`,
    },
    {
      pain: `客户问完价格，最后真正担心的是${naturalTrustPoint}`,
      subtitle: '先确认关键资料',
      proof: `先把${primaryPoint}和资料页放同框，采购判断会快很多。`,
      test: '同一个角度对比实物和资料，哪些地方能定制一眼就清楚。',
      cta: '把数量、规格和包装标签要求发来，我给你拆成报价和打样步骤。',
    },
    {
      pain: `低价供应商很多，但买家怕的是效果、资料和交付口径不一致`,
      subtitle: '低价之外，看交付确定性',
      proof: `${primaryPoint}不要只写在卖点里，要让镜头拍到可验证细节。`,
      test: '先拍一次真实测试，再决定是否进入大货沟通。',
      cta: `需要${category}方案的话，发项目需求，我按样品、资料和包装给你回。`,
    },
  ];
  const variantPlan = hookVariants[Math.abs(variant) % hookVariants.length]!;
  if (details.length) {
    return details.map((item, index) => {
      const time = `[${item.time || `${index * 4}-${(index + 1) * 4}s`}]`;
      const visual = adaptReferenceVisualToProduct(item.visual || item.note || '', product);
      const voice = index === 0
        ? `${variantPlan.pain}？先看这个真实效果。`
        : index === details.length - 1
          ? variantPlan.cta
          : [variantPlan.proof, variantPlan.test, `这一段重点看实物效果，别只看宣传图和参数表。`][index % 3];
      const subtitle = index === 0
        ? variantPlan.subtitle
        : index === details.length - 1
          ? '发需求，拿报价和样品方案'
          : compact(points[index % Math.max(1, points.length)] || primaryPoint).slice(0, 28);
      if (languageCode === 'zh') {
        return [
          time,
          `环境：${item.environment || '白色桌面'}；`,
          `景别：${item.shot || '中景'}；`,
          `运镜：${item.camera || '固定镜头'}；`,
          `画面：${visual}。`,
          `配乐：${item.audio || '沿用原视频节奏音效'}；`,
          `台词：${voice}`,
          `字幕：${subtitle}`,
        ].join('\n');
      }
      return [
        time,
        `Environment: ${item.environment || 'white tabletop'}`,
        `Shot: ${item.shot || 'medium shot'}`,
        `Camera: ${item.camera || 'static camera'}`,
        `Visual: ${visual}.`,
        `Music: ${item.audio || 'match the reference rhythm'}`,
        `Voiceover: "${index === 0 ? `Ordering bulk ${category}, but the real result does not match the picture? Check the real effect first.` : index === details.length - 1 ? 'Send your quantity, market, and packaging needs for a quote and sample plan.' : `Use this shot to verify ${points[index % Math.max(1, points.length)] || primaryPoint} before bulk order.`}"`,
        `Subtitle: ${subtitle}`,
      ].join('\n');
    }).join('\n\n');
  }
  const defaultTimes = ['0-5s', '5-9s', '9-13s', '13-17s', '17-20s'];
  const scenePlans = [
    {
      role: '开场钩子',
      environment: sceneEnvironmentForProduct(product, 0),
      shot: '中景',
      camera: '固定镜头直拍',
      visual: '人物站在样板间或展示台旁，先指向实际点亮/使用效果，再转头对镜头自然发问',
      music: '口播 + 舒缓递进，开头保留半秒停顿制造问题感',
      voice: humanizeVoiceLine(`${variantPlan.pain}？我们拒绝照骗，所见即所得！`),
      subtitle: variantPlan.subtitle,
    },
    {
      role: '核心证明',
      environment: sceneEnvironmentForProduct(product, 1),
      shot: '近景',
      camera: '缓慢推进到产品细节',
      visual: `手部把「${product.name}」移到镜头前，切到${primaryPoint}对应的可见细节或实际效果`,
      music: '口播 + 轻节奏鼓点，细节出现时轻微加强',
      voice: humanizeVoiceLine(variantPlan.proof),
      subtitle: primaryPoint,
    },
    {
      role: '对比测试',
      environment: sceneEnvironmentForProduct(product, 2),
      shot: '特写',
      camera: '俯拍固定，动作完成后停留 1 秒',
      visual: `把普通款/图片参数和「${product.name}」实物放在一起，做一次开合、点亮、安装、按压或效果对比`,
      music: '口播 + 短促转场音，对比瞬间降低背景音',
      voice: humanizeVoiceLine(variantPlan.test),
      subtitle: '先打样，再批量',
    },
    {
      role: '定制选项',
      environment: sceneEnvironmentForProduct(product, 3),
      shot: '中近景',
      camera: '横向平移扫过选项',
      visual: '把不同规格、色温/颜色、外壳、包装标签或 logo 位置排开，手指逐一指出可定制项',
      music: '口播 + 稳定节奏，配合手指移动做轻快切点',
      voice: '你的市场需要什么规格和包装，不用照搬库存款，可以按项目需求确认。',
      subtitle: '规格 / 包装 / LOGO',
    },
    {
      role: '采购信息',
      environment: sceneEnvironmentForProduct(product, 4),
      shot: '中景',
      camera: '固定镜头，最后轻推到资料页或询盘窗口',
      visual: `展示样品、资料页或包装箱，屏幕短字幕放 MOQ、认证、报价和打样信息，最后停在询盘动作`,
      music: '口播 + 收束感配乐，结尾留出 CTA 停顿',
      voice: humanizeVoiceLine(variantPlan.cta),
      subtitle: [product.moq ? `MOQ ${product.moq}` : '', product.certifications ? '认证资料可确认' : '参数可确认'].filter(Boolean).join(' / '),
    },
  ];
  return scenePlans.map((plan, index) => {
    const item = details[index];
    const time = `[${defaultTimes[index] || `${index * 4}-${(index + 1) * 4}s`}]`;
    const point = points[index % Math.max(1, points.length)] || product.category || product.name;
    const visual = plan.visual;
    const voice = humanizeVoiceLine(plan.voice.replace(primaryPoint, point || primaryPoint));
    if (languageCode === 'zh') {
      return [
        `${time}`,
        `环境：${plan.environment}；`,
        `景别：${plan.shot}；`,
        `运镜：${plan.camera}；`,
        `画面：${visual}。`,
        `配乐：${plan.music}；`,
        `台词：${voice}`,
        `字幕：${plan.subtitle}`,
      ].join('\n');
    }
    return [
      `${time}`,
      `Environment: ${plan.environment}`,
      `Shot: ${plan.shot}`,
      `Camera: ${plan.camera}`,
      `Visual: ${visual}.`,
      `Music: ${plan.music}`,
      `Voiceover: "${index === 0 ? `Ordering bulk ${category}, but the real effect does not match the pictures? We show what you actually get.` : index === scenePlans.length - 1 ? 'Send your quantity, market, and packaging needs for a quote and sample plan.' : `This shot helps your buyer verify ${point} before bulk order.`}"`,
      `Subtitle: ${plan.subtitle}`,
    ].join('\n');
  }).join('\n\n');
}

function isStandardCloneStoryboard(value: string): boolean {
  const text = String(value || '');
  if (!text.trim()) return false;
  const required = ['环境', '景别', '运镜', '画面', '配乐', '台词', '字幕'];
  const hasAllFields = required.every(label => new RegExp(`${label}[：:]`).test(text));
  const oldSparseFormat = /人物说[：:]|采购这类|真实使用场景|痛点特写|买家最关心的结果|先看真实使用效果|把「[^」]+」放到真实使用场景/.test(text);
  return hasAllFields && !oldSparseFormat && !hasUnnaturalVoiceover(text);
}

function ensureStandardCloneStoryboard(value: string, kickoff: VideoKickoff, productInfo: string, languageCode: string, strictProductName?: string): { script: string; normalized: boolean } {
  const sanitized = sanitizeStoryboardScript(value, productInfo, strictProductName).trim();
  if (isStandardCloneStoryboard(sanitized)) return { script: sanitized, normalized: false };
  return {
    script: sanitizeStoryboardScript(buildLocalCloneScript(kickoff, productInfo, languageCode), productInfo, strictProductName).trim(),
    normalized: true,
  };
}

function cloneScriptSimilarity(a: string, b: string): number {
  const grams = (value: string) => {
    const normalized = compactComparable(value)
      .replace(/脚本\d+|当前|环境|景别|运镜|画面|配乐|台词|字幕/g, '');
    const out = new Set<string>();
    for (let i = 0; i < Math.max(1, normalized.length - 1); i += 1) out.add(normalized.slice(i, i + 2));
    return out;
  };
  const left = grams(a);
  const right = grams(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  left.forEach(item => { if (right.has(item)) overlap += 1; });
  return overlap / Math.max(left.size, right.size);
}

function isDuplicateCloneScript(candidate: string, existingScripts: string[]): boolean {
  return existingScripts.some(item => cloneScriptSimilarity(candidate, item) > 0.82);
}

function ensureDistinctCloneStoryboard(input: {
  script: string;
  kickoff: VideoKickoff;
  productInfo: string;
  languageCode: string;
  strictProductName?: string;
  existingScripts: string[];
  variantSeed: number;
}) {
  let normalized = ensureStandardCloneStoryboard(input.script, input.kickoff, input.productInfo, input.languageCode, input.strictProductName);
  if (!isDuplicateCloneScript(normalized.script, input.existingScripts)) return normalized;

  for (let offset = 1; offset <= 6; offset += 1) {
    const variantScript = sanitizeStoryboardScript(
      buildLocalCloneScript(input.kickoff, input.productInfo, input.languageCode, input.variantSeed + offset),
      input.productInfo,
      input.strictProductName,
    ).trim();
    if (!isDuplicateCloneScript(variantScript, input.existingScripts)) {
      return { script: variantScript, normalized: true };
    }
    normalized = { script: variantScript, normalized: true };
  }
  return normalized;
}

function buildLocalProductScript(productInfo: string, languageCode: string, totalDuration = 20): string {
  const product = parseProductBrief(productInfo);
  const highlights = compact(product.highlights).split(/[、,，;；\n]/).map(item => item.trim()).filter(Boolean);
  const points = [
    highlights[0] || product.category,
    highlights[1] || product.certifications || '品质稳定',
    product.moq || product.price || '可按需求确认规格',
    '询盘后给出打样和报价方案',
  ].filter(Boolean);
  const scenes = [
    {
      time: `0.0s-${Math.min(3, totalDuration).toFixed(1)}s`,
      scene: '买家痛点场景',
      visual: `把「${product.name}」放进真实采购场景，先展示买家最关心的使用结果。`,
      voice: `如果你正在找${product.name}，先看它解决的这个场景问题。`,
      subtitle: '先看使用场景',
    },
    {
      time: `3.0s-${Math.min(8, totalDuration).toFixed(1)}s`,
      scene: '卖点具象化',
      visual: `用手部近景展示${points[0]}，让卖点落到一个可见细节上。`,
      voice: `这一段重点看${points[0]}，这是客户下单前最容易判断的点。`,
      subtitle: String(points[0]),
    },
    {
      time: `8.0s-${Math.min(14, totalDuration).toFixed(1)}s`,
      scene: '信任证明',
      visual: `展示样品、包装、规格、认证或细节对比，证明${points[1]}。`,
      voice: `${points[1]}可以通过样品和资料一起确认，不用只看图片判断。`,
      subtitle: String(points[1]),
    },
    {
      time: `${Math.min(14, totalDuration - 4).toFixed(1)}s-${totalDuration.toFixed(1)}s`,
      scene: '询盘转化',
      visual: `收束到规格、数量、包装或留言动作，提示买家发需求。`,
      voice: `把数量、规格和包装要求发我，我给你整理报价和打样方案。`,
      subtitle: '发需求拿方案',
    },
  ];
  return scenes.map(item => [
    `[${item.time}]`,
    `产品卖点理解：${item.scene}`,
    `场景化表达：${item.visual}`,
    `人物说：“${item.voice}”`,
    `字幕：${item.subtitle}`,
  ].join('\n')).join('\n\n');
}

function buildLocalMaterialScript(materialsList: Clip[], selectedIds: string[], productInfo: string, totalDuration = 20): string {
  const product = parseProductBrief(productInfo);
  const selectedMaterials = selectedIds.length
    ? materialsList.filter(item => selectedIds.includes(item.id))
    : materialsList.filter(item => item.type !== 'audio').slice(0, 4);
  const usable = selectedMaterials.length ? selectedMaterials : [{ name: '当前产品素材', folder: 'product', type: 'video', duration: totalDuration } as Clip];
  const slotDur = Math.max(2, totalDuration / Math.max(1, usable.length));
  return usable.slice(0, 6).map((clip, index) => {
    const start = +(index * slotDur).toFixed(1);
    const end = +(index === usable.length - 1 ? totalDuration : (index + 1) * slotDur).toFixed(1);
    const materialRole = clip.folder === 'presenter' ? '真人口播素材'
      : clip.folder === 'detail' ? '产品细节素材'
      : clip.folder === 'factory' ? '工厂/实力素材'
      : clip.folder === 'scene' ? '场景使用素材'
      : clip.folder === 'model' ? '模特/效果素材'
      : '产品展示素材';
    const voice = index === 0
      ? `先看这段素材里最能说明${product.name}真实用途的地方。`
      : index === usable.length - 1
        ? `如果你要确认数量、规格或包装，可以直接把需求发我。`
        : `这一段素材重点证明${product.highlights || product.category || product.name}。`;
    return [
      `[${start}-${end}s]`,
      `素材理解：${materialRole}《${clip.name}》，优先使用它已有的画面信息，不凭空新增场景。`,
      `产品承接：把画面里的动作/细节连接到「${product.name}」的采购卖点。`,
      `画面：围绕该素材已有画面做剪辑，突出可见细节、使用结果或供应能力。`,
      `人物说：“${voice}”`,
      `字幕：${index === 0 ? '先看真实素材' : index === usable.length - 1 ? '发需求拿方案' : '看得见的卖点'}`,
    ].join('\n');
  }).join('\n\n');
}

function materialRoleLabel(clip: Pick<Clip, 'folder' | 'type'>): string {
  if (clip.folder === 'presenter') return '真人口播素材';
  if (clip.folder === 'detail') return '产品细节素材';
  if (clip.folder === 'factory') return '工厂/实力素材';
  if (clip.folder === 'scene') return '场景使用素材';
  if (clip.folder === 'model') return '模特/效果素材';
  if (clip.type === 'image') return '静态产品图';
  return '产品展示素材';
}

function buildMaterialInfosForScript(clips: Clip[], totalDuration: number) {
  const usable = clips.filter(item => item.type !== 'audio');
  const slotDur = Math.max(2, totalDuration / Math.max(1, usable.length || 1));
  return usable.map((clip, index) => ({
    name: clip.name,
    type: clip.type,
    folder: clip.folder,
    duration: clip.type === 'image' ? 3 : clip.duration || slotDur,
    role: materialRoleLabel(clip),
    targetStart: +Math.min(totalDuration, index * slotDur).toFixed(1),
    targetEnd: +Math.min(totalDuration, index === usable.length - 1 ? totalDuration : (index + 1) * slotDur).toFixed(1),
  }));
}

function normalizeTimeLabel(value: string, fallbackIndex: number): string {
  const range = parseCueRange(value);
  if (range) return `[${range.start}-${range.end}s]`;
  const ranges = ['0-3s', '3-8s', '8-15s', '15-20s', '20-25s', '25-30s'];
  return `[${ranges[fallbackIndex] || `${fallbackIndex * 4}-${(fallbackIndex + 1) * 4}s`}]`;
}

function looksLikeProductionInstruction(value: string): boolean {
  return /^(分镜|镜头|画面|音频|注|Shot|Camera|Visual|Subtitle|Caption|Creative style|Core emotion|Goal|Storyboard|Product replacement)\b/i.test(value)
    || /(?:画面|我方画面|参考节奏|字幕|Shot|Camera|Visual|Subtitle)\s*[：:]/i.test(value);
}

function cleanVoiceoverLine(value: string): string {
  let text = String(value || '')
    .replace(/^\s*\[[^\]]+\]\s*/g, '')
    .replace(/^(Hook|Body|CTA|口播|字幕|人物说|台词|Voiceover|VO|Caption)\s*[：:·-]?\s*/i, '')
    .replace(/[（(]\s*(?:参考原节奏|参考节奏|原节奏|参考原片|原片|原视频|日文原句|英文原句|韩文原句)[^）)]*[）)]/gi, '')
    .replace(/[（(][^）)]*(?:参考原节奏|参考节奏|原节奏|参考原片|原片|原视频|日文原句|英文原句|韩文原句)[^）)]*[）)]/gi, '')
    .replace(/[（(][^）)]*[\u3040-\u30ff\uac00-\ud7af][^）)]*[）)]/g, '')
    .replace(/\s*(?:参考原节奏|参考节奏|原节奏|参考原片|原片|原视频|日文原句|英文原句|韩文原句)\s*[：:].*$/gi, '')
    .replace(/^["“”]+|["“”]+$/g, '')
    .replace(/^[\d一二三四五六七八九十]+[.、]\s*/, '')
    .trim();
  text = text.replace(/\s{2,}/g, ' ').trim();
  return text;
}

const TECH_TERM_RE = /\b(?:CE|RoHS|UKCA|ETL|IES\/?LDT|LDT|IP\d{2,}|BSCI|REACH|ISO\d*|MOQ|OEM|ODM|SKU)\b|认证资质|认证|型号|光学文件|检测报告|参数|色温|显指|防护等级/gi;

function techTermCount(value: string): number {
  return Array.from(String(value || '').matchAll(TECH_TERM_RE)).length;
}

function humanizeVoiceLine(value: string): string {
  let text = cleanVoiceoverLine(value);
  const compacted = text.replace(/\s+/g, ' ').trim();
  const terms = techTermCount(compacted);
  const tooDense = terms >= 3 || compacted.length > 58;
  if (!tooDense) return compacted;

  if (/客户问.*价格|问了.*价格|报价|价格/i.test(compacted) && /认证|CE|RoHS|UKCA|ETL|IES|IP\d+/i.test(compacted)) {
    return '客户问完价格，真正担心的是资料能不能一次给齐。先看这个真实效果。';
  }
  if (/认证|CE|RoHS|UKCA|ETL|IES|IP\d+|检测|资质|光学文件/i.test(compacted)) {
    return '认证和检测资料别只写在表格里，先把能确认的文件和实物放一起看。';
  }
  if (/MOQ|数量|包装|标签|目标市场|规格/i.test(compacted)) {
    return '数量、包装和目标市场说清楚，我再给你整理报价和打样方案。';
  }
  if (/参数|色温|显指|亮度|型号/i.test(compacted)) {
    return '别只看参数表，先看现场效果是不是和项目需求对得上。';
  }
  return compacted
    .replace(/(?:认证资质\s*)?(?:CE|RoHS|UKCA|ETL|IES\/?LDT|IP\d{2,}|BSCI|REACH|ISO\d*|[,，、\s]){12,}/gi, '相关认证和检测资料')
    .slice(0, 58)
    .replace(/[，,、;；]\s*$/, '。');
}

function hasUnnaturalVoiceover(value: string): boolean {
  return String(value || '')
    .split(/\n+/)
    .some(line => {
      const match = line.match(/(?:台词|人物说|Voiceover|VO|口播)\s*[：:]\s*(.+)$/i);
      if (!match?.[1]) return false;
      const text = cleanVoiceoverLine(match[1]);
      return techTermCount(text) >= 3 || text.length > 72 || /CE[、,，\s]+RoHS[、,，\s]+UKCA/i.test(text);
    });
}

function parseTimestampedVoiceover(value: string): Array<{ time: string; text: string }> {
  const lines = String(value || '').split(/\n+/);
  const segments: Array<{ time: string; text: string }> = [];
  let currentTime = '';
  let fallbackIndex = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/(?:参考原节奏|参考节奏|原节奏|参考原片|原片|原视频|日文原句|英文原句|韩文原句)/i.test(line)) continue;
    const timeMatch = line.match(/\[([^\]]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*)\]/i);
    const sceneTimeMatch = line.match(/Scene\s+\d+\s*\(([^)]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^)]*)\)/i);
    if (timeMatch) currentTime = normalizeTimeLabel(timeMatch[1], fallbackIndex);
    else if (sceneTimeMatch) currentTime = normalizeTimeLabel(sceneTimeMatch[1], fallbackIndex);

    const quoted = line.match(/[“"]([^”"]{2,})[”"]/);
    const prefixed = line.match(/(?:人物说|台词|Voiceover|VO|口播)\s*[：:]\s*(.+)$/i);
    const sameLine = timeMatch ? line.replace(timeMatch[0], '').trim() : '';
    let text = quoted?.[1] || prefixed?.[1] || '';
    if (!text && sameLine && !looksLikeProductionInstruction(sameLine)) text = sameLine;
    text = cleanVoiceoverLine(text);
    if (!text || looksLikeProductionInstruction(text)) continue;
    segments.push({ time: currentTime || normalizeTimeLabel('', fallbackIndex), text });
    fallbackIndex += 1;
  }
  if (segments.length) return segments;
  return Array.from(String(value || '').matchAll(/[“"]([^”"]{2,})[”"]/g))
    .map((match, index) => ({ time: normalizeTimeLabel('', index), text: cleanVoiceoverLine(match[1] || '') }))
    .filter(item => item.text);
}

function formatVoiceoverWithTimestamps(value: string): string {
  const parsed = parseTimestampedVoiceover(value).filter(item => !isNonSpeechSfx(item.text));
  if (parsed.length) return parsed.map(item => `${item.time} ${item.text}`).join('\n');
  return cleanVoiceoverLine(value);
}

function stripCloneAnalysisSummary(value: string): string {
  const text = String(value || '').trim();
  if (!text) return '';
  const forbiddenBlockRe = /^\s*(?:【?\s*)?(?:基础要求|分析摘要|竞品识别|产品替换|参考爆款|成片目标|指定画风|核心情绪|参考品牌|口播语言|爆点拆解|产品承接|Purpose|Creative style|Core emotion|Product replacement|Voiceover language|Goal|Storyboard)(?:\s*】)?\s*[：:].*$/i;
  const firstTimestamp = text.search(/(?:^|\n)\s*(?:\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\]|Scene\s+\d+\s*\()/i);
  if (firstTimestamp > 0) {
    const head = text.slice(0, firstTimestamp);
    if (/基础要求|分析摘要|竞品识别|产品替换|参考爆款|成片目标|指定画风|核心情绪|对标视频|参考品牌|口播语言/.test(head)) {
      return text.slice(firstTimestamp).trim();
    }
  }
  return text
    .split(/\n+/)
    .filter(line => !forbiddenBlockRe.test(line))
    .join('\n')
    .trim();
}

function compactComparable(value: string): string {
  return String(value || '')
    .replace(/[“”"「」『』\s，,。.!！?？;；:：、/\\-]/g, '')
    .toLowerCase();
}

function enforceScriptProduct(value: string, productInfo: string, strictProductName?: string): string {
  const productName = compact(strictProductName) || selectedProductLabel(productInfo);
  let next = stripCloneAnalysisSummary(value);
  if (productName) {
    next = next
      .replace(/「企业产品组合」|“企业产品组合”|企业产品组合/g, `「${productName}」`)
      .replace(/「主推产品」|“主推产品”|主推产品/g, `「${productName}」`)
      .replace(/把「[^」]{0,24}企业产品组合[^」]{0,24}」/g, `把「${productName}」`)
      .replace(/\bthis product\b/gi, productName);
  }
  return next;
}

function sanitizeStoryboardScript(value: string, productInfo: string, strictProductName?: string): string {
  const enforced = enforceScriptProduct(value, productInfo, strictProductName);
  const lines = enforced.split('\n');
  const out: string[] = [];
  let lastVoiceKey = '';
  let currentVoice = '';

  for (const raw of lines) {
    let line = raw.trimEnd();
    line = line
      .replace(/[；;，,]?\s*只参考对标视频的[^。\n]*?(?:。|$)/g, '')
      .replace(/[；;，,]?\s*不继承原视频[^。\n]*?(?:。|$)/g, '')
      .replace(/[；;，,]?\s*第\s*\d+\s*段只参考[^。\n]*?(?:。|$)/g, '')
      .replace(/[；;，,]?\s*行业\/品类\/产品必须替换为[^。\n]*?(?:。|$)/g, '')
      .trimEnd();
    if (!line.trim()) continue;
    const voiceMatch = line.match(/^(\s*(?:人物说|台词|Voiceover|VO|口播)\s*[：:]\s*)(.+)$/i);
    if (voiceMatch) {
      const prefix = voiceMatch[1] || '';
      const voice = humanizeVoiceLine(voiceMatch[2] || '');
      const key = compactComparable(voice);
      if (!voice || (key && key === lastVoiceKey)) continue;
      currentVoice = voice;
      lastVoiceKey = key;
      out.push(`${prefix}${voice}`);
      continue;
    }

    const subtitleMatch = line.match(/^(\s*(?:字幕|Subtitle|Caption)\s*[：:]\s*)(.+)$/i);
    if (subtitleMatch) {
      const subtitle = cleanVoiceoverLine(subtitleMatch[2] || '');
      const subtitleKey = compactComparable(subtitle);
      const voiceKey = compactComparable(currentVoice);
      if (!subtitle || (voiceKey && (subtitleKey === voiceKey || voiceKey.includes(subtitleKey) || subtitleKey.includes(voiceKey)))) {
        continue;
      }
      out.push(`${subtitleMatch[1]}${subtitle}`);
      continue;
    }

    out.push(line);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripVoiceoverTimestamps(value: string): string {
  return String(value || '')
    .split(/\n+/)
    .map(line => cleanVoiceoverLine(line))
    .filter(Boolean)
    .join('\n');
}

function isBadTranslatedLine(text: string, target: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return true;
  if (target !== 'zh' && /[\u4e00-\u9fa5]/.test(normalized)) return true;
  if (/主推品|适合展示|产品替换|参考爆款|参考节奏|我方画面/.test(normalized)) return true;
  return looksLikeProductionInstruction(normalized);
}

function isNonSpeechSfx(text: string): boolean {
  const normalized = String(text || '')
    .replace(/[\s"'“”‘’.,，。!！?？~～…·:：;；-]/g, '')
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  if (/^(噗|噗噗|砰|砰砰|咚|咚咚|哒|哒哒|啪|啪啪|嗒|嗒嗒|咔|咔哒|咔嚓|咯吱|嘎吱|吱呀|叮|叮咚|嘀|滴滴|唰|嗖|嗡|嗡嗡|轰|轰隆|沙沙|刷刷)$/i.test(normalized)) return true;
  if (/^(whoosh|swoosh|pop|popop|bang|boom|ding|beep|click|clack|creak|crack|snap|buzz|whirr|rustle)$/i.test(normalized)) return true;
  if (normalized.length <= 4 && /^([\u54c8\u563f\u5566\u5662\u7830\u549a\u53ee\u6ef4\u54d2\u55d2\u556a\u54d7\u55d2\u5530\u55e1\u5431\u5494\u55d2])\1+$/.test(normalized)) return true;
  return false;
}

function fallbackTranslatedLine(source: string, target: string): string {
  const text = source.replace(/\s+/g, ' ').trim();
  const isSpanish = target === 'es';
  const isEnglish = target === 'en';
  if (isNonSpeechSfx(text)) return '';
  if (/拒绝照骗|所见即所得/.test(text)) return isSpanish ? 'Sin engaños: lo que ves es lo que recibes.' : 'No fake visuals. What you see is what you get.';
  if (/真实效果/.test(text)) return isSpanish ? 'Mira primero el resultado real.' : 'Check the real result first.';
  if (/打样|样品/.test(text)) return isSpanish ? 'Confirm it with a sample first.' : 'Confirm it with a sample first.';
  if (/报价|数量|包装/.test(text)) return isSpanish ? 'Send the quantity and packaging needs for a quote.' : 'Send the quantity and packaging needs for a quote.';
  if (isEnglish) return 'Check this detail before bulk order.';
  if (isSpanish) return 'Revisa este detalle antes del pedido grande.';
  return '';
}

function normalizeTranslatedVoiceover(base: string, translated: string, target: string): string {
  const source = parseTimestampedVoiceover(base).filter(item => !isNonSpeechSfx(item.text));
  const parsed = parseTimestampedVoiceover(translated);
  if (!source.length) {
    const plain = translated.trim();
    return isBadTranslatedLine(plain, target) ? '' : plain;
  }
  const rawCandidates = parsed.length
    ? parsed.map(item => item.text)
    : String(translated || '').split(/\n+/).map(line => cleanVoiceoverLine(line)).filter(Boolean);
  const candidates = rawCandidates
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!candidates.length) return '';
  const uniqueTranslatedLines = new Set(candidates.map(item => item.toLowerCase()));
  const looksRepeated = candidates.length >= 4 && uniqueTranslatedLines.size === 1;
  const used = new Set<string>();
  const lines: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index]!;
    let candidate = candidates[index] || candidates[Math.min(index, candidates.length - 1)] || fallbackTranslatedLine(item.text, target);
    if (isBadTranslatedLine(candidate, target)) candidate = fallbackTranslatedLine(item.text, target);
    const key = candidate.replace(/\s+/g, ' ').trim().toLowerCase();
    const duplicate = Boolean(key && used.has(key));
    if (key) used.add(key);
    if (looksRepeated || duplicate || isBadTranslatedLine(candidate, target)) {
      candidate = fallbackTranslatedLine(item.text, target);
    }
    if (!candidate || isBadTranslatedLine(candidate, target)) return '';
    lines.push(`${item.time} ${candidate}`);
  }
  return lines.join('\n');
}

const SAMPLE_SCRIPT = `[开场 · 0-3s]
先别划走，这就是最近客户一直在问的那款产品。

[主体 · 3-15s]
工厂直供，品质稳定，支持快速打样和跨境发货。无论你要做私标包装还是小批量测款，都可以快速开始。

[引导 · 15-20s]
想要样品、报价或定制方案，直接留言告诉我你的目标市场。`;

/* ── 缩略图占位 ────────────────────────────────────────────────────────── */
function Thumb({ seed, label, ratio = 'aspect-video', src }: { seed: string; label?: string; ratio?: string; src?: string }) {
  const fallbackSrc = src;
  if (fallbackSrc) {
    return (
      <div className={`relative w-full ${ratio} overflow-hidden rounded-lg bg-surface-2`}>
        <img src={fallbackSrc} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
        {label && (
          <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white bg-black/45">{label}</span>
        )}
      </div>
    );
  }
  const hue = (seed.charCodeAt(0) * 47 + (seed.charCodeAt(1) ?? 0) * 13) % 360;
  return (
    <div className={`relative w-full ${ratio} overflow-hidden rounded-lg`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 88%), hsl(${(hue + 40) % 360} 55% 78%))` }}>
      <div className="absolute inset-0 opacity-[0.12]"
        style={{ backgroundImage: `repeating-linear-gradient(45deg,#000 0,#000 1px,transparent 0,transparent 10px)` }} />
      {label && (
        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white bg-black/45">
          {label}
        </span>
      )}
    </div>
  );
}

/* 真实素材的缩略图：图片直接显示，视频取首帧，音频用占位 */
function RealThumb({ clip }: { clip: Clip }) {
  const label = clip.type === 'image' ? 'IMG' : `0:${String(clip.duration).padStart(2, '0')}`;
  return (
    <div className="relative w-full aspect-video overflow-hidden rounded-lg bg-surface-2">
      {clip.type === 'image' && (
        <img src={clip.url} alt={clip.name} className="w-full h-full object-cover" loading="lazy" />
      )}
      {clip.type === 'video' && (
        <video src={`${clip.url}#t=0.1`} muted playsInline preload="metadata" className="w-full h-full object-cover" />
      )}
      {clip.type === 'audio' && (
        <div className="w-full h-full flex items-center justify-center"><Music size={20} className="text-text-muted" /></div>
      )}
      <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-white bg-black/45">{label}</span>
    </div>
  );
}

/* 封面预览：优先用已生成的封面 SVG；否则用所选帧 + 标题叠层。
   字号用 cqw（容器宽度百分比）与 SVG 的 fontSize 比例一致，预览即所见。 */
const WEIGHT_MAP = { regular: 600, bold: 800, heavy: 900 } as const;
function CoverFace({ coverUrl, frameUrl, frameType, title, style, editable, onTitleChange }: { coverUrl?: string | null; frameUrl?: string; frameType?: Clip['type']; title: string; style: CoverStyle; editable?: boolean; onTitleChange?: (t: string) => void }) {
  if (coverUrl) return <img src={coverUrl} alt="封面" className="absolute inset-0 w-full h-full object-cover" />;
  const posClass = style.position === 'top' ? 'items-start' : style.position === 'center' ? 'items-center' : 'items-end';
  const cqw = style.size === 'S' ? 6.2 : style.size === 'L' ? 9.8 : 7.8;
  const scrim = style.position === 'top'
    ? 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent 52%)'
    : style.position === 'center'
      ? 'rgba(0,0,0,0.3)'
      : 'linear-gradient(to top, rgba(0,0,0,0.6), transparent 52%)';
  const titleStyle = {
    width: '100%', color: style.color, fontSize: `${cqw}cqw`,
    fontWeight: WEIGHT_MAP[style.weight ?? 'bold'],
    textAlign: style.align, fontFamily: style.fontFamily ?? fontCss(style.font),
  } as const;
	  return (
	    <div className="absolute inset-0" style={{ containerType: 'inline-size' }}>
	      {frameUrl && frameType === 'video'
	        ? <video src={`${frameUrl}#t=0.1`} muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover" />
	        : frameUrl
	          ? <img src={frameUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
	          : <div className="absolute inset-0 flex items-center justify-center bg-surface-2 text-xs font-semibold text-text-muted">请选择素材帧</div>}
      <div className={`absolute inset-0 flex ${posClass}`} style={{ padding: '5cqw', background: scrim }}>
        {editable ? (
          // 直接在封面上唤起文本框编辑标题（失焦提交）
          <p contentEditable suppressContentEditableWarning spellCheck={false}
            onClick={e => e.stopPropagation()}
            onBlur={e => onTitleChange?.(e.currentTarget.textContent ?? '')}
            className="leading-tight outline-none cursor-text rounded-[1cqw]"
            style={{ ...titleStyle, boxShadow: '0 0 0 0.4cqw rgba(255,255,255,0.55)' }}>
            {title}
          </p>
        ) : (
          <p className="leading-tight" style={titleStyle}>{title}</p>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════ */

export default function AiCreateStudio({ onNavigate, onGoPublish }: { onNavigate?: (p: Page) => void; onGoPublish?: (payload: { videoPath?: string; title: string; description: string; ratio: string }) => void } = {}) {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx].id;

  // 全局制作状态
  const [mode, setMode] = useState<'material' | 'clone' | 'product'>('material');
  const [contentMode, setContentMode] = useState<'video' | 'poster'>('video');
  const [posterStyle, setPosterStyle] = useState<(typeof POSTER_STYLES)[number]['id']>('oem-factory');
  const [platform, setPlatform] = useState('tiktok');
  const [ratio, setRatio] = useState('9:16');
  const [duration, setDuration] = useState(20);
  const [lang, setLang] = useState('zh');
  const [provider, setProvider] = useState<'gemini' | 'qwen'>('gemini');
  const [productInfo, setProductInfo] = useState('');
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [productSelectMode, setProductSelectMode] = useState<'single' | 'multi'>('single');
  const [cloneCount] = useState(1);
  const [cloneOutputMode, setCloneOutputMode] = useState<'ideas' | 'languages'>('ideas');
  const [audience, setAudience] = useState('');
  const [sellingPoints, setSellingPoints] = useState('');
  const [tone, setTone] = useState('高转化 · 口语化');

  const [activeFolder, setActiveFolder] = useState('recommend');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [scriptRecommendedMaterialIds, setScriptRecommendedMaterialIds] = useState<string[]>([]);
  const [storyboardAssignments, setStoryboardAssignments] = useState<Record<string, string>>({});
  const [assemblyName, setAssemblyName] = useState('视频1');

  const [materials, setMaterials] = useState<Clip[]>([]);
  const [uploading, setUploading] = useState(false);
  const [digitalHumanLoading, setDigitalHumanLoading] = useState(false);
  const [digitalHumanNotice, setDigitalHumanNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [script, setScript] = useState('');
  const [scriptType, setScriptType] = useState<'voiceover' | 'storyboard'>('voiceover');
  const [voice, setVoice] = useState('v1');
  const [scriptLoading, setScriptLoading] = useState(false);
  const [voiceoverLines, setVoiceoverLines] = useState('');
  const [voiceLangs, setVoiceLangs] = useState<string[]>(['zh', 'en', 'es']);
  const [activeVoiceLang, setActiveVoiceLang] = useState('zh');
  const [voiceDrafts, setVoiceDrafts] = useState<Record<string, string>>({});
  const [voiceDraftLoading, setVoiceDraftLoading] = useState(false);
  const [voiceDraftNotice, setVoiceDraftNotice] = useState('');
  const [voicePreviewIdx, setVoicePreviewIdx] = useState<number | null>(null);
  const [scriptView, setScriptView] = useState<'timestamp' | 'voiceover'>('timestamp');
  const autoGen = useRef(false); // 标记是否已由入口生成脚本，避免覆盖用户编辑

  // 配音 TTS
  const [voiceoverUrl, setVoiceoverUrl] = useState<string | null>(null);
  const [voiceoverDur, setVoiceoverDur] = useState(0);
  const [voiceoverAudios, setVoiceoverAudios] = useState<Record<string, { url: string; duration: number }>>({});
  const [voiceoverMode, setVoiceoverMode] = useState<'none' | 'ai' | 'upload'>('ai');
  const [uploadedVoiceName, setUploadedVoiceName] = useState('');
  const [customVoiceId, setCustomVoiceId] = useState('');
  const [customVoiceName, setCustomVoiceName] = useState('');
  const [customVoiceUrl, setCustomVoiceUrl] = useState('');
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsNotice, setTtsNotice] = useState('');
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceoverInputRef = useRef<HTMLInputElement>(null);
  const voiceSampleInputRef = useRef<HTMLInputElement>(null);

  const [bgm, setBgm] = useState('');   // 无内置曲库，默认不选
  const [bgmVol, setBgmVol] = useState(35);
  const [voiceVol, setVoiceVol] = useState(100);
  const [bgms, setBgms] = useState<Bgm[]>(BGMS);
  const [playingBgm, setPlayingBgm] = useState<string | null>(null);
  const [bgmUploading, setBgmUploading] = useState(false);
  const [bgmTab, setBgmTab] = useState<'library' | 'favorites'>('library');
  const [favoriteBgms, setFavoriteBgms] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('ow_favorite_bgms') || '[]') as string[];
    } catch {
      return [];
    }
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bgmInputRef = useRef<HTMLInputElement>(null);
  const previewBgmAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewVoiceAudioRef = useRef<HTMLAudioElement | null>(null);

  const [cover, setCover] = useState(''); // 某素材 id（用其帧画面作封面底图）
  const [coverTitle, setCoverTitle] = useState(COVERS[0].title);
  const [coverTitleZh, setCoverTitleZh] = useState('');   // 标题中文翻译（供确认）
  const [coverStyle, setCoverStyle] = useState<CoverStyle>({ color: '#ffffff', size: 'M', position: 'bottom', align: 'left', font: 'sans', weight: 'bold' });
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverCanvaOpening, setCoverCanvaOpening] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null); // 生成的封面 SVG 文件地址（发布缩略图）
  const [customFonts, setCustomFonts] = useState<{ family: string; label: string }[]>([]); // 官方导入的字体模版
  const fontInputRef = useRef<HTMLInputElement>(null);


  const [rendering, setRendering] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [renderPct, setRenderPct] = useState(0);
  const [renderOutputPath, setRenderOutputPath] = useState<string | null>(null); // 桌面端合成产物路径
  const [renderDownloadMessage, setRenderDownloadMessage] = useState('');
  const [languageRenderOutputs, setLanguageRenderOutputs] = useState<Record<string, { status: 'pending' | 'rendering' | 'done' | 'failed'; path?: string; error?: string }>>({});
  const [batchRenderingLangs, setBatchRenderingLangs] = useState(false);
  const renderToken = useRef(0); // 取消过期的渲染循环（重复点「重新合成」时）

  const [account, setAccount] = useState<string | null>('a1');
  const [caption, setCaption] = useState('Factory-direct home essentials 🏠✨ #tiktokmademebuyit #homefinds');
  const [captionLoading, setCaptionLoading] = useState(false);
  const [published, setPublished] = useState(false);
  const [demoAutoLoading, setDemoAutoLoading] = useState(false);
  const [savedToWorks, setSavedToWorks] = useState(false); // 「存入我的作品」反馈
  const [modeActionLoading, setModeActionLoading] = useState(false);
  const [modeActionStatus, setModeActionStatus] = useState('');
  const [modeNotice, setModeNotice] = useState('');
  const [modeScripts, setModeScripts] = useState<ModeScriptOutput[]>([]);
  const [activeModeScriptId, setActiveModeScriptId] = useState('');
  const [pendingRealCloneGeneration, setPendingRealCloneGeneration] = useState(false);
  const [posterLoading, setPosterLoading] = useState(false);
  const [posterDraft, setPosterDraft] = useState<FbPosterResult | null>(null);
  const [posterJsonText, setPosterJsonText] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/overseas/enterprise/profile')
      .then(r => r.json())
      .then((profile: EnterpriseProfileLite) => {
        if (!alive) return;
        const options = buildAiProductOptions(profile);
        setProductOptions(current => {
          const preserved = current.filter(item => item.id === 'kickoff-product');
          const seen = new Set(preserved.map(item => item.id));
          return [...preserved, ...options.filter(item => !seen.has(item.id))];
        });
        if (options[0]) setSelectedProductIds(current => current.length ? current : [options[0]!.id]);
        setLang('zh');
        setProductInfo(prev => prev || options[0]?.info || [
          profile.strategy?.focusProducts || profile.products?.categories,
          profile.products?.priceRange,
          profile.products?.moq,
        ].filter(Boolean).join('；'));
        setAudience(prev => prev || [
          profile.customers?.targetProfiles,
          profile.strategy?.focusMarkets || profile.company?.mainMarkets,
        ].filter(Boolean).join('；'));
        setSellingPoints(prev => prev || [
          profile.brand?.usp,
          profile.products?.highlights,
        ].filter(Boolean).join('；'));
        setTone(prev => prev || profile.brand?.tone || '高转化 · 口语化');
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (productOptions.length === 0 || selectedProductIds.length === 0) return;
    const selectedOptions = productOptions.filter(option => selectedProductIds.includes(option.id));
    if (selectedOptions.length === 0) return;
    setProductInfo(formatSelectedProductInfo(selectedOptions));
  }, [productOptions, selectedProductIds]);

  useEffect(() => {
    if (productSelectMode === 'single' && selectedProductIds.length > 1) {
      setSelectedProductIds([selectedProductIds[0]]);
    }
  }, [productSelectMode, selectedProductIds]);

  // 成片预览：网页端顺序播放选中的真实视频片段（mock 占位素材无 url，不可播放）
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [previewNote, setPreviewNote] = useState(false);
  const [capcutOpening, setCapcutOpening] = useState(false);
  const [capcutMessage, setCapcutMessage] = useState('');
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewAdvanceTimerRef = useRef<number | null>(null);

  // 字幕（A 层：脚本兜底对齐 + 沿用封面样式；桌面端 ffmpeg 烧录）
  const [subtitlesOn, setSubtitlesOn] = useState(true);
  const [subMode, setSubMode] = useState<'target' | 'bilingual'>('target');
  const [subPreviewIdx, setSubPreviewIdx] = useState(0); // 预览叠层当前展示的 cue
  const [cueZh, setCueZh] = useState<string[]>([]);       // 双语字幕的中文译文（与 cues 对齐）
  const [previewTime, setPreviewTime] = useState(0);
  const [clipEdits, setClipEdits] = useState<Record<string, ClipEdit>>({});

  // 草稿 / 作品
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState('未命名草稿');
  const [showProjects, setShowProjects] = useState(false);
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [savingProj, setSavingProj] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [videoKickoff, setVideoKickoff] = useState<VideoKickoff | null>(null);

  const materialById = useMemo(() => new Map(materials.map(item => [item.id, item])), [materials]);
  const selectedClips = useMemo(() => selected.map(id => materialById.get(id)).filter(Boolean) as Clip[], [selected, materialById]);
  const totalDur = selectedClips.reduce((s, c) => s + (c.type === 'image' ? 3 : c.duration), 0);
  const matNames = selectedClips.map(c => c.name);
  const storyboardSlots = useMemo(() => parseStoryboardSlots(script, duration), [script, duration]);
  const assignedOrderedIds = useMemo(
    () => storyboardSlots.map(slot => storyboardAssignments[slot.id]).filter((id): id is string => Boolean(id && materialById.has(id))),
    [storyboardAssignments, storyboardSlots, materialById],
  );
  const assignedCount = assignedOrderedIds.length;
  const activeProductInfo = useMemo(() => {
    const selectedOptions = productOptions.filter(option => selectedProductIds.includes(option.id));
    const selectedInfo = formatSelectedProductInfo(selectedOptions);
    return selectedInfo || productInfo;
  }, [productInfo, productOptions, selectedProductIds]);
  const activeProductLabel = useMemo(() => selectedProductLabel(activeProductInfo), [activeProductInfo]);
  const selectedBgmTrack = useMemo(() => bgms.find(track => track.id === bgm) || null, [bgm, bgms]);
  const visiblePlatforms = useMemo(
    () => contentMode === 'poster' ? PLATFORMS.filter(p => p.id === 'facebook' || p.id === 'instagram') : PLATFORMS,
    [contentMode],
  );
  const visibleRatios = useMemo(
    () => contentMode === 'poster' ? POSTER_RATIOS : RATIOS,
    [contentMode],
  );

  useEffect(() => {
    if (!activeProductLabel) return;
    setScript(current => sanitizeStoryboardScript(current, activeProductInfo, activeProductLabel));
    setModeScripts(current => current.map(item => ({ ...item, script: sanitizeStoryboardScript(item.script, activeProductInfo, activeProductLabel) })));
  }, [activeProductInfo, activeProductLabel]);
  useEffect(() => {
    if (contentMode !== 'poster') return;
    if (platform !== 'facebook' && platform !== 'instagram') {
      setPlatform('facebook');
      setRatio('1:1');
    }
    if (!POSTER_RATIOS.includes(ratio)) setRatio('1:1');
  }, [contentMode, platform, ratio]);
  // 选中的封面底图帧：取该素材的帧画面（视频抽帧 / 图片自身）
  const coverClip = useMemo(() => materials.find(m => m.id === cover), [cover, materials]);
  const coverFrameUrl = useMemo(() => {
    if (!coverClip) return undefined;
    if (coverClip.poster) return coverClip.poster;
    if (coverClip.type === 'image' || coverClip.type === 'video') return coverClip.url;
    return undefined;
  }, [coverClip]);
  // 可作封面的候选：已选中的图片/视频；视频没有抽帧时直接展示首帧
  const frameCandidates = useMemo(() => selectedClips.filter(c => c.type !== 'audio' && (c.poster || c.url)), [selectedClips]);
  useEffect(() => {
    const firstFrameId = frameCandidates[0]?.id ?? '';
    if (!cover || cover === 'gradient' || !frameCandidates.some(c => c.id === cover)) {
      setCover(firstFrameId);
    }
  }, [cover, frameCandidates]);
  useEffect(() => {
    setCoverUrl(null);
  }, [cover, coverFrameUrl]);
  // 成片预览可播放的真实视频片段（mock 占位素材没有 url）
  const previewable = useMemo(() => selectedClips.filter(c => c.url && c.type === 'video'), [selectedClips]);
  const activeSpokenScript = voiceDrafts[activeVoiceLang] || voiceoverLines || script;
  // 字幕 cue：当前语种口播台词 + TTS 时长（无配音则用素材总时长）
  const cues = useMemo(() => buildCues(activeSpokenScript, voiceoverDur || totalDur), [activeSpokenScript, voiceoverDur, totalDur]);
  // 字幕样式沿用封面体系，但默认底部居中 + 适配字号
  const subStyle: CoverStyle = useMemo(() => ({ ...coverStyle, position: 'bottom', align: 'center', size: coverStyle.size === 'L' ? 'M' : 'S' }), [coverStyle]);

  const canNext = step === 'material' ? selected.length > 0 : true;
  useEffect(() => {
    if (!assignedOrderedIds.length) return;
    setSelected(current => {
      const deduped = [...new Set(assignedOrderedIds)];
      return current.length === deduped.length && current.every((id, index) => id === deduped[index]) ? current : deduped;
    });
  }, [assignedOrderedIds]);
  const isLast = stepIdx === STEPS.length - 1;
  const toggleProductSelection = (id: string) => {
    setSelectedProductIds(current => {
      if (productSelectMode === 'single') return [id];
      const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
      return next.length ? next : [id];
    });
  };
  useEffect(() => {
    let raw = '';
    try {
      raw = localStorage.getItem('ow_video_kickoff') || localStorage.getItem('ow_seedance_kickoff') || '';
      if (raw) {
        localStorage.removeItem('ow_video_kickoff');
        localStorage.removeItem('ow_seedance_kickoff');
      }
    } catch { /* ignore */ }
    if (!raw) return;
    try {
      const kickoff = JSON.parse(raw) as VideoKickoff;
      setVideoKickoff(kickoff);
      const fromInspiration = kickoff.source === 'inspiration_analysis';
      if (fromInspiration) {
        setScript('');
        setVoiceoverLines('');
        setVoiceDrafts({});
        setScriptView('timestamp');
        setModeScripts([]);
        const kickoffOption = kickoff.productInfo ? productOptionFromInfo(kickoff.productInfo) : null;
        if (kickoffOption) {
          setProductOptions(current => current.some(item => item.id === kickoffOption.id)
            ? current.map(item => item.id === kickoffOption.id ? kickoffOption : item)
            : [kickoffOption, ...current]);
          setSelectedProductIds([kickoffOption.id]);
        }
        if (kickoff.productInfo) {
          const localScript = sanitizeStoryboardScript(buildLocalCloneScript(kickoff, kickoff.productInfo, kickoff.language || lang || 'zh'), kickoff.productInfo);
          const localScriptId = `clone-local-${Date.now()}`;
          setModeScripts([{
            id: localScriptId,
            title: '爆款复刻时间戳脚本 1（本地兜底）',
            script: localScript,
            mode: 'clone',
          }]);
          setActiveModeScriptId(localScriptId);
          applyTimestampScript(localScript, kickoff.productInfo);
          setModeNotice('已按对标视频结构和第一步选定产品快速生成本地兜底稿。点击“重新思考生成新脚本”会调用后端生成新版脚本。');
          setPendingRealCloneGeneration(false);
        } else {
          setModeNotice('已带入对标视频分析，请先选择企业中心产品后生成脚本。');
          setPendingRealCloneGeneration(false);
        }
      } else if (kickoff.script) {
        setScript(kickoff.script);
      }
      if (kickoff.scriptType === 'voiceover' || kickoff.scriptType === 'storyboard') setScriptType(kickoff.scriptType);
      if (kickoff.language) setLang(kickoff.language);
      if (kickoff.productInfo) setProductInfo(kickoff.productInfo);
      if (kickoff.video?.platform) setPlatform(kickoff.video.platform);
      setProvider('gemini');
      setMode(fromInspiration ? 'clone' : 'material');
      setActiveFolder(kickoff.generatedVideo ? 'upload' : 'hot');
      setProjectTitle(kickoff.video?.title ? `爆款素材迭代 · ${kickoff.video.title}` : kickoff.generatedVideo?.title || 'AI智能素材');
      setStepIdx(STEPS.findIndex(s => s.id === (fromInspiration ? 'script' : 'material')));
      autoGen.current = true;
    } catch { /* ignore malformed kickoff */ }
  }, []);

  useEffect(() => {
    if (!videoKickoff?.generatedVideo) return;
    const generated = videoKickoff.generatedVideo;
    const clip: Clip = generated.material
      ? materialToClip(generated.material)
      : {
          id: generated.id || `seedance-video-${videoKickoff.video?.title || 'output'}`,
          name: generated.title || 'Seedance 输出视频',
          folder: 'upload',
          type: 'video',
          duration: generated.duration || videoKickoff.video?.duration || duration,
          size: 'Seedance',
          url: generated.url,
          poster: generated.poster || videoKickoff.video?.aiAnalysis?.materialPoster || videoKickoff.video?.thumbnail,
          scope: 'own',
        };
    setMaterials(prev => {
      if (prev.some(m => m.id === clip.id || (clip.url && m.url === clip.url))) return prev;
      return [clip, ...prev];
    });
    setSelected([clip.id]);
  }, [duration, videoKickoff]);

  useEffect(() => {
    if (!videoKickoff || materials.length === 0) return;
    const materialUrl = videoKickoff.generatedVideo?.url || videoKickoff.video?.aiAnalysis?.materialUrl || videoKickoff.video?.videoUrl || '';
    const title = videoKickoff.generatedVideo?.title || videoKickoff.video?.title || '';
    const matched = materials.find(m => (materialUrl && m.url === materialUrl) || (title && m.name.includes(title.slice(0, 40))));
    if (matched) setSelected([matched.id]);
  }, [materials, videoKickoff]);

  const editFor = (clip: Clip): ClipEdit => clipEdits[clip.id] ?? {
    trimStart: 0,
    trimEnd: clip.type === 'image' ? 3 : clip.duration,
    speed: 1,
    transition: '硬切',
    note: '',
  };
  const editForSlot = (clip: Clip, slot: StoryboardSlot): ClipEdit => {
    const targetDuration = Math.max(0.5, slot.end - slot.start);
    const base = editFor(clip);
    const maxEnd = clip.type === 'image' ? Math.max(10, targetDuration) : Math.max(1, clip.duration || targetDuration);
    const trimStart = Math.max(0, Math.min(base.trimStart || 0, Math.max(0, maxEnd - 0.5)));
    const trimEnd = clip.type === 'image'
      ? Math.min(maxEnd, Math.max(trimStart + targetDuration, base.trimEnd || targetDuration))
      : Math.min(maxEnd, Math.max(trimStart + Math.min(targetDuration, maxEnd - trimStart), base.trimEnd || targetDuration));
    return {
      ...base,
      trimStart,
      trimEnd,
      speed: targetDuration > 0 && trimEnd > trimStart ? Math.max(0.25, Math.min((trimEnd - trimStart) / targetDuration, 4)) : base.speed,
      note: slot.detail,
    };
  };
  const defaultEditForSlot = (clip: Clip, slot: StoryboardSlot): ClipEdit => {
    const targetDuration = Math.max(0.5, slot.end - slot.start);
    const sourceDuration = clip.type === 'image' ? Math.max(10, targetDuration) : Math.max(1, clip.duration || targetDuration);
    const usable = Math.min(targetDuration, sourceDuration);
    return {
      trimStart: 0,
      trimEnd: clip.type === 'image' ? targetDuration : usable,
      speed: usable > 0 ? Math.max(0.25, Math.min(usable / targetDuration, 4)) : 1,
      transition: '硬切',
      note: slot.detail,
    };
  };
  const renderTimeline = useMemo(() => {
    const rows = storyboardSlots.map(slot => {
      const clip = materialById.get(storyboardAssignments[slot.id] || '');
      if (!clip) return null;
      const edit = defaultEditForSlot(clip, slot);
      return {
        clipId: clip.id,
        name: clip.name,
        type: clip.type,
        url: clip.url,
        poster: clip.poster,
        trimStart: edit.trimStart,
        trimEnd: edit.trimEnd,
        speed: edit.speed,
        targetStart: slot.start,
        targetEnd: slot.end,
        targetDuration: Math.max(0.5, slot.end - slot.start),
      };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (rows.length) return rows;
    return selectedClips.map(clip => {
      const edit = editFor(clip);
      return {
        clipId: clip.id,
        name: clip.name,
        type: clip.type,
        url: clip.url,
        poster: clip.poster,
        trimStart: edit.trimStart,
        trimEnd: edit.trimEnd,
        speed: edit.speed,
        targetStart: undefined,
        targetEnd: undefined,
        targetDuration: Math.max(0.5, edit.trimEnd - edit.trimStart),
      };
    });
  }, [clipEdits, materialById, selectedClips, storyboardAssignments, storyboardSlots]);
  const previewTimeline = useMemo(() => renderTimeline
    .map(item => {
      const clip = materialById.get(item.clipId || '') || materials.find(candidate => candidate.name === item.name);
      if (!clip || !clip.url || clip.type === 'audio') return null;
      return { ...item, clip };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item)), [materials, materialById, renderTimeline]);
  const previewOffsetByIndex = useMemo(() => {
    const offsets: number[] = [];
    let cursor = 0;
    previewTimeline.forEach((item, index) => {
      offsets[index] = cursor;
      cursor += Math.max(0.5, item.targetDuration || ((item.trimEnd || 0) - (item.trimStart || 0)) || 3);
    });
    return offsets;
  }, [previewTimeline]);
  const cueAtTime = (time: number): SubCue | null => {
    if (!subtitlesOn || !cues.length) return null;
    const current = cues.find(cue => time >= cue.start && time < cue.end);
    if (current) return current;
    return cues.find(cue => Math.abs(time - cue.start) < 0.25) || null;
  };
  const activePreviewCue = cueAtTime(previewTime);
  const patchClipEdit = (clip: Clip, patch: Partial<ClipEdit>) => {
    setClipEdits(prev => {
      const base = prev[clip.id] ?? {
        trimStart: 0,
        trimEnd: clip.type === 'image' ? 3 : clip.duration,
        speed: 1,
        transition: '硬切',
        note: '',
      };
      const next = { ...base, ...patch };
      const maxEnd = clip.type === 'image' ? 10 : Math.max(1, clip.duration);
      next.trimStart = Math.max(0, Math.min(Number(next.trimStart) || 0, maxEnd));
      next.trimEnd = Math.max(next.trimStart + 0.5, Math.min(Number(next.trimEnd) || maxEnd, maxEnd));
      next.speed = Math.max(0.25, Math.min(Number(next.speed) || 1, 4));
      return { ...prev, [clip.id]: next };
    });
  };

  const goPreview = async (scriptOverride?: string, renderOverride?: { language?: string; voiceoverUrl?: string; voiceoverDur?: number; outputOnly?: boolean }) => {
    setStepIdx(STEPS.findIndex(s => s.id === 'preview'));
    setRendered(false);
    setRendering(true);
    setRenderPct(0);
    if (!renderOverride?.outputOnly) setRenderOutputPath(null);
    const token = ++renderToken.current;
    try {

	    // 生成发布封面 SVG：只在有真实图片帧时生成，避免退回纯色/渐变封面。
      const canGenerateCoverSvg = Boolean(coverFrameUrl && (coverClip?.poster || coverClip?.type === 'image'));
	    const cv = canGenerateCoverSvg
        ? await studioApi.cover({ title: coverTitle, ratio, accent: '#16a34a', bgImageUrl: coverFrameUrl, ...coverStyle })
        : { ok: false as const, url: null };
    if (renderToken.current !== token) return;
    const cUrl = cv.ok ? (cv.url ?? null) : null;
    setCoverUrl(cUrl);

    const outputLanguage = renderOverride?.language || lang;
    const outputVoiceoverUrl = renderOverride?.voiceoverUrl ?? voiceoverUrl;
    const outputVoiceoverDur = renderOverride?.voiceoverDur ?? voiceoverDur;
    const outputScript = scriptOverride ?? (voiceDrafts[outputLanguage] || activeSpokenScript);
    const timelineDuration = renderTimeline.reduce((sum, item) => sum + (item.targetDuration || 0), 0);
    const outputCues = buildCues(outputScript, outputVoiceoverDur || timelineDuration || totalDur);
    const spec = {
      materials: renderTimeline.length ? renderTimeline.map(item => item.name) : matNames,
      timeline: renderTimeline,
      script: outputScript,
      voice,
      bgm,
      bgmVol,
      voiceVol,
      coverId: cover,
      coverTitle,
      coverUrl: cUrl ?? undefined,
      ratio,
      duration: timelineDuration || duration,
      platform,
      language: outputLanguage,
      voiceoverUrl: voiceoverMode === 'none' ? undefined : outputVoiceoverUrl ?? undefined,
      subtitles: subtitlesOn ? {
        mode: subMode,
        style: { font: coverStyle.font, color: coverStyle.color, weight: coverStyle.weight, fontFamily: coverStyle.fontFamily },
        cues: subMode === 'bilingual' ? outputCues.map((c, i) => ({ ...c, zh: cueZh[i] })) : outputCues,
      } : { mode: 'off' as const, style: {}, cues: [] },
    };

    // 1) 向服务器申请渲染授权（原料 manifest + 短期令牌）
    const auth = await studioApi.render(spec);

    // 2) 桌面客户端：用本机原生 ffmpeg 真实合成出片
    const desktop = getDesktopRender();
    if (desktop?.available) {
      const unsub = desktop.onProgress(p => {
        if (renderToken.current === token) setRenderPct(Math.min(99, Math.round(p)));
      });
      try {
        const out = await desktop.render(auth.manifest);
        if (renderToken.current !== token) return;
        if (out.ok) {
          if (!renderOverride?.outputOnly) setRenderOutputPath(out.outputPath ?? null);
          setRendering(false);
          setRendered(true);
          setRenderPct(100);
          return out.outputPath ?? null;
        } else {
          setRendering(false);
          setRendered(false);
          throw new Error(out.error || '桌面端合成失败');
        }
      } finally {
        unsub();
      }
      return;
    }

    // 3) 网页环境：没有 Electron 桥时，走本机后端 ffmpeg 兜底导出。
    setRenderPct(20);
    const localOut = await studioApi.renderLocal(auth.manifest);
    if (renderToken.current !== token) return;
    if (!localOut.ok) throw new Error(localOut.error || '本地 MP4 导出失败');
    if (!renderOverride?.outputOnly) setRenderOutputPath(localOut.outputPath ?? null);
    setRendering(false);
    setRendered(true);
    setRenderPct(100);
    return localOut.outputPath ?? null;
    } catch (err: any) {
      if (renderToken.current === token) {
        setRendering(false);
        setRendered(false);
        alert(err?.message || '成片预览失败，请稍后重试。');
      }
      throw err;
    }
  };

  const next = () => {
    if (STEPS[stepIdx + 1]?.id === 'preview') return goPreview();
    if (STEPS[stepIdx + 1]?.id === 'material') setActiveFolder('recommend');
    setStepIdx(i => Math.min(i + 1, STEPS.length - 1));
  };
  const renderLanguageVersions = async () => {
    const languages = voiceoverMode === 'ai'
      ? voiceLangs.filter(code => voiceDrafts[code]?.trim() && voiceoverAudios[code]?.url)
      : [activeVoiceLang].filter(code => code && voiceoverUrl);
    if (!languages.length) {
      alert('请先在「口播脚本」步骤生成多语种配音。');
      return;
    }
    setBatchRenderingLangs(true);
    setLanguageRenderOutputs(Object.fromEntries(languages.map(code => [code, { status: 'pending' as const }])));
    try {
      for (const code of languages) {
        const audio = voiceoverMode === 'ai' ? voiceoverAudios[code] : { url: voiceoverUrl || '', duration: voiceoverDur };
        setLanguageRenderOutputs(prev => ({ ...prev, [code]: { status: 'rendering' } }));
        try {
          const outputPath = await goPreview(voiceDrafts[code] || activeSpokenScript, {
            language: code,
            voiceoverUrl: audio.url,
            voiceoverDur: audio.duration,
            outputOnly: true,
          });
          setLanguageRenderOutputs(prev => ({ ...prev, [code]: { status: 'done', path: outputPath || undefined } }));
        } catch (err: any) {
          setLanguageRenderOutputs(prev => ({ ...prev, [code]: { status: 'failed', error: err?.message || '生成失败' } }));
        }
      }
    } finally {
      setBatchRenderingLangs(false);
    }
  };
  const prev = () => setStepIdx(i => Math.max(i - 1, 0));

  const regenScript = async (type: 'voiceover' | 'storyboard' = scriptType) => {
    if (!activeProductInfo.trim() || !activeProductLabel) {
      alert('请先在第一步选择企业中心产品，再生成脚本。');
      setStepIdx(0);
      return;
    }
    setScriptLoading(true);
    try {
      const { script: s } = await studioApi.script(
        { materials: matNames, productInfo: activeProductInfo, language: lang, platform, duration, scriptType: type, provider, audience, sellingPoints, tone }, script,
      );
      setScript(sanitizeStoryboardScript(s, activeProductInfo, activeProductLabel));
    } catch (err: any) {
      alert(err?.message || '脚本生成失败，请稍后重试。');
    } finally {
      setScriptLoading(false);
    }
  };

  const generateFromMaterialLibrary = async () => {
    setModeActionLoading(true);
    setModeActionStatus('正在快速匹配本地素材…');
    setModeNotice('');
    setModeScripts([]);
    try {
      const pool = materials.filter(item => item.type !== 'audio');
      if (pool.length === 0) {
        setModeNotice('素材库暂无可用于剪辑的图片或视频，请先上传素材后再生成时间戳脚本。');
        setStepIdx(STEPS.findIndex(s => s.id === 'material'));
        return;
      }
      const preferred = selected.length
        ? selected
        : pool.filter(item => ['presenter', 'product', 'factory', 'scene', 'model', 'detail', 'upload'].includes(item.folder)).slice(0, 6).map(item => item.id);
      const selectResp = pickMaterialClipsLocally(pool, duration, preferred);
      const nextSelected = (selectResp.selectedIds || []).filter(id => pool.some(item => item.id === id));
      const finalSelected = nextSelected.length ? nextSelected : (preferred.length ? preferred : pool.slice(0, 4).map(item => item.id));
      const selectedMaterialsForScript = pool.filter(item => finalSelected.includes(item.id));
      const names = selectedMaterialsForScript.map(item => item.name);
      const materialInfos = buildMaterialInfosForScript(selectedMaterialsForScript, duration);
      const outputs: ModeScriptOutput[] = [];
      const count = Math.max(1, Math.min(5, cloneCount));
      let usedLocalFallback = false;
      for (let i = 0; i < count; i += 1) {
        setModeActionStatus(`正在分析 ${finalSelected.length} 个推荐素材并生成脚本${count > 1 ? ` ${i + 1}/${count}` : ''}…`);
        let nextScript = '';
        let generatedByFallback = false;
        if (!generatedByFallback) {
          try {
            const response = await withTimeout(studioApi.script(
              {
                materials: names,
                materialInfos,
                productInfo: activeProductInfo,
                language: 'zh',
                platform,
                duration,
                scriptType: 'storyboard',
                generationMode: 'material',
                provider,
                audience,
                sellingPoints,
                tone: `${tone} · 素材库方案 ${i + 1}`,
              },
              '',
            ), 45_000, '后端模型生成超过 45 秒。');
            nextScript = sanitizeStoryboardScript(response.script || '', activeProductInfo, activeProductLabel).trim();
            if (!nextScript || response.source === 'local') throw new Error('后端脚本生成接口未返回结果。');
            if (response.source === 'fallback') usedLocalFallback = true;
          } catch (err: any) {
            const message = String(err?.message || '');
            if (message.includes('Demo') || message.includes('试用') || message.includes('额度') || message.includes('到期')) throw err;
            generatedByFallback = true;
            usedLocalFallback = true;
          }
        }
        if (generatedByFallback) {
          nextScript = sanitizeStoryboardScript(buildLocalMaterialScript(pool, finalSelected, activeProductInfo, duration), activeProductInfo, activeProductLabel).trim();
        }
        outputs.push({
          id: `material-${Date.now()}-${i}`,
          title: `素材库时间戳脚本 ${i + 1}${generatedByFallback ? '（本地兜底）' : ''}`,
          script: nextScript,
          mode: 'material',
        });
      }
      const sceneCount = outputs[0] ? parseStoryboardSlots(outputs[0].script, duration).length : finalSelected.length;
      const sceneMatchedResp = pool.length ? pickMaterialClipsLocally(pool, duration, finalSelected, Math.max(1, sceneCount)) : { selectedIds: [], reason: '' };
      const recommendedIds = (sceneMatchedResp.selectedIds || []).filter(id => pool.some(item => item.id === id));
      setScriptRecommendedMaterialIds(recommendedIds.length ? recommendedIds : finalSelected);
      setLang('zh');
      setScriptType('storyboard');
      if (outputs[0]) {
        const spoken = extractVoiceoverText(outputs[0].script);
        setScript(outputs[0].script);
        setVoiceoverLines(spoken);
        setVoiceDrafts({ zh: spoken });
        setActiveVoiceLang('zh');
        setScriptView('timestamp');
        setActiveModeScriptId(outputs[0].id);
      }
      setModeScripts(outputs);
      setProjectTitle(projectTitle === '未命名草稿' ? '素材库智能素材 · 中文口播脚本' : projectTitle);
      setModeNotice(usedLocalFallback
        ? `后端/素材不可用，已自动打开本地兜底脚本；共 ${Math.max(1, sceneCount)} 个分镜，可继续编辑或补素材后重新生成。`
        : `已生成中文口播脚本，并按 ${Math.max(1, sceneCount)} 个分镜准备了 ${recommendedIds.length || finalSelected.length} 个素材候选，下一步可确认。`);
      autoGen.current = true;
    } catch (err: any) {
      setModeNotice(err?.message || '素材库生成失败，请稍后重试。');
    } finally {
      setModeActionLoading(false);
      setModeActionStatus('');
    }
  };

  const generateFromProductInfo = async () => {
    setModeActionLoading(true);
    setModeNotice('');
    setModeScripts([]);
    try {
      const product = activeProductInfo.trim();
      if (!product) {
        setModeNotice('请先填写或选择产品信息，再生成产品素材。');
        return;
      }
      const outputs: ModeScriptOutput[] = [];
      const count = Math.max(1, Math.min(5, cloneCount));
      let usedLocalFallback = false;
      for (let i = 0; i < count; i += 1) {
        let nextScript = '';
        let generatedByFallback = false;
        try {
          const response = await withTimeout(studioApi.script(
            {
              materials: [],
              productInfo: product,
              language: 'zh',
              platform,
              duration,
              scriptType: 'storyboard',
              generationMode: 'product',
              provider,
              audience,
              sellingPoints,
              tone: `${tone} · 产品方案 ${i + 1}`,
            },
            '',
          ), 45_000, '后端模型生成超过 45 秒。');
          nextScript = sanitizeStoryboardScript(response.script || '', product, activeProductLabel).trim();
          if (!nextScript || response.source === 'local') throw new Error('后端脚本生成接口未返回结果。');
        } catch (err: any) {
          const message = String(err?.message || '');
          if (message.includes('Demo') || message.includes('试用') || message.includes('额度') || message.includes('到期')) throw err;
          generatedByFallback = true;
          usedLocalFallback = true;
          nextScript = sanitizeStoryboardScript(buildLocalProductScript(product, 'zh', duration), product, activeProductLabel).trim();
        }
        outputs.push({
          id: `product-${Date.now()}-${i}`,
          title: `产品时间戳脚本 ${i + 1}${generatedByFallback ? '（本地兜底）' : ''}`,
          script: nextScript,
          mode: 'product',
        });
      }
      const firstScript = outputs[0]?.script || script;
      setLang('zh');
      setScriptType('storyboard');
      setScript(firstScript);
      const spoken = extractVoiceoverText(firstScript);
      setVoiceoverLines(spoken);
      setVoiceDrafts({ zh: spoken });
      setActiveVoiceLang('zh');
      setScriptView('timestamp');
      if (outputs[0]) setActiveModeScriptId(outputs[0].id);
      setModeScripts(outputs);
      try {
        const generated = await studioApi.seedanceVideo({
          script: firstScript,
          productInfo: product,
          language: 'zh',
          ratio,
          duration,
          title: `产品生成素材 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
        });
        if (!generated.ok || (!generated.material && !generated.url)) {
          throw new Error(generated.error || 'Seedance 2.0 生成素材失败');
        }
        const clip = generated.material
          ? materialToClip(generated.material)
          : {
              id: generated.id || `product-seedance-${Date.now()}`,
              name: generated.title || '产品生成素材',
              folder: 'upload',
              type: 'video' as const,
              duration: generated.duration || duration,
              size: 'Seedance 2.0',
              url: generated.url,
              poster: generated.poster,
              scope: 'own' as const,
            };
        setMaterials(prev => {
          const rest = prev.filter(item => item.id !== clip.id && (!clip.url || item.url !== clip.url));
          return [clip, ...rest];
        });
        setSelected([clip.id]);
        setActiveFolder(clip.folder || 'upload');
      } catch {
        usedLocalFallback = true;
      }
      setProjectTitle(projectTitle === '未命名草稿' ? '产品生成 · AI智能素材' : projectTitle);
      setModeNotice(usedLocalFallback
        ? '已自动打开产品信息本地兜底脚本；视频素材生成暂不可用，可先确认脚本或稍后重试生成素材。'
        : '已生成产品脚本和 Seedance 2.0 素材，已自动选中进入后续快剪流程。');
      autoGen.current = true;
    } catch (err: any) {
      setModeNotice(err?.message || '产品生成失败，请稍后重试。');
    } finally {
      setModeActionLoading(false);
    }
  };

  const applyTimestampScript = (value: string, productInfoOverride = activeProductInfo) => {
    const cleaned = sanitizeStoryboardScript(value, productInfoOverride, activeProductLabel);
    const spoken = extractVoiceoverText(cleaned);
    setScript(cleaned);
    setVoiceoverLines(spoken);
    setVoiceDrafts(drafts => ({ ...drafts, zh: spoken }));
    setActiveVoiceLang('zh');
    setLang('zh');
    setScriptView('timestamp');
  };

  const openModeScript = (item: ModeScriptOutput) => {
    setActiveModeScriptId(item.id);
    applyTimestampScript(item.script);
  };

  useEffect(() => {
    if (activeModeScriptId || !modeScripts.length) return;
    const firstForMode = modeScripts.find(item => item.mode === mode);
    if (firstForMode) setActiveModeScriptId(firstForMode.id);
  }, [activeModeScriptId, mode, modeScripts]);

  const generateTimestampScriptsForMode = async () => {
    if (mode !== 'clone' && (!activeProductInfo.trim() || !activeProductLabel)) {
      setModeNotice('请先在第一步选择企业中心产品，再生成整篇脚本。');
      setStepIdx(0);
      return;
    }
    if (mode === 'material') {
      await generateFromMaterialLibrary();
      return;
    }
    if (mode === 'product') {
      await generateFromProductInfo();
      return;
    }
    const cloneProductInfo = activeProductInfo.trim()
      || videoKickoff?.productInfo?.trim()
      || script.trim()
      || '当前爆款复刻脚本';
    const cloneProductLabel = activeProductLabel || selectedProductLabel(cloneProductInfo);
    if (mode === 'clone' && !activeProductInfo.trim()) {
      setModeNotice('未读取到企业中心产品信息，已先基于当前脚本和对标结构重新生成。建议回到第一步选择产品后再生成更精准版本。');
    }
    setModeActionLoading(true);
    if (activeProductInfo.trim()) setModeNotice('');
    setModeActionStatus(mode === 'clone' ? '真实生成中…' : '');
    try {
      const cloneReference = videoKickoff || { referenceAnalysis: { details: [] }, video: { title: '本地爆款结构兜底' } };
      const targetCodes = cloneOutputMode === 'languages'
        ? uniqueLangs(lang, cloneCount)
        : Array.from({ length: cloneCount }, () => lang || 'zh');
      const outputs: ModeScriptOutput[] = [];
      let usedLocalFallback = !videoKickoff;
      let localFallbackReason = !videoKickoff ? '没有读取到对标视频分析' : '';
      for (let index = 0; index < targetCodes.length; index += 1) {
        const code = targetCodes[index] || 'zh';
        const existingCloneScripts = [
          ...modeScripts.filter(item => item.mode === 'clone').map(item => item.script),
          ...outputs.map(item => item.script),
        ];
        const existingCloneCount = modeScripts.filter(item => item.mode === 'clone').length;
        const variantSeed = existingCloneCount + index;
        setModeActionStatus(`真实生成中 ${index + 1}/${targetCodes.length}，通常 10-30 秒，最多等待 45 秒…`);
        let generatedScript = '';
        let generatedByFallback = !videoKickoff;
        if (!generatedByFallback) try {
	          const response = await withTimeout(studioApi.script(
            {
              materials: cloneReference.video?.platform ? [`平台：${cloneReference.video.platform}`] : [],
              productInfo: cloneProductInfo,
              language: code,
              platform,
              duration,
              scriptType: 'storyboard',
              generationMode: 'clone',
              provider,
              audience,
              sellingPoints,
              tone: `${tone} · 爆款复刻 · 第 ${variantSeed + 1} 版差异化脚本 · 必须换一个 hook 角度、场景动作和台词表达，不得复用已有版本 · 每段只讲一个信息点 · 前12秒不塞MOQ认证报价`,
              referenceTitle: cloneReference.video?.title || '',
              referenceAnalysis: cloneReferenceAnalysisText(cloneReference),
              referenceHighlights: cloneReferenceHighlights(cloneReference),
            },
            '',
          ), 45_000, '后端模型生成超过 45 秒，请稍后重试。');
	          const normalized = ensureDistinctCloneStoryboard({
            script: response.script || '',
            kickoff: cloneReference,
            productInfo: cloneProductInfo,
            languageCode: code,
            strictProductName: cloneProductLabel,
            existingScripts: existingCloneScripts,
            variantSeed,
          });
          generatedScript = normalized.script;
          if (normalized.normalized) {
            usedLocalFallback = true;
            localFallbackReason = '后端返回脚本未满足标准分镜字段或与已有脚本重复，已自动生成差异化标准分镜稿';
          }
          if (!generatedScript || response.source === 'local') {
            throw new Error(response.source === 'local' ? '后端脚本生成接口未返回结果。' : '模型没有返回可用脚本。');
          }
        } catch (err: any) {
          const message = String(err?.message || '');
          if (message.includes('Demo') || message.includes('试用') || message.includes('额度') || message.includes('到期')) throw err;
          localFallbackReason = message || '后端重生成没有返回可用脚本';
          generatedScript = ensureDistinctCloneStoryboard({
            script: '',
            kickoff: cloneReference,
            productInfo: cloneProductInfo,
            languageCode: code,
            strictProductName: cloneProductLabel,
            existingScripts: existingCloneScripts,
            variantSeed,
          }).script;
          generatedByFallback = true;
          usedLocalFallback = true;
        }
        if (generatedByFallback) {
          generatedScript = ensureDistinctCloneStoryboard({
            script: generatedScript,
            kickoff: cloneReference,
            productInfo: cloneProductInfo,
            languageCode: code,
            strictProductName: cloneProductLabel,
            existingScripts: existingCloneScripts,
            variantSeed,
          }).script;
        }
        outputs.push({
          id: `clone-${Date.now()}-${index}`,
          title: `爆款复刻时间戳脚本 ${existingCloneCount + index + 1}${generatedByFallback ? '（本地兜底）' : ''}`,
          script: generatedScript,
          mode: 'clone',
        });
      }
      const firstNewScript = outputs[0];
      setModeScripts(prev => [...prev, ...outputs]);
      if (firstNewScript) {
        setActiveModeScriptId(firstNewScript.id);
        applyTimestampScript(firstNewScript.script);
      }
      setModeNotice(usedLocalFallback
        ? `已生成标准分镜稿（${localFallbackReason || '模型暂未返回可用脚本'}），格式已统一为环境/景别/运镜/画面/配乐/台词/字幕。`
        : '已真实调用后端，按爆款结构和产品卖点生成标准分镜脚本。');
      autoGen.current = true;
    } catch (err: any) {
      setModeNotice(err?.message || 'AI 复刻生成失败，请稍后重试。');
    } finally {
      setModeActionLoading(false);
      setModeActionStatus('');
    }
  };

  useEffect(() => {
    if (!pendingRealCloneGeneration || mode !== 'clone' || !videoKickoff || modeActionLoading) return;
    if (!activeProductInfo.trim() || !activeProductLabel) return;
    setPendingRealCloneGeneration(false);
    void generateTimestampScriptsForMode();
  }, [activeProductInfo, activeProductLabel, mode, modeActionLoading, pendingRealCloneGeneration, videoKickoff]);

  const optimizeCurrentTimestampScript = async () => {
    const currentScript = script.trim();
    if (!currentScript || modeActionLoading) return;
    setModeActionLoading(true);
    setModeNotice('');
    try {
      const response = await studioApi.script(
        {
          materials: matNames,
          productInfo: activeProductInfo,
          language: 'zh',
          platform,
          duration,
          scriptType: 'storyboard',
          generationMode: mode,
          provider,
          audience,
          sellingPoints,
          tone: [
            tone,
            mode === 'clone' ? '基于当前脚本重新思考，生成一版更自然的新标准分镜脚本' : '优化当前时间戳脚本',
            '保留原有时间段结构',
            mode === 'clone' ? '每段必须包含环境/景别/运镜/画面/配乐/台词/字幕' : '每段必须包含时间/画面/人物说/字幕',
            mode === 'clone' ? '台词必须是真人能直接说出口的买家痛点、需求洞察、证明点或CTA' : '人物说必须是真人能直接说出口的话',
            '不得加入镜头、画面、字幕、参考节奏等制作指令到台词或人物说',
            '不得编造未提供的数据',
          ].filter(Boolean).join(' · '),
          referenceTitle: mode === 'clone' ? videoKickoff?.video?.title || '' : '',
          referenceAnalysis: mode === 'clone' && videoKickoff ? cloneReferenceAnalysisText(videoKickoff) : '',
          referenceHighlights: mode === 'clone' && videoKickoff ? cloneReferenceHighlights(videoKickoff) : [],
        },
        currentScript,
      );
      const optimized = response.script || '';
      const sanitizedOptimized = mode === 'clone'
        ? ensureDistinctCloneStoryboard({
          script: optimized,
          kickoff: videoKickoff || { referenceAnalysis: { details: [] } },
          productInfo: activeProductInfo,
          languageCode: 'zh',
          strictProductName: activeProductLabel,
          existingScripts: modeScripts.filter(item => item.mode === 'clone' && item.id !== activeModeScriptId).map(item => item.script),
          variantSeed: modeScripts.filter(item => item.mode === 'clone').findIndex(item => item.id === activeModeScriptId) + 1,
        }).script
        : sanitizeStoryboardScript(optimized, activeProductInfo, activeProductLabel);
      applyTimestampScript(sanitizedOptimized);
      setModeNotice(mode === 'clone'
        ? '已按当前产品信息和标准分镜字段优化脚本。'
        : '已按当前产品信息和口播约束优化脚本。');
      if (modeScripts[0]) setActiveModeScriptId(modeScripts[0].id);
      setModeScripts(prev => prev.map((item, index) => index === 0 ? { ...item, script: sanitizedOptimized, title: `${item.title}（已优化）` } : item));
    } catch (err: any) {
      setModeNotice(err?.message || '脚本优化失败，请稍后重试。');
    } finally {
      setModeActionLoading(false);
    }
  };

  const extractVoiceoverText = (value: string) => {
    return formatVoiceoverWithTimestamps(value);
  };

  const generateVoiceDrafts = async () => {
    const sourceText = scriptView === 'voiceover' ? (voiceoverLines || script) : script;
    const base = extractVoiceoverText(sourceText);
    setVoiceoverLines(base);
    setVoiceDraftLoading(true);
    setVoiceDraftNotice(`正在提取口播，并生成 ${voiceLangs.length || 1} 个语种字幕...`);
    try {
      if (!base.trim()) {
        setVoiceDraftNotice('当前脚本里没有可提取的口播台词，请先生成时间戳脚本或手动填写口播台词。');
        return;
      }
      const langs = voiceLangs.length ? voiceLangs : ['zh'];
      const immediate: Record<string, string> = {};
      for (const code of langs) {
        immediate[code] = code === 'zh' ? base : '';
      }
      setVoiceDrafts(immediate);
      setActiveVoiceLang(langs[0] || 'zh');
      setLang(langs[0] || 'zh');
      setScriptView('voiceover');
      setVoiceDraftNotice(`已提取中文口播，正在批量翻译 ${langs.filter(code => code !== 'zh').length} 个语种...`);

      const improved: Record<string, string> = { ...immediate };
      const targets = langs.filter(code => code !== 'zh');
      const failedLangs: string[] = [];
      let translateError = '';
      if (targets.length) {
        const translated = await studioApi.translateBatch({ text: base, targets, source: 'zh' })
          .catch((err: any) => ({ ok: false, translations: {} as Record<string, string>, error: err?.message || '请求失败' }));
        translateError = translated.error || '';
        for (const code of targets) {
          const raw = translated.translations?.[code] || '';
          const normalized = raw.trim()
            ? normalizeTranslatedVoiceover(base, raw, code)
            : '';
          if (normalized.trim()) {
            improved[code] = normalized;
          } else {
            failedLangs.push(code);
          }
        }
        setVoiceDrafts(improved);
      }
      setVoiceDraftNotice(failedLangs.length
        ? `已提取中文口播；${failedLangs.map(code => LANGS.find(item => item.code === code)?.label || code).join('、')} 翻译失败：${translateError || '模型未返回有效译文'}。`
        : `已生成 ${langs.length || 1} 个语种字幕。`);
    } catch (err: any) {
      setVoiceDraftNotice(err?.message || '多语种字幕生成失败，请稍后重试。');
    } finally {
      setVoiceDraftLoading(false);
    }
  };

  // 脚本生成入口集中在「口播脚本」页按钮，避免进入步骤时自动覆盖用户已编辑内容。

  const switchScriptType = (type: 'voiceover' | 'storyboard') => {
    if (type === scriptType) return;
    setScriptType(type);
    void regenScript(type);
  };


  const regenCovers = async () => {
    setCoverLoading(true);
    try {
      const { covers } = await studioApi.covers({ script, productInfo: activeProductInfo, language: lang, provider, tone }, [coverTitle]);
      if (covers[0]) setCoverTitle(covers[0]);
    } catch (err: any) {
      alert(err?.message || '封面标题生成失败，请稍后重试。');
    } finally {
      setCoverLoading(false);
    }
  };

  const openCanvaCoverEditor = async () => {
    setCoverCanvaOpening(true);
    const openCanva = () => {
      const popup = window.open(CANVA_VIDEO_COVER_URL, 'lingshu-canva-cover');
      if (popup) {
        popup.opener = null;
        popup.focus();
      } else {
        window.location.assign(CANVA_VIDEO_COVER_URL);
      }
    };
    try {
      let nextCoverUrl = coverUrl;
      const canGenerateCoverSvg = Boolean(coverFrameUrl && (coverClip?.poster || coverClip?.type === 'image'));
      if (!nextCoverUrl && canGenerateCoverSvg) {
        const cv = await studioApi.cover({ title: coverTitle, ratio, accent: TRAFFIC_GREEN, bgImageUrl: coverFrameUrl, ...coverStyle });
        if (cv.url) {
          nextCoverUrl = cv.url;
          setCoverUrl(cv.url);
        }
      }
      rememberCanvaCoverReturn(nextCoverUrl);
      const fullCoverUrl = nextCoverUrl ? `${window.location.origin}${nextCoverUrl}` : '';
      await navigator.clipboard?.writeText?.([
        `封面标题：${coverTitle}`,
        fullCoverUrl ? `封面参考图：${fullCoverUrl}` : '',
      ].filter(Boolean).join('\n'));
      openCanva();
    } catch (err: any) {
      rememberCanvaCoverReturn(coverUrl);
      openCanva();
      if (err?.message) console.warn('Open Canva cover editor failed:', err.message);
    } finally {
      setCoverCanvaOpening(false);
    }
  };

  // 封面标题中文翻译（非中文目标语言时，进入封面步后自动翻译，给用户确认）
  useEffect(() => {
    if (step !== 'cover' || lang === 'zh' || !coverTitle.trim()) { setCoverTitleZh(''); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await studioApi.translate({ text: coverTitle, target: 'zh' });
      if (!cancelled && r.ok && r.text) setCoverTitleZh(r.text);
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverTitle, lang, step]);

  // 官方导入字体模版（.ttf/.otf/.woff/.woff2）：注册为可用字体
  const importFont = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const family = `custom-${f.name.replace(/\.[^.]+$/, '').replace(/\W+/g, '-')}-${Date.now()}`;
      const face = new FontFace(family, buf);
      await face.load();
      (document.fonts as FontFaceSet).add(face);
      setCustomFonts(list => [...list, { family, label: f.name.replace(/\.[^.]+$/, '') }]);
      setCoverStyle(s => ({ ...s, fontFamily: family }));
    } catch { /* 字体加载失败忽略 */ }
  };

  // 双语字幕：进入预览且开启双语时，翻译各 cue（目标语言为中文则无需翻译）
  useEffect(() => {
    if (step !== 'preview' || !subtitlesOn || subMode !== 'bilingual' || lang === 'zh' || cues.length === 0) {
      setCueZh([]); return;
    }
    let cancelled = false;
    (async () => {
      const zh = await Promise.all(cues.map(c => studioApi.translate({ text: c.text, target: 'zh' }).then(r => (r.ok ? r.text : ''))));
      if (!cancelled) setCueZh(zh);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, subtitlesOn, subMode, lang, cues]);

  // cue 数量变化时，把预览高亮夹回有效范围
  useEffect(() => { if (subPreviewIdx >= cues.length) setSubPreviewIdx(0); }, [cues.length, subPreviewIdx]);

  // 成片预览：开始 / 结束顺序播放
  const clearPreviewAdvanceTimer = () => {
    if (previewAdvanceTimerRef.current !== null) {
      window.clearTimeout(previewAdvanceTimerRef.current);
      previewAdvanceTimerRef.current = null;
    }
  };
  const startPreview = () => {
    if (rendering) return;
    if (previewTimeline.length === 0) { setPreviewNote(true); return; }
    setPreviewNote(false);
    setPreviewTime(0);
    setPreviewIdx(0);
  };
  const previewLanguageVersion = (code: string) => {
    const audio = voiceoverMode === 'ai' ? voiceoverAudios[code] : { url: voiceoverUrl || '', duration: voiceoverDur };
    setActiveVoiceLang(code);
    setLang(code);
    if (audio?.url) {
      setVoiceoverMode(voiceoverMode === 'none' ? 'ai' : voiceoverMode);
      setVoiceoverUrl(audio.url);
      setVoiceoverDur(audio.duration || 0);
    }
    setSubPreviewIdx(0);
    setRenderDownloadMessage('');
    if (previewTimeline.length === 0) {
      setPreviewNote(true);
      return;
    }
    setPreviewNote(false);
    setPreviewTime(0);
    setPreviewIdx(0);
  };
  const stopPreview = () => {
    clearPreviewAdvanceTimer();
    setPreviewIdx(null);
    setPreviewTime(0);
    [previewBgmAudioRef.current, previewVoiceAudioRef.current].forEach(el => {
      if (!el) return;
      el.pause();
      el.currentTime = 0;
    });
  };
  const handlePreviewClipEnded = () => {
    clearPreviewAdvanceTimer();
    setPreviewIdx(i => {
      if (i !== null && i + 1 < previewTimeline.length) return i + 1;
      [previewBgmAudioRef.current, previewVoiceAudioRef.current].forEach(el => {
        if (!el) return;
        el.pause();
        el.currentTime = 0;
      });
      return null;
    });
  };
  const pausePreviewAudio = () => {
    [previewBgmAudioRef.current, previewVoiceAudioRef.current].forEach(el => el?.pause());
  };
  const resumePreviewAudio = () => {
    if (!previewPlaying) return;
    [previewBgmAudioRef.current, previewVoiceAudioRef.current].forEach(el => {
      if (el && el.src && el.volume > 0) void el.play().catch(() => {});
    });
  };
  const previewPlaying = previewIdx !== null;
  useEffect(() => {
    clearPreviewAdvanceTimer();
    if (previewIdx === null) return;
    const item = previewTimeline[previewIdx];
    if (!item) {
      setPreviewIdx(null);
      return;
    }
    const durationMs = Math.max(0.5, item.targetDuration || ((item.trimEnd || 0) - (item.trimStart || 0)) || 3) * 1000;
    setPreviewTime(previewOffsetByIndex[previewIdx] || 0);
    if (item.clip.type === 'image') {
      previewAdvanceTimerRef.current = window.setTimeout(handlePreviewClipEnded, durationMs);
      return () => clearPreviewAdvanceTimer();
    }
    const video = previewVideoRef.current;
    if (video) {
      video.playbackRate = Math.max(0.25, Math.min(item.speed || 1, 4));
      const seekTo = Math.max(0, item.trimStart || 0);
      const applySeek = () => {
        try {
          if (Number.isFinite(video.duration) && video.duration > seekTo) video.currentTime = seekTo;
          else video.currentTime = seekTo;
        } catch { /* ignore browser seek edge cases */ }
        void video.play().catch(() => {});
      };
      if (video.readyState >= 1) applySeek();
      else video.onloadedmetadata = applySeek;
    }
    previewAdvanceTimerRef.current = window.setTimeout(handlePreviewClipEnded, durationMs);
    return () => clearPreviewAdvanceTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewIdx, previewOffsetByIndex, previewTimeline]);
  const updatePreviewClock = () => {
    if (previewIdx === null) return;
    const item = previewTimeline[previewIdx];
    if (!item) return;
    const base = previewOffsetByIndex[previewIdx] || 0;
    if (item.type === 'image') {
      setPreviewTime(base);
      return;
    }
    const video = previewVideoRef.current;
    const trimStart = item.trimStart || 0;
    const speed = Math.max(0.25, Math.min(item.speed || 1, 4));
    const local = video ? Math.max(0, (video.currentTime || trimStart) - trimStart) / speed : 0;
    setPreviewTime(base + local);
  };
  useEffect(() => {
    const bgmEl = previewBgmAudioRef.current;
    const voiceEl = previewVoiceAudioRef.current;
    const bgmUrl = selectedBgmTrack?.url || '';
    const currentVoiceUrl = voiceoverMode === 'none' ? '' : voiceoverUrl || '';
    const bgmGain = Math.max(0, Math.min(1, (bgmVol || 0) / 100)) * (currentVoiceUrl ? 0.5 : 1);
    const voiceGain = Math.max(0, Math.min(1, (voiceVol || 0) / 100));

    if (bgmEl) {
      bgmEl.volume = bgmUrl ? bgmGain : 0;
      bgmEl.loop = true;
    }
    if (voiceEl) {
      voiceEl.volume = currentVoiceUrl ? voiceGain : 0;
    }
    if (!previewPlaying) return;

    if (bgmEl && bgmUrl && bgmGain > 0) {
      if (bgmEl.src !== new URL(bgmUrl, window.location.href).href) bgmEl.src = bgmUrl;
      bgmEl.currentTime = 0;
      void bgmEl.play().catch(() => {});
    }
    if (voiceEl && currentVoiceUrl && voiceGain > 0) {
      if (voiceEl.src !== new URL(currentVoiceUrl, window.location.href).href) voiceEl.src = currentVoiceUrl;
      voiceEl.currentTime = 0;
      void voiceEl.play().catch(() => {});
    }
  }, [bgmVol, previewPlaying, selectedBgmTrack, voiceVol, voiceoverMode, voiceoverUrl]);
  // 离开预览步时停止播放
  useEffect(() => {
    if (step !== 'preview') {
      stopPreview();
      setPreviewNote(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // 导出 / 我的作品
  const openRenderOutputFolder = async (filePath = renderOutputPath) => {
    if (!filePath) return false;
    const desktop = getDesktopRender();
    if (desktop?.showItemInFolder) {
      const result = await desktop.showItemInFolder(filePath);
      if (result?.ok) return true;
    }
    const opened = await studioApi.openRenderOutput(filePath);
    if (!opened.ok) {
      const message = opened.error || '打开本地文件夹失败，请手动前往保存路径查看。';
      setRenderDownloadMessage(message);
      if (/不存在|重新导出|not found|404/i.test(message)) setRenderOutputPath(null);
      return false;
    }
    return true;
  };

  const downloadMp4 = async () => {
    if (rendering) return;
    if (renderOutputPath) {
      const opened = await openRenderOutputFolder(renderOutputPath);
      if (opened) setRenderDownloadMessage(`成片已保存到本地：${renderOutputPath}`);
      return;
    }
    setRenderDownloadMessage('');
    try {
      const outputPath = await goPreview();
      setRenderDownloadMessage(outputPath
        ? `成片已保存到本地：${outputPath}`
        : '本地导出未返回文件路径，请确认后端服务和 ffmpeg 可用后重试。');
    } catch (err: any) {
      setRenderDownloadMessage(err?.message || '成片下载失败，请稍后重试。');
    }
  };
  const saveToWorks = async () => {
    await saveProject('published'); // status=published → 进入「我的作品」
    setSavedToWorks(true);
    setTimeout(() => setSavedToWorks(false), 2200);
  };

  const buildCapcutPayload = () => ({
    materials: (renderTimeline.length
      ? renderTimeline.map(item => {
        const clip = materialById.get(item.clipId || '') || materials.find(candidate => candidate.name === item.name);
        return {
          name: item.name,
          url: clip?.url,
          type: clip?.type || 'video',
          duration: clip?.duration || item.targetDuration || 0,
          edit: {
            trimStart: item.trimStart || 0,
            trimEnd: item.trimEnd || item.targetDuration || 0,
            speed: item.speed || 1,
            transition: '硬切',
            note: `${item.targetStart ?? 0}s-${item.targetEnd ?? item.targetDuration ?? 0}s`,
          },
        };
      })
      : selectedClips.map(c => ({ name: c.name, url: c.url, type: c.type, duration: c.duration, edit: editFor(c) }))),
    timeline: renderTimeline,
    cues: subMode === 'bilingual' ? cues.map((c, i) => ({ ...c, zh: cueZh[i] })) : cues,
    subMode,
    bgm: selectedBgmTrack ? { id: selectedBgmTrack.id, name: selectedBgmTrack.name, url: selectedBgmTrack.url || '', volume: bgmVol } : null,
    voiceover: voiceoverMode === 'none' || !voiceoverUrl ? null : { mode: voiceoverMode, url: voiceoverUrl, duration: voiceoverDur, volume: voiceVol },
    coverTitle,
    ratio,
    language: lang,
    script,
  });

  // 用剪映精修：导出素材包后打开剪映，并在允许辅助功能权限时自动点击「开始创作」创建新草稿。
  const openInCapcut = async () => {
    setCapcutOpening(true);
    setCapcutMessage('');
    try {
      const payload = buildCapcutPayload();
      const bridge = getDesktopRender();
      const out = bridge?.openInCapcut
        ? await bridge.openInCapcut(payload)
        : await studioApi.openCapcut(payload);
      if (out.ok) {
        if (out.draftCreated) {
          setCapcutMessage(out.dir
            ? `已导出剪映精修包并在剪映创建新草稿：${out.dir}。请在新草稿里导入 assets 文件夹素材和 subtitles.srt。`
            : '已打开剪映并创建新草稿。');
        } else {
          setCapcutMessage(out.error || out.createDraftError || (out.dir
            ? `已导出剪映精修包并打开剪映：${out.dir}。但未能自动创建新草稿，请确认辅助功能权限后重试。`
            : '已打开剪映，但未能自动创建新草稿。'));
        }
        return;
      }
      setCapcutMessage(out.error || '剪映精修包导出失败，请确认本机已安装剪映/CapCut，或稍后重试。');
    } catch (err: any) {
      setCapcutMessage(err?.message || '剪映精修包导出失败，请确认本机已安装剪映/CapCut，或稍后重试。');
    } finally {
      setCapcutOpening(false);
    }
  };

  const goPublishCurrentWork = () => {
    onGoPublish?.({
      videoPath: renderOutputPath || '',
      title: projectTitle.trim() || coverTitle || 'AI 快剪成片',
      description: caption.trim() || activeSpokenScript,
      ratio,
    });
  };

  const aiCaption = async () => {
    setCaptionLoading(true);
    try {
      const { caption: cap, hashtags } = await studioApi.caption(
        { script, productInfo: activeProductInfo, platform, language: lang, provider, audience, sellingPoints, tone },
        { caption, hashtags: [] },
      );
      const tags = (hashtags ?? []).map(t => `#${t.replace(/^#/, '')}`).join(' ');
      setCaption(tags ? `${cap} ${tags}` : cap);
    } catch (err: any) {
      alert(err?.message || '发布文案生成失败，请稍后重试。');
    } finally {
      setCaptionLoading(false);
    }
  };

  const generatePosterBrief = async () => {
    setPosterLoading(true);
    setModeNotice('');
    try {
      const selectedMaterials = selectedClips.slice(0, 8).map(item => ({
        id: item.id,
        name: item.name,
        type: item.type,
        folder: item.folder,
        role: materialRoleLabel(item),
      }));
      const result = await studioApi.fbPoster({
        mode,
        productInfo: activeProductInfo,
        platform,
        ratio,
        posterStyle,
        language: lang,
        provider,
        materials: selectedMaterials,
        referenceNotes: mode === 'clone' && videoKickoff ? cloneReferenceAnalysisText(videoKickoff) : '',
      });
      if (!result.ok && !result.poster?.headline) throw new Error(result.error || '海报文案生成失败');
      setPosterDraft(result);
      setPosterJsonText(JSON.stringify(result.poster, null, 2));
      const tags = (result.hashtags || []).map(tag => `#${String(tag).replace(/^#/, '')}`).join(' ');
      setCaption([result.caption, tags].filter(Boolean).join(' '));
      setModeNotice(result.fieldsToConfirm?.length
        ? `已生成海报文案 JSON；请确认：${result.fieldsToConfirm.join('、')}`
        : '已生成海报文案 JSON 和发布配文。');
    } catch (err: any) {
      setModeNotice(err?.message || '海报文案生成失败，请稍后重试。');
    } finally {
      setPosterLoading(false);
    }
  };

  const demoAutoCreate = async () => {
    setDemoAutoLoading(true);
    try {
      if (selected.length === 0) setSelected(materials.slice(0, 3).map(m => m.id));
      const matNamesForDemo = selected.length > 0
        ? materials.filter(m => selected.includes(m.id)).map(m => m.name)
        : materials.slice(0, 3).map(m => m.name);
      const scriptResp = await studioApi.script(
        { materials: matNamesForDemo, productInfo: activeProductInfo, language: lang, platform, duration, scriptType, provider, audience, sellingPoints, tone },
        script,
      );
      setScript(scriptResp.script);
      const coversResp = await studioApi.covers({ script: scriptResp.script, productInfo: activeProductInfo, language: lang, provider, tone }, [coverTitle]);
      if (coversResp.covers[0]) setCoverTitle(coversResp.covers[0]);
      const cap = await studioApi.caption(
        { script: scriptResp.script, productInfo: activeProductInfo, platform, language: lang, provider, audience, sellingPoints, tone },
        { caption, hashtags: [] },
      );
      const tags = (cap.hashtags ?? []).map(t => `#${t.replace(/^#/, '')}`).join(' ');
      setCaption(tags ? `${cap.caption} ${tags}` : cap.caption);
      await goPreview(scriptResp.script);
    } catch (err: any) {
      alert(err?.message || 'Demo 自动生成失败，请稍后重试。');
    } finally {
      setDemoAutoLoading(false);
    }
  };

  /* ── 素材库：只拉取真实素材 ──────────────────────── */
  const refreshMaterials = async () => {
    const real = await studioApi.listMaterials();
    setMaterials(real.map(materialToClip));
  };
  useEffect(() => { void refreshMaterials(); }, []);

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const uploadedIds: string[] = [];
    const targetFolder = activeFolder && !['all', 'hot', 'recommend'].includes(activeFolder) ? activeFolder : 'upload';
    for (const f of Array.from(files)) {
      try {
        const [dataBase64, duration] = await Promise.all([fileToDataUrl(f), probeDuration(f)]);
        const { material } = await studioApi.uploadMaterial({
          name: f.name, folder: targetFolder, type: mediaType(f), duration, dataBase64, mimeType: f.type,
        });
        if (material?.id) uploadedIds.push(material.id);
      } catch { /* 单个失败不影响其它 */ }
    }
    await refreshMaterials();
    if (uploadedIds.length) {
      setSelected(s => [...s, ...uploadedIds]);  // 上传完自动选中
      setActiveFolder(targetFolder);
    }
    setUploading(false);
  };

  const generateDigitalHumanPresenter = async () => {
    const source = materials.find(c => c.folder === 'presenter' && selected.includes(c.id) && c.type === 'video')
      || materials.find(c => c.folder === 'presenter' && c.type === 'video');
    if (!source?.url) {
      setDigitalHumanNotice('请先在「真人口播」文件夹上传或选择一条真人实拍视频。');
      return;
    }
    setDigitalHumanLoading(true);
    setDigitalHumanNotice('');
    try {
      const blob = await fetch(source.url).then(r => {
        if (!r.ok) throw new Error('读取真人实拍视频失败');
        return r.blob();
      });
      const dataBase64 = await blobToDataUrl(blob);
      const { material } = await studioApi.uploadMaterial({
        name: `数字人口播 · ${source.name}`,
        folder: 'presenter',
        type: 'video',
        duration: source.duration,
        dataBase64,
        mimeType: blob.type || 'video/mp4',
      });
      await refreshMaterials();
      if (material?.id) setSelected(s => [...s.filter(id => id !== source.id), material.id]);
      setActiveFolder('presenter');
      setDigitalHumanNotice('已生成数字人口播素材，可直接选中进入后续快剪流程。');
    } catch (err: any) {
      setDigitalHumanNotice(err?.message || '数字人口播生成失败，请稍后重试。');
    } finally {
      setDigitalHumanLoading(false);
    }
  };

  /* ── BGM 曲库 ────────────────────────────────────────────────────────── */
  const refreshBgm = async () => {
    const list = await studioApi.listBgm();
    setBgms(list as Bgm[]);
  };
  useEffect(() => { void refreshBgm(); }, []);
  useEffect(() => {
    try {
      localStorage.setItem('ow_favorite_bgms', JSON.stringify(favoriteBgms));
    } catch {
      // Embedded browsers can disable localStorage; favorites simply become session-only.
    }
  }, [favoriteBgms]);

  // 离开配乐步骤时停止试听
  useEffect(() => {
    if (step !== 'bgm' && audioRef.current) {
      audioRef.current.pause();
      setPlayingBgm(null);
    }
  }, [step]);

  const togglePlay = (track: Bgm) => {
    if (!track.url) return;
    const el = audioRef.current;
    if (!el) return;
    if (playingBgm === track.id) {
      el.pause();
      setPlayingBgm(null);
      return;
    }
    el.src = track.url;
    void el.play().then(() => setPlayingBgm(track.id)).catch(() => setPlayingBgm(null));
  };

  const toggleFavoriteBgm = (id: string) => {
    setFavoriteBgms(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const handleBgmUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBgmUploading(true);
    const f = files[0];
    try {
      const dataBase64 = await fileToDataUrl(f);
      const { track } = await studioApi.uploadBgm({ name: f.name, dataBase64, mimeType: f.type });
      await refreshBgm();
      if (track?.id) setBgm(track.id);
    } catch { /* ignore */ }
    setBgmUploading(false);
  };

  /* ── 配音 TTS ────────────────────────────────────────────────────────── */
  const clearVoiceover = () => {
    setVoiceoverMode('none');
    setVoiceoverUrl(null);
    setVoiceoverDur(0);
    setVoiceoverAudios({});
    setUploadedVoiceName('');
    setTtsNotice('');
    setTtsPlaying(false);
    if (ttsAudioRef.current) ttsAudioRef.current.pause();
  };

  const handleVoiceoverUpload = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setTtsLoading(true);
    try {
      const [dataBase64, duration] = await Promise.all([fileToDataUrl(f), probeAudioDuration(f)]);
      const r = await studioApi.uploadVoiceover({ name: f.name, dataBase64, mimeType: f.type, duration });
      if (!r.ok || !r.url) throw new Error(r.error || '口播音频上传失败');
      setVoiceoverMode('upload');
      setVoiceoverUrl(r.url);
      setVoiceoverDur(r.duration || duration);
      setVoiceoverAudios({ [activeVoiceLang || 'zh']: { url: r.url, duration: r.duration || duration } });
      setUploadedVoiceName(f.name);
      setSubtitlesOn(true);
      setSubMode('target');
    } catch (err: any) {
      alert(err?.message || '口播音频上传失败，请稍后重试。');
    } finally {
      setTtsLoading(false);
    }
  };

  const handleVoiceSampleUpload = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setTtsLoading(true);
    try {
      const [dataBase64, duration] = await Promise.all([fileToDataUrl(f), probeAudioDuration(f)]);
      const r = await studioApi.uploadVoiceSample({ name: f.name, dataBase64, mimeType: f.type, duration });
      if (!r.ok || !r.voiceId) throw new Error(r.error || '真人音色录入失败');
      setVoice(r.voiceId);
      setCustomVoiceId(r.voiceId);
      setCustomVoiceName(r.name || f.name);
      setCustomVoiceUrl(r.url || '');
      setVoiceoverMode('ai');
      setVoiceoverUrl(null);
      setVoiceoverAudios({});
      setTtsNotice('已录入真人音色。生成配音时会优先走 MiniMax 真人音色克隆；未配置 MiniMax 时可用 XTTS/Coqui 兜底。');
    } catch (err: any) {
      alert(err?.message || '真人音色录入失败，请检查音频文件后重试。');
    } finally {
      setTtsLoading(false);
    }
  };

  const genTts = async () => {
    setTtsLoading(true);
    setTtsNotice(`正在生成 ${voiceLangs.length || 1} 个语种配音...`);
    setVoiceoverUrl(null);
    setVoiceoverAudios({});
    try {
      const langs = voiceLangs.length ? voiceLangs : ['zh'];
      const base = voiceDrafts.zh || voiceoverLines || extractVoiceoverText(script) || script;
      const drafts: Record<string, string> = { ...voiceDrafts, zh: voiceDrafts.zh || base };
      const missingTranslationLangs: string[] = [];
      const targetsToTranslate: string[] = [];
      for (const code of langs) {
        if (drafts[code]?.trim()) continue;
        if (code === 'zh') {
          drafts.zh = base;
        } else {
          targetsToTranslate.push(code);
        }
      }
      if (targetsToTranslate.length) {
        const translated = await studioApi.translateBatch({ text: base, targets: targetsToTranslate, source: 'zh' })
          .catch((err: any) => ({ ok: false, translations: {} as Record<string, string>, error: err?.message || '请求失败' }));
        for (const code of targetsToTranslate) {
          const raw = translated.translations?.[code] || '';
          const normalized = raw.trim()
            ? normalizeTranslatedVoiceover(base, raw, code)
            : '';
          if (normalized.trim()) drafts[code] = normalized;
          else missingTranslationLangs.push(`${code}:${translated.error || '模型未返回有效译文'}`);
        }
      }
      setVoiceoverLines(base);
      setVoiceDrafts(drafts);

      const audios: Record<string, { url: string; duration: number }> = {};
      const failures: string[] = [];
      const availableLangs = langs.filter(code => drafts[code]?.trim());
      const batchItems = availableLangs.map(code => ({ code, language: code, text: stripVoiceoverTimestamps(drafts[code]) }));
      const batch = await studioApi.ttsBatch({ voice, items: batchItems });
      if (batch.ok) {
        for (const code of availableLangs) {
          const item = batch.audios?.[code];
          if (item?.ok && item.url) {
            audios[code] = { url: item.url, duration: item.duration ?? 0 };
          } else {
            const label = LANGS.find(langItem => langItem.code === code)?.label || code;
            failures.push(`${label}：${item?.error || '未返回音频'}`);
          }
        }
      } else {
        for (const code of availableLangs) {
          const text = drafts[code];
          const r = await studioApi.tts({ text: stripVoiceoverTimestamps(text), voice, language: code });
          if (r.ok && r.url) {
            audios[code] = { url: r.url, duration: r.duration ?? 0 };
          } else {
            const label = LANGS.find(item => item.code === code)?.label || code;
            failures.push(`${label}：${r.error || (r.source === 'local' ? '后端连接失败或额度不可用' : '未返回音频')}`);
          }
        }
      }
      const activeCode = langs.includes(activeVoiceLang) ? activeVoiceLang : langs[0] || 'zh';
      const activeAudio = audios[activeCode] || Object.values(audios)[0];
      if (!activeAudio) {
        throw new Error(failures[0] || '没有生成可用配音，请检查 TTS Key 或试用额度。');
      }
      setVoiceoverMode('ai');
      setVoiceoverAudios(audios);
      setActiveVoiceLang(activeCode);
      setLang(activeCode);
      setVoiceoverUrl(activeAudio.url);
      setVoiceoverDur(activeAudio.duration);
      setUploadedVoiceName('');
      setSubtitlesOn(true);
      setSubMode('target');
      setTtsNotice(failures.length || missingTranslationLangs.length
        ? `已生成 ${Object.keys(audios).length}/${langs.length} 个语种配音；${[...failures, ...missingTranslationLangs.map(item => {
          const [code, reason] = item.split(':');
          return `${LANGS.find(langItem => langItem.code === code)?.label || code}：翻译失败，未生成配音（${reason || '未知原因'}）`;
        })].join('；')}`
        : `已生成 ${langs.length} 个语种配音。`);
    } catch (err: any) {
      setTtsNotice(err?.message || '配音生成失败，请稍后重试。');
    } finally {
      setTtsLoading(false);
    }
  };
	  useEffect(() => {
	    const audio = voiceoverAudios[activeVoiceLang];
	    if (!audio || voiceoverMode !== 'ai') return;
	    setVoiceoverUrl(audio.url);
	    setVoiceoverDur(audio.duration);
	  }, [activeVoiceLang, voiceoverAudios, voiceoverMode]);
  useEffect(() => {
    const el = ttsAudioRef.current;
    if (!el) return;
    const update = () => {
      if (!cues.length) return;
      const current = cues.findIndex(cue => el.currentTime >= cue.start && el.currentTime < cue.end);
      if (current >= 0) setSubPreviewIdx(current);
    };
    el.addEventListener('timeupdate', update);
    return () => el.removeEventListener('timeupdate', update);
  }, [cues]);
  const playTtsForLang = (code: string) => {
    const audio = voiceoverAudios[code];
    if (!audio?.url) return;
    setVoiceoverMode('ai');
    setActiveVoiceLang(code);
    setLang(code);
    setVoiceoverUrl(audio.url);
    setVoiceoverDur(audio.duration);
    const el = ttsAudioRef.current;
    if (!el) return;
    el.pause();
    el.src = audio.url;
    el.currentTime = 0;
    void el.play().then(() => setTtsPlaying(true)).catch(() => setTtsPlaying(false));
  };
	  const toggleTts = () => {
	    const el = ttsAudioRef.current;
	    if (!el || !voiceoverUrl) return;
    if (ttsPlaying) { el.pause(); setTtsPlaying(false); return; }
    el.src = voiceoverUrl;
    void el.play().then(() => setTtsPlaying(true)).catch(() => setTtsPlaying(false));
  };
  const startVoiceAssemblyPreview = () => {
    if (previewable.length === 0) {
      setPreviewNote(true);
      return;
    }
    setPreviewNote(false);
    setSubtitlesOn(true);
    setVoicePreviewIdx(0);
    const el = ttsAudioRef.current;
    if (el && voiceoverUrl) {
      el.src = voiceoverUrl;
      void el.play().then(() => setTtsPlaying(true)).catch(() => setTtsPlaying(false));
    }
  };
  const stopVoiceAssemblyPreview = () => {
    setVoicePreviewIdx(null);
    if (ttsAudioRef.current) ttsAudioRef.current.pause();
    setTtsPlaying(false);
  };
  // 换音色 / 改脚本类型后，旧配音失效
  const pickVoice = (id: string) => { setVoice(id); setVoiceoverUrl(null); setVoiceoverAudios({}); setTtsNotice(''); setTtsPlaying(false); };
  // 离开脚本步时停止试听
  useEffect(() => {
    if (step !== 'script' && ttsAudioRef.current) { ttsAudioRef.current.pause(); setTtsPlaying(false); }
    if (step !== 'script') setVoicePreviewIdx(null);
  }, [step]);

  /* ── 草稿 / 作品 ─────────────────────────────────────────────────────── */
  const collectSpec = () => ({
    mode, contentMode, posterStyle, platform, ratio, duration, lang, provider,
    productInfo, productSelectMode, selectedProductIds, audience, sellingPoints, tone,
    selected, scriptRecommendedMaterialIds, storyboardAssignments, assemblyName, script, scriptType, voice,
    bgm, bgmVol, voiceVol, cover, coverTitle, coverStyle, account, caption,
    subtitlesOn, subMode, clipEdits, voiceoverMode, uploadedVoiceName, customVoiceId, customVoiceName, customVoiceUrl,
    posterDraft, posterJsonText,
  });

  const applySpec = (s: Record<string, unknown>) => {
    if (s.mode) setMode(s.mode as typeof mode);
    if (s.contentMode === 'video' || s.contentMode === 'poster') setContentMode(s.contentMode);
    if (typeof s.posterStyle === 'string' && POSTER_STYLES.some(item => item.id === s.posterStyle)) {
      setPosterStyle(s.posterStyle as typeof posterStyle);
    }
    if (s.platform) setPlatform(s.platform as string);
    if (s.ratio) setRatio(s.ratio as string);
    if (typeof s.duration === 'number') setDuration(s.duration);
    if (s.lang) setLang(s.lang as string);
    if (s.provider === 'gemini' || s.provider === 'qwen') setProvider(s.provider);
    if (typeof s.productInfo === 'string') setProductInfo(s.productInfo);
    if (s.productSelectMode === 'single' || s.productSelectMode === 'multi') setProductSelectMode(s.productSelectMode);
    if (Array.isArray(s.selectedProductIds)) setSelectedProductIds(s.selectedProductIds as string[]);
    if (typeof s.audience === 'string') setAudience(s.audience);
    if (typeof s.sellingPoints === 'string') setSellingPoints(s.sellingPoints);
    if (typeof s.tone === 'string') setTone(s.tone);
    if (Array.isArray(s.selected)) setSelected(s.selected as string[]);
    if (Array.isArray(s.scriptRecommendedMaterialIds)) setScriptRecommendedMaterialIds(s.scriptRecommendedMaterialIds as string[]);
    if (s.storyboardAssignments && typeof s.storyboardAssignments === 'object') setStoryboardAssignments(s.storyboardAssignments as Record<string, string>);
    if (typeof s.assemblyName === 'string') setAssemblyName(s.assemblyName);
    if (typeof s.script === 'string') setScript(s.script);
    if (s.scriptType) setScriptType(s.scriptType as typeof scriptType);
    if (s.voice) setVoice(s.voice as string);
    if (s.voiceoverMode === 'none' || s.voiceoverMode === 'ai' || s.voiceoverMode === 'upload') setVoiceoverMode(s.voiceoverMode);
    if (typeof s.uploadedVoiceName === 'string') setUploadedVoiceName(s.uploadedVoiceName);
    if (typeof s.customVoiceId === 'string') setCustomVoiceId(s.customVoiceId);
    if (typeof s.customVoiceName === 'string') setCustomVoiceName(s.customVoiceName);
    if (typeof s.customVoiceUrl === 'string') setCustomVoiceUrl(s.customVoiceUrl);
    if (s.bgm) setBgm(s.bgm as string);
    if (typeof s.bgmVol === 'number') setBgmVol(s.bgmVol);
    if (typeof s.voiceVol === 'number') setVoiceVol(s.voiceVol);
    if (s.cover && s.cover !== 'gradient') setCover(s.cover as string);
    if (typeof s.coverTitle === 'string') setCoverTitle(s.coverTitle);
    if (s.coverStyle) setCoverStyle(s.coverStyle as CoverStyle);
    if (s.account !== undefined) setAccount(s.account as string | null);
    if (typeof s.caption === 'string') setCaption(s.caption);
    if (s.posterDraft && typeof s.posterDraft === 'object') setPosterDraft(s.posterDraft as FbPosterResult);
    if (typeof s.posterJsonText === 'string') setPosterJsonText(s.posterJsonText);
    if (typeof s.subtitlesOn === 'boolean') setSubtitlesOn(s.subtitlesOn);
    if (s.subMode === 'target' || s.subMode === 'bilingual') setSubMode(s.subMode);
    if (s.clipEdits && typeof s.clipEdits === 'object') setClipEdits(s.clipEdits as Record<string, ClipEdit>);
  };

  const rememberCanvaCoverReturn = (nextCoverUrl: string | null = coverUrl) => {
    try {
      const payload: CanvaCoverReturnState = {
        at: Date.now(),
        stepId: 'cover',
        projectId,
        projectTitle,
        coverUrl: nextCoverUrl,
        spec: collectSpec(),
      };
      localStorage.setItem(CANVA_COVER_RETURN_KEY, JSON.stringify(payload));
    } catch {
      // Some embedded browsers can block storage; the new window still keeps the current page alive.
    }
  };

  useEffect(() => {
    let raw = '';
    try {
      raw = localStorage.getItem(CANVA_COVER_RETURN_KEY) || '';
      if (raw) localStorage.removeItem(CANVA_COVER_RETURN_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as CanvaCoverReturnState;
      if (!saved?.at || Date.now() - saved.at > CANVA_COVER_RETURN_TTL) return;
      if (saved.spec && typeof saved.spec === 'object') applySpec(saved.spec);
      setProjectId(saved.projectId ?? null);
      if (saved.projectTitle) setProjectTitle(saved.projectTitle);
      if (saved.coverUrl) setCoverUrl(saved.coverUrl);
      setStepIdx(STEPS.findIndex(s => s.id === saved.stepId) >= 0 ? STEPS.findIndex(s => s.id === saved.stepId) : COVER_STEP_INDEX);
      autoGen.current = true;
    } catch {
      // Ignore malformed return payloads from older local builds.
    }
  }, []);

  const saveProject = async (status: 'draft' | 'published' = 'draft') => {
    setSavingProj(true);
    const { project } = await studioApi.saveProject({
      id: projectId ?? undefined,
      title: projectTitle.trim() || '未命名草稿',
      status,
      spec: collectSpec(),
      thumbSeed: cover,
    });
    if (project?.id) setProjectId(project.id);
    completeDemoStep('traffic');
    setSavingProj(false);
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1800);
  };

  const openProjects = async () => {
    setShowProjects(true);
    setProjects(await studioApi.listProjects());
  };

  const loadProject = (p: StudioProject) => {
    applySpec(p.spec);
    setProjectId(p.id);
    setProjectTitle(p.title);
    autoGen.current = true; // 载入已有脚本，别再自动覆盖
    setStepIdx(0);
    setShowProjects(false);
    setPublished(false);
  };

  const removeProject = async (id: string) => {
    await studioApi.deleteProject(id);
    setProjects(await studioApi.listProjects());
    if (projectId === id) setProjectId(null);
  };

  /* ── 渲染各步骤操作区 ─────────────────────────────────────────────── */
  const renderStep = () => {
    switch (step) {
      /* ① 选模式 */
      case 'mode':
        const visibleModes = contentMode === 'poster' ? POSTER_MODES : MODES;
        return (
          <div className="max-w-3xl">
            <SectionTitle title="选择生成模式" desc="先选择内容形态，再确定 AI 从哪里取信息和素材" />
            <Field label="内容形态">
              <div className="inline-flex rounded-xl border border-border bg-surface-2 p-1">
                {([
                  ['video', '视频模式'],
                  ['poster', '图文模式'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setContentMode(value);
                      if (value === 'poster') {
                        setPlatform('facebook');
                        setRatio(ratio === '9:16' ? '1:1' : ratio);
                      }
                    }}
                    className={`rounded-lg px-4 py-2 text-sm font-bold transition ${contentMode === value ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
            <div className="mt-4 grid grid-cols-3 gap-3 mb-7">
              {visibleModes.map(m => {
                const on = mode === m.id;
                return (
                  <button key={m.id} onClick={() => setMode(m.id)}
                    className="card p-4 text-left transition-all"
                    style={on ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}>
                    <div className="mb-2 flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: on ? TRAFFIC_GREEN : 'var(--color-surface-2)', color: on ? '#fff' : 'var(--color-text-muted)' }}>
                        <m.icon size={14} />
                      </div>
                      <p className="text-sm font-bold text-text-primary">{m.title}</p>
                    </div>
                    <p className="text-xs text-text-muted leading-relaxed">{m.desc}</p>
                  </button>
                );
              })}
            </div>
            {contentMode === 'poster' && (
              <div className="mb-7 grid gap-3 md:grid-cols-3">
                {(['clone', 'material', 'product'] as const).map(id => {
                  const guide = POSTER_MODE_GUIDES[id];
                  const active = mode === id;
                  return (
                    <div
                      key={id}
                      className="rounded-xl border bg-surface p-3 text-xs leading-relaxed"
                      style={active ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : { borderColor: 'var(--color-border)' }}
                    >
                      <p className="font-bold text-text-primary">{POSTER_MODES.find(item => item.id === id)?.title}</p>
                      <p className="mt-2 text-text-secondary">{guide.source}</p>
                      <p className="mt-2 text-text-muted">{guide.iterate}</p>
                      <p className="mt-2 font-semibold text-amber-700">{guide.confirm}</p>
                    </div>
                  );
                })}
              </div>
            )}

            <SectionTitle title={contentMode === 'poster' ? '图文参数' : '智能素材参数'} desc="选择平台、产品和脚本输出方式" />
            <div className="space-y-4">
              <Field label="目标平台">
                <div className="flex flex-wrap gap-2">
                  {visiblePlatforms.map(p => (
                    <Pill key={p.id} active={platform === p.id}
                      onClick={() => { setPlatform(p.id); setRatio(p.ratio); }}>
                      {p.label}
                    </Pill>
                  ))}
                </div>
              </Field>
              <Field label="画面比例">
                <div className="flex gap-2">
                  {visibleRatios.map(r => <Pill key={r} active={ratio === r} onClick={() => setRatio(r)}>{r}</Pill>)}
                </div>
              </Field>
              {contentMode === 'poster' && (
                <Field label="海报风格">
                  <div className="flex flex-wrap gap-2">
                    {POSTER_STYLES.map(style => (
                      <Pill key={style.id} active={posterStyle === style.id} onClick={() => setPosterStyle(style.id)}>
                        {style.label}
                      </Pill>
                    ))}
                  </div>
                </Field>
              )}
              <Field label="选择产品">
                <div className="space-y-2 max-w-2xl">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-text-muted">产品信息从企业中心配置导入，用于后续口播脚本和素材生成。</p>
                    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
                      {([
                        ['single', '单选'],
                        ['multi', '多选'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setProductSelectMode(value)}
                          className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${productSelectMode === value ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {productOptions.length > 0 ? productOptions.map(option => {
                      const active = selectedProductIds.includes(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => toggleProductSelection(option.id)}
                          className="rounded-xl border bg-surface p-3 text-left transition"
                          style={active ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : { borderColor: 'var(--color-border)' }}
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={`mt-0.5 flex h-4 w-4 items-center justify-center border ${productSelectMode === 'single' ? 'rounded-full' : 'rounded'}`}
                              style={active ? { borderColor: TRAFFIC_GREEN, background: TRAFFIC_GREEN, color: '#fff' } : { borderColor: 'var(--color-border)' }}
                            >
                              {active && <Check size={11} />}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-text-primary">{option.label}</p>
                              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">{option.info}</p>
                            </div>
                          </div>
                        </button>
                      );
                    }) : (
                      <div className="rounded-xl border border-dashed border-border bg-surface-2 px-3 py-4 text-sm text-text-muted">
                        企业中心还没有可导入的产品信息，请先到企业中心完成配置。
                      </div>
                    )}
                  </div>
                </div>
              </Field>
              <div className="rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-text-muted">
                {contentMode === 'poster'
                  ? '图文模式会优先使用企业中心资料、爆款图文参考和素材库图片生成海报文案 JSON；出图前建议先确认标题、认证、MOQ、目标市场和 CTA。'
                  : '脚本生成已移到下一步「口播脚本」。这里仅确认生成起点、平台、比例和企业中心导入的产品。'}
              </div>
              {contentMode === 'poster' && (
                <div className="rounded-2xl border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-text-primary">海报文案 JSON</p>
                      <p className="mt-1 text-xs leading-relaxed text-text-muted">
                        先生成可编辑 JSON，再进入图片生成；MOQ、认证、交期等商业承诺字段需要确认后使用。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void generatePosterBrief()}
                      disabled={posterLoading}
                      className="btn-primary shrink-0 !px-4 !py-2 !text-xs"
                    >
                      {posterLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      生成图文文案
                    </button>
                  </div>
                  {modeNotice && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                      {modeNotice}
                    </div>
                  )}
                  <textarea
                    value={posterJsonText}
                    onChange={event => setPosterJsonText(event.target.value)}
                    rows={posterJsonText ? 12 : 5}
                    placeholder="生成后这里会出现海报文案 JSON：标题、副标题、认证徽章、流程六步、产品分类卡、底部卖点和 CTA。"
                    className="mt-3 w-full rounded-xl border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed text-text-secondary outline-none focus:border-accent"
                  />
                  {posterDraft && (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-border bg-surface-2 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-xs font-bold text-text-primary">发布配文</p>
                          <button type="button" onClick={() => navigator.clipboard?.writeText(caption)} className="text-xs font-bold text-accent">复制</button>
                        </div>
                        <p className="whitespace-pre-line text-xs leading-relaxed text-text-secondary">{caption}</p>
                      </div>
                      <div className="rounded-xl border border-border bg-surface-2 p-3">
                        <p className="text-xs font-bold text-text-primary">承接话术</p>
                        <p className="mt-2 text-xs leading-relaxed text-text-secondary">评论 CTA：{posterDraft.commentCta || '待生成'}</p>
                        <p className="mt-2 text-xs leading-relaxed text-text-secondary">私信开场：{posterDraft.dmOpening || '待生成'}</p>
                      </div>
                      <div className="md:col-span-2 rounded-xl border border-border bg-surface-2 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-xs font-bold text-text-primary">图片模型 Prompt</p>
                          <button type="button" onClick={() => navigator.clipboard?.writeText(posterDraft.imagePrompt || '')} className="text-xs font-bold text-accent">复制</button>
                        </div>
                        <p className="text-xs leading-relaxed text-text-muted">{posterDraft.imagePrompt || '待生成'}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );

      /* ③ 选素材 —— 文件夹 + 网格 两栏 */
      case 'material': {
        const folderName = (id: string) => FOLDERS.find(f => f.id === id)?.name ?? '';
        // 按内容相关性搜索：匹配素材名 + 所属文件夹（分类）名
        const q = search.trim().toLowerCase();
        const matchSearch = (c: Clip) => q === '' || c.name.toLowerCase().includes(q) || folderName(c.folder).toLowerCase().includes(q);
        const recommendationSource = selected.length > 0 ? selected : scriptRecommendedMaterialIds;
        const recommended = recommendationSource.length > 0
          ? recommendationSource.map(id => materialById.get(id)).filter((item): item is Clip => Boolean(item))
          : materials.filter(c => c.type !== 'audio');
        const visible = (activeFolder === 'recommend'
          ? recommended
          : materials.filter(c => activeFolder === 'all' || c.folder === activeFolder)
        ).filter(matchSearch);
        const assignClipToSlot = (slotId: string, clipId: string) => {
          const clip = materialById.get(clipId);
          const slot = storyboardSlots.find(item => item.id === slotId);
          if (!clip || !slot) return;
          setStoryboardAssignments(prev => ({ ...prev, [slotId]: clipId }));
          setClipEdits(prev => ({ ...prev, [clipId]: defaultEditForSlot(clip, slot) }));
        };
        const removeSlotClip = (slotId: string) => {
          setStoryboardAssignments(prev => {
            const next = { ...prev };
            delete next[slotId];
            return next;
          });
        };
        const oneClickMatchStoryboard = () => {
          const pool = (recommendationSource.length ? recommendationSource : selected)
            .map(id => materialById.get(id))
            .filter((item): item is Clip => Boolean(item && item.type !== 'audio'));
          const fallbackPool = pool.length ? pool : materials.filter(item => item.type !== 'audio');
          const next: Record<string, string> = {};
          const nextEdits: Record<string, ClipEdit> = {};
          storyboardSlots.forEach((slot, index) => {
            const clip = fallbackPool[index % Math.max(1, fallbackPool.length)];
            if (clip) {
              next[slot.id] = clip.id;
              nextEdits[clip.id] = defaultEditForSlot(clip, slot);
            }
          });
          setStoryboardAssignments(next);
          setClipEdits(prev => ({ ...prev, ...nextEdits }));
          setSelected([...new Set(storyboardSlots.map(slot => next[slot.id]).filter((id): id is string => Boolean(id)))]);
        };
        const resetAssembly = () => {
          setAssemblyName('视频1');
          setStoryboardAssignments({});
          setSelected([]);
        };
        return (
          <div className="flex h-full -m-6">
            {/* 文件夹栏（含内容搜索） */}
            <div className="w-36 flex-shrink-0 border-r border-border p-2.5 overflow-y-auto">
              {/* 内容相关性搜索 */}
              <div className="relative mb-3">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索素材内容…"
                  className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-border bg-surface text-xs outline-none focus:border-accent" />
              </div>
              <div className="flex items-center justify-between px-1.5 mb-1.5">
                <span className="text-[11px] font-semibold text-text-secondary">文件夹</span>
                <Plus size={13} className="text-text-muted cursor-pointer hover:text-text-primary" />
              </div>
              {FOLDERS.map(f => {
                const count = f.id === 'recommend'
                  ? recommended.length
                  : f.id === 'all'
                    ? materials.length
                    : materials.filter(c => c.folder === f.id).length;
                return (
                  <button key={f.id} onClick={() => setActiveFolder(f.id)}
                    className={`w-full flex items-center gap-1.5 px-2 py-2 rounded-lg text-xs transition-colors ${
                      activeFolder === f.id ? 'bg-accent-glow text-accent font-semibold' : 'text-text-secondary hover:bg-surface-2'}`}>
                    <Folder size={12} className="flex-shrink-0" />
                    <span className="flex-1 text-left truncate">{f.name}</span>
                    {f.id === 'hot' && <span className="text-[7px] font-bold px-1 py-0.5 rounded text-white flex-shrink-0" style={{ background: '#0891b2' }}>实时</span>}
                    <span className="text-[10px] text-text-muted">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* 素材网格 */}
            <div className="flex-1 min-w-0 flex flex-col">
	              <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-shrink-0">
		                <span className="text-sm font-semibold text-text-primary">{folderName(activeFolder)}</span>
		                {activeFolder === 'recommend' && <span className="text-[11px] text-text-muted">按分镜数量准备素材候选</span>}
		                {activeFolder === 'hot' && <span className="text-[11px] text-text-muted">官方实时更新</span>}
	                {activeFolder === 'presenter' && <span className="text-[11px] text-text-muted">上传真人实拍视频，或生成数字人口播</span>}
	                <input ref={fileInputRef} type="file" multiple accept={activeFolder === 'presenter' ? 'video/*' : 'video/*,image/*,audio/*'} className="hidden"
	                  onChange={e => { void handleUpload(e.target.files); e.target.value = ''; }} />
		                {activeFolder === 'presenter' && (
		                  <button
		                    onClick={() => void generateDigitalHumanPresenter()}
	                    disabled={digitalHumanLoading || !materials.some(c => c.folder === 'presenter' && c.type === 'video')}
	                    className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-bold text-white transition disabled:opacity-50"
	                  >
	                    {digitalHumanLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
		                    {digitalHumanLoading ? '生成中…' : '生成数字人口播'}
		                  </button>
		                )}
		                {mode === 'material' && (
		                  <button
		                    onClick={() => void generateFromMaterialLibrary()}
		                    disabled={modeActionLoading || materials.filter(item => item.type !== 'audio').length === 0}
		                    className={`inline-flex items-center gap-1.5 rounded-xl border border-accent px-3 py-1.5 text-xs font-bold text-accent transition hover:bg-accent-glow disabled:opacity-50 ${activeFolder === 'presenter' ? '' : 'ml-auto'}`}
		                  >
		                    {modeActionLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
		                    AI 智能选材
		                  </button>
		                )}
                    {activeFolder === 'recommend' && recommended.length > 0 && (
                      <button
                        type="button"
                        onClick={oneClickMatchStoryboard}
                        disabled={storyboardSlots.length === 0}
                        className={`${mode === 'material' ? '' : 'ml-auto'} inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-bold text-white transition disabled:opacity-50`}
                      >
                        <Sparkles size={12} />
                        一键匹配
                      </button>
                    )}
		                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
		                  className={`btn-ghost !px-3 !py-1.5 !text-xs flex items-center gap-1.5 disabled:opacity-60 ${activeFolder === 'presenter' || mode === 'material' || activeFolder === 'recommend' ? '' : 'ml-auto'}`}>
		                  {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} {uploading ? '上传中…' : '上传'}
		                </button>
	                <span className="text-xs text-text-muted">已选 {selected.length}</span>
	              </div>

	              <div className="flex-1 overflow-y-auto p-5">
	                {activeFolder === 'presenter' && digitalHumanNotice && (
	                  <div className="mb-4 rounded-xl border border-accent/20 bg-accent-glow px-4 py-3 text-xs font-semibold text-accent">
	                    {digitalHumanNotice}
	                  </div>
	                )}
	                {activeFolder === 'presenter' && visible.length > 0 && (
	                  <div className="mb-4 rounded-2xl border border-border bg-surface p-4">
	                    <div className="flex flex-wrap items-center justify-between gap-3">
	                      <div className="min-w-0">
	                        <p className="text-sm font-black text-text-primary">真人口播素材</p>
	                        <p className="mt-1 text-xs text-text-muted">选择一条真人实拍视频，可生成数字人口播版本并保存回当前文件夹。</p>
	                      </div>
	                      <button
	                        onClick={() => void generateDigitalHumanPresenter()}
	                        disabled={digitalHumanLoading || !visible.some(c => c.type === 'video')}
	                        className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
	                      >
	                        {digitalHumanLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
	                        基于选中视频生成数字人口播
	                      </button>
	                    </div>
	                  </div>
	                )}
	                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
	                  {visible.map(c => {
                    const on = selected.includes(c.id);
                    const idx = selected.indexOf(c.id);
                    return (
                      <button key={c.id}
                        draggable={c.type !== 'audio'}
                        onDragStart={e => {
                          e.dataTransfer.setData('text/plain', c.id);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => setSelected(s => on ? s.filter(x => x !== c.id) : [...s, c.id])}
                        className="card !rounded-xl overflow-hidden text-left relative group"
                        style={on ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}>
                        <div className="relative">
                          {/* 真实素材显示实际预览，mock 用渐变占位 */}
                          {c.url
                            ? <RealThumb clip={c} />
                            : <Thumb seed={c.id} src={c.poster} label={c.type === 'image' ? 'IMG' : `0:${String(c.duration).padStart(2, '0')}`} />}
                          {on && (
                            <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white z-10"
                              style={{ background: TRAFFIC_GREEN }}>{idx + 1}</span>
                          )}
                          {c.scope === 'shared' && !on && (
                            <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[8px] font-bold text-white z-10" style={{ background: '#0891b2' }}>公共</span>
                          )}
                          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-black/45 uppercase z-10">
                            {c.type}
                          </span>
                        </div>
	                        <div className="p-2">
	                          <p className="text-[11px] font-medium text-text-primary truncate">{c.name}</p>
	                          <p className="text-[10px] text-text-muted mt-0.5">{c.folder === 'presenter' ? '真人口播素材 · ' : ''}{c.size}</p>
	                        </div>
	                      </button>
                    );
                  })}
                </div>
                {visible.length === 0 && (
                  <div className="text-center py-16">
                    <Upload size={26} className="mx-auto text-text-muted mb-3 opacity-30" />
		                    <p className="text-sm text-text-muted">
		                      {search.trim() ? '没有匹配的素材' : activeFolder === 'recommend' ? '暂无推荐素材，请先上传素材或返回口播脚本生成推荐' : activeFolder === 'hot' ? '爆款素材库更新中，敬请期待' : activeFolder === 'presenter' ? '还没有真人口播素材' : '这个文件夹还没有素材'}
		                    </p>
		                    {activeFolder !== 'hot' && activeFolder !== 'recommend' && !search.trim() && (
	                      <div className="mt-2 space-y-2">
	                        <button onClick={() => fileInputRef.current?.click()} className="text-xs font-semibold" style={{ color: TRAFFIC_GREEN }}>
	                          {activeFolder === 'presenter' ? '上传真人实拍视频' : '点此上传'}
	                        </button>
	                        {activeFolder === 'presenter' && (
	                          <p className="text-[11px] text-text-muted">上传后可在此页面生成数字人口播素材。</p>
	                        )}
	                      </div>
	                    )}
	                  </div>
                )}
              </div>
            </div>

            <aside className="w-[360px] flex-shrink-0 border-l border-border bg-surface/40 flex flex-col">
              <div className="border-b border-border bg-white px-4 py-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">分镜匹配</p>
                    <input
                      value={assemblyName}
                      onChange={event => setAssemblyName(event.target.value)}
                      className="mt-0.5 w-full bg-transparent text-sm font-black text-text-primary outline-none"
                    />
                  </div>
                  <button type="button" onClick={resetAssembly}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary hover:bg-surface-2">
                    新建视频1
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
                  <span>{assignedCount}/{storyboardSlots.length} 已匹配 · 按时间戳拼接</span>
                  <button type="button" onClick={oneClickMatchStoryboard}
                    className="font-bold text-accent disabled:opacity-40"
                    disabled={!materials.some(item => item.type !== 'audio') || storyboardSlots.length === 0}>
                    一键匹配
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
                {storyboardSlots.map((slot, index) => {
                  const clip = slot.id ? materialById.get(storyboardAssignments[slot.id] || '') : undefined;
                  return (
                    <div
                      key={slot.id}
                      onDragOver={event => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'copy';
                      }}
                      onDrop={event => {
                        event.preventDefault();
                        assignClipToSlot(slot.id, event.dataTransfer.getData('text/plain'));
                      }}
                      className={`rounded-xl border p-3 transition-colors ${clip ? 'border-green-200 bg-green-50/60' : 'border-dashed border-border bg-white hover:border-accent/50'}`}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded-md bg-slate-950 px-1.5 py-0.5 text-[10px] font-bold text-white">{index + 1}</span>
                            <span className="font-mono text-[11px] font-bold text-accent">{slot.time}</span>
                          </div>
                          <p className="mt-1 truncate text-xs font-bold text-text-primary">{slot.title}</p>
                        </div>
                        {clip && (
                          <button type="button" onClick={() => removeSlotClip(slot.id)}
                            className="rounded-md p-1 text-text-muted hover:bg-white hover:text-red">
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      <p className="mb-2 line-clamp-2 text-[11px] leading-relaxed text-text-muted">{slot.detail}</p>
                      {clip ? (
                        <div className="flex items-center gap-2 rounded-lg bg-white p-2 shadow-sm">
                          <div className="h-12 w-16 flex-shrink-0 overflow-hidden rounded-md bg-surface-2">
                            {clip.url
                              ? <RealThumb clip={clip} />
                              : <Thumb seed={clip.id} src={clip.poster} label={clip.type === 'image' ? 'IMG' : fmtDur(clip.duration)} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11px] font-bold text-text-primary">{clip.name}</p>
                            <p className="mt-0.5 text-[10px] text-text-muted">{clip.type.toUpperCase()} · {clip.type === 'image' ? '3s' : fmtDur(clip.duration)}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-14 items-center justify-center rounded-lg border border-dashed border-border bg-surface-2 text-[11px] font-bold text-text-muted">
                          拖拽素材到这里
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </aside>
          </div>
        );
      }

      /* ② 口播脚本 */
      case 'script': {
        const currentModeScripts = modeScripts
          .filter(item => item.mode === mode)
          .map((item, index) => ({ item, number: modeScriptNumber(item, index) }))
          .sort((a, b) => {
            const aActive = activeModeScriptId === a.item.id;
            const bActive = activeModeScriptId === b.item.id;
            if (aActive !== bActive) return aActive ? -1 : 1;
            return a.number - b.number;
          });
        const visibleScriptText = scriptView === 'timestamp' ? script : (voiceDrafts.zh || voiceoverLines || extractVoiceoverText(script));
        const canGenerateModeScript = mode === 'clone'
          ? Boolean(activeProductInfo.trim() || videoKickoff || script.trim())
          : Boolean(activeProductLabel);
        return (
          <div className="max-w-3xl">
            <div className="flex items-center justify-between mb-4">
              <SectionTitle title="口播脚本" desc="先生成带时间戳脚本，再提取带时间戳的口播台词" noMargin />
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
                  {([
                    { view: 'timestamp' as const, icon: <List size={12} />, label: '时间戳脚本' },
                    { view: 'voiceover' as const, icon: <FileText size={12} />, label: '口播台词' },
                  ]).map(({ view, icon, label }) => (
                    <button key={view} onClick={() => setScriptView(view)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all disabled:opacity-50 ${
                        scriptView === view ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                      {icon}<span>{label}</span>
                    </button>
                  ))}
                </div>
                  <button onClick={() => void optimizeCurrentTimestampScript()} disabled={modeActionLoading || !script.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-50">
                    {modeActionLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} 优化当前脚本
                  </button>
              </div>
            </div>

            <div className="mb-4 rounded-2xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-text-primary">
                    {mode === 'material' ? '素材库脚本生成' : mode === 'product' ? '产品脚本生成' : '爆款复刻脚本生成'}
                  </p>
                  <p className="mt-1 text-xs text-text-muted">
                    {mode === 'product' ? '生成时间戳脚本后，会用第一条脚本同步生成 Seedance 2.0 素材。' : '生成结果会先保留时间戳结构，再自动提取带时间戳口播台词。'}
                  </p>
                </div>
	                <button
	                  type="button"
	                  onClick={event => {
	                    event.preventDefault();
	                    event.stopPropagation();
	                    void generateTimestampScriptsForMode();
	                  }}
	                  disabled={modeActionLoading || !canGenerateModeScript}
	                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60"
	                >
                  {modeActionLoading ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                  {modeActionLoading ? (modeActionStatus || '生成中…') : mode === 'clone' && script.trim() ? '重新思考生成新脚本' : '生成时间戳脚本'}
                </button>
              </div>
              {currentModeScripts.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {currentModeScripts.map(({ item, number }) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openModeScript(item)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${activeModeScriptId === item.id ? 'border-accent bg-accent-glow text-accent' : 'border-border bg-white text-text-muted hover:text-text-secondary'}`}
                    >
                      脚本 {number}{activeModeScriptId === item.id ? ' · 当前' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative mb-5">
              <textarea
                value={visibleScriptText}
                placeholder={mode === 'clone' && !script.trim()
                  ? '待生成：已带入对标视频分析和产品信息，系统会调用后端模型生成真实时间戳脚本。'
                  : scriptView === 'voiceover'
                    ? '待提取：点击“提取并生成多语种”后显示纯净口播台词。'
                    : '请输入或生成时间戳脚本。'}
                onChange={e => {
                  if (scriptView === 'timestamp') {
                    setScript(e.target.value);
                  } else {
                    setVoiceoverLines(e.target.value);
                    setVoiceDrafts(drafts => ({ ...drafts, zh: e.target.value }));
                  }
                }}
                rows={11}
                className="w-full p-4 rounded-xl border border-border bg-surface-2 text-sm text-text-secondary leading-relaxed font-mono outline-none focus:border-accent resize-none" />
              {(scriptLoading || modeActionLoading) && (
                <div className="absolute inset-0 rounded-xl bg-surface/70 backdrop-blur-sm flex items-center justify-center">
                  <span className="flex items-center gap-2 text-xs text-text-muted">
                    <Loader2 size={14} className="animate-spin" /> {modeActionStatus || 'AI 正在生成脚本…'}
                  </span>
                </div>
              )}
            </div>

            <div className="mb-5 rounded-2xl border border-border bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-text-primary">提取口播与多语种字幕</p>
                  <p className="mt-1 text-xs text-text-muted">从时间戳脚本里提取口播台词，保留时间段，再生成不同语种版本。</p>
                </div>
                <button
                  type="button"
                  onClick={() => void generateVoiceDrafts()}
                  disabled={voiceDraftLoading}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                >
                  {voiceDraftLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {voiceDraftLoading ? '生成中…' : '提取并生成多语种'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {['zh', 'en', 'es', 'ar', 'pt', 'id'].map(code => {
                  const active = voiceLangs.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setVoiceLangs(list => {
                        const next = active ? list.filter(item => item !== code) : [...list, code];
                        if (!next.includes(activeVoiceLang)) setActiveVoiceLang(next[0] || 'zh');
                        return next.length ? next : ['zh'];
                      })}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${active ? 'border-accent bg-accent-glow text-accent' : 'border-border text-text-muted hover:text-text-secondary'}`}
                    >
                      {LANGS.find(l => l.code === code)?.label.split(' - ')[1] || code}
                    </button>
                  );
                })}
              </div>
              {voiceDraftNotice && (
                <div className={`mt-3 rounded-xl border px-3 py-2 text-xs font-semibold ${
                  voiceDraftNotice.includes('失败') || voiceDraftNotice.includes('没有可提取')
                    ? 'border-red-100 bg-red-50 text-red-600'
                    : 'border-accent/20 bg-accent-glow text-accent'
                }`}>
                  {voiceDraftNotice}
                </div>
              )}
              {Object.keys(voiceDrafts).length > 0 && (
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {voiceLangs.map(code => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => { setActiveVoiceLang(code); setLang(code); }}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${activeVoiceLang === code ? 'bg-accent text-white' : 'bg-surface-2 text-text-muted hover:text-text-secondary'}`}
                      >
                        {LANGS.find(l => l.code === code)?.label || code}
                        {voiceoverAudios[code] && <span className="ml-1 opacity-80">已配音</span>}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={voiceDrafts[activeVoiceLang] || (activeVoiceLang === 'zh' ? '' : '翻译生成中或失败，请点击“提取并生成多语种”重试。')}
                    onChange={e => setVoiceDrafts(drafts => ({ ...drafts, [activeVoiceLang]: e.target.value }))}
                    rows={6}
                    dir={activeVoiceLang === 'ar' ? 'rtl' : 'ltr'}
                    className="w-full rounded-xl border border-border bg-surface-2 p-3 font-mono text-sm leading-7 text-text-secondary outline-none focus:border-accent resize-none"
                  />
                </div>
              )}
            </div>

            <Field label="配音方式">
              <input ref={voiceoverInputRef} type="file" accept="audio/*" className="hidden"
                onChange={e => { void handleVoiceoverUpload(e.target.files); e.target.value = ''; }} />
              <input ref={voiceSampleInputRef} type="file" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-wav,audio/mp4" className="hidden"
                onChange={e => { void handleVoiceSampleUpload(e.target.files); e.target.value = ''; }} />
              <div className="grid grid-cols-1 gap-2 max-w-2xl md:grid-cols-3">
                {[
                  { id: 'none' as const, icon: <X size={15} />, title: '不配音', desc: '仅保留画面与字幕' },
                  { id: 'ai' as const, icon: <Mic size={15} />, title: 'AI 配音', desc: '按当前语种生成口播' },
                  { id: 'upload' as const, icon: <Upload size={15} />, title: '上传本地音频', desc: uploadedVoiceName || 'mp3 / wav / m4a' },
                ].map(option => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      if (option.id === 'none') clearVoiceover();
                      if (option.id === 'ai') setVoiceoverMode('ai');
                      if (option.id === 'upload') voiceoverInputRef.current?.click();
                    }}
                    className="card !rounded-xl p-3 text-left transition-all"
                    style={voiceoverMode === option.id ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}
                  >
                    <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg"
                      style={{ background: voiceoverMode === option.id ? TRAFFIC_GREEN : 'var(--color-surface-2)', color: voiceoverMode === option.id ? '#fff' : 'var(--color-text-muted)' }}>
                      {option.icon}
                    </div>
                    <p className="text-xs font-bold text-text-primary">{option.title}</p>
                    <p className="mt-0.5 truncate text-[10px] text-text-muted">{option.desc}</p>
                  </button>
                ))}
              </div>

              {voiceoverMode === 'ai' && (
                <div className="mt-3 grid grid-cols-2 gap-2 max-w-xl">
                  {[...VOICES, ...(customVoiceId && customVoiceName ? [{ id: customVoiceId, name: customVoiceName, tag: '真人音色' }] : [])].map(v => (
                    <button key={v.id} onClick={() => pickVoice(v.id)}
                      className="card !rounded-xl p-3 flex items-center gap-2.5 text-left"
                      style={voice === v.id ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: voice === v.id ? TRAFFIC_GREEN : 'var(--color-surface-2)', color: voice === v.id ? '#fff' : 'var(--color-text-muted)' }}>
                        {v.id.startsWith('custom:') ? <Upload size={14} /> : <Mic size={14} />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-text-primary truncate">{v.name}</p>
                        <p className="text-[10px] text-text-muted">{v.id.startsWith('custom:') ? `${v.tag} · 音色克隆` : `${v.tag} · 智能配音`}</p>
                      </div>
                    </button>
                  ))}
                  <button type="button" onClick={() => voiceSampleInputRef.current?.click()}
                    className="card !rounded-xl p-3 flex items-center gap-2.5 text-left">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-surface-2 text-text-muted">
                      <Upload size={14} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-text-primary truncate">录入真人音色</p>
                      <p className="text-[10px] text-text-muted">{customVoiceName ? '重新上传声音样本' : 'mp3/wav/m4a，10 秒以上'}</p>
                    </div>
                  </button>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 max-w-xl">
                {voiceoverMode === 'ai' && (
		                  <button
                        type="button"
		                    onClick={() => void genTts()}
	                    disabled={ttsLoading}
	                    className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
	                  >
	                    {ttsLoading ? <Loader2 size={12} className="animate-spin" /> : <Mic size={13} />}
	                    {ttsLoading ? `正在生成 ${voiceLangs.length || 1} 个语种配音…` : `生成 ${voiceLangs.length || 1} 个语种配音`}
	                  </button>
                )}
	                {voiceoverMode === 'upload' && (
	                  <button
	                    onClick={() => voiceoverInputRef.current?.click()}
                    disabled={ttsLoading}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                  >
                    {ttsLoading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={13} />}
	                    {uploadedVoiceName ? '重新上传音频' : '上传本地音频'}
	                  </button>
	                )}
                {voiceoverMode === 'ai' && voice.startsWith('custom:') && customVoiceName && (
                  <div className="basis-full rounded-xl border border-accent/20 bg-accent-glow px-3 py-2 text-xs font-semibold text-accent">
                    当前使用真人音色：{customVoiceName}{customVoiceUrl ? '。' : '。'}
                  </div>
                )}
                {voiceoverMode === 'ai' && Object.keys(voiceoverAudios).length > 0 && (
                  <div className="basis-full flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-text-muted">试听语种</span>
                    {voiceLangs.filter(code => voiceoverAudios[code]?.url).map(code => {
                      const active = activeVoiceLang === code;
                      const label = LANGS.find(item => item.code === code)?.label || code;
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => {
                            if (active && ttsPlaying) {
                              ttsAudioRef.current?.pause();
                              setTtsPlaying(false);
                            } else {
                              playTtsForLang(code);
                            }
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                            active ? 'border-accent bg-accent-glow text-accent' : 'border-border bg-white text-text-muted hover:text-text-secondary'
                          }`}
                        >
                          {active && ttsPlaying ? <Pause size={11} /> : <Play size={11} />}
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
	                {voiceoverUrl && (
	                  <button
	                    onClick={startVoiceAssemblyPreview}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:text-text-primary"
                  >
                    <Play size={12} />
                    使用该语种配音
                  </button>
                )}
                {voiceoverUrl && (
                  <button
                    onClick={toggleTts}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:text-text-primary"
                  >
                    {ttsPlaying ? <Pause size={12} /> : <Play size={12} />}
                    {ttsPlaying ? '暂停音频' : '只听配音'}
                  </button>
                )}
                <span className="text-xs text-text-muted">
                  {voiceoverMode === 'none' ? '当前成片不会混入口播音频，但仍可保留字幕。' : '音频会用于后续成片预览与导出。'}
                </span>
                {ttsNotice && (
                  <span className={`basis-full text-xs font-semibold ${voiceoverUrl ? 'text-accent' : 'text-red-500'}`}>
                    {ttsNotice}
                  </span>
                )}
              </div>
              <audio ref={ttsAudioRef} onEnded={() => setTtsPlaying(false)} className="hidden" />
            </Field>
            {voiceoverUrl && (
              <div className="mt-5 rounded-2xl border border-border bg-surface p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-text-primary">分镜拼接与 AI 口播确认</p>
                    <p className="mt-1 text-xs text-text-muted">
                      录音 {voiceoverDur || 0}s · 字幕 {cues.length} 条 · 素材 {selectedClips.length} 段
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={startVoiceAssemblyPreview}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white"
                    >
                      <Play size={12} /> 播放预览
                    </button>
                    {voicePreviewIdx !== null && (
                      <button
                        onClick={stopVoiceAssemblyPreview}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary"
                      >
                        <X size={12} /> 停止
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)]">
                  <div className="relative overflow-hidden rounded-2xl border border-border bg-black" style={{ aspectRatio: '9 / 16' }}>
                    {voicePreviewIdx !== null && previewable[voicePreviewIdx] ? (
                      <video
                        src={previewable[voicePreviewIdx].url}
                        autoPlay
                        muted
                        playsInline
                        className="absolute inset-0 h-full w-full object-cover"
                        onEnded={() => setVoicePreviewIdx(i => (i !== null && i + 1 < previewable.length ? i + 1 : null))}
                      />
                    ) : (
                      <CoverFace coverUrl={coverUrl} frameUrl={coverFrameUrl} frameType={coverClip?.type} title={coverTitle} style={coverStyle} />
                    )}
                    {subtitlesOn && cues[subPreviewIdx] && (
                      <div className="absolute inset-x-0 bottom-[26%] z-10 px-3 text-center pointer-events-none">
                        <p className="leading-snug text-white text-[12px] font-bold" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
                          {cues[subPreviewIdx].text}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="mb-3 rounded-xl border border-accent/20 bg-accent-glow px-3 py-2 text-xs text-accent">
                      配音页面已自动开启字幕，后续成片会使用当前语种口播台词、AI 录音和这些字幕 cue。
                    </div>
                    <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                      {cues.map((cue, i) => (
                        <button
                          key={`${cue.start}-${i}`}
                          onClick={() => setSubPreviewIdx(i)}
                          className={`w-full rounded-lg px-3 py-2 text-left text-xs transition ${i === subPreviewIdx ? 'bg-accent-glow text-text-primary' : 'hover:bg-surface-2 text-text-secondary'}`}
                        >
                          <span className="font-mono text-text-muted">{cue.start.toFixed(1)}s-{cue.end.toFixed(1)}s</span>
                          <span className="ml-2">{cue.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      }

      /* ④ 配乐 */
      case 'bgm': {
        const visibleBgms = bgmTab === 'favorites'
          ? bgms.filter(track => favoriteBgms.includes(track.id))
          : bgms;
        return (
          <div className="max-w-2xl">
            <div className="flex items-center justify-between mb-4">
              <SectionTitle title="背景配乐" desc="支持不配乐或上传本地音乐" noMargin />
              <input ref={bgmInputRef} type="file" accept="audio/*" className="hidden"
                onChange={e => { void handleBgmUpload(e.target.files); e.target.value = ''; }} />
              <button onClick={() => bgmInputRef.current?.click()} disabled={bgmUploading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-60">
                {bgmUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} 上传音乐
              </button>
            </div>
            <div className="mb-4 inline-flex rounded-xl border border-border bg-surface-2 p-1">
              {[
                { id: 'library', label: '我的音乐' },
                { id: 'favorites', label: `我的收藏 ${favoriteBgms.length}` },
              ].map(tab => {
                const on = bgmTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setBgmTab(tab.id as 'library' | 'favorites')}
                    className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${on ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
                    style={on ? { color: TRAFFIC_GREEN } : undefined}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
            {bgms.length === 0 && (
              <div className="card !rounded-xl border-dashed text-center py-10 mb-7">
                <Music size={24} className="mx-auto text-text-muted opacity-40 mb-2" />
                <p className="text-sm text-text-muted">暂无背景音乐</p>
                <button onClick={() => bgmInputRef.current?.click()} className="text-xs font-semibold mt-2" style={{ color: TRAFFIC_GREEN }}>上传一首</button>
              </div>
            )}
            <div className="space-y-2 mb-7">
              <button onClick={() => { setBgm(''); if (audioRef.current) audioRef.current.pause(); setPlayingBgm(null); }}
                className="card !rounded-xl w-full p-3 flex items-center gap-3 text-left"
                style={!bgm ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}>
                <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: !bgm ? TRAFFIC_GREEN : 'var(--color-surface-2)', color: !bgm ? '#fff' : 'var(--color-text-muted)' }}>
                  <X size={15} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">不配乐</p>
                  <p className="text-xs text-text-muted mt-0.5">只保留原素材声音和口播配音</p>
                </div>
                {!bgm && <Check size={16} style={{ color: TRAFFIC_GREEN }} />}
              </button>
              {bgmTab === 'favorites' && visibleBgms.length === 0 && (
                <div className="card !rounded-xl border-dashed p-8 text-center">
                  <Heart size={22} className="mx-auto mb-2 text-text-muted opacity-50" />
                  <p className="text-sm font-semibold text-text-primary">还没有收藏的配乐</p>
                  <p className="mt-1 text-xs text-text-muted">在我的音乐里点心形即可加入收藏。</p>
                </div>
              )}
              {visibleBgms.map(b => {
                const on = bgm === b.id;
                const playing = playingBgm === b.id;
                const favored = favoriteBgms.includes(b.id);
                return (
                  <button key={b.id} onClick={() => setBgm(b.id)}
                    className="card !rounded-xl w-full p-3 flex items-center gap-3 text-left"
                    style={on ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}>
                    {/* 试听播放/暂停 */}
                    <span onClick={e => { e.stopPropagation(); togglePlay(b); }}
                      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
                      style={{ background: playing ? TRAFFIC_GREEN : on ? 'var(--color-accent-glow)' : 'var(--color-surface-2)', color: playing ? '#fff' : on ? TRAFFIC_GREEN : 'var(--color-text-muted)' }}>
                      {playing ? <Pause size={15} /> : <Play size={15} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-text-primary truncate">{b.name}</p>
                        {b.recommended && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: TRAFFIC_GREEN, color: '#fff' }}>AI 推荐</span>
                        )}
                        {playing && <span className="text-[10px] font-medium" style={{ color: TRAFFIC_GREEN }}>♪ 试听中</span>}
                      </div>
                      <p className="text-xs text-text-muted mt-0.5">{b.mood}</p>
                    </div>
                    <span
                      role="button"
                      tabIndex={0}
                      title={favored ? '取消收藏' : '收藏'}
                      onClick={e => { e.stopPropagation(); toggleFavoriteBgm(b.id); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleFavoriteBgm(b.id);
                        }
                      }}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-surface-2 transition-colors"
                      style={favored ? { color: TRAFFIC_GREEN } : undefined}
                    >
                      <Heart size={15} fill={favored ? 'currentColor' : 'none'} />
                    </span>
                    <span className="text-xs font-mono text-text-muted">{fmtDur(b.duration)}</span>
                    {on ? <Check size={16} style={{ color: TRAFFIC_GREEN }} /> : <Volume2 size={15} className="text-text-muted opacity-0" />}
                  </button>
                );
              })}
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-text-primary">音量调节</p>
                  <p className="mt-0.5 text-xs text-text-muted">分别控制背景乐和口播音量，口播出现时自动压低背景乐。</p>
                </div>
                <span className="rounded-lg bg-accent-glow px-2.5 py-1 text-[11px] font-bold text-accent">ducking</span>
              </div>
              <div className="space-y-4">
                <label className="block">
                  <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
                    <span className="text-text-secondary">背景乐</span>
                    <span className={bgm ? 'text-text-primary' : 'text-text-muted'}>{bgm ? `${bgmVol}%` : '关闭'}</span>
                  </div>
                  <input type="range" min={0} max={100} value={bgmVol}
                    onChange={e => setBgmVol(+e.target.value)} disabled={!bgm} className="w-full accent-[#16a34a] disabled:opacity-40" />
                </label>
                <label className="block">
                  <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
                    <span className="text-text-secondary">口播</span>
                    <span className={voiceoverMode === 'none' ? 'text-text-muted' : 'text-text-primary'}>{voiceoverMode === 'none' ? '关闭' : `${voiceVol}%`}</span>
                  </div>
                  <input type="range" min={0} max={150} value={voiceVol}
                    onChange={e => setVoiceVol(+e.target.value)} disabled={voiceoverMode === 'none'} className="w-full accent-[#16a34a] disabled:opacity-40" />
                </label>
              </div>
            </div>
          </div>
        );
      }

      /* ⑤ 封面 —— 用所选视频的真实帧画面，便于辨认内容 */
      case 'cover': {
        const renderCard = (clip: Clip) => {
          const frameUrl = clip.poster ?? clip.url;
          const key = clip.id;
          const label = clip.name;
          const on = cover === key;
          return (
            <div key={key} role="button" tabIndex={0} onClick={() => setCover(key)}
              className="card !rounded-2xl overflow-hidden text-left cursor-pointer"
              style={on ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 2px ${TRAFFIC_GREEN}` } : undefined}>
              <div className="relative aspect-[9/16]">
                {/* 选中的封面标题可直接在画面上点选编辑 */}
                <CoverFace frameUrl={frameUrl} frameType={clip.type} title={coverTitle} style={coverStyle}
                  editable={on} onTitleChange={setCoverTitle} />
                <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-semibold text-white bg-black/45 max-w-[80%] truncate z-10">{label}</span>
                {on && (
                  <span className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-white z-10" style={{ background: TRAFFIC_GREEN }}>
                    <Check size={14} />
                  </span>
                )}
              </div>
            </div>
          );
        };
        const SEG = (active: boolean) => `px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${active ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`;
        const SWATCHES = ['#ffffff', '#111827', '#16a34a', '#14b8a6', '#ef4444', '#3b82f6'];
        return (
          <div className="max-w-3xl">
            <SectionTitle title="选择封面" desc="用所选视频的真实帧作封面，一眼辨认是哪条素材" />

            {/* 标题（叠加在封面上，可编辑 / AI 重写） */}
            <div className="mb-4 max-w-xl">
              <p className="text-xs font-semibold text-text-secondary mb-1.5">封面标题</p>
              <div className="flex items-center gap-2">
                <input value={coverTitle} onChange={e => setCoverTitle(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg border border-border bg-surface text-sm outline-none focus:border-accent" />
                <button onClick={regenCovers} disabled={coverLoading}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-60 flex-shrink-0">
                  {coverLoading ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} AI 重写
                </button>
                <button onClick={() => void openCanvaCoverEditor()} disabled={coverCanvaOpening}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-60 flex-shrink-0"
                  style={{ background: TRAFFIC_GREEN }}>
                  {coverCanvaOpening ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
                  去可画编辑
                </button>
              </div>
              {/* 外语标题的中文翻译，供用户确认 */}
              {lang !== 'zh' && coverTitleZh && (
                <p className="text-[11px] text-text-muted mt-1.5">译：{coverTitleZh}</p>
              )}
              <p className="text-[11px] text-text-muted mt-1">提示：可直接点选下方选中封面上的标题就地编辑。</p>
            </div>

            {/* 标题样式：颜色 / 字号 / 位置 / 对齐 —— 同时驱动预览与生成的 SVG */}
            <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 max-w-xl">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text-secondary">颜色</span>
                {SWATCHES.map(c => (
                  <button key={c} onClick={() => setCoverStyle(s => ({ ...s, color: c }))}
                    className="w-5 h-5 rounded-full border transition-all"
                    style={{ background: c, borderColor: coverStyle.color === c ? TRAFFIC_GREEN : 'var(--color-border)', boxShadow: coverStyle.color === c ? `0 0 0 2px ${TRAFFIC_GREEN}` : undefined }} />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text-secondary">字号</span>
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
                  {(['S', 'M', 'L'] as const).map(z => (
                    <button key={z} className={SEG(coverStyle.size === z)} onClick={() => setCoverStyle(s => ({ ...s, size: z }))}>{z}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text-secondary">位置</span>
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
                  {([['top', '上'], ['center', '中'], ['bottom', '下']] as const).map(([p, l]) => (
                    <button key={p} className={SEG(coverStyle.position === p)} onClick={() => setCoverStyle(s => ({ ...s, position: p }))}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text-secondary">对齐</span>
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
                  {([['left', '左'], ['center', '居中']] as const).map(([a, l]) => (
                    <button key={a} className={SEG(coverStyle.align === a)} onClick={() => setCoverStyle(s => ({ ...s, align: a }))}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text-secondary">粗细</span>
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
                  {([['regular', '常规'], ['bold', '加粗'], ['heavy', '特粗']] as const).map(([w, l]) => (
                    <button key={w} className={SEG((coverStyle.weight ?? 'bold') === w)} onClick={() => setCoverStyle(s => ({ ...s, weight: w }))}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text-secondary">字体</span>
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border flex-wrap">
                  {COVER_FONTS.map(f => (
                    <button key={f.id} className={SEG(coverStyle.font === f.id && !coverStyle.fontFamily)} style={{ fontFamily: f.css }}
                      onClick={() => setCoverStyle(s => ({ ...s, font: f.id, fontFamily: undefined }))}>{f.label}</button>
                  ))}
                  {customFonts.map(cf => (
                    <button key={cf.family} className={SEG(coverStyle.fontFamily === cf.family)} style={{ fontFamily: cf.family }}
                      onClick={() => setCoverStyle(s => ({ ...s, fontFamily: cf.family }))}>{cf.label}</button>
                  ))}
                </div>
                {/* 官方导入字体模版 */}
                <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2,font/*" className="hidden"
                  onChange={e => { void importFont(e.target.files); e.target.value = ''; }} />
                <button onClick={() => fontInputRef.current?.click()}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-text-muted hover:text-text-primary">
                  <Upload size={12} /> 导入字体模版
                </button>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              {frameCandidates.map(c => renderCard(c))}
            </div>
            {frameCandidates.length === 0 && (
              <p className="text-xs text-text-muted mt-3">还没有可用帧画面——回到「选素材」选入视频或图片，这里就能用它们的画面当封面。</p>
            )}
          </div>
        );
      }

      /* ⑥ 成片预览 */
      case 'preview': {
        const languageVersions = voiceoverMode === 'ai'
          ? voiceLangs.filter(code => voiceDrafts[code]?.trim() && voiceoverAudios[code]?.url)
          : [activeVoiceLang].filter(code => Boolean(code && voiceoverUrl));
        const activePreviewItem = previewIdx !== null ? previewTimeline[previewIdx] : null;
        const previewTimelineDuration = renderTimeline.reduce((sum, item) => sum + (item.targetDuration || 0), 0);
        return (
          <div className="flex items-start gap-8">
            {/* 播放器 */}
            <div className="flex-shrink-0">
              <div className="relative rounded-2xl overflow-hidden border border-border bg-black" style={{ width: 260 }}>
                <div className="relative aspect-[9/16]">
                  {activePreviewItem ? (
                    activePreviewItem.clip.type === 'image' ? (
                      <img src={activePreviewItem.clip.url} alt="" className="absolute inset-0 w-full h-full object-cover bg-black" />
                    ) : (
                      // 按时间戳 timeline 播放：每段 seek 到 trimStart，并按 targetDuration 自动切下一段
                      <video
                        key={`${activePreviewItem.clipId}-${activePreviewItem.trimStart}-${activePreviewItem.targetStart}`}
                        ref={previewVideoRef}
                        src={activePreviewItem.clip.url}
                        autoPlay
                        controls
                        playsInline
                        muted={Boolean(bgm || (voiceoverMode !== 'none' && voiceoverUrl))}
                        className="absolute inset-0 w-full h-full object-cover bg-black"
                        onPause={pausePreviewAudio}
                        onPlay={resumePreviewAudio}
                        onTimeUpdate={updatePreviewClock}
                        onEnded={handlePreviewClipEnded}
                      />
                    )
                  ) : (
                    <CoverFace coverUrl={coverUrl} frameUrl={coverFrameUrl} frameType={coverClip?.type} title={coverTitle} style={coverStyle} />
                  )}
                </div>
                {activePreviewItem && (
                  <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-black/60 px-2 py-1 text-[10px] font-bold text-white">
                    {previewIdx! + 1}/{previewTimeline.length} · {activePreviewItem.targetStart ?? 0}s-{activePreviewItem.targetEnd ?? activePreviewItem.targetDuration}s
                  </div>
                )}
                {previewIdx !== null && activePreviewCue && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-[7%] z-20 px-4 text-center">
                    <p className="inline-block max-w-full rounded-md bg-black/35 px-2 py-1 text-[17px] font-black leading-tight text-white"
                      style={{ textShadow: '0 2px 4px rgba(0,0,0,0.9)' }}>
                      {activePreviewCue.text}
                    </p>
                  </div>
                )}
                {previewIdx === null && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    {rendering ? (
                      <div className="text-center">
                        <Loader2 size={30} className="text-white animate-spin mx-auto mb-2" />
                        <p className="text-white text-xs font-medium">AI 合成中… {renderPct}%</p>
                        <div className="mx-auto mt-2 h-1 w-32 rounded-full bg-white/25 overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${renderPct}%`, background: '#fff' }} />
                        </div>
                      </div>
                    ) : (
                      <button onClick={startPreview}
                        className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg active:scale-95 transition-transform">
                        <Play size={22} className="text-text-primary ml-0.5" fill="currentColor" />
                      </button>
                    )}
                  </div>
                )}
                <audio ref={previewBgmAudioRef} src={selectedBgmTrack?.url || undefined} preload="auto" />
                <audio ref={previewVoiceAudioRef} src={voiceoverMode === 'none' ? undefined : voiceoverUrl || undefined} preload="auto" />
                {previewIdx !== null && (
                  <button onClick={stopPreview} className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-black/55 flex items-center justify-center text-white">
                    <X size={14} />
                  </button>
                )}
              </div>
              {/* 无真实可播放素材时的说明 */}
              {previewNote && (
                <p className="text-[11px] text-text-muted mt-2 w-[260px] leading-relaxed">
                  该片段暂无可播放源文件，请上传真实视频素材，或在桌面客户端合成后下载完整成片。
                </p>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <SectionTitle title="成片预览" desc="确认效果后进入剪映做最终精修" />
              <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-border bg-surface-2 px-3 py-2">
                    <p className="text-[11px] font-semibold text-text-muted">素材片段</p>
                    <p className="mt-1 text-sm font-bold text-text-primary">{renderTimeline.length || selectedClips.length} 段 · {Math.round(previewTimelineDuration || totalDur)}s</p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface-2 px-3 py-2">
                    <p className="text-[11px] font-semibold text-text-muted">字幕</p>
                    <p className="mt-1 text-sm font-bold text-text-primary">{subtitlesOn ? `${cues.length} 条` : '不启用'}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface-2 px-3 py-2">
                    <p className="text-[11px] font-semibold text-text-muted">口播</p>
                    <p className="mt-1 text-sm font-bold text-text-primary">{voiceoverMode === 'none' ? '不配音' : voiceoverUrl ? `${voiceoverMode === 'upload' ? '本地音频' : 'AI 配音'} · ${voiceoverDur || 0}s` : '未生成'}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface-2 px-3 py-2">
                    <p className="text-[11px] font-semibold text-text-muted">背景配乐</p>
                    <p className="mt-1 text-sm font-bold text-text-primary">{bgm ? bgms.find(b => b.id === bgm)?.name || '已选择' : '不配乐'}</p>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl border border-border bg-surface-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-text-primary">多语种版本</p>
                      <p className="mt-0.5 text-xs text-text-muted">按当前素材、字幕和音量配置，分别输出不同语种视频。</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void renderLanguageVersions()}
                      disabled={batchRenderingLangs || languageVersions.length === 0}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {batchRenderingLangs ? <Loader2 size={13} className="animate-spin" /> : <Languages size={13} />}
                      {batchRenderingLangs ? '生成中...' : `生成 ${languageVersions.length || 0} 个版本`}
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {languageVersions.length > 0 ? languageVersions.map(code => {
                      const item = languageRenderOutputs[code];
                      const label = LANGS.find(langItem => langItem.code === code)?.label || code.toUpperCase();
                      const active = activeVoiceLang === code;
                      const canPreview = Boolean(voiceoverMode === 'ai' ? voiceoverAudios[code]?.url : voiceoverUrl);
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => previewLanguageVersion(code)}
                          disabled={!canPreview}
                          className={`rounded-xl border bg-white px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${active ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]' : 'border-border hover:border-accent/60 hover:bg-accent-glow/30'}`}
                          title={canPreview ? '点击在左侧预览该语种版本' : '该语种还没有可用配音'}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-text-primary">{label}</span>
                            <span className={`text-[10px] font-bold ${
                              active ? 'text-accent'
                              : item?.status === 'done' ? 'text-accent'
                              : item?.status === 'failed' ? 'text-red-500'
                              : item?.status === 'rendering' ? 'text-text-primary'
                              : 'text-text-muted'
                            }`}>
                              {active ? '预览中'
                                : item?.status === 'done' ? '已生成'
                                : item?.status === 'failed' ? '失败'
                                : item?.status === 'rendering' ? '生成中'
                                : voiceoverAudios[code] || voiceoverUrl ? '可生成' : '缺音频'}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-[10px] text-text-muted">{item?.path || item?.error || (canPreview ? '点击左侧预览该语种视频' : '请先生成该语种配音')}</p>
                        </button>
                      );
                    }) : (
                      <div className="rounded-xl border border-dashed border-border bg-white px-3 py-4 text-xs text-text-muted sm:col-span-3">
                        请先回到「口播脚本」生成多语种口播音频。
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => void downloadMp4()}
                  disabled={rendering}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-4 text-base font-black text-white shadow-sm transition disabled:opacity-50 active:scale-[0.99]"
                >
                  {rendering ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  {rendering ? `正在生成本地成片 ${renderPct}%` : renderOutputPath ? '打开本地成片' : '下载成片到本地'}
                </button>
                {renderDownloadMessage && (
                  <div className="mt-3 rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs leading-relaxed text-text-secondary">
                    {renderOutputPath && renderDownloadMessage.includes(renderOutputPath) ? (
                      <>
                        <span>成片已保存到本地：</span>
                        <button
                          type="button"
                          onClick={() => void openRenderOutputFolder(renderOutputPath)}
                          className="inline text-left font-bold text-blue-600 underline decoration-blue-600/30 underline-offset-2 transition hover:text-blue-700"
                          title={`点击打开所在文件夹：${renderOutputPath}`}
                        >
                          {localFileName(renderOutputPath)}
                        </button>
                      </>
                    ) : renderDownloadMessage}
                  </div>
                )}
                <button
                  onClick={() => void openInCapcut()}
                  disabled={capcutOpening}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-4 text-base font-black text-white shadow-sm transition active:scale-[0.99]"
                >
                  {capcutOpening ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
                  {capcutOpening ? '正在准备剪映精修包...' : '导出剪映精修包'}
                </button>
                {capcutMessage && (
                  <div className="mt-3 rounded-xl border border-accent/20 bg-accent-glow px-3 py-2 text-xs leading-relaxed text-accent">
                    {capcutMessage}
                  </div>
                )}
                <button
                  onClick={goPublishCurrentWork}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-accent bg-white px-5 py-4 text-base font-black text-accent shadow-sm transition hover:bg-accent-glow active:scale-[0.99]"
                >
                  <Send size={18} />
                  去账号一键发布
                </button>
                <p className="mt-3 text-xs leading-relaxed text-text-muted">
                  剪映用于最终精修和导出；一键发布会跳转到顶部总控的账号发布页，并带入当前作品标题、文案和成片信息。
                </p>
              </div>
            </div>
          </div>
        );
      }
    }
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* BGM 试听用的隐藏音频元素 */}
      <audio ref={audioRef} onEnded={() => setPlayingBgm(null)} className="hidden" />

      {/* ── 顶部工作条：标题 + 保存草稿 + 我的作品 ─────────── */}
      <div className="h-11 flex items-center gap-3 px-4 border-b border-border flex-shrink-0">
        <FileText size={13} className="text-text-muted flex-shrink-0" />
        <input
          value={projectTitle}
          onChange={e => setProjectTitle(e.target.value)}
          placeholder="未命名草稿"
          className="text-sm font-semibold text-text-primary bg-transparent outline-none min-w-0 flex-1 max-w-xs placeholder:text-text-muted"
        />
        {projectId && <span className="text-[10px] text-text-muted">已保存</span>}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => void saveProject('draft')} disabled={savingProj}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-50 transition-colors">
            {savingProj ? <Loader2 size={13} className="animate-spin" /> : savedTick ? <Check size={13} className="text-accent" /> : <Save size={13} />}
            {savedTick ? '已保存' : '保存草稿'}
          </button>
          <button onClick={() => void openProjects()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all active:scale-95"
            style={{ background: TRAFFIC_GREEN }}>
            <FolderOpen size={13} /> 我的作品
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
      {/* ── ① 步骤导航 ─────────────────────────────── */}
      <aside className="w-32 flex-shrink-0 border-r border-border flex flex-col bg-surface-2/40">
        <div className="px-3 pt-4 pb-3">
          <p className="text-[9px] font-mono text-text-muted uppercase tracking-wider mb-1">AI 生成</p>
          <p className="text-xs font-bold text-text-primary font-display">AI智能素材</p>
        </div>
        <div className="flex-1 px-2 space-y-0.5 overflow-y-auto">
          {STEPS.map((s, i) => {
            const done = i < stepIdx;
            const active = i === stepIdx;
            return (
              <button key={s.id} onClick={() => i <= stepIdx && setStepIdx(i)}
                disabled={i > stepIdx}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors ${
                  active ? 'bg-surface shadow-sm' : i > stepIdx ? 'opacity-40 cursor-not-allowed' : 'hover:bg-surface'}`}>
                <span className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 text-[10px] font-bold"
                  style={
                    active ? { background: TRAFFIC_GREEN, color: '#fff' }
                    : done ? { background: 'var(--color-accent-glow)', color: 'var(--color-accent)' }
                    : { background: 'var(--color-surface-2)', color: 'var(--color-text-muted)' }
                  }>
                  {done ? <Check size={11} /> : i + 1}
                </span>
                <div className="min-w-0">
                  <p className={`text-[11px] font-semibold leading-tight whitespace-nowrap ${active ? 'text-text-primary' : 'text-text-secondary'}`}>{s.label}</p>
                  <p className="text-[8px] text-text-muted truncate whitespace-nowrap mt-0.5">{s.hint}</p>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── ② 操作区 ───────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }} className="h-full">
              {renderStep()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* 底部导航条 */}
        <div className="h-14 flex items-center justify-between px-6 border-t border-border flex-shrink-0">
          <button onClick={prev} disabled={stepIdx === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-text-secondary hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
            <ChevronLeft size={15} /> 上一步
          </button>
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <span key={i} className="h-1 rounded-full transition-all"
                style={{ width: i === stepIdx ? 18 : 6, background: i <= stepIdx ? TRAFFIC_GREEN : 'var(--color-border)' }} />
            ))}
          </div>
          {!isLast ? (
            <button onClick={next} disabled={!canNext}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-40"
              style={{ background: TRAFFIC_GREEN }}>
              下一步 <ChevronRight size={15} />
            </button>
          ) : (
            <span className="w-[88px]" />
          )}
        </div>
      </div>

      </div>

      {/* ── 我的作品 / 草稿 列表浮层 ─────────────────────── */}
      <AnimatePresence>
        {showProjects && (
          <ProjectsOverlay
            projects={projects}
            currentId={projectId}
            onClose={() => setShowProjects(false)}
            onLoad={loadProject}
            onDelete={removeProject}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── 我的作品 / 草稿 浮层 ─────────────────────────────────────────────── */
function ProjectsOverlay({ projects, currentId, onClose, onLoad, onDelete }: {
  projects: StudioProject[];
  currentId: string | null;
  onClose: () => void;
  onLoad: (p: StudioProject) => void;
  onDelete: (id: string) => void;
}) {
  const drafts = projects.filter(p => p.status === 'draft');
  const works = projects.filter(p => p.status === 'published');

  const Section = ({ title, items }: { title: string; items: StudioProject[] }) => (
    <div className="mb-5">
      <p className="text-xs font-semibold text-text-secondary mb-2">{title} · {items.length}</p>
      {items.length === 0 ? (
        <p className="text-xs text-text-muted py-3 text-center">暂无</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {items.map(p => (
            <div key={p.id}
              className="card !rounded-xl overflow-hidden group cursor-pointer relative"
              style={p.id === currentId ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}
              onClick={() => onLoad(p)}>
              <Thumb seed={p.thumbSeed ?? 'cv1'} ratio="aspect-video" />
              <div className="p-2.5">
                <p className="text-xs font-semibold text-text-primary truncate">{p.title}</p>
                <p className="text-[10px] text-text-muted mt-0.5">{new Date(p.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); onDelete(p.id); }}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-lg bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}>
      <motion.div
        initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 10 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="w-[560px] max-h-[80%] flex flex-col rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <FolderOpen size={15} style={{ color: TRAFFIC_GREEN }} />
            <span className="text-sm font-bold text-text-primary">我的作品</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors">
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {projects.length === 0 ? (
            <div className="text-center py-12">
              <FolderOpen size={28} className="mx-auto text-text-muted mb-3 opacity-30" />
              <p className="text-sm text-text-muted">还没有保存任何草稿或作品</p>
              <p className="text-xs text-text-muted mt-1">在工作台点「保存草稿」即可留存</p>
            </div>
          ) : (
            <>
              <Section title="我的草稿" items={drafts} />
              <Section title="已发布作品" items={works} />
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── 小组件 ───────────────────────────────────────────────────────────── */

function SectionTitle({ title, desc, noMargin }: { title: string; desc?: string; noMargin?: boolean }) {
  return (
    <div className={noMargin ? '' : 'mb-4'}>
      <h3 className="text-base font-bold text-text-primary font-display">{title}</h3>
      {desc && <p className="text-xs text-text-muted mt-0.5">{desc}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-text-secondary mb-2">{label}</p>
      {children}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border"
      style={active
        ? { background: TRAFFIC_GREEN, color: '#fff', borderColor: TRAFFIC_GREEN }
        : { background: 'var(--color-surface)', color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }}>
      {children}
    </button>
  );
}
