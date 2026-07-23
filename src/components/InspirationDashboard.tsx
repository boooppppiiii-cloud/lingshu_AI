import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Play, Sparkles, FileText, Layout as LayoutIcon,
  TrendingUp, Clock, Globe, ChevronDown, X, Loader2,
  Check, Copy, ArrowRight, Zap, LayoutGrid, List,
  Lightbulb, Flame, BarChart2, ChevronRight, Film, Download, Plus,
  Bookmark, Maximize2, Minimize2, Lock, Upload, Users, Images,
} from 'lucide-react';
import { studioApi, type Material, type MaterialSegment, type VideoGenerationVersion } from '../lib/studioApi';
import { authHeader } from '../lib/auth';
import CompetitorAccountsModal from './CompetitorAccountsModal';
import type { Page } from '../App';
import { completeDemoStep, readDemoProgress } from '../lib/demoProgress';

// ── Types ─────────────────────────────────────────────────────────────────────
type Platform = 'all' | 'tiktok' | 'instagram' | 'youtube' | 'facebook';
type ScriptType = 'voiceover' | 'storyboard';
type SortMode = 'heat' | 'crawlTime';
type InspirationInnerView = 'inspiration' | 'library' | 'shooting';
type ContentFormat = 'video' | 'image';
type MaterialIndustryFilter = 'all' | 'beauty_skincare' | 'universal_manufacturing' | 'apparel_textile' | 'metalworking';
type MaterialApplicabilityFilter = 'all' | 'universal' | 'cross_industry' | 'industry_specific';
type MaterialOrientationFilter = 'all' | 'vertical' | 'horizontal';

const MATERIAL_INDUSTRY_LABELS: Record<string, string> = {
  all: '全部行业', beauty_skincare: '美妆护肤', universal_manufacturing: '通用制造',
  apparel_textile: '服装纺织', metalworking: '金属加工',
};
const MATERIAL_FUNCTION_LABELS: Record<string, string> = {
  all: '全部镜头功能', application: '使用/涂抹', texture_demo: '质地展示', product_demo: '产品展示',
  device_demo: '设备演示', ingredient_visual: '成分视觉', factory_proof: '工厂背书', production: '生产过程',
  equipment_demo: '设备展示', factory_exterior: '工厂外景', worker_operation: '工人操作',
  quality_control: '质检/检修', packaging: '包装交付', warehouse: '仓储物流', manufacturing_process: '加工过程',
  equipment_inspection: '设备检修', logistics_fulfillment: '物流履约', treatment_experience: '护理体验', usage_setup: '使用准备',
};
const MATERIAL_APPLICABILITY_LABELS: Record<string, string> = {
  all: '全部适用范围', universal: '通用素材', cross_industry: '跨行业素材', industry_specific: '行业专属',
};

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
  contentFormat: ContentFormat;
}

interface GeminiVideoAnalysis {
  theme?: string;
  hooks?: string[];
  sellingPoints?: string[];
  mood?: string;
  structure?: string;
  baseRequirements?: string;
  globalSettings?: { visualStyle?: string; aspectRatio?: string; lighting?: string; subtitlePolicy?: string; audioPolicy?: string; identityConsistency?: string; productConsistency?: string; negativeConstraints?: string[] };
  spatialContinuity?: { scene?: string; subjectAnchors?: Array<{ subject?: string; position?: string; facing?: string; gazeTarget?: string; orientation?: string }>; background?: string; backgroundPriority?: 'low' | 'medium' | 'high'; depthOfField?: 'shallow' | 'moderate' | 'deep' };
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
    environment?: string;
    shot?: string;
    camera?: string;
    angle?: string;
    composition?: string;
    visual?: string;
    subtitle?: string;
    audio?: string;
    note?: string;
    purpose?: string; dialogue?: string; onScreenText?: string; ambientSound?: string; bgm?: string;
    soundEffects?: string[]; beats?: Array<{ time?: string; action?: string; dialogue?: string; onScreenText?: string }>;
    persistentState?: string; startState?: string; endState?: string; transitionToNext?: string;
    backgroundPriority?: 'low' | 'medium' | 'high'; depthOfField?: 'shallow' | 'moderate' | 'deep';
    authenticity?: string; estimatedSpeechDuration?: number; dialogueFits?: boolean; confidence?: number; needsReview?: boolean;
  }>;
  recommendedScriptType?: 'voiceover' | 'storyboard';
}

interface VideoAnalysisPayload {
  source?: string;
  contentFormat?: ContentFormat;
  views?: string;
  keyword?: string;
  crawlRule?: string;
  sourceAccount?: string;
  sourceAccountName?: string;
  followerCount?: number;
  accountBaselineLevel?: 'low' | 'medium' | 'high';
  relativeViewMultiple?: number;
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
  analysisMode?: 'strategy' | 'exact';
  requestedAnalysisMode?: 'strategy' | 'exact';
  analysisError?: string;
  videoLevelFailureStatus?: string;
  manualRequiredReason?: string;
  videoStorage?: string;
  analyzedAt?: string;
  caption?: string;
  imageUrls?: string[];
  imageCount?: number;
  imageEvidence?: {
    version: 2;
    status: 'analyzed';
    observedFacts: Array<{ imageIndex: number; subjects: string[]; scene: string; composition: string; colors: string[]; visibleText: string[]; confidence: number }>;
    carouselFlow: Array<{ imageIndex: number; role: 'attention' | 'product' | 'detail' | 'proof' | 'process' | 'cta' | 'unknown'; evidence: string; confidence: number }>;
    copyEvidence: { hooks: Array<{ text: string; source: 'caption' | 'ocr'; evidence: string }>; sellingPoints: Array<{ text: string; source: 'caption' | 'ocr'; evidence: string }>; cta: string[] };
    reusableModules: Array<{ module: string; evidence: string; preserve: string; replace: string; confidence: number }>;
    uncertainties: string[];
  };
  imageAnalysisStatus?: 'analyzed' | 'failed';
  imageAnalysisError?: string;
  publicMetrics?: { likes?: string; comments?: string; shares?: string; plays?: string; followers?: number; observedAt?: string };
  publicBaseline?: { sampleSize: number; medianWeightedEngagement: number | null; currentWeightedEngagement: number | null; relativeMultiple: number | null; status: 'usable' | 'insufficient_sample'; method: string };
  publicAdSignals?: { isAd?: boolean; isPaidPartnership?: boolean };
  author?: string;
  crawlerOpsTaskId?: string;
  crawlerOpsStatus?: string;
  crawlerOpsReason?: string;
  crawlerOpsLastError?: string;
  gemini?: GeminiVideoAnalysis;
}

interface AccountSpecialRecommendation {
  level: '极高' | '高' | '较高';
  baseline: '低基线账号' | '中基线账号' | '高基线账号';
  multiple: number;
  message: string;
}

interface StructureStep { time: string; label: string; desc: string }
interface FirstTenSecondInsight { dimension: string; detail: string }
interface ScriptDetail15s { time: string; environment: string; shot: string; camera: string; angle?: string; composition?: string; visual: string; subtitle: string; audio: string; note?: string; purpose?: string; dialogue?: string; onScreenText?: string; ambientSound?: string; bgm?: string; soundEffects?: string[]; beats?: Array<{ time?: string; action?: string; dialogue?: string; onScreenText?: string }>; persistentState?: string; startState?: string; endState?: string; transitionToNext?: string; backgroundPriority?: 'low' | 'medium' | 'high'; depthOfField?: 'shallow' | 'moderate' | 'deep'; authenticity?: string; estimatedSpeechDuration?: number; dialogueFits?: boolean; confidence?: number; needsReview?: boolean }
interface ScriptSummary15s { visualStyle: string; coreEmotion: string; competitors: string[] }
interface ScriptAnalysis {
  videoType: string;
  structure: StructureStep[];
  firstTenSeconds: FirstTenSecondInsight[];
  scriptSummary15s: ScriptSummary15s;
  scriptDetails15s: ScriptDetail15s[];
  baseRequirements: string;
  referenceHighlights: string[];
  adaptTip: string;
  emotion: string;
  infoSpeed: string;
}

interface FrameMaterialMatch {
  detail: ScriptDetail15s;
  material?: Material;
  segment?: MaterialSegment;
  score: number;
  scores?: {
    function: number;
    action: number;
    subject: number;
    composition: number;
    camera: number;
    duration: number;
    quality: number;
    enterpriseFit: number;
  };
  trim?: {
    start: number;
    end: number;
    label: string;
  };
  reason: string;
  risks: string[];
  suggestion: string;
  status: 'high' | 'review' | 'adapt' | 'missing' | 'pending_analysis';
  viralDna: {
    purpose: string;
    mustPreserve: string[];
    replaceable: string[];
    authenticityRequired: boolean;
  };
  viralPotential: {
    score: number;
    whyEffective: string;
    mechanisms: string[];
  };
  replicability: {
    score: number;
    localCoverage: number;
    aiFeasibility: 'high' | 'medium' | 'low';
    recommendedExecution: 'local' | 'local_plus_ai' | 'local_plus_reshoot' | 'ai' | 'reshoot' | 'drop';
    blockers: string[];
  };
  decision: 'copy_now' | 'prioritize_reshoot' | 'ai_generate' | 'supporting_only' | 'drop';
}

interface ShootingNeed {
  id: string;
  priority: '高' | '中' | '低';
  title: string;
  suggestion: string;
  count: number;
  sourceVideos: string[];
  platform: Exclude<Platform, 'all'>;
  ratio: '9:16' | '16:9';
  example?: ScriptDetail15s;
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
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook',  label: 'Facebook' },
];
const ACTIVE_PLATFORMS: Array<Exclude<Platform, 'all'>> = ['youtube', 'tiktok', 'instagram', 'facebook'];

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

function cleanAnalysisTimestamp(value: unknown): string {
  const text = String(value || '').trim();
  const numbers = Array.from(text.matchAll(/(\d+(?:\.\d+)?)/g)).map(match => Number(match[1]));
  const clean = (number: number) => number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  if (numbers.length >= 2) return `${clean(numbers[0]!)}-${clean(numbers[1]!)}s`;
  if (numbers.length === 1) return `${clean(numbers[0]!)}s`;
  return text;
}

function isUnusableAnalysisText(value: unknown): boolean {
  const text = cleanAnalysisText(value);
  return !text
    || /字幕待|待 Gemini|待真实视频|视频下载并分析完成后|视频级分析会补充|无法确认/i.test(text);
}

function cleanScriptDetailField(value: unknown, field: 'visual' | 'subtitle' | 'audio' | 'note'): string {
  const text = cleanAnalysisText(value);
  if (!text || isUnusableAnalysisText(text)) return '';
  if (field === 'subtitle' && /按画面\/字幕推断|可能有|可能是|疑似|口播|台词|@|#|‘|’|"|"/i.test(text)) return '';
  if (field === 'audio' && /按画面\/字幕推断|可能有|可能是|疑似|台词|@|#|‘|’|"|"/i.test(text)) return '';
  if (field === 'note' && /可能有|可能是|疑似.*(?:台词|提示)|@|#|‘|’|"|"/i.test(text)) return '';
  return text;
}

function hasCompleteGeminiAnalysis(gemini?: GeminiVideoAnalysis): boolean {
  if (!gemini) return false;
  const firstTen = gemini.firstTenSeconds || {};
  const firstTenCount = [firstTen.atmosphere, firstTen.audioVisual, firstTen.camera, firstTen.visuals, firstTen.voiceMusic]
    .filter(value => cleanAnalysisText(value).length > 0)
    .length;
  const coarseCount = Array.isArray(gemini.coarseStructure)
    ? gemini.coarseStructure.filter(item => cleanAnalysisText(item.description || item.desc || item.frame).length > 0).length
    : 0;
  const detailCount = Array.isArray(gemini.scriptDetails15s)
    ? gemini.scriptDetails15s.filter(item => cleanAnalysisText(item.visual || item.subtitle).length > 0).length
    : 0;

  return cleanAnalysisText(gemini.theme).length > 0
    && firstTenCount >= 3
    && coarseCount >= 2
    && detailCount >= 2;
}

function isDisplayableVideoAnalysis(analysis?: VideoAnalysisPayload): boolean {
  if (!analysis) return false;
  const geminiStatus = String(analysis.geminiStatus || '');
  const downloadStatus = String(analysis.downloadStatus || '');
  const videoFetchStatus = String(analysis.videoFetchStatus || '');
  const analysisSource = String(analysis.analysisSource || '');
  if (analysis.analysisQuality !== 'video') return false;
  if (!analysis.gemini) return false;
  if (analysisSource === 'metadata-fallback' || geminiStatus === 'metadata_fallback' || downloadStatus === 'metadata_only') return false;
  // Exact analysis is a completed, user-requested upgrade. Keep the card visible
  // even when an older download attempt left a failure marker on the record.
  // The server-side inspiration filter follows the same rule.
  if (analysis.requestedAnalysisMode === 'exact' || analysis.analysisMode === 'exact') return true;
  return analysis.analysisQuality === 'video'
    && (!geminiStatus || geminiStatus === 'analyzed')
    && (!downloadStatus || downloadStatus === 'analyzed' || videoFetchStatus === 'direct_url' || videoFetchStatus === 'fetched');
}

function contentFormatOfAnalysis(analysis?: VideoAnalysisPayload): ContentFormat {
  return analysis?.contentFormat === 'image' ? 'image' : 'video';
}

function isDisplayableForFormat(video: TrendVideo, contentFormat: ContentFormat): boolean {
  const sourceUrl = video.sourceUrl || '';
  if (contentFormat === 'image') return video.contentFormat === 'image'
    && Boolean(video.thumbnail)
    && Boolean(sourceUrl)
    && !/\/(?:search|explore\/tags)\b/i.test(sourceUrl)
    && (video.platform !== 'instagram' || /\/p\//i.test(sourceUrl));
  return video.contentFormat === 'video' && isDisplayableVideoAnalysis(video.aiAnalysis);
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
    baseRequirements: buildBaseRequirements(gemini, video),
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

function imageAnalysisShell(video: TrendVideo): ScriptAnalysis {
  return {
    videoType: '竞品公开图文', structure: [], firstTenSeconds: [],
    scriptSummary15s: { visualStyle: '', coreEmotion: '', competitors: [] },
    scriptDetails15s: [], baseRequirements: '', referenceHighlights: [], adaptTip: '', emotion: '', infoSpeed: '',
  };
}

function buildBaseRequirements(gemini: GeminiVideoAnalysis, video: TrendVideo): string {
  const explicit = cleanAnalysisText(gemini.baseRequirements);
  if (explicit) return explicit;
  const summary = gemini.scriptSummary15s || {};
  const mood = cleanAnalysisText(gemini.mood) || cleanAnalysisText(summary.coreEmotion) || '好奇、信任、种草';
  const style = cleanAnalysisText(summary.visualStyle) || (video.platform === 'youtube' ? '真人写实评测风格' : '真人社媒写实风格');
  const scene = cleanAnalysisText(gemini.theme) || video.title;
  return `情绪氛围：${mood}；光影：清晰明亮，突出人物、产品和使用效果；全片主要场景：围绕「${scene}」展开真人口播、产品实拍、使用演示和结果对比；质感：${style}，产品包装、材质、肤感/触感/功能细节要拍清楚；基础要求：强反转开头，真人口播，卡点剪辑，特效拉满，产品质感突出。`;
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
    const visual = cleanScriptDetailField(item.visual, 'visual');
    const subtitle = cleanScriptDetailField(item.subtitle, 'subtitle');
    const audio = cleanScriptDetailField(item.audio, 'audio');
    const note = cleanScriptDetailField(item.note, 'note');
    if (!visual && !subtitle) return null;
    return {
      time: cleanAnalysisTimestamp(item.time || item.timestamp || `${Math.max(0.2, index * 1.5).toFixed(1)}s`),
      environment: cleanAnalysisText(item.environment) || '真实产品/人物口播场景',
      shot: String(item.shot || '中近景'),
      camera: String(item.camera || '固定镜头'),
      angle: cleanAnalysisText(item.angle),
      composition: cleanAnalysisText(item.composition),
      visual: visual || `画面承接「${video.title}」的核心信息。`,
      subtitle,
      audio,
      note: note || undefined,
      purpose: cleanAnalysisText(item.purpose), dialogue: cleanAnalysisText(item.dialogue), onScreenText: cleanAnalysisText(item.onScreenText),
      ambientSound: cleanAnalysisText(item.ambientSound), bgm: cleanAnalysisText(item.bgm), soundEffects: Array.isArray(item.soundEffects) ? item.soundEffects.map(cleanAnalysisText).filter(Boolean) : [],
      beats: Array.isArray(item.beats) ? item.beats : [], persistentState: cleanAnalysisText(item.persistentState),
      startState: cleanAnalysisText(item.startState), endState: cleanAnalysisText(item.endState), transitionToNext: cleanAnalysisText(item.transitionToNext),
      backgroundPriority: item.backgroundPriority, depthOfField: item.depthOfField, authenticity: cleanAnalysisText(item.authenticity),
      estimatedSpeechDuration: typeof item.estimatedSpeechDuration === 'number' ? item.estimatedSpeechDuration : undefined, dialogueFits: item.dialogueFits,
      confidence: typeof item.confidence === 'number' ? item.confidence : undefined, needsReview: Boolean(item.needsReview),
    };
  }).filter(Boolean) as ScriptDetail15s[];
  if (normalized.length) {
    return normalized.map((detail, index) => {
      const currentValues = Array.from(detail.time.matchAll(/(\d+(?:\.\d+)?)/g)).map(match => Number(match[1]));
      if (currentValues.length >= 2) return detail;
      const start = Math.max(0, currentValues[0] ?? (index === 0 ? 0 : parseFrameTimeRange(normalized[index - 1]!.time).end));
      const nextValues = Array.from(String(normalized[index + 1]?.time || '').matchAll(/(\d+(?:\.\d+)?)/g)).map(match => Number(match[1]));
      const nextStart = nextValues[0];
      const videoEnd = Number(video.duration) || 0;
      const end = nextStart != null && nextStart > start
        ? nextStart
        : videoEnd > start ? Math.min(videoEnd, start + 3) : start + 0.5;
      return { ...detail, time: `${Number(start.toFixed(1))}-${Number(end.toFixed(1))}s` };
    });
  }

  const fullDuration = Math.max(1, Number(video.duration) || 15);
  const source = structure.length ? structure : splitStructure(video.title, fullDuration);
  return source.map((step, index) => ({
    time: cleanAnalysisTimestamp(`${index * 3}-${Math.min(index * 3 + 3, fullDuration)}s`),
    environment: '真实产品/人物口播场景',
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

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

function tokenizeForMatch(...values: string[]): string[] {
  const stop = new Set(['the', 'and', 'with', 'this', 'that', 'for', 'you', 'your', 'our', '字幕', '画面', '镜头', '固定', '中近景', '特写']);
  return Array.from(new Set(values.join(' ')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .map(item => item.trim())
    .filter(item => item.length > 1 && !stop.has(item))));
}

function shootingSuggestion(detail: ScriptDetail15s): string {
  const text = `${detail.visual} ${detail.subtitle}`.toLowerCase();
  if (/face|脸|skin|肤|acne|dry|保湿|护肤|洁面|妆|唇|lip/.test(text)) {
    return '建议补拍真人上脸/手部使用镜头：自然光，9:16，近景或中近景，动作包含涂抹、展示肤感或前后对比。';
  }
  if (/package|包装|logo|brand|瓶|罐|产品|product|texture|质地/.test(text)) {
    return '建议补拍产品特写：干净桌面，正面包装、Logo、质地挤出/涂抹各一条，保留 2 秒稳定画面方便剪辑。';
  }
  if (/factory|工厂|warehouse|生产|发货|ship|proof|证明/.test(text)) {
    return '建议补拍工厂/履约证明镜头：包装线、库存、打包、发货单或质检动作，横竖屏各留一版。';
  }
  return '建议补拍与该分镜描述一致的 3-5 秒短素材：主体明确、背景干净、动作从静态展示到轻微移动。';
}

function parseFrameTimeRange(time: string): { start: number; end: number; duration: number } {
  const values = Array.from(String(time).matchAll(/(\d+(?:\.\d+)?)/g)).map(match => Number(match[1]));
  const start = Math.max(0, values[0] ?? 0);
  const end = Math.max(start + 3, values[1] ?? start + 3);
  return { start, end, duration: Math.max(1, end - start) };
}

function formatClipTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const min = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  const decimal = Math.round((safe - Math.floor(safe)) * 10);
  return decimal > 0
    ? `${min}:${String(sec).padStart(2, '0')}.${decimal}`
    : `${min}:${String(sec).padStart(2, '0')}`;
}

function viralDnaForFrame(detail: ScriptDetail15s): FrameMaterialMatch['viralDna'] {
  const text = `${detail.visual} ${detail.subtitle} ${detail.onScreenText}`;
  const start = parseFrameTimeRange(detail.time).start;
  const inferredPurpose = /cta|购买|下单|咨询|选择|了解更多|关注/i.test(text) ? '行动号召'
    : /前后|对比|效果|证明|测试|数据|认证/i.test(text) ? '效果/信任证明'
    : /切换|下一款|另一款|系列|多款/i.test(text) ? '产品切换与信息递进'
    : /质地|挤出|涂抹|泡沫|吸收/i.test(text) ? '质地或使用证明'
    : /完整|正面|包装|标签|logo|产品特写/i.test(text) ? '产品揭晓与识别'
    : start <= 3 ? '开场注意力钩子' : '叙事推进';
  const explicitPurpose = detail.purpose?.trim() || '';
  const purpose = !explicitPurpose || /承接叙事信息|叙事推进|画面承接/.test(explicitPurpose) ? inferredPurpose : explicitPurpose;
  const action = detail.beats?.map(item => item.action).filter(Boolean).join(' → ') || detail.visual;
  const authenticityRequired = /真实|不得ai|真人|证明|认证|效果|对比/i.test(`${detail.authenticity} ${purpose}`);
  const mustPreserve = Array.from(new Set([
    action ? `动作/信息节拍：${shortenText(action, 64)}` : '',
    detail.shot ? `景别：${detail.shot}` : '',
    detail.camera ? `运镜：${detail.camera}` : '',
    detail.composition ? `构图：${shortenText(detail.composition, 36)}` : '',
  ].filter(Boolean)));
  const replaceable = [
    /人物|真人|脸|手|person|face|hand/i.test(text) ? '人物换成企业适配的真人/达人' : '',
    /产品|包装|瓶|罐|洁面|cream|cleanser|product/i.test(text) ? '产品与包装换成企业自有产品' : '',
    detail.subtitle || detail.onScreenText ? '原字幕/品牌词改为已核验的企业卖点' : '补充企业品牌视觉，但不改变原镜头节拍',
  ].filter(Boolean);
  return {
    purpose,
    mustPreserve,
    replaceable: Array.from(new Set(replaceable)),
    authenticityRequired,
  };
}

function viralPotentialForFrame(detail: ScriptDetail15s, dna: FrameMaterialMatch['viralDna']): FrameMaterialMatch['viralPotential'] {
  const text = `${dna.purpose} ${detail.visual} ${detail.subtitle} ${detail.onScreenText}`;
  const mechanisms: string[] = [];
  let score = 38;
  if (parseFrameTimeRange(detail.time).start <= 3) { mechanisms.push('前3秒注意力入口'); score += 16; }
  if (/钩子|悬念|遮挡|隐藏|反差|意外|问题/i.test(text)) { mechanisms.push('悬念/反差'); score += 16; }
  if (/揭晓|完整|正面|切换|系列|多款/i.test(text)) { mechanisms.push('渐进揭晓'); score += 12; }
  if (/证明|效果|对比|测试|认证|口碑/i.test(text)) { mechanisms.push('证据前置'); score += 14; }
  if (/cta|购买|咨询|选择|行动号召/i.test(text)) { mechanisms.push('转化承接'); score += 10; }
  if (detail.beats?.length) { mechanisms.push('镜头内节拍'); score += 6; }
  if (detail.onScreenText || detail.subtitle) { mechanisms.push('画面信息同步'); score += 4; }
  const unique = Array.from(new Set(mechanisms));
  const mechanismText = unique.length ? unique.slice(0, 2).join('＋') : '明确主体与信息推进';
  return {
    score: Math.max(0, Math.min(100, score)),
    whyEffective: `${mechanismText}，让观众在${formatClipTime(parseFrameTimeRange(detail.time).duration)}内理解“${dna.purpose}”，并推动继续观看或完成判断。`,
    mechanisms: unique,
  };
}

function replicabilityForFrame(detail: ScriptDetail15s, dna: FrameMaterialMatch['viralDna'], matched: ReturnType<typeof scoreSegmentForFrame> | undefined, status: FrameMaterialMatch['status']): FrameMaterialMatch['replicability'] {
  const text = `${detail.visual} ${detail.subtitle} ${detail.onScreenText} ${detail.authenticity}`;
  const exactProduct = /包装|标签|logo|型号|认证|效果证明|真实产品|不得ai/i.test(text);
  const humanAction = /真人|人物|脸|眼|手部|涂抹|佩戴|口播/i.test(text);
  const aiFeasibility: FrameMaterialMatch['replicability']['aiFeasibility'] = exactProduct ? 'low' : humanAction ? 'medium' : 'high';
  const localCoverage = matched ? Math.max(0, Math.min(100, matched.score)) : 0;
  const blockers = [...(matched?.risks || [])];
  if (!matched && exactProduct) blockers.push('缺少可验证的真实产品片段');
  if (!matched && humanAction) blockers.push('缺少符合动作与景别的真人素材');
  if (dna.authenticityRequired && !matched?.segment.manualConfirmed) blockers.push('真实性要求尚未人工确认');
  const uniqueBlockers = Array.from(new Set(blockers));
  const recommendedExecution: FrameMaterialMatch['replicability']['recommendedExecution'] = matched && status === 'high' ? 'local'
    : matched && aiFeasibility === 'low' ? 'local_plus_reshoot'
    : matched ? 'local_plus_ai'
    : aiFeasibility === 'high' ? 'ai'
    : aiFeasibility === 'medium' ? 'reshoot' : 'reshoot';
  let score = Math.round(localCoverage * .65 + (aiFeasibility === 'high' ? 28 : aiFeasibility === 'medium' ? 18 : 6) + (dna.replaceable.length ? 8 : 0));
  if (dna.authenticityRequired && !matched?.segment.manualConfirmed) score = Math.min(score, 59);
  return { score: Math.max(0, Math.min(100, score)), localCoverage, aiFeasibility, recommendedExecution, blockers: uniqueBlockers.slice(0, 4) };
}

function normalizedOverlap(left: string, right: string): number {
  const tokens = tokenizeForMatch(left);
  if (!tokens.length) return 0;
  const haystack = right.toLowerCase();
  return Math.min(100, Math.round(tokens.filter(token => haystack.includes(token)).length / tokens.length * 100));
}

function scoreSegmentForFrame(material: Material, segment: MaterialSegment, detail: ScriptDetail15s, used: Set<string>) {
  const dna = viralDnaForFrame(detail);
  const frameText = `${detail.purpose} ${detail.visual} ${detail.beats?.map(item => item.action).join(' ')} ${detail.shot} ${detail.angle} ${detail.composition} ${detail.camera}`;
  const segmentText = `${segment.recommendedFunctions.join(' ')} ${segment.subject.join(' ')} ${segment.action} ${segment.shot} ${segment.angle} ${segment.composition} ${segment.camera} ${segment.environment}`;
  const needsProduct = /产品|包装|瓶|罐|质地|product|package|bottle|texture/i.test(frameText);
  const needsPerson = /人物|真人|男性|女性|脸|眼|皮肤|手|person|face|eye|skin|hand/i.test(frameText);
  const risks: string[] = [];
  if (needsProduct && !segment.productVisible) risks.push('硬条件不满足：分镜要求产品，但片段未识别到产品');
  if (needsProduct && /完整|正面|清晰|特写|reveal/i.test(frameText) && segment.productClarity !== 'high') risks.push('硬条件不满足：产品揭晓需要清晰完整产品');
  if (needsPerson && !segment.hasPerson) risks.push('硬条件不满足：分镜要求真人/手部动作');
  if (dna.authenticityRequired && segment.needsReview && !segment.manualConfirmed) risks.push('真实性镜头尚未人工确认');
  if (segment.hasLogo && segment.logoText.length) risks.push(`检测到文字/品牌：${segment.logoText.join('、')}`);

  const functionScore = normalizedOverlap(detail.purpose || '', segment.recommendedFunctions.join(' '));
  const action = normalizedOverlap(`${detail.visual} ${detail.beats?.map(item => item.action).join(' ')}`, segment.action);
  const subject = normalizedOverlap(detail.visual, `${segment.subject.join(' ')} ${segment.action}`);
  const composition = normalizedOverlap(`${detail.shot} ${detail.angle} ${detail.composition}`, `${segment.shot} ${segment.angle} ${segment.composition}`);
  const camera = normalizedOverlap(detail.camera, segment.camera);
  const frameDuration = parseFrameTimeRange(detail.time).duration;
  const duration = segment.duration >= frameDuration ? 100 : Math.round(segment.duration / frameDuration * 100);
  const quality = Math.max(0, Math.min(100, segment.quality));
  const enterpriseFit = segment.hasLogo ? 30 : segment.productVisible || segment.hasPerson ? 85 : 60;
  let score = Math.round(functionScore * .25 + action * .2 + subject * .15 + composition * .15 + camera * .1 + duration * .05 + enterpriseFit * .05 + quality * .05);
  if (risks.some(item => item.startsWith('硬条件'))) score = Math.min(score, 39);
  if (dna.authenticityRequired && segment.needsReview && !segment.manualConfirmed) score = Math.min(score, 59);
  if (used.has(segment.id)) { score = Math.max(0, score - 10); risks.push('该片段已用于其他分镜'); }
  return {
    material, segment, score,
    scores: { function: functionScore, action, subject, composition, camera, duration, quality, enterpriseFit },
    trim: { start: segment.start, end: segment.end, label: `真实片段 ${formatClipTime(segment.start)}-${formatClipTime(segment.end)}` },
    risks,
  };
}

function matchMaterialsToFrames(details: ScriptDetail15s[], materials: Material[]): FrameMaterialMatch[] {
  const videos = materials.filter(item => item.type === 'video');
  const analyzed = videos.flatMap(material => (material.segments || []).map(segment => ({ material, segment })));
  const used = new Set<string>();
  return details.map(detail => {
    const dna = viralDnaForFrame(detail);
    const viralPotential = viralPotentialForFrame(detail, dna);
    const candidates = analyzed.map(({ material, segment }) => scoreSegmentForFrame(material, segment, detail, used)).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const status: FrameMaterialMatch['status'] = !analyzed.length && videos.length ? 'pending_analysis'
      : !best || best.score < 40 ? 'missing' : best.score >= 80 ? 'high' : best.score >= 60 ? 'review' : 'adapt';
    const matched = best && best.score >= 40 ? best : undefined;
    if (matched) used.add(matched.segment.id);
    const replicability = replicabilityForFrame(detail, dna, matched, status);
    const decision: FrameMaterialMatch['decision'] = viralPotential.score >= 70 && replicability.score >= 70 ? 'copy_now'
      : viralPotential.score >= 70 && replicability.aiFeasibility === 'high' ? 'ai_generate'
      : viralPotential.score >= 70 ? 'prioritize_reshoot'
      : replicability.score >= 60 ? 'supporting_only' : 'drop';
    return {
      detail,
      material: matched?.material,
      segment: matched?.segment,
      score: matched?.score ?? 0,
      scores: matched?.scores,
      trim: matched?.trim,
      reason: status === 'pending_analysis' ? '现有视频尚未完成片段级分析，不能生成可信截取建议'
        : matched ? `按镜头功能、动作节拍、主体、构图与运镜匹配真实片段` : '没有片段通过硬条件，请补拍或人工选择',
      risks: matched?.risks ?? [],
      suggestion: shootingSuggestion(detail),
      status,
      viralDna: dna,
      viralPotential,
      replicability,
      decision,
    };
  });
}

function frameStartsEarly(time: string): boolean {
  const match = String(time).match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) <= 3 : false;
}

const AI_FEASIBILITY_LABELS: Record<FrameMaterialMatch['replicability']['aiFeasibility'], string> = {
  high: '高', medium: '中', low: '低',
};
function frameScoreGrade(score: number): '优' | '良' | '弱' {
  return score >= 75 ? '优' : score >= 50 ? '良' : '弱';
}

function shootingNeedTitle(detail: ScriptDetail15s): string {
  const text = `${detail.visual} ${detail.subtitle}`.toLowerCase();
  if (/face|脸|skin|肤|acne|dry|保湿|护肤|洁面|妆|唇|lip/.test(text)) return '真人上脸/使用场景';
  if (/package|包装|logo|brand|瓶|罐|产品|product|texture|质地/.test(text)) return '产品包装/质地特写';
  if (/factory|工厂|warehouse|生产|发货|ship|proof|证明/.test(text)) return '工厂履约/发货证明';
  return '通用转场/场景补充';
}

function buildShootingNeeds(videos: TrendVideo[], materials: Material[]): ShootingNeed[] {
  const grouped = new Map<string, ShootingNeed>();
  for (const video of videos) {
    const analysis = getAnalysis(video);
    if (!analysis) continue;
    const matches = matchMaterialsToFrames(analysis.scriptDetails15s, materials);
    for (const match of matches) {
      if (match.material) continue;
      const title = shootingNeedTitle(match.detail);
      const key = `${video.platform}-${title}-${match.suggestion}`;
      const existing = grouped.get(key);
      const sourceTitle = shortenText(video.title, 42);
      if (existing) {
        existing.count += 1;
        if (!existing.sourceVideos.includes(sourceTitle)) existing.sourceVideos.push(sourceTitle);
        if (frameStartsEarly(match.detail.time)) existing.priority = '高';
        continue;
      }
      grouped.set(key, {
        id: key,
        priority: frameStartsEarly(match.detail.time) ? '高' : '中',
        title,
        suggestion: match.suggestion,
        count: 1,
        sourceVideos: [sourceTitle],
        platform: video.platform,
        ratio: video.platform === 'youtube' ? '16:9' : '9:16',
        example: match.detail,
      });
    }
  }
  return Array.from(grouped.values())
    .map((item): ShootingNeed => ({ ...item, priority: item.priority === '高' || item.count >= 3 ? '高' : item.count >= 2 ? '中' : '低' }))
    .sort((a, b) => {
      const rank = { '高': 3, '中': 2, '低': 1 };
      return rank[b.priority] - rank[a.priority] || b.count - a.count;
    })
    .slice(0, 30);
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

function referenceAnalysisText(video: TrendVideo, analysis: ScriptAnalysis | null): string {
  if (!analysis) {
    return [
      `参考视频标题仅用于判断开头钩子类型，不得在新脚本中复述：${shortenText(video.title, 80)}`,
      `平台：${video.platform}`,
      video.tags.length ? `标签：${video.tags.join('、')}` : '',
      video.views ? `热度：${video.views}` : '',
      '没有可用的视频级分析，只能按标题、平台和产品信息生成保守脚本。',
    ].filter(Boolean).join('\n');
  }
  const structure = analysis.structure.map(item => `${item.time} ${item.label}: ${item.desc}`).join('\n');
  const details = analysis.scriptDetails15s.map(item => `${item.time} ${item.shot}/${item.camera}: ${item.visual}；原字幕/口播：${item.subtitle}`).join('\n');
  const firstTen = analysis.firstTenSeconds.map(item => `${item.dimension}: ${item.detail}`).join('\n');
  return [
    `参考视频标题仅用于判断开头钩子类型，不得在新脚本中复述：${shortenText(video.title, 80)}`,
    `平台：${video.platform}`,
    `视频类型：${analysis.videoType}`,
    `信息节奏：${analysis.infoSpeed}`,
    `情绪：${analysis.emotion}`,
    `前 10 秒拆解：\n${firstTen}`,
    `粗略结构：\n${structure}`,
    `全片导演分镜：\n${details}`,
    `改编提示：${analysis.adaptTip}`,
  ].filter(Boolean).join('\n\n');
}

function referenceHighlights(video: TrendVideo, analysis: ScriptAnalysis | null): string[] {
  if (!analysis) return [
    `参考标题只提炼钩子类型，不复述原文：${shortenText(video.title, 60)}`,
    video.tags.length ? `标签只用于判断受众，不输出原 hashtag：${video.tags.slice(0, 4).join('、')}` : '按平台短视频节奏生成',
    '必须用产品真实细节替换空泛卖点',
  ].filter(Boolean);
  return [
    ...analysis.referenceHighlights,
    ...analysis.structure.slice(0, 4).map(item => `${item.time} ${item.label}: ${item.desc}`),
    ...analysis.scriptDetails15s.slice(0, 3).map(item => `${item.time}: ${item.visual}`),
  ].filter(Boolean).slice(0, 8);
}

function adaptedFrameLine(detail: ScriptDetail15s, index: number, product: ReturnType<typeof productScriptContext>, langCode = 'zh'): string {
  const visual = inferShotAction(detail, index, product, langCode);
  const subtitle = rewriteSubtitle(detail, index, product, langCode);
  const audio = detail.audio && !/待真实视频|待 Gemini|待视频/.test(detail.audio)
    ? detail.audio
    : 'BGM 保持轻快种草节奏，口播短句跟随字幕切点。';
  const note = detail.note ? `（注：保留对标视频节奏备注：${detail.note}）` : '';
  if (langCode !== 'zh') {
    return `[${detail.time}] Environment: ${detail.environment}; Shot: close-up or medium shot; Camera: simple handheld movement; Audio: upbeat social commerce music; ${voiceLine(subtitle, langCode)}; Visual: ${visual}; Captions match the voiceover.`;
  }
  return `[${detail.time}] 环境：${detail.environment}；景别：${detail.shot}；运镜：${detail.camera}；${detail.angle ? `视角：${detail.angle}；` : ''}${detail.composition ? `构图：${detail.composition}；` : ''}配乐：${audio}；台词：人物说“${subtitle}”；画面：${visual}${detail.startState ? `；初始状态：${detail.startState}` : ''}${detail.endState ? `；结束状态：${detail.endState}` : ''}${detail.transitionToNext ? `；衔接：${detail.transitionToNext}` : ''}${note}`;
}

function makeVoiceoverDraft(_video: TrendVideo, analysis: ScriptAnalysis, productInfo: string, languageLabel?: string, langCode = 'zh'): string {
  const product = productScriptContext(productInfo);
  const useCase = shortenText(product.market, 28);
  const proof = shortenText(product.proof, 34);
  if (langCode !== 'zh') {
    const label = productLabelForLang(product, langCode);
    return `${scriptTitle(product, languageLabel, langCode)}

[Hook · 0-3s]
Voiceover: "If your buyers ask to see ${label} before ordering, show them this first."

[Body · 3-12s]
Voiceover: "Film the texture, packaging, and options clearly, then show why it fits ${useCase}."
Voiceover: "The key proof point is ${proof}, so buyers can check samples before bulk orders."

[CTA · 12-15s]
Voiceover: "Message us for the sample list, packaging options, and MOQ quote."`;
  }
  return `${scriptTitle(product, languageLabel, langCode)}

[Hook · 0-3s]
人物说：“客户问这款${product.label}能不能先看样品，就先给他看这三个细节。”

[Body · 3-12s]
人物说：“第一，看实拍质地和包装，不要只发渲染图。”
人物说：“第二，把${proof}直接放到字幕里，让买家知道能不能试单。”
人物说：“第三，说明适合${useCase}，客户才知道怎么上架或采购。”

[CTA · 12-15s]
人物说：“要样品、包装方案和 MOQ 报价，直接留言给我们。”`;
}

function makeFallbackScript(video: TrendVideo, analysis: ScriptAnalysis | null, productInfo: string, languageLabel?: string, langCode = 'zh', type: ScriptType = 'voiceover'): string {
  if (analysis) return type === 'voiceover'
    ? makeVoiceoverDraft(video, analysis, productInfo, languageLabel, langCode)
    : makeStoryboardDraft(video, analysis, productInfo, languageLabel, langCode);

  const product = productScriptContext(productInfo);
  if (type === 'storyboard') {
    return `【分镜脚本｜${product.label}｜${languageLabel || '中文'}】

Scene 1 (0-3s)
Shot: close-up | Camera: static
Visual: 手把「${product.label}」放到镜头前，先展示最能看懂的质地、颜色、尺寸或包装细节。
Voiceover: 客户问样品前，先给他看真实细节。
Subtitle: 先看真实样品

Scene 2 (3-8s)
Shot: medium | Camera: push
Visual: 拆开包装或演示一个使用场景，画面同时露出产品和手部动作。
Voiceover: 这段要让买家知道里面有什么、怎么用、适合什么渠道。
Subtitle: 产品和场景同框

Scene 3 (8-12s)
Shot: close-up | Camera: pan
Visual: 用字幕标出 MOQ、样品、私标包装、认证或交期信息。
Voiceover: 采购最关心的是样品、包装和报价能不能快速确认。
Subtitle: 样品 / 包装 / 报价

Scene 4 (12-15s)
Shot: wide | Camera: static
Visual: 全套产品平铺，画面出现“索取色号表 / 包装方案 / MOQ 报价”。
Voiceover: 要目录和 MOQ 报价，直接留言给我们。
Subtitle: 留言拿报价`;
  }
  return makeVoiceoverDraft(video, {
    videoType: '基础资料拆解',
    structure: [],
    firstTenSeconds: [],
    scriptSummary15s: { visualStyle: '真实产品实拍', coreEmotion: '可信、清楚、可询盘', competitors: [] },
    scriptDetails15s: [],
    baseRequirements: '情绪氛围：可信、清楚、可询盘；光影：明亮干净；全片主要场景：产品实拍、包装展示、使用演示和 CTA；质感：真实产品实拍，突出产品细节；基础要求：强反转开头，真人口播，卡点剪辑，特效拉满，产品质感突出。',
    referenceHighlights: [],
    adaptTip: '',
    emotion: '',
    infoSpeed: '',
  }, productInfo, languageLabel, langCode);
}

function makeStoryboardDraft(_video: TrendVideo, analysis: ScriptAnalysis, productInfo: string, languageLabel?: string, langCode = 'zh'): string {
  const product = productScriptContext(productInfo);
  const frames = analysis.scriptDetails15s.map((detail, index) => adaptedFrameLine(detail, index, product, langCode)).join('\n\n');
  if (langCode !== 'zh') {
    return frames;
  }
  return frames;
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
  if (analysis.analysisMode === 'exact' && hasCompleteGeminiAnalysis(analysis.gemini)) return false;
  const analyzedUntil = (analysis.gemini.scriptDetails15s || []).reduce((max, item) => {
    const numbers = String(item.time || '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    return Math.max(max, numbers[1] ?? numbers[0] ?? 0);
  }, 0);
  if (video.duration > 0 && analyzedUntil > 0 && analyzedUntil + 1 < video.duration) return true;
  return analysis.analysisSource === 'metadata-fallback' ||
    analysis.analysisQuality === 'metadata' ||
    analysis.downloadStatus === 'ops_queued';
}

// ── Fallback thumbnail ────────────────────────────────────────────────────────
function VideoThumbnail({ platform, title }: { platform: Exclude<Platform, 'all'>; title: string }) {
  const meta = getPlatformMeta(platform);
  const words = title.split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const shortTitle = title.length > 86 ? `${title.slice(0, 83)}...` : title;
  return (
    <div className="w-full h-full flex flex-col justify-between relative overflow-hidden p-4"
      style={{ background: `linear-gradient(135deg, ${meta.bg} 0%, #111827 58%, #334155 100%)` }}>
      <div className="absolute inset-0 opacity-10"
        style={{ backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,.35) 0, transparent 46%), repeating-linear-gradient(45deg, rgba(255,255,255,.3) 0, rgba(255,255,255,.3) 1px, transparent 1px, transparent 11px)' }} />
      <div className="relative">
        <div className="mb-2 text-4xl font-black font-display text-white/15 select-none">{initials || meta.label.slice(0, 2).toUpperCase()}</div>
        <p className="line-clamp-3 text-sm font-semibold leading-snug text-white/90 drop-shadow-sm">{shortTitle}</p>
      </div>
    </div>
  );
}

function ThumbnailImage({
  src,
  platform,
  title,
  className,
}: {
  src: string;
  platform: Exclude<Platform, 'all'>;
  title: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed || !src) return <VideoThumbnail platform={platform} title={title} />;
  return <img src={src} alt="" className={className} draggable={false} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

function AuthenticatedVideo({ apiUrl, poster, className, controls = false, autoPlay = false, hoverPlay = false }: { apiUrl: string; poster?: string; className: string; controls?: boolean; autoPlay?: boolean; hoverPlay?: boolean }) {
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const load = async () => {
    if (playbackUrl || loading) return playbackUrl;
    setLoading(true);
    try {
      const response = await fetch(apiUrl, { headers: authHeader() });
      if (!response.ok) throw new Error(String(response.status));
      const next = String(((await response.json()) as { url?: string }).url || '');
      setPlaybackUrl(next);
      return next;
    } catch { return ''; } finally { setLoading(false); }
  };
  useEffect(() => { setPlaybackUrl(''); if (autoPlay) void load(); }, [apiUrl, autoPlay]);
  useEffect(() => { if (autoPlay && playbackUrl) void videoRef.current?.play().catch(() => {}); }, [autoPlay, playbackUrl]);
  return <video ref={videoRef} src={playbackUrl || undefined} poster={poster} controls={controls} autoPlay={autoPlay} muted={!controls} playsInline loop={hoverPlay} preload="metadata" className={className}
    onMouseEnter={async () => { if (!hoverPlay) return; await load(); setTimeout(() => void videoRef.current?.play().catch(() => {}), 0); }}
    onMouseLeave={() => { if (!hoverPlay || !videoRef.current) return; videoRef.current.pause(); videoRef.current.currentTime = 0; }} />;
}

type ImageInsightTab = 'overview' | 'visual' | 'copy' | 'iterate';

function ImageBreakdownContent({ video, activeTab }: { video: TrendVideo; analysis: ScriptAnalysis; activeTab: ImageInsightTab }) {
  const evidence = video.aiAnalysis?.imageEvidence;
  const metrics = video.aiAnalysis?.publicMetrics;
  const baseline = video.aiAnalysis?.publicBaseline;
  const adSignals = video.aiAnalysis?.publicAdSignals;
  const rawCaption = cleanAnalysisText(video.aiAnalysis?.caption || video.title);
  const isAnalyzed = Boolean(evidence?.status === 'analyzed' && evidence.observedFacts.length);
  const roleLabel: Record<string, string> = { attention: '首图停留', product: '产品展示', detail: '细节说明', proof: '信任证明', process: '流程解释', cta: '行动引导', unknown: '未确定' };

  const EmptyEvidence = ({ title, desc }: { title: string; desc: string }) => (
    <div className="rounded-2xl border border-dashed border-border bg-surface-2 px-5 py-8 text-center">
      <Images size={22} className="mx-auto text-text-muted" />
      <p className="mt-3 text-xs font-black text-text-primary">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[280px] text-[10px] leading-relaxed text-text-muted">{desc}</p>
    </div>
  );

  const EvidenceCard = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-xl border border-border bg-white p-3">
      <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-black text-text-primary">{label}</p><span className="rounded-full bg-surface-2 px-2 py-0.5 text-[9px] text-text-muted">来自 AI 原始结果</span></div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-text-secondary">{value}</p>
    </div>
  );

  if (activeTab === 'overview') return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-white p-3.5">
        <div className="flex items-center justify-between"><div><p className="text-xs font-black text-text-primary">公开表现</p><p className="mt-1 text-[9px] text-text-muted">无公开值就留空，不把播放当曝光、不估算收藏与点击</p></div>{baseline?.status === 'usable' && baseline.relativeMultiple != null && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">账号基线 {baseline.relativeMultiple}×</span>}</div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">{[['点赞', metrics?.likes || '—'], ['评论', metrics?.comments || '—'], ['分享', metrics?.shares || '—'], ['播放', metrics?.plays || '—']].map(([label, value]) => <div key={label} className="rounded-lg bg-surface-2 px-1.5 py-2 text-center"><p className="text-sm font-black text-text-primary">{value}</p><p className="text-[9px] text-text-muted">{label}</p></div>)}</div>
        <div className="mt-2 rounded-lg bg-surface-2 p-2 text-[9px] leading-relaxed text-text-secondary">
          <p>账号：{video.aiAnalysis?.author || '未抓取'} · 粉丝：{metrics?.followers ? metrics.followers.toLocaleString() : '未公开/未抓取'}</p>
          <p className="mt-1">投流信号：{adSignals?.isAd || adSignals?.isPaidPartnership ? '平台公开标记为广告/付费合作' : '未抓到公开标记（不代表未投流）'}</p>
        </div>
        <p className="mt-2 text-[9px] leading-relaxed text-text-muted">{baseline?.status === 'usable' ? `${baseline.sampleSize} 条同账号样本；${baseline.method}` : `同账号样本 ${baseline?.sampleSize || 0} 条，暂不足以确认相对爆款。`}</p>
      </section>
      {!isAnalyzed ? <EmptyEvidence title="图片证据尚未提取" desc={video.aiAnalysis?.imageAnalysisError || '重新分析后，系统会逐图提取可见事实、OCR、轮播角色和可复用模块。'}/> : <section><div className="mb-2 flex items-center justify-between"><p className="text-[11px] font-black text-text-primary">可复用模块</p><span className="text-[9px] text-text-muted">{evidence!.observedFacts.length} 张图片 · 仅基于可见证据</span></div><div className="space-y-2">{evidence!.reusableModules.map((item, index) => <div key={`${item.module}-${index}`} className="rounded-xl border border-border bg-white p-3"><div className="flex items-center justify-between"><p className="text-[11px] font-black text-text-primary">{item.module}</p><span className="text-[9px] text-text-muted">置信度 {Math.round(item.confidence * 100)}%</span></div><p className="mt-1 text-[10px] text-text-secondary">证据：{item.evidence}</p><div className="mt-2 grid grid-cols-2 gap-2 text-[9px]"><p className="rounded-lg bg-emerald-50 p-2 text-emerald-800">保留结构：{item.preserve}</p><p className="rounded-lg bg-amber-50 p-2 text-amber-800">替换内容：{item.replace}</p></div></div>)}</div></section>}
    </div>
  );

  if (activeTab === 'visual') return (
    <div className="space-y-3">
      <div><p className="text-[11px] font-black text-text-primary">逐图视觉事实</p><p className="mt-1 text-[10px] text-text-muted">主体、场景、构图、颜色和实际可读文字</p></div>
      {!isAnalyzed ? <EmptyEvidence title="尚未返回逐图拆解" desc="当前没有可验证的图片视觉结果。"/> : evidence!.observedFacts.map(fact => { const flow = evidence!.carouselFlow.find(item => item.imageIndex === fact.imageIndex); return <div key={fact.imageIndex} className="rounded-xl border border-border bg-white p-3"><div className="flex items-center justify-between"><p className="text-[11px] font-black text-text-primary">第 {fact.imageIndex} 张</p><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700">{roleLabel[flow?.role || 'unknown']}</span></div><p className="mt-2 text-[10px] text-text-secondary">主体：{fact.subjects.join('、') || '未确认'}</p><p className="mt-1 text-[10px] text-text-secondary">场景：{fact.scene || '未确认'}</p><p className="mt-1 text-[10px] text-text-secondary">构图：{fact.composition || '未确认'}</p><p className="mt-1 text-[10px] text-text-secondary">颜色：{fact.colors.join('、') || '未确认'}</p>{fact.visibleText.length > 0 && <p className="mt-1 rounded-lg bg-surface-2 p-2 text-[10px] text-text-secondary">OCR：{fact.visibleText.join(' / ')}</p>}{flow?.evidence && <p className="mt-2 text-[9px] text-text-muted">轮播作用依据：{flow.evidence}</p>}</div>; })}
    </div>
  );

  if (activeTab === 'copy') return (
    <div className="space-y-3">
      <section className="rounded-xl border border-border bg-white p-3"><div className="flex items-center justify-between"><p className="text-[10px] font-bold text-text-muted">原始帖文</p><span className="rounded-full bg-surface-2 px-2 py-0.5 text-[9px] text-text-muted">抓取原文</span></div><p className="mt-2 text-[11px] font-bold leading-relaxed text-text-primary">{rawCaption || '未抓取到原始帖文'}</p></section>
      {!evidence?.copyEvidence.hooks.length && !evidence?.copyEvidence.sellingPoints.length ? <EmptyEvidence title="没有可确认的文案模块" desc="仅展示原始帖文，不推断未出现的人群、痛点或承诺。"/> : <>{evidence?.copyEvidence.hooks.map((item, index) => <EvidenceCard key={`copy-hook-${index}`} label={`钩子 ${index + 1} · ${item.source}`} value={`${item.text}｜证据：${item.evidence}`}/>)}{evidence?.copyEvidence.sellingPoints.map((item, index) => <EvidenceCard key={`copy-point-${index}`} label={`卖点 ${index + 1} · ${item.source}`} value={`${item.text}｜证据：${item.evidence}`}/>)}</>}
    </div>
  );

  return (
    <div className="space-y-3">
      <div><p className="text-[11px] font-black text-text-primary">套用到企业获客内容</p><p className="mt-1 text-[10px] text-text-muted">生成“吸引—解释—信任”三条连续内容，而不是三张相似测试图。</p></div>
      {!isAnalyzed ? <EmptyEvidence title="暂不能生成内容包" desc="需要先完成逐图证据提取，才能安全复用布局和信息模块。"/> : <div className="space-y-2">{[['吸引目标买家', '复用首图停留结构，替换为企业产品和买家问题。'], ['解释合作能力', '复用产品、细节和流程模块，映射企业 MOQ、定制与交付资料。'], ['建立供应商信任', '复用证明模块，只使用企业真实工厂、认证和案例。']].map(([title, desc], index) => <div key={title} className="flex gap-3 rounded-xl border border-border bg-white p-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[10px] font-black text-emerald-700">{index + 1}</span><div><p className="text-[11px] font-black text-text-primary">{title}</p><p className="mt-1 text-[10px] text-text-secondary">{desc}</p></div></div>)}{evidence!.uncertainties.length > 0 && <div className="rounded-xl bg-amber-50 p-3"><p className="text-[10px] font-black text-amber-800">生成前需确认</p>{evidence!.uncertainties.map(item => <p key={item} className="mt-1 text-[9px] text-amber-700">· {item}</p>)}</div>}</div>}
    </div>
  );
}

// ── Analysis Panel ────────────────────────────────────────────────────────────
function AnalysisPanel({ video, onGenerateScript, onRetry, onExactAnalysis, actionNotice, specialRecommendation }: { video: TrendVideo; onGenerateScript: (analysis?: ScriptAnalysis) => void; onRetry?: () => void; onExactAnalysis?: () => void; actionNotice?: string; specialRecommendation?: AccountSpecialRecommendation | null }) {
  const [loaded, setLoaded] = useState(false);
  const [analysis, setAnalysis] = useState<ScriptAnalysis | null>(null);
  const [activeBookmark, setActiveBookmark] = useState<'reason' | 'frames' | 'script' | 'adapt' | ImageInsightTab>(video.contentFormat === 'image' ? 'overview' : 'reason');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialLoading, setMaterialLoading] = useState(false);
  const [editingAnalysis, setEditingAnalysis] = useState(false);
  const [savingAnalysis, setSavingAnalysis] = useState(false);
  const [reanalyzingImage, setReanalyzingImage] = useState(false);
  const [analysisSaveNotice, setAnalysisSaveNotice] = useState('');
  const analysisKey = JSON.stringify(video.aiAnalysis || {});
  const updateDetail = (index: number, patch: Partial<ScriptDetail15s>) => setAnalysis(current => current ? ({ ...current, scriptDetails15s: current.scriptDetails15s.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }) : current);
  const saveAnalysisCorrections = async () => {
    if (!analysis) return;
    setSavingAnalysis(true); setAnalysisSaveNotice('');
    try {
      const response = await fetch(`/api/overseas/videos/${video.id}/analysis-corrections`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({ scriptSummary15s: analysis.scriptSummary15s, scriptDetails15s: analysis.scriptDetails15s, confirmed: true }) });
      if (!response.ok) throw new Error(`保存失败（${response.status}）`);
      setEditingAnalysis(false); setAnalysisSaveNotice('修正已保存，后续裂变将使用确认稿');
    } catch (error) { setAnalysisSaveNotice(error instanceof Error ? error.message : '保存失败'); }
    finally { setSavingAnalysis(false); }
  };
  const reanalyzeImage = async () => {
    const id = video.recordId || video.id.replace(/^crawl-/, '');
    setReanalyzingImage(true);
    try {
      const response = await fetch(`/api/overseas/videos/${id}/reanalyze-image`, { method: 'POST', headers: authHeader() });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error || '图片分析失败');
      window.location.reload();
    } catch (error) {
      setAnalysisSaveNotice(error instanceof Error ? error.message : '图片分析失败');
    } finally { setReanalyzingImage(false); }
  };

  useEffect(() => {
    setLoaded(false);
    setAnalysis(null);
    const t = setTimeout(() => {
      setAnalysis(video.contentFormat === 'image' ? imageAnalysisShell(video) : getAnalysis(video));
      setLoaded(true);
    }, video.aiAnalysis?.gemini ? 250 : 900);
    return () => clearTimeout(t);
  }, [video.id, analysisKey]);

  useEffect(() => {
    let cancelled = false;
    setMaterialLoading(true);
    studioApi.listMaterials()
      .then(list => {
        if (!cancelled) setMaterials(list.filter(item => item.type === 'video'));
      })
      .catch(() => {
        if (!cancelled) setMaterials([]);
      })
      .finally(() => {
        if (!cancelled) setMaterialLoading(false);
      });
    return () => { cancelled = true; };
  }, [video.id]);

  useEffect(() => {
    setActiveBookmark(video.contentFormat === 'image' ? 'overview' : 'reason');
  }, [video.id, video.contentFormat]);

  if (!loaded) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(22,163,74,0.1)' }}>
          <Loader2 size={18} className="text-accent animate-spin" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-text-primary">{video.contentFormat === 'image' ? 'AI 正在提取图片爆点…' : 'AI 正在分析脚本结构…'}</p>
          <p className="text-xs text-text-muted">{video.contentFormat === 'image' ? '视觉焦点 · 文案钩子 · 迭代变量' : '前 10 秒五维拆解 · 粗略 3 秒结构 · 提取复用爆点'}</p>
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
          {state.spinning ? <Loader2 size={18} className="text-accent animate-spin" /> : <X size={18} className={state.failed ? 'text-accent' : 'text-text-muted'} />}
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

  const frameMatches = matchMaterialsToFrames(analysis.scriptDetails15s, materials);
  const matchedCount = frameMatches.filter(item => item.material).length;

  const confirmMatchedSegment = async (match: FrameMaterialMatch) => {
    if (!match.material || !match.segment) return;
    const result = await studioApi.updateMaterialSegment(match.material.id, match.segment.id, { manualConfirmed: true, needsReview: false });
    if (result.ok && result.material) setMaterials(current => current.map(item => item.id === result.material!.id ? result.material! : item));
  };

  const bookmarkTabs = video.contentFormat === 'image' ? [
    { id: 'overview' as const, icon: <Zap size={12} />, label: '表现与模块' },
    { id: 'visual' as const, icon: <Images size={12} />, label: '逐图拆解' },
    { id: 'copy' as const, icon: <FileText size={12} />, label: '文案证据' },
    { id: 'iterate' as const, icon: <Sparkles size={12} />, label: '获客套用' },
  ] : [
    { id: 'reason' as const, icon: <Lightbulb size={12} />, label: '核心原因' },
    { id: 'frames' as const, icon: <Film size={12} />, label: '分镜匹配' },
    { id: 'script' as const, icon: <FileText size={12} />, label: '脚本详析' },
    { id: 'adapt' as const, icon: <Sparkles size={12} />, label: '改编建议' },
  ];
  const imageEvidenceCount = video.aiAnalysis?.imageEvidence?.observedFacts.length || 0;
  const hasTrustedImageAnalysis = video.contentFormat === 'image' && video.aiAnalysis?.imageEvidence?.status === 'analyzed' && imageEvidenceCount > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-lingshu-guide="analysis-evidence">
      <div className="flex-shrink-0 border-b border-border bg-surface px-4 py-3">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
          <span className="rounded-md border border-border bg-surface-2 px-2 py-1 font-semibold text-text-secondary">{video.contentFormat === 'image' ? `${getPlatformMeta(video.platform).label} 图文` : analysis.videoType}</span>
          {video.contentFormat === 'image' ? <><span className="flex items-center gap-1"><BarChart2 size={9} className="text-accent" />{hasTrustedImageAnalysis ? `已提取 ${imageEvidenceCount} 条证据` : '图片分析待完成'}</span><span className="flex items-center gap-1"><Images size={9} />{video.aiAnalysis?.imageCount || video.aiAnalysis?.imageUrls?.length || 1} 张图片</span></> : <><span className="flex items-center gap-1"><BarChart2 size={9} className="text-accent" />信息速度 {analysis.infoSpeed}</span><span className="flex items-center gap-1"><TrendingUp size={9} />{video.views} 播放</span><span>{analysis.emotion}</span></>}
        </div>
        <div className="grid grid-cols-4 gap-1 rounded-xl border border-border bg-surface-2 p-1">
          {bookmarkTabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveBookmark(tab.id)}
              className={`flex min-h-9 items-center justify-center gap-1 rounded-lg px-1.5 text-[11px] font-bold transition-all ${
                activeBookmark === tab.id
                  ? 'bg-white text-accent shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {tab.icon}
              <span className="truncate">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <AnimatePresence mode="wait">
          {video.contentFormat === 'image' && ['overview', 'visual', 'copy', 'iterate'].includes(activeBookmark) && (
            <motion.div key={activeBookmark} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
              <ImageBreakdownContent video={video} analysis={analysis} activeTab={activeBookmark as ImageInsightTab} />
            </motion.div>
          )}
          {activeBookmark === 'reason' && (
            <motion.div key="reason" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="space-y-3">
              {specialRecommendation && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 shadow-sm">
                  <div className="flex items-center gap-1.5"><Flame size={13} className="text-red-600" /><p className="text-[11px] font-black text-red-700">特别推荐 · 借鉴价值{specialRecommendation.level}</p></div>
                  <p className="mt-1 text-[10px] leading-relaxed text-red-700">{specialRecommendation.message}</p>
                </div>
              )}
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <Lightbulb size={11} className="text-accent" />
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">爆款核心原因 · 前 10 秒五维拆解</p>
                </div>
                <div className="space-y-1.5">
                  {analysis.firstTenSeconds.map((item, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                      <span className="mt-px flex-shrink-0 text-[11px] font-bold text-accent">{item.dimension}</span>
                      {item.dimension === '画面' ? (
                        <div className="space-y-0.5 text-[11px] leading-snug text-text-secondary">
                          {conciseLines(item.detail, 6, 32).map((line, idx) => <p key={idx}>{line}</p>)}
                        </div>
                      ) : (
                        <p className="text-[11px] leading-snug text-text-secondary">{shortenText(item.detail, 96)}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeBookmark === 'frames' && (
            <motion.div key="frames" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Film size={11} className="text-accent" />
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">自动分镜素材匹配</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-text-muted">
                    {materialLoading ? '读取本地素材中...' : `${matchedCount}/${frameMatches.length} 已匹配`}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                {frameMatches.map((match, i) => {
                  const key = `${match.detail.time}-${i}`;
                  const hasMaterial = Boolean(match.material);
                  return (
                    <div key={key} className={`rounded-xl border p-3 ${match.decision === 'copy_now' ? 'border-green-200 bg-green-50/60' : match.decision === 'drop' ? 'border-border bg-surface-2/60' : 'border-accent-100 bg-accent-50/40'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white">{match.detail.time}</span>
                            <span className="text-[11px] font-black text-text-primary">{match.viralDna.purpose}</span>
                          </div>
                          <p className="mt-1 text-[10px] text-text-muted">{match.detail.shot} · {match.detail.camera}</p>
                        </div>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-orange-100 bg-white px-2.5 py-2">
                          <div className="flex items-center justify-between"><span className="text-[9px] font-bold text-orange-700">爆款潜力</span><span className="text-sm font-black text-orange-600">{frameScoreGrade(match.viralPotential.score)}</span></div>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-orange-100"><div className="h-full rounded-full bg-orange-500" style={{ width: `${match.viralPotential.score}%` }} /></div>
                        </div>
                        <div className="rounded-lg border border-green-100 bg-white px-2.5 py-2">
                          <div className="flex items-center justify-between"><span className="text-[9px] font-bold text-green-700">可复制性</span><span className="text-sm font-black text-green-600">{frameScoreGrade(match.replicability.score)}</span></div>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-green-100"><div className="h-full rounded-full bg-green-500" style={{ width: `${match.replicability.score}%` }} /></div>
                        </div>
                      </div>

                      <div className="mt-2 rounded-lg border border-border bg-white/90 px-2.5 py-2">
                        <p className="text-[9px] font-black text-text-primary">为什么有效</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">{match.viralPotential.whyEffective}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">{match.viralPotential.mechanisms.map(item => <span key={item} className="rounded bg-orange-50 px-1.5 py-0.5 text-[9px] font-bold text-orange-700">{item}</span>)}</div>
                      </div>

                      <div className="mt-2 rounded-lg border border-border bg-white/90 px-2.5 py-2">
                        <p className="text-[9px] font-black text-text-primary">必须保留</p>
                        <div className="mt-1 space-y-0.5">{match.viralDna.mustPreserve.slice(0, 4).map(item => <p key={item} className="text-[10px] leading-relaxed text-text-secondary">✓ {item}</p>)}</div>
                      </div>

                      <div className="mt-2 rounded-lg border border-green-100 bg-green-50/70 px-2.5 py-2">
                        <p className="text-[9px] font-black text-green-800">企业替换与执行</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">{match.viralDna.replaceable.join('；')}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[9px] font-bold">
                          <span className="rounded bg-white px-1.5 py-0.5 text-text-secondary">真实素材覆盖 {match.replicability.localCoverage}%</span>
                          <span className="rounded bg-white px-1.5 py-0.5 text-text-secondary">执行可行性 {AI_FEASIBILITY_LABELS[match.replicability.aiFeasibility]}</span>
                          <span className={`rounded bg-white px-1.5 py-0.5 ${hasMaterial ? 'text-green-700' : 'text-amber-700'}`}>{hasMaterial ? '已有候选片段' : '缺少真实片段'}</span>
                        </div>
                        {match.replicability.blockers.length > 0 && <p className="mt-1.5 text-[10px] leading-relaxed text-amber-700">阻塞：{match.replicability.blockers.join('；')}</p>}
                      </div>

                      <details className="mt-2 rounded-lg border border-border bg-white/80 px-2.5 py-2">
                        <summary className="cursor-pointer text-[10px] font-bold text-text-secondary">查看原分镜与素材匹配详情</summary>
                        <div className="mt-2 space-y-2 border-t border-border pt-2">
                          <p className="text-[10px] leading-relaxed text-text-secondary"><span className="font-bold">原画面：</span>{match.detail.visual}</p>
                          {hasMaterial && match.material ? <>
                            <div className="flex gap-2">
                              <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-surface-2">
                                {match.material.url ? <video src={`${match.material.url}#t=${match.segment?.start ?? 0.1}`} poster={match.segment?.poster || match.material.poster} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : match.material.poster ? <img src={match.material.poster} alt="" className="h-full w-full object-cover" /> : <Film size={14} className="m-auto mt-7 text-text-muted" />}
                              </div>
                              <div className="min-w-0 flex-1"><p className="truncate text-[10px] font-bold text-text-primary">{match.material.name}</p><p className="mt-1 text-[9px] text-text-muted">{match.reason}</p>{match.trim && <p className="mt-1 text-[10px] font-bold text-green-700">{match.trim.label}</p>}</div>
                            </div>
                            {match.scores && <div className="grid grid-cols-4 gap-1 text-center text-[9px] font-semibold text-text-muted">
                              <span className="rounded bg-surface-2 px-1 py-0.5">功能 {match.scores.function}</span><span className="rounded bg-surface-2 px-1 py-0.5">动作 {match.scores.action}</span><span className="rounded bg-surface-2 px-1 py-0.5">主体 {match.scores.subject}</span><span className="rounded bg-surface-2 px-1 py-0.5">构图 {match.scores.composition}</span><span className="rounded bg-surface-2 px-1 py-0.5">运镜 {match.scores.camera}</span><span className="rounded bg-surface-2 px-1 py-0.5">时长 {match.scores.duration}</span><span className="rounded bg-surface-2 px-1 py-0.5">质量 {match.scores.quality}</span><span className="rounded bg-surface-2 px-1 py-0.5">企业适配 {match.scores.enterpriseFit}</span>
                            </div>}
                            {match.segment && !match.segment.manualConfirmed && <button type="button" onClick={() => void confirmMatchedSegment(match)} className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-[10px] font-bold text-green-700"><Check size={10} />人工确认片段</button>}
                          </> : <p className="text-[10px] leading-relaxed text-accent-800">{match.suggestion}</p>}
                        </div>
                      </details>

                      {!hasMaterial && match.replicability.recommendedExecution === 'reshoot' && <p className="mt-2 rounded-lg bg-white px-2.5 py-2 text-[10px] font-bold text-amber-700">待拍任务：{match.suggestion}</p>}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {activeBookmark === 'script' && (
            <motion.div key="script" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5"><FileText size={11} className="text-accent" /><p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">导演分镜脚本详析</p></div>
                <div className="flex items-center gap-2">
                  {analysisSaveNotice && <span className="text-[10px] text-text-muted">{analysisSaveNotice}</span>}
                  {editingAnalysis ? <><button onClick={() => setEditingAnalysis(false)} className="text-[10px] font-bold text-text-muted">取消</button><button onClick={() => void saveAnalysisCorrections()} disabled={savingAnalysis} className="rounded-lg bg-accent px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-50">{savingAnalysis ? '保存中…' : '保存修正'}</button></> : <button onClick={() => setEditingAnalysis(true)} className="rounded-lg border border-border bg-white px-2.5 py-1 text-[10px] font-bold text-text-secondary">编辑校对</button>}
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="space-y-1 border-b border-border bg-surface-2 px-3 py-2.5">
                  <p className="text-[11px] leading-relaxed text-text-secondary"><span className="font-semibold text-text-primary">基础要求：</span>{analysis.baseRequirements}</p>
                  <p className="text-[11px] text-text-secondary"><span className="font-semibold text-text-primary">指定画风：</span>{analysis.scriptSummary15s.visualStyle}</p>
                  <p className="text-[11px] text-text-secondary"><span className="font-semibold text-text-primary">核心情绪：</span>{analysis.scriptSummary15s.coreEmotion}</p>
                  <p className="text-[11px] text-text-secondary">
                    <span className="font-semibold text-text-primary">参考品牌/竞品：</span>
                    {analysis.scriptSummary15s.competitors.length
                      ? analysis.scriptSummary15s.competitors.map(item => `==${item}==`).join('；')
                      : '未提取到可确认品牌/竞品'}
                  </p>
                </div>
                <div className="divide-y divide-border">
                  {analysis.scriptDetails15s.map((item, i) => (
                    <div key={`${item.time}-${i}`} className="px-3 py-2.5">
                      {editingAnalysis ? <div className="grid grid-cols-2 gap-2">
                        <input value={item.time} onChange={event => updateDetail(i, { time: event.target.value })} className="rounded-lg border border-border px-2 py-1.5 text-[10px]" placeholder="时间区间" />
                        <input value={item.purpose || ''} onChange={event => updateDetail(i, { purpose: event.target.value })} className="rounded-lg border border-border px-2 py-1.5 text-[10px]" placeholder="镜头功能" />
                        <textarea value={item.visual} onChange={event => updateDetail(i, { visual: event.target.value })} className="col-span-2 rounded-lg border border-border px-2 py-1.5 text-[10px]" rows={2} placeholder="画面" />
                        <textarea value={item.dialogue || ''} onChange={event => updateDetail(i, { dialogue: event.target.value })} className="rounded-lg border border-border px-2 py-1.5 text-[10px]" rows={2} placeholder="口播" />
                        <textarea value={item.onScreenText || ''} onChange={event => updateDetail(i, { onScreenText: event.target.value })} className="rounded-lg border border-border px-2 py-1.5 text-[10px]" rows={2} placeholder="屏幕文字" />
                        <input value={item.note || ''} onChange={event => updateDetail(i, { note: event.target.value, needsReview: Boolean(event.target.value) })} className="col-span-2 rounded-lg border border-border px-2 py-1.5 text-[10px]" placeholder="人工复核备注；清空表示已确认" />
                      </div> : <p className="text-[11px] leading-relaxed text-text-secondary">
                        <span className="font-mono font-semibold text-accent">[{item.time}]</span>{' '}
                        环境：{item.environment}；景别：{item.shot}；运镜：{item.camera}；{item.purpose ? `镜头功能：${item.purpose}；` : ''}画面：{item.visual}；{(item.dialogue || item.subtitle) ? `口播：“${item.dialogue || item.subtitle}”；` : ''}{item.onScreenText ? `屏幕文字：“${item.onScreenText}”；` : ''}配乐：{item.bgm || item.audio || '按原片节奏卡点'}
                        {item.note ? `（注：${item.note}）` : ''}
                      </p>}
                      {item.beats?.length ? <div className="mt-1.5 space-y-1 border-l-2 border-accent/30 pl-2">{item.beats.map((beat, beatIndex) => <p key={beatIndex} className="text-[10px] text-text-muted">[{beat.time || '镜头内'}] {beat.action}{beat.dialogue ? `；口播：${beat.dialogue}` : ''}{beat.onScreenText ? `；字幕：${beat.onScreenText}` : ''}</p>)}</div> : null}
                      {item.needsReview && <p className="mt-1 text-[10px] font-semibold text-amber-500">需人工复核 · 识别置信度 {Math.round((item.confidence ?? 0) * 100)}%</p>}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeBookmark === 'adapt' && (
            <motion.div key="adapt" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="space-y-3">
              <div className="rounded-xl border border-dashed p-3"
                style={{ borderColor: 'rgba(22,163,74,0.3)', background: 'rgba(22,163,74,0.04)' }}>
                <p className="mb-1.5 text-[10px] font-semibold text-accent">改编建议</p>
                <p className="text-[11px] leading-relaxed text-text-secondary">{analysis.adaptTip}</p>
              </div>
              <div className="rounded-xl border border-border bg-surface-2 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">可复用爆点</p>
                <div className="flex flex-wrap gap-1.5">
                  {referenceHighlights(video, analysis).slice(0, 6).map((item, index) => (
                    <span key={`${item}-${index}`} className="rounded-full border border-border bg-white px-2 py-1 text-[10px] font-semibold text-text-secondary">
                      {shortenText(item, 28)}
                    </span>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-shrink-0 border-t border-border bg-surface p-4 shadow-[0_-10px_24px_rgba(15,23,42,0.04)]">
        {video.contentFormat !== 'image' && <div className="mb-3 rounded-xl border border-accent/20 bg-accent/5 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-black text-text-primary">{video.aiAnalysis?.analysisMode === 'exact' ? '全片精确分析版' : '全片策略分析版'}</p>
            {video.aiAnalysis?.analysisMode !== 'exact' && <button type="button" onClick={onExactAnalysis} disabled={video.aiAnalysis?.requestedAnalysisMode === 'exact'} className="shrink-0 rounded-lg border border-accent bg-white px-2.5 py-1.5 text-[10px] font-black text-accent hover:bg-accent/5 disabled:cursor-wait disabled:opacity-50">{video.aiAnalysis?.requestedAnalysisMode === 'exact' ? '精确分析生成中…' : '生成全片精确分析'}</button>}
          </div>
          {actionNotice && <p role="status" aria-live="polite" className="mt-2 rounded-lg border border-accent/20 bg-white px-2.5 py-2 text-[10px] font-semibold leading-relaxed text-text-secondary">{actionNotice}</p>}
          {video.aiAnalysis?.videoLevelFailureStatus && !video.aiAnalysis?.requestedAnalysisMode && <p role="status" aria-live="polite" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-semibold leading-relaxed text-amber-700">全片精确分析未完成，已保留原分析。可稍后重试，或换用可直接下载的公开素材。</p>}
        </div>}
        {video.contentFormat === 'image' && !hasTrustedImageAnalysis && <button type="button" onClick={() => void reanalyzeImage()} disabled={reanalyzingImage} className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 py-2 text-xs font-black text-emerald-700 disabled:opacity-50">{reanalyzingImage ? <Loader2 size={13} className="animate-spin"/> : <Images size={13}/>}重新分析完整轮播</button>}
        {analysisSaveNotice && video.contentFormat === 'image' && <p className="mb-2 text-center text-[10px] text-red-500">{analysisSaveNotice}</p>}
        <button onClick={() => onGenerateScript(analysis || undefined)} disabled={video.contentFormat === 'image' && !hasTrustedImageAnalysis}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-black text-white transition-all enabled:hover:scale-[1.01] enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #16a34a, #059669)', boxShadow: '0 10px 24px rgba(22,163,74,0.26)' }}>
          <Sparkles size={16} />
          {video.contentFormat === 'image' ? (hasTrustedImageAnalysis ? '套用企业资料生成获客内容包' : '先完成图片分析') : 'AI一键爆款迭代'}
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ── Script Panel ──────────────────────────────────────────────────────────────
interface ScriptPanelProps {
  video: TrendVideo;
  activePanelTab: 'analysis' | 'generate';
  onClose: () => void;
  onRetry?: () => void;
  onExactAnalysis?: () => void;
  actionNotice?: string;
  onFavorite?: () => void;
  favoriting?: boolean;
  specialRecommendation?: AccountSpecialRecommendation | null;
  onNavigate?: (p: Page) => void;
  onEnterWorkflow?: (payload: {
    source?: string;
    script?: string;
    video: TrendVideo;
    scriptType?: ScriptType;
    language?: string;
    productInfo?: string;
    generatedVideo?: GeneratedVideo;
    referenceAnalysis?: {
      title?: string;
      visualStyle?: string;
      coreEmotion?: string;
      details?: { time: string; shot: string; camera: string; visual: string; subtitle?: string; audio?: string; note?: string }[];
    };
  }) => void;
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

function ScriptPanel({ video, activePanelTab, onClose, onRetry, onExactAnalysis, actionNotice, onFavorite, favoriting, specialRecommendation, onNavigate, onEnterWorkflow }: ScriptPanelProps) {
  const [activeTab, setActiveTab] = useState<'analysis' | 'generate'>(activePanelTab);
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
  const [videoVersions, setVideoVersions] = useState<VideoGenerationVersion[]>([]);
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
    loadEnterpriseProducts();
  }, [video.id]);

  useEffect(() => {
    if (activePanelTab) setActiveTab('analysis');
  }, [activePanelTab, video.id]);

  useEffect(() => {
    setResult(null);
    setCopied(false);
    setShowLangDropdown(false);
    setVideoResult(null);
    setVideoError('');
    setProductInfoOpen(false);
    void studioApi.listVideoVersions(`inspiration:${video.id}:full`).then(versions => {
      setVideoVersions(versions);
      const item = versions.find(version => version.isSelected) || versions[0];
      if (item) setVideoResult({ id: item.materialId || item.id, title: item.title, url: item.url, poster: item.poster, duration: item.duration, createdAt: item.createdAt, source: item.source });
    });
  }, [video.id]);

  useEffect(() => {
    setVoiceLanguageConfirmed(false);
  }, [language, scriptType, video.id]);

  useEffect(() => {
    if (!isDemoTrafficStep()) return;
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
    const realAnalysis = getAnalysis(video);
    const analyzedDuration = (realAnalysis?.scriptDetails15s || []).reduce((max, item) => {
      const values = String(item.time || '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
      return Math.max(max, values[1] ?? values[0] ?? 0);
    }, 0);
    const fullVideoDuration = Math.max(1, Math.ceil(video.duration || analyzedDuration || 15));
    const languageLabel = LANGUAGES.find(l => l.code === language)?.label;
    const fallbackScript = makeFallbackScript(video, realAnalysis, productInfo, languageLabel, language, scriptType);
    try {
      const response = await studioApi.script(
        {
          materials: [
            `参考视频标题仅用于提炼节奏，不得复述：${shortenText(video.title, 80)}`,
            `平台：${video.platform}`,
            video.views ? `热度：${video.views}` : '',
            video.tags.length ? `标签仅用于判断受众，不得原样输出：${video.tags.slice(0, 8).join('、')}` : '',
          ].filter(Boolean),
          productInfo,
          language,
          platform: video.platform,
          duration: fullVideoDuration,
          scriptType,
          referenceTitle: video.title,
          referenceAnalysis: referenceAnalysisText(video, realAnalysis),
          referenceHighlights: referenceHighlights(video, realAnalysis),
          tone: '真实、可拍、B2B询盘导向，避免空泛营销话术',
        },
        fallbackScript,
      );
      setResult(response.script || fallbackScript);
      if (shouldAdvanceDemo) {
        completeDemoStep('traffic');
        window.setTimeout(() => onNavigate?.('conversion'), 700);
      }
    } catch {
      setResult(fallbackScript);
      if (shouldAdvanceDemo) {
        completeDemoStep('traffic');
        window.setTimeout(() => onNavigate?.('conversion'), 700);
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    if (result) { void navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const generateSeedanceVideo = async () => {
    if (!result) return;
    if (seedanceVideoLocked) return;
    setVideoGenerating(true);
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
        generationGroupKey: `inspiration:${video.id}:full`,
        generationContext: { entry: 'inspiration-full', videoId: video.id, scriptType, language },
        parentVersionId: videoVersions.find(item => item.isSelected)?.id,
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
      if (output.version) setVideoVersions(current => [output.version!, ...current.map(item => ({ ...item, isSelected: false }))]);
    } catch (err: any) {
      setVideoError(String(err?.message || err || 'Seedance 视频生成失败'));
    } finally {
      setVideoGenerating(false);
    }
  };

  const enterWorkflow = () => {
    if (!result || !videoResult) return;
    onEnterWorkflow?.({ source: 'seedance_video', script: result, video, scriptType, language, productInfo, generatedVideo: videoResult });
  };

  const enterQuickCutFromAnalysis = (confirmedAnalysis?: ScriptAnalysis) => {
    const realAnalysis = confirmedAnalysis || getAnalysis(video);
    onEnterWorkflow?.({
      source: video.contentFormat === 'image' ? 'inspiration_image_post' : 'inspiration_analysis',
      video,
      scriptType: 'storyboard',
      language,
      productInfo,
      referenceAnalysis: realAnalysis ? {
        title: video.title,
        visualStyle: realAnalysis.scriptSummary15s.visualStyle,
        coreEmotion: realAnalysis.scriptSummary15s.coreEmotion,
        details: realAnalysis.scriptDetails15s,
      } : undefined,
    });
    onClose();
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
          <p className="text-[10px] font-mono text-text-muted uppercase tracking-widest mb-1">{video.contentFormat === 'image' ? '竞品图文参考' : 'AI 脚本助手'}</p>
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
          { id: 'analysis' as const, icon: <BarChart2 size={12} />, label: video.contentFormat === 'image' ? '竞品图文拆解' : '脚本分析' },
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
            <AnalysisPanel key={video.id} video={video} onGenerateScript={enterQuickCutFromAnalysis} onRetry={onRetry} onExactAnalysis={onExactAnalysis} actionNotice={actionNotice} specialRecommendation={specialRecommendation} />
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
                                {videoVersions.length > 0 && <div className="mt-2 flex flex-wrap gap-1">
                                  {videoVersions.map(item => <button key={item.id} type="button" onClick={async () => {
                                    await studioApi.selectVideoVersion(item.id);
                                    setVideoVersions(current => current.map(v => ({ ...v, isSelected: v.id === item.id })));
                                    setVideoResult({ id: item.materialId || item.id, title: item.title, url: item.url, poster: item.poster, duration: item.duration, createdAt: item.createdAt, source: item.source });
                                  }} className={`rounded-md border px-2 py-1 text-[10px] font-bold ${item.isSelected ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-muted'}`}>V{item.versionNumber}</button>)}
                                </div>}
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
  const crawlRule = video.aiAnalysis?.crawlRule || '关键词检索';
  const isImagePost = video.contentFormat === 'image';
  const imageAnalyzed = video.aiAnalysis?.imageEvidence?.status === 'analyzed' && Boolean(video.aiAnalysis.imageEvidence.observedFacts?.length);
  const imageFailed = video.aiAnalysis?.imageAnalysisStatus === 'failed' || video.status === 'failed';
  const trendLabel = isImagePost
    ? (imageAnalyzed ? '✓ 已完成拆解' : imageFailed ? '! 分析失败' : '… 待分析')
    : video.trend === 'hot' ? '🔥 热门' : video.trend === 'rising' ? '↑ 上升' : '— 平稳';
  const trendColor = isImagePost
    ? (imageAnalyzed ? 'text-green' : imageFailed ? 'text-red-500' : 'text-text-muted')
    : video.trend === 'hot' ? 'text-accent' : video.trend === 'rising' ? 'text-green' : 'text-text-muted';
  const crawledDate = video.crawledAt ? new Date(video.crawledAt) : null;
  const crawledLabel = crawledDate && !Number.isNaN(crawledDate.getTime())
    ? `${String(crawledDate.getMonth() + 1).padStart(2, '0')}-${String(crawledDate.getDate()).padStart(2, '0')} 入库`
    : '';

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
        {video.videoUrl
          ? <AuthenticatedVideo apiUrl={video.videoUrl} poster={video.thumbnail} hoverPlay className="absolute inset-0 w-full h-full object-cover" />
          : video.thumbnail
          ? <ThumbnailImage src={video.thumbnail} platform={video.platform} title={video.title} className="absolute inset-0 w-full h-full object-cover" />
          : <VideoThumbnail platform={video.platform} title={video.title} />}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-neutral-900">
            {isImagePost ? <Images size={11} /> : <Play size={11} fill="currentColor" />}{isImagePost ? '查看' : video.videoUrl ? '观看' : '原站'}
          </span>
          {isImagePost && <button onClick={e => { e.stopPropagation(); onSelect(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
            style={{ background: meta.bg, color: meta.color }}>
            <Sparkles size={11} />拆解图文
          </button>}
          {!isImagePost && <button onClick={e => { e.stopPropagation(); if (onAnalyzeVideo) onAnalyzeVideo(); else onSelect(); }}
            disabled={analyzingVideo}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
            style={{ background: meta.bg, color: meta.color }}>
            {analyzingVideo ? <Loader2 size={11} className="animate-spin" /> : <BarChart2 size={11} />}分析脚本
          </button>}
          {video.sourceUrl && !isImagePost && (
            <button onClick={e => { e.stopPropagation(); onFavoriteMaterial?.(); }}
              disabled={favoritingMaterial}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white/90 text-neutral-900 disabled:opacity-70">
              {favoritingMaterial ? <Loader2 size={11} className="animate-spin" /> : <Bookmark size={11} />}收藏
            </button>
          )}
        </div>
        <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold text-white bg-black/50 backdrop-blur-sm">
          {isImagePost ? '图文' : `${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, '0')}`}
        </div>
        <div className="absolute bottom-2 right-2 max-w-[60%] truncate px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white bg-black/55 backdrop-blur-sm">
          {crawlRule}
        </div>
        <div className="absolute top-2 left-2">
          <span className="platform-badge text-[10px]" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
          {video.id.startsWith('material-') && (
            <span className="mt-1 block rounded-md bg-green-600 px-1.5 py-0.5 text-[9px] font-black text-white shadow-sm">置顶 · 片段已分析</span>
          )}
        </div>
        {crawledLabel && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold text-white bg-black/50 backdrop-blur-sm"
            title={`爬取入库时间：${crawledDate!.toLocaleString()}`}>
            {crawledLabel}
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="text-xs font-semibold text-text-primary leading-snug line-clamp-2 mb-2">{video.title}</p>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-[10px] font-mono font-bold ${trendColor}`}>{trendLabel}</span>
          <span className="flex items-center gap-1 text-[10px] text-text-muted">{isImagePost ? <Images size={9} /> : <Clock size={9} />}{isImagePost ? `${video.aiAnalysis?.imageCount || video.aiAnalysis?.imageUrls?.length || 1} 张` : `${video.views} views`}</span>
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
  const trendColor = video.trend === 'hot' ? 'text-accent' : video.trend === 'rising' ? 'text-green' : 'text-text-muted';
  const trendLabel = video.trend === 'hot' ? '热门' : video.trend === 'rising' ? '上升' : '平稳';
  const crawlRule = video.aiAnalysis?.crawlRule || '关键词检索';
  const isImagePost = video.contentFormat === 'image';
  return (
    <div className={`flex items-center gap-4 px-4 py-3 cursor-pointer transition-all group ${isSelected ? 'bg-accent-glow' : 'hover:bg-surface-2'}`} onClick={onSelect}>
      <button type="button" onClick={e => { e.stopPropagation(); onWatch(); }}
        className="w-16 h-10 rounded-lg overflow-hidden flex-shrink-0 border border-border bg-surface-2 relative group/thumb">
        {video.thumbnail
          ? <ThumbnailImage src={video.thumbnail} platform={video.platform} title={video.title} className="w-full h-full object-cover" />
          : <VideoThumbnail platform={video.platform} title={video.title} />}
        <span className="absolute inset-0 bg-black/35 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center text-white">
          {isImagePost ? <Images size={13} /> : <Play size={13} fill="currentColor" />}
        </span>
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="platform-badge text-[9px]" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
          {video.id.startsWith('material-') && <span className="rounded bg-green-100 px-1.5 py-0.5 text-[9px] font-bold text-green-700">置顶 · 片段已分析</span>}
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
        <p className="text-xs font-mono text-text-secondary">{isImagePost ? '图文' : `${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, '0')}`}</p>
        <p className="text-[10px] text-text-muted">{video.views}</p>
      </div>
      {isImagePost && <button onClick={e => { e.stopPropagation(); onSelect(); }}
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all opacity-0 group-hover:opacity-100"
        style={{ color: 'var(--color-accent)', borderColor: 'rgba(22,163,74,0.25)', background: 'var(--color-accent-glow)' }}>
        <Sparkles size={11} /><span>拆解图文</span>
      </button>}
      {!isImagePost && <button onClick={e => { e.stopPropagation(); if (onAnalyzeVideo) onAnalyzeVideo(); else onSelect(); }}
        disabled={analyzingVideo}
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all opacity-0 group-hover:opacity-100"
        style={{ color: 'var(--color-accent)', borderColor: 'rgba(22,163,74,0.25)', background: 'var(--color-accent-glow)' }}>
        {analyzingVideo ? <Loader2 size={11} className="animate-spin" /> : <BarChart2 size={11} />}<span>分析脚本</span>
      </button>}
      {video.sourceUrl && !isImagePost && (
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
      if (!analysis.gemini && analysis.contentFormat !== 'image') {
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
        // videoFileId 本身就是 PocketBase 文件存在的权威凭据；不要再依赖可缺失的迁移标记。
        videoUrl: record.videoFileId ? `/api/overseas/videos/${record.id}/media-url` : undefined,
        sourceUrl: record.sourceUrl,
        status: record.status,
        aiAnalysis: analysis,
        crawledAt: record.crawledAt,
        contentFormat: contentFormatOfAnalysis(analysis),
      };
    })
    // 历史记录在后台回填 PocketBase 时仍展示封面，避免管理员视频池因存储迁移暂时变成空列表。
    // 同一 sourceUrl 只保留一条（demo 数据/多次采集可能带来 id 不同的重复视频）
    .filter((video, index, all) => !video.sourceUrl || all.findIndex(v => v.sourceUrl === video.sourceUrl) === index)
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

function metadataPanelFallback(video: TrendVideo): TrendVideo {
  if (video.aiAnalysis?.analysisSource === 'metadata-fallback' && video.aiAnalysis?.analysisQuality === 'metadata') {
    return video;
  }
  return {
    ...video,
    aiAnalysis: {
      ...(video.aiAnalysis || {}),
      gemini: metadataFallbackAnalysis(video.title, video.platform, video.tags, video.views, video.duration),
      analysisSource: 'metadata-fallback',
      analysisQuality: 'metadata',
      geminiStatus: 'metadata_fallback',
      downloadStatus: 'metadata_only',
    },
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

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function reliablePublicViews(value: string): number {
  if (!/\d/.test(value) || /shares?|likes?|facebook|instagram|tiktok|youtube|本地素材/i.test(value)) return 0;
  return heatValue(value);
}

function specialRecommendationForVideo(video: TrendVideo, accountVideos: TrendVideo[], accountMedians: number[]): AccountSpecialRecommendation | null {
  const analysis = video.aiAnalysis;
  if (!analysis?.sourceAccount) return null;
  const currentViews = reliablePublicViews(video.views);
  const history = accountVideos.map(item => reliablePublicViews(item.views)).filter(value => value > 0);
  if (!currentViews || history.length < 8) return null;
  const baselineValue = median(history);
  if (!baselineValue) return null;
  const multiple = currentViews / baselineValue;
  let baselineLevel = analysis.accountBaselineLevel;
  if (!baselineLevel && accountMedians.length >= 3) {
    const sorted = [...accountMedians].sort((a, b) => a - b);
    const percentile = sorted.filter(value => value <= baselineValue).length / sorted.length;
    baselineLevel = percentile <= .3 ? 'low' : percentile <= .7 ? 'medium' : 'high';
  }
  if (!baselineLevel) return null;
  const baseline = baselineLevel === 'low' ? '低基线账号' : baselineLevel === 'medium' ? '中基线账号' : '高基线账号';
  const level = baselineLevel === 'low' && multiple >= 10 ? '极高'
    : baselineLevel === 'low' && multiple >= 5 ? '高'
    : baselineLevel === 'medium' && multiple >= 5 ? '高'
    : baselineLevel === 'high' && multiple >= 3 ? '较高' : null;
  if (!level) return null;
  return { level, baseline, multiple, message: `${baseline}跑出日常 ${multiple.toFixed(1)} 倍播放，内容结构具有${level}借鉴价值，建议优先拆解复用。` };
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
            <AuthenticatedVideo apiUrl={video.videoUrl} poster={video.thumbnail} controls autoPlay className="w-full max-h-[72vh] bg-black" />
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
  onEnterWorkflow?: (payload: {
    source?: string;
    script?: string;
    video: TrendVideo;
    scriptType?: ScriptType;
    language?: string;
    productInfo?: string;
    generatedVideo?: GeneratedVideo;
    referenceAnalysis?: {
      title?: string;
      visualStyle?: string;
      coreEmotion?: string;
      details?: { time: string; shot: string; camera: string; visual: string; subtitle?: string; audio?: string; note?: string }[];
    };
  }) => void;
}

export default function InspirationDashboard({ onScriptPanelOpen, onScriptPanelClose, onNavigate, onEnterWorkflow }: InspirationDashboardProps) {
  const [innerView, setInnerView] = useState<InspirationInnerView>('inspiration');
  const [platform, setPlatform] = useState<Platform>('all');
  const [search, setSearch] = useState('');
  const [selectedVideo, setSelectedVideo] = useState<TrendVideo | null>(null);
  const [scriptPanelTab, setScriptPanelTab] = useState<'analysis' | 'generate'>('analysis');
  const [watchVideo, setWatchVideo] = useState<TrendVideo | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortMode, setSortMode] = useState<SortMode>('crawlTime');
  const [contentFormat, setContentFormat] = useState<ContentFormat>('video');
  const [crawledVideos, setCrawledVideos] = useState<TrendVideo[]>([]);
  const [videoPage, setVideoPage] = useState(1);
  const [videoTotalPages, setVideoTotalPages] = useState(1);
  const [videosLoading, setVideosLoading] = useState(false);
  const [lastCrawlVideoIds, setLastCrawlVideoIds] = useState<string[]>([]);
  const [analyzingVideoIds, setAnalyzingVideoIds] = useState<string[]>([]);
  const [favoritingMaterialIds, setFavoritingMaterialIds] = useState<string[]>([]);
  const [materialMessage, setMaterialMessage] = useState('');
  const [localMaterials, setLocalMaterials] = useState<Material[]>([]);
  const [previewMaterial, setPreviewMaterial] = useState<Material | null>(null);
  const [materialSearch, setMaterialSearch] = useState('');
  const [materialIndustry, setMaterialIndustry] = useState<MaterialIndustryFilter>('all');
  const [materialFunction, setMaterialFunction] = useState('all');
  const [materialApplicability, setMaterialApplicability] = useState<MaterialApplicabilityFilter>('all');
  const [materialOrientation, setMaterialOrientation] = useState<MaterialOrientationFilter>('all');
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [uploadingMaterial, setUploadingMaterial] = useState(false);
  const [generatingNeedId, setGeneratingNeedId] = useState('');
  const [showAccountsModal, setShowAccountsModal] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const videoRequestRef = useRef(0);
  const platformLabel = PLATFORM_FILTERS.find(f => f.id === platform)?.label ?? '全部平台';
  const sortLabel = sortMode === 'crawlTime' ? '按爬取时间' : '按热度';
  const contentFormatLabel = contentFormat === 'video' ? '视频' : '图文';

  useEffect(() => {
    if (selectedVideo) { onScriptPanelOpen?.(); }
    else { onScriptPanelClose?.(); }
  }, [selectedVideo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up on unmount
  useEffect(() => () => { onScriptPanelClose?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshMaterials = async () => {
    setMaterialsLoading(true);
    try {
      setLocalMaterials(await studioApi.listMaterials());
    } finally {
      setMaterialsLoading(false);
    }
  };

  useEffect(() => { void refreshMaterials(); }, []);

  // Warm the heavier cross-tenant image index while the default video screen is
  // already usable. This moves the only cold scan off the user's format switch;
  // non-admin tenants simply receive a cheap 403 and continue with tenant data.
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch('/api/overseas/admin/inspiration-videos?page=1&perPage=20&contentFormat=image', {
        headers: authHeader(),
        signal: controller.signal,
      }).catch(() => undefined);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const refreshVideos = async (nextPage = 1, append = false, quiet = false) => {
    const requestId = ++videoRequestRef.current;
    if (!quiet) setVideosLoading(true);
    try {
      // Keep the first paint small. Media cards are expensive and the previous 100-item
      // response also forced the admin endpoint to finish a full cross-tenant scan first.
      const perPage = 20;
      const query = `page=${nextPage}&perPage=${perPage}&contentFormat=${contentFormat}`;
      const adminRequest = fetch(`/api/overseas/admin/inspiration-videos?${query}`, {
        headers: authHeader(),
      });
      const r = await fetch(`/api/overseas/videos?${query}`, { headers: authHeader() });
      let data = await r.json().catch(() => ({})) as {
        items?: CrawlerRecord[];
        page?: number;
        totalPages?: number;
      };
      if (!r.ok) data = {};

      const applyResult = (result: typeof data) => {
        if (requestId !== videoRequestRef.current) return;
        const videos = recordsToVideos(result.items || []);
        setVideoPage(Number(result.page || nextPage));
        setVideoTotalPages(Math.max(1, Number(result.totalPages || nextPage)));
        setCrawledVideos(prev => {
          const next = append
            ? [...prev, ...videos.filter(v => !prev.some(old => old.id === v.id || (!!v.sourceUrl && old.sourceUrl === v.sourceUrl)))]
            : videos;
          const unchanged = prev.length === next.length && prev.every((item, index) => {
            const candidate = next[index];
            return candidate
              && item.id === candidate.id
              && item.status === candidate.status
              && item.thumbnail === candidate.thumbnail
              && item.crawledAt === candidate.crawledAt
              && JSON.stringify(item.aiAnalysis || {}) === JSON.stringify(candidate.aiAnalysis || {});
          });
          return unchanged ? prev : next;
        });
      };

      // Render tenant data as soon as it arrives; admins no longer stare at an empty
      // screen while the slower cross-tenant aggregation is still running. Background
      // polling stays atomic so admin pages do not flicker between tenant/admin lists.
      if (data.items && !quiet) applyResult(data);
      if (requestId === videoRequestRef.current && !quiet) setVideosLoading(false);

      const adminResponse = await adminRequest;
      if (adminResponse.ok) {
        const adminData = await adminResponse.json().catch(() => null) as typeof data | null;
        if (adminData) applyResult(adminData);
      } else if (data.items && quiet) {
        applyResult(data);
      } else if (!data.items) {
        throw new Error('视频列表加载失败');
      }
    } catch {
      if (requestId === videoRequestRef.current && !append && !quiet) setCrawledVideos([]);
    } finally {
      if (requestId === videoRequestRef.current && !quiet) setVideosLoading(false);
    }
  };

  useEffect(() => { void refreshVideos(); }, [contentFormat]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasPendingVideos = crawledVideos.some(v =>
    v.status === 'pending' ||
    v.aiAnalysis?.downloadStatus === 'queued' ||
    v.aiAnalysis?.downloadStatus === 'downloading' ||
    v.aiAnalysis?.downloadStatus === 'analyzing' ||
    v.aiAnalysis?.downloadStatus === 'ops_queued'
  );

  useEffect(() => {
    if (!hasPendingVideos) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      if (document.visibilityState === 'visible') await refreshVideos(1, false, true);
      if (!cancelled) timer = window.setTimeout(() => void poll(), 8000);
    };
    timer = window.setTimeout(() => void poll(), 8000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasPendingVideos, contentFormat]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedVideo) return;
    const latest = crawledVideos.find(v => v.id === selectedVideo.id);
    if (selectedVideo.id.startsWith('crawl-')) {
      const next = latest || selectedVideo;
      if (!isDisplayableForFormat(next, contentFormat)) {
        setSelectedVideo(null);
        return;
      }
    }
    if (latest && latest !== selectedVideo) setSelectedVideo(latest);
  }, [crawledVideos, selectedVideo]);

  const pinnedMaterialVideos = useMemo<TrendVideo[]>(() => localMaterials
    .filter(material => material.pinned && material.type === 'video' && material.segmentAnalysisStatus === 'completed' && material.segments?.length)
    .map(material => {
      const platform: TrendVideo['platform'] = /facebook/i.test(material.name) ? 'facebook'
        : /youtube/i.test(material.name) ? 'youtube' : /instagram/i.test(material.name) ? 'instagram' : 'tiktok';
      const title = material.name.replace(/^爆款[·・][^·・]+[·・]/, '').replace(/\.[a-z0-9]+$/i, '');
      return {
        id: `material-${material.id}`,
        platform,
        title,
        thumbnail: material.poster || material.segments?.[0]?.poster || '',
        duration: material.duration,
        tags: ['片段已分析', '置顶素材'],
        views: '本地素材',
        trend: 'hot',
        videoUrl: material.url,
        status: 'analyzed',
        crawledAt: material.createdAt,
        contentFormat: 'video',
        aiAnalysis: {
          source: 'material_segment_analysis',
          materialUrl: material.url,
          materialPoster: material.poster,
          geminiStatus: 'completed',
          analysisQuality: 'segment_grounded',
          analyzedAt: material.createdAt,
          gemini: {
            theme: title,
            structure: material.segments!.map(segment => segment.recommendedFunctions.join('、')).filter(Boolean).join(' → '),
            hooks: material.segments!.slice(0, 2).flatMap(segment => segment.recommendedFunctions),
            mood: '素材片段级分析',
            scriptSummary15s: { visualStyle: '真实本地视频素材', coreEmotion: '待人工校验', competitors: [] },
            scriptDetails15s: material.segments!.map(segment => ({
              time: `${segment.start}-${segment.end}s`,
              environment: segment.environment,
              shot: segment.shot,
              camera: segment.camera,
              angle: segment.angle,
              composition: segment.composition,
              visual: segment.action,
              subtitle: segment.ocrText,
              onScreenText: segment.ocrText,
              purpose: segment.recommendedFunctions.join('、'),
              authenticity: segment.authenticity,
              confidence: segment.confidence,
              needsReview: segment.needsReview,
            })),
            recommendedScriptType: 'storyboard',
          },
        },
      };
    }), [localMaterials]);
  const pinnedTitles = new Set(pinnedMaterialVideos.map(video => video.title.trim().toLowerCase()));
  const allVideos = [...pinnedMaterialVideos, ...crawledVideos.filter(video => !pinnedTitles.has(video.title.trim().toLowerCase()))];
  const accountRecommendationByVideoId = useMemo(() => {
    const groups = new Map<string, TrendVideo[]>();
    for (const item of crawledVideos) {
      const accountKey = item.aiAnalysis?.sourceAccount;
      if (!accountKey) continue;
      groups.set(accountKey, [...(groups.get(accountKey) || []), item]);
    }
    const accountMedians = Array.from(groups.values())
      .map(items => median(items.map(item => reliablePublicViews(item.views)).filter(value => value > 0)))
      .filter(value => value > 0);
    const recommendations = new Map<string, AccountSpecialRecommendation>();
    for (const items of groups.values()) {
      for (const item of items) {
        const recommendation = specialRecommendationForVideo(item, items, accountMedians);
        if (recommendation) recommendations.set(item.id, recommendation);
      }
    }
    return recommendations;
  }, [crawledVideos]);
  const visibleVideos = allVideos.filter(v =>
    ACTIVE_PLATFORMS.includes(v.platform)
    && isDisplayableForFormat(v, contentFormat)
  );
  const filtered = useMemo(() => {
    const lastCrawlIds = new Set(lastCrawlVideoIds);
    const q = search.trim().toLowerCase();
    return visibleVideos
      .filter(v =>
        (v.id.startsWith('material-') || lastCrawlIds.size === 0 || lastCrawlIds.has(v.id)) &&
        (platform === 'all' || v.platform === platform) &&
        (!q || v.title.toLowerCase().includes(q) || v.tags.some(t => t.toLowerCase().includes(q)))
      )
      .sort((a, b) => {
        const pinnedRank = Number(b.id.startsWith('material-')) - Number(a.id.startsWith('material-'));
        if (pinnedRank) return pinnedRank;
        if (a.id.startsWith('material-') && b.id.startsWith('material-')) {
          return pinnedMaterialVideos.findIndex(item => item.id === a.id) - pinnedMaterialVideos.findIndex(item => item.id === b.id);
        }
        if (contentFormat === 'image') {
          const analyzedRank = Number(b.aiAnalysis?.imageEvidence?.status === 'analyzed') - Number(a.aiAnalysis?.imageEvidence?.status === 'analyzed');
          if (analyzedRank) return analyzedRank;
        }
        if (sortMode === 'crawlTime') {
          return timeValue(b.crawledAt) - timeValue(a.crawledAt) || heatValue(b.views) - heatValue(a.views);
        }
        return heatValue(b.views) - heatValue(a.views) || timeValue(b.crawledAt) - timeValue(a.crawledAt);
      });
  }, [visibleVideos, lastCrawlVideoIds, platform, search, sortMode, pinnedMaterialVideos, contentFormat]);

  const recentThreeDayUploads = visibleVideos.filter(v => {
    const t = v.crawledAt ? new Date(v.crawledAt).getTime() : 0;
    return t > 0 && Date.now() - t <= 3 * 24 * 60 * 60 * 1000;
  }).length;

  const shootingNeeds = useMemo(() => buildShootingNeeds(visibleVideos, localMaterials), [visibleVideos, localMaterials]);
  const materialFunctionOptions = useMemo(() => {
    const values = new Set<string>();
    localMaterials.forEach(material => String(material.shotFunction || '').split(',').map(item => item.trim()).filter(Boolean).forEach(item => values.add(item)));
    return [...values].sort((a, b) => (MATERIAL_FUNCTION_LABELS[a] || a).localeCompare(MATERIAL_FUNCTION_LABELS[b] || b, 'zh-CN'));
  }, [localMaterials]);
  const filteredMaterials = useMemo(() => {
    const q = materialSearch.trim().toLowerCase();
    return localMaterials.filter(material => {
      const functions = String(material.shotFunction || '').split(',').map(item => item.trim());
      const searchable = [material.name, material.folder, material.industry, material.shotFunction, material.applicability, material.tags].filter(Boolean).join(' ').toLowerCase();
      const orientationMatches = materialOrientation === 'all'
        || (materialOrientation === 'vertical' && /竖屏|vertical/i.test(String(material.tags || '')))
        || (materialOrientation === 'horizontal' && /横屏|horizontal/i.test(String(material.tags || '')));
      return (!q || searchable.includes(q))
        && (materialIndustry === 'all' || material.industry === materialIndustry)
        && (materialFunction === 'all' || functions.includes(materialFunction))
        && (materialApplicability === 'all' || material.applicability === materialApplicability)
        && orientationMatches;
    });
  }, [localMaterials, materialSearch, materialIndustry, materialFunction, materialApplicability, materialOrientation]);

  const handleUploadMaterials = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadingMaterial(true);
    setMaterialMessage('');
    try {
      for (const file of Array.from(files)) {
        const type = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'image';
        const dataBase64 = await fileToDataUrl(file);
        await studioApi.uploadMaterial({
          name: file.name,
          folder: 'social',
          type,
          duration: 0,
          dataBase64,
          mimeType: file.type,
        });
      }
      await refreshMaterials();
      setMaterialMessage(`已上传 ${files.length} 个素材到社媒素材库`);
      setTimeout(() => setMaterialMessage(''), 2800);
    } catch (e) {
      setMaterialMessage(e instanceof Error ? e.message : '素材上传失败');
    } finally {
      setUploadingMaterial(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  const generateNeedMaterial = async (need: ShootingNeed) => {
    setGeneratingNeedId(need.id);
    setMaterialMessage('');
    try {
      const output = await studioApi.seedanceVideo({
        script: `${need.title}\n${need.suggestion}\n参考分镜：${need.example?.visual || ''}\n输出 ${need.ratio} 社媒短视频素材。`,
        productInfo: need.suggestion,
        language: 'zh',
        ratio: need.ratio,
        duration: 5,
        resolution: '720p',
        title: `Seedance 2.0 待拍素材 · ${need.title}`,
      });
      if (!output.ok) throw new Error(output.error || 'Seedance 2.0 生成失败');
      await refreshMaterials();
      setMaterialMessage(`Seedance 2.0 已生成素材：${need.title}`);
      setTimeout(() => setMaterialMessage(''), 2800);
    } catch (e) {
      setMaterialMessage(e instanceof Error ? e.message : 'Seedance 2.0 生成失败');
    } finally {
      setGeneratingNeedId('');
    }
  };

  const handlePlatformFilter = (nextPlatform: Platform) => {
    setLastCrawlVideoIds([]);
    setPlatform(nextPlatform);
  };

  const handleContentFormatFilter = (nextFormat: ContentFormat) => {
    setLastCrawlVideoIds([]);
    setSelectedVideo(null);
    setContentFormat(nextFormat);
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

  const toggleScriptPanel = (video: TrendVideo) => {
    setScriptPanelTab('analysis');
    setSelectedVideo(current => current?.id === video.id ? null : video);
  };

  const openScriptAnalysis = (video: TrendVideo) => {
    setMaterialMessage('');
    if (needsVideoEnhancement(video)) void analyzeVideoOnly(video);
    setScriptPanelTab('analysis');
    setSelectedVideo(video);
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

  const requestExactFullAnalysis = async (video: TrendVideo) => {
    if (!video.recordId || analyzingVideoIds.includes(video.id)) return;
    setAnalyzingVideoIds(ids => [...ids, video.id]);
    setMaterialMessage(`已提交全片精确分析：${video.title}`);
    try {
      const response = await fetch(`/api/overseas/videos/${video.recordId}/reanalyze`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ analysisMode: 'exact' }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; status?: string; reused?: boolean };
      if (!response.ok) throw new Error(data.error || '全片精确分析提交失败');
      if (data.status === 'analyzed') {
        const markCompleted = (item: TrendVideo): TrendVideo => ({
          ...item,
          status: 'analyzed',
          aiAnalysis: { ...(item.aiAnalysis || {}), analysisMode: 'exact', requestedAnalysisMode: undefined },
        });
        setCrawledVideos(items => items.map(item => item.id === video.id ? markCompleted(item) : item));
        setSelectedVideo(item => item?.id === video.id ? markCompleted(item) : item);
        setMaterialMessage(data.reused ? '现有全片拆解已达到精确密度，已升级为全片精确分析版。' : '全片精确分析已完成。');
        return;
      }
      const markQueued = (item: TrendVideo): TrendVideo => ({
        ...item,
        status: 'pending',
        aiAnalysis: { ...(item.aiAnalysis || {}), requestedAnalysisMode: 'exact' },
      });
      setCrawledVideos(items => items.map(item => item.id === video.id ? markQueued(item) : item));
      setSelectedVideo(item => item?.id === video.id ? markQueued(item) : item);
    } catch (error) {
      const message = error instanceof Error ? error.message : '全片精确分析提交失败';
      const markFailed = (item: TrendVideo): TrendVideo => ({
        ...item,
        status: item.aiAnalysis?.gemini ? 'analyzed' : 'failed',
        aiAnalysis: { ...(item.aiAnalysis || {}), requestedAnalysisMode: undefined, analysisError: message },
      });
      setCrawledVideos(items => items.map(item => item.id === video.id ? markFailed(item) : item));
      setSelectedVideo(item => item?.id === video.id ? markFailed(item) : item);
      setMaterialMessage(message);
    } finally {
      setAnalyzingVideoIds(ids => ids.filter(id => id !== video.id));
      setTimeout(() => setMaterialMessage(''), 3500);
    }
  };

  return (
    <div className="relative">
      <div className="transition-all duration-300">
        <div className="pointer-events-none absolute left-0 top-48 z-30 flex flex-col gap-2">
          {([
            { id: 'inspiration' as const, label: '爆款灵感', short: '爆款', count: visibleVideos.length, icon: <Flame size={18} /> },
            { id: 'library' as const, label: '社媒素材库', short: '素材', count: localMaterials.length, icon: <Film size={18} /> },
            { id: 'shooting' as const, label: '待拍摄素材', short: '待拍', count: shootingNeeds.length, icon: <Lightbulb size={18} /> },
          ]).map(item => {
            const active = innerView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={`${item.label} · ${item.count}`}
                onClick={() => setInnerView(item.id)}
                className={`pointer-events-auto flex h-28 w-14 flex-col items-center justify-center gap-1.5 rounded-r-2xl border border-l-0 text-[14px] font-black shadow-md transition-all ${
                  active
                    ? 'border-accent/30 bg-accent text-white'
                    : 'border-border bg-white/95 text-slate-500 hover:bg-accent-glow hover:text-accent'
                }`}
              >
                {item.icon}
                <span className="[writing-mode:vertical-rl] tracking-[0.16em] leading-none">{item.short}</span>
              </button>
            );
          })}
        </div>

        <div className="px-6 py-5 pl-[74px]">
            {innerView === 'inspiration' && <div className="mb-4 space-y-2.5">
              <div className="flex items-center gap-2.5">
                <div className="relative min-w-0 flex-1">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                  <input type="text" value={search} onChange={e => { setLastCrawlVideoIds([]); setSearch(e.target.value); }}
                    placeholder="搜索视频标题或标签..."
                    className="h-11 w-full pl-9 pr-4 rounded-xl border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors" />
                </div>
                <button
                  type="button"
                  onClick={() => setShowAccountsModal(true)}
                  className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-accent/30 bg-accent-glow px-3.5 text-sm font-bold text-accent transition-colors hover:bg-accent hover:text-white"
                  title="爬取对标账号主页最新视频"
                >
                  <Users size={15} />
                  <span className="hidden sm:inline">对标账号</span>
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="relative h-14 rounded-2xl border border-border bg-surface shadow-sm transition-colors hover:border-border-bright focus-within:border-accent">
                <Globe size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                <span className="absolute left-11 top-2 text-[11px] font-semibold text-text-muted pointer-events-none">社媒平台</span>
                <select
                  value={platform}
                  onChange={e => handlePlatformFilter(e.target.value as Platform)}
                  aria-label="社媒平台"
                  className="h-full w-full cursor-pointer appearance-none rounded-2xl bg-transparent pl-11 pr-10 pt-4 text-base font-black text-text-primary outline-none"
                >
                  {PLATFORM_FILTERS.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                <span className="sr-only">{platformLabel}</span>
              </div>
              <div className="relative h-14 rounded-2xl border border-border bg-surface shadow-sm transition-colors hover:border-border-bright focus-within:border-accent">
                {contentFormat === 'video'
                  ? <Film size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                  : <Images size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />}
                <span className="absolute left-11 top-2 text-[11px] font-semibold text-text-muted pointer-events-none">内容形式</span>
                <select
                  value={contentFormat}
                  onChange={e => handleContentFormatFilter(e.target.value as ContentFormat)}
                  aria-label="内容形式"
                  className="h-full w-full cursor-pointer appearance-none rounded-2xl bg-transparent pl-11 pr-10 pt-4 text-base font-black text-text-primary outline-none"
                >
                  <option value="video">视频</option>
                  <option value="image">图文</option>
                </select>
                <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                <span className="sr-only">{contentFormatLabel}</span>
              </div>
              <div className="relative h-14 rounded-2xl border border-border bg-surface shadow-sm transition-colors hover:border-border-bright focus-within:border-accent">
                {sortMode === 'heat'
                  ? <Flame size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                  : <Clock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />}
                <span className="absolute left-11 top-2 text-[11px] font-semibold text-text-muted pointer-events-none">排序方法</span>
                <select
                  value={sortMode}
                  onChange={e => { setLastCrawlVideoIds([]); setSortMode(e.target.value as SortMode); }}
                  aria-label="排序方法"
                  className="h-full w-full cursor-pointer appearance-none rounded-2xl bg-transparent pl-11 pr-10 pt-4 text-base font-black text-text-primary outline-none"
                >
                  <option value="crawlTime">按爬取时间</option>
                  <option value="heat">按热度</option>
                </select>
                <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                <span className="sr-only">{sortLabel}</span>
              </div>
              <div className="relative h-14 rounded-2xl border border-border bg-surface shadow-sm transition-colors hover:border-border-bright focus-within:border-accent">
                {viewMode === 'grid'
                  ? <LayoutGrid size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                  : <List size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />}
                <span className="absolute left-11 top-2 text-[11px] font-semibold text-text-muted pointer-events-none">大屏视图</span>
                <select
                  value={viewMode}
                  onChange={e => setViewMode(e.target.value as 'grid' | 'list')}
                  aria-label="大屏视图"
                  className="h-full w-full cursor-pointer appearance-none rounded-2xl bg-transparent pl-11 pr-10 pt-4 text-base font-black text-text-primary outline-none"
                >
                  <option value="grid">卡片视图</option>
                  <option value="list">列表视图</option>
                </select>
                <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              </div>
            </div>
          </div>}

        {innerView === 'inspiration' && <div className="mb-4 grid grid-cols-3 gap-3 max-w-xl">
          {[
            { icon: <Zap size={13} />,       label: contentFormat === 'image' ? '图文样本' : '热门视频', value: `${visibleVideos.length}`,    color: 'text-accent' },
            { icon: <TrendingUp size={13} />, label: contentFormat === 'image' ? '已完成拆解' : '上升趋势', value: `${contentFormat === 'image' ? visibleVideos.filter(video => video.aiAnalysis?.imageEvidence?.status === 'analyzed').length : recentThreeDayUploads}`, color: 'text-green' },
            { icon: <Globe size={13} />,      label: '覆盖平台', value: `${new Set(visibleVideos.map(v => v.platform)).size}`,       color: 'text-accent' },
          ].map(stat => (
            <div key={stat.label} className="card p-3 flex items-center gap-2.5">
              <span className={stat.color}>{stat.icon}</span>
              <div>
                <p className="text-base font-bold text-text-primary font-display leading-none">{stat.value}</p>
                <p className="text-[10px] text-text-muted mt-0.5">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>}

        <div>
          {innerView === 'inspiration' && (
            <>
              {filtered.length === 0 ? (
                <div className="min-h-72 rounded-xl border border-dashed border-border bg-surface flex flex-col items-center justify-center gap-3 text-center px-6">
                  <div className="w-11 h-11 rounded-xl bg-surface-2 border border-border flex items-center justify-center text-text-muted">
                    <Download size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text-primary">暂无真实视频数据</p>
                    <p className="text-xs text-text-muted mt-1">请通过「定时任务」采集公开视频，或从对标账号导入真实内容。</p>
                  </div>
                  {localMaterials.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setInnerView('library')}
                      className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white"
                    >
                      <Film size={15} />
                      查看 {localMaterials.length} 条素材
                    </button>
                  )}
                </div>
              ) : viewMode === 'grid' ? (
                // grid 而非 columns 瀑布流：columns 是竖向灌列，横向阅读顺序会打乱排序
                <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 items-start">
                  {filtered.map((video, i) => (
                    <div key={video.id}>
                      <VideoCard video={video} index={i} isSelected={selectedVideo?.id === video.id}
                        onSelect={() => toggleScriptPanel(video)}
                        onWatch={() => handleWatch(video)}
                        onAnalyzeVideo={() => openScriptAnalysis(video)}
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
                      onSelect={() => toggleScriptPanel(video)}
                      onWatch={() => handleWatch(video)}
                      onAnalyzeVideo={() => openScriptAnalysis(video)}
                      onFavoriteMaterial={() => void favoriteMaterial(video)}
                      analyzingVideo={analyzingVideoIds.includes(video.id)}
                      favoritingMaterial={favoritingMaterialIds.includes(video.id)} />
                  ))}
                </div>
              )}
              {filtered.length > 0 && videoPage < videoTotalPages && (
                <div className="flex justify-center pt-2 pb-4">
                  <button
                    onClick={() => void refreshVideos(videoPage + 1, true)}
                    disabled={videosLoading}
                    className="btn-ghost !px-4 !py-2 flex items-center gap-2 disabled:opacity-60"
                  >
                    {videosLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    加载更多
                  </button>
                </div>
              )}
              {filtered.length === 0 && (
                <div className="text-center py-20">
                  <Search size={28} className="mx-auto text-text-muted mb-3 opacity-30" />
                  <p className="text-text-muted text-sm">没有找到相关视频</p>
                </div>
              )}
            </>
          )}

          {innerView === 'library' && (
            <div className="space-y-4">
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                accept="video/*,image/*"
                className="hidden"
                onChange={e => void handleUploadMaterials(e.currentTarget.files)}
              />
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-5">
                <div>
                  <h3 className="text-base font-bold text-text-primary">社媒素材库</h3>
                  <p className="mt-1 text-sm text-text-muted">本地拍摄、Seedance 2.0 生成、Gemini 生成、官方爆款导入的素材统一保存在这里。</p>
                </div>
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={uploadingMaterial}
                  className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                >
                  {uploadingMaterial ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                  上传本地素材
                </button>
              </div>

              <div className="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <div className="relative min-w-0 flex-1">
                    <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input
                      type="text"
                      value={materialSearch}
                      onChange={e => setMaterialSearch(e.target.value)}
                      placeholder="搜索素材名称、行业、场景或标签..."
                      className="h-11 w-full rounded-xl border border-border bg-surface pl-10 pr-4 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
                    />
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-text-muted">{filteredMaterials.length}/{localMaterials.length} 条素材</span>
                  {(materialSearch || materialIndustry !== 'all' || materialFunction !== 'all' || materialApplicability !== 'all' || materialOrientation !== 'all') && (
                    <button type="button" onClick={() => { setMaterialSearch(''); setMaterialIndustry('all'); setMaterialFunction('all'); setMaterialApplicability('all'); setMaterialOrientation('all'); }}
                      className="h-11 shrink-0 rounded-xl border border-border px-3 text-xs font-bold text-text-secondary transition-colors hover:border-accent hover:text-accent">
                      清空筛选
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {[
                    { label: '所属行业', value: materialIndustry, onChange: (value: string) => setMaterialIndustry(value as MaterialIndustryFilter), options: Object.entries(MATERIAL_INDUSTRY_LABELS) },
                    { label: '镜头功能', value: materialFunction, onChange: setMaterialFunction, options: [['all', MATERIAL_FUNCTION_LABELS.all], ...materialFunctionOptions.map(value => [value, MATERIAL_FUNCTION_LABELS[value] || value])] },
                    { label: '适用范围', value: materialApplicability, onChange: (value: string) => setMaterialApplicability(value as MaterialApplicabilityFilter), options: Object.entries(MATERIAL_APPLICABILITY_LABELS) },
                    { label: '画面方向', value: materialOrientation, onChange: (value: string) => setMaterialOrientation(value as MaterialOrientationFilter), options: [['all', '全部方向'], ['vertical', '竖屏 9:16'], ['horizontal', '横屏 16:9']] },
                  ].map(filter => (
                    <div key={filter.label} className="relative h-14 rounded-2xl border border-border bg-surface transition-colors hover:border-border-bright focus-within:border-accent">
                      <Film size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
                      <span className="pointer-events-none absolute left-11 top-2 text-[11px] font-semibold text-text-muted">{filter.label}</span>
                      <select value={filter.value} onChange={e => filter.onChange(e.target.value)} aria-label={filter.label}
                        className="h-full w-full cursor-pointer appearance-none rounded-2xl bg-transparent pl-11 pr-9 pt-4 text-sm font-black text-text-primary outline-none">
                        {filter.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {materialsLoading ? (
                  <div className="col-span-full flex items-center justify-center gap-2 py-16 text-sm text-text-muted">
                    <Loader2 size={16} className="animate-spin" /> 正在读取素材库...
                  </div>
                ) : localMaterials.length === 0 ? (
                  <div className="col-span-full rounded-2xl border border-dashed border-border bg-surface px-6 py-16 text-center">
                    <Film size={30} className="mx-auto mb-3 text-text-muted opacity-50" />
                    <p className="text-sm font-bold text-text-primary">还没有本地社媒素材</p>
                    <p className="mt-1 text-xs text-text-muted">拍摄完成后上传，或从待拍摄素材池用 Seedance 2.0 生成。</p>
                  </div>
                ) : filteredMaterials.length === 0 ? (
                  <div className="col-span-full rounded-2xl border border-dashed border-border bg-surface px-6 py-16 text-center">
                    <Search size={30} className="mx-auto mb-3 text-text-muted opacity-50" />
                    <p className="text-sm font-bold text-text-primary">没有符合当前标签的素材</p>
                    <button type="button" onClick={() => { setMaterialSearch(''); setMaterialIndustry('all'); setMaterialFunction('all'); setMaterialApplicability('all'); setMaterialOrientation('all'); }} className="mt-2 text-xs font-bold text-accent">清空筛选条件</button>
                  </div>
                ) : filteredMaterials.map(material => (
                  <article key={material.id} className="overflow-hidden rounded-2xl border border-border bg-surface">
                    <div className="relative aspect-[9/16] bg-surface-2">
                      {material.type === 'video' ? (
                        <>
                          {material.poster
                            ? <img src={material.poster} alt={material.name} className="h-full w-full object-cover" loading="lazy" />
                            : <video src={`${material.url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />}
                          <button
                            type="button"
                            aria-label={`播放 ${material.name}`}
                            onClick={() => setPreviewMaterial(material)}
                            className="absolute inset-0 flex items-center justify-center bg-black/0 transition hover:bg-black/20 focus:bg-black/20"
                          >
                            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white shadow-lg">
                              <Play size={19} fill="currentColor" />
                            </span>
                          </button>
                        </>
                      ) : material.poster || material.url ? (
                        <img src={material.poster || material.url} alt={material.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-text-muted"><Film size={22} /></div>
                      )}
                      <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white">{material.type === 'video' ? '视频' : '图片'}</span>
                    </div>
                    <div className="p-3">
                      <p className="truncate text-sm font-bold text-text-primary">{material.name}</p>
                      <p className="mt-1 text-xs text-text-muted">{material.folder} · {material.size || `${material.duration}s`}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {[
                          material.industry ? MATERIAL_INDUSTRY_LABELS[material.industry] || material.industry : '',
                          material.applicability ? MATERIAL_APPLICABILITY_LABELS[material.applicability] || material.applicability : '',
                          ...String(material.shotFunction || '').split(',').slice(0, 2).map(value => MATERIAL_FUNCTION_LABELS[value] || value),
                        ].filter(Boolean).map(label => <span key={label} className="rounded-md bg-accent-glow px-1.5 py-0.5 text-[10px] font-semibold text-accent">{label}</span>)}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          {previewMaterial?.type === 'video' && previewMaterial.url && (
            <div
              className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-6"
              role="dialog"
              aria-modal="true"
              aria-label="素材视频预览"
              onClick={() => setPreviewMaterial(null)}
            >
              <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-black shadow-2xl" onClick={event => event.stopPropagation()}>
                <div className="flex items-center justify-between gap-4 bg-surface px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-text-primary">{previewMaterial.name}</p>
                    <p className="text-[11px] text-text-muted">{previewMaterial.folder} · {previewMaterial.size || `${previewMaterial.duration}s`}</p>
                  </div>
                  <button type="button" aria-label="关闭视频预览" onClick={() => setPreviewMaterial(null)} className="rounded-lg p-2 text-text-muted hover:bg-surface-2 hover:text-text-primary">
                    <X size={18} />
                  </button>
                </div>
                <video
                  key={previewMaterial.id}
                  src={previewMaterial.url}
                  poster={previewMaterial.poster}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  className="max-h-[75vh] w-full bg-black object-contain"
                >
                  当前浏览器不支持视频播放。
                </video>
              </div>
            </div>
          )}

          {innerView === 'shooting' && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  { label: '待拍摄缺口', value: shootingNeeds.length, color: 'text-accent' },
                  { label: '高优先级', value: shootingNeeds.filter(item => item.priority === '高').length, color: 'text-red-500' },
                  { label: '已入库素材', value: localMaterials.length, color: 'text-accent' },
                ].map(item => (
                  <div key={item.label} className="card p-4">
                    <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
                    <p className="mt-1 text-xs text-text-muted">{item.label}</p>
                  </div>
                ))}
              </div>

              {shootingNeeds.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-16 text-center">
                  <Check size={30} className="mx-auto mb-3 text-accent" />
                  <p className="text-sm font-bold text-text-primary">当前没有明显待拍摄缺口</p>
                  <p className="mt-1 text-xs text-text-muted">素材库已能覆盖当前抓取视频的主要分镜。</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {shootingNeeds.map(need => (
                    <article key={need.id} className="rounded-2xl border border-border bg-surface p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              need.priority === '高' ? 'bg-red-50 text-red-600' : need.priority === '中' ? 'bg-accent-50 text-accent-700' : 'bg-slate-100 text-text-muted'
                            }`}>{need.priority}优先级</span>
                            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-text-secondary">{need.ratio}</span>
                            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-text-secondary">{getPlatformMeta(need.platform).label}</span>
                          </div>
                          <h3 className="mt-2 text-sm font-bold text-text-primary">{need.title}</h3>
                          <p className="mt-1 text-xs leading-relaxed text-text-secondary">{need.suggestion}</p>
                          <p className="mt-2 text-[11px] text-text-muted">出现 {need.count} 次 · 来源：{need.sourceVideos.slice(0, 3).join(' / ')}</p>
                        </div>
                        <div className="flex flex-shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => { setInnerView('library'); setTimeout(() => uploadInputRef.current?.click(), 50); }}
                            className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:text-text-primary"
                          >
                            上传已拍素材
                          </button>
                          <button
                            type="button"
                            onClick={() => void generateNeedMaterial(need)}
                            disabled={generatingNeedId === need.id}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                          >
                            {generatingNeedId === need.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                            AI生成素材
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </div>

      <AnimatePresence>
        {selectedVideo && (
          <ScriptPanel
            key={selectedVideo.id}
            video={selectedVideo}
            activePanelTab={scriptPanelTab}
            onClose={() => setSelectedVideo(null)}
            onRetry={() => void retryVideoPipeline(selectedVideo)}
            onExactAnalysis={() => void requestExactFullAnalysis(selectedVideo)}
            actionNotice={materialMessage}
            onFavorite={() => void favoriteMaterial(selectedVideo)}
            favoriting={favoritingMaterialIds.includes(selectedVideo.id)}
            specialRecommendation={accountRecommendationByVideoId.get(selectedVideo.id)}
            onNavigate={onNavigate}
            onEnterWorkflow={onEnterWorkflow}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {watchVideo && <WatchModal key={watchVideo.id} video={watchVideo} onClose={() => setWatchVideo(null)} />}
      </AnimatePresence>
      <CompetitorAccountsModal
        open={showAccountsModal}
        onClose={() => setShowAccountsModal(false)}
        onCrawled={() => {
          setInnerView('inspiration');
          setSortMode('crawlTime');
          setPlatform('all');
          setSearch('');
          void refreshVideos(1, false);
        }}
      />
    </div>
  );
}
