import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutGrid, Film, FileText, Music, Image as ImageIcon, Play, Send,
  Check, ChevronLeft, ChevronRight, Folder, Search, Volume2, Globe,
  Mic, Download, Loader2, Sparkles, Wand2, Copy, RefreshCw, Clock,
  Upload, X, Plus, Smartphone, List, Save, FolderOpen, Trash2, Pause, ChevronDown,
} from 'lucide-react';
import { studioApi, getDesktopRender, type StudioProject, type Material, type BgmTrack, type CoverStyle, type SubCue } from '../lib/studioApi';
import type { Page } from '../App';

/* ──────────────────────────────────────────────────────────────────────────
   AI 生成内容工作台 — 社媒（流量）页子模块
   流程：选模式 → 选素材 → 口播脚本 → 配乐 → 封面 → 成片预览 → 导出/一键发布
   三栏布局：① 步骤导航  ② 操作区  ③ 实时预览 / 制作摘要
─────────────────────────────────────────────────────────────────────────── */

const AMBER = '#d97706';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const mediaType = (f: File): 'video' | 'image' | 'audio' =>
  f.type.startsWith('video') ? 'video' : f.type.startsWith('audio') ? 'audio' : 'image';

const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = rej;
  r.readAsDataURL(f);
});

// 客户端读取视频时长，避免服务端依赖 ffprobe
const probeDuration = (f: File) => new Promise<number>(res => {
  if (!f.type.startsWith('video')) { res(0); return; }
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); res(Math.round(v.duration) || 0); };
  v.onerror = () => res(0);
  v.src = URL.createObjectURL(f);
});

const materialToClip = (m: Material): Clip => ({
  id: m.id, name: m.name, folder: m.folder, type: m.type, duration: m.duration, size: m.size, url: m.url, poster: m.poster, scope: m.scope ?? 'own',
});

type StepId = 'mode' | 'material' | 'script' | 'bgm' | 'cover' | 'preview' | 'publish';

const STEPS: { id: StepId; label: string; icon: typeof LayoutGrid; hint: string }[] = [
  { id: 'mode',     label: '选模式',  icon: LayoutGrid, hint: '选择生成起点与全局参数' },
  { id: 'material', label: '选素材',  icon: Film,       hint: '从素材库挑选并排序片段' },
  { id: 'script',   label: '口播脚本', icon: FileText,   hint: 'AI 生成口播 + 配音音色' },
  { id: 'bgm',      label: '配乐',     icon: Music,      hint: 'AI 推荐背景乐与音量平衡' },
  { id: 'cover',    label: '封面',     icon: ImageIcon,  hint: '生成封面候选并选定标题' },
  { id: 'preview',  label: '成片预览', icon: Play,       hint: '合成成片，局部微调重渲染' },
  { id: 'publish',  label: '导出/发布', icon: Send,       hint: '下载成片或一键多平台发布' },
];

interface MaterialFolder { id: string; name: string; count: number }
const FOLDERS: MaterialFolder[] = [
  { id: 'all',     name: '全部素材',   count: 0 },
  { id: 'hot',     name: '爆款素材',   count: 0 },
  { id: 'upload',  name: '我的上传',   count: 0 },
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
const CLIPS: Clip[] = [];

interface Bgm { id: string; name: string; mood: string; duration: number; url?: string; recommended?: boolean }
// 已移除内置曲库（生成质量不达标）；仅展示用户自行上传的音乐
const BGMS: Bgm[] = [];
const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const fmtTime = (s: number) => `0:${String(Math.round(s)).padStart(2, '0')}`;

// 句子切分（中英日通用：按句末标点 / 换行）
const splitSentences = (text: string): string[] =>
  text.replace(/\s+/g, ' ').split(/(?<=[.!?。！？…])\s+/).map(s => s.trim()).filter(Boolean);

// 把一段文本在 [start,end] 区间内按字数比例分配成多条 cue
function distribute(text: string, start: number, end: number): SubCue[] {
  const sents = splitSentences(text);
  const total = sents.reduce((n, s) => n + s.length, 0) || 1;
  let t = start;
  return sents.map(s => {
    const dur = (end - start) * (s.length / total);
    const cue = { start: +t.toFixed(2), end: +(t + dur).toFixed(2), text: s };
    t += dur;
    return cue;
  });
}

/* 由口播脚本生成字幕 cue（A 层兜底对齐：优先脚本时间标记，否则按 TTS 时长字数比例；
   桌面端 ASR 回传逐词时间戳后会替换为精确对齐——共用同一 SubCue 结构）。 */
function buildCues(script: string, totalDur: number): SubCue[] {
  const lines = script.split('\n');
  // 形如 [Hook · 0-3s] / [Body · 3-15s] 的时间段标记
  const headerRe = /\[[^\]]*?(\d+)\s*[-–]\s*(\d+)\s*s[^\]]*\]/i;
  const sections: { start: number; end: number; text: string }[] = [];
  let cur: { start: number; end: number; text: string } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(headerRe);
    if (m) {
      cur = { start: +m[1], end: +m[2], text: '' };
      sections.push(cur);
    } else if (line && cur) {
      cur.text += (cur.text ? ' ' : '') + line.replace(/^\[.*?\]\s*/, '');
    }
  }
  if (sections.length && sections.some(s => s.text)) {
    return sections.filter(s => s.text).flatMap(s => distribute(s.text, s.start, s.end));
  }
  // 无时间标记：清掉所有方括号标记后整体按时长分配
  const clean = script.replace(/\[[^\]]*\]/g, ' ').trim();
  return clean ? distribute(clean, 0, totalDur || 20) : [];
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
  { id: 'v4', name: '上传真人口播',          tag: '自定义' },
];

const COVERS = [
  { id: 'cv1', title: 'You NEED this in 2026', accent: '#d97706' },
  { id: 'cv2', title: 'Factory price, 24h ship', accent: '#16a34a' },
  { id: 'cv3', title: 'Why everyone is obsessed', accent: '#c13584' },
];

interface SocialAccount { id: string; platform: string; handle: string; color: string }
const ACCOUNTS: SocialAccount[] = [
  { id: 'a1', platform: 'TikTok',    handle: '@yiwu_home',     color: '#010101' },
  { id: 'a2', platform: 'Instagram', handle: '@yiwu.official', color: '#c13584' },
  { id: 'a3', platform: 'YouTube',   handle: 'Yiwu Trading',   color: '#ff0000' },
];

const MODES = [
  { id: 'material', icon: Film,    title: '从素材库生成', desc: '挑选本地素材，AI 智能编排成片' },
  { id: 'clone',    icon: Wand2,   title: '爆款克隆',     desc: '复用已分析爆款的结构与节奏' },
  { id: 'product',  icon: Sparkles,title: '从商品生成',   desc: '输入商品信息，一键全自动出片' },
] as const;

const PLATFORMS = [
  { id: 'tiktok',    label: 'TikTok',    ratio: '9:16' },
  { id: 'instagram', label: 'Instagram', ratio: '9:16' },
  { id: 'youtube',   label: 'YouTube',   ratio: '16:9' },
  { id: 'facebook',  label: 'Facebook',  ratio: '9:16' },
];
const RATIOS = ['9:16', '1:1', '16:9'];
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
  西班牙语: 'es', spanish: 'es', es: 'es',
  法语: 'fr', french: 'fr', fr: 'fr',
  德语: 'de', german: 'de', de: 'de',
  葡萄牙语: 'pt', portuguese: 'pt', pt: 'pt',
  意大利语: 'it', italian: 'it', it: 'it',
  俄语: 'ru', russian: 'ru', ru: 'ru',
  日语: 'ja', japanese: 'ja', ja: 'ja',
  韩语: 'ko', korean: 'ko', ko: 'ko',
  阿拉伯语: 'ar', arabic: 'ar', ar: 'ar',
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
  products?: { categories?: string; priceRange?: string; moq?: string; highlights?: string };
  brand?: { tone?: string; usp?: string; preferredLanguages?: string };
  strategy?: { focusProducts?: string; focusMarkets?: string };
  customers?: { targetProfiles?: string };
}

interface SeedanceKickoff {
  script?: string;
  scriptType?: 'voiceover' | 'storyboard';
  language?: string;
  productInfo?: string;
  video?: {
    title?: string;
    platform?: string;
    videoUrl?: string;
    aiAnalysis?: { materialUrl?: string };
  };
}

const SAMPLE_SCRIPT = `[Hook · 0-3s]
Stop scrolling — this is the one product everyone's been asking about.

[Body · 3-15s]
Sourced straight from our factory, this changed how thousands of buyers shop. Premium quality, factory-direct pricing, ships worldwide in 24 hours.

[CTA · 15-20s]
Tap the link to grab yours before they sell out again.`;

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

/* 封面预览：优先用已生成的封面 SVG；否则用所选帧（或渐变）+ 标题叠层。
   字号用 cqw（容器宽度百分比）与 SVG 的 fontSize 比例一致，预览即所见。 */
const WEIGHT_MAP = { regular: 600, bold: 800, heavy: 900 } as const;
function CoverFace({ coverUrl, frameUrl, title, style, editable, onTitleChange }: { coverUrl?: string | null; frameUrl?: string; title: string; style: CoverStyle; editable?: boolean; onTitleChange?: (t: string) => void }) {
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
      {frameUrl
        ? <img src={frameUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        : <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg,#fbbf24,#b45309)' }} />}
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

export default function AiCreateStudio({ onNavigate }: { onNavigate?: (p: Page) => void } = {}) {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx].id;

  // 全局制作状态
  const [mode, setMode] = useState<'material' | 'clone' | 'product'>('material');
  const [platform, setPlatform] = useState('tiktok');
  const [ratio, setRatio] = useState('9:16');
  const [duration, setDuration] = useState(20);
  const [lang, setLang] = useState('en');
  const [provider, setProvider] = useState<'gemini' | 'qwen'>('gemini');
  const [productInfo, setProductInfo] = useState('');
  const [audience, setAudience] = useState('');
  const [sellingPoints, setSellingPoints] = useState('');
  const [tone, setTone] = useState('高转化 · 口语化');

  const [activeFolder, setActiveFolder] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const [materials, setMaterials] = useState<Clip[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [script, setScript] = useState(SAMPLE_SCRIPT);
  const [scriptType, setScriptType] = useState<'voiceover' | 'storyboard'>('voiceover');
  const [voice, setVoice] = useState('v1');
  const [scriptLoading, setScriptLoading] = useState(false);
  const autoGen = useRef(false); // 仅首次进入脚本步时自动生成一次

  // 配音 TTS
  const [voiceoverUrl, setVoiceoverUrl] = useState<string | null>(null);
  const [voiceoverDur, setVoiceoverDur] = useState(0);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  const [bgm, setBgm] = useState('');   // 无内置曲库，默认不选
  const [bgmVol, setBgmVol] = useState(35);
  const [bgms, setBgms] = useState<Bgm[]>(BGMS);
  const [playingBgm, setPlayingBgm] = useState<string | null>(null);
  const [bgmUploading, setBgmUploading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bgmInputRef = useRef<HTMLInputElement>(null);

  const [cover, setCover] = useState('gradient'); // 'gradient' 或某素材 id（用其帧画面作封面底图）
  const [coverTitle, setCoverTitle] = useState(COVERS[0].title);
  const [coverTitleZh, setCoverTitleZh] = useState('');   // 标题中文翻译（供确认）
  const [coverStyle, setCoverStyle] = useState<CoverStyle>({ color: '#ffffff', size: 'M', position: 'bottom', align: 'left', font: 'sans', weight: 'bold' });
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null); // 生成的封面 SVG 文件地址（发布缩略图）
  const [customFonts, setCustomFonts] = useState<{ family: string; label: string }[]>([]); // 官方导入的字体模版
  const fontInputRef = useRef<HTMLInputElement>(null);


  const [rendering, setRendering] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [renderPct, setRenderPct] = useState(0);
  const [renderOutputPath, setRenderOutputPath] = useState<string | null>(null); // 桌面端合成产物路径
  const renderToken = useRef(0); // 取消过期的渲染循环（重复点「重新合成」时）

  const [account, setAccount] = useState<string | null>('a1');
  const [caption, setCaption] = useState('Factory-direct home essentials 🏠✨ #tiktokmademebuyit #homefinds');
  const [captionLoading, setCaptionLoading] = useState(false);
  const [published, setPublished] = useState(false);
  const [demoAutoLoading, setDemoAutoLoading] = useState(false);
  const [savedToWorks, setSavedToWorks] = useState(false); // 「存入我的作品」反馈

  useEffect(() => {
    let alive = true;
    fetch('/api/overseas/enterprise/profile')
      .then(r => r.json())
      .then((profile: EnterpriseProfileLite) => {
        if (!alive) return;
        const preferred = profile.brand?.preferredLanguages || profile.company?.primaryLanguages || '';
        setLang(languageTextToCode(preferred));
        setProductInfo(prev => prev || [
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

  // 成片预览：网页端顺序播放选中的真实视频片段（mock 占位素材无 url，不可播放）
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [previewNote, setPreviewNote] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  // 字幕（A 层：脚本兜底对齐 + 沿用封面样式；桌面端 ffmpeg 烧录）
  const [subtitlesOn, setSubtitlesOn] = useState(true);
  const [subMode, setSubMode] = useState<'target' | 'bilingual'>('target');
  const [subPreviewIdx, setSubPreviewIdx] = useState(0); // 预览叠层当前展示的 cue
  const [cueZh, setCueZh] = useState<string[]>([]);       // 双语字幕的中文译文（与 cues 对齐）
  const [clipEdits, setClipEdits] = useState<Record<string, ClipEdit>>({});

  // 草稿 / 作品
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState('未命名草稿');
  const [showProjects, setShowProjects] = useState(false);
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [savingProj, setSavingProj] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [seedanceKickoff, setSeedanceKickoff] = useState<SeedanceKickoff | null>(null);

  const selectedClips = useMemo(() => materials.filter(c => selected.includes(c.id)), [selected, materials]);
  const totalDur = selectedClips.reduce((s, c) => s + (c.type === 'image' ? 3 : c.duration), 0);
  const matNames = selectedClips.map(c => c.name);
  // 选中的封面底图帧：'gradient' → 无（渐变）；否则取该素材的帧画面（视频抽帧 / 图片自身）
  const coverFrameUrl = useMemo(() => {
    if (cover === 'gradient') return undefined;
    const c = materials.find(m => m.id === cover);
    return c?.poster ?? (c?.type === 'image' ? c.url : undefined);
  }, [cover, materials]);
  // 可作封面的候选：选中素材里有帧画面的（视频有抽帧 / 图片）
  const frameCandidates = useMemo(() => selectedClips.filter(c => c.poster || c.type === 'image'), [selectedClips]);
  // 成片预览可播放的真实视频片段（mock 占位素材没有 url）
  const previewable = useMemo(() => selectedClips.filter(c => c.url && c.type === 'video'), [selectedClips]);
  // 字幕 cue：脚本 + TTS 时长（无配音则用素材总时长）
  const cues = useMemo(() => buildCues(script, voiceoverDur || totalDur), [script, voiceoverDur, totalDur]);
  // 字幕样式沿用封面体系，但默认底部居中 + 适配字号
  const subStyle: CoverStyle = useMemo(() => ({ ...coverStyle, position: 'bottom', align: 'center', size: coverStyle.size === 'L' ? 'M' : 'S' }), [coverStyle]);

  const canNext = step === 'material' ? selected.length > 0 : true;
  const isLast = stepIdx === STEPS.length - 1;

  useEffect(() => {
    let raw = '';
    try {
      raw = localStorage.getItem('ow_seedance_kickoff') || '';
      if (raw) localStorage.removeItem('ow_seedance_kickoff');
    } catch { /* ignore */ }
    if (!raw) return;
    try {
      const kickoff = JSON.parse(raw) as SeedanceKickoff;
      setSeedanceKickoff(kickoff);
      if (kickoff.script) setScript(kickoff.script);
      if (kickoff.scriptType === 'voiceover' || kickoff.scriptType === 'storyboard') setScriptType(kickoff.scriptType);
      if (kickoff.language) setLang(kickoff.language);
      if (kickoff.productInfo) setProductInfo(kickoff.productInfo);
      if (kickoff.video?.platform) setPlatform(kickoff.video.platform);
      setProvider('gemini');
      setMode('material');
      setActiveFolder('hot');
      setProjectTitle(kickoff.video?.title ? `Seedance 2.0 · ${kickoff.video.title}` : 'Seedance 2.0 爆款复刻');
      setStepIdx(STEPS.findIndex(s => s.id === 'material'));
      autoGen.current = true;
    } catch { /* ignore malformed kickoff */ }
  }, []);

  useEffect(() => {
    if (!seedanceKickoff || materials.length === 0) return;
    const materialUrl = seedanceKickoff.video?.aiAnalysis?.materialUrl || seedanceKickoff.video?.videoUrl || '';
    const title = seedanceKickoff.video?.title || '';
    const matched = materials.find(m => (materialUrl && m.url === materialUrl) || (title && m.name.includes(title.slice(0, 40))));
    if (matched) setSelected([matched.id]);
  }, [materials, seedanceKickoff]);

  const editFor = (clip: Clip): ClipEdit => clipEdits[clip.id] ?? {
    trimStart: 0,
    trimEnd: clip.type === 'image' ? 3 : clip.duration,
    speed: 1,
    transition: '硬切',
    note: '',
  };
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

  const goPreview = async (scriptOverride?: string) => {
    setStepIdx(STEPS.findIndex(s => s.id === 'preview'));
    setRendered(false);
    setRendering(true);
    setRenderPct(0);
    setRenderOutputPath(null);
    const token = ++renderToken.current;
    try {

    // 生成发布封面 SVG（缩略图）：选中帧作底图，否则品牌渐变；带标题样式
    const cv = await studioApi.cover({ title: coverTitle, ratio, accent: '#d97706', bgImageUrl: coverFrameUrl, ...coverStyle });
    if (renderToken.current !== token) return;
    const cUrl = cv.ok ? (cv.url ?? null) : null;
    setCoverUrl(cUrl);

    const spec = {
      materials: matNames,
      script: scriptOverride ?? script,
      voice,
      bgm,
      bgmVol,
      coverId: cover,
      coverTitle,
      coverUrl: cUrl ?? undefined,
      ratio,
      duration,
      platform,
      language: lang,
      voiceoverUrl: voiceoverUrl ?? undefined,
      subtitles: subtitlesOn ? {
        mode: subMode,
        style: { font: coverStyle.font, color: coverStyle.color, weight: coverStyle.weight, fontFamily: coverStyle.fontFamily },
        cues: subMode === 'bilingual' ? cues.map((c, i) => ({ ...c, zh: cueZh[i] })) : cues,
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
          setRenderOutputPath(out.outputPath ?? null);
          setRendering(false);
          setRendered(true);
          setRenderPct(100);
        } else {
          setRendering(false);
          setRendered(false);
        }
      } finally {
        unsub();
      }
      return;
    }

    // 3) 纯网页：无法调用本机 ffmpeg，仅模拟进度供预览交互（真出片需桌面客户端）
    for (let p = 12; p <= 100; p += 16) {
      await sleep(240);
      if (renderToken.current !== token) return;
      setRenderPct(Math.min(p, 100));
    }
    setRendering(false);
    setRendered(true);
    setRenderPct(100);
    } catch (err: any) {
      if (renderToken.current === token) {
        setRendering(false);
        setRendered(false);
        alert(err?.message || '成片预览失败，请稍后重试。');
      }
    }
  };

  const next = () => {
    if (STEPS[stepIdx + 1]?.id === 'preview') return goPreview();
    setStepIdx(i => Math.min(i + 1, STEPS.length - 1));
  };
  const prev = () => setStepIdx(i => Math.max(i - 1, 0));

  const regenScript = async (type: 'voiceover' | 'storyboard' = scriptType) => {
    setScriptLoading(true);
    try {
      const { script: s } = await studioApi.script(
        { materials: matNames, productInfo, language: lang, platform, duration, scriptType: type, provider, audience, sellingPoints, tone }, script,
      );
      setScript(s);
    } catch (err: any) {
      alert(err?.message || '脚本生成失败，请稍后重试。');
    } finally {
      setScriptLoading(false);
    }
  };

  // 首次进入「口播脚本」步时自动生成一次
  useEffect(() => {
    if (step === 'script' && !autoGen.current) {
      autoGen.current = true;
      void regenScript();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const switchScriptType = (type: 'voiceover' | 'storyboard') => {
    if (type === scriptType) return;
    setScriptType(type);
    void regenScript(type);
  };


  const regenCovers = async () => {
    setCoverLoading(true);
    try {
      const { covers } = await studioApi.covers({ script, productInfo, language: lang, provider, tone }, [coverTitle]);
      if (covers[0]) setCoverTitle(covers[0]);
    } catch (err: any) {
      alert(err?.message || '封面标题生成失败，请稍后重试。');
    } finally {
      setCoverLoading(false);
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
  const startPreview = () => {
    if (rendering) return;
    if (previewable.length === 0) { setPreviewNote(true); return; }
    setPreviewNote(false);
    setPreviewIdx(0);
  };
  const stopPreview = () => setPreviewIdx(null);
  // 离开预览步时停止播放
  useEffect(() => {
    if (step !== 'preview') { setPreviewIdx(null); setPreviewNote(false); }
  }, [step]);

  // 导出 / 我的作品
  const downloadMp4 = () => {
    if (renderOutputPath) { window.open(`file://${renderOutputPath}`, '_blank'); return; }
    setPreviewNote(true); // 网页端无法直出 MP4，提示去桌面端合成
  };
  const saveToWorks = async () => {
    await saveProject('published'); // status=published → 进入「我的作品」
    setSavedToWorks(true);
    setTimeout(() => setSavedToWorks(false), 2200);
  };

  // 用剪映精修：桌面端把素材+字幕轨导出为剪映草稿并唤起 App；网页端给出提示
  const openInCapcut = async () => {
    const bridge = getDesktopRender();
    if (bridge?.openInCapcut) {
      const out = await bridge.openInCapcut({
        materials: selectedClips.map(c => ({ name: c.name, url: c.url, type: c.type, duration: c.duration, edit: editFor(c) })),
        cues: subMode === 'bilingual' ? cues.map((c, i) => ({ ...c, zh: cueZh[i] })) : cues,
        subMode,
        coverTitle,
        ratio,
        language: lang,
        script,
      });
      if (!out.ok) setPreviewNote(true);
    } else {
      setPreviewNote(true); // 网页端无法访问剪映本地草稿目录，需在桌面客户端操作
    }
  };

  const aiCaption = async () => {
    setCaptionLoading(true);
    try {
      const { caption: cap, hashtags } = await studioApi.caption(
        { script, productInfo, platform, language: lang, provider, audience, sellingPoints, tone },
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

  const demoAutoCreate = async () => {
    setDemoAutoLoading(true);
    try {
      if (selected.length === 0) setSelected(materials.slice(0, 3).map(m => m.id));
      const matNamesForDemo = selected.length > 0
        ? materials.filter(m => selected.includes(m.id)).map(m => m.name)
        : materials.slice(0, 3).map(m => m.name);
      const scriptResp = await studioApi.script(
        { materials: matNamesForDemo, productInfo, language: lang, platform, duration, scriptType, provider, audience, sellingPoints, tone },
        script,
      );
      setScript(scriptResp.script);
      const coversResp = await studioApi.covers({ script: scriptResp.script, productInfo, language: lang, provider, tone }, [coverTitle]);
      if (coversResp.covers[0]) setCoverTitle(coversResp.covers[0]);
      const cap = await studioApi.caption(
        { script: scriptResp.script, productInfo, platform, language: lang, provider, audience, sellingPoints, tone },
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
    for (const f of Array.from(files)) {
      try {
        const [dataBase64, duration] = await Promise.all([fileToDataUrl(f), probeDuration(f)]);
        const { material } = await studioApi.uploadMaterial({
          name: f.name, folder: 'upload', type: mediaType(f), duration, dataBase64, mimeType: f.type,
        });
        if (material?.id) uploadedIds.push(material.id);
      } catch { /* 单个失败不影响其它 */ }
    }
    await refreshMaterials();
    if (uploadedIds.length) {
      setSelected(s => [...s, ...uploadedIds]);  // 上传完自动选中
      setActiveFolder('upload');
    }
    setUploading(false);
  };

  /* ── BGM 曲库 ────────────────────────────────────────────────────────── */
  const refreshBgm = async () => {
    const list = await studioApi.listBgm();
    // 内置种子曲已弃用（质量不达标），只保留用户自行上传的音乐
    setBgms(list.filter(t => !t.builtin) as Bgm[]);
  };
  useEffect(() => { void refreshBgm(); }, []);

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
  const genTts = async () => {
    setTtsLoading(true);
    setVoiceoverUrl(null);
    try {
      const r = await studioApi.tts({ script, voice, language: lang });
      if (r.ok && r.url) { setVoiceoverUrl(r.url); setVoiceoverDur(r.duration ?? 0); }
    } catch (err: any) {
      alert(err?.message || '配音生成失败，请稍后重试。');
    } finally {
      setTtsLoading(false);
    }
  };
  const toggleTts = () => {
    const el = ttsAudioRef.current;
    if (!el || !voiceoverUrl) return;
    if (ttsPlaying) { el.pause(); setTtsPlaying(false); return; }
    el.src = voiceoverUrl;
    void el.play().then(() => setTtsPlaying(true)).catch(() => setTtsPlaying(false));
  };
  // 换音色 / 改脚本类型后，旧配音失效
  const pickVoice = (id: string) => { setVoice(id); setVoiceoverUrl(null); setTtsPlaying(false); };
  // 离开脚本步时停止试听
  useEffect(() => {
    if (step !== 'script' && ttsAudioRef.current) { ttsAudioRef.current.pause(); setTtsPlaying(false); }
  }, [step]);

  /* ── 草稿 / 作品 ─────────────────────────────────────────────────────── */
  const collectSpec = () => ({
    mode, platform, ratio, duration, lang, provider,
    productInfo, audience, sellingPoints, tone,
    selected, script, scriptType, voice,
    bgm, bgmVol, cover, coverTitle, coverStyle, account, caption,
    subtitlesOn, subMode, clipEdits,
  });

  const applySpec = (s: Record<string, unknown>) => {
    if (s.mode) setMode(s.mode as typeof mode);
    if (s.platform) setPlatform(s.platform as string);
    if (s.ratio) setRatio(s.ratio as string);
    if (typeof s.duration === 'number') setDuration(s.duration);
    if (s.lang) setLang(s.lang as string);
    if (s.provider === 'gemini' || s.provider === 'qwen') setProvider(s.provider);
    if (typeof s.productInfo === 'string') setProductInfo(s.productInfo);
    if (typeof s.audience === 'string') setAudience(s.audience);
    if (typeof s.sellingPoints === 'string') setSellingPoints(s.sellingPoints);
    if (typeof s.tone === 'string') setTone(s.tone);
    if (Array.isArray(s.selected)) setSelected(s.selected as string[]);
    if (typeof s.script === 'string') setScript(s.script);
    if (s.scriptType) setScriptType(s.scriptType as typeof scriptType);
    if (s.voice) setVoice(s.voice as string);
    if (s.bgm) setBgm(s.bgm as string);
    if (typeof s.bgmVol === 'number') setBgmVol(s.bgmVol);
    if (s.cover) setCover(s.cover as string);
    if (typeof s.coverTitle === 'string') setCoverTitle(s.coverTitle);
    if (s.coverStyle) setCoverStyle(s.coverStyle as CoverStyle);
    if (s.account !== undefined) setAccount(s.account as string | null);
    if (typeof s.caption === 'string') setCaption(s.caption);
    if (typeof s.subtitlesOn === 'boolean') setSubtitlesOn(s.subtitlesOn);
    if (s.subMode === 'target' || s.subMode === 'bilingual') setSubMode(s.subMode);
    if (s.clipEdits && typeof s.clipEdits === 'object') setClipEdits(s.clipEdits as Record<string, ClipEdit>);
  };

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

  const newProject = () => {
    setProjectId(null);
    setProjectTitle('未命名草稿');
    setStepIdx(0);
    setPublished(false);
    autoGen.current = false;
  };

  /* ── 渲染各步骤操作区 ─────────────────────────────────────────────── */
  const renderStep = () => {
    switch (step) {
      /* ① 选模式 */
      case 'mode':
        return (
          <div className="max-w-3xl">
            <SectionTitle title="选择生成模式" desc="不同起点决定 AI 如何编排素材" />
            <div className="grid grid-cols-3 gap-3 mb-7">
              {MODES.map(m => {
                const on = mode === m.id;
                return (
                  <button key={m.id} onClick={() => setMode(m.id)}
                    className="card p-4 text-left transition-all"
                    style={on ? { borderColor: AMBER, boxShadow: `0 0 0 1px ${AMBER}` } : undefined}>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
                      style={{ background: on ? AMBER : 'var(--color-surface-2)', color: on ? '#fff' : 'var(--color-text-muted)' }}>
                      <m.icon size={17} />
                    </div>
                    <p className="text-sm font-bold text-text-primary mb-1">{m.title}</p>
                    <p className="text-xs text-text-muted leading-relaxed">{m.desc}</p>
                  </button>
                );
              })}
            </div>

            <SectionTitle title="全局参数" desc="贯穿后续所有步骤" />
            <div className="space-y-4">
              <Field label="目标平台">
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map(p => (
                    <Pill key={p.id} active={platform === p.id}
                      onClick={() => { setPlatform(p.id); setRatio(p.ratio); }}>
                      {p.label}
                    </Pill>
                  ))}
                </div>
              </Field>
              <Field label="画面比例">
                <div className="flex gap-2">
                  {RATIOS.map(r => <Pill key={r} active={ratio === r} onClick={() => setRatio(r)}>{r}</Pill>)}
                </div>
              </Field>
              <Field label="目标市场语言">
                <div className="relative inline-block w-full max-w-xs">
                  <select value={lang} onChange={e => setLang(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-border bg-surface px-3 py-2 pr-9 text-sm font-medium text-text-primary outline-none cursor-pointer transition-colors hover:border-border-bright focus:border-amber">
                    {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                  <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
                </div>
              </Field>
              <Field label="生成模型">
                <div className="flex items-center gap-1.5 p-1 rounded-lg bg-surface-2 border border-border w-fit">
                  {([
                    ['gemini', 'Gemini'],
                    ['qwen', '千问'],
                  ] as const).map(([id, label]) => (
                    <button key={id} onClick={() => setProvider(id)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                        provider === id ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="商品与创意参数">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl">
                  <input value={productInfo} onChange={e => setProductInfo(e.target.value)}
                    placeholder="商品信息：品类、价格、核心用途"
                    className="px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary outline-none focus:border-accent" />
                  <input value={audience} onChange={e => setAudience(e.target.value)}
                    placeholder="目标人群：如美国宝妈 / 户外爱好者"
                    className="px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary outline-none focus:border-accent" />
                  <input value={sellingPoints} onChange={e => setSellingPoints(e.target.value)}
                    placeholder="卖点：3秒安装 / 防水 / 工厂价"
                    className="px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary outline-none focus:border-accent" />
                  <select value={tone} onChange={e => setTone(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary outline-none focus:border-accent">
                    {['高转化 · 口语化', '测评种草 · 可信', '痛点放大 · 直接', '生活方式 · 治愈', '工厂源头 · 专业'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </Field>
            </div>
          </div>
        );

      /* ② 选素材 —— 文件夹 + 网格 两栏 */
      case 'material': {
        const folderName = (id: string) => FOLDERS.find(f => f.id === id)?.name ?? '';
        // 按内容相关性搜索：匹配素材名 + 所属文件夹（分类）名
        const q = search.trim().toLowerCase();
        const matchSearch = (c: Clip) => q === '' || c.name.toLowerCase().includes(q) || folderName(c.folder).toLowerCase().includes(q);
        const visible = materials.filter(c => (activeFolder === 'all' || c.folder === activeFolder) && matchSearch(c));
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
                const count = f.id === 'all' ? materials.length : materials.filter(c => c.folder === f.id).length;
                return (
                  <button key={f.id} onClick={() => setActiveFolder(f.id)}
                    className={`w-full flex items-center gap-1.5 px-2 py-2 rounded-lg text-xs transition-colors ${
                      activeFolder === f.id ? 'bg-amber-dim text-amber font-semibold' : 'text-text-secondary hover:bg-surface-2'}`}>
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
                {activeFolder === 'hot' && <span className="text-[11px] text-text-muted">官方实时更新</span>}
                <input ref={fileInputRef} type="file" multiple accept="video/*,image/*,audio/*" className="hidden"
                  onChange={e => { void handleUpload(e.target.files); e.target.value = ''; }} />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="btn-ghost !px-3 !py-1.5 !text-xs flex items-center gap-1.5 disabled:opacity-60 ml-auto">
                  {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} {uploading ? '上传中…' : '上传'}
                </button>
                <span className="text-xs text-text-muted">已选 {selected.length}</span>
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {visible.map(c => {
                    const on = selected.includes(c.id);
                    const idx = selected.indexOf(c.id);
                    return (
                      <button key={c.id} onClick={() => setSelected(s => on ? s.filter(x => x !== c.id) : [...s, c.id])}
                        className="card !rounded-xl overflow-hidden text-left relative group"
                        style={on ? { borderColor: AMBER, boxShadow: `0 0 0 1px ${AMBER}` } : undefined}>
                        <div className="relative">
                          {/* 真实素材显示实际预览，mock 用渐变占位 */}
                          {c.url
                            ? <RealThumb clip={c} />
                            : <Thumb seed={c.id} src={c.poster} label={c.type === 'image' ? 'IMG' : `0:${String(c.duration).padStart(2, '0')}`} />}
                          {on && (
                            <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white z-10"
                              style={{ background: AMBER }}>{idx + 1}</span>
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
                          <p className="text-[10px] text-text-muted mt-0.5">{c.size}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {visible.length === 0 && (
                  <div className="text-center py-16">
                    <Upload size={26} className="mx-auto text-text-muted mb-3 opacity-30" />
                    <p className="text-sm text-text-muted">
                      {search.trim() ? '没有匹配的素材' : activeFolder === 'hot' ? '爆款素材库更新中，敬请期待' : '这个文件夹还没有素材'}
                    </p>
                    {activeFolder !== 'hot' && !search.trim() && (
                      <button onClick={() => fileInputRef.current?.click()} className="text-xs font-semibold mt-2" style={{ color: AMBER }}>点此上传</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      }

      /* ③ 口播脚本 */
      case 'script':
        return (
          <div className="max-w-3xl">
            <div className="flex items-center justify-between mb-4">
              <SectionTitle title={scriptType === 'storyboard' ? '分镜脚本' : '口播脚本'} desc={`AI 基于素材主题与企业知识库生成 · ${LANGS.find(l => l.code === lang)?.label}`} noMargin />
              <div className="flex items-center gap-2">
                {/* 口播 / 分镜 双模式 */}
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
                  {([
                    { type: 'voiceover' as const, icon: <FileText size={12} />, label: '口播' },
                    { type: 'storyboard' as const, icon: <List size={12} />, label: '分镜' },
                  ]).map(({ type, icon, label }) => (
                    <button key={type} onClick={() => switchScriptType(type)} disabled={scriptLoading}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all disabled:opacity-50 ${
                        scriptType === type ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                      {icon}<span>{label}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => regenScript()} disabled={scriptLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-50">
                  {scriptLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} 重新生成
                </button>
              </div>
            </div>

            <div className="relative mb-5">
              <textarea value={script} onChange={e => setScript(e.target.value)} rows={11}
                className="w-full p-4 rounded-xl border border-border bg-surface-2 text-sm text-text-secondary leading-relaxed font-mono outline-none focus:border-accent resize-none" />
              {scriptLoading && (
                <div className="absolute inset-0 rounded-xl bg-surface/70 backdrop-blur-sm flex items-center justify-center">
                  <span className="flex items-center gap-2 text-xs text-text-muted">
                    <Loader2 size={14} className="animate-spin" /> AI 正在改写脚本…
                  </span>
                </div>
              )}
            </div>

            <Field label="配音音色">
              <div className="grid grid-cols-2 gap-2 max-w-xl">
                {VOICES.map(v => (
                  <button key={v.id} onClick={() => pickVoice(v.id)}
                    className="card !rounded-xl p-3 flex items-center gap-2.5 text-left"
                    style={voice === v.id ? { borderColor: AMBER, boxShadow: `0 0 0 1px ${AMBER}` } : undefined}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: voice === v.id ? AMBER : 'var(--color-surface-2)', color: voice === v.id ? '#fff' : 'var(--color-text-muted)' }}>
                      {v.id === 'v4' ? <Upload size={14} /> : <Mic size={14} />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-text-primary truncate">{v.name}</p>
                      <p className="text-[10px] text-text-muted">{v.id === 'v4' ? v.tag : `${v.tag} · ${langZh(lang)}配音`}</p>
                    </div>
                  </button>
                ))}
              </div>

              {/* 生成 / 试听配音 */}
              <div className="flex items-center gap-3 mt-3 max-w-xl">
                {voice === 'v4' ? (
                  <span className="text-xs text-text-muted">真人口播：上传音频后直接使用，无需 AI 配音</span>
                ) : (
                  <>
                    <button onClick={() => void genTts()} disabled={ttsLoading}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-50"
                      style={{ background: AMBER }}>
                      {ttsLoading ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />}
                      {ttsLoading ? 'AI 配音生成中…' : voiceoverUrl ? '重新生成配音' : '生成 AI 配音'}
                    </button>
                    {voiceoverUrl && (
                      <button onClick={toggleTts}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border border-border hover:border-border-bright">
                        {ttsPlaying ? <Pause size={14} /> : <Play size={14} />} 试听 {fmtDur(voiceoverDur)}
                      </button>
                    )}
                    {voiceoverUrl && (
                      <span className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--color-accent)' }}>
                        <Check size={13} /> 已生成
                      </span>
                    )}
                  </>
                )}
              </div>
              <audio ref={ttsAudioRef} onEnded={() => setTtsPlaying(false)} className="hidden" />
            </Field>
          </div>
        );

      /* ④ 配乐 */
      case 'bgm':
        return (
          <div className="max-w-2xl">
            <div className="flex items-center justify-between mb-4">
              <SectionTitle title="背景配乐" desc="内置曲库已下线，请上传自有音乐（可不配乐）" noMargin />
              <input ref={bgmInputRef} type="file" accept="audio/*" className="hidden"
                onChange={e => { void handleBgmUpload(e.target.files); e.target.value = ''; }} />
              <button onClick={() => bgmInputRef.current?.click()} disabled={bgmUploading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-60">
                {bgmUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} 上传音乐
              </button>
            </div>
            {bgms.length === 0 && (
              <div className="card !rounded-xl border-dashed text-center py-10 mb-7">
                <Music size={24} className="mx-auto text-text-muted opacity-40 mb-2" />
                <p className="text-sm text-text-muted">暂无背景音乐</p>
                <button onClick={() => bgmInputRef.current?.click()} className="text-xs font-semibold mt-2" style={{ color: AMBER }}>上传一首</button>
              </div>
            )}
            <div className="space-y-2 mb-7">
              {bgms.map(b => {
                const on = bgm === b.id;
                const playing = playingBgm === b.id;
                return (
                  <button key={b.id} onClick={() => setBgm(b.id)}
                    className="card !rounded-xl w-full p-3 flex items-center gap-3 text-left"
                    style={on ? { borderColor: AMBER, boxShadow: `0 0 0 1px ${AMBER}` } : undefined}>
                    {/* 试听播放/暂停 */}
                    <span onClick={e => { e.stopPropagation(); togglePlay(b); }}
                      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
                      style={{ background: playing ? AMBER : on ? 'var(--color-amber-dim)' : 'var(--color-surface-2)', color: playing ? '#fff' : on ? AMBER : 'var(--color-text-muted)' }}>
                      {playing ? <Pause size={15} /> : <Play size={15} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-text-primary truncate">{b.name}</p>
                        {b.recommended && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: AMBER, color: '#fff' }}>AI 推荐</span>
                        )}
                        {playing && <span className="text-[10px] font-medium" style={{ color: AMBER }}>♪ 试听中</span>}
                      </div>
                      <p className="text-xs text-text-muted mt-0.5">{b.mood}</p>
                    </div>
                    <span className="text-xs font-mono text-text-muted">{fmtDur(b.duration)}</span>
                    {on ? <Check size={16} style={{ color: AMBER }} /> : <Volume2 size={15} className="text-text-muted opacity-0" />}
                  </button>
                );
              })}
            </div>
            <Field label={`音量平衡 · 背景乐 ${bgmVol}% / 口播 ${100 - bgmVol}%`}>
              <input type="range" min={0} max={70} value={bgmVol}
                onChange={e => setBgmVol(+e.target.value)} className="w-full max-w-md accent-[#d97706]" />
              <p className="text-[11px] text-text-muted mt-1.5">口播时自动压低背景乐（ducking）</p>
            </Field>
          </div>
        );

      /* ⑤ 封面 —— 用所选视频的真实帧画面，便于辨认内容 */
      case 'cover': {
        const renderCard = (key: string, frameUrl: string | undefined, label: string) => {
          const on = cover === key;
          return (
            <div key={key} role="button" tabIndex={0} onClick={() => setCover(key)}
              className="card !rounded-2xl overflow-hidden text-left cursor-pointer"
              style={on ? { borderColor: AMBER, boxShadow: `0 0 0 2px ${AMBER}` } : undefined}>
              <div className="relative aspect-[9/16]">
                {/* 选中的封面标题可直接在画面上点选编辑 */}
                <CoverFace frameUrl={frameUrl} title={coverTitle} style={coverStyle}
                  editable={on} onTitleChange={setCoverTitle} />
                <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-semibold text-white bg-black/45 max-w-[80%] truncate z-10">{label}</span>
                {on && (
                  <span className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-white z-10" style={{ background: AMBER }}>
                    <Check size={14} />
                  </span>
                )}
              </div>
            </div>
          );
        };
        const SEG = (active: boolean) => `px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${active ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`;
        const SWATCHES = ['#ffffff', '#111827', '#d97706', '#16a34a', '#ef4444', '#3b82f6'];
        return (
          <div className="max-w-3xl">
            <SectionTitle title="选择封面" desc="用所选视频的真实帧作封面，一眼辨认是哪条素材；也可用纯色底" />

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
                    style={{ background: c, borderColor: coverStyle.color === c ? AMBER : 'var(--color-border)', boxShadow: coverStyle.color === c ? `0 0 0 2px ${AMBER}` : undefined }} />
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
              {renderCard('gradient', undefined, '纯色底')}
              {frameCandidates.map(c => renderCard(c.id, c.poster ?? c.url, c.name))}
            </div>
            {frameCandidates.length === 0 && (
              <p className="text-xs text-text-muted mt-3">还没有可用帧画面——回到「选素材」选入视频或图片，这里就能用它们的画面当封面。</p>
            )}
          </div>
        );
      }

      /* ⑥ 成片预览 */
      case 'preview':
        return (
          <div className="flex items-start gap-8">
            {/* 播放器 */}
            <div className="flex-shrink-0">
              <div className="relative rounded-2xl overflow-hidden border border-border bg-black" style={{ width: 260 }}>
                <div className="relative aspect-[9/16]">
                  {previewIdx !== null && previewable[previewIdx] ? (
                    // 顺序播放选中的真实视频片段（网页端示意预览）
                    <video ref={previewVideoRef} src={previewable[previewIdx].url} autoPlay controls playsInline
                      className="absolute inset-0 w-full h-full object-cover bg-black"
                      onEnded={() => setPreviewIdx(i => (i !== null && i + 1 < previewable.length ? i + 1 : null))} />
                  ) : (
                    <CoverFace coverUrl={coverUrl} frameUrl={coverFrameUrl} title={coverTitle} style={coverStyle} />
                  )}
                </div>
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
                {/* 字幕叠层（沿用封面样式 · 底部居中；预览展示当前选中 cue） */}
                {subtitlesOn && !rendering && cues[subPreviewIdx] && (
                  <div className="absolute inset-x-0 bottom-8 px-4 z-10 text-center pointer-events-none"
                    style={{ fontFamily: subStyle.fontFamily ?? fontCss(subStyle.font) }}>
                    <p className="leading-snug" style={{ color: subStyle.color, fontWeight: WEIGHT_MAP[subStyle.weight ?? 'bold'], fontSize: 13, textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 1px rgba(0,0,0,0.9)' }}>
                      {cues[subPreviewIdx].text}
                    </p>
                    {subMode === 'bilingual' && lang !== 'zh' && cueZh[subPreviewIdx] && (
                      <p className="leading-snug mt-0.5" style={{ color: '#fff', fontWeight: 600, fontSize: 11, textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
                        {cueZh[subPreviewIdx]}
                      </p>
                    )}
                  </div>
                )}
                <div className="absolute top-2 left-2 z-10 rounded-md bg-black/55 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white pointer-events-none">
                  Demo Preview
                </div>
                {previewIdx !== null && (
                  <button onClick={stopPreview} className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-black/55 flex items-center justify-center text-white">
                    <X size={14} />
                  </button>
                )}
                {previewIdx === null && !rendering && (
                  <div className="absolute bottom-0 inset-x-0 px-3 py-2 flex items-center justify-between bg-black/40">
                    <span className="text-[10px] font-mono text-white">0:00 / 0:{totalDur}</span>
                    <span className="text-[10px] font-mono text-white">{ratio}</span>
                  </div>
                )}
              </div>
              {/* 无真实可播放素材时的说明 */}
              {previewNote && (
                <p className="text-[11px] text-text-muted mt-2 w-[260px] leading-relaxed">
                  该片段暂无可播放源文件，请上传真实视频素材，或在桌面客户端合成后下载完整成片。
                </p>
              )}
            </div>

            {/* 时间轴 + 局部重渲染 */}
            <div className="flex-1 min-w-0">
              <SectionTitle title="成片预览" desc={rendering ? '正在合成口播、配乐与字幕…' : '可对单个环节微调后局部重渲染'} />
              <div className="space-y-2 mb-6">
                {[
                  { icon: Film,     label: '素材片段', val: `${selectedClips.length} 段 · ${totalDur}s` },
                  { icon: Mic,      label: '口播配音', val: VOICES.find(v => v.id === voice)?.name ?? '' },
                  { icon: Music,    label: '背景配乐', val: bgms.find(b => b.id === bgm)?.name ?? '' },
                  { icon: ImageIcon,label: '封面',     val: cover === 'gradient' ? `纯色 · ${coverTitle}` : `素材帧 · ${coverTitle}` },
                ].map(row => (
                  <div key={row.label} className="card !rounded-xl p-3 flex items-center gap-3">
                    <row.icon size={15} className="text-text-muted flex-shrink-0" />
                    <span className="text-xs font-semibold text-text-secondary w-16 flex-shrink-0">{row.label}</span>
                    <span className="text-xs text-text-primary flex-1 truncate">{row.val}</span>
                    <button className="text-[11px] font-semibold px-2 py-1 rounded-md hover:bg-surface-2" style={{ color: AMBER }}>
                      调整
                    </button>
                  </div>
                ))}
              </div>
              <div className="card !rounded-xl p-3.5 mb-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <Film size={15} className="text-text-muted" />
                  <span className="text-xs font-semibold text-text-secondary">剪辑细化</span>
                  <span className="text-[10px] text-text-muted">导出剪映时同步为时间线参考</span>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {selectedClips.map((clip, i) => {
                    const edit = editFor(clip);
                    return (
                      <div key={clip.id} className="rounded-lg border border-border bg-surface-2 px-2.5 py-2">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ background: AMBER }}>{i + 1}</span>
                          <span className="text-xs font-semibold text-text-primary truncate">{clip.name}</span>
                          <span className="ml-auto text-[10px] text-text-muted">{clip.type === 'image' ? '图片' : `${clip.duration}s`}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mb-2">
                          <label className="text-[10px] text-text-muted">
                            入点
                            <input type="number" min={0} step={0.5} value={edit.trimStart}
                              onChange={e => patchClipEdit(clip, { trimStart: Number(e.target.value) })}
                              className="mt-1 w-full px-2 py-1 rounded-md border border-border bg-surface text-xs text-text-primary outline-none focus:border-accent" />
                          </label>
                          <label className="text-[10px] text-text-muted">
                            出点
                            <input type="number" min={0.5} step={0.5} value={edit.trimEnd}
                              onChange={e => patchClipEdit(clip, { trimEnd: Number(e.target.value) })}
                              className="mt-1 w-full px-2 py-1 rounded-md border border-border bg-surface text-xs text-text-primary outline-none focus:border-accent" />
                          </label>
                          <label className="text-[10px] text-text-muted">
                            速度
                            <select value={edit.speed} onChange={e => patchClipEdit(clip, { speed: Number(e.target.value) })}
                              className="mt-1 w-full px-2 py-1 rounded-md border border-border bg-surface text-xs text-text-primary outline-none focus:border-accent">
                              {[0.5, 0.75, 1, 1.25, 1.5, 2].map(v => <option key={v} value={v}>{v}x</option>)}
                            </select>
                          </label>
                        </div>
                        <div className="grid grid-cols-[86px_1fr] gap-2">
                          <select value={edit.transition} onChange={e => patchClipEdit(clip, { transition: e.target.value })}
                            className="px-2 py-1 rounded-md border border-border bg-surface text-xs text-text-primary outline-none focus:border-accent">
                            {['硬切', '淡入淡出', '推近', '闪白', '卡点'].map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <input value={edit.note} onChange={e => patchClipEdit(clip, { note: e.target.value })}
                            placeholder="给剪映手动精修的备注，如：这里加产品卖点字幕"
                            className="px-2 py-1 rounded-md border border-border bg-surface text-xs text-text-primary outline-none focus:border-accent" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* 字幕：按口播内容自动生成（沿用封面样式），可开关 / 切双语 / 逐句核对 */}
              <div className="card !rounded-xl p-3.5 mb-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <FileText size={15} className="text-text-muted" />
                  <span className="text-xs font-semibold text-text-secondary">字幕</span>
                  <span className="text-[10px] text-text-muted">按口播内容自动生成</span>
                  <div className="ml-auto flex items-center gap-2">
                    {subtitlesOn && (
                      <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
                        {([['target', '目标语言'], ['bilingual', '双语']] as const).map(([m, l]) => (
                          <button key={m} onClick={() => setSubMode(m)}
                            className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-all ${subMode === m ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>{l}</button>
                        ))}
                      </div>
                    )}
                    {/* 开关 */}
                    <button onClick={() => setSubtitlesOn(v => !v)} role="switch" aria-checked={subtitlesOn}
                      className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
                      style={{ background: subtitlesOn ? AMBER : 'var(--color-surface-2)' }}>
                      <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform" style={{ transform: subtitlesOn ? 'translateX(16px)' : 'none' }} />
                    </button>
                  </div>
                </div>
                {subtitlesOn ? (
                  cues.length > 0 ? (
                    <div className="max-h-44 overflow-y-auto -mx-1 px-1 space-y-1">
                      {cues.map((c, i) => (
                        <button key={i} onClick={() => setSubPreviewIdx(i)}
                          className={`w-full text-left flex gap-2 px-2 py-1.5 rounded-lg transition-colors ${i === subPreviewIdx ? 'bg-amber-dim' : 'hover:bg-surface-2'}`}>
                          <span className="text-[10px] font-mono text-text-muted pt-0.5 flex-shrink-0 w-14">{fmtTime(c.start)}-{fmtTime(c.end)}</span>
                          <span className="min-w-0">
                            <span className="block text-xs text-text-primary leading-snug">{c.text}</span>
                            {subMode === 'bilingual' && lang !== 'zh' && (
                              <span className="block text-[10px] text-text-muted leading-snug mt-0.5">{cueZh[i] ?? '翻译中…'}</span>
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-text-muted px-1">还没有口播脚本，回到「口播脚本」生成后这里会自动出字幕。</p>
                  )
                ) : (
                  <p className="text-[11px] text-text-muted px-1">字幕已关闭，成片将不烧录字幕。</p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button onClick={() => void goPreview()} disabled={rendering}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-50">
                  <RefreshCw size={12} className={rendering ? 'animate-spin' : ''} /> 重新合成成片
                </button>
                {/* 字幕/卡点精修交给本地剪映 */}
                <button onClick={() => void openInCapcut()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-border hover:border-border-bright">
                  <Wand2 size={12} /> 用剪映精修
                </button>
              </div>
            </div>
          </div>
        );

      /* ⑦ 导出 / 一键发布 */
      case 'publish':
        return (
          <div className="max-w-3xl">
            {published ? (
              <div className="card !rounded-2xl p-10 text-center max-w-md mx-auto">
                <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: 'var(--color-accent-glow)', color: 'var(--color-accent)' }}>
                  <Check size={28} />
                </div>
                <p className="text-base font-bold text-text-primary mb-1">已提交发布</p>
                <p className="text-sm text-text-muted">成片已推送至 {ACCOUNTS.find(a => a.id === account)?.platform} · {ACCOUNTS.find(a => a.id === account)?.handle}</p>
                <button onClick={() => setPublished(false)} className="btn-ghost mt-6 !py-2 !text-xs">再发一条</button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-5">
                {/* 导出 */}
                <div className="card !rounded-2xl p-5">
                  <Download size={18} className="text-text-secondary mb-3" />
                  <p className="text-sm font-bold text-text-primary mb-1">导出成片</p>
                  <p className="text-xs text-text-muted mb-4 leading-relaxed">下载到本地或保存至「我的作品」素材库</p>
                  <div className="space-y-2">
                    <button onClick={downloadMp4} className="btn-primary w-full !py-2.5 flex items-center justify-center gap-2">
                      <Download size={14} /> 下载 MP4（{ratio} · {totalDur}s）
                    </button>
                    <button onClick={() => void saveToWorks()} disabled={savingProj}
                      className="btn-ghost w-full !py-2.5 flex items-center justify-center gap-2 disabled:opacity-60">
                      {savingProj ? <Loader2 size={14} className="animate-spin" /> : savedToWorks ? <Check size={14} className="text-accent" /> : <Plus size={14} />}
                      {savedToWorks ? '已存入「我的作品」' : '存入「我的作品」'}
                    </button>
                  </div>
                </div>

                {/* 一键发布 */}
                <div className="card !rounded-2xl p-5">
                  <Send size={18} style={{ color: AMBER }} className="mb-3" />
                  <p className="text-sm font-bold text-text-primary mb-1">一键发布</p>
                  <p className="text-xs text-text-muted mb-3 leading-relaxed">选择已绑定的社媒账号，支持多平台同步</p>

                  <div className="space-y-1.5 mb-3">
                    {ACCOUNTS.map(a => (
                      <button key={a.id} onClick={() => setAccount(a.id)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors"
                        style={account === a.id ? { borderColor: AMBER, background: 'var(--color-amber-dim)' } : { borderColor: 'var(--color-border)' }}>
                        <span className="w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0" style={{ background: a.color }}>
                          {a.platform[0]}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-text-primary leading-tight">{a.platform}</p>
                          <p className="text-[10px] text-text-muted truncate">{a.handle}</p>
                        </div>
                        {account === a.id && <Check size={14} style={{ color: AMBER }} />}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold text-text-secondary">文案与话题标签</span>
                    <button onClick={aiCaption} disabled={captionLoading}
                      className="flex items-center gap-1 text-[11px] font-semibold disabled:opacity-60" style={{ color: AMBER }}>
                      {captionLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} AI 生成
                    </button>
                  </div>
                  <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3}
                    placeholder="文案与话题标签…"
                    className="w-full p-2.5 rounded-lg border border-border bg-surface-2 text-xs text-text-secondary outline-none focus:border-accent resize-none mb-2" />

                  <div className="flex items-center gap-2 mb-3 text-[11px] text-text-muted">
                    <Clock size={12} /> 立即发布
                    <button onClick={() => { void saveProject('draft'); onNavigate?.('scheduled'); }}
                      className="ml-auto font-semibold hover:text-text-primary">定时…</button>
                  </div>

                  <button onClick={() => { setPublished(true); void saveProject('published'); }} disabled={!account}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                    style={{ background: AMBER }}>
                    <Send size={14} /> 发布到 {ACCOUNTS.find(a => a.id === account)?.platform ?? '…'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
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
          <button onClick={() => void demoAutoCreate()} disabled={demoAutoLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-50"
            style={{ background: '#16a34a' }}>
            {demoAutoLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            Demo 自动生成
          </button>
          <button onClick={newProject}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-text-secondary hover:bg-surface-2 transition-colors">
            <Plus size={13} /> 新建
          </button>
          <button onClick={() => void saveProject('draft')} disabled={savingProj}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-50 transition-colors">
            {savingProj ? <Loader2 size={13} className="animate-spin" /> : savedTick ? <Check size={13} className="text-accent" /> : <Save size={13} />}
            {savedTick ? '已保存' : '保存草稿'}
          </button>
          <button onClick={() => void openProjects()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all active:scale-95"
            style={{ background: AMBER }}>
            <FolderOpen size={13} /> 我的作品
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
      {/* ── ① 步骤导航 ─────────────────────────────── */}
      <aside className="w-32 flex-shrink-0 border-r border-border flex flex-col bg-surface-2/40">
        <div className="px-3 pt-4 pb-3">
          <p className="text-[9px] font-mono text-text-muted uppercase tracking-wider mb-1">AI 生成</p>
          <p className="text-xs font-bold text-text-primary font-display">混剪工作台</p>
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
                    active ? { background: AMBER, color: '#fff' }
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
                style={{ width: i === stepIdx ? 18 : 6, background: i <= stepIdx ? AMBER : 'var(--color-border)' }} />
            ))}
          </div>
          {!isLast ? (
            <button onClick={next} disabled={!canNext}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-40"
              style={{ background: AMBER }}>
              下一步 <ChevronRight size={15} />
            </button>
          ) : (
            <span className="w-[88px]" />
          )}
        </div>
      </div>

      {/* ── ③ 实时预览 / 制作摘要（选模式步骤不展示） ───────────────────── */}
      {step !== 'mode' && (
      <aside className="w-72 flex-shrink-0 border-l border-border flex flex-col bg-surface-2/40">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Smartphone size={13} className="text-text-muted" />
          <span className="text-xs font-semibold text-text-secondary">实时预览</span>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          {/* 手机框预览 */}
          <div className="mx-auto rounded-2xl overflow-hidden border-2 border-border-bright shadow-sm" style={{ width: 150 }}>
            <div className="relative aspect-[9/16]">
              <CoverFace coverUrl={coverUrl} frameUrl={coverFrameUrl} title={coverTitle} style={coverStyle} />
              <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold text-white bg-black/45">
                {ratio}
              </span>
            </div>
          </div>

          {/* 制作摘要 */}
          <div className="mt-5 space-y-2.5">
            <SummaryRow icon={LayoutGrid} label="模式" value={MODES.find(m => m.id === mode)?.title ?? ''} />
            <SummaryRow icon={Globe} label="平台" value={`${PLATFORMS.find(p => p.id === platform)?.label} · ${ratio}`} />
            <SummaryRow icon={Clock} label="时长" value={`${totalDur || duration}s`} />
            <SummaryRow icon={Film} label="素材" value={`${selected.length} 段`} />
            <SummaryRow icon={Mic} label="配音" value={VOICES.find(v => v.id === voice)?.name.split('（')[0] ?? ''} />
            <SummaryRow icon={Music} label="配乐" value={bgms.find(b => b.id === bgm)?.name ?? ''} />
            <SummaryRow icon={Globe} label="语言" value={LANGS.find(l => l.code === lang)?.label ?? ''} />
          </div>

          {rendered && (
            <div className="mt-4 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg"
              style={{ background: 'var(--color-accent-glow)', color: 'var(--color-accent)' }}>
              <Check size={12} /> 成片已就绪，可导出或发布
            </div>
          )}
        </div>
      </aside>
      )}
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
              style={p.id === currentId ? { borderColor: AMBER, boxShadow: `0 0 0 1px ${AMBER}` } : undefined}
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
            <FolderOpen size={15} style={{ color: AMBER }} />
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
        ? { background: AMBER, color: '#fff', borderColor: AMBER }
        : { background: 'var(--color-surface)', color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }}>
      {children}
    </button>
  );
}

function SummaryRow({ icon: Icon, label, value }: { icon: typeof LayoutGrid; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon size={13} className="text-text-muted flex-shrink-0" />
      <span className="text-[11px] text-text-muted w-8 flex-shrink-0">{label}</span>
      <span className="text-[11px] font-medium text-text-primary flex-1 truncate text-right">{value}</span>
    </div>
  );
}
