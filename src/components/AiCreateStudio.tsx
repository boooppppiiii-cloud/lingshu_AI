import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutGrid, Film, FileText, Music, Image as ImageIcon, Play, Send,
  Check, ChevronLeft, ChevronRight, Folder, Search, Volume2, Globe,
  Mic, Download, Loader2, Sparkles, Wand2, Copy, RefreshCw, Clock,
  Upload, X, Plus, List, Save, FolderOpen, Trash2, Pause, ChevronDown, Heart, ExternalLink,
} from 'lucide-react';
import { studioApi, getDesktopRender, type StudioProject, type Material, type BgmTrack, type CoverStyle, type SubCue } from '../lib/studioApi';
import type { Page } from '../App';
import { completeDemoStep } from '../lib/demoProgress';

/* ──────────────────────────────────────────────────────────────────────────
   AI 生成内容工作台 — 社媒（流量）页子模块
   流程：选模式 → 口播脚本 → 选素材 → 配乐 → 封面 → 成片预览
   两栏布局：① 步骤导航  ② 操作区
─────────────────────────────────────────────────────────────────────────── */

const TRAFFIC_GREEN = '#16a34a';
const CANVA_VIDEO_COVER_URL = 'https://www.canva.cn/create/video-covers/';

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
    details?: { time: string; shot: string; camera: string; visual: string; subtitle?: string; audio?: string; note?: string }[];
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
const uniqueLangs = (primary: string, count: number) => {
  const base = [primary, 'en', 'es', 'ar', 'pt', 'id', 'fr', 'de'].filter(Boolean);
  return Array.from(new Set(base)).slice(0, Math.max(1, count));
};

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
  const first = compact(lines[0]?.replace(/^[^：:]+[：:]\s*/, ''));
  return {
    name: pick('产品名称') || pick('主推品') || first || '主推产品',
    category: pick('所属类目') || pick('产品类目') || '待补充类目',
    highlights: pick('产品卖点') || pick('核心优势') || '待补充真实卖点',
    price: pick('价格区间'),
    moq: pick('起订量'),
    certifications: pick('认证资质'),
  };
}

function zhVoiceLineForShot(index: number, product: ReturnType<typeof parseProductBrief>, visual: string) {
  const proofParts = [product.moq ? `起订量 ${product.moq}` : '', product.certifications ? `认证 ${product.certifications}` : '', product.price ? `价格区间 ${product.price}` : ''].filter(Boolean);
  const proof = proofParts.length ? proofParts.join('，') : '样品、尺寸、颜色和包装细节';
  const lines = [
    `这款${product.name}适合${product.category}采购，先看实物细节和使用场景。`,
    `${product.highlights}，画面里要直接展示材质、容量、承重或工艺细节。`,
    `客户下单前最关心${proof}，这几个信息要放进字幕里。`,
    `如果你要做同类采购，可以留言要样品、报价和包装方案。`,
  ];
  const visualHint = compact(visual).slice(0, 28);
  return visualHint && index === 0 ? `${lines[0]}参考镜头节奏：${visualHint}。` : lines[index % lines.length]!;
}

function enVoiceLineForShot(index: number, product: ReturnType<typeof parseProductBrief>, visual: string) {
  const proofParts = [product.moq ? `MOQ ${product.moq}` : '', product.certifications ? `certifications ${product.certifications}` : '', product.price ? `price range ${product.price}` : ''].filter(Boolean);
  const proof = proofParts.length ? proofParts.join(', ') : 'sample, size, color, and packaging details';
  const lines = [
    `This ${product.name} is for ${product.category} sourcing. Start with the real product detail and use case.`,
    `${product.highlights}. Show the material, capacity, load-bearing point, or workmanship clearly on screen.`,
    `Before ordering, buyers need ${proof}. Put those facts in the caption.`,
    `Message us for samples, a quote, and packaging options for this ${product.name}.`,
  ];
  const visualHint = compact(visual).slice(0, 36);
  return visualHint && index === 0 ? `${lines[0]} Follow the reference rhythm: ${visualHint}.` : lines[index % lines.length]!;
}

function buildReferenceScript(kickoff: VideoKickoff, productInfo: string, languageCode: string, variantIndex: number, mode: 'ideas' | 'languages') {
  const ref = kickoff.referenceAnalysis;
  const details = ref?.details?.length ? ref.details : [
    { time: '0s-3s', shot: '开场钩子', camera: '近景', visual: '快速展示产品使用痛点', subtitle: '先抓住用户注意力' },
    { time: '3s-8s', shot: '产品展示', camera: '中近景', visual: '展示产品外观、细节和使用场景', subtitle: '突出核心卖点' },
    { time: '8s-15s', shot: '信任证明', camera: '特写', visual: '展示包装、资质、样品或客户反馈', subtitle: '引导询盘' },
  ];
  const langLabel = LANGS.find(l => l.code === languageCode)?.label || languageCode;
  const product = parseProductBrief(productInfo);
  const ideaName = mode === 'ideas' ? `创意 ${variantIndex + 1}` : langLabel;
  const hook = variantIndex % 3 === 0 ? '实物细节开场' : variantIndex % 3 === 1 ? '采购顾虑开场' : '场景结果开场';
  const zh = languageCode === 'zh';
  const header = zh
    ? `对标脚本｜${ideaName}｜${hook}\n产品替换：${product.name}\n所属类目：${product.category}\n产品卖点：${product.highlights}\n参考爆款：${kickoff.video?.title || ref?.title || '已选爆款视频'}`
    : `Reference Script | ${ideaName} | ${hook}\nProduct replacement: ${product.name}\nCategory: ${product.category}\nProduct facts: ${product.highlights}\nReference video: ${kickoff.video?.title || ref?.title || 'selected viral video'}\nOutput language: ${langLabel}`;
  const body = details.map((item, index) => {
    const line = zh
      ? `人物说：“${zhVoiceLineForShot(index, product, item.visual)}”`
      : `Voiceover: "${enVoiceLineForShot(index, product, item.visual)}"`;
    return zh
      ? `[${item.time}] ${item.shot}；${item.camera}；参考节奏：${item.visual}；我方画面：展示「${product.name}」的真实细节、使用场景和${product.highlights}；${line}`
      : `[${item.time}] ${item.shot}; ${item.camera}; reference rhythm: ${item.visual}; our visual: show real details, use case, and ${product.highlights} for ${product.name}; ${line}`;
  }).join('\n\n');
  return `${header}\n\n${body}`;
}

function localizeVoiceoverFallback(base: string, target: string): string {
  const lines = base
    .split(/[\n。；]+/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 8);
  const sourceLines = lines.length ? lines : ['这款产品值得马上询盘。'];
  if (target === 'zh') return sourceLines.join('\n');

  const product = inferProductName(sourceLines.join(' '), target);
  return sourceLines.map((line, index) => translateVoiceoverLineFallback(line, target, product, index)).join('\n');
}

function inferProductName(text: string, target: string): string {
  const match = text.match(/(?:又便宜又好用的|客户一直在问的|这款|这个|主推)([^，。；\n]{2,24}?(?:机|器|仪|设备|套装|产品|工具|配件|用品|面霜|精华|家具))/);
  const raw = match?.[1] || '';
  const known: Record<string, Record<string, string>> = {
    家用蛋糕机: {
      en: 'home cake maker',
      es: 'máquina doméstica para hacer pasteles',
      ar: 'آلة صنع الكعك المنزلية',
      pt: 'máquina doméstica de bolo',
      id: 'mesin pembuat kue rumahan',
    },
    蛋糕机: {
      en: 'cake maker',
      es: 'máquina para hacer pasteles',
      ar: 'آلة صنع الكعك',
      pt: 'máquina de bolo',
      id: 'mesin pembuat kue',
    },
  };
  const key = Object.keys(known).find(item => raw.includes(item) || text.includes(item));
  return key ? (known[key][target] || known[key].en) : ({
    en: 'this product',
    es: 'este producto',
    ar: 'هذا المنتج',
    pt: 'este produto',
    id: 'produk ini',
  }[target] || 'this product');
}

function translateVoiceoverLineFallback(line: string, target: string, product: string, index: number): string {
  const shotNo = line.match(/第\s*(\d+)\s*个镜头/)?.[1];
  const templates: Record<string, string[]> = {
    en: [
      `Don't scroll away. This is the affordable, easy-to-use ${product} that customers keep asking about.`,
      'Factory-direct supply, stable quality, fast sampling, and cross-border shipping are all supported.',
      'Whether you need private-label packaging or small-batch market testing, you can get started quickly.',
      'For samples, pricing, or a custom solution, leave a message with your target market.',
    ],
    es: [
      `No sigas deslizando. Este es ${product} económico y fácil de usar que los clientes no dejan de preguntar.`,
      'Suministro directo de fábrica, calidad estable, muestreo rápido y envíos internacionales.',
      'Ya sea que necesites empaque de marca privada o pruebas en lotes pequeños, puedes empezar rápidamente.',
      'Para muestras, precios o una solución personalizada, déjanos tu mercado objetivo en un mensaje.',
    ],
    ar: [
      `لا تتجاوز الفيديو. هذا هو ${product} العملي والمناسب في السعر الذي يسأل عنه العملاء باستمرار.`,
      'توريد مباشر من المصنع، جودة مستقرة، عينات سريعة، وشحن دولي متاح.',
      'سواء كنت تحتاج إلى تغليف بعلامتك الخاصة أو اختبار دفعات صغيرة، يمكنك البدء بسرعة.',
      'للحصول على عينات أو أسعار أو حل مخصص، اترك لنا رسالة مع السوق المستهدف.',
    ],
    pt: [
      `Nao pule este video. Este e ${product} acessivel e facil de usar que os clientes vivem perguntando.`,
      'Fornecimento direto da fabrica, qualidade estavel, amostras rapidas e envio internacional.',
      'Se voce precisa de embalagem private label ou teste em pequenos lotes, pode comecar rapidamente.',
      'Para amostras, precos ou uma solucao personalizada, envie uma mensagem com seu mercado-alvo.',
    ],
    id: [
      `Jangan lewatkan. Ini ${product} yang terjangkau dan mudah dipakai, yang sering ditanyakan pelanggan.`,
      'Pasokan langsung dari pabrik, kualitas stabil, sampel cepat, dan pengiriman lintas negara tersedia.',
      'Baik untuk kemasan private label maupun uji pasar dalam batch kecil, Anda bisa mulai dengan cepat.',
      'Untuk sampel, harga, atau solusi khusus, tinggalkan pesan dengan target pasar Anda.',
    ],
  };
  if (shotNo) {
    const shotTemplates: Record<string, string> = {
      en: `This is not an ordinary product. Shot ${shotNo} shows exactly why it is worth an inquiry.`,
      es: `Este no es un producto cualquiera. La toma ${shotNo} muestra exactamente por qué vale la pena consultarlo.`,
      ar: `هذا ليس منتجا عاديا. اللقطة ${shotNo} توضح بالضبط لماذا يستحق الاستفسار عنه.`,
      pt: `Este nao e um produto comum. A cena ${shotNo} mostra exatamente por que vale a pena pedir detalhes.`,
      id: `Ini bukan produk biasa. Adegan ${shotNo} menunjukkan kenapa produk ini layak ditanyakan.`,
    };
    return shotTemplates[target] || shotTemplates.en;
  }
  const normalized = line.replace(/^\s*\[[^\]]+\]\s*/g, '');
  const list = templates[target] || templates.en;
  if (/先别划走|别划走|客户.*问|又便宜又好用/.test(normalized)) return list[0];
  if (/工厂直供|品质稳定|快速打样|跨境发货/.test(normalized)) return list[1];
  if (/私标|小批量|测款|快速开始/.test(normalized)) return list[2];
  if (/样品|报价|定制方案|留言|目标市场/.test(normalized)) return list[3];
  return list[Math.min(index, list.length - 1)];
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
        : <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg,#bbf7d0,#16a34a)' }} />}
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

  const [materials, setMaterials] = useState<Clip[]>([]);
  const [uploading, setUploading] = useState(false);
  const [digitalHumanLoading, setDigitalHumanLoading] = useState(false);
  const [digitalHumanNotice, setDigitalHumanNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [script, setScript] = useState(SAMPLE_SCRIPT);
  const [scriptType, setScriptType] = useState<'voiceover' | 'storyboard'>('voiceover');
  const [voice, setVoice] = useState('v1');
  const [scriptLoading, setScriptLoading] = useState(false);
  const [voiceoverLines, setVoiceoverLines] = useState('');
  const [voiceLangs, setVoiceLangs] = useState<string[]>(['zh', 'en', 'es']);
  const [activeVoiceLang, setActiveVoiceLang] = useState('zh');
  const [voiceDrafts, setVoiceDrafts] = useState<Record<string, string>>({});
  const [voiceDraftLoading, setVoiceDraftLoading] = useState(false);
  const [voicePreviewIdx, setVoicePreviewIdx] = useState<number | null>(null);
  const [scriptView, setScriptView] = useState<'timestamp' | 'voiceover'>('timestamp');
  const autoGen = useRef(false); // 标记是否已由入口生成脚本，避免覆盖用户编辑

  // 配音 TTS
  const [voiceoverUrl, setVoiceoverUrl] = useState<string | null>(null);
  const [voiceoverDur, setVoiceoverDur] = useState(0);
  const [voiceoverAudios, setVoiceoverAudios] = useState<Record<string, { url: string; duration: number }>>({});
  const [voiceoverMode, setVoiceoverMode] = useState<'none' | 'ai' | 'upload'>('ai');
  const [uploadedVoiceName, setUploadedVoiceName] = useState('');
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceoverInputRef = useRef<HTMLInputElement>(null);

  const [bgm, setBgm] = useState('');   // 无内置曲库，默认不选
  const [bgmVol, setBgmVol] = useState(35);
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

  const [cover, setCover] = useState('gradient'); // 'gradient' 或某素材 id（用其帧画面作封面底图）
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
  const renderToken = useRef(0); // 取消过期的渲染循环（重复点「重新合成」时）

  const [account, setAccount] = useState<string | null>('a1');
  const [caption, setCaption] = useState('Factory-direct home essentials 🏠✨ #tiktokmademebuyit #homefinds');
  const [captionLoading, setCaptionLoading] = useState(false);
  const [published, setPublished] = useState(false);
  const [demoAutoLoading, setDemoAutoLoading] = useState(false);
  const [savedToWorks, setSavedToWorks] = useState(false); // 「存入我的作品」反馈
  const [modeActionLoading, setModeActionLoading] = useState(false);
  const [modeNotice, setModeNotice] = useState('');
  const [modeScripts, setModeScripts] = useState<ModeScriptOutput[]>([]);

  useEffect(() => {
    let alive = true;
    fetch('/api/overseas/enterprise/profile')
      .then(r => r.json())
      .then((profile: EnterpriseProfileLite) => {
        if (!alive) return;
        const options = buildAiProductOptions(profile);
        setProductOptions(options);
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
    setProductInfo(selectedOptions.map(option => option.info).filter(Boolean).join('\n\n'));
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
  const [videoKickoff, setVideoKickoff] = useState<VideoKickoff | null>(null);

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
  const activeSpokenScript = voiceDrafts[activeVoiceLang] || voiceoverLines || script;
  // 字幕 cue：当前语种口播台词 + TTS 时长（无配音则用素材总时长）
  const cues = useMemo(() => buildCues(activeSpokenScript, voiceoverDur || totalDur), [activeSpokenScript, voiceoverDur, totalDur]);
  // 字幕样式沿用封面体系，但默认底部居中 + 适配字号
  const subStyle: CoverStyle = useMemo(() => ({ ...coverStyle, position: 'bottom', align: 'center', size: coverStyle.size === 'L' ? 'M' : 'S' }), [coverStyle]);

  const canNext = step === 'material' ? selected.length > 0 : true;
  const isLast = stepIdx === STEPS.length - 1;
  const toggleProductSelection = (id: string) => {
    setSelectedProductIds(current => {
      if (productSelectMode === 'single') return [id];
      const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
      return next.length ? next : [id];
    });
  };
  const cloneScripts = useMemo(() => {
    if (mode !== 'clone' || !videoKickoff?.referenceAnalysis) return [];
    const langs = cloneOutputMode === 'languages'
      ? uniqueLangs(lang, cloneCount)
      : Array.from({ length: cloneCount }, () => lang);
    return langs.map((code, index) => ({
      id: `${code}-${index}`,
      title: cloneOutputMode === 'languages'
        ? (LANGS.find(l => l.code === code)?.label || code)
        : `脚本创意 ${index + 1}`,
      script: buildReferenceScript(videoKickoff, productInfo, code, index, cloneOutputMode),
    }));
  }, [cloneCount, cloneOutputMode, lang, mode, productInfo, videoKickoff]);

  useEffect(() => {
    if (cloneScripts[0]?.script) setScript(cloneScripts[0].script);
  }, [cloneScripts]);

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
      if (kickoff.script) setScript(kickoff.script);
      if (kickoff.scriptType === 'voiceover' || kickoff.scriptType === 'storyboard') setScriptType(kickoff.scriptType);
      if (kickoff.language) setLang(kickoff.language);
      if (kickoff.productInfo) setProductInfo(kickoff.productInfo);
      if (kickoff.video?.platform) setPlatform(kickoff.video.platform);
      setProvider('gemini');
      setMode(kickoff.source === 'inspiration_analysis' ? 'clone' : 'material');
      setActiveFolder(kickoff.generatedVideo ? 'upload' : 'hot');
      setProjectTitle(kickoff.video?.title ? `爆款克隆 · ${kickoff.video.title}` : kickoff.generatedVideo?.title || 'AI素材快剪');
      setStepIdx(STEPS.findIndex(s => s.id === (kickoff.source === 'inspiration_analysis' ? 'mode' : 'material')));
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
    const cv = await studioApi.cover({ title: coverTitle, ratio, accent: '#16a34a', bgImageUrl: coverFrameUrl, ...coverStyle });
    if (renderToken.current !== token) return;
    const cUrl = cv.ok ? (cv.url ?? null) : null;
    setCoverUrl(cUrl);

    const spec = {
      materials: matNames,
      script: scriptOverride ?? activeSpokenScript,
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
      voiceoverUrl: voiceoverMode === 'none' ? undefined : voiceoverUrl ?? undefined,
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
    if (STEPS[stepIdx + 1]?.id === 'material') setActiveFolder('recommend');
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

  const generateFromMaterialLibrary = async () => {
    setModeActionLoading(true);
    setModeNotice('');
    setModeScripts([]);
    try {
      const pool = materials.filter(item => item.type !== 'audio');
      if (pool.length === 0) {
        setModeNotice('素材库暂无可用图片或视频，请先上传素材。');
        setStepIdx(STEPS.findIndex(s => s.id === 'material'));
        return;
      }
      const preferred = selected.length
        ? selected
        : pool.filter(item => ['presenter', 'product', 'factory', 'scene', 'model', 'detail', 'upload'].includes(item.folder)).slice(0, 6).map(item => item.id);
      const selectResp = await studioApi.select(
        { materials: pool.map(item => ({ id: item.id, name: item.name, type: item.type, duration: item.duration })), duration },
        preferred.length ? preferred : pool.slice(0, 4).map(item => item.id),
      );
      const nextSelected = (selectResp.selectedIds || []).filter(id => pool.some(item => item.id === id));
      const finalSelected = nextSelected.length ? nextSelected : (preferred.length ? preferred : pool.slice(0, 4).map(item => item.id));
      setSelected(finalSelected);
      const names = pool.filter(item => finalSelected.includes(item.id)).map(item => item.name);
      const outputs: ModeScriptOutput[] = [];
      const count = Math.max(1, Math.min(5, cloneCount));
      for (let i = 0; i < count; i += 1) {
        const { script: nextScript } = await studioApi.script(
          {
            materials: names,
            productInfo,
            language: 'zh',
            platform,
            duration,
            scriptType: 'storyboard',
            generationMode: 'product',
            provider,
            audience,
            sellingPoints,
            tone: `${tone} · 素材库方案 ${i + 1}`,
          },
          script,
        );
        outputs.push({ id: `material-${Date.now()}-${i}`, title: `素材库时间戳脚本 ${i + 1}`, script: nextScript, mode: 'material' });
      }
      setLang('zh');
      setScriptType('storyboard');
      if (outputs[0]) {
        const spoken = extractVoiceoverText(outputs[0].script);
        setScript(outputs[0].script);
        setVoiceoverLines(spoken);
        setVoiceDrafts({ zh: spoken });
        setActiveVoiceLang('zh');
        setScriptView('timestamp');
      }
      setModeScripts(outputs);
      setProjectTitle(projectTitle === '未命名草稿' ? '素材库快剪 · 中文口播脚本' : projectTitle);
      setModeNotice(selectResp.reason ? `已完成智能选材：${selectResp.reason}` : '已完成智能选材，并生成中文口播脚本。');
      autoGen.current = true;
    } catch (err: any) {
      setModeNotice(err?.message || '素材库生成失败，请稍后重试。');
    } finally {
      setModeActionLoading(false);
    }
  };

  const generateFromProductInfo = async () => {
    setModeActionLoading(true);
    setModeNotice('');
    setModeScripts([]);
    try {
      const product = productInfo.trim();
      if (!product) {
        setModeNotice('请先填写或选择产品信息，再生成产品素材。');
        return;
      }
      const outputs: ModeScriptOutput[] = [];
      const count = Math.max(1, Math.min(5, cloneCount));
      for (let i = 0; i < count; i += 1) {
        const { script: nextScript } = await studioApi.script(
          {
            materials: [],
            productInfo: product,
            language: 'zh',
            platform,
            duration,
            scriptType: 'storyboard',
            provider,
            audience,
            sellingPoints,
            tone: `${tone} · 产品方案 ${i + 1}`,
          },
          script,
        );
        outputs.push({ id: `product-${Date.now()}-${i}`, title: `产品时间戳脚本 ${i + 1}`, script: nextScript, mode: 'product' });
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
      setModeScripts(outputs);
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
      setProjectTitle(projectTitle === '未命名草稿' ? '产品生成 · AI素材快剪' : projectTitle);
      setModeNotice('已生成产品脚本和 Seedance 2.0 素材，已自动选中进入后续快剪流程。');
      autoGen.current = true;
    } catch (err: any) {
      setModeNotice(err?.message || '产品生成失败，请稍后重试。');
    } finally {
      setModeActionLoading(false);
    }
  };

  const applyTimestampScript = (value: string) => {
    const spoken = extractVoiceoverText(value);
    setScript(value);
    setVoiceoverLines(spoken);
    setVoiceDrafts(drafts => ({ ...drafts, zh: spoken }));
    setActiveVoiceLang('zh');
    setLang('zh');
    setScriptView('timestamp');
  };

  const generateTimestampScriptsForMode = async () => {
    if (mode === 'material') {
      await generateFromMaterialLibrary();
      return;
    }
    if (mode === 'product') {
      await generateFromProductInfo();
      return;
    }
    setModeActionLoading(true);
    setModeNotice('');
    try {
      const outputs = cloneScripts.map((item, index) => ({
        id: `clone-${Date.now()}-${index}`,
        title: `爆款复刻时间戳脚本 ${index + 1}`,
        script: item.script,
        mode: 'clone' as const,
      }));
      setModeScripts(outputs);
      if (outputs[0]) applyTimestampScript(outputs[0].script);
      else setModeNotice('请先从灵感大屏选择一条爆款视频。');
      autoGen.current = true;
    } finally {
      setModeActionLoading(false);
    }
  };

  const extractVoiceoverText = (value: string) => {
    const quoted = Array.from(value.matchAll(/[“"]([^”"]{2,})[”"]/g)).map(m => m[1]?.trim()).filter(Boolean) as string[];
    if (quoted.length) return quoted.join('\n');
    return value
      .split(/\n+/)
      .map(line => line
        .replace(/^\s*\[[^\]]+\]\s*/g, '')
        .replace(/^(Hook|Body|CTA|口播|字幕|人物说|Voiceover|Caption)\s*[：:·-]?\s*/i, '')
        .replace(/^[\d一二三四五六七八九十]+[.、]\s*/, '')
        .trim())
      .filter(line => line && !/^(分镜|镜头|画面|音频|注|Creative style|Core emotion|Goal|Storyboard|Product replacement)/i.test(line))
      .join('\n');
  };

  const generateVoiceDrafts = async () => {
    const base = extractVoiceoverText(script);
    setVoiceoverLines(base);
    setVoiceDraftLoading(true);
    try {
      const next: Record<string, string> = { zh: base };
      for (const code of voiceLangs) {
        if (code === 'zh') continue;
        const translated = await studioApi.translate({ text: base, target: code, source: 'zh' });
        next[code] = translated.ok && translated.text?.trim()
          ? translated.text
          : localizeVoiceoverFallback(base, code);
      }
      setVoiceDrafts(next);
      setActiveVoiceLang(voiceLangs[0] || 'zh');
      setLang(voiceLangs[0] || 'zh');
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
      const { covers } = await studioApi.covers({ script, productInfo, language: lang, provider, tone }, [coverTitle]);
      if (covers[0]) setCoverTitle(covers[0]);
    } catch (err: any) {
      alert(err?.message || '封面标题生成失败，请稍后重试。');
    } finally {
      setCoverLoading(false);
    }
  };

  const openCanvaCoverEditor = async () => {
    setCoverCanvaOpening(true);
    try {
      let nextCoverUrl = coverUrl;
      if (!nextCoverUrl) {
        const cv = await studioApi.cover({ title: coverTitle, ratio, accent: TRAFFIC_GREEN, bgImageUrl: coverFrameUrl, ...coverStyle });
        if (cv.url) {
          nextCoverUrl = cv.url;
          setCoverUrl(cv.url);
        }
      }
      const fullCoverUrl = nextCoverUrl ? `${window.location.origin}${nextCoverUrl}` : '';
      await navigator.clipboard?.writeText?.([
        `封面标题：${coverTitle}`,
        fullCoverUrl ? `封面参考图：${fullCoverUrl}` : '',
      ].filter(Boolean).join('\n'));
      window.open(CANVA_VIDEO_COVER_URL, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      window.open(CANVA_VIDEO_COVER_URL, '_blank', 'noopener,noreferrer');
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

  const buildCapcutPayload = () => ({
    materials: selectedClips.map(c => ({ name: c.name, url: c.url, type: c.type, duration: c.duration, edit: editFor(c) })),
    cues: subMode === 'bilingual' ? cues.map((c, i) => ({ ...c, zh: cueZh[i] })) : cues,
    subMode,
    coverTitle,
    ratio,
    language: lang,
    script,
  });

  // 用剪映精修：桌面端直接 IPC；网页端走本机后端兜底导出精修包并尝试唤起 App
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
        setCapcutMessage(out.error || (out.dir ? `已导出精修包：${out.dir}` : '已打开剪映精修入口'));
        return;
      }
      setCapcutMessage(out.error || '剪映跳转失败，请确认本机已安装剪映/CapCut。');
    } catch (err: any) {
      setCapcutMessage(err?.message || '剪映跳转失败，请确认本机已安装剪映/CapCut。');
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

  const genTts = async () => {
    setTtsLoading(true);
    setVoiceoverUrl(null);
    setVoiceoverAudios({});
    try {
      const langs = voiceLangs.length ? voiceLangs : ['zh'];
      const base = voiceDrafts.zh || voiceoverLines || extractVoiceoverText(script) || script;
      const drafts: Record<string, string> = { ...voiceDrafts, zh: voiceDrafts.zh || base };
      for (const code of langs) {
        if (drafts[code]?.trim()) continue;
        if (code === 'zh') {
          drafts.zh = base;
        } else {
          const translated = await studioApi.translate({ text: base, target: code, source: 'zh' });
          drafts[code] = translated.ok && translated.text?.trim()
            ? translated.text
            : localizeVoiceoverFallback(base, code);
        }
      }
      setVoiceoverLines(base);
      setVoiceDrafts(drafts);

      const audios: Record<string, { url: string; duration: number }> = {};
      for (const code of langs) {
        const text = drafts[code] || base;
        const r = await studioApi.tts({ text, voice, language: code });
        if (r.ok && r.url) audios[code] = { url: r.url, duration: r.duration ?? 0 };
      }
      const activeCode = langs.includes(activeVoiceLang) ? activeVoiceLang : langs[0] || 'zh';
      const activeAudio = audios[activeCode] || Object.values(audios)[0];
      if (activeAudio) {
        setVoiceoverMode('ai');
        setVoiceoverAudios(audios);
        setActiveVoiceLang(activeCode);
        setLang(activeCode);
        setVoiceoverUrl(activeAudio.url);
        setVoiceoverDur(activeAudio.duration);
        setUploadedVoiceName('');
        setSubtitlesOn(true);
        setSubMode('target');
      }
    } catch (err: any) {
      alert(err?.message || '配音生成失败，请稍后重试。');
    } finally {
      setTtsLoading(false);
    }
  };
  useEffect(() => {
    const audio = voiceoverAudios[activeVoiceLang];
    if (!audio || voiceoverMode !== 'ai') return;
    setVoiceoverUrl(audio.url);
    setVoiceoverDur(audio.duration);
    setTtsPlaying(false);
    if (ttsAudioRef.current) ttsAudioRef.current.pause();
  }, [activeVoiceLang, voiceoverAudios, voiceoverMode]);
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
  const pickVoice = (id: string) => { setVoice(id); setVoiceoverUrl(null); setVoiceoverAudios({}); setTtsPlaying(false); };
  // 离开脚本步时停止试听
  useEffect(() => {
    if (step !== 'script' && ttsAudioRef.current) { ttsAudioRef.current.pause(); setTtsPlaying(false); }
    if (step !== 'script') setVoicePreviewIdx(null);
  }, [step]);

  /* ── 草稿 / 作品 ─────────────────────────────────────────────────────── */
  const collectSpec = () => ({
    mode, platform, ratio, duration, lang, provider,
    productInfo, productSelectMode, selectedProductIds, audience, sellingPoints, tone,
    selected, script, scriptType, voice,
    bgm, bgmVol, cover, coverTitle, coverStyle, account, caption,
    subtitlesOn, subMode, clipEdits, voiceoverMode, uploadedVoiceName,
  });

  const applySpec = (s: Record<string, unknown>) => {
    if (s.mode) setMode(s.mode as typeof mode);
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
    if (typeof s.script === 'string') setScript(s.script);
    if (s.scriptType) setScriptType(s.scriptType as typeof scriptType);
    if (s.voice) setVoice(s.voice as string);
    if (s.voiceoverMode === 'none' || s.voiceoverMode === 'ai' || s.voiceoverMode === 'upload') setVoiceoverMode(s.voiceoverMode);
    if (typeof s.uploadedVoiceName === 'string') setUploadedVoiceName(s.uploadedVoiceName);
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
                    style={on ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
                      style={{ background: on ? TRAFFIC_GREEN : 'var(--color-surface-2)', color: on ? '#fff' : 'var(--color-text-muted)' }}>
                      <m.icon size={17} />
                    </div>
                    <p className="text-sm font-bold text-text-primary mb-1">{m.title}</p>
                    <p className="text-xs text-text-muted leading-relaxed">{m.desc}</p>
                  </button>
                );
              })}
            </div>

            <SectionTitle title="快剪参数" desc="选择平台、产品和脚本输出方式" />
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
                脚本生成已移到下一步「口播脚本」。这里仅确认生成起点、平台、比例和企业中心导入的产品。
              </div>
            </div>
          </div>
        );

      /* ③ 选素材 —— 文件夹 + 网格 两栏 */
      case 'material': {
        const folderName = (id: string) => FOLDERS.find(f => f.id === id)?.name ?? '';
        // 按内容相关性搜索：匹配素材名 + 所属文件夹（分类）名
        const q = search.trim().toLowerCase();
        const matchSearch = (c: Clip) => q === '' || c.name.toLowerCase().includes(q) || folderName(c.folder).toLowerCase().includes(q);
        const recommended = selected.length > 0
          ? materials.filter(c => selected.includes(c.id))
          : materials.filter(c => c.type !== 'audio');
        const visible = (activeFolder === 'recommend'
          ? recommended
          : materials.filter(c => activeFolder === 'all' || c.folder === activeFolder)
        ).filter(matchSearch);
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
		                {activeFolder === 'recommend' && <span className="text-[11px] text-text-muted">按脚本与当前选择优先推荐</span>}
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
		                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
		                  className={`btn-ghost !px-3 !py-1.5 !text-xs flex items-center gap-1.5 disabled:opacity-60 ${activeFolder === 'presenter' || mode === 'material' ? '' : 'ml-auto'}`}>
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
                      <button key={c.id} onClick={() => setSelected(s => on ? s.filter(x => x !== c.id) : [...s, c.id])}
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
          </div>
        );
      }

      /* ② 口播脚本 */
      case 'script': {
        const currentModeScripts = modeScripts.filter(item => item.mode === mode);
        const visibleScriptText = scriptView === 'timestamp' ? script : (voiceDrafts.zh || voiceoverLines || extractVoiceoverText(script));
        return (
          <div className="max-w-3xl">
            <div className="flex items-center justify-between mb-4">
              <SectionTitle title="口播脚本" desc="先生成带时间戳脚本，再提取纯口播台词" noMargin />
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
                  <button onClick={() => void generateTimestampScriptsForMode()} disabled={modeActionLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-50">
                    {modeActionLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} 生成时间戳脚本
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
                    {mode === 'product' ? '生成时间戳脚本后，会用第一条脚本同步生成 Seedance 2.0 素材。' : '生成结果会先保留时间戳结构，再自动提取纯口播台词。'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void generateTimestampScriptsForMode()}
                  disabled={modeActionLoading || (mode === 'product' && !productInfo.trim())}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60"
                >
                  {modeActionLoading ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                  {modeActionLoading ? '生成中…' : '生成时间戳脚本'}
                </button>
              </div>
              {modeNotice && (
                <div className="mt-3 rounded-xl border border-accent/20 bg-accent-glow px-3 py-2 text-xs font-semibold text-accent">
                  {modeNotice}
                </div>
              )}
              {currentModeScripts.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {currentModeScripts.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => applyTimestampScript(item.script)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${script === item.script ? 'border-accent bg-accent-glow text-accent' : 'border-border bg-white text-text-muted hover:text-text-secondary'}`}
                    >
                      脚本 {index + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative mb-5">
              <textarea
                value={visibleScriptText}
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
                    <Loader2 size={14} className="animate-spin" /> AI 正在生成脚本…
                  </span>
                </div>
              )}
            </div>

            <div className="mb-5 rounded-2xl border border-border bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-text-primary">提取口播与多语种字幕</p>
                  <p className="mt-1 text-xs text-text-muted">从时间戳脚本里提取口播台词，再生成不同语种版本。</p>
                </div>
                <button
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
                    value={voiceDrafts[activeVoiceLang] || ''}
                    onChange={e => setVoiceDrafts(drafts => ({ ...drafts, [activeVoiceLang]: e.target.value }))}
                    rows={5}
                    className="w-full rounded-xl border border-border bg-surface-2 p-3 text-sm leading-relaxed text-text-secondary outline-none focus:border-accent resize-none"
                  />
                </div>
              )}
            </div>

            <Field label="配音方式">
              <input ref={voiceoverInputRef} type="file" accept="audio/*" className="hidden"
                onChange={e => { void handleVoiceoverUpload(e.target.files); e.target.value = ''; }} />
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
                  {VOICES.map(v => (
                    <button key={v.id} onClick={() => pickVoice(v.id)}
                      className="card !rounded-xl p-3 flex items-center gap-2.5 text-left"
                      style={voice === v.id ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: voice === v.id ? TRAFFIC_GREEN : 'var(--color-surface-2)', color: voice === v.id ? '#fff' : 'var(--color-text-muted)' }}>
                        {v.id === 'v4' ? <Upload size={14} /> : <Mic size={14} />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-text-primary truncate">{v.name}</p>
                        <p className="text-[10px] text-text-muted">{v.id === 'v4' ? v.tag : `${v.tag} · 智能配音`}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 max-w-xl">
                {voiceoverMode === 'ai' && (
	                  <button
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
                {voiceoverUrl && (
                  <button
                    onClick={startVoiceAssemblyPreview}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:text-text-primary"
                  >
                    <Play size={12} />
                    确认拼接与配音
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
                      <CoverFace coverUrl={coverUrl} frameUrl={coverFrameUrl} title={coverTitle} style={coverStyle} />
                    )}
                    {subtitlesOn && cues[subPreviewIdx] && (
                      <div className="absolute inset-x-0 bottom-7 z-10 px-3 text-center pointer-events-none">
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
              <SectionTitle title="背景配乐" desc="支持不配乐、选择音效库或上传本地音乐" noMargin />
              <input ref={bgmInputRef} type="file" accept="audio/*" className="hidden"
                onChange={e => { void handleBgmUpload(e.target.files); e.target.value = ''; }} />
              <button onClick={() => bgmInputRef.current?.click()} disabled={bgmUploading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-60">
                {bgmUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} 上传音乐
              </button>
            </div>
            <div className="mb-4 inline-flex rounded-xl border border-border bg-surface-2 p-1">
              {[
                { id: 'library', label: '音效库' },
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
                  <p className="mt-1 text-xs text-text-muted">在音效库里点心形即可加入我的收藏。</p>
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
            <Field label={`音量平衡 · 背景乐 ${bgm ? `${bgmVol}%` : '关闭'} / 口播 ${100 - bgmVol}%`}>
              <input type="range" min={0} max={70} value={bgmVol}
                onChange={e => setBgmVol(+e.target.value)} disabled={!bgm} className="w-full max-w-md accent-[#16a34a] disabled:opacity-40" />
              <p className="text-[11px] text-text-muted mt-1.5">口播时自动压低背景乐（ducking）</p>
            </Field>
          </div>
        );
      }

      /* ⑤ 封面 —— 用所选视频的真实帧画面，便于辨认内容 */
      case 'cover': {
        const renderCard = (key: string, frameUrl: string | undefined, label: string) => {
          const on = cover === key;
          return (
            <div key={key} role="button" tabIndex={0} onClick={() => setCover(key)}
              className="card !rounded-2xl overflow-hidden text-left cursor-pointer"
              style={on ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 2px ${TRAFFIC_GREEN}` } : undefined}>
              <div className="relative aspect-[9/16]">
                {/* 选中的封面标题可直接在画面上点选编辑 */}
                <CoverFace frameUrl={frameUrl} title={coverTitle} style={coverStyle}
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

            <div className="flex-1 min-w-0">
              <SectionTitle title="成片预览" desc="确认效果后进入剪映做最终精修" />
              <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-border bg-surface-2 px-3 py-2">
                    <p className="text-[11px] font-semibold text-text-muted">素材片段</p>
                    <p className="mt-1 text-sm font-bold text-text-primary">{selectedClips.length} 段 · {totalDur}s</p>
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
                <button
                  onClick={() => void openInCapcut()}
                  disabled={capcutOpening}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-4 text-base font-black text-white shadow-sm transition active:scale-[0.99]"
                >
                  {capcutOpening ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
                  {capcutOpening ? '正在准备剪映精修包...' : '跳转剪映精修'}
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
