import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Play, Sparkles, FileText, Layout as LayoutIcon,
  TrendingUp, Clock, Globe, ChevronDown, X, Loader2,
  Check, Copy, ArrowRight, Zap, LayoutGrid, List,
  Lightbulb, Flame, BarChart2, ChevronRight, Film, Download, Plus,
  Bookmark, Maximize2, Minimize2, Lock,
} from 'lucide-react';
import { studioApi, type Material } from '../lib/studioApi';
import { authHeader } from '../lib/auth';
import type { Page } from '../App';
import { completeDemoStep, readDemoProgress } from '../lib/demoProgress';

// ── Types ─────────────────────────────────────────────────────────────────────
type Platform = 'all' | 'tiktok' | 'instagram' | 'youtube' | 'facebook';
type ScriptType = 'voiceover' | 'storyboard';
type SortMode = 'heat' | 'crawlTime';

const isDemoTrafficStep = () => {
  const progress = readDemoProgress();
  return Boolean(progress.strategy && !progress.traffic);
};

interface TrendVideo {
  id: string;
  recordId?: string;
  platform: Exclude<Platform, 'all'>;
  title: string;
  thumbnail: string;
  duration: number;
  tags: string[];
  views: string;
  trend: 'hot' | 'rising' | 'stable';
  videoUrl?: string;  // 真实视频（有则卡片直接播放）
  sourceUrl?: string; // 外部平台原始链接（如 YouTube watch URL）
  status?: 'pending' | 'analyzed' | 'failed';
  aiAnalysis?: VideoAnalysisPayload;
  crawledAt?: string;
}

interface GeminiVideoAnalysis {
  theme?: string;
  hooks?: string[];
  sellingPoints?: string[];
  mood?: string;
  structure?: string;
  firstTenSeconds?: {
    atmosphere?: string;
    audioVisual?: string;
    camera?: string;
    visuals?: string;
    voiceMusic?: string;
  };
  coarseStructure?: Array<{
    time?: string;
    frame?: string;
    label?: string;
    description?: string;
    desc?: string;
  }>;
  scriptSummary15s?: {
    visualStyle?: string;
    coreEmotion?: string;
    competitors?: string[];
  };
  scriptDetails15s?: Array<{
    time?: string;
    timestamp?: string;
    shot?: string;
    camera?: string;
    visual?: string;
    subtitle?: string;
    audio?: string;
    note?: string;
  }>;
  recommendedScriptType?: 'voiceover' | 'storyboard';
}

interface VideoAnalysisPayload {
  source?: string;
  views?: string;
  keyword?: string;
  crawlRule?: string;
  dateFrom?: string;
  dateTo?: string;
  materialUrl?: string;
  materialPoster?: string;
  downloadStatus?: string;
  videoFetchStatus?: string;
  geminiStatus?: string;
  downloadError?: string;
  analysisSource?: string;
  analysisQuality?: string;
  analysisError?: string;
  analyzedAt?: string;
  crawlerOpsTaskId?: string;
  crawlerOpsStatus?: string;
  crawlerOpsReason?: string;
  crawlerOpsLastError?: string;
  gemini?: GeminiVideoAnalysis;
}

interface StructureStep { time: string; label: string; desc: string }
interface FirstTenSecondInsight { dimension: string; detail: string }
interface ScriptDetail15s { time: string; shot: string; camera: string; visual: string; subtitle: string; audio: string; note?: string }
interface ScriptSummary15s { visualStyle: string; coreEmotion: string; competitors: string[] }
interface ScriptAnalysis {
  videoType: string;
  structure: StructureStep[];
  firstTenSeconds: FirstTenSecondInsight[];
  scriptSummary15s: ScriptSummary15s;
  scriptDetails15s: ScriptDetail15s[];
  referenceHighlights: string[];
  adaptTip: string;
  emotion: string;
  infoSpeed: string;
}

// ── Platform meta ─────────────────────────────────────────────────────────────
const PLATFORM_META: Record<Exclude<Platform, 'all'>, { label: string; color: string; bg: string }> = {
  tiktok:    { label: 'TikTok',    color: '#fff', bg: '#010101' },
  instagram: { label: 'Instagram', color: '#fff', bg: '#c13584' },
  youtube:   { label: 'YouTube',   color: '#fff', bg: '#ff0000' },
  facebook:  { label: 'Facebook',  color: '#fff', bg: '#1877f2' },
};
const PLATFORM_FALLBACK = { label: 'Unknown', color: '#fff', bg: '#64748b' };
const getPlatformMeta = (p: string) => PLATFORM_META[p as Exclude<Platform, 'all'>] ?? PLATFORM_FALLBACK;

const PLATFORM_FILTERS: { id: Platform; label: string }[] = [
  { id: 'all',       label: '全部平台' },
  { id: 'youtube',   label: 'YouTube' },
  { id: 'tiktok',    label: 'TikTok' },
  { id: 'instagram', label: 'Ins' },
  { id: 'facebook',  label: 'Facebook' },
];

const LOCKED_PLATFORM_MESSAGES: Partial<Record<Platform, string>> = {
  facebook: '正式版解锁FB爆点推荐功能',
  instagram: '正式版解锁IG爆点推荐功能',
};

const LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'zh', label: '中文' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'es', label: 'Español' }, { code: 'ar', label: 'العربية' },
  { code: 'fr', label: 'Français' }, { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' }, { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },   { code: 'ko', label: '한국어' },
];

function cleanAnalysisText(value: unknown): string {
  return String(value || '')
    .replace(/基础(?:资料|信息)推断[:：]\s*/g, '')
    .replace(/基于标题、标签、平台、热度和时长推断[:：]?\s*/g, '')
    .replace(/真实视频分析完成后会回填/g, '视频级分析会补充')
    .trim();
}

function getAnalysis(video: TrendVideo): ScriptAnalysis | null {
  const gemini = video.aiAnalysis?.gemini;
  if (!gemini) return null;
  const hooks = Array.isArray(gemini.hooks) ? gemini.hooks.map(cleanAnalysisText).filter(Boolean) : [];
  const sellingPoints = Array.isArray(gemini.sellingPoints) ? gemini.sellingPoints.map(cleanAnalysisText).filter(Boolean) : [];
  const isMetadataFallback = video.aiAnalysis?.analysisSource === 'metadata-fallback' || video.aiAnalysis?.analysisQuality === 'metadata';
  const structure = buildCoarseStructure(gemini, video);
  return {
    videoType: isMetadataFallback ? '基础资料拆解' : gemini.recommendedScriptType === 'storyboard' ? '分镜评测型' : '口播转化型',
    structure,
    firstTenSeconds: buildFirstTenSecondInsights(gemini, video, hooks, sellingPoints),
    scriptSummary15s: buildScriptSummary15s(gemini, video, sellingPoints),
    scriptDetails15s: buildScriptDetails15s(gemini, video, structure),
    referenceHighlights: [
      gemini.theme ? `主题：${cleanAnalysisText(gemini.theme)}` : '',
      gemini.mood ? `情绪：${cleanAnalysisText(gemini.mood)}` : '',
      ...hooks.slice(0, 2).map(point => `注意力入口：${point}`),
      ...sellingPoints.slice(0, 4).map(point => `可复用爆点：${point}`),
    ].filter(Boolean),
    adaptTip: structure.length
      ? `生成脚本时优先复用「${structure.slice(0, 3).map(step => step.desc).join(' → ')}」的节奏，并把产品卖点放进同一信息密度。`
      : 'Gemini 尚未返回可复用结构',
    emotion: cleanAnalysisText(gemini.mood) || (isMetadataFallback ? '基础分析' : '真实分析'),
    infoSpeed: video.duration > 90 ? '中密度' : '高密度',
  };
}

function buildScriptSummary15s(gemini: GeminiVideoAnalysis, video: TrendVideo, sellingPoints: string[]): ScriptSummary15s {
  const summary = gemini.scriptSummary15s || {};
  const competitors = Array.isArray(summary.competitors)
    ? summary.competitors.map(String).filter(Boolean)
    : sellingPoints.filter(point => /brand|品牌|竞品|vs|对比/i.test(point)).slice(0, 3);
  return {
    visualStyle: cleanAnalysisText(summary.visualStyle) || (video.platform === 'youtube' ? '真人写实评测风格' : '真人社媒写实风格'),
    coreEmotion: cleanAnalysisText(summary.coreEmotion) || cleanAnalysisText(gemini.mood) || '好奇、信任、种草',
    competitors: competitors.map(cleanAnalysisText).filter(Boolean),
  };
}

function buildScriptDetails15s(gemini: GeminiVideoAnalysis, video: TrendVideo, structure: StructureStep[]): ScriptDetail15s[] {
  const details = Array.isArray(gemini.scriptDetails15s) ? gemini.scriptDetails15s : [];
  const normalized = details.map((item, index) => {
    const visual = cleanAnalysisText(item.visual);
    const subtitle = cleanAnalysisText(item.subtitle);
    if (!visual && !subtitle) return null;
    return {
      time: String(item.time || item.timestamp || `${Math.max(0.2, index * 1.5).toFixed(1)}s`),
      shot: String(item.shot || '中近景'),
      camera: String(item.camera || '固定镜头'),
      visual: visual || `画面承接「${video.title}」的核心信息。`,
      subtitle: subtitle || '字幕待 Gemini 从真实视频中补全',
      audio: cleanAnalysisText(item.audio) || 'BGM/配音待 Gemini 从真实视频中补全',
      note: item.note ? cleanAnalysisText(item.note) : undefined,
    };
  }).filter(Boolean) as ScriptDetail15s[];
  if (normalized.length) return normalized.slice(0, 12);

  const source = structure.length ? structure : splitStructure(video.title, Math.min(video.duration, 15));
  return source.slice(0, 5).map((step, index) => ({
    time: index === 0 ? '0.2s' : `${(index * 3).toFixed(1)}s-${Math.min(index * 3 + 3, 15).toFixed(1)}s`,
    shot: index === 0 ? '特写' : '中近景',
    camera: index === 0 ? '固定镜头' : '轻微推近',
    visual: `画面围绕「${cleanAnalysisText(step.desc)}」展开，视频级分析会补充人物、产品、动作和场景细节。`,
    subtitle: `字幕/口播围绕「${video.title}」强化当前信息点。`,
    audio: video.platform === 'youtube' ? '配音解释为主，背景音乐轻量铺底。' : '社媒节奏 BGM，配合字幕快速推进。',
  }));
}

function buildCoarseStructure(gemini: GeminiVideoAnalysis, video: TrendVideo): StructureStep[] {
  const frames = Array.isArray(gemini.coarseStructure) ? gemini.coarseStructure : [];
  const normalized = frames.map((frame, index) => {
    const desc = cleanAnalysisText(frame.description || frame.desc || frame.frame);
    if (!desc) return null;
    return {
      time: String(frame.time || `${index * 3}-${(index + 1) * 3}s`),
      label: String(frame.label || (index === 0 ? '开场画面' : `粗略帧 ${index + 1}`)),
      desc,
    };
  }).filter(Boolean) as StructureStep[];
  if (normalized.length) return normalized.slice(0, 10);
  return splitStructure(gemini.structure, video.duration);
}

function splitStructure(structure?: string, duration = 30): StructureStep[] {
  const raw = (structure || '').trim();
  if (!raw) return [{ time: '待分析', label: 'Gemini', desc: '视频下载并分析完成后显示真实结构' }];
  const parts = raw.split(/\s*(?:→|->|,|，|;|；)\s*/).filter(Boolean);
  const frameCount = Math.min(10, Math.max(3, Math.ceil(Math.min(duration || 30, 30) / 3)));
  const source = parts.length ? parts : [raw];
  return Array.from({ length: Math.min(frameCount, Math.max(source.length, 3)) }, (_, index) => {
    const desc = source[index] || source[source.length - 1] || raw;
    return {
      time: `${index * 3}-${(index + 1) * 3}s`,
      label: index === 0 ? '开场画面' : `粗略帧 ${index + 1}`,
      desc,
    };
  });
}

function buildFirstTenSecondInsights(
  gemini: GeminiVideoAnalysis,
  video: TrendVideo,
  hooks: string[],
  sellingPoints: string[],
): FirstTenSecondInsight[] {
  const firstTen = gemini.firstTenSeconds || {};
  const fallbackTheme = cleanAnalysisText(gemini.theme) || video.title;
  const fallbackMood = cleanAnalysisText(gemini.mood) || '待 Gemini 识别';
  const firstHook = hooks[0] || fallbackTheme;
  const primaryPoint = sellingPoints[0] || video.tags[0] || fallbackTheme;
  const values: FirstTenSecondInsight[] = [
    {
      dimension: '氛围',
      detail: firstTen.atmosphere || `前 10 秒围绕「${fallbackTheme}」建立观看期待，整体情绪倾向为「${fallbackMood}」。`,
    },
    {
      dimension: '音画',
      detail: firstTen.audioVisual || `标题/字幕/画面信息需要快速同屏解释「${firstHook}」，让用户不用等待也能理解看点。`,
    },
    {
      dimension: '运镜',
      detail: firstTen.camera || '建议关注开场是否使用近景、快速切换或手持展示来制造即时感；视频级分析完成后会回填真实运镜细节。',
    },
    {
      dimension: '画面',
      detail: firstTen.visuals || `画面应优先呈现主产品、使用结果或强对比场景，核心视觉承接「${primaryPoint}」。`,
    },
    {
      dimension: '配音配乐',
      detail: firstTen.voiceMusic || `配音/配乐需要匹配「${fallbackMood}」的节奏，前 10 秒内用短句或节拍推动信息密度。`,
    },
  ];
  return values.map(item => ({ ...item, detail: cleanAnalysisText(item.detail) })).filter(item => item.detail);
}

function summarizeProductInfo(input: string): string {
  const text = input.trim();
  if (!text) return '未选择主推品，请先从企业中心产品中选择或补充产品信息。';
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function getPrimaryProductLabel(productInfo: string): string {
  const match = productInfo.match(/主推品[:：]\s*([^\n]+)/);
  if (match?.[1]) return match[1].trim();
  return productInfo.trim().split('\n')[0]?.replace(/^[-*\s]+/, '').trim() || '当前主推品';
}

function getProductField(productInfo: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = productInfo.match(new RegExp(`${escaped}[:：]\\s*([^\\n]+)`));
  return match?.[1]?.trim() || '';
}

function shortenText(text: string, max = 72): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function conciseLines(text: string, maxLines = 6, maxChars = 34): string[] {
  const clean = String(text || '').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts = clean.split(/\s*(?:。|；|;|，(?=\S{8,})|\. (?=[A-Z0-9]))\s*/).map(s => s.trim()).filter(Boolean);
  const lines: string[] = [];
  for (const part of parts.length ? parts : [clean]) {
    let rest = part;
    while (rest.length > maxChars && lines.length < maxLines) {
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars).trim();
    }
    if (rest && lines.length < maxLines) lines.push(rest);
    if (lines.length >= maxLines) break;
  }
  return lines.slice(0, maxLines);
}

function productScriptContext(productInfo: string): {
  label: string;
  category: string;
  advantage: string;
  market: string;
  proof: string;
} {
  const label = getPrimaryProductLabel(productInfo);
  const category = getProductField(productInfo, '产品类目') || label;
  const advantage = getProductField(productInfo, '核心优势') || getProductField(productInfo, '品牌 USP') || '可做私标定制、快速打样和合规资料支持';
  const market = getProductField(productInfo, '目标市场') || '海外美妆买家';
  const proof = getProductField(productInfo, '认证资质') || getProductField(productInfo, '起订量') || '小批量测试和私标包装支持';
  return { label, category, advantage, market, proof };
}

function productLabelForLang(product: ReturnType<typeof productScriptContext>, langCode = 'zh'): string {
  if (langCode === 'zh') return product.label;
  if (langCode === 'id') return 'produk unggulan';
  return 'featured product bundle';
}

function advantageForLang(product: ReturnType<typeof productScriptContext>, langCode = 'zh'): string {
  if (langCode === 'zh') return shortenText(product.advantage, 34);
  if (langCode === 'id') return 'sampel cepat, kemasan private-label, dan dukungan dokumen kepatuhan';
  return 'fast sampling, private-label packaging, and compliance documentation support';
}

function voiceLine(line: string, langCode = 'zh'): string {
  return langCode === 'zh' ? `人物说：“${line}”` : `Voiceover: "${line}"`;
}

function scriptTitle(product: ReturnType<typeof productScriptContext>, languageLabel?: string, langCode = 'zh'): string {
  if (langCode === 'zh') return `口播脚本｜${product.label}｜${languageLabel || '中文'}`;
  if (langCode === 'id') return `Naskah Voiceover | Produk Unggulan | ${languageLabel || 'Bahasa Indonesia'}`;
  return `Voiceover Script | Featured Product Bundle | ${languageLabel || 'English'}`;
}

function inferShotAction(detail: ScriptDetail15s, index: number, product: ReturnType<typeof productScriptContext>, langCode = 'zh'): string {
  const label = productLabelForLang(product, langCode);
  if (langCode !== 'zh') {
    const actions = langCode === 'id' ? [
      `Show ${label} close to the camera with clean packaging and a clear product texture shot`,
      `Cut to a simple usage moment, keeping the reference video's quick product-first rhythm`,
      `Show the bundle, shade range, and private-label packaging options in one clean frame`,
      `Use a close-up result shot to make the texture and finish easy to understand`,
      `End with the full product set and a clear message prompt for samples or a quote`,
    ] : [
      `Show ${label} close to the camera with clean packaging and a clear product texture shot`,
      `Cut to a simple usage moment, keeping the reference video's quick product-first rhythm`,
      `Show the bundle, shade range, and private-label packaging options in one clean frame`,
      `Use a close-up result shot to make the texture and finish easy to understand`,
      `End with the full product set and a clear message prompt for samples or a quote`,
    ];
    return actions[index % actions.length]!;
  }
  const lower = `${detail.visual} ${detail.subtitle}`.toLowerCase();
  if (/hand|手|hold|举起|展示|管|瓶|spatula|applicator|swatch|涂|抹|唇|shade|色/.test(lower)) {
    return `模特手持「${product.label}」靠近镜头，展示管身、刷头和上唇/手背试色效果；画面保留对标视频的手部特写和产品质感节奏`;
  }
  if (/face|脸|skin|肤|look|mirror|镜头|smile|微笑/.test(lower)) {
    return `模特对镜展示「${product.label}」上唇后的妆效，表情从观察到惊喜，突出颜色贴肤、光泽和日常通勤适配`;
  }
  if (/brand|logo|设备|device|包装|box|name|字样/.test(lower)) {
    return `镜头切到「${product.label}」套装包装、色号排列和私标 Logo 位，手指轻点关键卖点区域`;
  }
  if (/result|before|after|效果|证明|评论|热度/.test(lower)) {
    return `画面用上唇前后对比和多色号并排展示证明「${product.label}」的显色、成膜和套装组合价值`;
  }
  const actions = [
    `开场直接给「${product.label}」上唇结果，保留对标视频先给效果再解释的节奏`,
    `模特边试色边把「${product.label}」放到镜头前，形成产品和妆效同框`,
    `切到套装多色号平铺，突出私标包装质感和可组合销售`,
    `用手背/唇部近景展示颜色、光泽和成膜后的不黏腻感`,
    `收束到套装全貌和询盘引导，强调低 MOQ、打样快、适合 ${product.market}`,
  ];
  return actions[index % actions.length]!;
}

function localizedVoiceLine(index: number, product: ReturnType<typeof productScriptContext>, langCode = 'zh'): string {
  const label = productLabelForLang(product, langCode);
  const advantage = advantageForLang(product, langCode);
  const zh = [
    `这款${label}不是只好看，上脸质感也很稳。`,
    `如果你想做一款容易出单的组合，这套可以直接当主推。`,
    `它的优势是${advantage}，适合先小批量测市场。`,
    `近看细节和包装质感都在线，做私标也很容易出效果。`,
    `想要样品、色号表或报价，可以直接留言给我们。`,
  ];
  const en = [
    `This ${label} is not just pretty. The texture looks reliable from the first look.`,
    `If you need an easy product bundle to test, this can be your lead item.`,
    `Its key edge is ${advantage}, so it works for small-batch market testing.`,
    `The details and packaging look clean on camera, which is friendly for private label orders.`,
    `Message us for samples, shade options, packaging details, or a quick quote.`,
  ];
  const id = [
    `${label} bukan cuma terlihat cantik. Teksturnya juga terlihat meyakinkan.`,
    `Kalau kamu ingin coba produk bundle yang mudah dijual, ini bisa jadi produk utama.`,
    `Keunggulannya adalah ${advantage}, cocok untuk tes pasar kecil.`,
    `Detail dan kemasannya terlihat rapi di kamera, cocok untuk private label.`,
    `Kirim pesan untuk sampel, pilihan warna, kemasan, atau penawaran harga.`,
  ];
  const source = langCode === 'id' ? id : langCode === 'zh' ? zh : en;
  return source[index % source.length]!;
}

function rewriteSubtitle(detail: ScriptDetail15s, index: number, product: ReturnType<typeof productScriptContext>, langCode = 'zh'): string {
  const original = cleanAnalysisText(detail.subtitle);
  const line = localizedVoiceLine(index, product, langCode);
  if (original && !/待 Gemini|视频下载|显示真实|基础资料/.test(original)) {
    return `${line}（参考原节奏：${shortenText(original, 42)}）`;
  }
  return line;
}

function adaptedFrameLine(detail: ScriptDetail15s, index: number, product: ReturnType<typeof productScriptContext>, langCode = 'zh'): string {
  const visual = inferShotAction(detail, index, product, langCode);
  const subtitle = rewriteSubtitle(detail, index, product, langCode);
  const audio = detail.audio && !/待真实视频|待 Gemini|待视频/.test(detail.audio)
    ? detail.audio
    : 'BGM 保持轻快种草节奏，口播短句跟随字幕切点。';
  const note = detail.note ? `（注：保留对标视频节奏备注：${detail.note}）` : '';
  if (langCode !== 'zh') {
    return `[${detail.time}] Shot: close-up or medium shot; Camera: simple handheld movement; Visual: ${visual}; ${voiceLine(subtitle, langCode)}; Captions match the voiceover; Audio: upbeat social commerce music.`;
  }
  return `[${detail.time}] ${detail.shot}；${detail.camera}；${visual}；人物说：“${subtitle}”；字幕同口播；${audio}${note}`;
}

function makeVoiceoverDraft(_video: TrendVideo, analysis: ScriptAnalysis, productInfo: string, languageLabel?: string, langCode = 'zh'): string {
  const product = productScriptContext(productInfo);
  const count = Math.min(6, Math.max(4, analysis.scriptDetails15s.length || 5));
  const lines = Array.from({ length: count }, (_, index) => localizedVoiceLine(index, product, langCode));
  return `${scriptTitle(product, languageLabel, langCode)}

${lines.map(line => voiceLine(line, langCode)).join('\n')}`;
}

function makeStoryboardDraft(_video: TrendVideo, analysis: ScriptAnalysis, productInfo: string, languageLabel?: string, langCode = 'zh'): string {
  const product = productScriptContext(productInfo);
  const competitors = analysis.scriptSummary15s.competitors.length
    ? analysis.scriptSummary15s.competitors.map(item => `==${item}==`).join('；')
    : '无明确竞品露出，复用对标视频的镜头节奏、产品展示方式和字幕口吻';
  const frames = analysis.scriptDetails15s.map((detail, index) => adaptedFrameLine(detail, index, product, langCode)).join('\n\n');
  if (langCode !== 'zh') {
    return `Video Storyboard | Featured Product Bundle | ${languageLabel || 'English'}

Creative style: realistic social commerce video
Core emotion: quick product discovery, trust, and purchase intent
Product replacement: use this featured product bundle, with private-label packaging, fast samples, and compliant documentation support.
Voiceover language: ${languageLabel || 'English'}. All spoken lines must stay in this language.
Goal: follow the reference video's rhythm while replacing the product, benefits, captions, and call to action.

Storyboard:
${frames}`;
  }
  return `**可生成视频分镜｜${product.label}｜${languageLabel || '中文'}**

【分析摘要】
指定画风：${analysis.scriptSummary15s.visualStyle}
核心情绪：${analysis.scriptSummary15s.coreEmotion}
竞品识别：${competitors}
产品替换：主推「${product.label}」，参考产品范围「${shortenText(product.category, 60)}」，证明点「${shortenText(product.proof, 60)}」。
口播语言：${languageLabel || '中文'}。所有“人物说：”引号内台词必须使用该语言。
成片目标：按照对标视频的 15 秒时间戳逐镜复刻，只替换为我方产品、卖点、口播语言、字幕和行动引导。

【分镜脚本】
${frames}`;
}

function scriptTypeLabel(type: ScriptType): string {
  return type === 'voiceover' ? '口播短视频脚本' : '分镜短视频脚本';
}

function splitProfileList(value?: string): string[] {
  return String(value || '')
    .split(/[\n,，;；、/]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

interface EnterpriseProfileForScript {
  company?: { name?: string; industry?: string; mainMarkets?: string; description?: string };
  products?: { categories?: string; priceRange?: string; moq?: string; certifications?: string; highlights?: string };
  brand?: { tone?: string; style?: string; usp?: string; preferredLanguages?: string };
  strategy?: { focusProducts?: string; focusMarkets?: string; currentGoal?: string; pricingStrategy?: string };
  knowledge?: string;
}

interface ProductOption { id: string; label: string; info: string }

function buildProductOptions(profile: EnterpriseProfileForScript): ProductOption[] {
  const focusProducts = splitProfileList(profile.strategy?.focusProducts);
  const categories = splitProfileList(profile.products?.categories);
  const names = Array.from(new Set([...focusProducts, ...categories]));
  const baseLines = [
    profile.products?.categories ? `产品类目：${profile.products.categories}` : '',
    profile.products?.priceRange ? `价格区间：${profile.products.priceRange}` : '',
    profile.products?.moq ? `起订量：${profile.products.moq}` : '',
    profile.products?.certifications ? `认证资质：${profile.products.certifications}` : '',
    profile.products?.highlights ? `核心优势：${profile.products.highlights}` : '',
    profile.brand?.usp ? `品牌 USP：${profile.brand.usp}` : '',
    profile.brand?.tone ? `品牌语气：${profile.brand.tone}` : '',
    profile.strategy?.focusMarkets || profile.company?.mainMarkets ? `目标市场：${profile.strategy?.focusMarkets || profile.company?.mainMarkets}` : '',
    profile.strategy?.currentGoal ? `当前目标：${profile.strategy.currentGoal}` : '',
    profile.company?.description ? `公司背景：${profile.company.description}` : '',
  ].filter(Boolean);

  const options = names.map((name, index) => ({
    id: `product-${index}`,
    label: name,
    info: [`主推品：${name}`, ...baseLines].join('\n'),
  }));

  if (baseLines.length) {
    options.unshift({
      id: 'enterprise-products',
      label: '企业产品组合',
      info: ['主推品：企业产品组合', ...baseLines].join('\n'),
    });
  }

  return options;
}

function summarizePipelineError(raw?: string): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/could not find .*cookies database|cookies database/i.test(text)) {
    return '下载需要平台登录态，但服务端没有读到浏览器 cookies。请配置可用的 YT_DLP_COOKIES_BROWSER，或换一个无需登录即可下载的公开视频链接。';
  }
  if (/fetch failed/i.test(text)) {
    return '真实视频已拿到，但 Gemini 分析请求失败。通常是服务端无法访问 Gemini 或代理/API Key 配置异常；恢复网络后可重新分析。';
  }
  if (/GEMINI_API_KEY/i.test(text)) {
    return 'Gemini API Key 未配置或不可用，暂时无法完成视频理解分析。';
  }
  if (/429|RESOURCE_EXHAUSTED|quota|prepayment credits|额度|余额/i.test(text)) {
    return '待测试用户填入真实 Gemini API Key。当前只展示基础资料分析；配置可用 Key 后，队列会继续升级为视频级分析。';
  }
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function pipelineState(video: TrendVideo): { title: string; desc: string; spinning: boolean; failed: boolean } {
  const analysis = video.aiAnalysis || {};
  const quotaError = /429|RESOURCE_EXHAUSTED|quota|prepayment credits|额度|余额/i.test(String(analysis.analysisError || analysis.downloadError || analysis.crawlerOpsLastError || ''));
  if (quotaError) {
    return { title: '待测试用户填入真实 Gemini API Key', desc: summarizePipelineError(analysis.analysisError || analysis.downloadError || analysis.crawlerOpsLastError), spinning: false, failed: true };
  }
  if (analysis.downloadStatus === 'ops_queued') {
    return { title: '后台增强分析中', desc: '已先生成基础分析；视频获取失败后已进入后台增强队列，成功后会升级为视频级分析。', spinning: true, failed: false };
  }
  if (analysis.gemini && analysis.analysisQuality === 'video') {
    return { title: 'Gemini 分析完成', desc: '已提取前 10 秒五维拆解、脚本结构和可复用爆点。', spinning: false, failed: false };
  }
  if (analysis.analysisError) {
    return { title: 'Gemini 分析失败', desc: summarizePipelineError(analysis.analysisError), spinning: false, failed: true };
  }
  if (analysis.downloadStatus === 'failed' || video.status === 'failed') {
    return { title: '视频下载失败', desc: summarizePipelineError(analysis.downloadError || analysis.analysisError) || '真实视频没有下载成功，因此无法提交 Gemini 分析。', spinning: false, failed: true };
  }
  if (analysis.downloadStatus === 'needs_cookies') {
    return { title: '下载需要平台登录态', desc: summarizePipelineError(analysis.downloadError), spinning: false, failed: true };
  }
  if (analysis.downloadStatus === 'queued') {
    return { title: '已加入分析队列', desc: '后台会临时获取真实视频，仅用于 Gemini 分析，不写入素材库。通常几十秒到数分钟。', spinning: true, failed: false };
  }
  if (analysis.downloadStatus === 'downloading') {
    return { title: '正在获取真实视频', desc: '正在拉取低清分析版视频，完成后会立即提交 Gemini。', spinning: true, failed: false };
  }
  if (analysis.downloadStatus === 'analyzing') {
    return { title: 'Gemini 正在分析视频', desc: '真实视频已拿到，正在生成前 10 秒五维拆解和粗略脚本结构；分析完成后临时文件会被清理。', spinning: true, failed: false };
  }
  if (analysis.downloadStatus === 'downloaded' || video.videoUrl) {
    return { title: 'Gemini 正在分析视频', desc: '真实视频已下载，正在提取前 10 秒五维拆解和脚本结构。通常 30 秒到 3 分钟。', spinning: true, failed: false };
  }
  return { title: '等待真实视频分析', desc: '只有拿到真实视频内容后才能做 Gemini 分析；后台会临时获取视频，不存入素材库。', spinning: true, failed: false };
}

function needsVideoEnhancement(video: TrendVideo): boolean {
  const analysis = video.aiAnalysis;
  if (!analysis?.gemini) return true;
  return analysis.analysisSource === 'metadata-fallback' ||
    analysis.analysisQuality === 'metadata' ||
    analysis.downloadStatus === 'ops_queued';
}

function enhancementStatus(video: TrendVideo): { title: string; desc: string; active: boolean } {
  const analysis = video.aiAnalysis || {};
  const quotaError = /429|RESOURCE_EXHAUSTED|quota|prepayment credits|额度|余额/i.test(String(analysis.analysisError || analysis.downloadError || analysis.crawlerOpsLastError || ''));
  if (quotaError) {
    return { title: '待测试用户填入真实 Gemini API Key', desc: '当前展示基础资料分析；配置可用 Gemini API Key 后可重新排队升级为视频级分析。', active: false };
  }
  if (analysis.analysisQuality === 'video' || analysis.analysisSource === 'gemini-temp-video' && analysis.downloadStatus === 'analyzed') {
    return { title: '真实视频分析完成', desc: '已升级为视频级 Gemini 分析。', active: false };
  }
  if (analysis.downloadStatus === 'ops_queued' || analysis.videoFetchStatus === 'ops_queued') {
    return { title: '后台增强中', desc: '自动获取失败，已进入后台增强队列，回填后会升级。', active: true };
  }
  if (analysis.downloadStatus === 'queued' || analysis.videoFetchStatus === 'queued') {
    return { title: '视频获取队列中', desc: '后台已收到任务，等待获取真实视频。', active: true };
  }
  if (analysis.downloadStatus === 'downloading' || analysis.videoFetchStatus === 'downloading') {
    return { title: '正在获取真实视频', desc: '正在拉取 360p 内分析版视频，成功后自动进入 Gemini 队列。', active: true };
  }
  if (analysis.downloadStatus === 'analyzing' || analysis.geminiStatus === 'queued' || analysis.geminiStatus === 'analyzing') {
    return { title: 'Gemini 视频分析中', desc: '真实视频已拿到，正在生成视频级脚本拆解。', active: true };
  }
  return { title: '基础分析可用', desc: '当前结果基于标题、标签、平台、热度和时长推断。', active: false };
}

// ── Fallback thumbnail ────────────────────────────────────────────────────────
function VideoThumbnail({ platform, title }: { platform: Exclude<Platform, 'all'>; title: string }) {
  const meta = getPlatformMeta(platform);
  const initials = title.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <div className="w-full h-full flex items-center justify-center relative overflow-hidden"
      style={{ background: `linear-gradient(135deg, ${meta.bg}22, ${meta.bg}44)` }}>
      <div className="absolute inset-0 opacity-10"
        style={{ backgroundImage: `repeating-linear-gradient(45deg, ${meta.bg} 0, ${meta.bg} 1px, transparent 0, transparent 50%)`, backgroundSize: '12px 12px' }} />
      <span className="relative text-3xl font-black font-display opacity-20 text-white select-none">{initials}</span>
    </div>
  );
}

// ── Analysis Panel ────────────────────────────────────────────────────────────
function AnalysisPanel({ video, onGenerateScript, onRetry }: { video: TrendVideo; onGenerateScript: () => void; onRetry?: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [analysis, setAnalysis] = useState<ScriptAnalysis | null>(null);
  const analysisKey = JSON.stringify(video.aiAnalysis || {});

  useEffect(() => {
    setLoaded(false);
    setAnalysis(null);
    const t = setTimeout(() => {
      setAnalysis(getAnalysis(video));
      setLoaded(true);
    }, video.aiAnalysis?.gemini ? 250 : 900);
    return () => clearTimeout(t);
  }, [video.id, analysisKey]);

  if (!loaded) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(22,163,74,0.1)' }}>
          <Loader2 size={18} className="text-accent animate-spin" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-text-primary">AI 正在分析脚本结构…</p>
          <p className="text-xs text-text-muted">前 10 秒五维拆解 · 粗略 3 秒结构 · 提取复用爆点</p>
        </div>
        <div className="w-48 h-1.5 rounded-full bg-surface-2 overflow-hidden">
          <motion.div className="h-full rounded-full bg-accent"
            initial={{ width: '5%' }} animate={{ width: '90%' }}
            transition={{ duration: 1.4, ease: 'easeInOut' }} />
        </div>
      </div>
    );
  }

  if (!analysis) {
    const state = pipelineState(video);
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-surface-2 border border-border">
          {state.spinning ? <Loader2 size={18} className="text-accent animate-spin" /> : <X size={18} className={state.failed ? 'text-amber' : 'text-text-muted'} />}
        </div>
        <div className="space-y-1 max-w-xs">
          <p className="text-sm font-semibold text-text-primary">{state.title}</p>
          <p className="text-xs text-text-muted leading-relaxed">
            {state.desc}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state.failed && onRetry && (
            <button onClick={onRetry}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-white transition-colors"
              style={{ background: 'var(--color-accent)' }}>
              重试
            </button>
          )}
          {video.sourceUrl && (
            <button onClick={() => window.open(video.sourceUrl, '_blank', 'noopener,noreferrer')}
              className="px-3 py-2 rounded-lg border border-border bg-surface-2 text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors">
              打开原视频
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 space-y-4">
        {(video.aiAnalysis?.analysisQuality === 'metadata' || video.aiAnalysis?.analysisSource === 'metadata-fallback') && (
          <div className="rounded-xl border border-amber/30 bg-amber/10 px-3 py-2">
            <div className="flex items-start gap-2">
              {enhancementStatus(video).active
                ? <Loader2 size={12} className="text-amber mt-0.5 flex-shrink-0 animate-spin" />
                : <Sparkles size={12} className="text-amber mt-0.5 flex-shrink-0" />}
              <div>
                <p className="text-[11px] font-semibold text-text-primary">
                  {enhancementStatus(video).title}
                </p>
                <p className="text-[10px] text-text-muted leading-relaxed mt-0.5">
                  {enhancementStatus(video).desc}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
          <span className="px-2 py-1 rounded-md border border-border bg-surface-2 text-text-secondary font-semibold">{analysis.videoType}</span>
          <span className="flex items-center gap-1"><BarChart2 size={9} className="text-accent" />信息速度 {analysis.infoSpeed}</span>
          <span className="flex items-center gap-1"><TrendingUp size={9} />{video.views} 播放</span>
          <span>{analysis.emotion}</span>
        </div>

        {/* 爆款原因 */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Lightbulb size={11} className="text-accent" />
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">爆款核心原因 · 前 10 秒五维拆解</p>
          </div>
          <div className="space-y-1.5">
            {analysis.firstTenSeconds.map((item, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-border">
                <span className="text-accent font-bold text-[11px] flex-shrink-0 mt-px">{item.dimension}</span>
                {item.dimension === '画面' ? (
                  <div className="text-[11px] text-text-secondary leading-snug space-y-0.5">
                    {conciseLines(item.detail, 6, 32).map((line, idx) => <p key={idx}>{line}</p>)}
                  </div>
                ) : (
                  <p className="text-[11px] text-text-secondary leading-snug">{shortenText(item.detail, 96)}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 脚本结构 */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <LayoutIcon size={11} style={{ color: '#0891b2' }} />
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">视频结构拆解</p>
          </div>
          <div className="space-y-1.5">
            {analysis.structure.map((step, i) => (
              <div key={i} className="flex gap-2.5">
                <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                    style={{ background: i === 0 ? '#d97706' : i === analysis.structure.length - 1 ? '#0891b2' : '#16a34a' }}>
                    {i + 1}
                  </div>
                  {i < analysis.structure.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                </div>
                <div className={`pb-2 ${i === analysis.structure.length - 1 ? '' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-text-muted">{step.time}</span>
                    <span className="text-[10px] font-semibold text-text-primary">{step.label}</span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed mt-0.5">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 15 秒脚本详析 */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <FileText size={11} className="text-amber" />
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">15 秒脚本详析</p>
          </div>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-3 py-2.5 bg-surface-2 border-b border-border space-y-1">
              <p className="text-[11px] text-text-secondary"><span className="font-semibold text-text-primary">指定画风：</span>{analysis.scriptSummary15s.visualStyle}</p>
              <p className="text-[11px] text-text-secondary"><span className="font-semibold text-text-primary">核心情绪：</span>{analysis.scriptSummary15s.coreEmotion}</p>
              <p className="text-[11px] text-text-secondary">
                <span className="font-semibold text-text-primary">竞品识别：</span>
                {analysis.scriptSummary15s.competitors.length
                  ? analysis.scriptSummary15s.competitors.map(item => `==${item}==`).join('；')
                  : '未识别到明确竞品/品牌露出'}
              </p>
            </div>
            <div className="divide-y divide-border">
              {analysis.scriptDetails15s.map((item, i) => (
                <div key={`${item.time}-${i}`} className="px-3 py-2.5">
                  <p className="text-[11px] leading-relaxed text-text-secondary">
                    <span className="font-mono font-semibold text-accent">[{item.time}]</span>{' '}
                    <span className="font-semibold text-text-primary">{item.shot}</span>；{item.camera}；{item.visual}
                    {item.subtitle ? `；字幕：“${item.subtitle}”` : ''}
                    {item.audio ? `；${item.audio}` : ''}
                    {item.note ? `（注：${item.note}）` : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 改编建议 */}
        <div className="rounded-xl border border-dashed p-3"
          style={{ borderColor: 'rgba(22,163,74,0.3)', background: 'rgba(22,163,74,0.04)' }}>
          <p className="text-[10px] font-semibold text-accent mb-1.5">改编建议</p>
          <p className="text-[11px] text-text-secondary leading-relaxed">{analysis.adaptTip}</p>
        </div>

        {/* CTA */}
        <button onClick={onGenerateScript}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
          style={{ background: 'var(--color-accent)', boxShadow: '0 4px 12px rgba(22,163,74,0.25)' }}>
          <Sparkles size={14} />
          用此结构生成我的产品脚本
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Script Panel ──────────────────────────────────────────────────────────────
interface ScriptPanelProps {
  video: TrendVideo;
  onClose: () => void;
  onRetry?: () => void;
  onFavorite?: () => void;
  favoriting?: boolean;
  onNavigate?: (p: Page) => void;
  onEnterWorkflow?: (payload: { script: string; video: TrendVideo; scriptType: ScriptType; language: string; productInfo: string; generatedVideo?: GeneratedVideo }) => void;
}

interface GeneratedVideo {
  id: string;
  title: string;
  url?: string;
  poster?: string;
  duration: number;
  createdAt: string;
  source?: string;
  material?: Material;
  error?: string;
}

function ScriptPanel({ video, onClose, onRetry, onFavorite, favoriting, onNavigate, onEnterWorkflow }: ScriptPanelProps) {
  const [activeTab, setActiveTab] = useState<'analysis' | 'generate'>('analysis');
  const [scriptType, setScriptType] = useState<ScriptType>('voiceover');
  const [language, setLanguage] = useState('zh');
  const [productInfo, setProductInfo] = useState('');
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showLangDropdown, setShowLangDropdown] = useState(false);
  const [voiceLanguageConfirmed, setVoiceLanguageConfirmed] = useState(false);
  const [videoGenerating, setVideoGenerating] = useState(false);
  const [videoResult, setVideoResult] = useState<GeneratedVideo | null>(null);
  const [videoError, setVideoError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [seedanceVideoLocked, setSeedanceVideoLocked] = useState(true);
  const [productInfoOpen, setProductInfoOpen] = useState(false);

  const loadEnterpriseProducts = () => {
    fetch('/api/overseas/enterprise/profile', { headers: authHeader() })
      .then(r => r.ok ? r.json() : null)
      .then((profile: EnterpriseProfileForScript | null) => {
        if (!profile) return;
        const options = buildProductOptions(profile);
        setProductOptions(options);
        if (options[0]) {
          setSelectedProductId(current => current || options[0]!.id);
          setProductInfo(current => current.trim() ? current : options[0]!.info);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadEnterpriseProducts();
    fetch('/api/overseas/health')
      .then(r => r.ok ? r.json() : null)
      .then((health: { featureLocks?: { seedanceVideo?: boolean } } | null) => {
        setSeedanceVideoLocked(health?.featureLocks?.seedanceVideo !== false);
      })
      .catch(() => setSeedanceVideoLocked(true));
  }, []);

  useEffect(() => {
    if (activeTab === 'generate') loadEnterpriseProducts();
  }, [activeTab, video.id]);

  useEffect(() => {
    setVoiceLanguageConfirmed(false);
  }, [language, scriptType, video.id]);

  useEffect(() => {
    if (!isDemoTrafficStep()) return;
    setActiveTab('generate');
    setVoiceLanguageConfirmed(true);
  }, [video.id]);

  const handleSelectProduct = (id: string) => {
    setSelectedProductId(id);
    const option = productOptions.find(item => item.id === id);
    if (option) setProductInfo(option.info);
  };

  const handleGenerate = async () => {
    const shouldAdvanceDemo = isDemoTrafficStep();
    setGenerating(true);
    setResult(null);
    setVideoResult(null);
    setVideoError('');
    await new Promise(r => setTimeout(r, 1800));
    const realAnalysis = getAnalysis(video);
    const languageLabel = LANGUAGES.find(l => l.code === language)?.label;
    if (!realAnalysis) {
      const fallbackScript = scriptType === 'voiceover'
        ? `【口播脚本】基于「${video.title}」的爆款结构\n\nHook：如果你的客户正在寻找更稳定、更省心的美妆供应方案，这条内容值得收藏。\n\n卖点：我们把企业中心里的主推品、目标市场和语言偏好结合起来，突出温和护肤、私标定制和跨境交付能力。\n\n转化：评论区留下你的目标市场，我会给你一版适合当地客户的报价沟通话术。`
        : `【分镜脚本】基于「${video.title}」的爆款结构\n\n1. 近景展示产品质地，字幕突出核心卖点。\n2. 模特使用前后对比，强调肤感和场景。\n3. 展示包装、MOQ 和定制能力。\n4. 结尾引导客户询盘并领取样品方案。`;
      setResult(fallbackScript);
      if (shouldAdvanceDemo) {
        completeDemoStep('traffic');
        window.setTimeout(() => onNavigate?.('conversion'), 700);
      }
      setGenerating(false);
      return;
    }
    const nextResult = scriptType === 'voiceover'
      ? makeVoiceoverDraft(video, realAnalysis, productInfo, languageLabel, language)
      : makeStoryboardDraft(video, realAnalysis, productInfo, languageLabel, language);
    setResult(nextResult);
    if (shouldAdvanceDemo) {
      completeDemoStep('traffic');
      window.setTimeout(() => onNavigate?.('conversion'), 700);
    }
    setGenerating(false);
  };

  const handleCopy = () => {
    if (result) { void navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const generateSeedanceVideo = async () => {
    if (!result) return;
    if (seedanceVideoLocked) return;
    setVideoGenerating(true);
    setVideoResult(null);
    setVideoError('');
    try {
      const duration = Math.max(4, Math.min(15, Math.round(video.duration || 8)));
      const output = await studioApi.seedanceVideo({
        script: result,
        productInfo,
        language,
        ratio: '9:16',
        duration,
        resolution: '720p',
        title: `Seedance 视频 · ${video.title}`,
      });
      if (!output.ok || !output.url) {
        throw new Error(output.error || 'Seedance 未返回可预览的视频地址');
      }
      setVideoResult({
        id: output.material?.id || output.id || `seedance-video-${video.id}-${Date.now()}`,
        title: output.material?.name || output.title || `Seedance 视频 · ${video.title}`,
        url: output.material?.url || output.url,
        poster: output.material?.poster || output.poster || video.aiAnalysis?.materialPoster || video.thumbnail,
        duration: output.duration || duration,
        createdAt: output.createdAt || new Date().toISOString(),
        source: output.source,
        material: output.material,
        error: output.error,
      });
    } catch (err: any) {
      setVideoError(String(err?.message || err || 'Seedance 视频生成失败'));
    } finally {
      setVideoGenerating(false);
    }
  };

  const enterWorkflow = () => {
    if (!result || !videoResult) return;
    onEnterWorkflow?.({ script: result, video, scriptType, language, productInfo, generatedVideo: videoResult });
  };

  const selectedLang = LANGUAGES.find(l => l.code === language);

  return (
    <motion.div
      initial={{ opacity: 0, x: 32 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 32 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className={`fixed top-0 h-full flex flex-col border-l border-border z-50 bg-surface ${
        expanded ? 'left-0 right-0 w-auto shadow-2xl' : 'right-0 w-[420px]'
      }`}>

      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3.5 border-b border-border flex-shrink-0">
        <div className="flex-1 min-w-0 pr-3">
          <p className="text-[10px] font-mono text-text-muted uppercase tracking-widest mb-1">AI 脚本助手</p>
          <h3 className="text-sm font-semibold text-text-primary leading-snug line-clamp-2">{video.title}</h3>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {video.sourceUrl && (
            <button onClick={onFavorite} disabled={favoriting}
              className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors disabled:opacity-60"
              title="收藏到爆款素材">
              {favoriting ? <Loader2 size={15} className="animate-spin" /> : <Bookmark size={15} />}
            </button>
          )}
          <button onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors"
            title={expanded ? '还原侧栏' : '放大为主操作界面'}>
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors">
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 px-4 py-2 border-b border-border flex-shrink-0">
        {([
          { id: 'analysis' as const, icon: <BarChart2 size={12} />, label: '脚本分析' },
          { id: 'generate' as const, icon: <Sparkles size={12} />,  label: '生成脚本' },
        ]).map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === tab.id ? 'bg-accent text-white shadow-sm' : 'text-text-muted hover:text-text-secondary hover:bg-surface-2'
            }`}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'analysis' ? (
          <motion.div key="analysis" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <AnalysisPanel key={video.id} video={video} onGenerateScript={() => setActiveTab('generate')} onRetry={onRetry} />
          </motion.div>
        ) : (
          <motion.div key="generate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col flex-1 min-h-0 overflow-hidden">

            {/* Language selection */}
            <div className="px-4 py-3 border-b border-border flex-shrink-0 space-y-2.5">
              <p className="text-[11px] font-semibold text-text-primary">语言选择</p>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
                  {([
                    { type: 'voiceover' as ScriptType, icon: <FileText size={12} />, label: '口播' },
                    { type: 'storyboard' as ScriptType, icon: <LayoutIcon size={12} />, label: '分镜' },
                  ] as const).map(({ type, icon, label }) => (
                    <button key={type} onClick={() => setScriptType(type)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                        scriptType === type ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
                      }`}>
                      {icon}<span>{label}</span>
                    </button>
                  ))}
                </div>
                <div className="relative flex-1">
                  <button onClick={() => setShowLangDropdown(v => !v)}
                    className="w-full flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-xs text-text-secondary hover:border-border-bright transition-colors">
                    <Globe size={11} className="text-text-muted flex-shrink-0" />
                    <span className="flex-1 text-left">{selectedLang?.label}</span>
                    <ChevronDown size={11} className={`text-text-muted transition-transform ${showLangDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {showLangDropdown && (
                      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                        className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-border bg-surface z-10 overflow-hidden shadow-lg">
                        <div className="p-1 max-h-44 overflow-y-auto">
                          {LANGUAGES.map(lang => (
                            <button key={lang.code} onClick={() => { setLanguage(lang.code); setShowLangDropdown(false); }}
                              className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs hover:bg-surface-2 transition-colors">
                              <span className={language === lang.code ? 'text-accent font-semibold' : 'text-text-primary'}>{lang.label}</span>
                              {language === lang.code && <Check size={11} className="text-accent" />}
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <label className="flex items-start gap-2 text-xs text-text-secondary leading-relaxed cursor-pointer">
                <input type="checkbox" checked={voiceLanguageConfirmed} onChange={e => setVoiceLanguageConfirmed(e.target.checked)}
                  className="mt-0.5 accent-green-600" />
                <span>
                  确认口播台词以<span className="font-semibold text-accent"> {selectedLang?.label || '所选语言'} </span>输出
                </span>
              </label>
            </div>

            {/* Product selection */}
            <div className="px-4 py-3 border-b border-border flex-shrink-0 bg-surface-2/40">
              <div className="rounded-2xl border border-border bg-surface overflow-hidden transition-colors focus-within:border-border-bright">
                <div className="px-3 pt-3 pb-2 border-b border-border/70">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-text-primary truncate">产品选择：{getPrimaryProductLabel(productInfo)}</p>
                      <p className="text-[10px] text-text-muted">选择企业中心里的自己的产品信息</p>
                    </div>
                    <button onClick={() => setProductInfoOpen(v => !v)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors flex-shrink-0">
                      {productInfoOpen ? '收起' : '展开'}
                      <ChevronDown size={11} className={`transition-transform ${productInfoOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                  {productOptions.length > 0 && (
                    <select value={selectedProductId} onChange={e => handleSelectProduct(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-xs font-semibold text-text-primary outline-none focus:border-accent">
                      {productOptions.map(option => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  )}
                </div>
                <AnimatePresence initial={false}>
                  {productInfoOpen && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }} className="overflow-hidden">
                      <textarea value={productInfo} onChange={e => setProductInfo(e.target.value)}
                        placeholder="主推品信息：名称、核心功能、目标人群、价格区间..."
                        rows={4}
                        className="w-full px-4 py-3 bg-transparent text-sm text-text-primary placeholder:text-text-muted resize-none outline-none" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Script output */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold text-text-primary">脚本输出区</p>
                  <p className="text-[10px] text-text-muted mt-0.5">{scriptType === 'voiceover' ? '口播脚本' : '分镜脚本'} · {selectedLang?.label}</p>
                </div>
                <button
                  data-demo-target="traffic_script_generate"
                  onClick={() => void handleGenerate()}
                  disabled={generating || !voiceLanguageConfirmed}
                  title={voiceLanguageConfirmed ? '生成脚本' : '请先确认口播输出语言'}
                  className="h-8 px-3 rounded-xl flex items-center gap-1.5 text-xs font-semibold text-white transition-all disabled:opacity-50"
                  style={{ background: 'var(--color-accent)', boxShadow: '0 2px 8px rgba(22,163,74,0.2)' }}>
                  {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  生成脚本
                </button>
              </div>
              {!result && !generating && (
                <div className="flex flex-col items-center justify-center min-h-[260px] text-center gap-3 rounded-2xl border border-dashed border-border bg-surface-2/50">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-2 border border-border">
                    <Sparkles size={18} className="text-text-muted" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-text-primary">基于 "{video.title}" 的脚本结构</p>
                    <p className="text-xs text-text-muted mt-0.5">选择企业中心主推品，生成口播或分镜脚本</p>
                  </div>
                </div>
              )}
              {generating && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 bg-accent">
                    <Loader2 size={12} className="text-white animate-spin" />
                  </div>
                  <div className="rounded-2xl rounded-tl-sm bg-surface-2 border border-border px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {[0, 150, 300].map(d => <span key={d} className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                    </div>
                  </div>
                </div>
              )}
              {result && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: 'linear-gradient(135deg, #4ade80, #16a34a)' }}>
                    <Sparkles size={12} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="rounded-2xl rounded-tl-sm bg-surface-2 border border-border px-4 py-3">
                      <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-line font-mono">{result}</p>
                    </div>
                    <div className="flex items-center gap-4 mt-1.5 px-1">
                      <button onClick={handleCopy} className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors">
                        {copied ? <><Check size={11} className="text-green" /><span className="text-green">已复制</span></> : <><Copy size={11} /><span>复制</span></>}
                      </button>
                      <button className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors">
                        <ArrowRight size={11} /><span>保存到脚本库</span>
                      </button>
                    </div>

                    {getAnalysis(video) && (
                      <div className="mt-3 space-y-3">
                        {!videoResult ? (
                          <>
                            {seedanceVideoLocked ? (
                              <div className="rounded-2xl border border-border bg-surface overflow-hidden">
                                <div className="flex gap-3 p-3">
                                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-surface-2 border border-border">
                                    <Lock size={15} className="text-text-muted" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-semibold text-text-primary">Seedance 视频生成 · 接口待启用</p>
                                    <p className="mt-1 text-[11px] text-text-muted leading-relaxed">
                                      当前环境未启用 Seedance 真实生成。启用后会先生成并展示输出视频，确认效果后再进入剪辑流程。
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <button onClick={() => void generateSeedanceVideo()} disabled={videoGenerating}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white transition-all active:scale-95 disabled:opacity-70"
                                style={{ background: 'var(--color-accent)' }}>
                                {videoGenerating ? <Loader2 size={13} className="animate-spin" /> : <Film size={13} />}
                                {videoGenerating ? 'Seedance 生成视频中…' : '基于脚本用 Seedance 生成视频'}
                              </button>
                            )}
                            {videoError && (
                              <p className="text-[11px] text-red-500 leading-relaxed">{videoError}</p>
                            )}
                          </>
                        ) : (
                          <div className="rounded-2xl border border-border bg-surface overflow-hidden">
                            <div className="flex gap-3 p-3">
                              <div className="relative w-24 aspect-[9/16] flex-shrink-0 overflow-hidden rounded-xl bg-black">
                                {videoResult.url ? (
                                  <video src={videoResult.url} poster={videoResult.poster} controls playsInline className="absolute inset-0 h-full w-full object-cover" />
                                ) : (
                                  <img src={videoResult.poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
                                )}
                                <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-bold text-white">Seedance</span>
                              </div>
                              <div className="min-w-0 flex-1 py-0.5">
                                <p className="text-xs font-semibold text-text-primary line-clamp-2">Seedance 输出视频</p>
                                <p className="mt-1 text-[11px] text-text-muted">请先确认生成效果，再进入剪辑流程做字幕、封面、配乐和发布。</p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button onClick={() => void generateSeedanceVideo()} disabled={videoGenerating}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-[11px] font-semibold text-text-secondary hover:text-text-primary disabled:opacity-60">
                                    {videoGenerating ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} 重新生成
                                  </button>
                                  <button onClick={enterWorkflow}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white"
                                    style={{ background: 'var(--color-accent)' }}>
                                    <ArrowRight size={11} /> 进入剪辑流程
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Video Card (grid) ─────────────────────────────────────────────────────────
interface VideoCardProps {
  video: TrendVideo;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onWatch: () => void;
  onAnalyzeVideo?: () => void;
  onFavoriteMaterial?: () => void;
  analyzingVideo?: boolean;
  favoritingMaterial?: boolean;
}

function VideoCard({ video, index, isSelected, onSelect, onWatch, onAnalyzeVideo, onFavoriteMaterial, analyzingVideo, favoritingMaterial }: VideoCardProps) {
  const meta = getPlatformMeta(video.platform);
  const trendLabel = video.trend === 'hot' ? '🔥 热门' : video.trend === 'rising' ? '↑ 上升' : '— 平稳';
  const trendColor = video.trend === 'hot' ? 'text-amber' : video.trend === 'rising' ? 'text-green' : 'text-text-muted';
  const crawlRule = video.aiAnalysis?.crawlRule || '关键词检索';

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02, duration: 0.25 }}
      className={`card overflow-hidden group ${isSelected ? 'border-accent ring-1 ring-accent/20' : ''}`}>
      <div role="button" tabIndex={0} onClick={onWatch}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onWatch();
          }
        }}
        className="relative overflow-hidden w-full aspect-[9/16] text-left block"
        style={{ background: 'var(--color-surface-2)' }}>
        {video.thumbnail
          ? <img src={video.thumbnail} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
          : video.videoUrl
          ? <video src={`${video.videoUrl}#t=0.1`} muted playsInline loop preload="metadata" className="absolute inset-0 w-full h-full object-cover"
              onMouseEnter={e => { void e.currentTarget.play().catch(() => {}); }}
              onMouseLeave={e => { e.currentTarget.pause(); e.currentTarget.currentTime = 0.1; }} />
          : <VideoThumbnail platform={video.platform} title={video.title} />}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-neutral-900">
            <Play size={11} fill="currentColor" />{video.videoUrl ? '观看' : '原站'}
          </span>
          <button onClick={e => { e.stopPropagation(); if (needsVideoEnhancement(video)) onAnalyzeVideo?.(); onSelect(); }}
            disabled={analyzingVideo}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
            style={{ background: meta.bg, color: meta.color }}>
            {analyzingVideo ? <Loader2 size={11} className="animate-spin" /> : <BarChart2 size={11} />}分析脚本
          </button>
          {video.sourceUrl && (
            <button onClick={e => { e.stopPropagation(); onFavoriteMaterial?.(); }}
              disabled={favoritingMaterial}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white/90 text-neutral-900 disabled:opacity-70">
              {favoritingMaterial ? <Loader2 size={11} className="animate-spin" /> : <Bookmark size={11} />}收藏
            </button>
          )}
        </div>
        <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold text-white bg-black/50 backdrop-blur-sm">
          {Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, '0')}
        </div>
        <div className="absolute bottom-2 right-2 max-w-[60%] truncate px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white bg-black/55 backdrop-blur-sm">
          {crawlRule}
        </div>
        <div className="absolute top-2 left-2">
          <span className="platform-badge text-[10px]" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
        </div>
      </div>
      <div className="p-3">
        <p className="text-xs font-semibold text-text-primary leading-snug line-clamp-2 mb-2">{video.title}</p>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-[10px] font-mono font-bold ${trendColor}`}>{trendLabel}</span>
          <span className="flex items-center gap-1 text-[10px] text-text-muted"><Clock size={9} />{video.views} views</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {video.tags.slice(0, 2).map(tag => <span key={tag} className="tag text-[10px]">#{tag}</span>)}
        </div>
      </div>
    </motion.div>
  );
}

// ── Video List Item ───────────────────────────────────────────────────────────
function VideoListItem({ video, isSelected, onSelect, onWatch, onAnalyzeVideo, onFavoriteMaterial, analyzingVideo, favoritingMaterial }: {
  video: TrendVideo;
  isSelected: boolean;
  onSelect: () => void;
  onWatch: () => void;
  onAnalyzeVideo?: () => void;
  onFavoriteMaterial?: () => void;
  analyzingVideo?: boolean;
  favoritingMaterial?: boolean;
}) {
  const meta = getPlatformMeta(video.platform);
  const trendColor = video.trend === 'hot' ? 'text-amber' : video.trend === 'rising' ? 'text-green' : 'text-text-muted';
  const trendLabel = video.trend === 'hot' ? '热门' : video.trend === 'rising' ? '上升' : '平稳';
  const crawlRule = video.aiAnalysis?.crawlRule || '关键词检索';
  return (
    <div className={`flex items-center gap-4 px-4 py-3 cursor-pointer transition-all group ${isSelected ? 'bg-accent-glow' : 'hover:bg-surface-2'}`} onClick={onSelect}>
      <button type="button" onClick={e => { e.stopPropagation(); onWatch(); }}
        className="w-16 h-10 rounded-lg overflow-hidden flex-shrink-0 border border-border bg-surface-2 relative group/thumb">
        {video.thumbnail
          ? <img src={video.thumbnail} alt="" className="w-full h-full object-cover" draggable={false} />
          : <VideoThumbnail platform={video.platform} title={video.title} />}
        <span className="absolute inset-0 bg-black/35 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center text-white">
          <Play size={13} fill="currentColor" />
        </span>
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="platform-badge text-[9px]" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
          <span className={`text-[10px] font-semibold ${trendColor}`}>{trendLabel}</span>
        </div>
        <p className="text-sm text-text-primary font-medium truncate">{video.title}</p>
      </div>
      <div className="hidden lg:flex items-center gap-1 flex-shrink-0">
        {video.tags.slice(0, 2).map(tag => <span key={tag} className="tag text-[10px]">#{tag}</span>)}
      </div>
      <span className="hidden xl:inline-flex flex-shrink-0 px-2 py-1 rounded-md text-[10px] font-semibold bg-surface-2 border border-border text-text-muted">
        {crawlRule}
      </span>
      <div className="flex-shrink-0 text-right min-w-[52px]">
        <p className="text-xs font-mono text-text-secondary">{Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, '0')}</p>
        <p className="text-[10px] text-text-muted">{video.views}</p>
      </div>
      <button onClick={e => { e.stopPropagation(); if (needsVideoEnhancement(video)) onAnalyzeVideo?.(); onSelect(); }}
        disabled={analyzingVideo}
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all opacity-0 group-hover:opacity-100"
        style={{ color: 'var(--color-accent)', borderColor: 'rgba(22,163,74,0.25)', background: 'var(--color-accent-glow)' }}>
        {analyzingVideo ? <Loader2 size={11} className="animate-spin" /> : <BarChart2 size={11} />}<span>分析脚本</span>
      </button>
      {video.sourceUrl && (
        <button onClick={e => { e.stopPropagation(); onFavoriteMaterial?.(); }} disabled={favoritingMaterial}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-60">
          {favoritingMaterial ? <Loader2 size={11} className="animate-spin" /> : <Bookmark size={11} />} 收藏
        </button>
      )}
    </div>
  );
}

interface CrawlerRecord {
  id: string;
  platform?: Exclude<Platform, 'all'>;
  title?: string;
  thumbnailUrl?: string;
  duration?: number;
  sourceUrl?: string;
  tags?: string;
  aiAnalysis?: string;
  status?: 'pending' | 'analyzed' | 'failed';
  videoFileId?: string;
  crawledAt?: string;
}

function parseRecordTags(tags?: string): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags) as unknown;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function recordsToVideos(records: CrawlerRecord[]): TrendVideo[] {
  return records
    .filter((r): r is CrawlerRecord & { id: string; platform: Exclude<Platform, 'all'> } => Boolean(r.id && r.platform))
    .map(record => {
      let views = 'New';
      let analysis: VideoAnalysisPayload = {};
      try {
        analysis = JSON.parse(record.aiAnalysis || '{}') as VideoAnalysisPayload;
        if (analysis.views) views = analysis.views;
      } catch {}
      const trend: TrendVideo['trend'] = record.status === 'analyzed' ? 'hot' : record.status === 'failed' ? 'stable' : 'rising';
      const title = record.title || 'Untitled crawled video';
      const tags = parseRecordTags(record.tags);
      if (!analysis.gemini) {
        analysis = {
          ...analysis,
          gemini: metadataFallbackAnalysis(title, record.platform, tags, views, Number(record.duration || 0)),
          analysisSource: 'metadata-fallback',
          analysisQuality: 'metadata',
        };
      }
      return {
        id: `crawl-${record.id}`,
        recordId: record.id,
        platform: record.platform,
        title,
        thumbnail: record.thumbnailUrl || '',
        duration: Number(record.duration || 0),
        tags,
        views,
        trend,
        videoUrl: analysis.materialUrl || (record.videoFileId ? `/media/${record.videoFileId}` : undefined),
        sourceUrl: record.sourceUrl,
        status: record.status,
        aiAnalysis: analysis,
        crawledAt: record.crawledAt,
      };
    })
    .sort((a, b) => heatValue(b.views) - heatValue(a.views));
}

function metadataFallbackAnalysis(
  title: string,
  platform: Exclude<Platform, 'all'>,
  tags: string[],
  views: string,
  duration: number,
): GeminiVideoAnalysis {
  const topic = tags.length ? tags.slice(0, 3).join(' / ') : title;
  return {
    theme: `${PLATFORM_META[platform]?.label ?? platform} 基础分析：${title}`,
    hooks: [
      `用标题承诺切入：${title}`,
      views && views !== 'New' ? `用热度做社会证明：${views}` : '先展示结果或冲突，再解释产品',
      tags[0] ? `前三秒围绕 ${tags[0]} 放大场景痛点` : '前三秒突出产品效果或反差',
    ],
    sellingPoints: tags.length ? tags.map(tag => `可围绕 ${tag} 做卖点展开`) : ['产品演示', '痛点解决', '结果证明', '行动引导'],
    mood: platform === 'youtube' ? '信息型 / 评测型' : '快节奏 / 社媒感',
    structure: `标题/封面钩子 → 场景痛点 → ${topic} → 证明细节 → CTA`,
    recommendedScriptType: duration > 60 ? 'storyboard' : 'voiceover',
  };
}

const DEMO_TREND_VIDEO: TrendVideo = {
  id: 'demo-tiktok-skincare',
  platform: 'tiktok',
  title: '@_byjessevans dropping her routine for hydrated, healthy skin.',
  thumbnail: '',
  duration: 18,
  tags: ['skincare', 'hydratedskin', 'beautyroutine'],
  views: '1.2M',
  trend: 'hot',
  status: 'analyzed',
  crawledAt: new Date().toISOString(),
  aiAnalysis: {
    gemini: metadataFallbackAnalysis(
      '@_byjessevans dropping her routine for hydrated, healthy skin.',
      'tiktok',
      ['skincare', 'hydratedskin', 'beautyroutine'],
      '1.2M',
      18,
    ),
    analysisSource: 'demo-onboarding',
    analysisQuality: 'metadata',
    crawlRule: '新手演示素材',
  },
};

function heatValue(views: string): number {
  const raw = String(views || '').toLowerCase().replace(/,/g, '');
  const n = Number(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  if (raw.includes('亿') || raw.includes('b')) return n * 100000000;
  if (raw.includes('万')) return n * 10000;
  if (raw.includes('m') || raw.includes('百万')) return n * 1000000;
  if (raw.includes('k') || raw.includes('千')) return n * 1000;
  return n;
}

function timeValue(value?: string): number {
  const t = value ? new Date(value).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

function WatchModal({ video, onClose }: { video: TrendVideo; onClose: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center px-5 py-6"
      onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }}
        className="w-full max-w-4xl rounded-2xl overflow-hidden border border-border bg-surface shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">{PLATFORM_META[video.platform]?.label ?? video.platform} 预览</p>
            <h3 className="text-sm font-semibold text-text-primary truncate mt-0.5">{video.title}</h3>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {video.sourceUrl && (
              <button onClick={() => window.open(video.sourceUrl, '_blank', 'noopener,noreferrer')}
                className="px-3 py-1.5 rounded-lg border border-border bg-surface-2 text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors">
                原站打开
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors">
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="bg-black">
          {video.videoUrl ? (
            <video src={video.videoUrl} controls autoPlay playsInline className="w-full max-h-[72vh] bg-black" />
          ) : (
            <div className="aspect-video flex flex-col items-center justify-center gap-3 text-white/70">
              <Play size={28} />
              <p className="text-sm">当前仅支持跳转原视频；分析用临时视频不会进入素材库</p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
interface InspirationDashboardProps {
  onScriptPanelOpen?: () => void;
  onScriptPanelClose?: () => void;
  onNavigate?: (p: Page) => void;
  onEnterWorkflow?: (payload: { script: string; video: TrendVideo; scriptType: ScriptType; language: string; productInfo: string; generatedVideo?: GeneratedVideo }) => void;
}

export default function InspirationDashboard({ onScriptPanelOpen, onScriptPanelClose, onNavigate, onEnterWorkflow }: InspirationDashboardProps) {
  const [platform, setPlatform] = useState<Platform>('all');
  const [search, setSearch] = useState('');
  const [selectedVideo, setSelectedVideo] = useState<TrendVideo | null>(null);
  const [watchVideo, setWatchVideo] = useState<TrendVideo | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortMode, setSortMode] = useState<SortMode>('crawlTime');
  const [crawledVideos, setCrawledVideos] = useState<TrendVideo[]>([]);
  const [lastCrawlVideoIds, setLastCrawlVideoIds] = useState<string[]>([]);
  const [analyzingVideoIds, setAnalyzingVideoIds] = useState<string[]>([]);
  const [favoritingMaterialIds, setFavoritingMaterialIds] = useState<string[]>([]);
  const [materialMessage, setMaterialMessage] = useState('');
  const platformLabel = PLATFORM_FILTERS.find(f => f.id === platform)?.label ?? '全部平台';
  const sortLabel = sortMode === 'crawlTime' ? '按爬取时间' : '按热度';

  useEffect(() => {
    if (selectedVideo) { onScriptPanelOpen?.(); }
    else { onScriptPanelClose?.(); }
  }, [selectedVideo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up on unmount
  useEffect(() => () => { onScriptPanelClose?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshVideos = async () => {
    try {
      const allRecords: CrawlerRecord[] = [];
      const perPage = 100;
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const r = await fetch(`/api/overseas/videos?page=${page}&perPage=${perPage}`, { headers: authHeader() });
        const data = await r.json().catch(() => ({})) as {
          items?: CrawlerRecord[];
          page?: number;
          totalPages?: number;
        };
        if (!r.ok) throw new Error('视频列表加载失败');
        const items = data.items || [];
        allRecords.push(...items);
        totalPages = Number(data.totalPages || (items.length < perPage ? page : page + 1));
        if (items.length === 0) break;
        page += 1;
      }
      setCrawledVideos(recordsToVideos(allRecords));
    } catch {
      setCrawledVideos([]);
    }
  };

  useEffect(() => { void refreshVideos(); }, []);

  useEffect(() => {
    const hasPending = crawledVideos.some(v =>
      v.status === 'pending' ||
      v.aiAnalysis?.downloadStatus === 'queued' ||
      v.aiAnalysis?.downloadStatus === 'downloading' ||
      v.aiAnalysis?.downloadStatus === 'analyzing' ||
      v.aiAnalysis?.downloadStatus === 'ops_queued'
    );
    if (!hasPending) return;
    const timer = window.setInterval(() => { void refreshVideos(); }, 3500);
    return () => window.clearInterval(timer);
  }, [crawledVideos]);

  useEffect(() => {
    if (!selectedVideo) return;
    const latest = crawledVideos.find(v => v.id === selectedVideo.id);
    if (latest && latest !== selectedVideo) setSelectedVideo(latest);
  }, [crawledVideos, selectedVideo]);

  const demoTrafficStep = isDemoTrafficStep();
  const allVideos = demoTrafficStep && crawledVideos.length === 0 ? [DEMO_TREND_VIDEO] : crawledVideos;
  const filtered = useMemo(() => {
    const lastCrawlIds = new Set(lastCrawlVideoIds);
    const q = search.trim().toLowerCase();
    return allVideos
      .filter(v =>
        (lastCrawlIds.size === 0 || lastCrawlIds.has(v.id)) &&
        (platform === 'all' || v.platform === platform) &&
        (!q || v.title.toLowerCase().includes(q) || v.tags.some(t => t.toLowerCase().includes(q)))
      )
      .sort((a, b) => {
        if (sortMode === 'crawlTime') {
          return timeValue(b.crawledAt) - timeValue(a.crawledAt) || heatValue(b.views) - heatValue(a.views);
        }
        return heatValue(b.views) - heatValue(a.views) || timeValue(b.crawledAt) - timeValue(a.crawledAt);
      });
  }, [allVideos, lastCrawlVideoIds, platform, search, sortMode]);

  useEffect(() => {
    if (!demoTrafficStep || selectedVideo || !filtered[0]) return;
    setSelectedVideo(filtered[0]);
  }, [demoTrafficStep, filtered, selectedVideo]);

  const recentThreeDayUploads = allVideos.filter(v => {
    const t = v.crawledAt ? new Date(v.crawledAt).getTime() : 0;
    return t > 0 && Date.now() - t <= 3 * 24 * 60 * 60 * 1000;
  }).length;

  const handlePlatformFilter = (nextPlatform: Platform) => {
    const lockedMessage = LOCKED_PLATFORM_MESSAGES[nextPlatform];
    if (lockedMessage) {
      setMaterialMessage(lockedMessage);
      setTimeout(() => setMaterialMessage(''), 3000);
      return;
    }
    setLastCrawlVideoIds([]);
    setPlatform(nextPlatform);
  };

  const handleWatch = (video: TrendVideo) => {
    if (video.videoUrl) {
      setWatchVideo(video);
      return;
    }
    if (video.sourceUrl) {
      window.open(video.sourceUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    setWatchVideo(video);
  };

  const analyzeVideoOnly = async (video: TrendVideo, quiet = false) => {
    if (!video.sourceUrl || analyzingVideoIds.includes(video.id)) return;
    setAnalyzingVideoIds(ids => [...ids, video.id]);
    if (!quiet) setMaterialMessage('');
    try {
      const r = await fetch('/api/overseas/videos/analyze-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          id: video.recordId,
          sourceUrl: video.sourceUrl,
          title: video.title,
          platform: video.platform,
          async: true,
        }),
      });
      const data = await r.json().catch(() => ({})) as {
        error?: string;
        analysis?: GeminiVideoAnalysis;
      };
      if (!r.ok) throw new Error(data.error || '视频分析失败');
      if (r.status === 202) {
        setMaterialMessage(`已加入视频获取队列，获取成功后自动进入 Gemini 分析：${video.title}`);
        setTimeout(() => setMaterialMessage(''), 3500);
        void refreshVideos();
        return;
      }
      const updated: TrendVideo = {
        ...video,
        status: 'analyzed',
        aiAnalysis: {
          ...(video.aiAnalysis || {}),
          gemini: data.analysis,
          analysisSource: 'gemini-temp-video',
          downloadStatus: 'analyzed',
          analyzedAt: new Date().toISOString(),
        },
      };
      setCrawledVideos(prev => prev.map(v => v.id === video.id ? updated : v));
      setSelectedVideo(v => v?.id === video.id ? updated : v);
      setWatchVideo(v => v?.id === video.id ? updated : v);
      setMaterialMessage(`Gemini 分析完成：${video.title}`);
      setTimeout(() => setMaterialMessage(''), 3500);
    } catch (e) {
      if (!quiet) setMaterialMessage(e instanceof Error ? e.message : '视频分析失败');
    } finally {
      setAnalyzingVideoIds(ids => ids.filter(id => id !== video.id));
    }
  };

  const favoriteMaterial = async (video: TrendVideo, quiet = false) => {
    if (!video.sourceUrl || favoritingMaterialIds.includes(video.id)) return;
    setFavoritingMaterialIds(ids => [...ids, video.id]);
    if (!quiet) setMaterialMessage('');
    try {
      const r = await fetch('/api/overseas/videos/download-material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          id: video.recordId,
          sourceUrl: video.sourceUrl,
          title: video.title,
          platform: video.platform,
          async: true,
        }),
      });
      const data = await r.json().catch(() => ({})) as {
        error?: string;
        material?: { name?: string; url?: string; poster?: string; duration?: number };
      };
      if (!r.ok) throw new Error(data.error || '收藏失败');
      if (r.status === 202) {
        setMaterialMessage(`已加入爆款素材收藏队列：${video.title}`);
        setTimeout(() => setMaterialMessage(''), 3500);
        void refreshVideos();
        return;
      }
      const updated: TrendVideo = {
        ...video,
        videoUrl: data.material?.url || video.videoUrl,
        thumbnail: data.material?.poster || video.thumbnail,
        duration: data.material?.duration || video.duration,
      };
      setCrawledVideos(prev => prev.map(v => v.id === video.id ? updated : v));
      setSelectedVideo(v => v?.id === video.id ? updated : v);
      setWatchVideo(v => v?.id === video.id ? updated : v);
      setMaterialMessage(`已收藏到爆款素材：${data.material?.name || video.title}`);
      setTimeout(() => setMaterialMessage(''), 3500);
    } catch (e) {
      if (!quiet) setMaterialMessage(e instanceof Error ? e.message : '收藏失败');
    } finally {
      setFavoritingMaterialIds(ids => ids.filter(id => id !== video.id));
    }
  };

  const retryVideoPipeline = async (video: TrendVideo) => {
    if (video.recordId) {
      setMaterialMessage(`已重新提交 Gemini 分析：${video.title}`);
      try {
        const r = await fetch(`/api/overseas/videos/${video.recordId}/reanalyze`, {
          method: 'PATCH',
          headers: authHeader(),
        });
        const data = await r.json().catch(() => ({})) as { error?: string };
        if (!r.ok) throw new Error(data.error || '重新分析失败');
        void refreshVideos();
      } catch (e) {
        setMaterialMessage(e instanceof Error ? e.message : '重新分析失败');
      }
      setTimeout(() => setMaterialMessage(''), 3500);
      return;
    }
    await analyzeVideoOnly(video);
  };

  return (
    <div className="relative">
      <div className="transition-all duration-300">
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-text-primary font-display">灵感大屏</h2>
              <p className="text-sm text-text-muted mt-0.5">追踪全球社媒爆款，AI 脚本分析 + 一键生成口播 / 分镜</p>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted">
              <div className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
              <span>{materialMessage || `今日已推送 ${allVideos.length} 条`}</span>
            </div>
          </div>
          <div className="space-y-2.5">
            <div className="relative min-w-0">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input type="text" value={search} onChange={e => { setLastCrawlVideoIds([]); setSearch(e.target.value); }}
                placeholder="搜索视频标题或标签..."
                className="h-11 w-full pl-9 pr-4 rounded-xl border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              <div className="h-11 rounded-xl border border-border bg-surface px-2 flex items-center gap-1.5 overflow-hidden">
                <Globe size={14} className="text-text-muted flex-shrink-0" />
                <span className="text-sm text-text-muted flex-shrink-0">社媒平台</span>
                <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
                  {PLATFORM_FILTERS.map(f => {
                    const locked = f.id === 'facebook' || f.id === 'instagram';
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => handlePlatformFilter(f.id)}
                        className={`h-7 px-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                          platform === f.id
                            ? 'bg-accent text-white'
                            : locked
                              ? 'bg-surface-2 text-text-muted hover:text-text-primary'
                              : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
                        }`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
                <span className="sr-only">{platformLabel}</span>
              </div>
              <div className="relative h-11">
                {sortMode === 'heat'
                  ? <Flame size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                  : <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />}
                <span className="absolute left-9 top-1/2 -translate-y-1/2 text-sm text-text-muted pointer-events-none">排序方法</span>
                <select value={sortMode} onChange={e => { setLastCrawlVideoIds([]); setSortMode(e.target.value as SortMode); }}
                  aria-label="排序方法"
                  className="h-11 w-full appearance-none rounded-xl border border-border bg-surface pl-[6.5rem] pr-9 text-sm font-semibold text-text-primary outline-none transition-colors hover:border-border-bright focus:border-accent">
                  <option value="crawlTime">按爬取时间</option>
                  <option value="heat">按热度</option>
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                <span className="sr-only">{sortLabel}</span>
              </div>
              <div className="relative h-11">
                {viewMode === 'grid'
                  ? <LayoutGrid size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                  : <List size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />}
                <span className="absolute left-9 top-1/2 -translate-y-1/2 text-sm text-text-muted pointer-events-none">大屏视图</span>
                <select value={viewMode} onChange={e => setViewMode(e.target.value as 'grid' | 'list')}
                  aria-label="大屏视图"
                  className="h-11 w-full appearance-none rounded-xl border border-border bg-surface pl-[6.5rem] pr-9 text-sm font-semibold text-text-primary outline-none transition-colors hover:border-border-bright focus:border-accent">
                  <option value="grid">卡片视图</option>
                  <option value="list">列表视图</option>
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 mb-4 grid grid-cols-3 gap-3 max-w-xl">
          {[
            { icon: <Zap size={13} />,       label: '热门视频', value: `${allVideos.length}`,    color: 'text-amber' },
            { icon: <TrendingUp size={13} />, label: '上升趋势', value: `${recentThreeDayUploads}`, color: 'text-green' },
            { icon: <Globe size={13} />,      label: '覆盖平台', value: `${new Set(allVideos.map(v => v.platform)).size}`,       color: 'text-accent' },
          ].map(stat => (
            <div key={stat.label} className="card p-3 flex items-center gap-2.5">
              <span className={stat.color}>{stat.icon}</span>
              <div>
                <p className="text-base font-bold text-text-primary font-display leading-none">{stat.value}</p>
                <p className="text-[10px] text-text-muted mt-0.5">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 pb-6">
          {filtered.length === 0 ? (
            <div className="min-h-72 rounded-xl border border-dashed border-border bg-surface flex flex-col items-center justify-center gap-3 text-center px-6">
              <div className="w-11 h-11 rounded-xl bg-surface-2 border border-border flex items-center justify-center text-text-muted">
                <Download size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">暂无真实视频数据</p>
                <p className="text-xs text-text-muted mt-1">测试版请通过「定时任务」在北京时间 01:00 自动采集公开视频。</p>
              </div>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="columns-2 lg:columns-3 xl:columns-4 gap-4">
              {filtered.map((video, i) => (
                <div key={video.id} className="break-inside-avoid mb-4">
                  <VideoCard video={video} index={i} isSelected={selectedVideo?.id === video.id}
                    onSelect={() => setSelectedVideo(selectedVideo?.id === video.id ? null : video)}
                    onWatch={() => handleWatch(video)}
                    onAnalyzeVideo={() => void analyzeVideoOnly(video)}
                    onFavoriteMaterial={() => void favoriteMaterial(video)}
                    analyzingVideo={analyzingVideoIds.includes(video.id)}
                    favoritingMaterial={favoritingMaterialIds.includes(video.id)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="card overflow-hidden divide-y divide-border">
              {filtered.map(video => (
                <VideoListItem key={video.id} video={video} isSelected={selectedVideo?.id === video.id}
                  onSelect={() => setSelectedVideo(selectedVideo?.id === video.id ? null : video)}
                  onWatch={() => handleWatch(video)}
                  onAnalyzeVideo={() => void analyzeVideoOnly(video)}
                  onFavoriteMaterial={() => void favoriteMaterial(video)}
                  analyzingVideo={analyzingVideoIds.includes(video.id)}
                  favoritingMaterial={favoritingMaterialIds.includes(video.id)} />
              ))}
            </div>
          )}
          {filtered.length === 0 && (
            <div className="text-center py-20">
              <Search size={28} className="mx-auto text-text-muted mb-3 opacity-30" />
              <p className="text-text-muted text-sm">没有找到相关视频</p>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {selectedVideo && (
          <ScriptPanel
            key={selectedVideo.id}
            video={selectedVideo}
            onClose={() => setSelectedVideo(null)}
            onRetry={() => void retryVideoPipeline(selectedVideo)}
            onFavorite={() => void favoriteMaterial(selectedVideo)}
            favoriting={favoritingMaterialIds.includes(selectedVideo.id)}
            onNavigate={onNavigate}
            onEnterWorkflow={onEnterWorkflow}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {watchVideo && <WatchModal key={watchVideo.id} video={watchVideo} onClose={() => setWatchVideo(null)} />}
      </AnimatePresence>
    </div>
  );
}
