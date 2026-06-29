import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Play, Sparkles, FileText, Layout as LayoutIcon,
  TrendingUp, Clock, Globe, ChevronDown, X, Loader2,
  Check, Copy, ArrowRight, Zap, LayoutGrid, List, ArrowUp,
  Lightbulb, Flame, BarChart2, ChevronRight, Film, Download, Plus,
  SlidersHorizontal, Bookmark,
} from 'lucide-react';
import { studioApi } from '../lib/studioApi';
import { authHeader } from '../lib/auth';

// ── Types ─────────────────────────────────────────────────────────────────────
type Platform = 'all' | 'tiktok' | 'instagram' | 'youtube' | 'facebook';
type ScriptType = 'voiceover' | 'storyboard';
type SortMode = 'heat' | 'crawlTime';

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

const PLATFORM_FILTERS: { id: Platform; label: string }[] = [
  { id: 'all',       label: '全部平台' },
  { id: 'tiktok',    label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'youtube',   label: 'YouTube' },
  { id: 'facebook',  label: 'Facebook' },
];

type CrawlPlatform = 'youtube' | 'tiktok' | 'facebook' | 'instagram';

const AUTO_CRAWL_PLATFORMS: { id: CrawlPlatform; label: string; enabled: boolean }[] = [
  { id: 'youtube', label: 'YouTube', enabled: true },
  { id: 'tiktok', label: 'TK', enabled: true },
  { id: 'facebook', label: 'FB', enabled: true },
  { id: 'instagram', label: 'IG', enabled: true },
];

const LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'zh', label: '中文' },
  { code: 'es', label: 'Español' }, { code: 'ar', label: 'العربية' },
  { code: 'fr', label: 'Français' }, { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' }, { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },   { code: 'ko', label: '한국어' },
];

function getAnalysis(video: TrendVideo): ScriptAnalysis | null {
  const gemini = video.aiAnalysis?.gemini;
  if (!gemini) return null;
  const hooks = Array.isArray(gemini.hooks) ? gemini.hooks.filter(Boolean) : [];
  const sellingPoints = Array.isArray(gemini.sellingPoints) ? gemini.sellingPoints.filter(Boolean) : [];
  const isMetadataFallback = video.aiAnalysis?.analysisSource === 'metadata-fallback' || video.aiAnalysis?.analysisQuality === 'metadata';
  const structure = buildCoarseStructure(gemini, video);
  return {
    videoType: isMetadataFallback ? '基础资料拆解' : gemini.recommendedScriptType === 'storyboard' ? '分镜评测型' : '口播转化型',
    structure,
    firstTenSeconds: buildFirstTenSecondInsights(gemini, video, hooks, sellingPoints),
    scriptSummary15s: buildScriptSummary15s(gemini, video, sellingPoints),
    scriptDetails15s: buildScriptDetails15s(gemini, video, structure),
    referenceHighlights: [
      gemini.theme ? `主题：${gemini.theme}` : '',
      gemini.mood ? `情绪：${gemini.mood}` : '',
      ...hooks.slice(0, 2).map(point => `注意力入口：${point}`),
      ...sellingPoints.slice(0, 4).map(point => `可复用爆点：${point}`),
    ].filter(Boolean),
    adaptTip: structure.length
      ? `生成脚本时优先复用「${structure.slice(0, 3).map(step => step.desc).join(' → ')}」的节奏，并把产品卖点放进同一信息密度。`
      : 'Gemini 尚未返回可复用结构',
    emotion: gemini.mood || (isMetadataFallback ? '基础分析' : '真实分析'),
    infoSpeed: video.duration > 90 ? '中密度' : '高密度',
  };
}

function buildScriptSummary15s(gemini: GeminiVideoAnalysis, video: TrendVideo, sellingPoints: string[]): ScriptSummary15s {
  const summary = gemini.scriptSummary15s || {};
  const competitors = Array.isArray(summary.competitors)
    ? summary.competitors.map(String).filter(Boolean)
    : sellingPoints.filter(point => /brand|品牌|竞品|vs|对比/i.test(point)).slice(0, 3);
  return {
    visualStyle: summary.visualStyle || (video.platform === 'youtube' ? '真人写实评测风格' : '真人社媒写实风格'),
    coreEmotion: summary.coreEmotion || gemini.mood || '好奇、信任、种草',
    competitors,
  };
}

function buildScriptDetails15s(gemini: GeminiVideoAnalysis, video: TrendVideo, structure: StructureStep[]): ScriptDetail15s[] {
  const details = Array.isArray(gemini.scriptDetails15s) ? gemini.scriptDetails15s : [];
  const normalized = details.map((item, index) => {
    const visual = String(item.visual || '').trim();
    const subtitle = String(item.subtitle || '').trim();
    if (!visual && !subtitle) return null;
    return {
      time: String(item.time || item.timestamp || `${Math.max(0.2, index * 1.5).toFixed(1)}s`),
      shot: String(item.shot || '中近景'),
      camera: String(item.camera || '固定镜头'),
      visual: visual || `画面承接「${video.title}」的核心信息。`,
      subtitle: subtitle || '字幕待 Gemini 从真实视频中补全',
      audio: String(item.audio || 'BGM/配音待 Gemini 从真实视频中补全'),
      note: item.note ? String(item.note) : undefined,
    };
  }).filter(Boolean) as ScriptDetail15s[];
  if (normalized.length) return normalized.slice(0, 12);

  const source = structure.length ? structure : splitStructure(video.title, Math.min(video.duration, 15));
  return source.slice(0, 5).map((step, index) => ({
    time: index === 0 ? '0.2s' : `${(index * 3).toFixed(1)}s-${Math.min(index * 3 + 3, 15).toFixed(1)}s`,
    shot: index === 0 ? '特写' : '中近景',
    camera: index === 0 ? '固定镜头' : '轻微推近',
    visual: `基础资料推断：画面围绕「${step.desc}」展开，真实视频分析完成后会回填人物、产品、动作和场景细节。`,
    subtitle: `字幕/口播围绕「${video.title}」强化当前信息点。`,
    audio: video.platform === 'youtube' ? '配音解释为主，背景音乐轻量铺底。' : '社媒节奏 BGM，配合字幕快速推进。',
  }));
}

function buildCoarseStructure(gemini: GeminiVideoAnalysis, video: TrendVideo): StructureStep[] {
  const frames = Array.isArray(gemini.coarseStructure) ? gemini.coarseStructure : [];
  const normalized = frames.map((frame, index) => {
    const desc = String(frame.description || frame.desc || frame.frame || '').trim();
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
  const fallbackTheme = gemini.theme || video.title;
  const fallbackMood = gemini.mood || '待 Gemini 识别';
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
  return values.map(item => ({ ...item, detail: item.detail.trim() })).filter(item => item.detail);
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

function makeVoiceoverDraft(video: TrendVideo, analysis: ScriptAnalysis, productInfo: string, languageLabel?: string): string {
  const productLabel = getPrimaryProductLabel(productInfo);
  const fiveDim = analysis.firstTenSeconds.map(item => `${item.dimension}：${item.detail}`).join('\n');
  const structure = analysis.structure.map(step => `${step.time} ${step.label}：${step.desc}`).join('\n');
  const highlights = analysis.referenceHighlights.slice(0, 5).join('；') || video.title;
  return `**口播脚本｜${productLabel}｜${languageLabel || '中文'}**

**对标视频爆点**
${highlights}

**前 10 秒复用方向**
${fiveDim}

**口播正文**
0-3s：直接抛出用户最关心的结果，把「${productLabel}」和对标视频的高注意力入口绑定。
3-6s：用一个真实使用场景解释产品为什么值得看，避免空泛形容。
6-10s：放大核心差异点，用画面或数据证明它解决了什么问题。
10-20s：展开 2-3 个关键卖点，顺序参考对标视频结构。
20-30s：补充适用人群、使用方式或购买理由，给出明确行动引导。

**结构参考**
${structure}

**产品信息**
${summarizeProductInfo(productInfo)}`;
}

function makeStoryboardDraft(video: TrendVideo, analysis: ScriptAnalysis, productInfo: string, languageLabel?: string): string {
  const productLabel = getPrimaryProductLabel(productInfo);
  const productSummary = summarizeProductInfo(productInfo);
  const frames = analysis.structure.map((step, index) =>
    `**分镜 ${index + 1}｜${step.time}**
画面：围绕「${productLabel}」复刻对标视频的「${step.desc}」信息点
运镜：保持粗略 3 秒一帧，优先近景/手部/结果对比，避免过密切镜
口播/字幕：用一句话说清这个画面带来的用户收益
参考爆点：${analysis.firstTenSeconds[index % analysis.firstTenSeconds.length]?.dimension || '节奏'} - ${analysis.firstTenSeconds[index % analysis.firstTenSeconds.length]?.detail || video.title}`
  ).join('\n\n');
  return `**分镜脚本｜${productLabel}｜${languageLabel || '中文'}**

**主推品信息**
${productSummary}

**对标视频核心复用**
${analysis.referenceHighlights.slice(0, 5).join('；') || video.title}

${frames}`;
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
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function pipelineState(video: TrendVideo): { title: string; desc: string; spinning: boolean; failed: boolean } {
  const analysis = video.aiAnalysis || {};
  if (analysis.downloadStatus === 'ops_queued') {
    return { title: '后台增强分析中', desc: '已先生成基础分析；真实视频获取失败后已自动进入开发团队爬虫队列，成功后会升级为视频级分析。', spinning: true, failed: false };
  }
  if (analysis.gemini) {
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
  if (analysis.analysisQuality === 'video' || analysis.analysisSource === 'gemini-temp-video' && analysis.downloadStatus === 'analyzed') {
    return { title: '真实视频分析完成', desc: '已升级为视频级 Gemini 分析。', active: false };
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
  if (analysis.downloadStatus === 'ops_queued' || analysis.videoFetchStatus === 'ops_queued') {
    return { title: '总控爬虫增强中', desc: '自动获取失败，已进入开发团队总控爬虫队列，回填后会升级。', active: true };
  }
  return { title: '基础分析可用', desc: '当前结果基于标题、标签、平台、热度和时长推断。', active: false };
}

// ── Fallback thumbnail ────────────────────────────────────────────────────────
function VideoThumbnail({ platform, title }: { platform: Exclude<Platform, 'all'>; title: string }) {
  const meta = PLATFORM_META[platform];
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

        {/* 脚本结构 */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <LayoutIcon size={11} style={{ color: '#0891b2' }} />
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">脚本结构拆解</p>
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
                <p className="text-[11px] text-text-secondary leading-snug">{item.detail}</p>
              </div>
            ))}
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
  onEnterWorkflow?: (payload: { script: string; video: TrendVideo; scriptType: ScriptType; language: string; productInfo: string }) => void;
}

function ScriptPanel({ video, onClose, onRetry, onFavorite, favoriting, onEnterWorkflow }: ScriptPanelProps) {
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

  useEffect(() => {
    let cancelled = false;
    fetch('/api/overseas/enterprise/profile', { headers: authHeader() })
      .then(r => r.ok ? r.json() : null)
      .then((profile: EnterpriseProfileForScript | null) => {
        if (cancelled || !profile) return;
        const options = buildProductOptions(profile);
        setProductOptions(options);
        if (options[0]) {
          setSelectedProductId(current => current || options[0]!.id);
          setProductInfo(current => current.trim() ? current : options[0]!.info);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleSelectProduct = (id: string) => {
    setSelectedProductId(id);
    const option = productOptions.find(item => item.id === id);
    if (option) setProductInfo(option.info);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setResult(null);
    await new Promise(r => setTimeout(r, 1800));
    const realAnalysis = getAnalysis(video);
    if (!realAnalysis) {
      setResult('该视频还没有完成 Gemini 真实分析。请先等待后台下载和分析完成，再生成脚本。');
      setGenerating(false);
      return;
    }
    const languageLabel = LANGUAGES.find(l => l.code === language)?.label;
    setResult(scriptType === 'voiceover'
      ? makeVoiceoverDraft(video, realAnalysis, productInfo, languageLabel)
      : makeStoryboardDraft(video, realAnalysis, productInfo, languageLabel)
    );
    setGenerating(false);
  };

  const handleCopy = () => {
    if (result) { void navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const enterWorkflow = () => {
    if (!result) return;
    onEnterWorkflow?.({ script: result, video, scriptType, language, productInfo });
  };

  const selectedLang = LANGUAGES.find(l => l.code === language);

  return (
    <motion.div
      initial={{ opacity: 0, x: 32 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 32 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed top-0 h-full w-[420px] flex flex-col border-l border-border z-50 bg-surface"
      style={{ right: 0 }}>

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

            {/* Script type + language */}
            <div className="px-4 py-3 border-b border-border flex-shrink-0 flex items-center gap-2">
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

            {/* Chat area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {!result && !generating && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-3">
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
                      <div className="mt-3">
                        <button onClick={enterWorkflow}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white transition-all active:scale-95"
                          style={{ background: 'var(--color-accent)' }}>
                          <Film size={13} /> 基于脚本用 Seedance 2.0 生成视频，进入 AI 生成 7 步工作流
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </div>

            {/* Input */}
            <div className="p-4 border-t border-border flex-shrink-0">
              <div className="rounded-2xl border border-border bg-surface-2 overflow-hidden transition-colors focus-within:border-border-bright">
                {productOptions.length > 0 && (
                  <div className="px-3 pt-3 pb-2 border-b border-border/70">
                    <select value={selectedProductId} onChange={e => handleSelectProduct(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-xs font-semibold text-text-primary outline-none focus:border-accent">
                      {productOptions.map(option => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                <textarea value={productInfo} onChange={e => setProductInfo(e.target.value)}
                  placeholder="主推品信息：名称、核心功能、目标人群、价格区间..."
                  rows={4}
                  className="w-full px-4 pt-3 pb-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted resize-none outline-none" />
                <div className="flex items-center justify-between px-3 pb-3 pt-1">
                  <p className="text-[11px] text-text-muted">{scriptType === 'voiceover' ? '口播脚本' : '分镜脚本'} · {selectedLang?.label}</p>
                  <button onClick={() => void handleGenerate()} disabled={generating}
                    className="w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-50"
                    style={{ background: 'var(--color-accent)', boxShadow: '0 2px 8px rgba(22,163,74,0.2)' }}>
                    {generating ? <Loader2 size={13} className="text-white animate-spin" /> : <ArrowUp size={13} className="text-white" />}
                  </button>
                </div>
              </div>
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
  const meta = PLATFORM_META[video.platform];
  const trendLabel = video.trend === 'hot' ? '🔥 热门' : video.trend === 'rising' ? '↑ 上升' : '— 平稳';
  const trendColor = video.trend === 'hot' ? 'text-amber' : video.trend === 'rising' ? 'text-green' : 'text-text-muted';
  const crawlRule = video.aiAnalysis?.crawlRule || '关键词检索';

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02, duration: 0.25 }}
      className={`card overflow-hidden group ${isSelected ? 'border-accent ring-1 ring-accent/20' : ''}`}>
      <button type="button" onClick={onWatch}
        className="relative overflow-hidden w-full text-left block"
        style={{ background: 'var(--color-surface-2)' }}>
        {video.videoUrl
          ? <video src={`${video.videoUrl}#t=0.1`} muted playsInline loop preload="metadata" className="w-full aspect-[9/16] object-cover block"
              onMouseEnter={e => { void e.currentTarget.play().catch(() => {}); }}
              onMouseLeave={e => { e.currentTarget.pause(); e.currentTarget.currentTime = 0.1; }} />
          : video.thumbnail
          ? <img src={video.thumbnail} alt="" className="w-full h-auto block" draggable={false} />
          : <div className="aspect-video"><VideoThumbnail platform={video.platform} title={video.title} /></div>}
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
      </button>
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
  const meta = PLATFORM_META[video.platform];
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
    theme: `${PLATFORM_META[platform].label} 基础分析：${title}`,
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
            <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">{PLATFORM_META[video.platform].label} 预览</p>
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

function AutoCrawlerPanel({ onImported }: { onImported: (videos: TrendVideo[], autoAnalyze: boolean, keyword: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [crawlPlatform, setCrawlPlatform] = useState<CrawlPlatform>('youtube');
  const [keyword, setKeyword] = useState('amazon gadgets product review');
  const [limit, setLimit] = useState(12);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [running, setRunning] = useState(false);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [message, setMessage] = useState('测试版开放关键词检索；画像匹配与对标账号采集待解锁');
  const [lastImported, setLastImported] = useState(0);
  const platformLabel = AUTO_CRAWL_PLATFORMS.find(p => p.id === crawlPlatform)?.label || 'YouTube';
  const keywordInputLabel = '关键词';
  const keywordPlaceholder = '产品词 / 竞品词 / 场景词；也可粘贴公开视频链接';

  const startCrawl = async () => {
    setRunning(true);
    setMessage('正在启动后台采集任务...');
    setLastImported(0);
    try {
      const r = await fetch('/api/overseas/videos/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ platform: crawlPlatform, keyword, limit, dateFrom, dateTo, rule: 'keyword' }),
      });
      const data = await r.json().catch(() => ({})) as {
        error?: string;
        message?: string;
        imported?: number;
        refreshed?: number;
        skipped?: number;
        total?: number;
        items?: CrawlerRecord[];
      };
      if (!r.ok) throw new Error(data.message || data.error || '自动采集失败');

      const importedVideos = recordsToVideos(data.items || []);
      onImported(importedVideos, autoAnalyze, keyword.trim());
      setLastImported(importedVideos.length);
      setMessage(data.message || `采集完成：返回 ${importedVideos.length} 条，新增 ${data.imported || 0} 条，刷新 ${data.refreshed || 0} 条`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '自动采集失败');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mx-6 mb-4 rounded-xl border border-border bg-surface overflow-hidden">
      <div className={`flex items-center justify-between gap-3 px-4 py-3 ${expanded ? 'border-b border-border' : ''}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Download size={14} className="text-accent" />
            <h3 className="text-sm font-bold text-text-primary">社媒自动采集任务</h3>
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono text-green bg-green/10 border border-green/20">Auto</span>
          </div>
          <p className="text-xs text-text-muted mt-1 truncate">
            {expanded ? message : `关键词：${keyword || '未填写'} · ${platformLabel} · ${dateFrom} 至 ${dateTo} · ${limit} 条`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 text-right">
          {lastImported > 0 && <span className="text-xs font-semibold text-green">返回 {lastImported} 条</span>}
          <button onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-surface-2 text-text-secondary hover:text-text-primary hover:border-border-bright transition-all">
            <SlidersHorizontal size={12} />
            {expanded ? '收起配置' : '展开配置'}
          </button>
          <button onClick={() => void startCrawl()} disabled={running || !keyword.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
            style={{ background: 'var(--color-accent)' }}>
            {running ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            {running ? '采集中' : '开始自动采集'}
          </button>
        </div>
      </div>
      {expanded && (
        <>
          <div className="px-4 pt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
            {[
              { label: '关键词检索', active: true, desc: '下方「关键词」输入框：产品词 / 竞品词 / 场景词' },
              { label: '关键用户画像', active: false, desc: '待解锁' },
              { label: '对标账号', active: false, desc: '待解锁' },
            ].map(item => (
              <button key={item.label} disabled={!item.active}
                className={`text-left px-3 py-2 rounded-xl border transition-colors ${
                  item.active
                    ? 'border-accent bg-accent-glow text-text-primary'
                    : 'border-border bg-surface-2 text-text-muted cursor-not-allowed opacity-70'
                }`}>
                <span className="block text-xs font-bold">{item.label}</span>
                <span className="block text-[10px] mt-0.5">{item.desc}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_140px] gap-3 p-4">
            <div className="flex items-center gap-1.5 p-1 rounded-lg bg-surface-2 border border-border">
              {AUTO_CRAWL_PLATFORMS.map(p => (
                <button key={p.id} onClick={() => setCrawlPlatform(p.id)} disabled={!p.enabled}
                  className={`flex-1 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-45 ${
                    crawlPlatform === p.id ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>
            <label className="relative block">
              <span className="absolute left-9 top-1/2 -translate-y-1/2 text-xs text-text-muted pointer-events-none">{keywordInputLabel}</span>
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input value={keyword} onChange={e => setKeyword(e.target.value)}
                className="w-full pl-[5.25rem] pr-4 py-2 rounded-xl border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
                placeholder={keywordPlaceholder} />
            </label>
            <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-surface text-xs text-text-muted">
              数量
              <input type="number" min={1} max={30} value={limit} onChange={e => setLimit(Number(e.target.value))}
                className="w-full bg-transparent text-sm text-text-primary outline-none" />
            </label>
          </div>
          <div className="px-4 pb-3 -mt-2 grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-center text-xs text-text-muted">
            <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-surface">
              开始日期
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="flex-1 bg-transparent text-sm text-text-primary outline-none" />
            </label>
            <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-surface">
              结束日期
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="flex-1 bg-transparent text-sm text-text-primary outline-none" />
            </label>
            <div className="flex items-center gap-2">
              <button onClick={() => setAutoAnalyze(v => !v)} role="switch" aria-checked={autoAnalyze}
                className="relative w-8 h-4 rounded-full transition-colors flex-shrink-0"
                style={{ background: autoAnalyze ? 'var(--color-accent)' : 'var(--color-surface-2)' }}>
                <span className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform" style={{ transform: autoAnalyze ? 'translateX(16px)' : 'none' }} />
              </button>
              <span>采集后自动获取真实视频并提交 Gemini 分析，不存入素材库</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
interface InspirationDashboardProps {
  onScriptPanelOpen?: () => void;
  onScriptPanelClose?: () => void;
  onEnterWorkflow?: (payload: { script: string; video: TrendVideo; scriptType: ScriptType; language: string; productInfo: string }) => void;
}

export default function InspirationDashboard({ onScriptPanelOpen, onScriptPanelClose, onEnterWorkflow }: InspirationDashboardProps) {
  const [platform, setPlatform] = useState<Platform>('all');
  const [search, setSearch] = useState('');
  const [selectedVideo, setSelectedVideo] = useState<TrendVideo | null>(null);
  const [watchVideo, setWatchVideo] = useState<TrendVideo | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortMode, setSortMode] = useState<SortMode>('crawlTime');
  const [crawledVideos, setCrawledVideos] = useState<TrendVideo[]>([]);
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
      const r = await fetch('/api/overseas/videos?perPage=100', { headers: authHeader() });
      const data = await r.json().catch(() => ({})) as { items?: CrawlerRecord[] };
      if (!r.ok) throw new Error('视频列表加载失败');
      setCrawledVideos(recordsToVideos(data.items || []));
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

  const allVideos = crawledVideos;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allVideos
      .filter(v =>
        (platform === 'all' || v.platform === platform) &&
        (!q || v.title.toLowerCase().includes(q) || v.tags.some(t => t.toLowerCase().includes(q)))
      )
      .sort((a, b) => {
        if (sortMode === 'crawlTime') {
          return timeValue(b.crawledAt) - timeValue(a.crawledAt) || heatValue(b.views) - heatValue(a.views);
        }
        return heatValue(b.views) - heatValue(a.views) || timeValue(b.crawledAt) - timeValue(a.crawledAt);
      });
  }, [allVideos, platform, search, sortMode]);
  const recentThreeDayUploads = allVideos.filter(v => {
    const t = v.crawledAt ? new Date(v.crawledAt).getTime() : 0;
    return t > 0 && Date.now() - t <= 3 * 24 * 60 * 60 * 1000;
  }).length;

  const handleImported = (videos: TrendVideo[], autoAnalyze: boolean, activeKeyword = '') => {
    void refreshVideos();
    if (videos.length === 0) return;
    setCrawledVideos(prev => {
      const byId = new Map(prev.map(v => [v.id, v]));
      videos.forEach(v => byId.set(v.id, v));
      return [...byId.values()];
    });
    setPlatform(videos[0]?.platform ?? 'youtube');
    setSortMode('crawlTime');
    if (activeKeyword && !/^https?:\/\//i.test(activeKeyword)) setSearch(activeKeyword);
    if (autoAnalyze) {
      const downloadable = videos.filter(v => v.sourceUrl);
      if (downloadable.length > 0) {
        setMaterialMessage(`已进入视频获取队列和 Gemini 分析队列：${downloadable.length} 条`);
        setTimeout(() => setMaterialMessage(''), 3500);
        void Promise.allSettled(downloadable.map(video => analyzeVideoOnly(video, true)));
      }
    }
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
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(260px,1fr)_160px_170px_auto] gap-2.5 items-center">
            <div className="relative min-w-0">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="搜索视频标题或标签..."
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors" />
            </div>
            <div className="relative">
              <Globe size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <select value={platform} onChange={e => setPlatform(e.target.value as Platform)}
                aria-label="平台筛选"
                className="w-full appearance-none rounded-xl border border-border bg-surface py-2 pl-9 pr-9 text-sm font-semibold text-text-primary outline-none transition-colors hover:border-border-bright focus:border-accent">
                {PLATFORM_FILTERS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <span className="sr-only">{platformLabel}</span>
            </div>
            <div className="relative">
              {sortMode === 'heat'
                ? <Flame size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                : <Clock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />}
              <select value={sortMode} onChange={e => setSortMode(e.target.value as SortMode)}
                aria-label="排序方式"
                className="w-full appearance-none rounded-xl border border-border bg-surface py-2 pl-9 pr-9 text-sm font-semibold text-text-primary outline-none transition-colors hover:border-border-bright focus:border-accent">
                <option value="crawlTime">按爬取时间</option>
                <option value="heat">按热度</option>
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <span className="sr-only">{sortLabel}</span>
            </div>
            <div className="flex items-center gap-0.5 p-1 rounded-lg bg-surface-2 border border-border justify-self-start xl:justify-self-end">
              <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                <LayoutGrid size={13} />
              </button>
              <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                <List size={13} />
              </button>
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

        <AutoCrawlerPanel onImported={handleImported} />

        <div className="px-6 pb-6">
          {filtered.length === 0 ? (
            <div className="min-h-72 rounded-xl border border-dashed border-border bg-surface flex flex-col items-center justify-center gap-3 text-center px-6">
              <div className="w-11 h-11 rounded-xl bg-surface-2 border border-border flex items-center justify-center text-text-muted">
                <Download size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">暂无真实视频数据</p>
                <p className="text-xs text-text-muted mt-1">先用上方采集任务获取公开视频；系统会临时获取真实视频并完成 Gemini 分析。</p>
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
