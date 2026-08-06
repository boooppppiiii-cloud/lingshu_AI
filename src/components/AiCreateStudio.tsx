import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutGrid, Film, FileText, Music, Image as ImageIcon, Play, Send,
  Check, ChevronLeft, ChevronRight, Folder, Search, Volume2, Globe,
  Mic, Download, Loader2, Sparkles, Wand2, Copy, RefreshCw, Clock,
  Upload, X, Plus, List, Save, FolderOpen, Trash2, Pause, ChevronDown, Heart, ExternalLink, Languages,
} from 'lucide-react';
import { studioApi, getDesktopRender, type StudioProject, type VariationBatch, type Material, type MaterialSegment, type BgmTrack, type CoverStyle, type SubCue, type TtsStyleOptions, type StudioAudioCapabilities, type FbPosterResult, type LeadContentPackageResult, type StoryboardQualityResult, type VideoGenerationVersion } from '../lib/studioApi';
import type { Page } from '../App';
import { completeDemoStep } from '../lib/demoProgress';
import { authHeader } from '../lib/auth';
import { useDismissibleLayer } from '../hooks/useDismissibleLayer';
import { createScriptGapTask } from '../lib/scriptGapQueue';

/* ──────────────────────────────────────────────────────────────────────────
   AI 生成内容工作台 — 社媒（流量）页子模块
   流程：选模式 → 分镜与声音 → 选素材 → 配乐 → 封面 → 成片预览
   两栏布局：① 步骤导航  ② 操作区
─────────────────────────────────────────────────────────────────────────── */

const TRAFFIC_GREEN = '#16a34a';
const CANVA_VIDEO_COVER_URL = 'https://www.canva.cn/create/video-covers/';
const CANVA_COVER_RETURN_KEY = 'ow_canva_cover_return';
const CANVA_COVER_RETURN_TTL = 6 * 60 * 60 * 1000;
const PUBLISH_RETURN_PREVIEW_KEY = 'ow_publish_return_to_preview';
const PUBLISH_RETURN_PREVIEW_TTL = 2 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function pendingClaimLocations(script: string, productInfo: string): string[] {
  const source = productInfo.toLowerCase();
  return script.split('\n').map(line => line.trim()).filter(line => {
    if (!line || !/(MOQ|起订|交期|天|认证|CE|FDA|SGS|价格|\$|客户|案例|销量|保证|guarantee)/i.test(line)) return false;
    const facts = line.match(/(?:MOQ|起订|交期|认证|CE|FDA|SGS|价格|\$|客户案例|销量|保证)[^，。；\n]*/ig) || [];
    return facts.some(fact => !source.includes(fact.toLowerCase()));
  }).slice(0, 4);
}

const PLAYABLE_AUDIO_BLOB_CACHE = new Map<string, string>();
const PLAYABLE_VIDEO_BLOB_CACHE = new Map<string, string>();

function isSameOriginUrl(sourceUrl: string): boolean {
  try {
    return new URL(sourceUrl, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

async function authenticatedAudioBlobUrl(sourceUrl: string): Promise<string> {
  if (/^(?:blob:|data:)/i.test(sourceUrl)) return sourceUrl;
  const cached = PLAYABLE_AUDIO_BLOB_CACHE.get(sourceUrl);
  if (cached) return cached;
  const response = await fetch(sourceUrl, { headers: authHeader(), credentials: 'same-origin' });
  if (!response.ok) throw new Error(`音频请求失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('服务器返回了空音频');
  const contentType = String(response.headers.get('content-type') || blob.type || '').toLowerCase();
  if (contentType && !contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
    throw new Error(`服务器返回的不是音频（${contentType}）`);
  }
  const playableBlob = blob.type.startsWith('audio/') ? blob : new Blob([blob], { type: 'audio/wav' });
  const blobUrl = URL.createObjectURL(playableBlob);
  PLAYABLE_AUDIO_BLOB_CACHE.set(sourceUrl, blobUrl);
  return blobUrl;
}

async function authenticatedVideoBlobUrl(sourceUrl: string): Promise<string> {
  if (/^(?:blob:|data:)/i.test(sourceUrl)) return sourceUrl;
  const cached = PLAYABLE_VIDEO_BLOB_CACHE.get(sourceUrl);
  if (cached) return cached;
  const sameOrigin = isSameOriginUrl(sourceUrl);
  const response = await fetch(sourceUrl, sameOrigin
    ? { headers: authHeader(), credentials: 'same-origin' }
    : { credentials: 'omit' });
  if (!response.ok) throw new Error(`视频请求失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (!blob.size) throw new Error('服务器返回了空视频');
  const contentType = String(response.headers.get('content-type') || blob.type || '').toLowerCase();
  if (contentType && !contentType.startsWith('video/') && contentType !== 'application/octet-stream') {
    throw new Error(`服务器返回的不是视频（${contentType}）`);
  }
  const playableBlob = blob.type.startsWith('video/') ? blob : new Blob([blob], { type: 'video/mp4' });
  const blobUrl = URL.createObjectURL(playableBlob);
  PLAYABLE_VIDEO_BLOB_CACHE.set(sourceUrl, blobUrl);
  return blobUrl;
}

async function playAudioWithAuthenticatedFallback(
  element: HTMLAudioElement,
  sourceUrl: string,
  volume: number,
): Promise<void> {
  const absoluteSource = new URL(sourceUrl, window.location.href).href;
  element.pause();
  if (element.src !== absoluteSource && element.dataset.sourceUrl !== sourceUrl) {
    element.src = sourceUrl;
    element.dataset.sourceUrl = sourceUrl;
    element.load();
  }
  if (element.ended || !Number.isFinite(element.currentTime)) element.currentTime = 0;
  element.volume = Math.max(0, Math.min(1, volume));
  try {
    await element.play();
  } catch {
    const blobUrl = await authenticatedAudioBlobUrl(sourceUrl);
    element.src = blobUrl;
    element.dataset.sourceUrl = sourceUrl;
    element.load();
    element.currentTime = 0;
    await element.play();
  }
}

async function playVideoWithAuthenticatedFallback(
  element: HTMLVideoElement,
  sourceUrl: string,
): Promise<string> {
  const absoluteSource = new URL(sourceUrl, window.location.href).href;
  if (element.src !== absoluteSource && element.dataset.sourceUrl !== sourceUrl) {
    element.src = sourceUrl;
    element.dataset.sourceUrl = sourceUrl;
    element.load();
  }
  try {
    await element.play();
    return sourceUrl;
  } catch {
    const blobUrl = await authenticatedVideoBlobUrl(sourceUrl);
    element.src = blobUrl;
    element.dataset.sourceUrl = sourceUrl;
    element.load();
    await element.play();
    return blobUrl;
  }
}

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

// 客户端读取媒体时长和画幅，供自动选材阻止横竖素材混剪。
const probeMedia = (f: File) => new Promise<{ duration: number; width: number; height: number }>(res => {
  if (f.type.startsWith('image')) {
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(image.src); res({ duration: 0, width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => res({ duration: 0, width: 0, height: 0 });
    image.src = URL.createObjectURL(f);
    return;
  }
  if (!f.type.startsWith('video')) { res({ duration: 0, width: 0, height: 0 }); return; }
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.onloadedmetadata = () => {
    URL.revokeObjectURL(v.src);
    res({ duration: Math.round(v.duration) || 0, width: v.videoWidth || 0, height: v.videoHeight || 0 });
  };
  v.onerror = () => res({ duration: 0, width: 0, height: 0 });
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

const probeClipAspect = (clip: Clip) => new Promise<{ width: number; height: number }>(res => {
  const src = clip.type === 'image' ? clip.url : (clip.poster || clip.url);
  if (!src || clip.type === 'audio') { res({ width: 0, height: 0 }); return; }
  if (clip.type === 'image' || clip.poster) {
    const image = new Image();
    image.onload = () => res({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => res({ width: 0, height: 0 });
    image.src = src;
    return;
  }
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.onloadedmetadata = () => res({ width: video.videoWidth, height: video.videoHeight });
  video.onerror = () => res({ width: 0, height: 0 });
  video.src = src;
});

const materialToClip = (m: Material): Clip => ({
  id: m.id, name: m.name, folder: m.folder, type: m.type, duration: m.duration, width: m.width, height: m.height, aspectRatio: m.aspectRatio, size: m.size, url: m.url, poster: m.poster, scope: m.scope ?? 'own',
  usage: m.usage, sourceType: m.sourceType, industry: m.industry, shotFunction: m.shotFunction, applicability: m.applicability, tags: m.tags,
  segmentAnalysisStatus: m.segmentAnalysisStatus, segments: m.segments,
});

type StepId = 'mode' | 'material' | 'script' | 'bgm' | 'cover' | 'preview' | 'poster';

const STEPS: { id: StepId; label: string; icon: typeof LayoutGrid; hint: string }[] = [
  { id: 'mode',     label: '选模式',  icon: LayoutGrid, hint: '选择生成起点与全局参数' },
  { id: 'script',   label: '分镜与声音', icon: FileText, hint: '先确认可执行分镜，再选择口播、字幕与配音' },
  { id: 'material', label: '选素材',  icon: Film,       hint: '按脚本挑选并排序片段' },
  { id: 'bgm',      label: '配乐',     icon: Music,      hint: 'AI 推荐背景乐与音量平衡' },
  { id: 'cover',    label: '封面',     icon: ImageIcon,  hint: '生成封面候选并选定标题' },
  { id: 'preview',  label: '素材成片预览', icon: Play,       hint: '确认成片并进入发布' },
];

type VideoThemeId = 'buyer_pain' | 'product_proof' | 'use_case' | 'supplier_capability' | 'customization' | 'comparison' | 'customer_case' | 'trend' | 'talking_head';
type VideoTheme = {
  id: VideoThemeId;
  title: string;
  description: string;
  /** Legacy metadata; no longer displayed or used to decide CTA. */
  painPoint: string;
  conversionGoal: string;
  requires: Array<'product' | 'material' | 'factory' | 'comparison' | 'case' | 'trend'>;
};

const DEFAULT_VIDEO_CONVERSION_GOAL = '引导跳转WhatsApp以触达';

const VIDEO_THEMES: VideoTheme[] = [
  { id: 'buyer_pain', title: '买家痛点', description: '从采购顾虑或使用难题切入，再用产品证据回答。', painPoint: '买家难以快速判断产品是否适合自己的市场与采购需求', conversionGoal: '私信说明目标市场与需求', requires: ['product'] },
  { id: 'product_proof', title: '产品实证', description: '用规格、包装、细节和真实素材建立判断依据。', painPoint: '仅凭产品主图无法确认实物、规格和包装细节', conversionGoal: '索取完整产品资料', requires: ['product', 'material'] },
  { id: 'use_case', title: '使用场景', description: '围绕一个具体场景展示产品如何被使用或呈现。', painPoint: '买家看不出产品在真实场景中的使用方式', conversionGoal: '咨询适用方案', requires: ['material'] },
  { id: 'supplier_capability', title: '供应能力', description: '用工厂、质检、产能或交付证据降低供应风险。', painPoint: '买家担心批量供货、质量稳定性和交付可靠性', conversionGoal: '提交数量并确认供应方案', requires: ['factory'] },
  { id: 'customization', title: '定制能力', description: '展示已确认的包装、品牌或规格定制能力。', painPoint: '买家不确定产品能否适配自己的品牌和渠道', conversionGoal: '发送定制需求', requires: ['product'] },
  { id: 'comparison', title: '选型对比', description: '按统一维度比较不同产品或方案，帮助买家选型。', painPoint: '相似产品看起来接近，买家难以判断适用差异', conversionGoal: '说明需求并获取选型建议', requires: ['comparison'] },
  { id: 'customer_case', title: '客户案例', description: '用已授权的客户问题、过程和结果建立信任。', painPoint: '买家缺少相似客户的合作与落地参考', conversionGoal: '索取相关案例资料', requires: ['case'] },
  { id: 'trend', title: '趋势热点', description: '用有来源的市场变化切入，再连接到企业产品证据。', painPoint: '买家需要判断当前趋势是否值得进入或备货', conversionGoal: '获取趋势对应的产品方案', requires: ['trend'] },
  { id: 'talking_head', title: '真人口播', description: '以真人出镜讲解、演示或推荐为核心，围绕人物表达组织分镜。', painPoint: '买家需要更直接、可信的人物讲解来理解产品价值', conversionGoal: '通过真人讲解引导咨询产品方案', requires: ['material'] },
];

function inferVideoThemeFromMaterial(material: Pick<Material, 'name' | 'folder' | 'shotFunction' | 'tags' | 'segments'>): VideoThemeId {
  const segmentText = (material.segments || []).flatMap(segment => [
    segment.action, segment.environment, segment.shot, ...segment.subject, ...segment.recommendedFunctions,
  ]).join(' ');
  const text = [material.name, material.folder, material.shotFunction, material.tags, segmentText].filter(Boolean).join(' ').toLowerCase();
  const hasPerson = (material.segments || []).some(segment => segment.hasPerson);
  if (hasPerson || /真人|人物|口播|主播|讲解|出镜|presenter|talking.?head|spokesperson|host/.test(text)) return 'talking_head';
  if (/对比|比较|选型|差异|before.?after|comparison|versus|\bvs\b/.test(text)) return 'comparison';
  if (/客户案例|合作案例|案例结果|反馈|testimonial|customer.?case|case.?study/.test(text)) return 'customer_case';
  if (/趋势|热点|热销|爆款|trend|viral|hot.?selling/.test(text)) return 'trend';
  if (/工厂|产线|生产|质检|仓库|物流|交付|设备|factory|production|quality.?control|warehouse|logistics/.test(text)) return 'supplier_capability';
  if (/定制|包装|彩盒|贴牌|logo|品牌|custom|oem|odm|packaging|branding/.test(text)) return 'customization';
  if (/使用|涂抹|体验|操作|场景|护理|application|usage|lifestyle|treatment/.test(text)) return 'use_case';
  if (/产品|质地|细节|成分|特写|展示|product|texture|ingredient|detail|close.?up/.test(text)) return 'product_proof';
  return 'buyer_pain';
}
const POSTER_STEPS: { id: StepId; label: string; icon: typeof LayoutGrid; hint: string }[] = [
  { id: 'mode',     label: '选模式',   icon: LayoutGrid, hint: '确认图文生成渠道、平台和产品' },
  { id: 'material', label: '选产品/素材', icon: ImageIcon,  hint: '确认产品并选择产品图、工厂图、包装图和证书图' },
  { id: 'poster',   label: '图文生成', icon: Sparkles,   hint: '一次生成海报图、配文和承接话术' },
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

interface CoverVersionConfig {
  coverId: string;
  title: string;
  style: CoverStyle;
  coverUrl?: string | null;
}

interface MaterialFolder { id: string; name: string; count: number }
const FOLDERS: MaterialFolder[] = [
  { id: 'recommend', name: '当前选择', count: 0 },
  { id: 'all',     name: '全部素材',   count: 0 },
  { id: 'hot',     name: '爆款素材',   count: 0 },
  { id: 'upload',  name: '本地素材',   count: 0 },
  { id: 'presenter', name: '真人口播', count: 0 },
  { id: 'product', name: '产品主图',   count: 0 },
  { id: 'factory', name: '工厂实拍',   count: 0 },
  { id: 'scene',   name: '使用场景',   count: 0 },
  { id: 'model',   name: '模特出镜',   count: 0 },
  { id: 'detail',  name: '细节特写',   count: 0 },
];
const POSTER_FOLDERS: MaterialFolder[] = [
  { id: 'recommend', name: '素材推荐', count: 0 },
  { id: 'all', name: '全部图文素材', count: 0 },
  { id: 'hot', name: '爆款图文参考', count: 0 },
  { id: 'upload', name: '我的上传', count: 0 },
  { id: 'product', name: '产品主图', count: 0 },
  { id: 'factory', name: '工厂实拍', count: 0 },
  { id: 'packaging', name: '包装定制', count: 0 },
  { id: 'certificate', name: '证书资质', count: 0 },
  { id: 'scene', name: '使用场景', count: 0 },
  { id: 'brand', name: '品牌视觉', count: 0 },
];
const POSTER_MATERIAL_GROUPS = [
  { id: 'product', title: '产品主图', desc: '瓶身/包装/套装/产品矩阵，建议 1-4 张', folders: ['product'] },
  { id: 'factory', title: '工厂背书', desc: '产线、灌装、质检、仓储、团队实拍', folders: ['factory'] },
  { id: 'proof', title: '包装/证书', desc: '私标包装、认证证书、检测报告、资质墙', folders: ['packaging', 'certificate'] },
  { id: 'scene', title: '场景/品牌', desc: '使用场景、成分氛围、品牌色和 Logo 参考', folders: ['scene', 'brand'] },
  { id: 'hot', title: '爆款参考', desc: '仅用于拆解画风、结构、CTA，不直接复制承诺', folders: ['hot'] },
] as const;

interface Clip {
  id: string;
  name: string;
  folder: string;
  type: 'video' | 'image' | 'audio';
  duration: number; // seconds
  width?: number;
  height?: number;
  aspectRatio?: number;
  size: string;
  url?: string;     // 真实素材的可访问地址（mock 占位素材无此字段）
  poster?: string;  // 封面帧画面（视频抽帧 / 图片自身）
  scope?: 'shared' | 'own'; // 公共库 / 我的（缺省按 own）
  usage?: 'editable' | 'reference_only';
  sourceType?: string;
  industry?: string;
  shotFunction?: string;
  applicability?: string;
  tags?: string;
  segmentAnalysisStatus?: 'pending' | 'analyzing' | 'completed' | 'failed';
  segments?: MaterialSegment[];
}

interface ClipEdit {
  trimStart: number;
  trimEnd: number;
  speed: number;
  transition: string;
  note: string;
}

function mergeClipLists(primary: Clip[], fallback: Clip[]): Clip[] {
  const byId = new Map<string, Clip>();
  for (const item of fallback) byId.set(item.id, item);
  for (const item of primary) {
    const existing = byId.get(item.id);
    byId.set(item.id, existing
      ? {
          ...existing,
          ...item,
          url: item.url || existing.url,
          poster: item.poster || existing.poster,
          segments: item.segments?.length ? item.segments : existing.segments,
        }
      : item);
  }
  return Array.from(byId.values());
}

interface StoryboardSlot {
  id: string;
  time: string;
  start: number;
  end: number;
  title: string;
  detail: string;
}
type StoryboardSourceMode = 'auto' | 'online' | 'local' | 'ai' | 'hybrid';
type VariationStrategy = 'remix' | 'recreate' | 'hybrid';
interface StoryboardSourcePlan {
  mode: StoryboardSourceMode;
  decided?: boolean;
  confirmed: boolean;
  critical: boolean;
  referenceClipId?: string;
  generatedClipId?: string;
  error?: string;
  quality?: StoryboardQualityResult;
  qualityError?: string;
}
interface StoryboardAssembly {
  id: string;
  name: string;
  assignments: Record<string, string>;
  sourcePlans: Record<string, StoryboardSourcePlan>;
  selected: string[];
}

type StudioPublishPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';
type StudioPublishItem = {
  videoPath?: string;
  previewUrl?: string;
  title: string;
  description: string;
  ratio: string;
  sourceProjectId?: string;
  platform?: StudioPublishPlatform;
};
type StudioPublishPayload = StudioPublishItem & { items?: StudioPublishItem[] };

type LanguageRenderOutput = {
  status: 'pending' | 'rendering' | 'done' | 'failed';
  path?: string;
  previewUrl?: string;
  error?: string;
};

type LanguageRenderGeneration = {
  id: string;
  versionNumber: number;
  status: 'done' | 'failed';
  path?: string;
  previewUrl?: string;
  error?: string;
  createdAt: string;
};

const renderCombinationKey = (planId: string, language: string, bgmId: string) =>
  `${encodeURIComponent(planId)}::${encodeURIComponent(language)}::${encodeURIComponent(bgmId || 'none')}`;
const materialVersionKey = (planId: string, language: string) =>
  `${encodeURIComponent(planId)}::${encodeURIComponent(language)}`;

const clipSourceMode = (clip: Clip): Extract<StoryboardSourceMode, 'online' | 'local' | 'ai'> => {
  const marker = `${clip.sourceType || ''} ${clip.id} ${clip.name} ${clip.size} ${clip.url || ''}`.toLowerCase();
  if (/\b(ai|gemini|seedance|jimeng|即梦|生成)\b/.test(marker)) return 'ai';
  if (clip.scope === 'shared') return 'online';
  return 'local';
};
const CLIPS: Clip[] = [];

const ratioNumber = (value: string) => {
  const [w, h] = String(value || '9:16').split(':').map(Number);
  return w > 0 && h > 0 ? w / h : 9 / 16;
};
const clipAspectRatio = (clip: Clip) => clip.aspectRatio || (clip.width && clip.height ? clip.width / clip.height : 0);
const isClipCompatibleWithRatio = (clip: Clip, targetRatio: string) => {
  const actual = clipAspectRatio(clip);
  if (!actual) return true; // 旧素材无元数据时保留，最终渲染仍会裁切兜底。
  const orientation = (n: number) => n > 1.12 ? 'landscape' : n < 0.89 ? 'portrait' : 'square';
  return orientation(actual) === orientation(ratioNumber(targetRatio));
};

interface Bgm { id: string; name: string; mood: string; duration: number; url?: string; recommended?: boolean; scope?: 'shared' | 'tenant'; uploadedBy?: string }
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
    const aDur = effectiveClipDuration(a);
    const bDur = effectiveClipDuration(b);
    return Math.abs(aDur - targetDuration / 4) - Math.abs(bDur - targetDuration / 4);
  });
  const desiredCount = Math.max(1, Math.min(targetCount || 6, ordered.length || pool.length || 1));
  const picked: string[] = [];
  let total = 0;
  for (const clip of ordered) {
    if (picked.length >= desiredCount || (!targetCount && total >= targetDuration - 0.75)) break;
    picked.push(clip.id);
    total += effectiveClipDuration(clip);
  }
  return {
    selectedIds: picked.length ? picked : pool.slice(0, desiredCount).map(clip => clip.id),
    reason: targetCount
      ? `按 ${targetCount} 个分镜匹配素材候选`
      : preferredIds.length ? '沿用已选素材并补齐镜头顺序' : '按真人/产品/细节/场景和目标时长快速排序',
  };
}

function matchMaterialsToStoryboardLocally(
  pool: Clip[],
  slots: StoryboardSlot[],
  preferredIds: string[] = [],
  options: { variantIndex?: number; previousAssignments?: Array<Record<string, string>> } = {},
) {
  const preferred = new Set(preferredIds);
  const unused = new Set(pool.map(clip => clip.id));
  const variantIndex = Math.max(0, options.variantIndex || 0);
  const previousAssignments = options.previousAssignments || [];
  const globalUsage = new Map<string, number>();
  previousAssignments.forEach(plan => Object.values(plan).forEach(clipId => {
    globalUsage.set(clipId, (globalUsage.get(clipId) || 0) + 1);
  }));
  const previousMaterialIds = new Set(globalUsage.keys());
  const availableFreshCount = pool.filter(clip => !previousMaterialIds.has(clip.id)).length;
  // A/B 流量测试要求“组合本身”有差异，而不只是把同一组素材换个顺序。
  // 素材充足时，每个新版本至少 60% 使用此前方案未出现过的素材。
  const minimumFreshCount = previousAssignments.length
    ? Math.min(Math.ceil(slots.length * 0.6), availableFreshCount)
    : 0;
  let freshAssignedCount = 0;
  const variantTieBreak = (value: string) => {
    let hash = 2166136261 ^ (variantIndex + 1);
    for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return ((hash >>> 0) % 1000) / 1000;
  };
  const folderKeywords: Record<string, RegExp> = {
    presenter: /人物|主播|口播|出镜|真人|presenter|host|talking/i,
    detail: /开场|钩子|细节|特写|质地|滴落|材质|纹理|hook|detail|close.?up|texture/i,
    product: /产品|外观|瓶身|结构|展示|样品|product|packshot|sample/i,
    scene: /使用|场景|体验|操作|应用|代入|use|scene|lifestyle|application/i,
    model: /模特|上脸|试用|穿戴|效果|model|try.?on|beauty/i,
    factory: /工厂|生产|产线|供应|交付|实力|仓库|factory|production|supply|warehouse/i,
    packaging: /包装|彩盒|logo|定制|品牌|packaging|custom|branding/i,
    certificate: /证书|认证|检测|资质|ce|rohs|certificate|test report/i,
  };
  const assignments: Record<string, string> = {};

  slots.forEach((slot, slotIndex) => {
    const slotText = `${slot.title} ${slot.detail}`.toLowerCase();
    const targetDuration = Math.max(0.5, slot.end - slot.start);
    const remainingSlots = slots.length - slotIndex;
    const freshStillNeeded = Math.max(0, minimumFreshCount - freshAssignedCount);
    const uniquePool = unused.size ? pool.filter(clip => unused.has(clip.id)) : pool;
    const freshUniquePool = uniquePool.filter(clip => !previousMaterialIds.has(clip.id));
    const mustChooseFresh = freshStillNeeded >= remainingSlots && freshUniquePool.length > 0;
    const eligiblePool = mustChooseFresh ? freshUniquePool : uniquePool;
    const openingRoleOrder = [
      ['detail', 'product', 'presenter'],
      ['presenter', 'model', 'scene'],
      ['product', 'detail', 'scene'],
    ][variantIndex % 3] || ['detail', 'product', 'presenter'];
    const candidates = eligiblePool.map(clip => {
      const clipText = `${clip.name} ${clip.folder} ${clip.industry || ''} ${clip.shotFunction || ''} ${clip.applicability || ''} ${clip.tags || ''}`.toLowerCase();
      let score = 0;
      if (unused.has(clip.id)) score += 18;
      if (preferred.has(clip.id)) score += 7;
      if (clip.type === 'video') score += 5;
      if (folderKeywords[clip.folder]?.test(slotText)) score += 28;
      const slotTerms = slotText.match(/[\u4e00-\u9fff]{2,4}|[a-z]{3,}/gi) || [];
      score += Math.min(24, slotTerms.filter(term => clipText.includes(term.toLowerCase())).length * 6);
      score += Math.max(0, 12 - Math.abs(effectiveClipDuration(clip) - targetDuration) * 2);
      if (slotIndex === 0 && (clip.folder === 'detail' || clip.folder === 'product' || clip.folder === 'presenter')) score += 8;
      if (slotIndex === 0 && openingRoleOrder.includes(clip.folder)) score += Math.max(4, 14 - openingRoleOrder.indexOf(clip.folder) * 4);
      if (slotIndex === slots.length - 1 && (clip.folder === 'product' || clip.folder === 'factory' || clip.folder === 'packaging')) score += 6;
      // 先保证分镜语义，再让新方案使用真正不同的素材集合。
      const sameSlotUsage = previousAssignments.filter(plan => plan[slot.id] === clip.id).length;
      const priorUsage = globalUsage.get(clip.id) || 0;
      score -= sameSlotUsage * 55;
      score -= priorUsage * 18;
      if (previousAssignments.length && priorUsage === 0) score += 34;
      if (slotIndex === 0 && previousAssignments.length && priorUsage === 0) score += 20;
      score += variantTieBreak(`${slot.id}:${clip.id}`) * 8;
      return { clip, score };
    }).sort((a, b) => b.score - a.score);
    const chosen = candidates[0]?.clip;
    if (!chosen) return;
    assignments[slot.id] = chosen.id;
    unused.delete(chosen.id);
    if (!previousMaterialIds.has(chosen.id)) freshAssignedCount += 1;
  });
  return assignments;
}

function effectiveClipDuration(clip: Clip): number {
  if (clip.type === 'image') return 3;
  const usefulSegments = (clip.segments || []).filter(segment =>
    segment.duration >= 0.5
    && segment.quality >= 55
    && segment.confidence >= 0.5
    && (!segment.needsReview || segment.manualConfirmed),
  );
  if (usefulSegments.length) {
    return +Math.max(1.5, Math.min(12, usefulSegments.reduce((sum, segment) => sum + segment.duration, 0))).toFixed(1);
  }
  const roleCap: Record<string, number> = {
    detail: 4.5,
    product: 5,
    model: 5,
    scene: 5,
    factory: 6,
    presenter: 8,
    packaging: 4,
    certificate: 3.5,
  };
  return +Math.max(1.5, Math.min(clip.duration || 3, roleCap[clip.folder] || 5)).toFixed(1);
}

// 句子切分（中英日通用：按句末标点 / 换行）
const splitSentences = (text: string): string[] =>
  text.replace(/\s+/g, ' ').split(/(?<=[.!?。！？…])\s+/).map(s => s.trim()).filter(Boolean);

const parsePronunciationRules = (text: string) => String(text || '').split('\n').map(line => {
  const [word, ...rest] = line.split(/[=＝]/);
  return { word: String(word || '').trim(), pronunciation: rest.join('=').trim() };
}).filter(item => item.word && item.pronunciation).slice(0, 20);

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
  if (hasStoryboardFieldLabels(lines)) return [];
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

function subtitleTimestamp(seconds: number, vtt = false): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hh = Math.floor(ms / 3_600_000);
  const mm = Math.floor((ms % 3_600_000) / 60_000);
  const ss = Math.floor((ms % 60_000) / 1000);
  const mmm = ms % 1000;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}${vtt ? '.' : ','}${String(mmm).padStart(3, '0')}`;
}

function subtitleFile(cues: SubCue[], format: 'srt' | 'vtt'): string {
  const body = cues.map((cue, index) => `${index + 1}\n${subtitleTimestamp(cue.start, format === 'vtt')} --> ${subtitleTimestamp(cue.end, format === 'vtt')}\n${cue.text}\n`).join('\n');
  return format === 'vtt' ? `WEBVTT\n\n${body}` : body;
}

function downloadSubtitleFile(cues: SubCue[], format: 'srt' | 'vtt', language: string): void {
  const blob = new Blob([subtitleFile(cues, format)], { type: format === 'vtt' ? 'text/vtt;charset=utf-8' : 'application/x-subrip;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `lingshu-${language || 'voiceover'}.${format}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderSafeCues(cues: SubCue[], maxDuration: number): SubCue[] {
  const limit = Math.max(0, Number(maxDuration) || 0);
  let cursor = 0;
  return cues
    .map(cue => {
      const start = Math.max(cursor, Number(cue.start) || 0);
      const end = limit > 0
        ? Math.min(limit, Math.max(start + 0.25, Number(cue.end) || 0))
        : Math.max(start + 0.25, Number(cue.end) || 0);
      cursor = end;
      return { ...cue, start: +start.toFixed(3), end: +end.toFixed(3), text: String(cue.text || '').trim() };
    })
    .filter(cue => cue.text && cue.end > cue.start && (limit <= 0 || cue.start < limit));
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
  // 没有真实时间戳脚本时不伪造等分分镜，选材页明确显示“暂无分镜”。
  return [];
}

function storyboardSlotScript(detail: string) {
  const text = String(detail || '').replace(/\s+/g, ' ').trim();
  const labels = '环境|景别|运镜|镜头功能|画面|Visual|人物说|台词|Voiceover|VO|口播|字幕|Caption|配乐|真实性要求|可见事实|表达意图|未展示因果|Omni提示词|Omni禁止项';
  const pick = (field: string) => text.match(new RegExp(`(?:${field})\\s*[：:]\\s*[“\"]?(.+?)[”\"]?(?=\\s+(?:${labels})\\s*[：:]|$)`, 'i'))?.[1]?.trim() || '';
  const visual = pick('画面|Visual');
  const voice = pick('人物说|台词|Voiceover|VO|口播').replace(/^“|”$/g, '');
  const subtitle = pick('字幕|Caption');
  return {
    visual,
    voice,
    subtitle,
    fallback: text.replace(/^\[[^\]]+\]\s*/, '').slice(0, 180),
  };
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

const TTS_PRESETS: Array<{ id: TtsStyleOptions['preset']; label: string; emotion: string; intensity: number; speed: number }> = [
  { id: 'tiktok_excited', label: 'TikTok 激动种草', emotion: '兴奋惊喜', intensity: 90, speed: 1.12 },
  { id: 'authentic_review', label: '真实体验分享', emotion: '自然可信', intensity: 68, speed: 1 },
  { id: 'professional_b2b', label: '外贸专业介绍', emotion: '专业笃定', intensity: 48, speed: 0.94 },
  { id: 'warm_story', label: '温柔故事感', emotion: '温暖治愈', intensity: 60, speed: 0.9 },
  { id: 'urgent_cta', label: '紧迫转化 CTA', emotion: '紧迫有力', intensity: 82, speed: 1.08 },
];

type LanguageTtsSettings = {
  preset: TtsStyleOptions['preset'];
  emotion: string;
  emotionIntensity: number;
  speed: number;
  pauseStyle: 'few' | 'natural' | 'dramatic';
  pronunciationText: string;
};

const DEFAULT_TTS_SETTINGS: LanguageTtsSettings = {
  preset: 'authentic_review',
  emotion: '自然可信',
  emotionIntensity: 68,
  speed: 1,
  pauseStyle: 'natural',
  pronunciationText: 'MOQ=M O Q\nOEM=O E M\nODM=O D M',
};

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
  { id: 'clone',    icon: Wand2,   title: '爆款裂变',       desc: '按分镜选择 AI 生成、本地混剪或融合素材，并人工校验' },
  { id: 'product',  icon: Sparkles,title: '产品信息生成',   desc: '输入商品信息，一键生成视频素材脚本和画面 brief' },
] as const;
const POSTER_MODES: ModeCard[] = [
  { id: 'clone',    icon: Wand2,   title: '对标图文套用', desc: '基于完整轮播证据保留通用布局与信息层级，用企业资料替换竞品内容' },
  { id: 'material', icon: Film,    title: '素材库选择',   desc: '选择产品实拍、工厂图和证书素材，生成高质感 B2B 海报' },
  { id: 'product',  icon: Sparkles,title: '产品信息生成', desc: '从企业中心产品资料出发，自动生成海报文案和配图 brief' },
] as const;
const POSTER_STYLES = [
  { id: 'oem-factory', label: 'OEM 工厂风' },
  { id: 'promo', label: '促销招商风' },
  { id: 'holiday', label: '节日营销风' },
  { id: 'premium', label: '高端品牌风' },
] as const;

const VIDEO_MODE_DRAFT_TITLES: Record<ModeCard['id'], string> = {
  material: '素材库智能生成',
  clone: '爆款裂变',
  product: '产品信息生成',
};
const draftTitleForMode = (mode: ModeCard['id'], sourceTitle = '') =>
  `${VIDEO_MODE_DRAFT_TITLES[mode]}${sourceTitle.trim() ? ` · ${sourceTitle.trim()}` : ''}`;
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
function filterRecordByLanguage<T>(record: Record<string, T>, codes: string[]): Record<string, T> {
  if (!codes.length) return {};
  return Object.fromEntries(codes
    .filter(code => Object.prototype.hasOwnProperty.call(record, code))
    .map(code => [code, record[code]!]));
}

function detectScriptLanguageCode(value: string): string {
  const text = String(value || '').replace(/\[[^\]]+\]/g, '').trim();
  if (!text) return 'zh';
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  return 'en';
}

function cleanTimestampNumber(value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function normalizeScriptTimestamps(value: string): string {
  return String(value || '').replace(
    /\[\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\]/gi,
    (_match, start, end) => `[${cleanTimestampNumber(start)}-${cleanTimestampNumber(end)}s]`,
  );
}

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

function enterpriseLanguageCodes(text = ''): string[] {
  return [...new Set(text
    .split(/[、,，/|;；\n]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => LANG_ALIASES[item] ?? LANG_ALIASES[item.toLowerCase()] ?? '')
    .filter(code => code && LANGS.some(language => language.code === code)))];
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
      sku?: string;
      name?: string;
      category?: string;
      priceRange?: string;
      moq?: string;
      certifications?: string;
      highlights?: string;
      images?: Array<{ name?: string; url?: string }>;
      factoryImages?: Array<{ name?: string; url?: string }>;
      packagingImages?: Array<{ name?: string; url?: string }>;
      certificateImages?: Array<{ name?: string; url?: string }>;
      sceneImages?: Array<{ name?: string; url?: string }>;
      brandAssets?: Array<{ name?: string; url?: string }>;
    }>;
  };
  brand?: { tone?: string; usp?: string; preferredLanguages?: string };
  strategy?: { focusProducts?: string; focusMarkets?: string };
  customers?: { targetProfiles?: string };
  socialStrategy?: { enabledRoutes?: Array<'oem_odm' | 'wholesale_distribution' | 'consumer_retail'>; routeStrategies?: Record<string, { targetBuyerRoles?: string[]; primaryCta?: string }> };
}

interface VideoKickoff {
  source?: 'inspiration_analysis' | 'inspiration_image_post' | 'seedance_video' | string;
  script?: string;
  scriptType?: 'voiceover' | 'storyboard';
  language?: string;
  productInfo?: string;
  referenceAnalysis?: {
    title?: string;
    visualStyle?: string;
    coreEmotion?: string;
    details?: { time: string; environment?: string; shot: string; camera: string; visual: string; subtitle?: string; audio?: string; note?: string; purpose?: string; dialogue?: string; onScreenText?: string; ambientSound?: string; bgm?: string; soundEffects?: string[]; beats?: Array<{ time?: string; action?: string; dialogue?: string; onScreenText?: string }>; persistentState?: string; authenticity?: string; confidence?: number; needsReview?: boolean }[];
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
  materialRole?: 'hook';
  video?: {
    title?: string;
    platform?: string;
    contentFormat?: 'video' | 'image';
    videoUrl?: string;
    thumbnail?: string;
    duration?: number;
    sourceUrl?: string;
    aiAnalysis?: {
      materialUrl?: string;
      materialPoster?: string;
      imageEvidence?: {
        version?: number;
        status?: string;
        observedFacts?: Array<Record<string, unknown>>;
        carouselFlow?: Array<Record<string, unknown>>;
        copyEvidence?: Record<string, unknown>;
        reusableModules?: Array<Record<string, unknown>>;
        uncertainties?: string[];
      };
    };
  };
}

function normalizedSourceToken(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, window.location.origin);
    url.search = '';
    url.hash = '';
    return `${url.origin}${url.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return raw.split(/[?#]/, 1)[0]!.replace(/\/$/, '').toLowerCase();
  }
}

function kickoffSourceTokens(kickoff: VideoKickoff | null): string[] {
  if (!kickoff) return [];
  const values = [
    kickoff.generatedVideo?.id,
    kickoff.generatedVideo?.material?.id,
    kickoff.video?.sourceUrl,
    kickoff.video?.videoUrl,
    kickoff.video?.aiAnalysis?.materialUrl,
    kickoff.generatedVideo?.url,
  ];
  return [...new Set(values.map(normalizedSourceToken).filter(Boolean))];
}

function projectMatchesKickoff(project: StudioProject, kickoff: VideoKickoff): boolean {
  const savedKickoff = project.spec?.videoKickoff as VideoKickoff | undefined;
  if (!savedKickoff) return false;
  const incomingTokens = kickoffSourceTokens(kickoff);
  const savedTokens = new Set(kickoffSourceTokens(savedKickoff));
  if (incomingTokens.some(token => savedTokens.has(token))) return true;
  if (incomingTokens.length || savedTokens.size) return false;
  return Boolean(
    kickoff.source
    && kickoff.source === savedKickoff.source
    && kickoff.video?.title
    && kickoff.video.title.trim() === savedKickoff.video?.title?.trim()
    && kickoff.video?.platform === savedKickoff.video?.platform,
  );
}

interface ExistingSourceDraftPrompt {
  project: StudioProject;
  matchCount: number;
  title: string;
  poster: string;
}

function normalizeClipSnapshot(value: unknown): Clip | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<Clip>;
  if (!item.id || typeof item.id !== 'string') return null;
  const type = item.type === 'image' || item.type === 'audio' || item.type === 'video' ? item.type : 'video';
  const url = typeof item.url === 'string' ? item.url : '';
  const poster = typeof item.poster === 'string' ? item.poster : '';
  if (!url && !poster) return null;
  return {
    id: item.id,
    name: typeof item.name === 'string' && item.name.trim() ? item.name : '历史作品集素材',
    folder: typeof item.folder === 'string' && item.folder.trim() ? item.folder : 'upload',
    type,
    duration: Number(item.duration) || 0,
    width: Number(item.width) || undefined,
    height: Number(item.height) || undefined,
    aspectRatio: Number(item.aspectRatio) || undefined,
    size: typeof item.size === 'string' && item.size.trim() ? item.size : '作品集快照',
    url,
    poster,
    scope: item.scope === 'shared' ? 'shared' : 'own',
    usage: item.usage,
    sourceType: typeof item.sourceType === 'string' && item.sourceType.trim() ? item.sourceType : 'project-snapshot',
    industry: item.industry,
    shotFunction: item.shotFunction,
    applicability: item.applicability,
    tags: item.tags,
    segmentAnalysisStatus: item.segmentAnalysisStatus,
    segments: item.segments,
  };
}

function kickoffClipSnapshot(kickoff: VideoKickoff | null): Clip | null {
  if (!kickoff) return null;
  if (kickoff.generatedVideo?.material) {
    return normalizeClipSnapshot({ ...materialToClip(kickoff.generatedVideo.material), sourceType: 'historical-kickoff' });
  }
  const url = kickoff.generatedVideo?.url || kickoff.video?.aiAnalysis?.materialUrl || kickoff.video?.videoUrl || '';
  const poster = kickoff.generatedVideo?.poster || kickoff.video?.aiAnalysis?.materialPoster || kickoff.video?.thumbnail || '';
  if (!url && !poster) return null;
  return normalizeClipSnapshot({
    id: kickoff.generatedVideo?.id || `historical-kickoff-${url || poster || kickoff.video?.title || 'video'}`,
    name: kickoff.generatedVideo?.title || kickoff.video?.title || '历史对标视频',
    folder: kickoff.source === 'material_library' ? 'hot' : 'upload',
    type: kickoff.video?.contentFormat === 'image' ? 'image' : 'video',
    duration: kickoff.generatedVideo?.duration || kickoff.video?.duration || 0,
    size: '历史作品集',
    url,
    poster,
    scope: 'own',
    sourceType: 'historical-kickoff',
  });
}

const LEAD_PACKAGE_ROLE_LABELS: Record<string, string> = {
  buyer_attention: '第 1 组 · 吸引目标买家',
  capability_explanation: '第 2 组 · 解释合作能力',
  supplier_trust: '第 3 组 · 建立供应商信任',
};

function LeadContentPackagePreview({ value, imageUrl }: { value: LeadContentPackageResult; imageUrl?: string }) {
  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold text-emerald-900">三组获客内容包</p>
          <button type="button" onClick={() => navigator.clipboard?.writeText(JSON.stringify(value, null, 2))} className="text-xs font-bold text-emerald-700">复制全部</button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-emerald-800">{value.strategySummary || '按买家注意、合作能力、供应商信任依次发布，形成连续承接。'}</p>
      </div>
      {imageUrl && (
        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <div className="border-b border-border px-3 py-2 text-[11px] font-bold text-text-secondary">第 1 组首图预览</div>
          <img src={imageUrl} alt="获客内容包首图预览" className="max-h-[520px] w-full object-contain" />
        </div>
      )}
      <div className="grid gap-3 xl:grid-cols-3">
        {value.items.map((item, itemIndex) => (
          <article key={`${item.role}-${itemIndex}`} className="rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-[10px] font-bold text-accent">{LEAD_PACKAGE_ROLE_LABELS[item.role] || item.role}</p>
            <h4 className="mt-1 text-sm font-bold text-text-primary">{item.title}</h4>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">目标：{item.objective}</p>
            <div className="mt-3 space-y-2">
              {item.slides.map((slide, slideIndex) => (
                <div key={`${slide.index}-${slideIndex}`} className="rounded-lg border border-border/70 bg-white p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black text-accent">{slide.index || slideIndex + 1}</span>
                    <span className="text-[9px] text-text-muted">{slide.assetRole}</span>
                  </div>
                  <p className="mt-1 text-[11px] font-bold text-text-primary">{slide.headline}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-text-secondary">{slide.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-border pt-3 text-[10px] leading-relaxed text-text-secondary">
              <p><span className="font-bold text-text-primary">CTA：</span>{item.cta}</p>
              <p className="mt-1"><span className="font-bold text-text-primary">私信开场：</span>{item.dmOpening}</p>
            </div>
          </article>
        ))}
      </div>
      {value.referenceModulesUsed.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-2 p-3">
          <p className="text-xs font-bold text-text-primary">从对标图文保留的通用元素</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {value.referenceModulesUsed.map((module, index) => (
              <div key={`${module.module}-${index}`} className="rounded-lg bg-white p-2 text-[10px] leading-relaxed text-text-secondary">
                <p className="font-bold text-text-primary">{module.module}</p>
                <p className="mt-1">证据：{module.evidence}</p>
                <p className="mt-1 text-text-muted">套用：{module.application}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {value.fieldsToConfirm.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          生成图片或发布前需补充确认：{value.fieldsToConfirm.join('、')}
        </div>
      )}
    </div>
  );
}

function BenchmarkVideoPreview({ kickoff }: { kickoff: VideoKickoff | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playRequestRef = useRef(0);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const video = kickoff?.video;
  const isImageReference = video?.contentFormat === 'image';
  const poster = video?.thumbnail || video?.aiAnalysis?.materialPoster || kickoff?.generatedVideo?.poster || '';
  const rawUrl = video?.videoUrl || video?.aiAnalysis?.materialUrl || kickoff?.generatedVideo?.url || '';
  const apiUrl = rawUrl.replace(/\/media(?=\?|$)/, '/media-url');

  useEffect(() => {
    playRequestRef.current += 1;
    const element = videoRef.current;
    if (element) {
      element.pause();
      element.removeAttribute('src');
      delete element.dataset.sourceUrl;
      element.load();
    }
    setPlaybackUrl('');
    setPlaying(false);
    setPlaybackError('');
  }, [apiUrl]);
  const ensurePlaybackUrl = async () => {
    if (playbackUrl) return playbackUrl;
    if (!apiUrl) return '';
    if (!apiUrl.includes('/api/overseas/videos/')) {
      setPlaybackUrl(apiUrl);
      return apiUrl;
    }
    if (loading) return '';
    setLoading(true);
    try {
      const response = await fetch(apiUrl, { headers: authHeader(), credentials: 'same-origin' });
      if (!response.ok) return '';
      const next = String(((await response.json()) as { url?: string }).url || '');
      setPlaybackUrl(next);
      return next;
    } finally {
      setLoading(false);
    }
  };
  const play = async () => {
    const requestId = ++playRequestRef.current;
    setPlaybackError('');
    const url = await ensurePlaybackUrl();
    if (requestId !== playRequestRef.current) return;
    if (!url) {
      setPlaybackError('视频文件暂不可用，可点击右上角“原站”查看');
      return;
    }
    const element = videoRef.current;
    if (!element) return;
    try {
      const usedUrl = await playVideoWithAuthenticatedFallback(element, url);
      if (requestId !== playRequestRef.current) return;
      if (usedUrl !== playbackUrl) setPlaybackUrl(usedUrl);
      setPlaybackError('');
      setPlaying(true);
    } catch (error: unknown) {
      if (requestId !== playRequestRef.current) return;
      setPlaying(false);
      const message = error instanceof Error ? error.message : String(error || '');
      if (error instanceof DOMException && error.name === 'AbortError' && /interrupted by a new load/i.test(message)) return;
      setPlaybackError(message ? `视频加载失败：${message}` : '视频加载或解码失败，可点击右上角“原站”查看');
    }
  };
  const pause = () => {
    if (!videoRef.current) return;
    videoRef.current.pause();
    setPlaying(false);
  };
  const togglePlayback = () => {
    if (videoRef.current && !videoRef.current.paused) pause();
    else void play();
  };

  return (
    <aside className="sticky top-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-text-primary">{isImageReference ? '对标图文' : '对标视频'}</p>
          <p className="mt-0.5 truncate text-[10px] text-text-muted">{video?.platform || '尚未载入'} · {isImageReference ? '完整轮播证据' : '悬浮播放'}</p>
        </div>
        {video?.sourceUrl && <a href={video.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold text-accent">原站 <ExternalLink size={11} /></a>}
      </div>
      {video ? (
        <div className="p-4">
          {isImageReference ? (
            <div className="relative mx-auto aspect-[4/5] max-h-[600px] overflow-hidden rounded-xl bg-surface-2">
              {poster ? <img src={poster} alt="竞品图文首图" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-text-muted"><ImageIcon size={28} className="opacity-35" /></div>}
              <span className="absolute left-2 top-2 rounded-md bg-black/55 px-2 py-1 text-[9px] font-bold text-white backdrop-blur">首图参考</span>
            </div>
          ) : (
            <div className="group relative mx-auto aspect-[9/16] max-h-[600px] cursor-pointer overflow-hidden rounded-xl bg-black" onClick={togglePlayback}>
              <video ref={videoRef} poster={poster || undefined} muted playsInline loop preload="metadata" className="h-full w-full object-cover" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => { setPlaying(false); setPlaybackError('视频加载或解码失败，可点击右上角“原站”查看'); }} />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15 transition group-hover:bg-transparent">
                {!playing && <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"><Play size={18} fill="currentColor" /></span>}
              </div>
              {loading && <span className="absolute right-2 top-2 rounded-md bg-black/55 px-2 py-1 text-[9px] text-white">加载中…</span>}
              {playbackError && <span className="absolute inset-x-2 bottom-2 rounded-md bg-black/70 px-2 py-1.5 text-center text-[9px] leading-4 text-white">{playbackError}</span>}
            </div>
          )}
          <p className="mt-3 line-clamp-2 text-xs font-bold leading-relaxed text-text-primary">{video.title || kickoff?.referenceAnalysis?.title || '未命名对标视频'}</p>
          <p className="mt-1 text-[10px] text-text-muted">{isImageReference ? `${video.aiAnalysis?.imageEvidence?.observedFacts?.length || 0} 张逐图证据已带入，只复用可见布局与信息模块` : `${video.duration ? `${video.duration}s · ` : ''}点击视频播放或暂停`}</p>
        </div>
      ) : (
        <div className="flex min-h-[360px] flex-col items-center justify-center px-8 text-center">
          <Film size={28} className="text-text-muted opacity-35" />
          <p className="mt-3 text-xs font-bold text-text-secondary">尚未载入对标内容</p>
          <p className="mt-1 text-[10px] leading-relaxed text-text-muted">从灵感大屏选择视频或图文并进入 AI 智能素材后，将在这里显示。</p>
        </div>
      )}
    </aside>
  );
}

type ReferenceVoiceStrength = 'light' | 'balanced' | 'strong';
function referenceVoiceProfile(kickoff: VideoKickoff | null) {
  const ref = kickoff?.referenceAnalysis;
  const details = ref?.details || [];
  const audioNotes = details.map(item => item.audio || item.bgm || '').filter(Boolean).slice(0, 3);
  const hasFastCue = /快|高能|紧凑|卡点|加速|fast|upbeat/i.test(`${ref?.coreEmotion || ''} ${audioNotes.join(' ')}`);
  return {
    available: Boolean(ref && (ref.coreEmotion || details.length)),
    emotion: ref?.coreEmotion || '沿用对标视频的情绪推进，但不复制原台词和声音身份',
    summary: [ref?.coreEmotion, hasFastCue ? '快开场与紧凑推进' : '按原片信息密度自然推进', audioNotes[0]].filter(Boolean).join(' · '),
    baseSpeed: hasFastCue ? 1.1 : 1.02,
  };
}

interface ProductOption { id: string; label: string; info: string; imageUrls?: string[] }
interface ModeScriptOutput { id: string; title: string; script: string; mode: 'material' | 'product' | 'clone'; contentTheme?: VideoThemeId; buyerLabel?: string }
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

function productInfoRows(info: string) {
  const preferredLabels = ['所属类目', '产品卖点', '价格区间', '起订量', '认证资质'];
  const rows = String(info || '').split('\n').map(line => {
    const match = line.match(/^([^：:]+)[：:]\s*(.+)$/);
    return match ? { label: match[1].trim(), value: match[2].trim() } : null;
  }).filter((row): row is { label: string; value: string } => Boolean(row?.value));
  return preferredLabels
    .map(label => rows.find(row => row.label === label))
    .filter((row): row is { label: string; value: string } => Boolean(row));
}

function productOptionCategory(option: ProductOption): string {
  return option.info.match(/所属类目[：:]\s*([^\n]+)/)?.[1]?.trim() || '未分类';
}

function ProductInfoPreview({ products }: { products: ProductOption[] }) {
  return (
    <aside className="sticky top-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-black text-text-primary">产品信息</p>
        <p className="mt-0.5 text-[10px] text-text-muted">已选产品 · 生成内容将以此为准</p>
      </div>
      {products.length ? (
        <div className="max-h-[680px] space-y-4 overflow-y-auto p-4">
          {products.map(product => {
            const rows = productInfoRows(product.info);
            const images = product.imageUrls || [];
            return (
              <div key={product.id} className="overflow-hidden rounded-xl border border-border bg-surface-2">
                <div className="relative aspect-[4/3] overflow-hidden bg-surface">
                  {images[0] ? (
                    <img src={images[0]} alt={product.label} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-text-muted">
                      <ImageIcon size={30} className="opacity-35" />
                      <span className="mt-2 text-[10px]">暂无产品图片</span>
                    </div>
                  )}
                  <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[9px] font-bold text-white backdrop-blur">企业产品</span>
                </div>
                <div className="p-4">
                  <p className="text-sm font-black leading-snug text-text-primary">{product.label}</p>
                  <div className="mt-3 space-y-2.5">
                    {rows.map(row => (
                      <div key={row.label} className="grid grid-cols-[58px_1fr] gap-2 text-[11px] leading-relaxed">
                        <span className="text-text-muted">{row.label}</span>
                        <span className="font-semibold text-text-secondary">{row.value}</span>
                      </div>
                    ))}
                  </div>
                  {images.length > 1 && (
                    <div className="mt-3 flex gap-2 overflow-x-auto">
                      {images.slice(1, 5).map((url, index) => (
                        <img key={`${url}-${index}`} src={url} alt={`${product.label} ${index + 2}`} className="h-12 w-12 shrink-0 rounded-lg border border-border object-cover" />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-[360px] flex-col items-center justify-center px-8 text-center">
          <ImageIcon size={28} className="text-text-muted opacity-35" />
          <p className="mt-3 text-xs font-bold text-text-secondary">尚未选择产品</p>
          <p className="mt-1 text-[10px] leading-relaxed text-text-muted">请从左侧“产品信息”中选择企业产品，图片和重点信息将在这里显示。</p>
        </div>
      )}
    </aside>
  );
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
      const assetNames = (list?: Array<{ name?: string }>) => (list || [])
        .map(asset => compact(asset.name))
        .filter(Boolean)
        .slice(0, 6)
        .join('、');
      return {
        id: `product-${index}-${name}`,
        label: name,
        imageUrls: [
          ...(item.images || []),
          ...(item.packagingImages || []),
          ...(item.sceneImages || []),
        ].map(asset => compact(asset.url)).filter(Boolean),
        info: [
          `产品名称：${name}`,
          compact(item.sku) ? `产品SKU：${compact(item.sku)}` : '',
          category ? `所属类目：${category}` : '',
          highlights ? `产品卖点：${highlights}` : '',
          price ? `价格区间：${price}` : '',
          moq ? `起订量：${moq}` : '',
          certifications ? `认证资质：${certifications}` : '',
          assetNames(item.images) ? `产品主图素材：${assetNames(item.images)}` : '',
          assetNames(item.factoryImages) ? `工厂实拍素材：${assetNames(item.factoryImages)}` : '',
          assetNames(item.packagingImages) ? `包装定制素材：${assetNames(item.packagingImages)}` : '',
          assetNames(item.certificateImages) ? `证书资质素材：${assetNames(item.certificateImages)}` : '',
          assetNames(item.sceneImages) ? `使用场景素材：${assetNames(item.sceneImages)}` : '',
          assetNames(item.brandAssets) ? `品牌视觉素材：${assetNames(item.brandAssets)}` : '',
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
      normalizeScriptTimestamps(`[${item.time}]`),
      item.environment ? `环境：${item.environment}` : '',
      item.purpose ? `镜头功能：${item.purpose}` : '',
      item.visual ? `画面：${item.visual}` : '',
      item.shot ? `景别：${item.shot}` : '',
      item.camera ? `运镜：${item.camera}` : '',
      item.dialogue ? `口播：${item.dialogue}` : '口播：无',
      item.onScreenText || item.subtitle ? `屏幕文字：${item.onScreenText || item.subtitle}` : '屏幕文字：无',
      item.ambientSound ? `环境声：${item.ambientSound}` : '',
      item.bgm || item.audio ? `配乐：${item.bgm || item.audio}` : '',
      item.soundEffects?.length ? `音效：${item.soundEffects.join('、')}` : '',
      item.persistentState ? `持续状态：${item.persistentState}` : '',
      item.beats?.length ? `镜头内节拍：${item.beats.map(beat => `[${beat.time || '镜头内'}] ${beat.action || ''}${beat.dialogue ? `／口播：${beat.dialogue}` : ''}${beat.onScreenText ? `／字幕：${beat.onScreenText}` : ''}`).join('；')}` : '',
      item.authenticity ? `真实性要求：${item.authenticity}` : '',
      item.needsReview ? `人工复核：是（置信度${Math.round((item.confidence ?? 0) * 100)}%）` : '',
      item.note ? `备注：${item.note}` : '',
    ].filter(Boolean).join('；'))
    .join('\n');
  return [
    ref.visualStyle ? `结构风格：${ref.visualStyle}` : '',
    ref.coreEmotion ? `情绪节奏：${ref.coreEmotion}` : '',
    details ? `对标视频脚本详析（必须逐段依据，时间/环境/景别/运镜/配乐/动作节奏优先保持）：\n${details}` : '',
  ].filter(Boolean).join('\n\n');
}

function referenceAnalysisEnd(kickoff: VideoKickoff | null): number {
  return (kickoff?.referenceAnalysis?.details || []).reduce((max, item) => {
    const range = parseCueRange(item.time);
    return Math.max(max, range?.end || 0);
  }, 0);
}

function hasIncompleteReferenceAnalysis(kickoff: VideoKickoff | null): boolean {
  const sourceDuration = Number(kickoff?.video?.duration || 0);
  const analyzedUntil = referenceAnalysisEnd(kickoff);
  const details = kickoff?.referenceAnalysis?.details || [];
  if (!details.length) return true;
  const ranges = details
    .map(item => parseCueRange(item.time))
    .filter((item): item is { start: number; end: number } => Boolean(item))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (!ranges.length || ranges[0]!.start > 0.75) return true;
  if (sourceDuration > 0 && analyzedUntil + 1 < sourceDuration) return true;
  const timelineDuration = sourceDuration > 0 ? sourceDuration : analyzedUntil;
  if (ranges.length < Math.ceil(timelineDuration / 5)) return true;
  return ranges.some((range, index) => {
    const next = ranges[index + 1];
    return range.end - range.start > 5.5
      || Boolean(next && next.start - range.end > 0.75)
      || Boolean(next && range.end - next.start > 0.75);
  }) || details.some(item => /分析超时|缺少真实片段/.test(`${item.note || ''} ${item.visual || ''}`));
}

type MigrationMode = 'fidelity' | 'structure' | 'mechanism';

interface MigrationRecommendation {
  mode: MigrationMode;
  label: string;
  reason: string;
  preserve: string[];
  rebuild: string[];
}

function recommendMigration(kickoff: VideoKickoff | null, productInfo: string): MigrationRecommendation {
  const reference = [
    kickoff?.video?.title || '',
    kickoff?.referenceAnalysis?.visualStyle || '',
    ...(kickoff?.referenceAnalysis?.details || []).flatMap(item => [item.environment || '', item.visual || '', item.purpose || '']),
  ].join(' ').toLowerCase();
  const product = String(productInfo || '').toLowerCase();
  const groups = [
    /truck|lorry|卡车|货车|牵引车|底盘/,
    /cream|serum|cosmetic|skincare|lip gloss|lipstick|唇蜜|口红|面霜|精华|美妆|护肤/,
    /lighting|light fixture|track light|灯具|照明|轨道灯|筒灯/,
    /package|packaging|paper bag|paper box|包装|纸袋|纸盒|礼盒/,
    /furniture|sofa|chair|家具|沙发|椅子/,
    /apparel|garment|fabric|dress|服装|面料|连衣裙/,
  ];
  const referenceGroup = groups.findIndex(group => group.test(reference));
  const productGroup = groups.findIndex(group => group.test(product));
  const details = kickoff?.referenceAnalysis?.details || [];
  const preserve = [
    details.length ? `保留 ${details.length} 段原片镜头顺序与时长比例` : '保留开场钩子与信息揭示顺序',
    '保留可迁移的构图、切镜密度和音画节奏',
  ];
  if (!kickoff || !details.length) return {
    mode: 'mechanism', label: '机制借鉴', reason: '对标视频缺少完整逐镜证据，不宜直接复刻分镜。', preserve,
    rebuild: ['根据企业产品和现有素材重建场景、动作和证明内容'],
  };
  if (referenceGroup >= 0 && referenceGroup === productGroup) return {
    mode: 'fidelity', label: '高保真复刻', reason: '对标内容与所选产品展示逻辑接近，可保留大部分分镜。', preserve,
    rebuild: ['替换竞品品牌、型号、参数和不支持的卖点'],
  };
  if (referenceGroup >= 0 && productGroup >= 0 && referenceGroup !== productGroup) return {
    mode: 'structure', label: '结构迁移', reason: '对标视频与所选产品跨品类，直接替换会产生不可执行画面。', preserve,
    rebuild: ['产品场景、主体动作和细节证明', '所有竞品品牌、型号和原品类对象'],
  };
  return {
    mode: 'structure', label: '结构迁移', reason: '可保留原片的钩子、证明顺序和节奏，画面按企业产品重建更稳妥。', preserve,
    rebuild: ['产品场景、动作和证明内容', '竞品专属事实与话术'],
  };
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

function referenceProductTerms(kickoff: VideoKickoff): string[] {
  const raw = [
    kickoff.video?.title || '',
    ...(kickoff.referenceAnalysis?.details || []).flatMap(item => [item.visual || '', item.subtitle || '', item.onScreenText || '']),
  ].join('\n');
  const stopWords = new Set(['facebook', 'instagram', 'youtube', 'tiktok', 'video', 'official', 'factory', 'product']);
  const titleTerms = String(kickoff.video?.title || '').match(/[A-Za-z][A-Za-z0-9-]{3,}/g) || [];
  const upperTerms = raw.match(/\b[A-Z][A-Z0-9-]{2,}\b/g) || [];
  return [...new Set([...titleTerms, ...upperTerms]
    .map(term => term.trim())
    .filter(term => term.length >= 3 && !stopWords.has(term.toLowerCase())))];
}

function adaptReferenceVisualToProduct(visual: string, product: ReturnType<typeof parseProductBrief>, kickoff?: VideoKickoff): string {
  const productObject = `${compactCategory(product)}产品`;
  const productName = product.name && product.name !== productObject ? product.name : productObject;
  let next = compact(visual) || `展示${productName}的外观、细节和实际效果`;
  for (const term of kickoff ? referenceProductTerms(kickoff) : []) {
    next = next.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), productName);
  }
  next = next
    .replace(/护肤美妆纸艺品（[^）]*）/g, `${productObject}纸艺品`)
    .replace(/护肤美妆纸艺品\([^)]*\)/g, `${productObject}纸艺品`)
    .replace(/护肤美妆产品|护肤品|美妆品|美妆产品|眼膜|唇膏|面霜|安瓶|指甲油|蒸笼/g, productObject)
    .replace(/饺子造型的[^，。；;]*?(?:纸艺品|产品)/g, `饺子造型的${productObject}纸艺品`)
    .replace(/多个[^，。；;]*?(?:产品|纸艺品)/, `多个${productObject}纸艺品`)
    .replace(/一双[^，。；;]*?手/g, '一双手')
    .replace(/粉色大饺子/g, `粉色${productObject}`)
    .replace(/可爱的饺子造型纸艺品/g, `可爱的${productObject}纸艺品`);
  const productText = `${product.name} ${product.category}`.toLowerCase();
  const incompatibleReferenceObjects = [
    { test: /truck|lorry|卡车|货车|牵引车|底盘/gi, supported: /truck|lorry|卡车|货车|牵引车|底盘/i },
    { test: /cream|serum|cosmetic|skincare|面霜|精华|美妆|护肤品/gi, supported: /cream|serum|cosmetic|skincare|面霜|精华|美妆|护肤/i },
    { test: /lighting|light fixture|track light|灯具|照明|轨道灯|筒灯/gi, supported: /lighting|light|灯具|照明|轨道灯|筒灯/i },
  ];
  for (const group of incompatibleReferenceObjects) {
    if (!group.supported.test(productText)) next = next.replace(group.test, productObject);
  }
  if (!next.includes(productObject) && !next.includes(product.name)) {
    next = next.replace(/画面中出现/, `画面中出现${productName}，`);
  }
  return next;
}

function buildLocalCloneScript(kickoff: VideoKickoff, productInfo: string, languageCode: string, variant = 0, migrationMode: MigrationMode = 'structure'): string {
  const product = parseProductBrief(productInfo);
  const details = kickoff.referenceAnalysis?.details?.length ? kickoff.referenceAnalysis.details : [];
  const variantPlans = [
    {
      environments: ['干净桌面产品主视觉区', '近距离样品展示台', '细节检验工作台', '规格与包装陈列区', '品牌产品矩阵背景'],
      visuals: [
        `${product.name}正面完整亮相，主体约占画面三分之二，用清晰轮廓建立产品识别`,
        `手持${product.name}缓慢转到侧面，展示外观、结构与包装关系`,
        `镜头贴近${product.name}关键细节，以可见纹理或结构证明${product.highlights}`,
        `把${product.name}的规格、包装或可定制部分并列摆放，逐项给出视觉对照`,
        `${product.name}与品牌资料同框收尾，保持画面整洁并强化产品记忆`,
      ],
    },
    {
      environments: ['真实使用准备区', '产品操作演示台', '结果对照区', '样品确认区', '整套交付展示区'],
      visuals: [
        `先呈现${product.name}即将投入使用的状态，以动作悬念形成开场`,
        `双手完成一次${product.name}可实际拍摄的操作，突出使用路径而非静态陈列`,
        `把操作前后或两个有效角度放在同一画面比较，用结果证明${product.highlights}`,
        `依次展示${product.name}样品、包装和可确认规格，让采购信息可被看见`,
        `将${product.name}成套排开并回到完成态，以完整交付感结束`,
      ],
    },
    {
      environments: ['质检台近景区', '结构拆解展示区', '材质细节灯光区', '包装核验区', '工厂资料背景区'],
      visuals: [
        `以${product.name}局部极近景开场，随后拉开到完整产品，制造细节揭晓`,
        `沿${product.name}结构顺序逐处移动镜头，展示组成、接口或工艺关系`,
        `用侧光拍出${product.name}材质和边缘细节，把${product.highlights}转成可见证据`,
        `手动翻转${product.name}及其包装标签，核验外观、规格和定制位置`,
        `产品、包装与企业资料形成前中后景，定格在${product.name}完整正面`,
      ],
    },
    {
      environments: ['采购验样桌', '规格并列区', '手部测试台', '定制方案板前', '询盘资料收纳区'],
      visuals: [
        `采购者把${product.name}样品推入画面中央，以验样动作直接建立开场问题`,
        `把${product.name}的两个可见角度并排摆放，手指沿结构逐项指出差异`,
        `完成一次可复现的手部检查动作，用近景记录${product.highlights}对应的真实细节`,
        `包装、标识位与${product.name}依次进入画面，形成清晰的定制确认顺序`,
        `镜头从确认清单移回${product.name}完整产品，以单一询盘动作收尾`,
      ],
    },
    {
      environments: ['仓库取样通道', '开箱检查桌', '核心部件展示垫', '批量陈列背景', '出货确认区'],
      visuals: [
        `从成排样品中抽出一件${product.name}并快速转向镜头，形成动态揭晓`,
        `拆开${product.name}外包装并依次取出内容物，保留完整开箱动作`,
        `将核心结构靠近镜头后再放回产品主体，用连续动作呈现${product.highlights}`,
        `单件样品与批量陈列同框，镜头横移展示包装和品牌位置`,
        `封箱标签与${product.name}正面依次定格，强调可执行的交付确认`,
      ],
    },
    {
      environments: ['使用场景入口', '第一视角操作区', '侧面对照区', '品牌展示桌', '简洁 CTA 背景'],
      visuals: [
        `第一视角拿起${product.name}进入使用位置，不先展示全貌以制造悬念`,
        `按真实步骤完成一次操作，镜头跟随手部与${product.name}移动`,
        `固定机位并列展示两个角度或状态，以画面差异说明${product.highlights}`,
        `将${product.name}放回品牌展示桌，补充包装与规格的可见信息`,
        `手指停在${product.name}与资料卡之间，画面只保留一个明确行动入口`,
      ],
    },
  ];
  const plan = variantPlans[Math.abs(Math.trunc(variant)) % variantPlans.length];
  if (details.length) {
    return details.map((item, index) => {
      const time = normalizeScriptTimestamps(`[${item.time || `${index * 4}-${(index + 1) * 4}s`}]`);
      const environment = migrationMode === 'fidelity'
        ? (item.environment || '沿用原片环境')
        : (plan.environments[Math.min(index, plan.environments.length - 1)] || sceneEnvironmentForProduct(product, index));
      const groundedVisual = migrationMode === 'fidelity'
        ? adaptReferenceVisualToProduct(item.visual || item.note || '', product, kickoff)
        : plan.visuals[Math.min(index, plan.visuals.length - 1)];
      const verifiedProductCue = index === 0 && product.highlights && product.highlights !== '待补充真实卖点'
        ? `，镜头中的品牌、型号和产品外观均以${product.name}的企业资料为准，重点呈现${product.highlights}`
        : '';
      const visual = `${groundedVisual}${verifiedProductCue}`;
      const voice = compact(item.dialogue);
      const subtitle = compact(item.onScreenText || item.subtitle);
      if (languageCode === 'zh') {
        return [
          time,
          `环境：${environment}`,
          `景别：${item.shot || '沿用原片景别'}`,
          `运镜：${item.camera || '沿用原片机位'}`,
          `画面：${visual}`,
          `配乐：${item.bgm || item.audio || '无'}`,
          `台词：${voice || '无'}`,
          `字幕：${subtitle || '无'}`,
        ].join('\n');
      }
      return [
        time,
        `Environment: ${environment}`,
        `Shot: ${item.shot || 'match the reference shot size'}`,
        `Camera: ${item.camera || 'match the reference camera'}`,
        `Visual: ${visual}`,
        `Music: ${item.bgm || item.audio || 'None'}`,
        `Voiceover: ${voice || 'None'}`,
        `Subtitle: ${subtitle || 'None'}`,
      ].join('\n');
    }).join('\n\n');
  }
  return '';
}

function isStandardCloneStoryboard(value: string): boolean {
  const text = String(value || '');
  if (!text.trim()) return false;
  const required = ['环境', '景别', '运镜', '画面', '配乐', '台词', '字幕'];
  const hasAllFields = required.every(label => new RegExp(`${label}[：:]`).test(text));
  const oldSparseFormat = /人物说[：:]|采购这类|真实使用场景|痛点特写|买家最关心的结果|先看真实使用效果|把「[^」]+」放到真实使用场景/.test(text);
  return hasAllFields && !oldSparseFormat && !hasUnnaturalVoiceover(text);
}

function ensureStandardCloneStoryboard(value: string, kickoff: VideoKickoff, productInfo: string, languageCode: string, strictProductName?: string, migrationMode: MigrationMode = 'structure'): { script: string; normalized: boolean } {
  const sanitized = sanitizeStoryboardScript(value, productInfo, strictProductName).trim();
  if (isStandardCloneStoryboard(sanitized)) return { script: sanitized, normalized: false };
  return { script: '', normalized: true };
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

function cloneScriptMaxSimilarity(candidate: string, existingScripts: string[]): number {
  return existingScripts.reduce((max, item) => Math.max(max, cloneScriptSimilarity(candidate, item)), 0);
}

function ensureDistinctCloneStoryboard(input: {
  script: string;
  kickoff: VideoKickoff;
  productInfo: string;
  languageCode: string;
  strictProductName?: string;
  existingScripts: string[];
  variantSeed: number;
  migrationMode?: MigrationMode;
}) {
  let normalized = ensureStandardCloneStoryboard(input.script, input.kickoff, input.productInfo, input.languageCode, input.strictProductName, input.migrationMode);
  if (!isDuplicateCloneScript(normalized.script, input.existingScripts)) return normalized;
  return { script: '', normalized: true };
}

function buildLocalProductScript(productInfo: string, languageCode: string, totalDuration = 20): string {
  const product = parseProductBrief(productInfo);
  const field = (label: string) => compact(String(productInfo || '').split('\n').find(line => line.startsWith(`${label}：`) || line.startsWith(`${label}:`))?.replace(new RegExp(`^${label}[：:]\\s*`), ''));
  const details = [
    field('容量') ? `容量 ${field('容量')}` : '',
    field('杯体材质') ? `杯体材质 ${field('杯体材质')}` : '',
    field('刀片材质') ? `刀片材质 ${field('刀片材质')}` : '',
    field('充电方式') ? `充电方式 ${field('充电方式')}` : '',
    ...compact(product.highlights).split(/[、,，;；\n]/).map(item => item.trim()),
  ].filter(Boolean);
  const points = [details[0] || product.category, details[1] || '样品细节可确认', details[2] || '实际操作可打样确认'];
  const total = Math.max(10, totalDuration);
  const boundaries = [0, .18, .4, .62, .82, 1].map(value => +(value * total).toFixed(1));
  const time = (index: number) => `${boundaries[index]}-${boundaries[index + 1]}s`;
  const productText = `${product.name} ${product.category}`.toLowerCase();
  const appliance = /榨汁|果汁|搅拌|小家电|blender|juicer|appliance/.test(productText);
  const scenes = [
    {
      time: time(0), scene: '采购风险钩子',
      visual: `把「${product.name}」与采购资料放到桌面，不模拟资料未提供的效果。`,
      voice: appliance ? '榨汁杯好看，不好洗也白搭。' : `${compactCategory(product)}只看图片，真不够。`, subtitle: appliance ? '好看 ≠ 好清洗' : '先确认真实细节',
    },
    {
      time: time(1), scene: '资料与实物细节',
      visual: `用实物和参数卡确认${points[0]}，无法目测的参数只放资料卡。`,
      voice: appliance && /容量\s*420/i.test(points[0]) ? '420毫升，通勤一杯刚刚好。' : `${Array.from(points[0]).slice(0, 12).join('')}，细节拍给你看。`, subtitle: appliance ? '420mL · 通勤随行' : String(points[0]),
    },
    {
      time: time(2), scene: '第二证明点',
      visual: `展示${points[1]}对应的实物或资料，不添加跨品类动作。`,
      voice: appliance && /可拆洗|拆洗/.test(product.highlights) ? '杯体能拆，清洗不用绕弯。' : `${Array.from(points[1]).slice(0, 10).join('')}，实物更有说服力。`, subtitle: appliance ? '可拆杯体 · 清洗省事' : String(points[1]),
    },
    {
      time: time(3), scene: '定制确认',
      visual: `展示产品资料中已经提供的定制项、包装样或LOGO位置。`,
      voice: /logo|包装|彩盒/i.test(product.highlights) ? 'LOGO和彩盒，都能做成你的品牌。' : '想做自己的版本？样品可以先聊。', subtitle: /logo|包装|彩盒/i.test(product.highlights) ? 'LOGO / 彩盒定制' : '先看定制样',
    },
    {
      time: time(4), scene: '询盘转化',
      visual: `收束到数量、目标市场、包装和留言动作。`,
      voice: '想测样？发我数量和市场。', subtitle: `${product.moq ? `发数量 · MOQ ${product.moq}` : '发数量 · 拿样品报价'}`,
    },
  ];
  return scenes.map(item => [
    `[${item.time}]`,
    `环境：真实产品桌面演示区`,
    `景别：中近景`,
    `运镜：固定镜头或缓慢推进`,
    `镜头功能：${item.scene}`,
    `画面：${item.visual}`,
    `配乐：轻节奏BGM，口播时自动降低音量`,
    `人物说：“${item.voice}”`,
    `字幕：${item.subtitle}`,
  ].join('\n')).join('\n\n');
}

function publicScriptFailureReason(value: unknown): string {
  const message = String(value || '');
  if (/429|RESOURCE_EXHAUSTED|prepayment credits|quota|billing/i.test(message)) return '上游模型额度不足，未生成脚本。请更换模型 Key 或稍后重试。';
  if (/401|403|api.?key|unauthorized|permission/i.test(message)) return '上游模型授权暂不可用，未生成脚本。请检查模型 Key 或权限。';
  if (/timeout|timed out|超时|503|502|504|UNAVAILABLE/i.test(message)) return '上游模型暂时繁忙，未生成脚本。请稍后重试。';
  if (/\{\s*"?(?:error|code|message)"?|https?:\/\//i.test(message)) return '上游模型生成失败，未生成脚本。请补充素材/产品信息后重试。';
  return message || '模型生成失败，未生成脚本。';
}

function buildLocalMaterialScript(materialsList: Clip[], selectedIds: string[], productInfo: string, totalDuration = 20): string {
  const product = parseProductBrief(productInfo);
  const selectedMaterials = selectedIds.length
    ? materialsList.filter(item => selectedIds.includes(item.id))
    : materialsList.filter(item => item.type !== 'audio').slice(0, 4);
  const usable = selectedMaterials.length ? selectedMaterials : [{ name: '当前产品素材', folder: 'product', type: 'video', duration: 4 } as Clip];
  const infos = buildMaterialInfosForScript(usable.slice(0, 8), totalDuration);
  return infos.map((info, index) => {
    const clip = usable.find(item => item.name === info.name) || usable[index]!;
    const start = info.targetStart;
    const end = info.targetEnd;
    const materialRole = clip.folder === 'presenter' ? '真人口播素材'
      : clip.folder === 'detail' ? '产品细节素材'
      : clip.folder === 'factory' ? '工厂/实力素材'
      : clip.folder === 'scene' ? '场景使用素材'
      : clip.folder === 'model' ? '模特/效果素材'
      : '产品展示素材';
    const materialText = `${clip.name} ${clip.tags || ''} ${clip.shotFunction || ''}`;
    const isBeauty = /精华|护肤|美容|serum|skincare|cosmetic/i.test(`${product.name} ${product.category} ${materialText}`);
    const voice = index === 0
      ? (/滴|液体|质地/i.test(materialText) ? '这一滴的质感，开场就很抓眼。' : `${Array.from(product.name).slice(0, 7).join('')}，第一眼就得抓人。`)
      : index === infos.length - 1
        ? (isBeauty ? '想做自有品牌？发数量，给你配方案。' : '想测样？发我数量和市场。')
        : clip.folder === 'product'
          ? (isBeauty ? '瓶身和滴管一入镜，品牌感就来了。' : '外观和结构，镜头里一次看清。')
          : clip.folder === 'factory' ? '样品能打，大货也要接得住。'
            : clip.folder === 'packaging' ? '换上你的LOGO，才是你的产品。'
              : clip.folder === 'scene' || clip.folder === 'model' ? '放进真实场景，客户更容易代入。'
                : '细节拍到位，卖点自然站得住。';
    return [
      `[${start}-${end}s]`,
      `素材理解：${materialRole}《${clip.name}》，优先使用它已有的画面信息，不凭空新增场景。`,
      `产品承接：只把已确认的可见动作或细节连接到「${product.name}」，不推断功效。`,
      `画面：使用素材《${clip.name}》按可见内容剪辑，优先截取动作完整、主体清楚的位置。`,
      `人物说：“${voice}”`,
      `字幕：${index === 0 ? (/滴|液体|质地/i.test(materialText) ? '一滴抓住注意力' : '第一眼就要抓人') : index === usable.length - 1 ? '发数量 · 拿方案' : clip.folder === 'product' ? '质感就是品牌感' : clip.folder === 'factory' ? '样品到大货都能接' : clip.folder === 'packaging' ? '做成你的品牌' : clip.folder === 'scene' || clip.folder === 'model' ? '让客户看见使用场景' : '看得见的卖点'}`,
    ].join('\n');
  }).join('\n\n');
}

function materialRoleLabel(clip: Pick<Clip, 'folder' | 'type'>): string {
  if (clip.folder === 'presenter') return '真人口播素材';
  if (clip.folder === 'detail') return '产品细节素材';
  if (clip.folder === 'factory') return '工厂/实力素材';
  if (clip.folder === 'packaging') return '包装定制素材';
  if (clip.folder === 'certificate') return '证书资质素材';
  if (clip.folder === 'scene') return '场景使用素材';
  if (clip.folder === 'brand') return '品牌视觉素材';
  if (clip.folder === 'hot') return '爆款图文参考';
  if (clip.folder === 'model') return '模特/效果素材';
  if (clip.type === 'image') return '静态产品图';
  return '产品展示素材';
}

function buildMaterialInfosForScript(clips: Clip[], totalDuration: number, hookMaterialId = '') {
  const usable = clips.filter(item => item.type !== 'audio');
  let cursor = 0;
  const result = usable.reduce<Array<{
    name: string; type: Clip['type']; folder: string; duration: number; effectiveDuration: number; role: string;
    targetStart: number; targetEnd: number; industry?: string; shotFunction?: string; tags?: string; observations?: string[];
  }>>((result, clip) => {
    if (cursor >= totalDuration) return result;
    const effectiveDuration = Math.min(
      clip.id === hookMaterialId && clip.type === 'video' ? Math.max(0.5, clip.duration) : effectiveClipDuration(clip),
      totalDuration - cursor,
    );
    const targetStart = +cursor.toFixed(1);
    const targetEnd = +Math.min(totalDuration, cursor + effectiveDuration).toFixed(1);
    const observations = (clip.segments || []).slice(0, 4).map(segment => [
      `${segment.start}-${segment.end}s`,
      segment.action,
      segment.shot,
      segment.camera,
      segment.environment,
      segment.productVisible ? `产品清晰度${segment.productClarity}` : '',
      segment.ocrText ? `OCR:${segment.ocrText.slice(0, 120)}` : '',
      segment.needsReview && !segment.manualConfirmed ? '待人工复核' : '',
    ].filter(Boolean).join('；'));
    result.push({
      name: clip.name,
      type: clip.type,
      folder: clip.folder,
      duration: clip.type === 'image' ? 3 : clip.duration || effectiveDuration,
      effectiveDuration,
      role: materialRoleLabel(clip),
      targetStart,
      targetEnd,
      industry: clip.industry,
      shotFunction: clip.shotFunction,
      tags: clip.tags,
      observations,
    });
    cursor = targetEnd;
    return result;
  }, []);
  const last = result[result.length - 1];
  if (last && totalDuration - last.targetEnd > 0 && totalDuration - last.targetEnd <= 0.75) {
    last.effectiveDuration = +(last.effectiveDuration + totalDuration - last.targetEnd).toFixed(1);
    last.targetEnd = totalDuration;
  }
  return result;
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


const VOICEOVER_FIELD_RE = /(?:人物说|台词|Voiceover|VO|口播)\s*[：:]\s*(.+)$/i;
const NON_VOICE_FIELD_RE = /^(?:环境|景别|运镜|构图|镜头功能|画面|Visual|字幕|Caption|屏幕文字|OnScreenText|配乐|音乐|音效|Sound|SFX|BGM|真实性要求|可见事实|表达意图|未展示因果|Omni提示词|Omni禁止项)\s*[：:]/i;

function hasStoryboardFieldLabels(lines: string[]): boolean {
  return lines.some(raw => {
    const line = raw.trim();
    return VOICEOVER_FIELD_RE.test(line) || NON_VOICE_FIELD_RE.test(line);
  });
}

function looksLikeOnScreenOnlyText(value: string): boolean {
  const text = String(value || '').replace(/\s+/g, '').trim();
  if (!text) return true;
  if (isNonSpeechSfx(text)) return true;
  if (/[｜|]/.test(text)) return true;
  if (/[¥￥$€£]\s*\d/.test(text)) return true;
  if (/^[A-Z][A-Z0-9_-]{2,}(?:-\d+)?$/i.test(text)) return true;
  if (/^[A-Z][A-Z0-9_-]{2,}(?:-\d+)?(?:资料|认证|报价|PDF)$/i.test(text)) return true;
  if (/^[A-Z0-9_-]{2,}[\u4e00-\u9fff]{1,10}(?:\d+款?)?$/i.test(text)) return true;
  if (/^\d+(?:\.\d+)?\s*(?:资料|认证|报价|PDF)$/i.test(text)) return true;
  if (/^(?:[\d.]+|[A-Z0-9_-]+|PDF|CPNP|MOQ|OEM|ODM)+$/i.test(text)) return true;
  if (/^(?:按压即发|绵密不塌|现货|秒回PDF|含报价|含认证|非打样|即订即发)$/i.test(text)) return true;
  return false;
}

function looksLikeStandaloneSpeech(value: string): boolean {
  const text = cleanVoiceoverLine(value);
  if (!text || looksLikeOnScreenOnlyText(text) || looksLikeProductionInstruction(text)) return false;
  if (/[，。！？!?、]/.test(text)) return true;
  if (/(吗|呢|吧|了|我|你|咱|这|那|真能|不是|马上|直接|发我|留言|私信)/.test(text) && text.length >= 6) return true;
  if (/\s/.test(text) && /^(check|send|watch|see|message|comment|dm|ask|get|try)\b/i.test(text)) return true;
  return text.length >= 10 && /[\u4e00-\u9fff]/.test(text);
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

function mergeTimestampedVoiceoverSegments(
  segments: Array<{ time: string; text: string }>,
): Array<{ time: string; text: string }> {
  const merged: Array<{ time: string; text: string }> = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (!previous || previous.time !== segment.time) {
      merged.push({ ...segment });
      continue;
    }

    const previousKey = compactComparable(previous.text);
    const currentKey = compactComparable(segment.text);
    if (!currentKey || previousKey === currentKey || previousKey.includes(currentKey)) continue;
    if (currentKey.includes(previousKey)) {
      previous.text = segment.text;
      continue;
    }

    const separator = /[。！？!?]$/.test(previous.text) ? '' : '。';
    previous.text = `${previous.text}${separator}${segment.text}`;
  }
  return merged;
}

function parseTimestampedVoiceover(value: string): Array<{ time: string; text: string }> {
  const lines = String(value || '').split(/\n+/);
  const segments: Array<{ time: string; text: string }> = [];
  const structuredStoryboard = hasStoryboardFieldLabels(lines);
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

    const prefixed = line.match(VOICEOVER_FIELD_RE);
    if (!prefixed && NON_VOICE_FIELD_RE.test(line)) continue;
    const quoted = !prefixed && !structuredStoryboard ? line.match(/[“"]([^”"]{2,})[”"]/) : null;
    const sameLine = timeMatch ? line.replace(timeMatch[0], '').trim() : '';
    let text = quoted?.[1] || prefixed?.[1] || '';
    if (!text && sameLine && !structuredStoryboard && looksLikeStandaloneSpeech(sameLine)) text = sameLine;
    text = cleanVoiceoverLine(text);
    if (!text || looksLikeProductionInstruction(text) || isNonSpeechSfx(text)) continue;
    if (!prefixed && looksLikeOnScreenOnlyText(text)) continue;
    segments.push({ time: currentTime || normalizeTimeLabel('', fallbackIndex), text });
    fallbackIndex += 1;
  }
  if (segments.length) return mergeTimestampedVoiceoverSegments(segments);
  if (structuredStoryboard) return [];
  return Array.from(String(value || '').matchAll(/[“"]([^”"]{2,})[”"]/g))
    .map((match, index) => ({ time: normalizeTimeLabel('', index), text: cleanVoiceoverLine(match[1] || '') }))
    .filter(item => item.text && !isNonSpeechSfx(item.text) && !looksLikeOnScreenOnlyText(item.text));
}


function formatVoiceoverWithTimestamps(value: string): string {
  const parsed = parseTimestampedVoiceover(value).filter(item => !isNonSpeechSfx(item.text));
  if (parsed.length) return parsed.map(item => `${item.time} ${item.text}`).join('\n');
  const fallback = cleanVoiceoverLine(value);
  return isNonSpeechSfx(fallback) ? '' : fallback;
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

  return normalizeScriptTimestamps(out.join('\n').replace(/\n{3,}/g, '\n\n').trim());
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
  if (/^(无|暂无|无口播|无台词|无对白|没有口播|没有台词|none|n\/a|no voiceover|no dialogue)$/i.test(normalized)) return true;
  if (/^(噗|噗噗|砰|砰砰|咚|咚咚|哒|哒哒|啪|啪啪|嗒|嗒嗒|咔|咔哒|咔嗒|咔嚓|咯吱|嘎吱|吱呀|叮|叮咚|嘀|滴滴|唰|嗖|嗡|嗡嗡|轰|轰隆|沙沙|刷刷)$/i.test(normalized)) return true;
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

function FirstVideoFrameThumb({ clip }: { clip: Clip }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setReady(false);
    setFailed(false);
  }, [clip.id, clip.url]);

  if (!clip.url || failed) return <Thumb seed={clip.id} ratio="aspect-video" />;
  return (
    <div className="relative w-full aspect-video overflow-hidden rounded-lg bg-surface-2">
      {!ready && <div className="absolute inset-0 animate-pulse bg-slate-200" />}
      <video
        ref={videoRef}
        src={clip.url}
        muted
        playsInline
        preload="auto"
        className={`absolute inset-0 h-full w-full object-cover ${ready ? 'opacity-100' : 'opacity-0'}`}
        onLoadedData={() => {
          const video = videoRef.current;
          if (!video) return;
          const target = Number.isFinite(video.duration) && video.duration > 0
            ? Math.min(0.05, video.duration / 2)
            : 0;
          if (target <= 0) { setReady(true); return; }
          try { video.currentTime = target; } catch { setReady(true); }
        }}
        onSeeked={() => setReady(true)}
        onError={() => { setReady(true); setFailed(true); }}
      />
    </div>
  );
}

function ProjectFirstFrameThumb({ project, materials }: { project: StudioProject; materials: Clip[] }) {
  const spec = project.spec || {};
  const assemblies = Array.isArray(spec.storyboardAssemblies)
    ? spec.storyboardAssemblies as Array<{ id?: string; assignments?: Record<string, string>; selected?: string[] }>
    : [];
  const activeAssemblyId = typeof spec.activeAssemblyId === 'string' ? spec.activeAssemblyId : '';
  const assembly = assemblies.find(item => item.id === activeAssemblyId) || assemblies[0];
  const legacyAssignments = spec.storyboardAssignments && typeof spec.storyboardAssignments === 'object'
    ? spec.storyboardAssignments as Record<string, string>
    : {};
  const legacySelected = Array.isArray(spec.selected) ? spec.selected.filter((id): id is string => typeof id === 'string') : [];
  const firstMaterialId = [
    ...Object.values(assembly?.assignments || {}),
    ...(assembly?.selected || []),
    ...Object.values(legacyAssignments),
    ...legacySelected,
  ].find(Boolean);
  const clip = firstMaterialId ? materials.find(item => item.id === firstMaterialId) : undefined;

  if (!clip) return <Thumb seed={project.thumbSeed ?? firstMaterialId ?? 'cv1'} ratio="aspect-video" />;
  if (clip.poster || clip.type === 'image') {
    return <Thumb seed={clip.id} ratio="aspect-video" src={clip.poster || clip.url} />;
  }
  if (clip.type === 'video') return <FirstVideoFrameThumb clip={clip} />;
  return <Thumb seed={clip.id} ratio="aspect-video" />;
}

const VIDEO_THUMB_CACHE = new Map<string, string>();

/* 真实素材的缩略图：优先服务端 poster；缺失/失效时在浏览器取约 1 秒处画面并缓存。 */
function RealThumb({ clip, onSourceError }: { clip: Clip; onSourceError?: () => void }) {
  const label = clip.type === 'image' ? 'IMG' : `0:${String(clip.duration).padStart(2, '0')}`;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [posterFailed, setPosterFailed] = useState(false);
  const [capturedPoster, setCapturedPoster] = useState(() => VIDEO_THUMB_CACHE.get(clip.id) || '');
  const [frameReady, setFrameReady] = useState(false);

  useEffect(() => {
    setPosterFailed(false);
    setCapturedPoster(VIDEO_THUMB_CACHE.get(clip.id) || '');
    setFrameReady(false);
  }, [clip.id, clip.poster, clip.url]);

  const seekThumbnailFrame = () => {
    const video = videoRef.current;
    if (!video) return;
    const videoDuration = Number.isFinite(video.duration) ? video.duration : Number(clip.duration || 0);
    const target = Math.max(0.05, Math.min(1, videoDuration > 0 ? videoDuration * 0.2 : 1));
    try { video.currentTime = target; } catch { setFrameReady(true); }
  };
  const captureThumbnailFrame = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    setFrameReady(true);
    try {
      const width = 480;
      const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.76);
      VIDEO_THUMB_CACHE.set(clip.id, dataUrl);
      setCapturedPoster(dataUrl);
    } catch {
      // 即使浏览器禁止 canvas 抽帧，已 seek 的 video 元素仍可直接显示该帧。
    }
  };
  const useServerPoster = Boolean(clip.poster && !posterFailed);
  return (
    <div className="relative w-full aspect-video overflow-hidden rounded-lg bg-surface-2">
      {clip.type === 'image' && (
        <img src={clip.url} alt={clip.name} className="w-full h-full object-cover" loading="lazy" onError={() => { setPosterFailed(true); onSourceError?.(); }} />
      )}
      {clip.type === 'video' && (
        <>
          {useServerPoster && (
            <img
              src={clip.poster}
              alt={clip.name}
              className="absolute inset-0 h-full w-full object-cover"
              loading="eager"
              draggable={false}
              onError={() => { setPosterFailed(true); onSourceError?.(); }}
            />
          )}
          {!useServerPoster && (capturedPoster
            ? <img src={capturedPoster} alt={clip.name} className="h-full w-full object-cover" draggable={false} />
            : <>
                {!frameReady && <div className="absolute inset-0 animate-pulse bg-slate-200" />}
                <video
                  ref={videoRef}
                  src={clip.url}
                  muted
                  playsInline
                  preload="metadata"
                  className={`h-full w-full object-cover transition-opacity ${frameReady ? 'opacity-100' : 'opacity-0'}`}
                  onLoadedMetadata={seekThumbnailFrame}
                  onLoadedData={seekThumbnailFrame}
                  onSeeked={captureThumbnailFrame}
                  onError={() => { setFrameReady(true); onSourceError?.(); }}
                />
              </>)}
        </>
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
function coverArtCss(style: CoverStyle): React.CSSProperties {
  switch (style.artPreset) {
    case 'outline':
      return { WebkitTextStroke: '0.08em #111827', paintOrder: 'stroke fill', textShadow: '0 0.08em 0 rgba(0,0,0,.7)' };
    case 'highlight':
      return { background: '#facc15', color: '#111827', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone', padding: '0.08em 0.18em', borderRadius: '0.12em', lineHeight: 1.18 };
    case 'magazine':
      return { textTransform: 'uppercase', letterSpacing: '-0.045em', fontStyle: 'italic', textShadow: '0.06em 0.06em 0 #ef4444' };
    case 'neon':
      return { color: '#fff', textShadow: `0 0 0.08em #fff, 0 0 0.22em ${style.color}, 0 0 0.45em ${style.color}` };
    case 'sticker':
      return { color: '#111827', WebkitTextStroke: '0.14em #fff', paintOrder: 'stroke fill', textShadow: '0.13em 0.13em 0 #16a34a' };
    default:
      return {};
  }
}

/** 视频元素本身不会保证在静止状态绘出首帧；主动 seek 后转成 JPEG，供封面预览和最终 SVG 共用。 */
function VideoCoverStill({ src, onFrameReady, onSourceError }: { src: string; onFrameReady?: (dataUrl: string) => void; onSourceError?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbackRef = useRef(onFrameReady);
  const [still, setStill] = useState<string>();
  callbackRef.current = onFrameReady;

  useEffect(() => setStill(undefined), [src]);

  const seekToFrame = () => {
    const video = videoRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    video.currentTime = Math.min(duration > 0.3 ? 0.2 : 0, Math.max(0, duration - 0.05));
  };
  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    try {
      const canvas = document.createElement('canvas');
      const maxWidth = 1080;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
      setStill(dataUrl);
      callbackRef.current?.(dataUrl);
    } catch {
      // 跨域或解码异常时保留已 seek 的 video 画面，不让候选卡退回空白。
    }
  };

  return (
    <>
      {still && <img src={still} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      <video ref={videoRef} src={src} muted playsInline preload="auto"
        onLoadedMetadata={seekToFrame} onLoadedData={captureFrame} onSeeked={captureFrame}
        onError={onSourceError}
        className={`absolute inset-0 h-full w-full object-cover ${still ? 'invisible' : ''}`} />
    </>
  );
}

function CoverFrameMedia({ frameUrl, frameType, fallbackVideoUrl, onFrameReady, onSourceError }: { frameUrl?: string; frameType?: Clip['type']; fallbackVideoUrl?: string; onFrameReady?: (dataUrl: string) => void; onSourceError?: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const refreshRequestedRef = useRef('');
  useEffect(() => {
    setImageFailed(false);
    refreshRequestedRef.current = '';
  }, [frameUrl, fallbackVideoUrl]);
  const reportSourceError = (source?: string) => {
    if (!source || refreshRequestedRef.current === source) return;
    refreshRequestedRef.current = source;
    onSourceError?.();
  };
  if (frameUrl && frameType === 'video') return <VideoCoverStill src={frameUrl} onFrameReady={onFrameReady} onSourceError={() => reportSourceError(frameUrl)} />;
  if (frameUrl && !imageFailed) return <img src={frameUrl} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => { setImageFailed(true); reportSourceError(frameUrl); }} />;
  if (fallbackVideoUrl) return <VideoCoverStill src={fallbackVideoUrl} onFrameReady={onFrameReady} onSourceError={() => reportSourceError(fallbackVideoUrl)} />;
  return <div className="absolute inset-0 flex items-center justify-center bg-surface-2 text-xs font-semibold text-text-muted">封面加载失败，请重新选择素材</div>;
}

function CoverFace({ coverUrl, frameUrl, frameType, fallbackVideoUrl, title, style, editable, onTitleChange, onStyleChange, onFrameReady, onSourceError }: { coverUrl?: string | null; frameUrl?: string; frameType?: Clip['type']; fallbackVideoUrl?: string; title: string; style: CoverStyle; editable?: boolean; onTitleChange?: (t: string) => void; onStyleChange?: (style: CoverStyle) => void; onFrameReady?: (dataUrl: string) => void; onSourceError?: () => void }) {
  const dragRef = useRef<{ pointerId: number; startY: number; startPosition: number; height: number } | null>(null);
  if (coverUrl) return <img src={coverUrl} alt="封面" className="absolute inset-0 w-full h-full object-cover" />;
  const verticalPosition = style.verticalPosition ?? (style.position === 'top' ? 14 : style.position === 'center' ? 50 : 86);
  const cqw = style.size === 'S' ? 6.2 : style.size === 'L' ? 9.8 : 7.8;
  const scrimPosition = verticalPosition < 34 ? 'top' : verticalPosition > 66 ? 'bottom' : 'center';
  const scrim = scrimPosition === 'top'
    ? 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent 52%)'
    : scrimPosition === 'center'
      ? 'rgba(0,0,0,0.3)'
      : 'linear-gradient(to top, rgba(0,0,0,0.6), transparent 52%)';
  const titleStyle: React.CSSProperties = {
    width: '100%', color: style.color, fontSize: `${cqw}cqw`,
    fontWeight: WEIGHT_MAP[style.weight ?? 'bold'],
    textAlign: style.align, fontFamily: style.fontFamily ?? fontCss(style.font),
    ...coverArtCss(style),
  };
	  const startTitleDrag = (event: React.PointerEvent<HTMLDivElement>) => {
	    if (!editable || !onStyleChange) return;
	    event.stopPropagation();
	    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
	    if (!bounds?.height) return;
	    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startPosition: verticalPosition, height: bounds.height };
	    event.currentTarget.setPointerCapture(event.pointerId);
	  };
	  const moveTitle = (event: React.PointerEvent<HTMLDivElement>) => {
	    const drag = dragRef.current;
	    if (!drag || drag.pointerId !== event.pointerId || !onStyleChange) return;
	    const next = Math.max(8, Math.min(92, drag.startPosition + ((event.clientY - drag.startY) / drag.height) * 100));
	    onStyleChange({
	      ...style,
	      position: next < 34 ? 'top' : next > 66 ? 'bottom' : 'center',
	      verticalPosition: Math.round(next * 10) / 10,
	    });
	  };
	  const stopTitleDrag = (event: React.PointerEvent<HTMLDivElement>) => {
	    if (dragRef.current?.pointerId !== event.pointerId) return;
	    dragRef.current = null;
	    event.currentTarget.releasePointerCapture(event.pointerId);
	  };
	  return (
	    <div className="absolute inset-0" style={{ containerType: 'inline-size' }}>
	      <CoverFrameMedia frameUrl={frameUrl} frameType={frameType} fallbackVideoUrl={fallbackVideoUrl} onFrameReady={onFrameReady} onSourceError={onSourceError} />
      <div className="pointer-events-none absolute inset-0" style={{ background: scrim }} />
      <div
        className={`absolute inset-x-[5cqw] -translate-y-1/2 ${editable ? 'pointer-events-auto cursor-ns-resize touch-none select-none' : ''}`}
        style={{ top: `${verticalPosition}%` }}
        onPointerDown={startTitleDrag}
        onPointerMove={moveTitle}
        onPointerUp={stopTitleDrag}
        onPointerCancel={stopTitleDrag}
        title={editable ? '上下拖动可批量调整所有封面的标题位置；点击文字可编辑' : undefined}
      >
        {editable ? (
          // 直接在封面上唤起文本框编辑标题（失焦提交）
          <p contentEditable suppressContentEditableWarning spellCheck={false}
            onClick={e => e.stopPropagation()}
            onBlur={e => onTitleChange?.(e.currentTarget.textContent ?? '')}
            className="leading-tight outline-none rounded-[1cqw]"
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

function VariationChipEditor({
  label,
  hint,
  value,
  suggestions,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  suggestions: string[];
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const items = value.split(/[，,\n]/).map(item => item.trim()).filter(Boolean);
  const commit = (candidate = draft) => {
    const additions = candidate.split(/[，,\n]/).map(item => item.trim()).filter(Boolean);
    if (!additions.length) return;
    onChange([...new Set([...items, ...additions])].join('，'));
    setDraft('');
  };
  const remove = (item: string) => onChange(items.filter(current => current !== item).join('，'));

  return (
    <div className="rounded-xl border border-border bg-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-text-primary">{label}</p>
          <p className="mt-0.5 text-[10px] text-text-muted">{hint}</p>
        </div>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-text-secondary">{items.length || 0} 个</span>
      </div>
      <div className="mt-2.5 flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface-2 p-1.5 focus-within:border-accent">
        {items.map(item => (
          <span key={item} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-text-primary shadow-sm">
            {item}
            <button type="button" onClick={() => remove(item)} className="text-text-muted hover:text-red-500" aria-label={`删除${item}`}><X size={11} /></button>
          </span>
        ))}
        <input
          value={draft}
          onChange={event => {
            const next = event.target.value;
            if (/[，,\n]$/.test(next)) commit(next);
            else setDraft(next);
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); commit(); }
            if (event.key === 'Backspace' && !draft && items.length) remove(items[items.length - 1]!);
          }}
          onBlur={() => commit()}
          placeholder={items.length ? '继续添加…' : '输入后按回车添加'}
          className="min-w-28 flex-1 bg-transparent px-1 py-1 text-[11px] text-text-primary outline-none placeholder:text-text-muted"
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-text-muted">快捷添加</span>
        {suggestions.filter(item => !items.includes(item)).slice(0, 4).map(item => (
          <button key={item} type="button" onMouseDown={event => event.preventDefault()} onClick={() => commit(item)}
            className="rounded-md bg-surface-2 px-2 py-1 text-[10px] text-text-secondary transition hover:bg-accent/10 hover:text-accent">
            + {item}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AiCreateStudio({ onNavigate, onGoPublish }: { onNavigate?: (p: Page) => void; onGoPublish?: (payload: StudioPublishPayload) => void } = {}) {
  const [stepIdx, setStepIdx] = useState(0);
  const [activeStoryboardSlotId, setActiveStoryboardSlotId] = useState('');

  // 全局制作状态
  const [mode, setMode] = useState<'material' | 'clone' | 'product'>('material');
  const [migrationMode, setMigrationMode] = useState<MigrationMode>('structure');
  const [contentMode, setContentMode] = useState<'video' | 'poster'>('video');
  const activeSteps = useMemo(() => contentMode === 'poster' ? POSTER_STEPS : STEPS, [contentMode]);
  const step = activeSteps[Math.min(stepIdx, activeSteps.length - 1)].id;
  const [posterStyle, setPosterStyle] = useState<(typeof POSTER_STYLES)[number]['id']>('oem-factory');
  const [platform, setPlatform] = useState('tiktok');
  const [ratio, setRatio] = useState('9:16');
  const [duration, setDuration] = useState(20);
  const [lang, setLang] = useState('zh');
  const [provider, setProvider] = useState<'gemini' | 'qwen'>('gemini');
  const [productInfo, setProductInfo] = useState('');
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [productSelectMode, setProductSelectMode] = useState<'single' | 'multi'>('multi');
  const [productSearch, setProductSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('');
  const [showSelectedProductsOnly, setShowSelectedProductsOnly] = useState(false);
  const [productSelectorOpen, setProductSelectorOpen] = useState(false);
  const productSelectorRef = useRef<HTMLDivElement>(null);
  const [cloneCount] = useState(1);
  const [cloneOutputMode, setCloneOutputMode] = useState<'ideas' | 'languages'>('ideas');
  const [audience, setAudience] = useState('');
  const [primaryCta, setPrimaryCta] = useState(DEFAULT_VIDEO_CONVERSION_GOAL);
  const [cooperationRoute, setCooperationRoute] = useState('');
  const [availableCooperationRoutes, setAvailableCooperationRoutes] = useState<string[]>([]);
  const [enterpriseRouteStrategies, setEnterpriseRouteStrategies] = useState<Record<string, { targetBuyerRoles?: string[]; primaryCta?: string }>>({});
  const [sellingPoints, setSellingPoints] = useState('');
  const [tone, setTone] = useState('高转化 · 口语化');
  const [videoThemeId, setVideoThemeId] = useState<VideoThemeId>('buyer_pain');
  const [themePainPoint, setThemePainPoint] = useState(VIDEO_THEMES[0]!.painPoint);
  const [themeConversionGoal, setThemeConversionGoal] = useState(DEFAULT_VIDEO_CONVERSION_GOAL);
  const [variationPeople, setVariationPeople] = useState('原人物');
  const [variationScenes, setVariationScenes] = useState('原场景');
  const [variationLanguages, setVariationLanguages] = useState('中文');
  const [variationHooks, setVariationHooks] = useState('原钩子');
  const [variationMax, setVariationMax] = useState(6);
  const [variationStrategy, setVariationStrategy] = useState<VariationStrategy>('hybrid');
  const [variationBatchCreating, setVariationBatchCreating] = useState(false);
  const [variationBatchState, setVariationBatchState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [variationBatches, setVariationBatches] = useState<VariationBatch[]>([]);

  useDismissibleLayer(productSelectorOpen, productSelectorRef, () => setProductSelectorOpen(false));
  const splitVariations = (value: string) => value.split(/[，,\n]/).map(item => item.trim()).filter(Boolean);
  const activeVideoTheme = VIDEO_THEMES.find(item => item.id === videoThemeId) || VIDEO_THEMES[0]!;
  const applyInferredMaterialTheme = (material: Pick<Material, 'name' | 'folder' | 'shotFunction' | 'tags' | 'segments'>) => {
    const inferredId = inferVideoThemeFromMaterial(material);
    const inferred = VIDEO_THEMES.find(item => item.id === inferredId) || VIDEO_THEMES[0]!;
    setVideoThemeId(inferred.id);
    setThemePainPoint(inferred.painPoint);
    setThemeConversionGoal(DEFAULT_VIDEO_CONVERSION_GOAL);
  };
  const videoThemePayload = {
    id: activeVideoTheme.id,
    title: activeVideoTheme.title,
    painPoint: audience.trim() || activeVideoTheme.painPoint,
    conversionGoal: primaryCta.trim() || DEFAULT_VIDEO_CONVERSION_GOAL,
    primaryCta: primaryCta.trim() || DEFAULT_VIDEO_CONVERSION_GOAL,
    cooperationRoute,
  };
  const variationDimensionConfig = variationStrategy === 'remix' ? [
    { label: '素材组合规则', hint: '从真实素材库选择不同组合', value: variationPeople, setter: setVariationPeople, suggestions: ['自动优选素材组', '产品实拍优先', '工厂素材优先', '人物口播优先'] },
    { label: '剪辑节奏', hint: '只改变剪辑结构和镜头密度', value: variationScenes, setter: setVariationScenes, suggestions: ['沿用原节奏', '快切版', '证据链版', '产品特写版'] },
    { label: '语言版本', hint: '基于已确认脚本生成多语版本', value: variationLanguages, setter: setVariationLanguages, suggestions: ['中文', 'English', 'Español', 'العربية'] },
    { label: '开场变体', hint: '替换前三秒，后续沿用真实素材', value: variationHooks, setter: setVariationHooks, suggestions: ['沿用原钩子', '痛点提问', '结果先行', '买家质疑'] },
  ] : variationStrategy === 'recreate' ? [
    { label: '人物生成约束', hint: '从对标分镜提取，后续上传人物参考', value: variationPeople, setter: setVariationPeople, suggestions: ['沿用对标人物设定', '产品经理口播', '采购经理视角', '工程师演示'] },
    { label: '场景生成约束', hint: '按对标构图生成新的场景素材', value: variationScenes, setter: setVariationScenes, suggestions: ['沿用对标场景结构', '工厂实景风', '展会演示风', '客户应用场景'] },
    { label: '语言版本', hint: '为每条新素材生成对应口播', value: variationLanguages, setter: setVariationLanguages, suggestions: ['中文', 'English', 'Español', 'العربية'] },
    { label: '钩子重制规则', hint: '保持镜头功能，替换表达内容', value: variationHooks, setter: setVariationHooks, suggestions: ['沿用原钩子', '痛点提问', '结果先行', '事实反差'] },
  ] : [
    { label: '主体保真规则', hint: '决定哪些人物与产品必须真实', value: variationPeople, setter: setVariationPeople, suggestions: ['关键镜头保真', '产品必须真实', '人物可AI替换', '口播人物固定'] },
    { label: '逐镜来源规则', hint: '系统推荐本地、AI或融合素材', value: variationScenes, setter: setVariationScenes, suggestions: ['逐镜自动决策', '真实素材优先', 'AI场景优先', '关键镜头融合'] },
    { label: '语言版本', hint: '生成独立口播与字幕版本', value: variationLanguages, setter: setVariationLanguages, suggestions: ['中文', 'English', 'Español', 'العربية'] },
    { label: '开场变体', hint: '钩子可AI重制，正文按镜头决策', value: variationHooks, setter: setVariationHooks, suggestions: ['沿用原钩子', '痛点提问', '结果先行', '买家质疑'] },
  ];
  const createVariationBatch = async () => {
    setVariationBatchCreating(true);
    setVariationBatchState('idle');
    try {
      const result = await studioApi.createVariationBatch({
        title: projectTitle.trim() || '爆款裂变批次', templateProjectId: projectId || undefined, duration, maxItems: variationMax,
        dimensions: {
          strategy: [variationStrategy],
          product: selectedProductIds.length ? selectedProductIds : ['当前产品'],
          person: splitVariations(variationPeople).length ? splitVariations(variationPeople) : ['原人物'],
          scene: splitVariations(variationScenes).length ? splitVariations(variationScenes) : ['原场景'],
          language: splitVariations(variationLanguages).length ? splitVariations(variationLanguages) : ['中文'],
          hook: splitVariations(variationHooks).length ? splitVariations(variationHooks) : ['原钩子'],
        },
        plan: {
          platform, ratio, contentMode, mode, strategy: variationStrategy, duration, maxItems: variationMax,
          productInfo, productSelectMode, selectedProductIds, audience, sellingPoints, tone, language: lang, provider,
          dimensions: {
            product: selectedProductIds.length ? selectedProductIds : ['当前产品'],
            person: splitVariations(variationPeople).length ? splitVariations(variationPeople) : ['原人物'],
            scene: splitVariations(variationScenes).length ? splitVariations(variationScenes) : ['原场景'],
            language: splitVariations(variationLanguages).length ? splitVariations(variationLanguages) : ['中文'],
            hook: splitVariations(variationHooks).length ? splitVariations(variationHooks) : ['原钩子'],
          },
        },
      });
      if (!result.ok || !result.batch) throw new Error('save_failed');
      setVariationBatches(current => [result.batch, ...current.filter(item => item.id !== result.batch.id)]);
      setVariationBatchState('saved');
      setShowProjects(true);
    } catch {
      setVariationBatchState('error');
    } finally {
      setVariationBatchCreating(false);
    }
  };

  const [activeFolder, setActiveFolder] = useState('recommend');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [hookMaterialId, setHookMaterialId] = useState('');
  const [scriptRecommendedMaterialIds, setScriptRecommendedMaterialIds] = useState<string[]>([]);
  const [storyboardAssignments, setStoryboardAssignments] = useState<Record<string, string>>({});
  const [storyboardSourcePlans, setStoryboardSourcePlans] = useState<Record<string, StoryboardSourcePlan>>({});
  const [storyboardGenerating, setStoryboardGenerating] = useState<Record<string, boolean>>({});
  const [storyboardQualityChecking, setStoryboardQualityChecking] = useState<Record<string, boolean>>({});
  const [assemblyName, setAssemblyName] = useState('视频1');
  const [activeAssemblyId, setActiveAssemblyId] = useState('video-1');
  const [storyboardAssemblies, setStoryboardAssemblies] = useState<StoryboardAssembly[]>([
    { id: 'video-1', name: '视频1', assignments: {}, sourcePlans: {}, selected: [] },
  ]);
  const activateContentPlan = (targetId: string) => {
    if (targetId === activeAssemblyId) return;
    const target = storyboardAssemblies.find(item => item.id === targetId);
    if (!target) return;
    const current: StoryboardAssembly = { id: activeAssemblyId, name: assemblyName, assignments: storyboardAssignments, sourcePlans: storyboardSourcePlans, selected };
    setStoryboardAssemblies(items => items.map(item => item.id === activeAssemblyId ? current : item));
    setActiveAssemblyId(target.id); setAssemblyName(target.name); setStoryboardAssignments(target.assignments); setStoryboardSourcePlans(target.sourcePlans); setSelected(target.selected);
  };
  const configureVariationStrategy = (strategy: VariationStrategy) => {
    setVariationStrategy(strategy);
    setStoryboardSourcePlans({});
    if (strategy === 'remix') {
      setVariationPeople('自动优选素材组'); setVariationScenes('沿用原节奏'); setVariationLanguages('中文'); setVariationHooks('沿用原钩子');
    } else if (strategy === 'recreate') {
      setVariationPeople('沿用对标人物设定'); setVariationScenes('沿用对标场景结构'); setVariationLanguages('中文'); setVariationHooks('沿用原钩子');
    } else {
      setVariationPeople('关键镜头保真'); setVariationScenes('逐镜自动决策'); setVariationLanguages('中文'); setVariationHooks('沿用原钩子');
    }
  };

  const [materials, setMaterials] = useState<Clip[]>([]);
  const [previewClip, setPreviewClip] = useState<Clip | null>(null);
  const [uploading, setUploading] = useState(false);
  const [digitalHumanLoading, setDigitalHumanLoading] = useState(false);
  const [digitalHumanNotice, setDigitalHumanNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [script, setScript] = useState('');
  const [scriptType, setScriptType] = useState<'voiceover' | 'storyboard'>('voiceover');
  const [voice, setVoice] = useState('v1');
  const [voiceCandidates, setVoiceCandidates] = useState<string[]>(['v1']);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [voiceoverLines, setVoiceoverLines] = useState('');
  const [voiceLangs, setVoiceLangs] = useState<string[]>([]);
  const [enterpriseVoiceLangs, setEnterpriseVoiceLangs] = useState<string[]>([]);
  const [activeVoiceLang, setActiveVoiceLang] = useState('zh');
  const enterpriseScriptLanguage = voiceLangs[0] || enterpriseVoiceLangs[0] || '';
  const [voiceDrafts, setVoiceDrafts] = useState<Record<string, string>>({});
  const [voiceDraftStaleLangs, setVoiceDraftStaleLangs] = useState<string[]>([]);
  const [voiceDraftLoading, setVoiceDraftLoading] = useState(false);
  const [voiceDraftNotice, setVoiceDraftNotice] = useState('');
  const [voicePreviewIdx, setVoicePreviewIdx] = useState<number | null>(null);
  const [scriptView, setScriptView] = useState<'timestamp' | 'voiceover'>('timestamp');
  const [scriptPreviewTab, setScriptPreviewTab] = useState('script');
  const [scriptStageTab, setScriptStageTab] = useState<'theme' | 'script' | 'voiceover' | 'audio'>('theme');
  const autoGen = useRef(false); // 标记是否已由入口生成脚本，避免覆盖用户编辑

  // 配音 TTS
  const [voiceoverUrl, setVoiceoverUrl] = useState<string | null>(null);
  const [voiceoverDur, setVoiceoverDur] = useState(0);
  const [voiceoverAudios, setVoiceoverAudios] = useState<Record<string, { url: string; duration: number; cues?: SubCue[]; text?: string; alignmentSource?: string; customVoiceStatus?: 'activated' }>>({});
  const [alignedCuesByLang, setAlignedCuesByLang] = useState<Record<string, SubCue[]>>({});
  const [ttsLanguageSettings, setTtsLanguageSettings] = useState<Record<string, LanguageTtsSettings>>({});
  const activeTtsSettings = ttsLanguageSettings[activeVoiceLang] || DEFAULT_TTS_SETTINGS;
  const patchActiveTtsSettings = (patch: Partial<LanguageTtsSettings>) => {
    setTtsLanguageSettings(current => ({
      ...current,
      [activeVoiceLang]: { ...(current[activeVoiceLang] || DEFAULT_TTS_SETTINGS), ...patch },
    }));
  };
  const ttsPreset = activeTtsSettings.preset;
  const ttsEmotion = activeTtsSettings.emotion;
  const ttsEmotionIntensity = activeTtsSettings.emotionIntensity;
  const ttsSpeed = activeTtsSettings.speed;
  const ttsPauseStyle = activeTtsSettings.pauseStyle;
  const ttsPronunciationText = activeTtsSettings.pronunciationText;
  const setTtsPreset = (value: TtsStyleOptions['preset']) => patchActiveTtsSettings({ preset: value });
  const setTtsEmotion = (value: string) => patchActiveTtsSettings({ emotion: value });
  const setTtsEmotionIntensity = (value: number) => patchActiveTtsSettings({ emotionIntensity: value });
  const setTtsSpeed = (value: number) => patchActiveTtsSettings({ speed: value });
  const setTtsPauseStyle = (value: LanguageTtsSettings['pauseStyle']) => patchActiveTtsSettings({ pauseStyle: value });
  const setTtsPronunciationText = (value: string) => patchActiveTtsSettings({ pronunciationText: value });
  const [referenceVoiceStrength, setReferenceVoiceStrength] = useState<ReferenceVoiceStrength>('balanced');
  const [useReferenceVoiceStyle, setUseReferenceVoiceStyle] = useState(true);
  const [audioCapabilities, setAudioCapabilities] = useState<StudioAudioCapabilities | null>(null);
  const [minimaxDiagnostic, setMinimaxDiagnostic] = useState('');
  const [minimaxDiagnosing, setMinimaxDiagnosing] = useState(false);
  const [voiceoverMode, setVoiceoverMode] = useState<'none' | 'ai' | 'upload'>('ai');
  const [uploadedVoiceName, setUploadedVoiceName] = useState('');
  const [customVoiceId, setCustomVoiceId] = useState('');
  const [customVoiceName, setCustomVoiceName] = useState('');
  const [customVoiceUrl, setCustomVoiceUrl] = useState('');
  const [customVoices, setCustomVoices] = useState<Array<{ voiceId: string; name: string; url: string; duration: number; createdAt: string }>>([]);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsLoadingScope, setTtsLoadingScope] = useState<'all' | 'single' | 'upload' | null>(null);
  const batchTtsLoading = ttsLoading && ttsLoadingScope === 'all';
  const singleTtsLoading = ttsLoading && ttsLoadingScope === 'single';
  const [ttsNotice, setTtsNotice] = useState('');
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsCurrentTime, setTtsCurrentTime] = useState(0);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceoverInputRef = useRef<HTMLInputElement>(null);
  const voiceSampleInputRef = useRef<HTMLInputElement>(null);

  const [bgm, setBgm] = useState('');   // 无内置曲库，默认不选
  const [bgmCandidates, setBgmCandidates] = useState<string[]>([]);
  const [platformBgms, setPlatformBgms] = useState<Record<string, string>>({});
  const [assemblyBgms, setAssemblyBgms] = useState<Record<string, string>>({});
  const [materialVersionBgms, setMaterialVersionBgms] = useState<Record<string, string>>({});
  const [bgmMatchMode, setBgmMatchMode] = useState<'smart' | 'unified'>('smart');
  const [bgmLibraryOpen, setBgmLibraryOpen] = useState(false);
  const bgmLibraryRef = useRef<HTMLDivElement>(null);
  useDismissibleLayer(bgmLibraryOpen, bgmLibraryRef, () => setBgmLibraryOpen(false));
  const [soundCandidatesPerContent, setSoundCandidatesPerContent] = useState<1 | 2>(1);
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
  const [coverStyle, setCoverStyle] = useState<CoverStyle>({ color: '#ffffff', size: 'M', position: 'bottom', align: 'left', font: 'sans', weight: 'bold', artPreset: 'clean' });
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverCanvaOpening, setCoverCanvaOpening] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null); // 生成的封面 SVG 文件地址（发布缩略图）
  const [materialVersionCovers, setMaterialVersionCovers] = useState<Record<string, CoverVersionConfig>>({});
  const canvaReturnInputRef = useRef<HTMLInputElement>(null);
  const [customFonts, setCustomFonts] = useState<{ family: string; label: string }[]>([]); // 官方导入的字体模版
  const fontInputRef = useRef<HTMLInputElement>(null);


  const [rendering, setRendering] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [renderPct, setRenderPct] = useState(0);
  const [renderOutputPath, setRenderOutputPath] = useState<string | null>(null); // 桌面端合成产物路径
  const [renderOutputPreviewUrl, setRenderOutputPreviewUrl] = useState<string | null>(null);
  const [renderDownloadMessage, setRenderDownloadMessage] = useState('');
  const [languageRenderOutputs, setLanguageRenderOutputs] = useState<Record<string, LanguageRenderOutput>>({});
  const [languageRenderVersions, setLanguageRenderVersions] = useState<Record<string, LanguageRenderGeneration[]>>({});
  const [activeRenderCombinationKey, setActiveRenderCombinationKey] = useState('');
  const [batchRenderingLangs, setBatchRenderingLangs] = useState(false);
  const renderToken = useRef(0); // 取消过期的渲染循环（重复点「重新合成」时）
  const renderPreviewUrlsRef = useRef<Record<string, string>>({});

  const [account, setAccount] = useState<string | null>('a1');
  const [caption, setCaption] = useState('Factory-direct home essentials 🏠✨ #tiktokmademebuyit #homefinds');
  const [captionLoading, setCaptionLoading] = useState(false);
  const [published, setPublished] = useState(false);
  const [demoAutoLoading, setDemoAutoLoading] = useState(false);
  const [savedToWorks, setSavedToWorks] = useState(false); // 「存入我的作品」反馈
  const [modeActionLoading, setModeActionLoading] = useState(false);
  const productScriptAbortRef = useRef<AbortController | null>(null);
  const [modeActionStatus, setModeActionStatus] = useState('');
  const [materialSelectLoading, setMaterialSelectLoading] = useState(false);
  const [modeNotice, setModeNotice] = useState('');
  const [modeScripts, setModeScripts] = useState<ModeScriptOutput[]>([]);
  const [activeModeScriptId, setActiveModeScriptId] = useState('');
  const [pendingRealCloneGeneration, setPendingRealCloneGeneration] = useState(false);
  const [posterLoading, setPosterLoading] = useState(false);
  const [posterDraft, setPosterDraft] = useState<FbPosterResult | null>(null);
  const [leadContentPackage, setLeadContentPackage] = useState<LeadContentPackageResult | null>(null);
  const [posterJsonText, setPosterJsonText] = useState('');
  const [posterImageUrl, setPosterImageUrl] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/overseas/enterprise/profile', { headers: authHeader(), credentials: 'same-origin' })
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
        const configuredVoiceLanguages = enterpriseLanguageCodes(
          profile.brand?.preferredLanguages || profile.company?.primaryLanguages || '',
        );
        const defaultVoiceLanguage = configuredVoiceLanguages.includes('en')
          ? 'en'
          : configuredVoiceLanguages[0];
        setEnterpriseVoiceLangs(configuredVoiceLanguages);
        setVoiceLangs(configuredVoiceLanguages);
        setVoiceDrafts(current => filterRecordByLanguage(current, configuredVoiceLanguages));
        setVoiceoverAudios(current => filterRecordByLanguage(current, configuredVoiceLanguages));
        setAlignedCuesByLang(current => filterRecordByLanguage(current, configuredVoiceLanguages));
        setVoiceDraftStaleLangs(current => current.filter(code => configuredVoiceLanguages.includes(code)));
        if (defaultVoiceLanguage) {
          setLang(current => configuredVoiceLanguages.includes(current) ? current : defaultVoiceLanguage);
          setActiveVoiceLang(current => configuredVoiceLanguages.includes(current) ? current : defaultVoiceLanguage);
        }
        setProductInfo(prev => prev || options[0]?.info || [
          profile.strategy?.focusProducts || profile.products?.categories,
          profile.products?.priceRange,
          profile.products?.moq,
        ].filter(Boolean).join('；'));
        setAudience(prev => prev || [
          profile.socialStrategy?.routeStrategies?.[profile.socialStrategy.enabledRoutes?.[0] || '']?.targetBuyerRoles?.[0],
          profile.customers?.targetProfiles,
          profile.strategy?.focusMarkets || profile.company?.mainMarkets,
        ].filter(Boolean).join('；'));
        const inheritedRoute = profile.socialStrategy?.enabledRoutes?.[0] || '';
        const inheritedCta = profile.socialStrategy?.routeStrategies?.[inheritedRoute]?.primaryCta;
        setCooperationRoute(current => current || inheritedRoute);
        setAvailableCooperationRoutes(profile.socialStrategy?.enabledRoutes || []);
        setEnterpriseRouteStrategies(profile.socialStrategy?.routeStrategies || {});
        setPrimaryCta(current => current === DEFAULT_VIDEO_CONVERSION_GOAL ? inheritedCta || current : current);
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
  const [previewVideoReady, setPreviewVideoReady] = useState(false);
  const [previewOriginalOn, setPreviewOriginalOn] = useState(false);
  const [previewVoiceOn, setPreviewVoiceOn] = useState(true);
  const [previewBgmOn, setPreviewBgmOn] = useState(true);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoCacheRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const previewAdvanceTimerRef = useRef<number | null>(null);
  const previewAdvanceLockRef = useRef(false);

  // 字幕（A 层：脚本兜底对齐 + 沿用封面样式；桌面端 ffmpeg 烧录）
  const [subtitlesOn, setSubtitlesOn] = useState(true);
  const [subMode, setSubMode] = useState<'target' | 'bilingual'>('target');
  const [subPreviewIdx, setSubPreviewIdx] = useState(0); // 预览叠层当前展示的 cue
  const [cueZh, setCueZh] = useState<string[]>([]);       // 双语字幕的中文译文（与 cues 对齐）
  const [previewTime, setPreviewTime] = useState(0);
  const [clipEdits, setClipEdits] = useState<Record<string, ClipEdit>>({});

  // 草稿 / 作品
  const [projectId, setProjectId] = useState<string | null>(null);
  const generationSessionId = useRef(`session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [storyboardVideoVersions, setStoryboardVideoVersions] = useState<Record<string, VideoGenerationVersion[]>>({});
  const [productVideoVersions, setProductVideoVersions] = useState<VideoGenerationVersion[]>([]);
  const [projectTitle, setProjectTitle] = useState('未命名草稿');
  const [showProjects, setShowProjects] = useState(false);
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [savingProj, setSavingProj] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const autosaveInFlightRef = useRef(false);
  const autosaveSnapshotRef = useRef<() => Promise<void>>(async () => undefined);
  const [videoKickoff, setVideoKickoff] = useState<VideoKickoff | null>(null);
  const [sourceDraftCheckPending, setSourceDraftCheckPending] = useState(true);
  const [existingSourceDraftPrompt, setExistingSourceDraftPrompt] = useState<ExistingSourceDraftPrompt | null>(null);
  const referenceVoice = useMemo(() => referenceVoiceProfile(videoKickoff), [videoKickoff]);

  useEffect(() => {
    void studioApi.audioCapabilities().then(setAudioCapabilities);
    void studioApi.listVoiceSamples().then(items => {
      setCustomVoices(items);
      if (items.length) setVoiceCandidates(current => [...new Set([...current, ...items.map(item => item.voiceId)])]);
    });
  }, []);
  useEffect(() => {
    if (mode === 'clone' || !useReferenceVoiceStyle) return;
    const fallback = TTS_PRESETS.find(item => item.id === 'authentic_review')!;
    setUseReferenceVoiceStyle(false);
    setTtsPreset(fallback.id);
    setTtsEmotion(fallback.emotion);
    setTtsEmotionIntensity(fallback.intensity);
    setTtsSpeed(fallback.speed);
    setVoiceoverUrl(null);
    setVoiceoverAudios({});
    setAlignedCuesByLang({});
  }, [mode, useReferenceVoiceStyle]);

  const materialById = useMemo(() => new Map(materials.map(item => [item.id, item])), [materials]);
  const selectedClips = useMemo(() => selected.map(id => materialById.get(id)).filter(Boolean) as Clip[], [selected, materialById]);
  const totalDur = selectedClips.reduce((s, c) => s + (c.type === 'image' ? 3 : c.duration), 0);
  const matNames = selectedClips.map(c => c.name);
  const storyboardSlots = useMemo(() => parseStoryboardSlots(script, duration), [script, duration]);
  const storyboardTimelineEnd = useMemo(() => storyboardSlots.reduce((max, slot) => Math.max(max, slot.end), 0), [storyboardSlots]);
  const recommendedSourceMode = (slot: StoryboardSlot): StoryboardSourceMode => {
    const text = `${slot.title} ${slot.detail}`.toLowerCase();
    if (/证书|认证|检测|参数|包装文字|logo|工厂|生产线|质检|certificate|factory|inspection/.test(text)) return 'local';
    if (/人物|模特|口播|场景|情绪|动作|presenter|model|lifestyle/.test(text)) return 'ai';
    return 'local';
  };
  const isCriticalStoryboardSlot = (slot: StoryboardSlot) =>
    /证书|认证|检测|参数|包装文字|logo|工厂|生产线|质检|产品特写|材质|certificate|factory|inspection|product close/.test(`${slot.title} ${slot.detail}`.toLowerCase());
  const sourcePlanFor = (slot: StoryboardSlot): StoryboardSourcePlan => storyboardSourcePlans[slot.id] ?? {
    mode: recommendedSourceMode(slot),
    decided: false,
    confirmed: false,
    critical: isCriticalStoryboardSlot(slot),
  };
  const runStoryboardQualityCheck = async (slot: StoryboardSlot, materialId: string, planOverride?: StoryboardSourcePlan) => {
    const plan = planOverride ?? sourcePlanFor(slot);
    setStoryboardQualityChecking(prev => ({ ...prev, [slot.id]: true }));
    try {
      const result = await studioApi.storyboardQualityCheck({
        materialId,
        storyboard: `${slot.time} ${slot.title}\n${slot.detail}`,
        productInfo: activeProductInfo,
        critical: plan.critical,
      });
      if (!result.ok || !result.quality) throw new Error(result.error || '质检未返回结果');
      setStoryboardSourcePlans(prev => ({
        ...prev,
        [slot.id]: { ...plan, generatedClipId: materialId, confirmed: false, quality: result.quality, qualityError: '' },
      }));
    } catch (error) {
      setStoryboardSourcePlans(prev => ({
        ...prev,
        [slot.id]: { ...plan, generatedClipId: materialId, confirmed: false, qualityError: error instanceof Error ? error.message : '自动质检失败' },
      }));
    } finally {
      setStoryboardQualityChecking(prev => ({ ...prev, [slot.id]: false }));
    }
  };
  const generateStoryboardShot = async (slot: StoryboardSlot, planOverride?: StoryboardSourcePlan) => {
    const plan = planOverride ?? sourcePlanFor(slot);
    const versionGroupKey = `studio:${projectId || generationSessionId.current}:assembly:${activeAssemblyId}:frame:${slot.id}`;
    const selectedVersion = storyboardVideoVersions[slot.id]?.find(item => item.isSelected);
    if (plan.mode !== 'ai' && plan.mode !== 'hybrid') return;
    const currentClipId = plan.mode === 'hybrid'
      ? (plan.referenceClipId || storyboardAssignments[slot.id])
      : storyboardAssignments[slot.id];
    const referenceClip = currentClipId ? materialById.get(currentClipId) : undefined;
    if (plan.mode === 'hybrid' && !referenceClip) {
      setStoryboardSourcePlans(prev => ({
        ...prev,
        [slot.id]: { ...plan, confirmed: false, error: '融合生成需要先为该分镜匹配一条本地参考素材。' },
      }));
      return;
    }
    setStoryboardGenerating(prev => ({ ...prev, [slot.id]: true }));
    setStoryboardSourcePlans(prev => ({
      ...prev,
      [slot.id]: {
        ...plan,
        confirmed: false,
        referenceClipId: plan.mode === 'hybrid' ? (plan.referenceClipId || referenceClip?.id) : undefined,
        error: '',
      },
    }));
    try {
      const shotDuration = Math.max(4, Math.min(15, Math.round(slot.end - slot.start)));
      const fusionInstruction = plan.mode === 'hybrid' && referenceClip
        ? `Use the supplied real local reference image from "${referenceClip.name}" as the product/visual truth. Preserve its product appearance, color, material and packaging while integrating it into the generated scene.`
        : 'Generate the full shot with AI while keeping the product context accurate.';
      const referenceImageUrl = plan.mode === 'hybrid' && referenceClip
        ? (referenceClip.type === 'image' ? referenceClip.url : referenceClip.poster)
        : undefined;
      if (plan.mode === 'hybrid' && !referenceImageUrl) {
        throw new Error('该本地素材没有可用参考图。请改用图片素材，或为视频生成封面帧后重试。');
      }
      const generated = await studioApi.seedanceVideo({
        script: `Single storyboard shot ${slot.time}. ${slot.detail}\n${fusionInstruction}\nDo not add captions, logos, labels, UI or watermarks.`,
        productInfo: activeProductInfo,
        language: lang,
        ratio,
        duration: shotDuration,
        resolution: '720p',
        title: `${assemblyName} · 分镜${storyboardSlots.findIndex(item => item.id === slot.id) + 1} · ${plan.mode === 'hybrid' ? '融合生成' : 'AI生成'}`,
        referenceImageUrl,
        generationGroupKey: versionGroupKey,
        generationContext: { entry: 'studio-storyboard', projectId, assemblyId: activeAssemblyId, slotId: slot.id, mode: plan.mode },
        parentVersionId: selectedVersion?.id,
      });
      if (!generated.ok || !generated.url) throw new Error(generated.error || '视频生成未返回可用素材');
      const clip = generated.material
        ? { ...materialToClip(generated.material), aspectRatio: generated.material.aspectRatio || ratioNumber(ratio) }
        : {
            id: generated.id || `storyboard-ai-${slot.id}-${Date.now()}`,
            name: generated.title || `${slot.title} · AI生成`,
            folder: 'upload',
            type: 'video' as const,
            duration: generated.duration || shotDuration,
            aspectRatio: ratioNumber(ratio),
            size: 'Seedance',
            url: generated.url,
            poster: generated.poster,
            scope: 'own' as const,
            sourceType: 'ai-seedance',
          };
      setMaterials(prev => prev.some(item => item.id === clip.id) ? prev : [clip, ...prev]);
      setStoryboardAssignments(prev => ({ ...prev, [slot.id]: clip.id }));
      setSelected(prev => [...new Set([...prev, clip.id])]);
      setClipEdits(prev => ({ ...prev, [slotClipEditKey(slot.id, clip.id)]: defaultEditForSlot(clip, slot) }));
      setStoryboardSourcePlans(prev => ({
        ...prev,
        [slot.id]: {
          ...sourcePlanFor(slot),
          mode: plan.mode,
          confirmed: false,
          critical: plan.critical,
          referenceClipId: plan.mode === 'hybrid' ? (plan.referenceClipId || referenceClip?.id) : undefined,
          generatedClipId: clip.id,
          error: '',
        },
      }));
      if (generated.version) setStoryboardVideoVersions(prev => ({
        ...prev,
        [slot.id]: [generated.version!, ...(prev[slot.id] || []).map(item => ({ ...item, isSelected: false }))],
      }));
      await runStoryboardQualityCheck(slot, clip.id, {
        ...plan,
        referenceClipId: plan.mode === 'hybrid' ? (plan.referenceClipId || referenceClip?.id) : undefined,
        generatedClipId: clip.id,
      });
    } catch (error) {
      setStoryboardSourcePlans(prev => ({
        ...prev,
        [slot.id]: { ...plan, confirmed: false, error: error instanceof Error ? error.message : '分镜生成失败' },
      }));
    } finally {
      setStoryboardGenerating(prev => ({ ...prev, [slot.id]: false }));
    }
  };
  const assignedOrderedIds = useMemo(
    () => storyboardSlots.map(slot => storyboardAssignments[slot.id]).filter((id): id is string => Boolean(id && materialById.has(id))),
    [storyboardAssignments, storyboardSlots, materialById],
  );
  const assignedCount = assignedOrderedIds.length;
  const selectedProductOptions = useMemo(
    () => productOptions.filter(option => selectedProductIds.includes(option.id)),
    [productOptions, selectedProductIds],
  );
  const productCategories = useMemo(
    () => Array.from(new Set(productOptions.map(productOptionCategory))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [productOptions],
  );
  const visibleProductOptions = useMemo(() => {
    const query = productSearch.trim().toLocaleLowerCase();
    return productOptions.filter(option => {
      if (showSelectedProductsOnly && !selectedProductIds.includes(option.id)) return false;
      if (productCategoryFilter && productOptionCategory(option) !== productCategoryFilter) return false;
      return !query || `${option.label}\n${option.info}`.toLocaleLowerCase().includes(query);
    });
  }, [productCategoryFilter, productOptions, productSearch, selectedProductIds, showSelectedProductsOnly]);
  const activeProductInfo = useMemo(() => {
    const selectedInfo = formatSelectedProductInfo(selectedProductOptions);
    return selectedInfo || productInfo;
  }, [productInfo, selectedProductOptions]);
  const activeProductLabel = useMemo(() => selectedProductLabel(activeProductInfo), [activeProductInfo]);
  const migrationRecommendation = useMemo(
    () => recommendMigration(videoKickoff, activeProductInfo),
    [activeProductInfo, videoKickoff],
  );
  const cloneProductFingerprintRef = useRef('');
  const selectedBgmTrack = useMemo(() => bgms.find(track => track.id === bgm) || null, [bgm, bgms]);
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
    if (mode === 'clone') setMigrationMode(migrationRecommendation.mode);
  }, [migrationRecommendation, mode]);
  useEffect(() => {
    if (mode !== 'clone' || !videoKickoff?.referenceAnalysis?.details?.length) return;
    const referenceHasVoice = videoKickoff.referenceAnalysis.details.some(item => !isNonSpeechSfx(item.dialogue || ''));
    setVoiceoverMode(referenceHasVoice ? 'ai' : 'none');
  }, [mode, videoKickoff]);
  useEffect(() => {
    if (mode !== 'clone' || !videoKickoff?.referenceAnalysis?.details?.length || !activeProductInfo.trim() || !activeProductLabel) return;
    const fingerprint = `${selectedProductIds.join('|')}::${migrationMode}::${activeProductInfo}`;
    if (!cloneProductFingerprintRef.current) {
      cloneProductFingerprintRef.current = fingerprint;
      return;
    }
    if (cloneProductFingerprintRef.current === fingerprint) return;
    cloneProductFingerprintRef.current = fingerprint;
    // Product identity is part of the generation version. Audio, material
    // matches and renders derived from the previous product must not survive.
    setVoiceDrafts({});
    setVoiceoverAudios({});
    setVoiceoverUrl(null);
    setAlignedCuesByLang({});
    setSelected([]);
    setScriptRecommendedMaterialIds([]);
    setStoryboardAssignments({});
    setStoryboardSourcePlans({});
    setClipEdits({});
    setCover('');
    setRendered(false);
    setLanguageRenderOutputs({});
    setRenderOutputPath(null);
    setSavedToWorks(false);
    setModeScripts(current => current.filter(item => item.mode !== 'clone'));
    setActiveModeScriptId('');
    setScript('');
    setVoiceoverLines('');
    setScriptView('timestamp');
    setModeNotice(`产品已更换为「${activeProductLabel}」：旧脚本、配音、素材匹配和成片结果已失效，请重新调用 AI 生成真实分镜。`);
  }, [activeProductInfo, activeProductLabel, lang, migrationMode, migrationRecommendation.label, mode, selectedProductIds, videoKickoff]);
  useEffect(() => {
    if (contentMode !== 'poster') return;
    if (platform !== 'facebook' && platform !== 'instagram') {
      setPlatform('facebook');
      setRatio('1:1');
    }
    if (!POSTER_RATIOS.includes(ratio)) setRatio('1:1');
  }, [contentMode, platform, ratio]);
  useEffect(() => {
    setStepIdx(0);
  }, [contentMode]);
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
  useEffect(() => {
    setCoverUrl(null);
  }, [coverStyle]);
  const activeMaterialVersionKey = useMemo(() => materialVersionKey(activeAssemblyId, activeVoiceLang), [activeAssemblyId, activeVoiceLang]);
  useEffect(() => {
    if (!activeMaterialVersionKey) return;
    setMaterialVersionCovers(current => {
      const next: CoverVersionConfig = { coverId: cover, title: coverTitle, style: coverStyle, coverUrl };
      const prev = current[activeMaterialVersionKey];
      if (
        prev?.coverId === next.coverId
        && prev?.title === next.title
        && prev?.coverUrl === next.coverUrl
        && JSON.stringify(prev?.style) === JSON.stringify(next.style)
      ) return current;
      return { ...current, [activeMaterialVersionKey]: next };
    });
  }, [activeMaterialVersionKey, cover, coverTitle, coverStyle, coverUrl]);
  // 成片预览可播放的真实视频片段（mock 占位素材没有 url）
  const previewable = useMemo(() => selectedClips.filter(c => c.url && c.type === 'video'), [selectedClips]);
  const activeSpokenScript = voiceDrafts[activeVoiceLang] || voiceoverLines || script;
  const activeVoiceDuration = voiceoverMode === 'ai'
    ? voiceoverAudios[activeVoiceLang]?.duration || 0
    : voiceoverDur;
  const masterScriptSnapshot = useRef(script);
  useEffect(() => {
    if (masterScriptSnapshot.current !== script && Object.keys(voiceDrafts).length) {
      setVoiceDraftStaleLangs(current => [...new Set([...current, ...voiceLangs.filter(code => code !== 'zh')])]);
    }
    masterScriptSnapshot.current = script;
  }, [script, voiceDrafts, voiceLangs]);
  // 字幕 cue：当前语种口播台词 + TTS 时长（无配音则用素材总时长）
  const cues = useMemo(() => alignedCuesByLang[activeVoiceLang]?.length
    ? alignedCuesByLang[activeVoiceLang]
    : buildCues(activeSpokenScript, activeVoiceDuration || totalDur), [activeSpokenScript, activeVoiceDuration, activeVoiceLang, alignedCuesByLang, totalDur]);
  // 字幕样式沿用封面体系，但默认底部居中 + 适配字号
  const subStyle: CoverStyle = useMemo(() => ({ ...coverStyle, position: 'bottom', align: 'center', size: coverStyle.size === 'L' ? 'M' : 'S' }), [coverStyle]);

  const isStoryboardSlotReviewComplete = (slot: StoryboardSlot) => Boolean(
    storyboardAssignments[slot.id] && materialById.has(storyboardAssignments[slot.id]),
  );
  const storyboardReviewPendingCount = mode === 'clone'
    ? storyboardSlots.filter(slot => !isStoryboardSlotReviewComplete(slot)).length
    : 0;
  const storyboardReviewComplete = mode !== 'clone' || storyboardReviewPendingCount === 0;
  const hasTimestampScript = Boolean(script.trim());
  const hasRequestedVoiceDrafts = voiceLangs.length > 0 && voiceLangs.every(code => Boolean(voiceDrafts[code]?.trim()));
  const hasRequestedVoiceovers = voiceLangs.length > 0 && voiceLangs.every(code => Boolean(voiceoverAudios[code]?.url));
  const canNext = contentMode === 'video' && step === 'material'
    ? (mode === 'clone'
      ? storyboardSlots.length > 0 && assignedCount === storyboardSlots.length
      : (storyboardSlots.length > 0 ? assignedCount === storyboardSlots.length : selected.length > 0))
    : true;
  useEffect(() => {
    if (!assignedOrderedIds.length) return;
    setSelected(current => {
      const deduped = [...new Set(assignedOrderedIds)];
      return current.length === deduped.length && current.every((id, index) => id === deduped[index]) ? current : deduped;
    });
  }, [assignedOrderedIds]);
  const isLast = stepIdx === activeSteps.length - 1;
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
    if (!raw) {
      setSourceDraftCheckPending(false);
      return;
    }
    try {
      const kickoff = JSON.parse(raw) as VideoKickoff;
      setVideoKickoff(kickoff);
      void studioApi.listProjects().then(items => {
        const matchingDrafts = items
          .filter(item => item.status === 'draft' && projectMatchesKickoff(item, kickoff))
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        setProjects(items);
        if (matchingDrafts[0]) {
          setExistingSourceDraftPrompt({
            project: matchingDrafts[0],
            matchCount: matchingDrafts.length,
            title: kickoff.video?.title || kickoff.generatedVideo?.title || matchingDrafts[0].title,
            poster: kickoff.generatedVideo?.poster
              || kickoff.video?.aiAnalysis?.materialPoster
              || kickoff.video?.thumbnail
              || '',
          });
        } else {
          setSourceDraftCheckPending(false);
        }
      }).catch(() => setSourceDraftCheckPending(false));
      if (kickoff.video?.duration && kickoff.video.duration > 0) setDuration(+kickoff.video.duration.toFixed(1));
      const fromInspiration = kickoff.source === 'inspiration_analysis';
      const fromImagePost = kickoff.source === 'inspiration_image_post' || kickoff.video?.contentFormat === 'image';
      if (fromImagePost) {
        setContentMode('poster');
        setMode('clone');
        setPlatform(kickoff.video?.platform === 'instagram' ? 'instagram' : 'facebook');
        setRatio('4:5');
        setActiveFolder('hot');
        setProjectTitle(kickoff.video?.title ? `竞品图文获客内容包 · ${kickoff.video.title}` : '竞品图文获客内容包');
        const kickoffOption = kickoff.productInfo ? productOptionFromInfo(kickoff.productInfo) : null;
        if (kickoffOption) {
          setProductOptions(current => current.some(item => item.id === kickoffOption.id)
            ? current.map(item => item.id === kickoffOption.id ? kickoffOption : item)
            : [kickoffOption, ...current]);
          setSelectedProductIds([kickoffOption.id]);
        }
        if (kickoff.productInfo) setProductInfo(kickoff.productInfo);
        setModeNotice(kickoff.video?.aiAnalysis?.imageEvidence?.observedFacts?.length
          ? '已带入完整轮播证据。系统将只保留可观察的布局、信息层级和表达方式，用企业中心产品与真实能力生成三组连续获客内容。'
          : '这条图文还没有完整轮播证据，请返回灵感大屏点击“重新分析完整轮播”后再生成。');
        setStepIdx(1);
        autoGen.current = true;
        return;
      }
      if (fromInspiration) {
        const profile = referenceVoiceProfile(kickoff);
        if (profile.available) {
          setUseReferenceVoiceStyle(true);
          setReferenceVoiceStrength('balanced');
          setTtsEmotion(`${profile.emotion}；保留节奏结构，重新表达全部台词`);
          setTtsEmotionIntensity(78);
          setTtsSpeed(profile.baseSpeed);
        }
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
        if (kickoff.productInfo && !hasIncompleteReferenceAnalysis(kickoff)) {
          setModeNotice('已读取对标视频结构和产品信息，正在调用后端生成真实分镜脚本。');
          setPendingRealCloneGeneration(true);
        } else if (hasIncompleteReferenceAnalysis(kickoff)) {
          const analyzedUntil = referenceAnalysisEnd(kickoff);
          setModeNotice(`原视频约 ${Number(kickoff.video?.duration || 0).toFixed(1)} 秒，但当前逐镜分析只覆盖到 ${analyzedUntil.toFixed(1)} 秒。请返回灵感大屏重新完成全片分析后再生成，避免脚本被截断。`);
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
      const kickoffMode: ModeCard['id'] = fromInspiration ? 'clone' : 'material';
      setMode(kickoffMode);
      setActiveFolder(kickoff.generatedVideo ? 'upload' : 'hot');
      setProjectTitle(draftTitleForMode(kickoffMode, kickoff.video?.title || kickoff.generatedVideo?.title || ''));
      setStepIdx(kickoff.source === 'material_library'
        ? 0
        : STEPS.findIndex(s => s.id === (fromInspiration ? 'script' : 'material')));
      autoGen.current = true;
    } catch {
      setSourceDraftCheckPending(false);
    }
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
          sourceType: 'ai-generated',
        };
    setMaterials(prev => {
      if (prev.some(m => m.id === clip.id || (clip.url && m.url === clip.url))) return prev;
      return [clip, ...prev];
    });
    setSelected([clip.id]);
    if (videoKickoff.materialRole === 'hook' || videoKickoff.source === 'material_library') {
      setHookMaterialId(clip.id);
      applyInferredMaterialTheme(generated.material || clip);
    }
  }, [duration, videoKickoff]);

  useEffect(() => {
    if (!(videoKickoff?.source === 'inspiration_image_post' || videoKickoff?.video?.contentFormat === 'image')) return;
    const thumb = videoKickoff.video?.thumbnail || videoKickoff.video?.aiAnalysis?.materialPoster || '';
    const sourceUrl = videoKickoff.video?.sourceUrl || '';
    const id = `hot-image-${sourceUrl || videoKickoff.video?.title || Date.now()}`;
    const clip: Clip = {
      id,
      name: videoKickoff.video?.title || '爆款图文参考',
      folder: 'hot',
      type: 'image',
      duration: 0,
      size: '图文参考',
      url: thumb,
      poster: thumb,
      scope: 'own',
    };
    setMaterials(prev => {
      if (prev.some(m => m.id === clip.id || (clip.url && m.url === clip.url))) return prev;
      return [clip, ...prev];
    });
    setSelected([clip.id]);
  }, [videoKickoff]);

  useEffect(() => {
    if (!videoKickoff || materials.length === 0) return;
    const materialUrl = videoKickoff.generatedVideo?.url || videoKickoff.video?.aiAnalysis?.materialUrl || videoKickoff.video?.videoUrl || '';
    const title = videoKickoff.generatedVideo?.title || videoKickoff.video?.title || '';
    const matched = materials.find(m => (materialUrl && m.url === materialUrl) || (title && m.name.includes(title.slice(0, 40))));
    if (matched) {
      setSelected([matched.id]);
      if (videoKickoff.materialRole === 'hook' || videoKickoff.source === 'material_library') {
        setHookMaterialId(matched.id);
        applyInferredMaterialTheme(matched);
      }
    }
  }, [materials, videoKickoff]);

  const editFor = (clip: Clip): ClipEdit => clipEdits[clip.id] ?? {
    trimStart: 0,
    trimEnd: clip.type === 'image' ? 3 : clip.duration,
    speed: 1,
    transition: '硬切',
    note: '',
  };
  const slotClipEditKey = (slotId: string, clipId: string) => `${slotId}:${clipId}`;
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
    const isHookSlot = hookMaterialId === clip.id && storyboardSlots[0]?.id === slot.id;
    if (isHookSlot) {
      const fullDuration = clip.type === 'image' ? Math.max(3, slot.end - slot.start) : Math.max(0.5, clip.duration || slot.end - slot.start);
      return {
        trimStart: 0,
        trimEnd: fullDuration,
        speed: 1,
        transition: '硬切',
        note: `${slot.detail}\n钩子素材：使用完整素材，不按分镜时间戳裁切。`,
      };
    }
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
  useEffect(() => {
    const firstSlot = storyboardSlots[0];
    const hookClip = hookMaterialId ? materialById.get(hookMaterialId) : undefined;
    if (!firstSlot || !hookClip) return;
    setStoryboardAssignments(current => current[firstSlot.id] === hookClip.id
      ? current
      : { ...current, [firstSlot.id]: hookClip.id });
    setClipEdits(current => {
      const key = slotClipEditKey(firstSlot.id, hookClip.id);
      return current[key] ? current : { ...current, [key]: defaultEditForSlot(hookClip, firstSlot) };
    });
  }, [hookMaterialId, materialById, storyboardSlots]); // eslint-disable-line react-hooks/exhaustive-deps
  const renderTimeline = useMemo(() => {
    const rows = storyboardSlots.map(slot => {
      const clip = materialById.get(storyboardAssignments[slot.id] || '');
      if (!clip) return null;
      const edit = clipEdits[slotClipEditKey(slot.id, clip.id)] || defaultEditForSlot(clip, slot);
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
  const timelineForAssembly = (assembly: StoryboardAssembly) => {
    const rows = storyboardSlots.map(slot => {
      const clip = materialById.get(assembly.assignments[slot.id] || '');
      if (!clip) return null;
      const edit = clipEdits[slotClipEditKey(slot.id, clip.id)] || defaultEditForSlot(clip, slot);
      return {
        clipId: clip.id, name: clip.name, type: clip.type, url: clip.url, poster: clip.poster,
        trimStart: edit.trimStart, trimEnd: edit.trimEnd, speed: edit.speed,
        targetStart: slot.start, targetEnd: slot.end, targetDuration: Math.max(0.5, slot.end - slot.start),
      };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (rows.length) return rows;
    return assembly.selected.map(id => materialById.get(id)).filter((clip): clip is Clip => Boolean(clip)).map(clip => {
      const edit = editFor(clip);
      return {
        clipId: clip.id, name: clip.name, type: clip.type, url: clip.url, poster: clip.poster,
        trimStart: edit.trimStart, trimEnd: edit.trimEnd, speed: edit.speed,
        targetStart: undefined, targetEnd: undefined, targetDuration: Math.max(0.5, edit.trimEnd - edit.trimStart),
      };
    });
  };
  const contentPlanVersions = useMemo(() => {
    const current: StoryboardAssembly = { id: activeAssemblyId, name: assemblyName, assignments: storyboardAssignments, sourcePlans: storyboardSourcePlans, selected };
    return storyboardAssemblies.map(item => item.id === activeAssemblyId ? current : item);
  }, [activeAssemblyId, assemblyName, selected, storyboardAssemblies, storyboardAssignments, storyboardSourcePlans]);
  const scriptForRenderLanguage = (code: string) => String(voiceDrafts[code] || (code === activeVoiceLang ? activeSpokenScript : '')).trim();
  const renderScriptLanguages = () => Array.from(new Set([...voiceLangs, activeVoiceLang].filter(Boolean)))
    .filter(code => Boolean(scriptForRenderLanguage(code)));
  const buildRenderableVideoVersions = () => {
    const languages = renderScriptLanguages();
    return contentPlanVersions.flatMap((plan, planIndex) => {
      const timeline = timelineForAssembly(plan);
      const validStoryboard = storyboardSlots.length > 0
        && timeline.length === storyboardSlots.length
        && timeline.every(item => Boolean(item.url && item.type !== 'audio' && item.targetDuration > 0));
      if (!validStoryboard) return [];
      return languages.map((code, languageIndex) => {
        const bgmId = materialVersionBgms[materialVersionKey(plan.id, code)] ?? assemblyBgms[plan.id] ?? bgm;
        return {
          key: renderCombinationKey(plan.id, code, bgmId),
          plan,
          planIndex,
          code,
          languageIndex,
          bgmId,
          script: scriptForRenderLanguage(code),
          timeline,
        };
      });
    });
  };
  const previewTimeline = useMemo(() => renderTimeline
    .map(item => {
      const clip = materialById.get(item.clipId || '') || materials.find(candidate => candidate.name === item.name);
      if (!clip || !clip.url || clip.type === 'audio') return null;
      return { ...item, clip };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item)), [materials, materialById, renderTimeline]);
  useEffect(() => {
    const cache = previewVideoCacheRef.current;
    const activeUrls = new Set<string>();
    previewTimeline.forEach(item => {
      if (item.clip.type !== 'video' || !item.clip.url) return;
      activeUrls.add(item.clip.url);
      if (cache.has(item.clip.url)) return;
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.src = item.clip.url;
      video.load();
      cache.set(item.clip.url, video);
    });
    cache.forEach((video, url) => {
      if (activeUrls.has(url)) return;
      video.pause();
      video.removeAttribute('src');
      video.load();
      cache.delete(url);
    });

    const nextIndex = previewIdx === null ? 0 : previewIdx + 1;
    const nextItem = previewTimeline[nextIndex];
    const nextVideoUrl = nextItem?.clip.type === 'video' ? nextItem.clip.url : '';
    if (nextItem && nextVideoUrl) {
      const nextVideo = cache.get(nextVideoUrl);
      if (nextVideo) {
        const warmNextFrame = () => {
          const seekTo = Math.max(0, nextItem.trimStart || 0);
          try { nextVideo.currentTime = seekTo; } catch { /* ignore preload seek edge cases */ }
        };
        if (nextVideo.readyState >= 1) warmNextFrame();
        else nextVideo.addEventListener('loadedmetadata', warmNextFrame, { once: true });
      }
    }
  }, [previewIdx, previewTimeline]);
  useEffect(() => () => {
    previewVideoCacheRef.current.forEach(video => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    });
    previewVideoCacheRef.current.clear();
  }, []);
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

  const goPreview = async (scriptOverride?: string, renderOverride?: { language?: string; voiceoverUrl?: string; voiceoverDur?: number; cues?: SubCue[]; outputOnly?: boolean; timeline?: typeof renderTimeline; bgmId?: string }) => {
    setStepIdx(STEPS.findIndex(s => s.id === 'preview'));
    setRendered(false);
    setRendering(true);
    setRenderPct(0);
    if (!renderOverride?.outputOnly) {
      setRenderOutputPath(null);
      setRenderOutputPreviewUrl(null);
    }
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
    const outputTimeline = renderOverride?.timeline ?? renderTimeline;
    const validOutputStoryboard = storyboardSlots.length > 0
      && outputTimeline.length === storyboardSlots.length
      && outputTimeline.every(item => Boolean(item.url && item.type !== 'audio' && item.targetDuration > 0));
    if (!String(outputScript || '').trim() || !validOutputStoryboard) {
      throw new Error('生成成片需要有效脚本，并为全部分镜匹配有效视频或图片素材。');
    }
    const timelineDuration = outputTimeline.reduce((sum, item) => sum + (item.targetDuration || 0), 0);
    const rawOutputCues = renderOverride?.cues?.length
      ? renderOverride.cues
      : alignedCuesByLang[outputLanguage]?.length
        ? alignedCuesByLang[outputLanguage]
        : buildCues(outputScript, outputVoiceoverDur || timelineDuration || totalDur);
    const outputCues = renderSafeCues(rawOutputCues, Math.min(
      timelineDuration || duration,
      outputVoiceoverDur > 0 ? outputVoiceoverDur : timelineDuration || duration,
    ));
    const spec = {
      materials: outputTimeline.length ? outputTimeline.map(item => item.name) : matNames,
      timeline: outputTimeline,
      script: outputScript,
      voice,
      bgm: renderOverride?.bgmId ?? bgm,
      bgmVol,
      voiceVol,
      coverId: cover,
      coverTitle,
      coverUrl: cUrl ?? undefined,
      ratio,
      sourceProjectId: projectId || undefined,
      duration: timelineDuration || duration,
      platform,
      language: outputLanguage,
      voiceoverUrl: voiceoverMode === 'none' ? undefined : outputVoiceoverUrl ?? undefined,
      subtitles: subtitlesOn ? {
        mode: subMode,
        style: { font: coverStyle.font, color: coverStyle.color, weight: coverStyle.weight, fontFamily: coverStyle.fontFamily },
        cues: subMode === 'bilingual' && outputLanguage === activeVoiceLang && cueZh.length === outputCues.length
          ? outputCues.map((c, i) => ({ ...c, zh: cueZh[i] }))
          : outputCues,
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
    const progressTimer = window.setInterval(() => {
      if (renderToken.current !== token) return;
      setRenderPct(current => Math.min(90, current + (current < 60 ? 6 : 2)));
    }, 1200);
    const localOut = await studioApi.renderLocal(auth.manifest).finally(() => window.clearInterval(progressTimer));
    if (renderToken.current !== token) return;
    if (!localOut.ok) throw new Error(localOut.error || '本地 MP4 导出失败');
    if (localOut.outputPath && localOut.previewUrl) renderPreviewUrlsRef.current[localOut.outputPath] = localOut.previewUrl;
    if (!renderOverride?.outputOnly) {
      setRenderOutputPath(localOut.outputPath ?? null);
      setRenderOutputPreviewUrl(localOut.previewUrl ?? null);
    }
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
    if (contentMode === 'video' && step === 'script' && scriptStageTab === 'theme') {
      setScriptStageTab('theme');
      return;
    }
    const nextStep = activeSteps[stepIdx + 1]?.id;
    if (contentMode === 'video' && nextStep === 'material') setActiveFolder('all');
    setStepIdx(i => Math.min(i + 1, activeSteps.length - 1));
  };
  const renderLanguageVersions = async () => {
    const combinations = buildRenderableVideoVersions();
    if (!combinations.length) {
      alert('暂无可生成的视频版本。请先完成有效脚本，并为全部分镜匹配有效素材。');
      return;
    }
    setBatchRenderingLangs(true);
    setLanguageRenderOutputs(prev => ({ ...prev, ...Object.fromEntries(combinations.map(item => [item.key, { status: 'pending' as const }])) }));
    try {
      for (const combination of combinations) {
        const { key, plan, code, bgmId } = combination;
        const audio = (voiceoverMode === 'ai' ? voiceoverAudios[code] : null)
          || { url: voiceoverMode === 'none' ? '' : voiceoverUrl || '', duration: voiceoverMode === 'none' ? 0 : voiceoverDur, cues: alignedCuesByLang[code] };
        setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'rendering' } }));
        try {
          const outputPath = await goPreview(combination.script, {
            language: code,
            voiceoverUrl: audio.url,
            voiceoverDur: audio.duration,
            cues: alignedCuesByLang[code] || audio.cues,
            outputOnly: true,
            timeline: combination.timeline,
            bgmId,
          });
          const previewUrl = outputPath ? renderPreviewUrlsRef.current[outputPath] : undefined;
          setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'done', path: outputPath || undefined, previewUrl } }));
          setLanguageRenderVersions(prev => ({ ...prev, [key]: [{ id: `${key}-${Date.now()}`, versionNumber: (prev[key]?.[0]?.versionNumber || 0) + 1, status: 'done', path: outputPath || undefined, previewUrl, createdAt: new Date().toISOString() }, ...(prev[key] || [])] }));
        } catch (err: any) {
          setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'failed', error: err?.message || '生成失败' } }));
          setLanguageRenderVersions(prev => ({ ...prev, [key]: [{ id: `${key}-${Date.now()}`, versionNumber: (prev[key]?.[0]?.versionNumber || 0) + 1, status: 'failed', error: err?.message || '生成失败', createdAt: new Date().toISOString() }, ...(prev[key] || [])] }));
        }
      }
    } finally {
      setBatchRenderingLangs(false);
    }
  };
  const retryLanguageRender = async (combination: { key: string; code: string; plan: StoryboardAssembly; bgmId: string }) => {
    const { key, code, plan, bgmId } = combination;
    const audio = (voiceoverMode === 'ai' ? voiceoverAudios[code] : null)
      || { url: voiceoverMode === 'none' ? '' : voiceoverUrl || '', duration: voiceoverMode === 'none' ? 0 : voiceoverDur, cues: alignedCuesByLang[code] };
    setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'rendering' } }));
    try {
      const outputPath = await goPreview(scriptForRenderLanguage(code), {
        language: code,
        voiceoverUrl: audio.url,
        voiceoverDur: audio.duration,
        cues: alignedCuesByLang[code] || audio.cues,
        outputOnly: true,
        timeline: timelineForAssembly(plan),
        bgmId,
      });
      const previewUrl = outputPath ? renderPreviewUrlsRef.current[outputPath] : undefined;
      setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'done', path: outputPath || undefined, previewUrl } }));
      setLanguageRenderVersions(prev => ({ ...prev, [key]: [{ id: `${key}-${Date.now()}`, versionNumber: (prev[key]?.[0]?.versionNumber || 0) + 1, status: 'done', path: outputPath || undefined, previewUrl, createdAt: new Date().toISOString() }, ...(prev[key] || [])] }));
    } catch (err: any) {
      setLanguageRenderOutputs(prev => ({ ...prev, [key]: { status: 'failed', error: err?.message || '生成失败' } }));
      setLanguageRenderVersions(prev => ({ ...prev, [key]: [{ id: `${key}-${Date.now()}`, versionNumber: (prev[key]?.[0]?.versionNumber || 0) + 1, status: 'failed', error: err?.message || '生成失败', createdAt: new Date().toISOString() }, ...(prev[key] || [])] }));
    }
  };
  const prev = () => {
    if (contentMode === 'video' && step === 'script' && scriptStageTab !== 'theme') {
      setScriptStageTab('theme');
      return;
    }
    setStepIdx(i => Math.max(i - 1, 0));
  };

  const regenScript = async (type: 'voiceover' | 'storyboard' = scriptType) => {
    if (!activeProductInfo.trim() || !activeProductLabel) {
      alert('请先在第一步选择企业中心产品，再生成脚本。');
      setStepIdx(0);
      return;
    }
    setScriptLoading(true);
    try {
      const response = await studioApi.script(
        { materials: matNames, productInfo: activeProductInfo, language: lang, platform, duration, scriptType: type, generationMode: mode, cooperationRoute, provider, audience, sellingPoints, tone, videoTheme: videoThemePayload }, script,
      );
      if (response.source && response.source !== 'ai') throw new Error(response.fallbackReason || 'AI脚本未通过检查，未生成兜底稿。');
      const s = response.script || '';
      if (!s.trim()) throw new Error(response.error || '模型没有返回可用脚本。');
      setScript(sanitizeStoryboardScript(s, activeProductInfo, activeProductLabel));
    } catch (err: any) {
      alert(err?.message || '脚本生成失败，请稍后重试。');
    } finally {
      setScriptLoading(false);
    }
  };

  const smartSelectMaterialsFast = async () => {
    if (materialSelectLoading) return;
    setMaterialSelectLoading(true);
    setModeNotice('正在按分镜语义、镜头角色和有效时长快速匹配…');
    try {
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      const allVisuals = materials.filter(item => item.type !== 'audio');
      const pool = allVisuals.filter(item => isClipCompatibleWithRatio(item, ratio));
      if (!pool.length) {
        setModeNotice(allVisuals.length
          ? `素材库里没有与 ${ratio} 同方向的素材，请上传同画幅素材或调整成片比例。`
          : '素材库暂无可匹配的视频或图片，请先上传素材。');
        return;
      }
      if (!storyboardSlots.length) {
        const picked = pickMaterialClipsLocally(pool, duration, selected).selectedIds;
        setSelected(picked);
        setScriptRecommendedMaterialIds(picked);
        setActiveFolder('recommend');
        setModeNotice(`已快速选出 ${picked.length} 条候选素材；生成时间戳脚本后可继续逐镜匹配。`);
        return;
      }

      const savedCurrent: StoryboardAssembly = {
        id: activeAssemblyId,
        name: assemblyName,
        assignments: storyboardAssignments,
        sourcePlans: storyboardSourcePlans,
        selected,
      };
      const allPlans = storyboardAssemblies.map(item => item.id === activeAssemblyId ? savedCurrent : item);
      const variantIndex = Math.max(0, allPlans.findIndex(item => item.id === activeAssemblyId));
      const previousAssignments = allPlans
        .filter(item => item.id !== activeAssemblyId)
        .map(item => item.assignments)
        .filter(item => Object.keys(item).length > 0);
      const hookClip = hookMaterialId ? materialById.get(hookMaterialId) : undefined;
      const slotsToMatch = hookClip ? storyboardSlots.slice(1) : storyboardSlots;
      const matchPool = hookClip ? pool.filter(item => item.id !== hookClip.id) : pool;
      const matchedAssignments = matchMaterialsToStoryboardLocally(matchPool, slotsToMatch, selected.filter(id => id !== hookMaterialId), {
        variantIndex,
        previousAssignments,
      });
      const assignments = hookClip && storyboardSlots[0]
        ? { ...matchedAssignments, [storyboardSlots[0].id]: hookClip.id }
        : matchedAssignments;
      const orderedIds = storyboardSlots.map(slot => assignments[slot.id]).filter((id): id is string => Boolean(id));
      const nextEdits: Record<string, ClipEdit> = {};
      const nextPlans: Record<string, StoryboardSourcePlan> = {};
      storyboardSlots.forEach(slot => {
        const clipId = assignments[slot.id];
        const clip = clipId ? materialById.get(clipId) : undefined;
        if (!clip) return;
        nextEdits[slotClipEditKey(slot.id, clip.id)] = defaultEditForSlot(clip, slot);
        const detectedSource = clipSourceMode(clip);
        nextPlans[slot.id] = {
          ...sourcePlanFor(slot),
          mode: detectedSource,
          decided: true,
          confirmed: false,
          generatedClipId: detectedSource === 'ai' ? clip.id : undefined,
          error: '',
        };
      });
      setStoryboardAssignments(assignments);
      setStoryboardSourcePlans(current => ({ ...current, ...nextPlans }));
      setClipEdits(current => ({ ...current, ...nextEdits }));
      setSelected([...new Set(orderedIds)]);
      setScriptRecommendedMaterialIds([...new Set(orderedIds)]);
      setActiveFolder('recommend');
      setActiveStoryboardSlotId(storyboardSlots.find(slot => !assignments[slot.id])?.id || storyboardSlots[0]?.id || '');
      const previousMaterialIds = new Set(previousAssignments.flatMap(plan => Object.values(plan)));
      const freshCount = orderedIds.filter(id => !previousMaterialIds.has(id)).length;
      const freshRatio = orderedIds.length ? Math.round(freshCount / orderedIds.length * 100) : 0;
      const diversityMessage = previousAssignments.length
        ? `；其中 ${freshCount}/${orderedIds.length} 条为新素材（差异率 ${freshRatio}%），开场和素材顺序已按流量测试策略变化`
        : '';
      setModeNotice(hookClip
        ? `已固定“${hookClip.name}”为第一个钩子分镜（完整素材、不按时间戳裁切），并为后续 ${Math.max(0, orderedIds.length - 1)} 个分镜完成素材匹配${diversityMessage}。`
        : `已按“脚本语义 + 镜头角色 + 有效时长 + 版本差异”完成 ${orderedIds.length}/${storyboardSlots.length} 个分镜匹配${diversityMessage}。可逐镜替换后继续。`);
    } catch (error) {
      setModeNotice(error instanceof Error ? `智能选材失败：${error.message}` : '智能选材失败，请重试。');
    } finally {
      setMaterialSelectLoading(false);
    }
  };

  const generateFromMaterialLibrary = async () => {
    if (!enterpriseScriptLanguage) {
      setModeNotice('企业中心尚未配置首选输出语言或主要业务语言，请先完成企业中心语言配置。');
      return;
    }
    setModeActionLoading(true);
    setModeActionStatus('正在快速匹配本地素材…');
    setModeNotice('');
    try {
      const pool = materials.filter(item => item.type !== 'audio' && isClipCompatibleWithRatio(item, ratio));
      if (pool.length === 0) {
        setModeNotice(`素材库暂无与 ${ratio} 同方向的图片或视频，请先上传同画幅素材后再生成时间戳脚本。`);
        setStepIdx(STEPS.findIndex(s => s.id === 'material'));
        return;
      }
      const preferred = selected.length
        ? selected
        : pool.filter(item => ['presenter', 'product', 'factory', 'scene', 'model', 'detail', 'upload'].includes(item.folder)).slice(0, 6).map(item => item.id);
      const hookOnly = hookMaterialId && pool.some(item => item.id === hookMaterialId);
      const selectResp = hookOnly ? { selectedIds: [hookMaterialId] } : pickMaterialClipsLocally(pool, duration, preferred);
      const nextSelected = (selectResp.selectedIds || []).filter(id => pool.some(item => item.id === id));
      const finalSelected = nextSelected.length ? nextSelected : (preferred.length ? preferred : pool.slice(0, 4).map(item => item.id));
      const selectedMaterialsForScript = finalSelected.map(id => pool.find(item => item.id === id)).filter(Boolean) as Clip[];
      if (hookMaterialId) selectedMaterialsForScript.sort((a, b) => Number(b.id === hookMaterialId) - Number(a.id === hookMaterialId));
      const names = selectedMaterialsForScript.map(item => item.name);
      const materialInfos = buildMaterialInfosForScript(selectedMaterialsForScript, duration, hookMaterialId);
      if (hookOnly && materialInfos.length && materialInfos[0]!.targetEnd < duration - 0.5) {
        let cursor = materialInfos[0]!.targetEnd;
        let index = 2;
        while (cursor < duration - 0.1) {
          const end = Math.min(duration, cursor + 3);
          materialInfos.push({
            name: `待匹配素材（分镜${index}）`, type: 'video', folder: 'recommend', duration: end - cursor,
            effectiveDuration: end - cursor, role: '后续分镜待匹配', targetStart: cursor, targetEnd: end,
            observations: ['本步骤不选择素材；只定义镜头功能，下一步再从素材库匹配'],
          });
          cursor = end;
          index += 1;
        }
      }
      const coveredDuration = materialInfos.at(-1)?.targetEnd || 0;
      const outputs: ModeScriptOutput[] = [];
      const count = Math.max(1, Math.min(5, cloneCount));
      for (let i = 0; i < count; i += 1) {
        setModeActionStatus(hookOnly
          ? `正在分析钩子素材并规划后续分镜${count > 1 ? ` ${i + 1}/${count}` : ''}…`
          : `正在分析 ${finalSelected.length} 个推荐素材并生成脚本${count > 1 ? ` ${i + 1}/${count}` : ''}…`);
        let nextScript = '';
        const response = await withTimeout(studioApi.script(
          {
            materials: names,
            materialInfos,
            productInfo: activeProductInfo,
            language: enterpriseScriptLanguage,
            platform,
            duration,
            scriptType: 'storyboard',
            generationMode: 'material',
            cooperationRoute,
            voiceoverMode,
            provider,
            audience,
            sellingPoints,
            tone: `${tone} · 素材库方案 ${i + 1}`,
            videoTheme: videoThemePayload,
          },
          '',
        ), 45_000, '后端模型生成超过 45 秒。');
        if (response.source && response.source !== 'ai') throw new Error(response.error || response.fallbackReason || 'AI脚本未通过检查，未生成兜底稿。');
        nextScript = sanitizeStoryboardScript(response.script || '', activeProductInfo, activeProductLabel).trim();
        if (!nextScript) throw new Error(response.error
          ? `脚本服务连接失败：${response.error}`
          : '后端脚本生成接口未返回结果。');
        outputs.push({
          id: `material-${Date.now()}-${i}`,
          title: `${activeVideoTheme.title} · ${audience.trim() || '默认买家'}（${modeScripts.filter(item => item.contentTheme === activeVideoTheme.id && item.buyerLabel === (audience.trim() || '默认买家')).length + i + 1}）`,
          script: nextScript,
          mode: 'material',
          contentTheme: activeVideoTheme.id,
          buyerLabel: audience.trim() || '默认买家',
        });
      }
      const sceneCount = outputs[0] ? parseStoryboardSlots(outputs[0].script, duration).length : finalSelected.length;
      const sceneMatchedResp = !hookOnly && pool.length ? pickMaterialClipsLocally(pool, duration, finalSelected, Math.max(1, sceneCount)) : { selectedIds: [], reason: '' };
      const recommendedIds = (sceneMatchedResp.selectedIds || []).filter(id => pool.some(item => item.id === id));
      setScriptRecommendedMaterialIds(hookOnly ? [hookMaterialId] : (recommendedIds.length ? recommendedIds : finalSelected));
      setLang(enterpriseScriptLanguage);
      setScriptType('storyboard');
      if (outputs[0]) {
        const spoken = extractVoiceoverText(outputs[0].script);
        setScript(outputs[0].script);
        setVoiceoverLines(spoken);
        setVoiceDrafts({ [enterpriseScriptLanguage]: spoken });
        setActiveVoiceLang(enterpriseScriptLanguage);
        setScriptView('timestamp');
        setActiveModeScriptId(outputs[0].id);
      }
      setModeScripts(current => [...current, ...outputs]);
      setProjectTitle(projectTitle === '未命名草稿' ? `素材库智能素材 · ${langZh(enterpriseScriptLanguage) || enterpriseScriptLanguage}口播脚本` : projectTitle);
      setModeNotice(hookOnly
          ? `已仅根据钩子素材生成分镜规划；本步骤未补充其他素材，下一步将从第二个分镜开始匹配。`
        : coveredDuration + 0.1 < duration
          ? `当前素材有效动作约 ${coveredDuration.toFixed(1)} 秒，短于目标 ${duration} 秒；已按真实可用时长生成分镜，请补充素材后再完成成片。`
          : `已生成${langZh(enterpriseScriptLanguage) || enterpriseScriptLanguage}口播脚本，并按 ${Math.max(1, sceneCount)} 个分镜准备了 ${recommendedIds.length || finalSelected.length} 个素材候选，下一步可确认。`);
      autoGen.current = true;
    } catch (err: any) {
      setModeNotice(err?.message || '素材库生成失败，请稍后重试。');
    } finally {
      setModeActionLoading(false);
      setModeActionStatus('');
    }
  };

  const generateFromProductInfo = async () => {
    if (!enterpriseScriptLanguage) {
      setModeNotice('企业中心尚未配置首选输出语言或主要业务语言，请先完成企业中心语言配置。');
      return;
    }
    if (productScriptAbortRef.current) return;
    const controller = new AbortController();
    productScriptAbortRef.current = controller;
    const hardTimeout = window.setTimeout(() => controller.abort(), 30_000);
    setModeActionLoading(true);
    setModeActionStatus('正在生成产品脚本，最长等待 30 秒…');
    setModeNotice('');
    try {
      const product = activeProductInfo.trim();
      if (!product) {
        setModeNotice('请先填写或选择产品信息，再生成产品素材。');
        return;
      }
      const outputs: ModeScriptOutput[] = [];
      const count = Math.max(1, Math.min(5, cloneCount));
      for (let i = 0; i < count; i += 1) {
        let nextScript = '';
        const response = await studioApi.script(
          {
            materials: [],
            productInfo: product,
            language: enterpriseScriptLanguage,
            platform,
            duration,
            scriptType: 'storyboard',
            generationMode: 'product',
            cooperationRoute,
            voiceoverMode,
            provider: 'qwen',
            audience,
            sellingPoints,
            tone: `${tone} · 产品方案 ${i + 1}`,
            videoTheme: videoThemePayload,
          },
          '',
          { signal: controller.signal },
        );
        if (response.source && response.source !== 'ai') throw new Error(response.error || response.fallbackReason || 'AI脚本未通过检查，未生成兜底稿。');
        nextScript = sanitizeStoryboardScript(response.script || '', product, activeProductLabel).trim();
        if (!nextScript) throw new Error(response.error
          ? `脚本服务连接失败：${response.error}`
          : '后端脚本生成接口未返回结果。');
        outputs.push({
          id: `product-${Date.now()}-${i}`,
          title: `${activeVideoTheme.title} · ${audience.trim() || '默认买家'}（${modeScripts.filter(item => item.contentTheme === activeVideoTheme.id && item.buyerLabel === (audience.trim() || '默认买家')).length + i + 1}）`,
          script: nextScript,
          mode: 'product',
          contentTheme: activeVideoTheme.id,
          buyerLabel: audience.trim() || '默认买家',
        });
      }
      const firstScript = outputs[0]?.script || script;
      setLang(enterpriseScriptLanguage);
      setScriptType('storyboard');
      setScript(firstScript);
      const spoken = extractVoiceoverText(firstScript);
      setVoiceoverLines(spoken);
      setVoiceDrafts({ [enterpriseScriptLanguage]: spoken });
      setActiveVoiceLang(enterpriseScriptLanguage);
      setScriptView('timestamp');
      if (outputs[0]) setActiveModeScriptId(outputs[0].id);
      setModeScripts(current => [...current, ...outputs]);
      setProjectTitle(projectTitle === '未命名草稿' ? '产品生成 · AI智能素材' : projectTitle);
      setModeNotice('产品脚本已生成。确认脚本后，可继续选择配音和素材；不会自动生成视频。');
      autoGen.current = true;
    } catch (err: any) {
      setModeNotice(err?.message || '产品生成失败，请稍后重试。');
    } finally {
      window.clearTimeout(hardTimeout);
      if (productScriptAbortRef.current === controller) productScriptAbortRef.current = null;
      setModeActionLoading(false);
      setModeActionStatus('');
    }
  };

  const applyTimestampScript = (value: string, productInfoOverride = activeProductInfo) => {
    const cleaned = normalizeScriptTimestamps(sanitizeStoryboardScript(value, productInfoOverride, activeProductLabel));
    const spoken = extractVoiceoverText(cleaned);
    const sourceLanguage = detectScriptLanguageCode(spoken);
    setScript(cleaned);
    setVoiceoverLines(spoken);
    setVoiceDrafts(drafts => ({ ...drafts, [sourceLanguage]: spoken }));
    setActiveVoiceLang(sourceLanguage);
    setLang(sourceLanguage);
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
    if (!enterpriseScriptLanguage) {
      setModeNotice('企业中心尚未配置首选输出语言或主要业务语言，请先完成企业中心语言配置。');
      return;
    }
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
    if (!videoKickoff?.referenceAnalysis?.details?.length) {
      setModeNotice('已停止生成：当前草稿没有真实对标逐镜分析。请返回灵感大屏完成全片精确分析后再生成脚本。');
      return;
    }
    if (hasIncompleteReferenceAnalysis(videoKickoff)) {
      const analyzedUntil = referenceAnalysisEnd(videoKickoff);
      setModeNotice(`已停止生成：当前逐镜分析未达到时间线质量标准（至少每 5 秒 1 段、单段不超过 5.5 秒、无明显缺口/重叠，且不能含超时片段；当前覆盖到 ${analyzedUntil.toFixed(1)} 秒）。请返回灵感大屏完成全片精确分析后再生成脚本。`);
      return;
    }
    const cloneProductInfo = activeProductInfo.trim()
      || videoKickoff?.productInfo?.trim()
      || script.trim()
      || '当前爆款复刻脚本';
    const cloneProductLabel = activeProductLabel || selectedProductLabel(cloneProductInfo);
    if (mode === 'clone' && !activeProductInfo.trim()) {
      setModeNotice('已停止生成：未读取到企业中心产品信息。请先在第一步选择产品，再生成真实复刻脚本。');
      return;
    }
    setModeActionLoading(true);
    if (activeProductInfo.trim()) setModeNotice('');
    setModeActionStatus(mode === 'clone' ? '真实生成中…' : '');
    try {
      const cloneReference = videoKickoff;
      const targetCodes = cloneOutputMode === 'languages'
        ? enterpriseVoiceLangs.slice(0, Math.max(1, cloneCount))
        : Array.from({ length: cloneCount }, () => enterpriseScriptLanguage);
      const outputs: ModeScriptOutput[] = [];
      for (let index = 0; index < targetCodes.length; index += 1) {
        const code = targetCodes[index] || 'zh';
        const existingCloneScripts = [
          ...modeScripts.filter(item => item.mode === 'clone').map(item => item.script),
          ...outputs.map(item => item.script),
        ];
        const existingCloneCount = modeScripts.filter(item => item.mode === 'clone').length;
        const variantSeed = existingCloneCount + index;
        setModeActionStatus(`真实生成中 ${index + 1}/${targetCodes.length}，通常 20-90 秒，高峰期最多等待 300 秒…`);
        let generatedScript = '';
        const response = await withTimeout(studioApi.script(
            {
              materials: cloneReference.video?.platform ? [`平台：${cloneReference.video.platform}`] : [],
              productInfo: cloneProductInfo,
              language: code,
              platform,
              duration,
              scriptType: 'storyboard',
              generationMode: 'clone',
              cooperationRoute,
              provider,
              audience,
              sellingPoints,
              tone: `${tone} · 迁移方式：${migrationMode === 'fidelity' ? '高保真复刻' : migrationMode === 'structure' ? '结构迁移' : '机制借鉴'} · 第 ${variantSeed + 1} 版 · 保留原片 hook、证明顺序、切镜节奏和音画形态 · ${migrationMode === 'fidelity' ? '仅替换竞品事实' : '按所选产品重建场景、动作和证明内容'} · ${voiceoverMode === 'none' ? '原片无口播时保持台词为无，不新增口播' : '仅可在原片已有口播位重建短台词，不得增加新的口播镜头'} · 禁止新增原片不存在的字幕或 CTA`,
              voiceoverMode,
              videoTheme: videoThemePayload,
              referenceTitle: cloneReference.video?.title || '',
              referenceAnalysis: cloneReferenceAnalysisText(cloneReference),
              referenceHighlights: cloneReferenceHighlights(cloneReference),
              existingScripts: existingCloneScripts,
              variantSeed,
            },
            '',
        ), 300_000, '后端模型生成超过 300 秒，请稍后重试。');
        if (response.source && response.source !== 'ai') throw new Error(response.error || response.fallbackReason || 'AI脚本未通过检查，未生成兜底稿。');
        const normalized = ensureDistinctCloneStoryboard({
          script: response.script || '',
          kickoff: cloneReference,
          productInfo: cloneProductInfo,
          languageCode: code,
          strictProductName: cloneProductLabel,
          existingScripts: existingCloneScripts,
          variantSeed,
          migrationMode,
        });
        if (normalized.normalized) throw new Error('模型返回脚本未满足标准分镜字段或与已有脚本过于相似，未生成兜底稿。');
        generatedScript = normalized.script;
        if (!generatedScript) {
          throw new Error('模型没有返回可用脚本。');
        }
        outputs.push({
          id: `clone-${Date.now()}-${index}`,
          title: `爆款复刻时间戳脚本 ${existingCloneCount + index + 1}`,
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
      setModeNotice('已真实调用后端，按爆款结构和产品卖点生成标准分镜脚本。');
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
    if (mode === 'clone' && !videoKickoff) {
      setModeNotice('已停止生成：当前草稿没有真实对标逐镜分析。请返回灵感大屏完成全片精确分析后再优化脚本。');
      return;
    }
    setModeActionLoading(true);
    setModeNotice('');
    try {
      const response = await studioApi.script(
        {
          materials: matNames,
          productInfo: activeProductInfo,
          language: enterpriseScriptLanguage,
          platform,
          duration,
          scriptType: 'storyboard',
          generationMode: mode,
          cooperationRoute,
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
          videoTheme: videoThemePayload,
          referenceTitle: mode === 'clone' ? videoKickoff?.video?.title || '' : '',
          referenceAnalysis: mode === 'clone' && videoKickoff ? cloneReferenceAnalysisText(videoKickoff) : '',
          referenceHighlights: mode === 'clone' && videoKickoff ? cloneReferenceHighlights(videoKickoff) : [],
        },
        currentScript,
      );
      if (response.source && response.source !== 'ai') throw new Error(response.fallbackReason || 'AI脚本未通过检查，未生成兜底稿。');
      const optimized = response.script || '';
      const cloneOptimized = mode === 'clone'
        ? ensureDistinctCloneStoryboard({
          script: optimized,
          kickoff: videoKickoff || { referenceAnalysis: { details: [] } },
          productInfo: activeProductInfo,
          languageCode: 'zh',
          strictProductName: activeProductLabel,
          existingScripts: modeScripts.filter(item => item.mode === 'clone' && item.id !== activeModeScriptId).map(item => item.script),
          variantSeed: modeScripts.filter(item => item.mode === 'clone').findIndex(item => item.id === activeModeScriptId) + 1,
          migrationMode,
        })
        : null;
      if (cloneOptimized?.normalized) throw new Error('模型返回脚本未满足标准分镜字段或与已有脚本过于相似，未生成兜底稿。');
      const sanitizedOptimized = cloneOptimized
        ? cloneOptimized.script
        : sanitizeStoryboardScript(optimized, activeProductInfo, activeProductLabel);
      if (!sanitizedOptimized.trim()) throw new Error('模型没有返回可用脚本。');
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
      const sourceLanguage = detectScriptLanguageCode(base);
      const langs = voiceLangs.length ? voiceLangs : [sourceLanguage];
      const immediate: Record<string, string> = {};
      for (const code of langs) {
        immediate[code] = code === sourceLanguage ? normalizeScriptTimestamps(base) : '';
      }
      setVoiceDrafts(immediate);
      setActiveVoiceLang(sourceLanguage);
      setLang(sourceLanguage);
      setScriptView('voiceover');
      setVoiceDraftNotice(`已识别${langZh(sourceLanguage) || sourceLanguage}口播，正在批量翻译 ${langs.filter(code => code !== sourceLanguage).length} 个语种...`);

      const improved: Record<string, string> = { ...immediate };
      const targets = langs.filter(code => code !== sourceLanguage);
      const failedLangs: string[] = [];
      let translateError = '';
      if (targets.length) {
        const translated = await studioApi.translateBatch({ text: normalizeScriptTimestamps(base), targets, source: sourceLanguage })
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
        ? `已提取${langZh(sourceLanguage) || sourceLanguage}口播；${failedLangs.map(code => LANGS.find(item => item.code === code)?.label || code).join('、')} 翻译失败：${translateError || '模型未返回有效译文'}。`
        : `已生成 ${langs.length || 1} 个语种字幕。`);
      setVoiceDraftStaleLangs([]);
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
    // 必须在用户点击的同步调用栈中创建窗口，否则生成封面/写剪贴板的 await
    // 会丢失浏览器 user gesture，导致可画窗口被弹窗拦截器吞掉。
    const popup = window.open(CANVA_VIDEO_COVER_URL, 'lingshu-canva-cover');
    const openCanva = () => {
      if (!popup || popup.closed) {
        window.location.assign(CANVA_VIDEO_COVER_URL);
        return;
      }
      popup.focus();
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

  const importCanvaCover = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('请从可画导出 PNG、JPG 或 WebP 图片后再导回。');
      return;
    }
    setCoverCanvaOpening(true);
    try {
      const [dataBase64, media] = await Promise.all([fileToDataUrl(file), probeMedia(file)]);
      const { material } = await studioApi.uploadMaterial({
        name: file.name,
        folder: 'upload',
        type: 'image',
        width: media.width,
        height: media.height,
        dataBase64,
        mimeType: file.type,
      });
      if (!material?.id || !material.url) throw new Error('封面上传失败');
      setMaterials(current => [materialToClip(material), ...current.filter(item => item.id !== material.id)]);
      setCover(material.id);
      setCoverUrl(material.url);
    } catch (err: any) {
      alert(err?.message || '可画封面导回失败，请稍后重试。');
    } finally {
      setCoverCanvaOpening(false);
      if (canvaReturnInputRef.current) canvaReturnInputRef.current.value = '';
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
  const previewLanguageVersion = (code: string, autoPlay = true) => {
    const audio = voiceoverMode === 'ai' ? voiceoverAudios[code] : { url: voiceoverUrl || '', duration: voiceoverDur };
    setActiveVoiceLang(code);
    setLang(code);
    if (voiceoverMode === 'ai') {
      setVoiceoverUrl(audio?.url || null);
      setVoiceoverDur(audio?.duration || 0);
    } else if (audio?.url) {
      setVoiceoverMode(voiceoverMode === 'none' ? 'ai' : voiceoverMode);
      setVoiceoverUrl(audio.url);
      setVoiceoverDur(audio.duration || 0);
    }
    setSubPreviewIdx(0);
    setRenderDownloadMessage('');
    if (!autoPlay) return;
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
    previewAdvanceLockRef.current = false;
    setPreviewIdx(null);
    setPreviewTime(0);
    [previewBgmAudioRef.current, previewVoiceAudioRef.current].forEach(el => {
      if (!el) return;
      el.pause();
      el.currentTime = 0;
    });
  };
  const handlePreviewClipEnded = () => {
    if (previewAdvanceLockRef.current) return;
    previewAdvanceLockRef.current = true;
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
    previewAdvanceLockRef.current = false;
    setPreviewVideoReady(false);
  }, [previewIdx]);
  const jumpToPreviewClip = (index: number) => {
    if (!previewTimeline[index]) return;
    const offset = previewOffsetByIndex[index] || 0;
    setPreviewNote(false);
    setPreviewTime(offset);
    setPreviewIdx(index);
    [previewBgmAudioRef.current, previewVoiceAudioRef.current].forEach(el => {
      if (!el?.src) return;
      try { el.currentTime = offset; } catch { /* ignore seek edge cases */ }
      if (el.volume > 0) void el.play().catch(() => {});
    });
  };
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
    const targetDuration = Math.max(0.5, item.targetDuration || ((item.trimEnd || 0) - trimStart) || 3);
    if (local >= targetDuration - 0.04) handlePreviewClipEnded();
  };
  useEffect(() => {
    const bgmEl = previewBgmAudioRef.current;
    const voiceEl = previewVoiceAudioRef.current;
    const bgmUrl = selectedBgmTrack?.url || '';
    const currentVoiceUrl = voiceoverMode === 'none' || !previewVoiceOn ? '' : voiceoverUrl || '';
    const bgmGain = previewBgmOn ? Math.max(0, Math.min(1, (bgmVol || 0) / 100)) * (currentVoiceUrl ? 0.5 : 1) : 0;
    const voiceGain = previewVoiceOn ? Math.max(0, Math.min(1, (voiceVol || 0) / 100)) : 0;

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
      bgmEl.currentTime = Math.max(0, previewTime);
      void bgmEl.play().catch(() => {});
    }
    if (voiceEl && currentVoiceUrl && voiceGain > 0) {
      if (voiceEl.src !== new URL(currentVoiceUrl, window.location.href).href) voiceEl.src = currentVoiceUrl;
      voiceEl.currentTime = Math.max(0, previewTime);
      void voiceEl.play().catch(() => {});
    }
  }, [bgmVol, previewBgmOn, previewPlaying, previewVoiceOn, selectedBgmTrack, voiceVol, voiceoverMode, voiceoverUrl]);
  // 离开预览步时停止播放
  useEffect(() => {
    if (step !== 'preview' && step !== 'bgm') {
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

  const buildPublishVersions = (): StudioPublishItem[] => {
    const publishPlatform = platform as StudioPublishPlatform;
    const baseTitle = projectTitle.trim() || coverTitle || 'AI 快剪成片';
    const seenPaths = new Set<string>();

    return buildRenderableVideoVersions().map(({ plan, planIndex, code, languageIndex, bgmId, key }) => {
      const latestDone = (languageRenderVersions[key] || []).find(item => item.status === 'done' && item.path);
      const output = languageRenderOutputs[key];
      const path = (output?.status === 'done' ? output.path : '')
        || latestDone?.path
        || (key === activeRenderCombinationKey ? renderOutputPath : '');
      const videoPath = String(path || '').trim();
      if (!videoPath) return null;
      if (videoPath && seenPaths.has(videoPath)) return null;
      if (videoPath) seenPaths.add(videoPath);
      const versionName = `${plan.name || `视频${planIndex + 1}`} * ${langZh(code) || `语种${languageIndex + 1}`}`;
      return {
        videoPath,
        previewUrl: output?.previewUrl || latestDone?.previewUrl || (key === activeRenderCombinationKey ? renderOutputPreviewUrl || undefined : undefined),
        title: `${baseTitle} - ${versionName}`,
        description: caption.trim() || voiceDrafts[code] || activeSpokenScript,
        ratio,
        sourceProjectId: projectId || undefined,
        platform: publishPlatform,
      };
    }).filter(Boolean) as StudioPublishItem[];
  };

  const buildPublishPayload = (): StudioPublishPayload => {
    const items = buildPublishVersions();
    const fallback: StudioPublishItem = {
      videoPath: renderOutputPath || '',
      previewUrl: renderOutputPreviewUrl || undefined,
      title: projectTitle.trim() || coverTitle || 'AI 快剪成片',
      description: caption.trim() || activeSpokenScript,
      ratio,
      sourceProjectId: projectId || undefined,
      platform: platform as StudioPublishPlatform,
    };
    return items.length ? { ...fallback, items } : fallback;
  };

  useEffect(() => {
    try {
      const payload = buildPublishPayload();
      const publishableItems = payload.items?.length ? payload.items : [payload];
      if (publishableItems.some(item => Boolean(item.videoPath?.trim()))) {
        localStorage.setItem('ow_publish_draft', JSON.stringify(payload));
      } else {
        localStorage.removeItem('ow_publish_draft');
      }
    } catch { /* ignore */ }
    // Keep the top-level publish tab in sync with the latest generated combinations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRenderCombinationKey, activeVoiceLang, assemblyBgms, bgm, caption, contentPlanVersions, languageRenderOutputs, languageRenderVersions, materialVersionBgms, platform, projectId, projectTitle, ratio, renderOutputPath, renderOutputPreviewUrl, voiceDrafts, voiceLangs, voiceoverAudios, voiceoverMode, voiceoverUrl]);

  const goPublishCurrentWork = () => {
    const payload = buildPublishPayload();
    const items = payload.items?.length ? payload.items : [payload];
    if (!items.some(item => Boolean(item.videoPath?.trim()))) return;
    onGoPublish?.(payload);
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
    const imageEvidence = videoKickoff?.video?.aiAnalysis?.imageEvidence;
    const isEvidenceLedPackage = Boolean(
      (videoKickoff?.source === 'inspiration_image_post' || videoKickoff?.video?.contentFormat === 'image')
      && imageEvidence?.observedFacts?.length,
    );
    const isImageReferenceWithoutEvidence = Boolean(
      (videoKickoff?.source === 'inspiration_image_post' || videoKickoff?.video?.contentFormat === 'image')
      && !imageEvidence?.observedFacts?.length,
    );
    if (isImageReferenceWithoutEvidence) {
      setModeNotice('当前记录只有标题或首图，没有完整轮播证据。请返回灵感大屏重新分析后再生成，避免凭空总结爆点。');
      return;
    }
    if (mode === 'product' && !activeProductLabel) {
      setModeNotice('产品信息生成需要先在第一步选择企业中心产品，再进入第二步选择配套素材。');
      return;
    }
    if (mode === 'clone' && !isEvidenceLedPackage && !selectedClips.some(item => item.folder === 'hot')) {
      setModeNotice('对标图文套用需要先选择一条公开图文参考，用于提取可见布局、信息模块和表达方式。');
      return;
    }
    setPosterLoading(true);
    setModeNotice('');
    try {
      if (isEvidenceLedPackage) {
        const result = await studioApi.leadContentPackage({
          productInfo: activeProductInfo,
          platform,
          language: lang,
          ratio,
          referenceTitle: videoKickoff?.video?.title || '',
          referenceEvidence: imageEvidence,
        });
        if (!result.ok || result.items.length < 3) throw new Error(result.error || '获客内容包生成失败');
        const first = result.items[0]!;
        const firstSlide = first.slides[0];
        const poster = {
          headline: firstSlide?.headline || first.title,
          subheadline: firstSlide?.body || first.objective,
          originBadge: '',
          trustBadges: [],
          sellingPoints: first.slides.slice(1, 4).map(slide => [slide.headline, slide.body].filter(Boolean).join('：')),
          process: [],
          categories: [],
          bottomBar: [],
          cta: first.cta,
        };
        const posterResult: FbPosterResult = {
          ok: true,
          source: 'ai',
          poster,
          caption: first.caption,
          hashtags: first.hashtags,
          commentCta: first.cta,
          dmOpening: first.dmOpening,
          fieldsToConfirm: result.fieldsToConfirm,
          imagePrompt: first.imagePrompt,
          layoutModules: result.referenceModulesUsed.map(module => ({
            module: module.module,
            referencePattern: module.evidence,
            localAssetRole: '企业中心对应产品/工厂/证书/包装素材',
            replacementInstruction: module.application,
          })),
        };
        setLeadContentPackage(result);
        setPosterDraft(posterResult);
        setPosterJsonText(JSON.stringify(result, null, 2));
        const tags = first.hashtags.map(tag => `#${String(tag).replace(/^#/, '')}`).join(' ');
        setCaption([first.caption, tags].filter(Boolean).join(' '));
        setPosterImageUrl('');

        const ownReferenceIds = selectedClips
          .filter(item => item.folder !== 'hot' && item.type !== 'audio')
          .slice(0, 4)
          .map(item => item.id);
        if (ownReferenceIds.length > 0) {
          setModeNotice('三组内容方案已生成，正在用企业素材生成第 1 组首图预览…');
          try {
            const rendered = await studioApi.fbPosterRender({
              poster,
              caption: first.caption,
              imagePrompt: [
                first.imagePrompt,
                'Generate only the first cover slide of this carousel.',
                firstSlide ? `Cover role: ${firstSlide.role}; headline: ${firstSlide.headline}; body: ${firstSlide.body}; required enterprise asset role: ${firstSlide.assetRole}.` : '',
                'The supplied reference images are owned enterprise assets. Do not reproduce any competitor product, logo, packaging, contact details, or text.',
              ].filter(Boolean).join('\n'),
              ratio,
              materialIds: ownReferenceIds,
            });
            if (!rendered.ok || !rendered.url) throw new Error(rendered.error || '首图生成失败');
            setPosterImageUrl(rendered.url);
            if (rendered.material?.id) setSelected(prev => [...new Set([...prev, rendered.material!.id])]);
            await refreshMaterials();
            setModeNotice(result.fieldsToConfirm.length
              ? `已生成三组获客内容和第 1 组首图；发布前请确认：${result.fieldsToConfirm.join('、')}`
              : '已生成三组连续获客内容和第 1 组首图预览。');
          } catch (imageErr: any) {
            setModeNotice(`三组获客内容已生成，但首图生成失败：${imageErr?.message || '请稍后重试'}`);
          }
        } else {
          setModeNotice(result.fieldsToConfirm.length
            ? `三组获客内容已生成。请先选择企业产品/工厂素材再生成图片；发布前还需确认：${result.fieldsToConfirm.join('、')}`
            : '三组获客内容已生成。为避免把竞品产品带入成图，请先选择企业中心产品/工厂素材，再生成图片。');
        }
        return;
      }
      setLeadContentPackage(null);
      const selectedMaterials = selectedClips.slice(0, 8).map(item => ({
        id: item.id,
        name: item.name,
        type: item.type,
        folder: item.folder,
        role: materialRoleLabel(item),
      }));
      const hotPosterRefs = selectedClips
        .filter(item => item.folder === 'hot')
        .map(item => [
          `爆款图文参考：${item.name}`,
          '需要模块化拆解：标题区、产品主视觉、背景氛围、工厂/证明区、徽章区、流程图、产品分类卡、CTA/底栏、配文框架。',
          '复用方式：只复用通用版式、构图、背景氛围和信息层级；用本地产品图替换竞品产品，用本地工厂图/证书图/包装图/场景图匹配对应模块。',
          '禁止复制：竞品品牌、Logo、认证、价格、MOQ、交期、出口国家、工厂资质和任何未验证商业承诺。',
        ].join('。'))
        .join('\n');
      const result = await studioApi.fbPoster({
        mode,
        productInfo: activeProductInfo,
        platform,
        ratio,
        posterStyle,
        language: lang,
        provider,
        materials: selectedMaterials,
        referenceNotes: mode === 'clone'
          ? [hotPosterRefs, videoKickoff ? cloneReferenceAnalysisText(videoKickoff) : ''].filter(Boolean).join('\n\n')
          : '',
      });
      if (!result.ok && !result.poster?.headline) throw new Error(result.error || '海报文案生成失败');
      setPosterDraft(result);
      setPosterJsonText(JSON.stringify(result.poster, null, 2));
      const tags = (result.hashtags || []).map(tag => `#${String(tag).replace(/^#/, '')}`).join(' ');
      setCaption([result.caption, tags].filter(Boolean).join(' '));
      setModeNotice('正在生成海报图...');
      try {
        const rendered = await studioApi.fbPosterRender({
          poster: result.poster,
          caption: result.caption,
          imagePrompt: result.imagePrompt,
          ratio,
          materialIds: selectedClips.filter(item => item.type !== 'audio').slice(0, 4).map(item => item.id),
        });
        if (!rendered.ok || !rendered.url) throw new Error(rendered.error || '图片生成失败');
        setPosterImageUrl(rendered.url);
        if (rendered.material?.id) setSelected(prev => [...new Set([...prev, rendered.material!.id])]);
        await refreshMaterials();
        setModeNotice(result.fieldsToConfirm?.length
          ? `已一次生成海报图和文案；请确认：${result.fieldsToConfirm.join('、')}`
          : '已一次生成海报图、海报文案 JSON 和发布配文。');
      } catch (imageErr: any) {
        setPosterImageUrl('');
        setModeNotice(result.fieldsToConfirm?.length
          ? `已生成海报文案 JSON，但图片生成失败：${imageErr?.message || '请检查图像模型 Key 或稍后重试'}；请确认：${result.fieldsToConfirm.join('、')}`
          : `已生成海报文案 JSON，但图片生成失败：${imageErr?.message || '请检查图像模型 Key 或稍后重试'}`);
      }
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
        { materials: matNamesForDemo, productInfo: activeProductInfo, language: lang, platform, duration, scriptType, generationMode: mode, provider, audience, sellingPoints, tone, videoTheme: videoThemePayload },
        script,
      );
      if (scriptResp.source && scriptResp.source !== 'ai') throw new Error(scriptResp.fallbackReason || 'AI脚本未通过检查，未生成兜底稿。');
      if (!String(scriptResp.script || '').trim()) throw new Error(scriptResp.error || '模型没有返回可用脚本。');
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
    const realClips = real.map(materialToClip);
    setMaterials(current => mergeClipLists(realClips, current.filter(item => item.sourceType === 'project-snapshot' || item.sourceType === 'historical-kickoff')));
  };
  const materialSourceRefreshesRef = useRef(new Set<string>());
  const refreshMaterialSource = async (materialId: string): Promise<Clip | undefined> => {
    if (materialSourceRefreshesRef.current.has(materialId)) return undefined;
    materialSourceRefreshesRef.current.add(materialId);
    try {
      const real = await studioApi.listMaterials();
      const refreshed = real.find(item => item.id === materialId);
      if (!refreshed) return undefined;
      const next = materialToClip(refreshed);
      setMaterials(current => current.map(item => item.id === materialId ? { ...item, url: next.url, poster: next.poster } : item));
      return next;
    } finally {
      materialSourceRefreshesRef.current.delete(materialId);
    }
  };
  useEffect(() => { void refreshMaterials(); }, []);
  useEffect(() => {
    const refill = (event: Event) => {
      const task = (event as CustomEvent<{ sourceProjectId?: string; uploadedMaterialIds?: string[] }>).detail;
      if (!task?.uploadedMaterialIds?.length || !projectId || task.sourceProjectId !== projectId) return;
      void refreshMaterials();
      setSelected(current => [...new Set([...current, ...task.uploadedMaterialIds!])]);
      setModeNotice('补拍素材已回填到当前草稿选材，原脚本未改写。');
    };
    window.addEventListener('lingshu:script-gap-refill', refill);
    return () => window.removeEventListener('lingshu:script-gap-refill', refill);
  }, [projectId]);
  useEffect(() => {
    const missing = materials.filter(item => item.type !== 'audio' && !clipAspectRatio(item) && (item.url || item.poster));
    if (!missing.length) return;
    let cancelled = false;
    void Promise.all(missing.map(async item => ({ id: item.id, ...(await probeClipAspect(item)) }))).then(results => {
      if (cancelled) return;
      const dimensions = new Map(results.filter(item => item.width > 0 && item.height > 0).map(item => [item.id, item]));
      if (!dimensions.size) return;
      setMaterials(current => current.map(item => {
        const found = dimensions.get(item.id);
        return found ? { ...item, width: found.width, height: found.height, aspectRatio: found.width / found.height } : item;
      }));
    });
    return () => { cancelled = true; };
  }, [materials]);

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const uploadedIds: string[] = [];
    const targetFolder = activeFolder && !['all', 'hot', 'recommend'].includes(activeFolder) ? activeFolder : 'upload';
    for (const f of Array.from(files)) {
      try {
        const [dataBase64, media] = await Promise.all([fileToDataUrl(f), probeMedia(f)]);
        const { material } = await studioApi.uploadMaterial({
          name: f.name, folder: targetFolder, type: mediaType(f), duration: media.duration, width: media.width, height: media.height, dataBase64, mimeType: f.type,
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
        width: source.width,
        height: source.height,
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
    if (step === 'bgm') void refreshBgm();
  }, [step]);
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
    setAlignedCuesByLang({});
    setUploadedVoiceName('');
    setTtsNotice('');
    setTtsPlaying(false);
    if (ttsAudioRef.current) ttsAudioRef.current.pause();
  };

  const handleVoiceoverUpload = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setTtsLoading(true);
    setTtsLoadingScope('upload');
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
      const audioDuration = r.duration || duration;
      const transcriptHint = stripVoiceoverTimestamps(activeSpokenScript);
      if (audioDuration > 0) {
        setTtsNotice('口播已上传，正在识别语音并生成字幕时间轴…');
        const transcription = await studioApi.transcribeVoiceover({
          url: r.url,
          duration: audioDuration,
          language: activeVoiceLang || lang,
          transcriptHint,
        });
        if (transcription.ok && transcription.text && transcription.cues?.length) {
          const code = activeVoiceLang || 'zh';
          setVoiceoverLines(transcription.text);
          setVoiceDrafts(current => ({ ...current, [code]: transcription.text }));
          setAlignedCuesByLang(current => ({ ...current, [code]: transcription.cues }));
          setVoiceoverAudios({ [code]: { url: r.url, duration: audioDuration, cues: transcription.cues, text: transcription.text, alignmentSource: transcription.source } });
          setTtsNotice(transcription.source === 'audio_ai'
            ? '已根据上传音频自动识别口播，并生成逐句/逐词字幕时间轴。'
            : '已生成字幕时间轴；当前使用脚本比例对齐，建议播放后人工确认。');
        } else {
          setTtsNotice(`音频已上传，但自动识别字幕失败：${transcription.error || '未识别到清晰人声'}`);
        }
      }
    } catch (err: any) {
      alert(err?.message || '口播音频上传失败，请稍后重试。');
    } finally {
      setTtsLoading(false);
      setTtsLoadingScope(null);
    }
  };

  const handleVoiceSampleUpload = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setTtsLoading(true);
    setTtsLoadingScope('upload');
    try {
      const [dataBase64, duration] = await Promise.all([fileToDataUrl(f), probeAudioDuration(f)]);
      const r = await studioApi.uploadVoiceSample({ name: f.name, dataBase64, mimeType: f.type, duration });
      if (!r.ok || !r.voiceId) throw new Error(r.error || '真人音色录入失败');
      setVoice(r.voiceId);
      setCustomVoiceId(r.voiceId);
      setCustomVoiceName(r.name || f.name);
      setCustomVoiceUrl(r.url || '');
      setCustomVoices(current => [{ voiceId: r.voiceId!, name: r.name || f.name, url: r.url || '', duration: r.duration || duration, createdAt: new Date().toISOString() }, ...current.filter(item => item.voiceId !== r.voiceId)]);
      setVoiceCandidates(current => current.includes(r.voiceId!) ? current : [...current, r.voiceId!]);
      setVoiceoverMode('ai');
      setVoiceoverUrl(null);
      setVoiceoverAudios({});
      setAudioCapabilities(current => current ? {
        ...current,
        customVoice: { ...current.customVoice, synthesis: Boolean(r.synthesisReady), message: r.warning || (r.synthesisReady ? `真人音色合成可用（${r.engine === 'xtts' ? 'XTTS/Coqui' : 'MiniMax'}）` : current.customVoice.message) },
      } : current);
      setTtsNotice(r.synthesisReady
        ? `已录入真人音色，可通过 ${r.engine === 'xtts' ? 'XTTS/Coqui' : 'MiniMax'} 生成配音。`
        : `声音样本已保存，但暂不能合成：${r.warning || '服务器未配置真人音色克隆引擎。'}`);
    } catch (err: any) {
      alert(err?.message || '真人音色录入失败，请检查音频文件后重试。');
    } finally {
      setTtsLoading(false);
      setTtsLoadingScope(null);
    }
  };

  const openVoiceSamplePicker = () => {
    voiceSampleInputRef.current?.click();
  };

  const diagnoseMinimax = async () => {
    setMinimaxDiagnosing(true);
    setMinimaxDiagnostic('正在检查 MiniMax Key、网络和音色查询权限…');
    try {
      const result = await studioApi.diagnoseMinimax();
      setMinimaxDiagnostic(result.ok
        ? `${result.message || 'MiniMax 连接正常'}${result.latencyMs != null ? `（${result.latencyMs}ms）` : ''}`
        : `诊断失败：${result.error || '未知错误'}`);
    } finally {
      setMinimaxDiagnosing(false);
    }
  };

  const genTts = async (onlyLanguage?: string) => {
    setTtsLoading(true);
    setTtsLoadingScope(onlyLanguage ? 'single' : 'all');
    const detectedSourceLanguage = detectScriptLanguageCode(voiceoverLines || extractVoiceoverText(script));
    const requestedLangs = onlyLanguage ? [onlyLanguage] : (voiceLangs.length ? voiceLangs : [detectedSourceLanguage]);
    setTtsNotice(`正在生成 ${requestedLangs.length} 个语种配音...`);
    if (!onlyLanguage) {
      setVoiceoverUrl(null);
      setVoiceoverAudios({});
      setAlignedCuesByLang({});
    }
    try {
      const langs = requestedLangs;
      const base = voiceDrafts[activeVoiceLang] || voiceoverLines || extractVoiceoverText(script) || script;
      const sourceLanguage = detectScriptLanguageCode(base);
      const drafts: Record<string, string> = { ...voiceDrafts, [sourceLanguage]: voiceDrafts[sourceLanguage] || base };
      const missingTranslationLangs: string[] = [];
      const targetsToTranslate: string[] = [];
      for (const code of langs) {
        if (drafts[code]?.trim()) continue;
        if (code === sourceLanguage) {
          drafts[sourceLanguage] = base;
        } else {
          targetsToTranslate.push(code);
        }
      }
      if (targetsToTranslate.length) {
        const translated = await studioApi.translateBatch({ text: normalizeScriptTimestamps(base), targets: targetsToTranslate, source: sourceLanguage })
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

      const audios: Record<string, { url: string; duration: number; cues?: SubCue[]; text?: string; alignmentSource?: string; customVoiceStatus?: 'activated' }> = onlyLanguage ? { ...voiceoverAudios } : {};
      const aligned: Record<string, SubCue[]> = onlyLanguage ? { ...alignedCuesByLang } : {};
      const failures: string[] = [];
      const availableLangs = langs.filter(code => drafts[code]?.trim());
      await Promise.all(availableLangs.map(async code => {
          const text = drafts[code];
          const settings = ttsLanguageSettings[code] || DEFAULT_TTS_SETTINGS;
          const inheritReferenceRhythm = mode === 'clone' && useReferenceVoiceStyle && referenceVoice.available;
          const style: Partial<TtsStyleOptions> = {
            preset: settings.preset,
            emotion: inheritReferenceRhythm
              ? `${referenceVoice.emotion}；沿用对标口播的信息密度、能量推进和自然停顿，不复制原声音身份`
              : settings.emotion,
            emotionIntensity: inheritReferenceRhythm ? 78 : settings.emotionIntensity,
            speed: inheritReferenceRhythm ? referenceVoice.baseSpeed : settings.speed,
            targetDuration: (mode === 'material' || mode === 'clone') && storyboardTimelineEnd > 0 ? storyboardTimelineEnd : duration,
            pauseStyle: inheritReferenceRhythm ? 'natural' : settings.pauseStyle,
            pronunciations: parsePronunciationRules(settings.pronunciationText),
          };
          const r = await studioApi.tts({ text: stripVoiceoverTimestamps(text), voice, language: code, style });
          if (r.ok && r.url) {
            audios[code] = { url: r.url, duration: r.duration ?? 0, cues: r.cues, text: r.text, alignmentSource: r.alignmentSource, customVoiceStatus: r.customVoiceStatus };
            if (r.cues?.length) aligned[code] = r.cues;
            if (r.text?.trim()) drafts[code] = r.text;
          } else {
            const label = LANGS.find(item => item.code === code)?.label || code;
            failures.push(`${label}：${r.error || (r.source === 'local' ? '后端连接失败或额度不可用' : '未返回音频')}`);
          }
      }));
      await Promise.all(Object.entries(audios).filter(([code]) => availableLangs.includes(code)).map(async ([code, audio]) => {
        const text = audio.text || drafts[code] || '';
        if (audio.alignmentSource === 'minimax_native' && audio.cues?.length) {
          aligned[code] = audio.cues;
          return;
        }
        if (!text || !audio.url || !audio.duration) return;
        const result = await studioApi.alignTts({ text, url: audio.url, duration: audio.duration });
        if (result.ok && result.cues?.length) {
          audio.cues = result.cues;
          audio.alignmentSource = result.source;
          aligned[code] = result.cues;
        } else if (audio.cues?.length) {
          aligned[code] = audio.cues;
        }
      }));
      const activeCode = langs.includes(activeVoiceLang) ? activeVoiceLang : langs[0] || 'zh';
      const activeAudio = audios[activeCode] || Object.values(audios)[0];
      if (!activeAudio) {
        throw new Error(failures[0] || '没有生成可用配音，请检查 TTS Key 或试用额度。');
      }
      setVoiceoverMode('ai');
      setVoiceoverAudios(audios);
      setAlignedCuesByLang(aligned);
      setVoiceDrafts({ ...drafts });
      setVoiceDraftStaleLangs(current => current.filter(code => !availableLangs.includes(code)));
      setActiveVoiceLang(activeCode);
      setLang(activeCode);
      setVoiceoverUrl(activeAudio.url);
      setVoiceoverDur(activeAudio.duration);
      setUploadedVoiceName('');
      setSubtitlesOn(true);
      setSubMode('target');
      setTtsNotice(failures.length || missingTranslationLangs.length
        ? `本次已生成 ${availableLangs.length - failures.length}/${langs.length} 个语种配音；${[...failures, ...missingTranslationLangs.map(item => {
          const [code, reason] = item.split(':');
          return `${LANGS.find(langItem => langItem.code === code)?.label || code}：翻译失败，未生成配音（${reason || '未知原因'}）`;
        })].join('；')}`
        : voice.startsWith('custom:') && Object.values(audios).some(item => item.customVoiceStatus === 'activated')
          ? `已生成 ${langs.length} 个语种配音，真人音色已通过正式 TTS 激活并保存，同时按真实音频对齐字幕。`
          : `已生成 ${langs.length} 个语种配音，并按真实音频对齐字幕。`);
    } catch (err: any) {
      setTtsNotice(err?.message || '配音生成失败，请稍后重试。');
    } finally {
      setTtsLoading(false);
      setTtsLoadingScope(null);
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
      setTtsCurrentTime(el.currentTime);
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
    void playAudioWithAuthenticatedFallback(el, audio.url, voiceVol / 100)
      .then(() => setTtsPlaying(true))
      .catch((error: unknown) => {
        setTtsPlaying(false);
        const message = error instanceof Error ? error.message : String(error || '浏览器未能加载音频');
        setTtsNotice(`配音播放失败：${message}。请重新生成配音后再试。`);
      });
  };
  const switchVoicePreviewLanguage = (code: string) => {
    if (!code || code === activeVoiceLang) return;
    const audio = voiceoverAudios[code];
    const el = ttsAudioRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    setTtsPlaying(false);
    setVoicePreviewIdx(null);
    setActiveVoiceLang(code);
    setLang(code);
    if (voiceoverMode === 'ai') {
      setVoiceoverUrl(audio?.url || null);
      setVoiceoverDur(audio?.duration || 0);
    }
    setSubPreviewIdx(0);
    setTtsNotice(audio?.url
      ? `已切换到${langZh(code)}试听。`
      : `${langZh(code)}还没有可试听配音，请先生成当前语言或生成全部语种。`);
  };
	  const toggleTts = () => {
	    const el = ttsAudioRef.current;
    const activeAudio = voiceoverMode === 'ai' ? voiceoverAudios[activeVoiceLang] : undefined;
    const currentVoiceUrl = activeAudio?.url || voiceoverUrl || '';
	    if (!el || !currentVoiceUrl) {
      setTtsNotice('暂时无法试听：当前语种还没有可用配音，请先生成或上传音频。');
      return;
    }
    if (ttsPlaying) {
      el.pause();
      setTtsPlaying(false);
      setTtsNotice('配音试听已暂停。');
      return;
    }
    void playAudioWithAuthenticatedFallback(el, currentVoiceUrl, voiceVol / 100).then(() => {
      setTtsPlaying(true);
      setTtsNotice('正在试听当前语种配音。');
    }).catch((error: unknown) => {
      setTtsPlaying(false);
      const message = error instanceof Error ? error.message : String(error || '浏览器未能加载音频');
      setTtsNotice(`配音播放失败：${message}。请重新生成配音后再试。`);
    });
  };
  const startVoiceAssemblyPreview = () => {
    const activeAudio = voiceoverMode === 'ai' ? voiceoverAudios[activeVoiceLang] : undefined;
    const currentVoiceUrl = activeAudio?.url || voiceoverUrl || '';
    const currentVoiceDuration = activeAudio?.duration || voiceoverDur;
    if (!currentVoiceUrl || currentVoiceDuration <= 0) {
      setTtsNotice('暂时无法预览：当前音频时长为 0 秒，请重新上传或重新生成配音。');
      return;
    }
    if (!cues.length) {
      setTtsNotice('暂时无法预览：当前没有字幕，请先生成配音并完成字幕对齐。');
      return;
    }
    setPreviewNote(false);
    setSubtitlesOn(true);
    setVoicePreviewIdx(0);
    const el = ttsAudioRef.current;
    if (el) {
      // 必须在点击事件的用户手势中直接 play，不能等 React effect，否则浏览器会按自动播放拦截。
      void playAudioWithAuthenticatedFallback(el, currentVoiceUrl, voiceVol / 100).then(() => {
        setTtsPlaying(true);
        setTtsNotice('配音预览播放中。');
      }).catch((error: unknown) => {
        setVoicePreviewIdx(null);
        setTtsPlaying(false);
        const message = error instanceof Error ? error.message : String(error || '浏览器未能加载音频');
        setTtsNotice(`配音播放失败：${message}。请重新生成配音后再试。`);
      });
    }
  };
  const stopVoiceAssemblyPreview = () => {
    setVoicePreviewIdx(null);
    if (ttsAudioRef.current) ttsAudioRef.current.pause();
    setTtsPlaying(false);
  };
  const applyTtsPreset = (presetId: TtsStyleOptions['preset']) => {
    const preset = TTS_PRESETS.find(item => item.id === presetId) || TTS_PRESETS[1];
    setTtsPreset(preset.id);
    setTtsEmotion(preset.emotion);
    setTtsEmotionIntensity(preset.intensity);
    setTtsSpeed(preset.speed);
    setUseReferenceVoiceStyle(false);
    setVoiceoverUrl(null);
    setVoiceoverAudios({});
    setAlignedCuesByLang({});
    setTtsNotice('表达方式已调整，请重新生成配音。');
  };
  const toggleReferenceVoiceStyle = () => {
    const enabled = !useReferenceVoiceStyle;
    setUseReferenceVoiceStyle(enabled);
    setVoiceoverUrl(null);
    setVoiceoverAudios({});
    setAlignedCuesByLang({});
    setTtsNotice(enabled
      ? '生成试听配音时将自动沿用对标口播的情绪、信息密度和停顿节奏。'
      : '已关闭对标口播节奏，将使用当前手动配音参数。');
  };
  const patchAlignedCue = (index: number, patch: Partial<SubCue>) => {
    setAlignedCuesByLang(current => {
      const base = current[activeVoiceLang]?.length ? current[activeVoiceLang] : cues;
      const next = base.map((cue, cueIndex) => cueIndex === index ? { ...cue, ...patch, words: patch.text != null ? undefined : cue.words } : cue);
      return { ...current, [activeVoiceLang]: next };
    });
  };
  // 换音色 / 改脚本类型后，旧配音失效
  const pickVoice = (id: string) => { setVoice(id); setVoiceCandidates(current => current.includes(id) ? current : [...current, id]); setVoiceoverUrl(null); setVoiceoverAudios({}); setAlignedCuesByLang({}); setTtsNotice(''); setTtsPlaying(false); };
  // 离开脚本步时停止试听
  useEffect(() => {
    if (step !== 'script' && ttsAudioRef.current) { ttsAudioRef.current.pause(); setTtsPlaying(false); }
    if (step !== 'script') setVoicePreviewIdx(null);
  }, [step]);

  /* ── 草稿 / 作品 ─────────────────────────────────────────────────────── */
  const assembliesForSave = storyboardAssemblies.map(item => item.id === activeAssemblyId
    ? { ...item, name: assemblyName, assignments: storyboardAssignments, sourcePlans: storyboardSourcePlans, selected }
    : item);
  const materialSnapshotIds = new Set<string>([
    hookMaterialId,
    cover,
    ...selected,
    ...scriptRecommendedMaterialIds,
    ...Object.values(storyboardAssignments),
    ...assembliesForSave.flatMap(item => [
      ...(item.selected || []),
      ...Object.values(item.assignments || {}),
      ...Object.values(item.sourcePlans || {}).flatMap(plan => [plan.referenceClipId, plan.generatedClipId]),
    ]),
  ].filter((id): id is string => Boolean(id)));
  const kickoffSnapshot = kickoffClipSnapshot(videoKickoff);
  if (kickoffSnapshot) materialSnapshotIds.add(kickoffSnapshot.id);
  const materialSnapshots = [
    ...materials.filter(item => materialSnapshotIds.has(item.id)),
    ...(kickoffSnapshot && !materials.some(item => item.id === kickoffSnapshot.id) ? [kickoffSnapshot] : []),
  ].map(item => ({
    id: item.id,
    name: item.name,
    folder: item.folder,
    type: item.type,
    duration: item.duration,
    width: item.width,
    height: item.height,
    aspectRatio: item.aspectRatio,
    size: item.size,
    url: item.url,
    poster: item.poster,
    scope: item.scope,
    usage: item.usage,
    sourceType: 'project-snapshot',
    industry: item.industry,
    shotFunction: item.shotFunction,
    applicability: item.applicability,
    tags: item.tags,
    segmentAnalysisStatus: item.segmentAnalysisStatus,
    segments: item.segments,
  }));
  const collectSpec = () => ({
    mode, contentMode, posterStyle, platform, ratio, duration, lang, provider,
    videoKickoff,
    productInfo, productSelectMode, selectedProductIds, audience, primaryCta, cooperationRoute, sellingPoints, tone,
    videoThemeId, themePainPoint, themeConversionGoal,
    selected, scriptRecommendedMaterialIds, storyboardAssignments, storyboardSourcePlans, assemblyName, hookMaterialId, materialSnapshots,
    storyboardAssemblies: assembliesForSave, activeAssemblyId, script, scriptType, modeScripts, activeModeScriptId, voice, voiceCandidates,
    bgm, bgmCandidates, platformBgms, assemblyBgms, materialVersionBgms, soundCandidatesPerContent, bgmVol, voiceVol, cover, coverTitle, coverStyle, materialVersionCovers, account, caption,
    subtitlesOn, subMode, clipEdits, voiceoverMode, uploadedVoiceName, customVoiceId, customVoiceName, customVoiceUrl,
    ttsPreset, ttsEmotion, ttsEmotionIntensity, ttsSpeed, ttsPauseStyle, ttsPronunciationText, ttsLanguageSettings, voiceLangs, activeVoiceLang, voiceDrafts, voiceDraftStaleLangs,
    voiceoverUrl, voiceoverDur, voiceoverAudios, languageRenderOutputs, languageRenderVersions, referenceVoiceStrength, useReferenceVoiceStyle, alignedCuesByLang,
    storyboardVideoVersions, productVideoVersions,
    variationStrategy, variationPeople, variationScenes, variationLanguages, variationHooks, variationMax,
    posterDraft, posterJsonText, posterImageUrl,
  });

  const applySpec = (s: Record<string, unknown>) => {
    const restoredVoiceDrafts = s.voiceDrafts && typeof s.voiceDrafts === 'object'
      ? s.voiceDrafts as Record<string, string>
      : {};
    const restoredVoiceoverAudios = s.voiceoverAudios && typeof s.voiceoverAudios === 'object'
      ? s.voiceoverAudios as typeof voiceoverAudios
      : {};
    const restoredAlignedCues = s.alignedCuesByLang && typeof s.alignedCuesByLang === 'object'
      ? s.alignedCuesByLang as Record<string, SubCue[]>
      : {};
    const savedVoiceLangs = Array.isArray(s.voiceLangs)
      ? s.voiceLangs.filter((code): code is string => typeof code === 'string' && Boolean(code.trim()))
      : [];
    const restoredLanguageCandidates = [...new Set([
      ...savedVoiceLangs,
      ...Object.keys(restoredVoiceDrafts),
      ...Object.keys(restoredVoiceoverAudios),
      ...Object.keys(restoredAlignedCues),
    ])];
    const restoredVoiceLangs = enterpriseVoiceLangs.length ? enterpriseVoiceLangs : restoredLanguageCandidates;
    const nextVoiceDrafts = enterpriseVoiceLangs.length
      ? filterRecordByLanguage(restoredVoiceDrafts, enterpriseVoiceLangs)
      : restoredVoiceDrafts;
    const nextVoiceoverAudios = enterpriseVoiceLangs.length
      ? filterRecordByLanguage(restoredVoiceoverAudios, enterpriseVoiceLangs)
      : restoredVoiceoverAudios;
    const nextAlignedCues = enterpriseVoiceLangs.length
      ? filterRecordByLanguage(restoredAlignedCues, enterpriseVoiceLangs)
      : restoredAlignedCues;
    const savedActiveVoiceLang = typeof s.activeVoiceLang === 'string' ? s.activeVoiceLang : '';
    const restoredActiveVoiceLang = restoredVoiceLangs.includes(savedActiveVoiceLang)
      ? savedActiveVoiceLang
      : restoredVoiceLangs.find(code => Boolean(nextVoiceoverAudios[code]?.url)) || restoredVoiceLangs[0] || '';

    setVoiceLangs(restoredVoiceLangs);
    if (restoredActiveVoiceLang) {
      setActiveVoiceLang(restoredActiveVoiceLang);
      setLang(restoredActiveVoiceLang);
    }
    setVoiceDrafts(nextVoiceDrafts);
    setVoiceoverAudios(nextVoiceoverAudios);
    setAlignedCuesByLang(nextAlignedCues);
    const restoredActiveAudio = restoredActiveVoiceLang ? nextVoiceoverAudios[restoredActiveVoiceLang] : undefined;
    const restoredVoiceoverUrl = restoredActiveAudio?.url || (!enterpriseVoiceLangs.length && typeof s.voiceoverUrl === 'string' ? s.voiceoverUrl : null);
    const restoredVoiceoverDur = restoredActiveAudio?.duration || (!enterpriseVoiceLangs.length && typeof s.voiceoverDur === 'number' ? s.voiceoverDur : 0);
    setVoiceoverUrl(restoredVoiceoverUrl);
    setVoiceoverDur(restoredVoiceoverDur);
    const droppedLanguageCount = enterpriseVoiceLangs.length
      ? restoredLanguageCandidates.filter(code => !enterpriseVoiceLangs.includes(code)).length
      : 0;
    setVoiceDraftNotice(Object.keys(nextVoiceDrafts).length
      ? `已按企业中心语言恢复 ${Object.keys(nextVoiceDrafts).length} 个语种字幕${droppedLanguageCount ? `，已忽略 ${droppedLanguageCount} 个历史语言。` : '。'}`
      : '');
    setTtsNotice(Object.keys(nextVoiceoverAudios).length
      ? `已按企业中心语言恢复 ${Object.keys(nextVoiceoverAudios).length} 个语种配音。`
      : '');
    setVoiceDraftLoading(false);
    setTtsLoading(false);
    setTtsLoadingScope(null);
    const restoredVideoKickoff = s.videoKickoff && typeof s.videoKickoff === 'object'
      ? s.videoKickoff as VideoKickoff
      : null;
    const restoredMaterialSnapshots = [
      ...(Array.isArray(s.materialSnapshots) ? s.materialSnapshots.map(normalizeClipSnapshot).filter((item): item is Clip => Boolean(item)).map(item => ({ ...item, sourceType: 'project-snapshot' })) : []),
      kickoffClipSnapshot(restoredVideoKickoff),
    ].filter((item): item is Clip => Boolean(item));
    if (restoredMaterialSnapshots.length) {
      setMaterials(current => mergeClipLists(current, restoredMaterialSnapshots));
    }
    if (s.mode) setMode(s.mode as typeof mode);
    if (restoredVideoKickoff) setVideoKickoff(restoredVideoKickoff);
    if (s.contentMode === 'video' || s.contentMode === 'poster') setContentMode(s.contentMode);
    if (typeof s.posterStyle === 'string' && POSTER_STYLES.some(item => item.id === s.posterStyle)) {
      setPosterStyle(s.posterStyle as typeof posterStyle);
    }
    if (s.platform) setPlatform(s.platform as string);
    if (s.ratio) setRatio(s.ratio as string);
    if (typeof s.duration === 'number') setDuration(s.duration);
    // 语言由企业中心统一提供；旧草稿中的历史语言配置不得覆盖企业设置。
    if (s.provider === 'gemini' || s.provider === 'qwen') setProvider(s.provider);
    if (typeof s.productInfo === 'string') setProductInfo(s.productInfo);
    if (s.productSelectMode === 'single' || s.productSelectMode === 'multi') setProductSelectMode('multi');
    if (Array.isArray(s.selectedProductIds)) setSelectedProductIds(s.selectedProductIds as string[]);
    if (typeof s.audience === 'string') setAudience(s.audience);
    if (typeof s.primaryCta === 'string') setPrimaryCta(s.primaryCta);
    if (typeof s.cooperationRoute === 'string') setCooperationRoute(s.cooperationRoute);
    if (typeof s.sellingPoints === 'string') setSellingPoints(s.sellingPoints);
    if (typeof s.tone === 'string') setTone(s.tone);
    if (typeof s.videoThemeId === 'string' && VIDEO_THEMES.some(item => item.id === s.videoThemeId)) setVideoThemeId(s.videoThemeId as VideoThemeId);
    if (typeof s.themePainPoint === 'string') setThemePainPoint(s.themePainPoint);
    setThemeConversionGoal(typeof s.themeConversionGoal === 'string' && s.themeConversionGoal.trim()
      ? s.themeConversionGoal
      : DEFAULT_VIDEO_CONVERSION_GOAL);
    if (s.variationStrategy === 'remix' || s.variationStrategy === 'recreate' || s.variationStrategy === 'hybrid') setVariationStrategy(s.variationStrategy);
    if (typeof s.hookMaterialId === 'string') setHookMaterialId(s.hookMaterialId);
    if (Array.isArray(s.selected)) setSelected(s.selected as string[]);
    if (Array.isArray(s.scriptRecommendedMaterialIds)) setScriptRecommendedMaterialIds(s.scriptRecommendedMaterialIds as string[]);
    if (s.storyboardAssignments && typeof s.storyboardAssignments === 'object') setStoryboardAssignments(s.storyboardAssignments as Record<string, string>);
    if (s.storyboardSourcePlans && typeof s.storyboardSourcePlans === 'object') setStoryboardSourcePlans(s.storyboardSourcePlans as Record<string, StoryboardSourcePlan>);
    if (typeof s.assemblyName === 'string') setAssemblyName(s.assemblyName);
    if (Array.isArray(s.storyboardAssemblies) && s.storyboardAssemblies.length) {
      const restored = s.storyboardAssemblies as StoryboardAssembly[];
      const restoredActiveId = typeof s.activeAssemblyId === 'string' && restored.some(item => item.id === s.activeAssemblyId)
        ? s.activeAssemblyId
        : restored[0].id;
      const restoredActive = restored.find(item => item.id === restoredActiveId) || restored[0];
      setStoryboardAssemblies(restored);
      setActiveAssemblyId(restoredActiveId);
      setAssemblyName(restoredActive.name);
      setStoryboardAssignments(restoredActive.assignments || {});
      setStoryboardSourcePlans(restoredActive.sourcePlans || {});
      setSelected(restoredActive.selected || []);
    } else {
      const legacyName = typeof s.assemblyName === 'string' ? s.assemblyName : '视频1';
      setStoryboardAssemblies([{
        id: 'video-1', name: legacyName,
        assignments: s.storyboardAssignments as Record<string, string> || {},
        sourcePlans: s.storyboardSourcePlans as Record<string, StoryboardSourcePlan> || {},
        selected: Array.isArray(s.selected) ? s.selected as string[] : [],
      }]);
      setActiveAssemblyId('video-1');
    }
    if (typeof s.script === 'string') setScript(s.script);
    if (s.scriptType) setScriptType(s.scriptType as typeof scriptType);
    if (Array.isArray(s.modeScripts)) setModeScripts(s.modeScripts as ModeScriptOutput[]);
    if (typeof s.activeModeScriptId === 'string') setActiveModeScriptId(s.activeModeScriptId);
    if (s.voice) setVoice(s.voice as string);
    if (Array.isArray(s.voiceCandidates)) setVoiceCandidates(s.voiceCandidates as string[]);
    if (s.voiceoverMode === 'none' || s.voiceoverMode === 'ai' || s.voiceoverMode === 'upload') setVoiceoverMode(s.voiceoverMode);
    if (typeof s.uploadedVoiceName === 'string') setUploadedVoiceName(s.uploadedVoiceName);
    if (typeof s.customVoiceId === 'string') setCustomVoiceId(s.customVoiceId);
    if (typeof s.customVoiceName === 'string') setCustomVoiceName(s.customVoiceName);
    if (typeof s.customVoiceUrl === 'string') setCustomVoiceUrl(s.customVoiceUrl);
    if (s.ttsLanguageSettings && typeof s.ttsLanguageSettings === 'object') setTtsLanguageSettings(s.ttsLanguageSettings as Record<string, LanguageTtsSettings>);
    if (Array.isArray(s.voiceDraftStaleLangs)) setVoiceDraftStaleLangs(s.voiceDraftStaleLangs as string[]);
    if (s.languageRenderOutputs && typeof s.languageRenderOutputs === 'object') setLanguageRenderOutputs(s.languageRenderOutputs as typeof languageRenderOutputs);
    if (s.languageRenderVersions && typeof s.languageRenderVersions === 'object') setLanguageRenderVersions(s.languageRenderVersions as typeof languageRenderVersions);
    if (s.storyboardVideoVersions && typeof s.storyboardVideoVersions === 'object') setStoryboardVideoVersions(s.storyboardVideoVersions as typeof storyboardVideoVersions);
    if (Array.isArray(s.productVideoVersions)) setProductVideoVersions(s.productVideoVersions as VideoGenerationVersion[]);
    if (typeof s.ttsPreset === 'string' && TTS_PRESETS.some(item => item.id === s.ttsPreset)) setTtsPreset(s.ttsPreset as TtsStyleOptions['preset']);
    if (typeof s.ttsEmotion === 'string') setTtsEmotion(s.ttsEmotion);
    if (typeof s.ttsEmotionIntensity === 'number') setTtsEmotionIntensity(s.ttsEmotionIntensity);
    if (typeof s.ttsSpeed === 'number') setTtsSpeed(s.ttsSpeed);
    if (s.ttsPauseStyle === 'few' || s.ttsPauseStyle === 'natural' || s.ttsPauseStyle === 'dramatic') setTtsPauseStyle(s.ttsPauseStyle);
    if (typeof s.ttsPronunciationText === 'string') setTtsPronunciationText(s.ttsPronunciationText);
    if (s.referenceVoiceStrength === 'light' || s.referenceVoiceStrength === 'balanced' || s.referenceVoiceStrength === 'strong') setReferenceVoiceStrength(s.referenceVoiceStrength);
    if (typeof s.useReferenceVoiceStyle === 'boolean') setUseReferenceVoiceStyle(s.useReferenceVoiceStyle);
    if (s.bgm) setBgm(s.bgm as string);
    if (Array.isArray(s.bgmCandidates)) setBgmCandidates(s.bgmCandidates as string[]);
    if (s.platformBgms && typeof s.platformBgms === 'object') setPlatformBgms(s.platformBgms as Record<string, string>);
    if (s.assemblyBgms && typeof s.assemblyBgms === 'object') setAssemblyBgms(s.assemblyBgms as Record<string, string>);
    if (s.materialVersionBgms && typeof s.materialVersionBgms === 'object') setMaterialVersionBgms(s.materialVersionBgms as Record<string, string>);
    if (s.soundCandidatesPerContent === 1 || s.soundCandidatesPerContent === 2) setSoundCandidatesPerContent(s.soundCandidatesPerContent);
    if (typeof s.bgmVol === 'number') setBgmVol(s.bgmVol);
    if (typeof s.voiceVol === 'number') setVoiceVol(s.voiceVol);
    if (s.cover && s.cover !== 'gradient') setCover(s.cover as string);
    if (typeof s.coverTitle === 'string') setCoverTitle(s.coverTitle);
    if (s.coverStyle) setCoverStyle(s.coverStyle as CoverStyle);
    if (s.materialVersionCovers && typeof s.materialVersionCovers === 'object') setMaterialVersionCovers(s.materialVersionCovers as Record<string, CoverVersionConfig>);
    if (s.account !== undefined) setAccount(s.account as string | null);
    if (typeof s.caption === 'string') setCaption(s.caption);
    if (s.posterDraft && typeof s.posterDraft === 'object') setPosterDraft(s.posterDraft as FbPosterResult);
    if (typeof s.posterJsonText === 'string') setPosterJsonText(s.posterJsonText);
    if (typeof s.posterImageUrl === 'string') setPosterImageUrl(s.posterImageUrl);
    if (typeof s.subtitlesOn === 'boolean') setSubtitlesOn(s.subtitlesOn);
    if (s.subMode === 'target' || s.subMode === 'bilingual') setSubMode(s.subMode);
    if (s.clipEdits && typeof s.clipEdits === 'object') setClipEdits(s.clipEdits as Record<string, ClipEdit>);
    if (typeof s.variationPeople === 'string') setVariationPeople(s.variationPeople);
    if (typeof s.variationScenes === 'string') setVariationScenes(s.variationScenes);
    if (typeof s.variationLanguages === 'string') setVariationLanguages(s.variationLanguages);
    if (typeof s.variationHooks === 'string') setVariationHooks(s.variationHooks);
    if (typeof s.variationMax === 'number') setVariationMax(s.variationMax);
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

  const saveProject = async (
    status: 'draft' | 'published' | 'template' = 'draft',
    options: { silent?: boolean } = {},
  ) => {
    const silent = options.silent === true;
    if (silent && (sourceDraftCheckPending || existingSourceDraftPrompt)) return;
    if (voiceDraftLoading || ttsLoading) {
      if (!silent) alert('多语字幕或配音仍在生成，请等待完成后再保存草稿。');
      return;
    }
    if (silent && autosaveInFlightRef.current) return;
    if (silent) autosaveInFlightRef.current = true;
    else setSavingProj(true);
    try {
      const { project } = await studioApi.saveProject({
        id: status === 'template' ? undefined : projectId ?? undefined,
        title: projectTitle.trim() || '未命名草稿',
        status,
        spec: collectSpec(),
        thumbSeed: cover,
      });
      if (project?.id && status !== 'template') setProjectId(project.id);
      if (!silent) {
        completeDemoStep('traffic');
        setSavedTick(true);
        setTimeout(() => setSavedTick(false), 1800);
      }
    } catch (error) {
      if (!silent) throw error;
      console.warn('[AiCreateStudio] autosave failed', error);
    } finally {
      if (silent) autosaveInFlightRef.current = false;
      else setSavingProj(false);
    }
  };

  autosaveSnapshotRef.current = () => saveProject('draft', { silent: true });

  useEffect(() => {
    const timer = window.setInterval(() => {
      void autosaveSnapshotRef.current();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const openProjects = async () => {
    setShowProjects(true);
    const [nextProjects, nextBatches] = await Promise.all([studioApi.listProjects(), studioApi.listVariationBatches()]);
    setProjects(nextProjects); setVariationBatches(nextBatches);
  };
  const reviewVariationItem = async (batchId: string, itemId: string, status: 'approved' | 'rejected') => {
    await studioApi.updateVariationItem(batchId, itemId, { status });
    setVariationBatches(await studioApi.listVariationBatches());
  };
  const reuseVariationBatch = async (batch: VariationBatch) => {
    const inferredDimensions = ['product', 'person', 'scene', 'language', 'hook'].reduce<Record<string, string[]>>((result, key) => {
      result[key] = [...new Set(batch.items.map(item => item.variables[key]).filter(Boolean))];
      return result;
    }, {});
    const dimensions = batch.plan?.dimensions || inferredDimensions;
    const nextStrategy = ['remix', 'recreate', 'hybrid'].includes(String(batch.plan?.strategy)) ? batch.plan!.strategy as VariationStrategy : 'hybrid';
    const nextPlatform = String(batch.plan?.platform || platform);
    const nextRatio = String(batch.plan?.ratio || ratio);
    const nextDuration = Math.max(1, Number(batch.plan?.duration) || Math.round(batch.estimatedCostCny / Math.max(1, batch.items.length) / 1.5) || duration);
    const nextMax = Math.max(1, Number(batch.plan?.maxItems) || batch.items.length || 20);
    const nextProductIds = (dimensions.product || []).filter(id => productOptions.some(option => option.id === id));
    const nextTitle = `${batch.title.replace(/\s*·\s*复用\s*\d*$/, '')} · 复用`;
    const cleanSpec: Record<string, unknown> = {
      mode: 'clone', contentMode: 'video', platform: nextPlatform, ratio: nextRatio, duration: nextDuration,
      productInfo: batch.plan?.productInfo || '', productSelectMode: batch.plan?.productSelectMode || 'single',
      audience: batch.plan?.audience || '', sellingPoints: batch.plan?.sellingPoints || '', tone: batch.plan?.tone || '高转化 · 口语化',
      lang: batch.plan?.language || 'zh', provider: batch.plan?.provider || 'gemini',
      variationStrategy: nextStrategy,
      variationPeople: (dimensions.person || ['原人物']).join('，'),
      variationScenes: (dimensions.scene || ['原场景']).join('，'),
      variationLanguages: (dimensions.language || ['中文']).join('，'),
      variationHooks: (dimensions.hook || ['原钩子']).join('，'),
      variationMax: nextMax, selectedProductIds: nextProductIds,
      script: '', selected: [], scriptRecommendedMaterialIds: [], storyboardAssignments: {}, storyboardSourcePlans: {},
      voiceDrafts: {}, voiceoverAudios: {}, alignedCuesByLang: {}, languageRenderOutputs: {}, clipEdits: {},
      bgm: '', cover: '', coverTitle: '', caption: '', posterJsonText: '', posterImageUrl: '',
    };
    const saved = await studioApi.saveProject({ title: nextTitle, status: 'draft', spec: cleanSpec });
    if (!saved.ok || !saved.project) return;
    applySpec(cleanSpec);
    setScript(''); setVoiceoverLines(''); setVoiceDrafts({}); setModeScripts([]); setActiveModeScriptId('');
    setSelected([]); setScriptRecommendedMaterialIds([]); setStoryboardAssignments({}); setStoryboardSourcePlans({});
    setVoiceoverUrl(null); setVoiceoverAudios({}); setAlignedCuesByLang({}); setLanguageRenderOutputs({});
    setBgm(''); setCover(''); setCoverUrl(null); setCaption(''); setClipEdits({}); setRendered(false); setPreviewIdx(null);
    setPosterDraft(null); setPosterJsonText(''); setPosterImageUrl('');
    setProjectId(saved.project.id); setProjectTitle(nextTitle); setProjects(current => [saved.project, ...current.filter(item => item.id !== saved.project.id)]);
    setStepIdx(0); setShowProjects(false); setSavedTick(true); window.setTimeout(() => setSavedTick(false), 1800);
  };

  const loadProject = (p: StudioProject) => {
    applySpec(p.spec);
    setProjectId(p.status === 'template' ? null : p.id);
    setProjectTitle(p.status === 'template' ? `${p.title} · 副本` : p.title);
    autoGen.current = true; // 载入已有脚本，别再自动覆盖
    setStepIdx(0);
    setShowProjects(false);
    setPublished(false);
  };

  const reuseProject = async (p: StudioProject) => {
    if (voiceDraftLoading || ttsLoading || savingProj) return;
    setSavingProj(true);
    try {
      const baseTitle = p.title.replace(/\s*·\s*复用\s*\d*$/, '').trim() || '历史作品集';
      const nextTitle = `${baseTitle} · 复用`;
      const clonedSpec = JSON.parse(JSON.stringify(p.spec || {})) as Record<string, unknown>;
      const saved = await studioApi.saveProject({
        title: nextTitle,
        status: 'draft',
        spec: clonedSpec,
        thumbSeed: p.thumbSeed,
      });
      if (!saved.ok || !saved.project) throw new Error('复用失败，请稍后重试。');
      applySpec(saved.project.spec);
      setProjectId(saved.project.id);
      setProjectTitle(saved.project.title);
      setProjects(current => [saved.project, ...current.filter(item => item.id !== saved.project.id)]);
      autoGen.current = true;
      setStepIdx(0);
      setShowProjects(false);
      setPublished(false);
      setSavedTick(true);
      window.setTimeout(() => setSavedTick(false), 1800);
    } catch (err: any) {
      alert(err?.message || '复用失败，请稍后重试。');
    } finally {
      setSavingProj(false);
    }
  };

  useEffect(() => {
    let raw = '';
    try {
      raw = localStorage.getItem(PUBLISH_RETURN_PREVIEW_KEY) || '';
      if (raw) localStorage.removeItem(PUBLISH_RETURN_PREVIEW_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    const goPreviewStep = () => {
      const previewIndex = STEPS.findIndex(item => item.id === 'preview');
      setContentMode('video');
      setShowProjects(false);
      setPublished(false);
      setPreviewIdx(null);
      window.setTimeout(() => setStepIdx(previewIndex >= 0 ? previewIndex : Math.max(0, STEPS.length - 1)), 0);
    };
    try {
      const state = JSON.parse(raw) as { at?: number; projectId?: string };
      if (!state?.at || Date.now() - state.at > PUBLISH_RETURN_PREVIEW_TTL) return;
      const targetProjectId = String(state.projectId || '').trim();
      if (!targetProjectId) {
        goPreviewStep();
        return;
      }
      void studioApi.listProjects().then(list => {
        setProjects(list);
        const project = list.find(item => item.id === targetProjectId);
        if (project) {
          applySpec(project.spec);
          setProjectId(project.status === 'template' ? null : project.id);
          setProjectTitle(project.status === 'template' ? `${project.title} · 副本` : project.title);
        }
        goPreviewStep();
        setModeNotice(project ? '已从一键发布返回素材成片预览。' : '未找到来源项目，已返回当前素材成片预览。');
      }).catch(() => {
        goPreviewStep();
        setModeNotice('项目列表读取失败，已返回当前素材成片预览。');
      });
    } catch {
      goPreviewStep();
    }
  }, []);

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
          <div className="w-full min-w-0 max-w-6xl overflow-x-hidden">
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
            <div className="mb-7 mt-4 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
              {visibleModes.map(m => {
                const on = mode === m.id;
                return (
                  <button key={m.id} onClick={() => {
                    setMode(m.id);
                    const sourceTitle = videoKickoff?.video?.title || videoKickoff?.generatedVideo?.title || '';
                    setProjectTitle(contentMode === 'video' ? draftTitleForMode(m.id, sourceTitle) : m.title);
                  }}
                    className="card min-w-0 overflow-hidden p-4 text-left transition-all"
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
            <SectionTitle title={contentMode === 'poster' ? '图文参数' : '智能素材参数'} desc="选择画面比例、产品和脚本输出方式" />
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="block min-w-[140px]">
                  <span className="mb-1.5 block text-xs font-semibold text-text-secondary">画面比例</span>
                  <span className="relative block">
                    <select
                      value={ratio}
                      onChange={event => setRatio(event.target.value)}
                      className="h-10 w-full appearance-none rounded-xl border border-border bg-surface px-3 pr-9 text-sm font-semibold text-text-primary outline-none transition focus:border-accent"
                    >
                      {visibleRatios.map(item => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  </span>
                </label>
                <div className="min-w-[260px] max-w-[420px] flex-1">
                  <span className="mb-1.5 block text-xs font-semibold text-text-secondary">产品信息（多选）</span>
                  <div ref={productSelectorRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setProductSelectorOpen(value => !value)}
                      className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 text-left text-sm font-semibold text-text-primary transition hover:border-accent/50"
                    >
                      <span className="truncate">
                        {productOptions.length === 0
                          ? '暂无可选产品'
                          : selectedProductIds.length === 0
                            ? '请选择产品'
                            : `已选 ${selectedProductIds.length} 个产品`}
                      </span>
                      <ChevronDown size={15} className={`shrink-0 text-text-muted transition ${productSelectorOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {productSelectorOpen && (
                    <div className="mt-2 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
                      <div className="space-y-2 border-b border-border bg-surface p-2.5">
                        <div className="relative">
                          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                          <input
                            value={productSearch}
                            onChange={event => setProductSearch(event.target.value)}
                            placeholder="搜索产品名、SKU 或卖点"
                            className="h-9 w-full rounded-lg border border-border bg-white pl-8 pr-3 text-xs font-semibold text-text-primary outline-none focus:border-accent"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={productCategoryFilter}
                            onChange={event => setProductCategoryFilter(event.target.value)}
                            className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-white px-2 text-[11px] font-bold text-text-secondary outline-none focus:border-accent"
                          >
                            <option value="">全部类目</option>
                            {productCategories.map(category => <option key={category} value={category}>{category}</option>)}
                          </select>
                          <button
                            type="button"
                            onClick={() => setShowSelectedProductsOnly(value => !value)}
                            className={`h-8 rounded-lg border px-2.5 text-[11px] font-bold ${showSelectedProductsOnly ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-border bg-white text-text-secondary'}`}
                          >
                            仅看已选
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-text-muted">当前 {visibleProductOptions.length} 款 · 已选 {selectedProductIds.length} 款</span>
                          <span className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={visibleProductOptions.length === 0}
                              onClick={() => setSelectedProductIds(current => productSelectMode === 'single'
                                ? visibleProductOptions.slice(0, 1).map(option => option.id)
                                : Array.from(new Set([...current, ...visibleProductOptions.map(option => option.id)])))}
                              className="rounded-md px-2 py-1 font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                            >
                              全选当前结果
                            </button>
                            <button
                              type="button"
                              onClick={() => { setSelectedProductIds([]); setProductInfo(''); }}
                              className="rounded-md px-2 py-1 font-bold text-text-muted hover:bg-surface-2 hover:text-red"
                            >
                              清空
                            </button>
                          </span>
                        </div>
                      </div>
                      <div className="max-h-72 overflow-y-auto p-2">
                      {productOptions.length > 0 && visibleProductOptions.length > 0 ? visibleProductOptions.map(option => {
                        const active = selectedProductIds.includes(option.id);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => toggleProductSelection(option.id)}
                            className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-2"
                          >
                            <span
                              className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                              style={active ? { borderColor: TRAFFIC_GREEN, background: TRAFFIC_GREEN, color: '#fff' } : { borderColor: 'var(--color-border)' }}
                            >
                              {active && <Check size={11} />}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-bold text-text-primary">{option.label}</span>
                              {option.info && <span className="mt-0.5 block line-clamp-1 text-[11px] text-text-muted">{option.info}</span>}
                            </span>
                          </button>
                        );
                      }) : productOptions.length === 0 ? (
                        <div className="px-2.5 py-3 text-xs leading-relaxed text-text-muted">
                          企业中心暂无产品信息，请先完成配置。
                        </div>
                      ) : (
                        <div className="px-2.5 py-6 text-center text-xs leading-relaxed text-text-muted">
                          没有匹配的产品，请调整搜索词或筛选条件。
                        </div>
                      )}
                      </div>
                    </div>
                    )}
                  </div>
                </div>
              </div>
              {false && contentMode === 'video' && mode === 'clone' && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Sparkles size={14} className="text-accent" />
                        <p className="text-sm font-black text-text-primary">AI 推荐迁移方案：{migrationRecommendation.label}</p>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-emerald-700">已采用</span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-text-secondary">{migrationRecommendation.reason}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div className="rounded-xl border border-emerald-100 bg-white/80 p-3">
                      <p className="text-[10px] font-black text-emerald-700">保留的爆点机制</p>
                      {migrationRecommendation.preserve.map(item => <p key={item} className="mt-1 text-[11px] leading-relaxed text-text-secondary">• {item}</p>)}
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-white/80 p-3">
                      <p className="text-[10px] font-black text-amber-700">按企业产品重建</p>
                      {migrationRecommendation.rebuild.map(item => <p key={item} className="mt-1 text-[11px] leading-relaxed text-text-secondary">• {item}</p>)}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {([
                      ['fidelity', '高保真复刻'],
                      ['structure', '结构迁移'],
                      ['mechanism', '机制借鉴'],
                    ] as const).map(([value, label]) => {
                      const recommended = migrationRecommendation.mode === value;
                      const risky = value === 'fidelity' && migrationRecommendation.mode !== 'fidelity';
                      return (
                        <button key={value} type="button" disabled={risky}
                          onClick={() => setMigrationMode(value)}
                          title={risky ? '当前对标视频与企业产品不兼容，禁止直接高保真替换' : undefined}
                          className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition ${migrationMode === value ? 'border-accent bg-accent text-white' : 'border-border bg-white text-text-secondary'} disabled:cursor-not-allowed disabled:opacity-40`}>
                          {label}{recommended ? '（推荐）' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {false && contentMode === 'poster' && (
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
              {contentMode === 'poster' && (
                <div className="rounded-2xl border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-text-primary">{videoKickoff?.video?.contentFormat === 'image' ? '企业获客图文内容包' : '海报文案 JSON'}</p>
                      <p className="mt-1 text-xs leading-relaxed text-text-muted">
                        {videoKickoff?.video?.contentFormat === 'image'
                          ? '用完整轮播的可见证据保留布局与信息层级，再以企业中心资料生成三组连续内容；缺失的商业承诺不会自动补写。'
                          : '先生成可编辑 JSON，再进入图片生成；MOQ、认证、交期等商业承诺字段需要确认后使用。'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void generatePosterBrief()}
                      disabled={posterLoading}
                      className="btn-primary shrink-0 !px-4 !py-2 !text-xs"
                    >
                      {posterLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      {videoKickoff?.video?.contentFormat === 'image' ? '生成获客内容包' : '一次生成图文'}
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
                    placeholder={videoKickoff?.video?.contentFormat === 'image'
                      ? '生成后这里会出现三组内容 JSON：买家注意、合作能力、供应商信任，以及每组轮播结构、配文、CTA 和私信开场。'
                      : '生成后这里会出现海报文案 JSON：标题、副标题、认证徽章、流程六步、产品分类卡、底部卖点和 CTA。'}
                    className="mt-3 w-full rounded-xl border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed text-text-secondary outline-none focus:border-accent"
                  />
                  {leadContentPackage && <LeadContentPackagePreview value={leadContentPackage} imageUrl={posterImageUrl} />}
                  {posterDraft && !leadContentPackage && (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {posterImageUrl && (
                        <div className="md:col-span-2 overflow-hidden rounded-xl border border-border bg-surface-2">
                          <img src={posterImageUrl} alt="AI 图文海报" className="max-h-[520px] w-full object-contain bg-white" />
                        </div>
                      )}
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

      case 'poster':
        return (
          <div className="max-w-4xl">
            <SectionTitle title="图文生成" desc={videoKickoff?.video?.contentFormat === 'image' ? '依据竞品完整轮播证据与企业中心资料，生成三组连续获客内容' : '一次生成新的海报，并按 Facebook 或 Instagram 自动适配配文和承接话术'} />
            <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
              <div className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-text-primary">{videoKickoff?.video?.contentFormat === 'image' ? '生成三组获客图文内容包' : '一键生成新海报'}</p>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">
                      {videoKickoff?.video?.contentFormat === 'image'
                        ? `系统会依据对标图文中可观察的布局、轮播功能和文案证据，分别生成“吸引买家—解释能力—建立信任”三组 ${platform === 'instagram' ? 'Instagram' : 'Facebook'} 内容；竞品品牌、产品和商业承诺不会进入成稿。`
                        : mode === 'clone'
                        ? `系统会先拆解对标图文的模块结构和画面表达，再用本地产品/工厂/证书/场景素材逐模块替换，并生成 ${platform === 'instagram' ? 'Instagram' : 'Facebook'} 配文。`
                        : `系统会基于已选产品和素材生成新海报，并同步生成 ${platform === 'instagram' ? 'Instagram' : 'Facebook'} 配文、评论 CTA 和私信开场。`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void generatePosterBrief()}
                    disabled={posterLoading}
                    className="btn-primary shrink-0 !px-4 !py-2 !text-xs"
                  >
                    {posterLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {videoKickoff?.video?.contentFormat === 'image' ? '生成获客内容包' : '一次生成图文'}
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
                  rows={posterJsonText ? 12 : 6}
                  placeholder={videoKickoff?.video?.contentFormat === 'image'
                    ? '生成后这里会出现三组内容 JSON：买家注意、合作能力、供应商信任，以及每组轮播结构、配文、CTA 和私信开场。'
                    : '生成后这里会出现海报文案 JSON：标题、副标题、认证徽章、流程六步、产品分类卡、底部卖点和 CTA。'}
                  className="mt-3 w-full rounded-xl border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed text-text-secondary outline-none focus:border-accent"
                />
                {leadContentPackage && <LeadContentPackagePreview value={leadContentPackage} imageUrl={posterImageUrl} />}
                {posterDraft && !leadContentPackage && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {posterImageUrl && (
                      <div className="md:col-span-2 overflow-hidden rounded-xl border border-border bg-surface-2">
                        <img src={posterImageUrl} alt="AI 图文海报" className="max-h-[520px] w-full object-contain bg-white" />
                      </div>
                    )}
                    {mode === 'clone' && posterDraft.layoutModules?.length ? (
                      <div className="md:col-span-2 rounded-xl border border-border bg-surface-2 p-3">
                        <p className="text-xs font-bold text-text-primary">爆款模块拆解与本地素材替换</p>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {posterDraft.layoutModules.slice(0, 6).map((item, index) => (
                            <div key={`${item.module}-${index}`} className="rounded-lg bg-white p-2 text-[11px] leading-relaxed text-text-secondary">
                              <p className="font-bold text-text-primary">{item.module}</p>
                              <p className="mt-1">参考：{item.referencePattern}</p>
                              <p className="mt-1">素材：{item.localAssetRole}</p>
                              <p className="mt-1 text-text-muted">{item.replacementInstruction}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
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
              <div className="space-y-3">
                <div className="rounded-2xl border border-border bg-surface p-4">
                  <p className="text-xs font-bold text-text-primary">当前配置</p>
                  <div className="mt-3 space-y-2 text-xs leading-relaxed text-text-secondary">
                    <p>平台：{platform === 'instagram' ? 'Instagram' : 'Facebook'}</p>
                    <p>比例：{ratio}</p>
                    <p>风格：{POSTER_STYLES.find(item => item.id === posterStyle)?.label}</p>
                    <p>模式：{POSTER_MODES.find(item => item.id === mode)?.title}</p>
                    <p>参考素材：{selectedClips.filter(item => item.type !== 'audio').length} 个</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-bold text-amber-900">生成前确认</p>
                  <p className="mt-2 text-xs leading-relaxed text-amber-800">
                    MOQ、认证、交期、价格、出口国家、工厂资质等商业承诺必须来自企业中心或用户确认，AI 只优化表达，不编造承诺。
                  </p>
                </div>
              </div>
            </div>
          </div>
        );

      /* ③ 选素材 —— 文件夹 + 网格 两栏 */
      case 'material': {
        const folderName = (id: string) => FOLDERS.find(f => f.id === id)?.name ?? '';
        // 按内容相关性搜索：匹配素材名 + 所属文件夹（分类）名
        const q = search.trim().toLowerCase();
        const matchSearch = (c: Clip) => q === '' || [c.name, folderName(c.folder), c.industry, c.shotFunction, c.applicability, c.tags]
          .filter(Boolean).some(value => String(value).toLowerCase().includes(q));
        // 「当前选择」跟随当前视频版本的分镜分配，不能读取跨版本的全局勾选状态。
        // 同一素材若用于多个分镜，只在素材网格中展示一次，并保持首次出现顺序。
        const currentVersionMaterialIds = [...new Set(assignedOrderedIds)];
        const recommendationSource = storyboardSlots.length > 0 ? currentVersionMaterialIds : selected;
        const recommended = recommendationSource
          .map(id => materialById.get(id))
          .filter((item): item is Clip => Boolean(item && item.type !== 'audio'));
        const visible = (activeFolder === 'recommend'
          ? recommended
          : materials.filter(c => activeFolder === 'all' || c.folder === activeFolder)
        ).filter(matchSearch);
        if (contentMode === 'poster') {
          const posterFolderName = (id: string) => POSTER_FOLDERS.find(f => f.id === id)?.name ?? folderName(id);
          const posterFolders = new Set(POSTER_FOLDERS.map(item => item.id));
          const posterActiveFolder = posterFolders.has(activeFolder) ? activeFolder : 'all';
          const posterMaterials = materials.filter(c => c.type !== 'audio');
          const selectedPosterClips = selected
            .map(id => materialById.get(id))
            .filter((item): item is Clip => Boolean(item && item.type !== 'audio'));
          const posterRecommended = selectedPosterClips.length
            ? selectedPosterClips
            : posterMaterials.filter(c => ['product', 'factory', 'packaging', 'certificate', 'scene', 'brand', 'hot'].includes(c.folder));
          const visiblePoster = (posterActiveFolder === 'recommend'
            ? posterRecommended
            : posterMaterials.filter(c => posterActiveFolder === 'all' || c.folder === posterActiveFolder)
          ).filter(c => q === '' || c.name.toLowerCase().includes(q) || posterFolderName(c.folder).toLowerCase().includes(q));
          const folderCount = (folderId: string) => {
            if (folderId === 'recommend') return posterRecommended.length;
            if (folderId === 'all') return posterMaterials.length;
            return posterMaterials.filter(c => c.folder === folderId).length;
          };
          const clipsForFolders = (folders: readonly string[]) =>
            selectedPosterClips.filter(clip => folders.includes(clip.folder));
          const smartSelectPosterMaterials = () => {
            const byFolder = (folders: string[], limit = 1) => posterMaterials
              .filter(clip => folders.includes(clip.folder))
              .slice(0, limit)
              .map(clip => clip.id);
            const picked = [
              ...byFolder(['product'], 4),
              ...byFolder(['factory'], 2),
              ...byFolder(['packaging', 'certificate'], 2),
              ...byFolder(['scene', 'brand'], 2),
              ...(mode === 'clone' ? byFolder(['hot'], 1) : []),
            ];
            setSelected([...new Set(picked.length ? picked : posterMaterials.slice(0, 6).map(clip => clip.id))]);
            setActiveFolder('recommend');
            setModeNotice(mode === 'clone'
              ? '已按爆款图文复刻逻辑推荐素材：先拆解爆款参考，再匹配产品、工厂、包装证书和场景图。'
              : '已按海报文案需要推荐素材：产品图优先，补充工厂背书、包装证书和使用场景。');
          };

          return (
            <div className="flex h-full -m-6">
              <div className="w-40 flex-shrink-0 border-r border-border p-2.5 overflow-y-auto">
                <div className="relative mb-3">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索图文素材…"
                    className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-border bg-surface text-xs outline-none focus:border-accent" />
                </div>
                <div className="flex items-center justify-between px-1.5 mb-1.5">
                  <span className="text-[11px] font-semibold text-text-secondary">图文素材</span>
                  <Plus size={13} className="text-text-muted cursor-pointer hover:text-text-primary" />
                </div>
                {POSTER_FOLDERS.map(f => (
                  <button key={f.id} onClick={() => setActiveFolder(f.id)}
                    className={`w-full flex items-center gap-1.5 px-2 py-2 rounded-lg text-xs transition-colors ${
                      posterActiveFolder === f.id ? 'bg-accent-glow text-accent font-semibold' : 'text-text-secondary hover:bg-surface-2'}`}>
                    <Folder size={12} className="flex-shrink-0" />
                    <span className="flex-1 text-left truncate">{f.name}</span>
                    {f.id === 'hot' && <span className="text-[7px] font-bold px-1 py-0.5 rounded text-white flex-shrink-0" style={{ background: '#0891b2' }}>爬取</span>}
                    <span className="text-[10px] text-text-muted">{folderCount(f.id)}</span>
                  </button>
                ))}
              </div>

              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-shrink-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">{posterFolderName(posterActiveFolder)}</p>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      {mode === 'clone'
                        ? '爆款图文参考用于拆解画风、画面和图文构成，本地素材用于生成最终海报。'
                        : '上传产品、工厂、包装、证书、场景和品牌视觉素材，AI 会按海报文案智能推荐。'}
                    </p>
                  </div>
                  <input ref={fileInputRef} type="file" multiple accept="image/*" className="hidden"
                    onChange={e => { void handleUpload(e.target.files); e.target.value = ''; }} />
                  <button
                    type="button"
                    onClick={smartSelectPosterMaterials}
                    disabled={posterMaterials.length === 0}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-bold text-white transition disabled:opacity-50"
                  >
                    <Sparkles size={12} />
                    智能推荐参考图
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                    className="btn-ghost !px-3 !py-1.5 !text-xs flex items-center gap-1.5 disabled:opacity-60">
                    {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    {uploading ? '上传中…' : '上传图片'}
                  </button>
                  <span className="text-xs text-text-muted">已选 {selectedPosterClips.length}</span>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                  <div className={`mb-4 rounded-xl border px-4 py-3 text-xs leading-relaxed ${activeProductLabel ? 'border-accent/20 bg-accent-glow text-text-secondary' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                    <span className="font-bold text-text-primary">当前产品：</span>
                    {activeProductLabel || '尚未选择。产品信息生成模式需要先在第一步选择企业中心产品，再补充/选择图文素材。'}
                    {activeProductLabel && mode === 'product' ? '。请继续选择产品图、工厂图、包装图、证书图或场景图作为海报参考。' : ''}
                  </div>
                  {mode === 'clone' && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
                      爆款复刻模式需要先从「灵感大屏 - 待拍 - 图文」选择爬取图文素材。系统会把对标图文拆成标题区、产品主视觉、背景氛围、信息栏、认证徽章、流程图、CTA 等模块，再用本地素材逐模块替换。
                    </div>
                  )}
                  <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {visiblePoster.map(c => {
                      const on = selected.includes(c.id);
                      const idx = selected.indexOf(c.id);
                      return (
                        <button key={c.id}
                          onClick={() => setSelected(s => on ? s.filter(x => x !== c.id) : [...s, c.id])}
                          className="card !rounded-xl overflow-hidden text-left relative group"
                          style={on ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}>
                          <div className="relative">
                            {c.url
                              ? <RealThumb clip={c} onSourceError={() => { void refreshMaterialSource(c.id); }} />
                              : <Thumb seed={c.id} src={c.poster} label={c.type === 'image' ? 'IMG' : fmtDur(c.duration)} />}
                            {on && (
                              <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white z-10"
                                style={{ background: TRAFFIC_GREEN }}>{idx + 1}</span>
                            )}
                            {c.folder === 'hot' && (
                              <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[8px] font-bold text-white bg-black/45 z-10">
                                爆款参考
                              </span>
                            )}
                          </div>
                          <div className="p-2">
                            <p className="text-[11px] font-medium text-text-primary truncate">{c.name}</p>
                            <p className="text-[10px] text-text-muted mt-0.5">{posterFolderName(c.folder)} · {c.size}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {visiblePoster.length === 0 && (
                    <div className="text-center py-16">
                      <Upload size={26} className="mx-auto text-text-muted mb-3 opacity-30" />
                      <p className="text-sm text-text-muted">
                        {search.trim() ? '没有匹配的图文素材' : posterActiveFolder === 'hot' ? '暂无爆款图文参考，请从灵感大屏爬取或选择待拍图文' : '这个分类还没有图片素材'}
                      </p>
                      {posterActiveFolder !== 'hot' && !search.trim() && (
                        <button onClick={() => fileInputRef.current?.click()} className="mt-2 text-xs font-semibold" style={{ color: TRAFFIC_GREEN }}>
                          上传到{posterFolderName(posterActiveFolder)}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <aside className="w-[380px] flex-shrink-0 border-l border-border bg-surface/40 flex flex-col">
                <div className="border-b border-border bg-white px-4 py-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">海报参考素材</p>
                      <p className="mt-0.5 text-sm font-black text-text-primary">
                        {mode === 'clone' ? '爆款拆解 + 本地素材回填' : '按文案推荐素材'}
                      </p>
                    </div>
                    <button type="button" onClick={() => setSelected([])}
                      className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary hover:bg-surface-2">
                      清空
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
                    <span>{selectedPosterClips.length} 个已选 · 下一步生成海报 JSON 和图片</span>
                    <button type="button" onClick={smartSelectPosterMaterials}
                      className="font-bold text-accent disabled:opacity-40"
                      disabled={!posterMaterials.length}>
                      智能推荐
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
                  {POSTER_MATERIAL_GROUPS.map(group => {
                    const groupClips = clipsForFolders(group.folders);
                    if (group.id === 'hot' && mode !== 'clone') return null;
                    return (
                      <div key={group.id} className={`rounded-xl border p-3 ${groupClips.length ? 'border-green-200 bg-green-50/60' : 'border-dashed border-border bg-white'}`}>
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-bold text-text-primary">{group.title}</p>
                            <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{group.desc}</p>
                          </div>
                          <span className="rounded-md bg-slate-950 px-1.5 py-0.5 text-[10px] font-bold text-white">{groupClips.length}</span>
                        </div>
                        {groupClips.length ? (
                          <div className="space-y-2">
                            {groupClips.map(clip => (
                              <div key={clip.id} className="flex items-center gap-2 rounded-lg bg-white p-2 shadow-sm">
                                <div className="h-12 w-16 flex-shrink-0 overflow-hidden rounded-md bg-surface-2">
                                  {clip.url
                                    ? <RealThumb clip={clip} onSourceError={() => { void refreshMaterialSource(clip.id); }} />
                                    : <Thumb seed={clip.id} src={clip.poster} label={clip.type === 'image' ? 'IMG' : fmtDur(clip.duration)} />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[11px] font-bold text-text-primary">{clip.name}</p>
                                  <p className="mt-0.5 text-[10px] text-text-muted">{posterFolderName(clip.folder)} · {clip.size}</p>
                                </div>
                                <button type="button" onClick={() => setSelected(list => list.filter(id => id !== clip.id))}
                                  className="rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-red">
                                  <X size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex h-14 items-center justify-center rounded-lg border border-dashed border-border bg-surface-2 text-center text-[11px] font-bold text-text-muted">
                            {group.id === 'hot' ? '从灵感大屏选择爆款图文' : '从左侧选择或上传'}
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
        const assignClipToSlot = (slotId: string, clipId: string) => {
          const clip = materialById.get(clipId);
          const slot = storyboardSlots.find(item => item.id === slotId);
          if (!clip || !slot) return;
          if (!isClipCompatibleWithRatio(clip, ratio)) {
            setModeNotice(`“${clip.name}”与当前 ${ratio} 成片方向不一致，已阻止加入；请选择同方向素材。`);
            return;
          }
          const detectedSource = clipSourceMode(clip);
          setStoryboardAssignments(prev => ({ ...prev, [slotId]: clipId }));
          setClipEdits(prev => ({ ...prev, [slotClipEditKey(slot.id, clipId)]: defaultEditForSlot(clip, slot) }));
          setStoryboardSourcePlans(prev => ({
            ...prev,
            [slotId]: {
              ...sourcePlanFor(slot),
              mode: detectedSource,
              decided: true,
              confirmed: false,
              generatedClipId: detectedSource === 'ai' ? clip.id : undefined,
              error: '',
            },
          }));
          const currentIndex = storyboardSlots.findIndex(item => item.id === slotId);
          const nextSlot = storyboardSlots.slice(currentIndex + 1).find(item => !storyboardAssignments[item.id]);
          if (nextSlot) setActiveStoryboardSlotId(nextSlot.id);
        };
        const removeSlotClip = (slotId: string) => {
          setStoryboardAssignments(prev => {
            const next = { ...prev };
            delete next[slotId];
            return next;
          });
        };
        const currentAssemblySnapshot = (): StoryboardAssembly => ({
          id: activeAssemblyId,
          name: assemblyName,
          assignments: storyboardAssignments,
          sourcePlans: storyboardSourcePlans,
          selected,
        });
        const switchAssembly = (targetId: string) => {
          if (targetId === activeAssemblyId) return;
          const target = storyboardAssemblies.find(item => item.id === targetId);
          if (!target) return;
          const current = currentAssemblySnapshot();
          setStoryboardAssemblies(items => items.map(item => item.id === activeAssemblyId ? current : item));
          setActiveAssemblyId(target.id);
          setAssemblyName(target.name);
          setStoryboardAssignments(target.assignments);
          setStoryboardSourcePlans(target.sourcePlans);
          setSelected(target.selected);
          setActiveStoryboardSlotId(storyboardSlots.find(slot => !target.assignments[slot.id])?.id || storyboardSlots[0]?.id || '');
        };
        const createAssembly = () => {
          const current = currentAssemblySnapshot();
          const nextNumber = storyboardAssemblies.reduce((max, item) => {
            const match = item.name.match(/^视频(\d+)$/);
            return Math.max(max, match ? Number(match[1]) : 0);
          }, 0) + 1;
          const next: StoryboardAssembly = {
            id: `video-${Date.now()}`,
            name: `视频${nextNumber}`,
            assignments: {},
            sourcePlans: {},
            selected: [],
          };
          setStoryboardAssemblies(items => [...items.map(item => item.id === activeAssemblyId ? current : item), next]);
          setActiveAssemblyId(next.id);
          setAssemblyName(next.name);
          setStoryboardAssignments({});
          setStoryboardSourcePlans({});
          setSelected([]);
          setActiveStoryboardSlotId(storyboardSlots[0]?.id || '');
        };
        const updateSourcePlan = (slot: StoryboardSlot, patch: Partial<StoryboardSourcePlan>) => {
          const current = sourcePlanFor(slot);
          setStoryboardSourcePlans(prev => ({
            ...prev,
            [slot.id]: {
              ...sourcePlanFor(slot),
              ...patch,
              decided: patch.mode ? true : sourcePlanFor(slot).decided,
              referenceClipId: patch.mode === 'hybrid'
                ? (storyboardAssignments[slot.id] || sourcePlanFor(slot).referenceClipId)
                : patch.mode ? undefined : sourcePlanFor(slot).referenceClipId,
              generatedClipId: patch.mode && patch.mode !== sourcePlanFor(slot).mode ? undefined : sourcePlanFor(slot).generatedClipId,
              error: patch.mode ? '' : sourcePlanFor(slot).error,
            },
          }));
        };
        const preferredFoldersForSlot = (slot: StoryboardSlot) => {
          const text = `${slot.title} ${slot.detail}`.toLowerCase();
          if (/证书|认证|检测|certificate/.test(text)) return ['certificate', 'factory', 'upload'];
          if (/工厂|生产线|质检|factory|inspection/.test(text)) return ['factory', 'upload'];
          if (/包装|瓶身|logo|产品特写|材质|product|detail/.test(text)) return ['product', 'detail', 'packaging', 'upload'];
          if (/人物|模特|口播|presenter|model/.test(text)) return ['presenter', 'model', 'upload'];
          if (/场景|生活|户外|室内|scene|lifestyle/.test(text)) return ['scene', 'upload'];
          return ['upload', 'scene', 'product', 'detail', 'factory', 'presenter', 'model'];
        };
        const bestLocalClipForSlot = (slot: StoryboardSlot) => {
          const folders = preferredFoldersForSlot(slot);
          const candidates = materials.filter(item => item.type !== 'audio' && item.folder !== 'hot' && isClipCompatibleWithRatio(item, ratio));
          return [...candidates].sort((a, b) => {
            const aRank = folders.indexOf(a.folder);
            const bRank = folders.indexOf(b.folder);
            const normalizedA = aRank < 0 ? 999 : aRank;
            const normalizedB = bRank < 0 ? 999 : bRank;
            if (normalizedA !== normalizedB) return normalizedA - normalizedB;
            const detail = `${slot.title} ${slot.detail}`.toLowerCase();
            const aMatch = a.name.toLowerCase().split(/\s+|[-_]/).filter(word => word.length > 1 && detail.includes(word)).length;
            const bMatch = b.name.toLowerCase().split(/\s+|[-_]/).filter(word => word.length > 1 && detail.includes(word)).length;
            return bMatch - aMatch;
          })[0];
        };
        const executeAutoPlan = async (slot: StoryboardSlot) => {
          const recommendedMode = recommendedSourceMode(slot);
          const localClip = bestLocalClipForSlot(slot);
          const resolvedMode: StoryboardSourceMode = recommendedMode === 'auto'
            ? (localClip ? 'local' : 'ai')
            : recommendedMode;
          if ((resolvedMode === 'local' || resolvedMode === 'hybrid') && !localClip) {
            setStoryboardSourcePlans(prev => ({
              ...prev,
              [slot.id]: {
                ...sourcePlanFor(slot),
                mode: resolvedMode,
                critical: isCriticalStoryboardSlot(slot),
                confirmed: false,
                error: '没有找到符合该分镜的真实素材，请先上传或手动匹配。',
              },
            }));
            return;
          }
          if (localClip) assignClipToSlot(slot.id, localClip.id);
          const nextPlan: StoryboardSourcePlan = {
            mode: resolvedMode,
            critical: isCriticalStoryboardSlot(slot),
            confirmed: false,
            referenceClipId: resolvedMode === 'hybrid' ? localClip?.id : undefined,
            error: '',
          };
          setStoryboardSourcePlans(prev => ({ ...prev, [slot.id]: nextPlan }));
          if (resolvedMode === 'ai' || resolvedMode === 'hybrid') {
            await generateStoryboardShot(slot, nextPlan);
          }
        };
        const executeAllAutoPlans = async () => {
          for (const slot of storyboardSlots) {
            await executeAutoPlan(slot);
          }
        };
        const confirmAllStoryboardPlans = () => {
          const next: Record<string, StoryboardSourcePlan> = {};
          storyboardSlots.forEach(slot => {
            const plan = sourcePlanFor(slot);
            const hasLocalMaterial = Boolean(storyboardAssignments[slot.id]);
            const generatedReady = plan.mode !== 'ai' && plan.mode !== 'hybrid' || Boolean(plan.generatedClipId && materialById.has(plan.generatedClipId));
            next[slot.id] = {
              ...plan,
              confirmed: Boolean(plan.decided) && generatedReady && (plan.mode === 'ai' || hasLocalMaterial),
            };
          });
          setStoryboardSourcePlans(prev => ({ ...prev, ...next }));
        };
        const activeStoryboardSlot = storyboardSlots.find(slot => slot.id === activeStoryboardSlotId)
          || storyboardSlots.find(slot => !storyboardAssignments[slot.id])
          || storyboardSlots[0];
        const activeStoryboardIndex = activeStoryboardSlot
          ? storyboardSlots.findIndex(slot => slot.id === activeStoryboardSlot.id)
          : -1;
        const remainingStoryboardCount = Math.max(0, storyboardSlots.length - assignedCount);
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
	              {mode === 'clone' && (
	                <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-5 py-3">
	                  <div>
	                    <p className="text-sm font-black text-text-primary">逐镜放入素材</p>
	                    <p className="mt-0.5 text-[10px] text-text-muted">拖入已有视频，或直接 AI 生成；素材来源由系统自动识别，无需确认。</p>
	                  </div>
	                  <div className="flex items-center gap-2 text-[10px] font-bold">
	                    <span className="rounded-lg bg-accent/10 px-2.5 py-1.5 text-accent">{storyboardSlots.length ? `已完成 ${assignedCount}/${storyboardSlots.length}` : '暂无分镜'}</span>
	                  </div>
	                </div>
	              )}
	              <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-shrink-0">
		                <span className="text-sm font-semibold text-text-primary">{folderName(activeFolder)}</span>
		                {activeFolder === 'recommend' && <span className="text-[11px] text-text-muted">查看当前视频版本全部分镜使用的素材</span>}
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
		                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
		                  className="btn-ghost ml-auto !px-3 !py-1.5 !text-xs flex items-center gap-1.5 disabled:opacity-60">
		                  {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} {uploading ? '上传中…' : '上传'}
		                </button>
	                <span className="text-xs text-text-muted">已选 {activeFolder === 'recommend' ? recommendationSource.length : selected.length}</span>
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
                    const displaySelection = activeFolder === 'recommend' ? recommendationSource : selected;
                    const on = displaySelection.includes(c.id);
                    const idx = displaySelection.indexOf(c.id);
	                    return (
	                      <div key={c.id}
	                        role="button"
	                        tabIndex={0}
                        draggable={c.type !== 'audio'}
                        onDragStart={e => {
                          e.dataTransfer.setData('text/plain', c.id);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => setSelected(s => on ? s.filter(x => x !== c.id) : [...s, c.id])}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelected(s => on ? s.filter(x => x !== c.id) : [...s, c.id]);
                          }
                        }}
                        className="card !rounded-xl overflow-hidden text-left relative group"
                        style={on ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}>
                        <div className="relative">
                          {/* 真实素材显示实际预览，mock 用渐变占位 */}
                          {c.url
                            ? <RealThumb clip={c} onSourceError={() => { void refreshMaterialSource(c.id); }} />
                            : <Thumb seed={c.id} src={c.poster} label={c.type === 'image' ? 'IMG' : `0:${String(c.duration).padStart(2, '0')}`} />}
                          {on && (
                            <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white z-10"
                              style={{ background: TRAFFIC_GREEN }}>{idx + 1}</span>
                          )}
                          {c.scope === 'shared' && !on && (
                            <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[8px] font-bold text-white z-10" style={{ background: '#0891b2' }}>在线</span>
                          )}
                          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-black/45 uppercase z-10">
                            {c.type}
                          </span>
                          {c.type === 'video' && c.url && (
                            <button
                              type="button"
                              aria-label={`播放 ${c.name}`}
                              onClick={event => {
                                event.preventDefault();
                                event.stopPropagation();
                                setPreviewClip(c);
                              }}
                              className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full focus:outline-none focus:ring-2 focus:ring-white/80"
                            >
                              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/65 text-white shadow-lg transition group-hover:scale-105">
                                <Play size={18} fill="currentColor" />
                              </span>
                            </button>
                          )}
                        </div>
	                        <div className="p-2">
	                          <p className="text-[11px] font-medium text-text-primary truncate">{c.name}</p>
	                          <p className="text-[10px] text-text-muted mt-0.5">{c.folder === 'presenter' ? '真人口播素材 · ' : ''}{c.size}</p>
	                          {(c.industry || c.shotFunction) && (
	                            <p className="mt-1 truncate text-[9px] text-text-muted">{[c.industry, c.shotFunction].filter(Boolean).join(' · ')}</p>
	                          )}
	                          {activeStoryboardSlot && c.type !== 'audio' && (
	                            <button
	                              type="button"
	                              onClick={event => {
	                                event.preventDefault();
	                                event.stopPropagation();
	                                assignClipToSlot(activeStoryboardSlot.id, c.id);
	                              }}
	                              className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-slate-950 px-2 py-1.5 text-[10px] font-bold text-white transition hover:bg-accent"
	                            >
	                              <Check size={11} />
	                              应用到第 {activeStoryboardIndex + 1} 段
	                            </button>
	                          )}
	                        </div>
	                      </div>
                    );
                  })}
                </div>
                {visible.length === 0 && (
                  <div className="text-center py-16">
                    <Upload size={26} className="mx-auto text-text-muted mb-3 opacity-30" />
		                    <p className="text-sm text-text-muted">
		                      {search.trim() ? '没有匹配的素材' : activeFolder === 'recommend' ? '当前视频版本还没有匹配分镜素材；请从其他文件夹选择或拖入分镜' : activeFolder === 'hot' ? '爆款素材库更新中，敬请期待' : activeFolder === 'presenter' ? '还没有真人口播素材' : '这个文件夹还没有素材'}
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

            {previewClip?.type === 'video' && previewClip.url && (
              <div
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-6"
                role="dialog"
                aria-modal="true"
                aria-label="素材视频预览"
                onClick={() => setPreviewClip(null)}
              >
                <div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-black shadow-2xl" onClick={event => event.stopPropagation()}>
                  <div className="flex items-center justify-between gap-4 bg-surface px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-text-primary">{previewClip.name}</p>
                      <p className="text-[11px] text-text-muted">{folderName(previewClip.folder)} · {fmtDur(previewClip.duration)}</p>
                    </div>
                    <button type="button" aria-label="关闭视频预览" onClick={() => setPreviewClip(null)} className="rounded-lg p-2 text-text-muted hover:bg-surface-2 hover:text-text-primary">
                      <X size={18} />
                    </button>
                  </div>
                  <video
                    key={`${previewClip.id}:${previewClip.url}`}
                    src={previewClip.url}
                    poster={previewClip.poster}
                    controls
                    autoPlay
                    playsInline
                    preload="metadata"
                    className="max-h-[75vh] w-full bg-black object-contain"
                    onLoadedData={() => setModeNotice('')}
                    onError={() => {
                      setModeNotice('素材预览链接已失效，正在刷新后重试…');
                      void refreshMaterialSource(previewClip.id).then(refreshed => {
                        if (refreshed) setPreviewClip(refreshed);
                      });
                    }}
                  >
                    当前浏览器不支持视频播放。
                  </video>
                </div>
              </div>
            )}

            <aside className="w-[400px] flex-shrink-0 border-l border-border bg-surface/40 flex flex-col">
              <div className="border-b border-border bg-white px-4 py-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">分镜匹配 · 视频草稿</p>
                  <button type="button" onClick={createAssembly}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-secondary hover:bg-surface-2">
                    + 新建视频
                  </button>
                </div>
                <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                  {storyboardAssemblies.map(item => {
                    const active = item.id === activeAssemblyId;
                    const itemAssignments = active ? storyboardAssignments : item.assignments;
                    const matched = storyboardSlots.filter(slot => Boolean(itemAssignments[slot.id])).length;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => switchAssembly(item.id)}
                        className={`flex flex-shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${active ? 'border-accent bg-accent/5 text-accent shadow-sm' : 'border-border bg-white text-text-secondary hover:border-accent/40'}`}
                      >
                        <span className="text-xs font-black">{active ? assemblyName : item.name}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${active ? 'bg-accent/10 text-accent' : 'bg-surface-2 text-text-muted'}`}>{storyboardSlots.length ? `${matched}/${storyboardSlots.length}` : '暂无'}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
                  <span>{storyboardSlots.length ? `${assignedCount}/${storyboardSlots.length} 已匹配 · ${remainingStoryboardCount ? `${remainingStoryboardCount} 段待处理` : '可以进入下一步'}` : '暂无分镜'}</span>
                </div>
                {storyboardSlots.length > 0 && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(assignedCount / storyboardSlots.length) * 100}%` }} />
                  </div>
                )}
                {remainingStoryboardCount > 0 && storyboardSlots.length > 0 && (
                  <div data-lingshu-guide="ai-storyboard" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-start gap-2">
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-black text-white">!</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-black text-amber-950">还剩 {remainingStoryboardCount} 个分镜没有视频</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void smartSelectMaterialsFast()}
                      disabled={materialSelectLoading || !materials.some(item => item.type !== 'audio')}
                      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-black text-white transition hover:bg-amber-600"
                      title="根据分镜语义、素材标签和有效时长在本地即时匹配，不调用大模型"
                    >
                      {materialSelectLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                      {materialSelectLoading ? '快速匹配中…' : '快速本地匹配全部空分镜'}
                    </button>
                  </div>
                )}
                {mode === 'clone' && storyboardReviewComplete && storyboardSlots.length > 0 && (
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 text-xs font-black text-green-700">
                    <Check size={14} /> 所有分镜已有视频，可以进入下一步
                  </div>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
	                {storyboardSlots.length === 0 && (
	                  <div className="flex min-h-[240px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-white px-6 text-center">
	                    <Film size={28} className="text-text-muted opacity-35" />
	                    <p className="mt-3 text-sm font-black text-text-primary">暂无分镜</p>
	                  </div>
	                )}
	                {storyboardSlots.map((slot, index) => {
	                  const clip = slot.id ? materialById.get(storyboardAssignments[slot.id] || '') : undefined;
	                  const shotGenerating = Boolean(storyboardGenerating[slot.id]);
                  const slotVersions = storyboardVideoVersions[slot.id] || [];
                  const slotScript = storyboardSlotScript(slot.detail);
                  return (
                    <div
                      key={slot.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveStoryboardSlotId(slot.id)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') setActiveStoryboardSlotId(slot.id);
                      }}
                      onDragOver={event => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'copy';
                      }}
                      onDrop={event => {
                        event.preventDefault();
                        assignClipToSlot(slot.id, event.dataTransfer.getData('text/plain'));
                      }}
                      className={`rounded-xl border p-3 transition-all ${activeStoryboardSlot?.id === slot.id ? 'border-accent bg-accent/5 shadow-[0_0_0_1px_rgba(22,163,74,.16)]' : clip ? 'border-green-200 bg-green-50/60' : 'border-dashed border-border bg-white hover:border-accent/50'}`}
                    >
                      <div className="mb-2 grid grid-cols-[78px_minmax(0,1fr)_auto] items-start gap-2">
                        <div className="min-w-0 pt-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded-md bg-slate-950 px-1.5 py-0.5 text-[10px] font-bold text-white">{index + 1}</span>
                            <span className="font-mono text-[11px] font-bold text-accent">{slot.time}</span>
                          </div>
                          <p className="mt-1 truncate text-xs font-bold text-text-primary">{slot.title}</p>
                        </div>
                        <div className="min-w-0 rounded-lg border border-border/70 bg-white/80 px-2.5 py-2">
                          <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-text-muted">分镜脚本</p>
                          {slotScript.visual && (
                            <p className="line-clamp-2 text-[10px] leading-4 text-text-secondary">
                              <span className="font-black text-text-primary">画面：</span>{slotScript.visual}
                            </p>
                          )}
                          {slotScript.voice && (
                            <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-text-secondary">
                              <span className="font-black text-text-primary">口播：</span>{slotScript.voice}
                            </p>
                          )}
                          {slotScript.subtitle && (
                            <p className="mt-1 truncate rounded bg-accent/5 px-1.5 py-0.5 text-[9px] font-bold text-accent">字幕：{slotScript.subtitle}</p>
                          )}
                          {!slotScript.visual && !slotScript.voice && !slotScript.subtitle && (
                            <p className="line-clamp-3 text-[10px] leading-4 text-text-secondary">{slotScript.fallback || '该时间段暂未填写分镜脚本'}</p>
                          )}
                        </div>
                        {clip && (
                          <button type="button" onClick={() => removeSlotClip(slot.id)}
                            className="rounded-md p-1 text-text-muted hover:bg-white hover:text-red">
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      {clip ? (
                        <div className="space-y-2"><div className="flex items-center gap-2 rounded-lg bg-white p-2 shadow-sm">
                          <div className="h-12 w-16 flex-shrink-0 overflow-hidden rounded-md bg-surface-2">
                            {clip.url
                              ? <RealThumb clip={clip} onSourceError={() => { void refreshMaterialSource(clip.id); }} />
                              : <Thumb seed={clip.id} src={clip.poster} label={clip.type === 'image' ? 'IMG' : fmtDur(clip.duration)} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11px] font-bold text-text-primary">{clip.name}</p>
                            <p className="mt-0.5 text-[10px] text-text-muted">{clipSourceMode(clip) === 'online' ? '在线素材' : clipSourceMode(clip) === 'ai' ? 'AI素材' : '本地素材'} · {clip.type === 'image' ? '3s' : fmtDur(clip.duration)}</p>
                          </div>
                        </div>
                        {slotVersions.length > 0 && <div className="flex flex-wrap items-center gap-1">
                          {slotVersions.map(item => <button key={item.id} type="button" onClick={async event => {
                            event.stopPropagation();
                            await studioApi.selectVideoVersion(item.id);
                            setStoryboardVideoVersions(prev => ({ ...prev, [slot.id]: (prev[slot.id] || []).map(v => ({ ...v, isSelected: v.id === item.id })) }));
                            if (item.materialId) { setStoryboardAssignments(prev => ({ ...prev, [slot.id]: item.materialId! })); setSelected(prev => [...new Set([...prev, item.materialId!])]); }
                          }} className={`rounded-md border px-2 py-1 text-[9px] font-bold ${item.isSelected ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-white text-text-muted'}`}>V{item.versionNumber}</button>)}
                          {mode === 'clone' && <button type="button" onClick={event => { event.stopPropagation(); void generateStoryboardShot(slot, { ...sourcePlanFor(slot), mode: sourcePlanFor(slot).mode === 'hybrid' ? 'hybrid' : 'ai', decided: true, confirmed: false }); }} disabled={shotGenerating} className="rounded-md bg-slate-950 px-2 py-1 text-[9px] font-bold text-white disabled:opacity-50">{shotGenerating ? '生成中…' : '再生成一版'}</button>}
                        </div>}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex h-14 items-center justify-center rounded-lg border border-dashed border-border bg-surface-2 text-[11px] font-bold text-text-muted">
                            拖拽素材到这里
                          </div>
                          {mode === 'clone' && (
                            <button
                              type="button"
                              onClick={() => void generateStoryboardShot(slot, { ...sourcePlanFor(slot), mode: 'ai', decided: true, confirmed: false })}
                              disabled={shotGenerating}
                              className="flex w-full items-center justify-center gap-1 rounded-lg bg-slate-950 px-2 py-1.5 text-[10px] font-black text-white disabled:opacity-50"
                            >
                              {shotGenerating ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
                              {shotGenerating ? 'AI 生成中…' : 'AI 生成此分镜'}
                            </button>
                          )}
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

      /* ② 分镜与声音 */
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
        const referenceAnalysisIncomplete = mode === 'clone' && hasIncompleteReferenceAnalysis(videoKickoff);
        const languageConfigurationRequired = !enterpriseScriptLanguage
          && modeNotice.includes('企业中心尚未配置首选输出语言或主要业务语言');
        const detectedVoiceLang = detectScriptLanguageCode(voiceoverLines || extractVoiceoverText(script));
        const updatePrimaryScriptContent = (value: string) => {
          const spoken = extractVoiceoverText(value);
          const sourceLanguage = detectScriptLanguageCode(spoken || value);
          setScript(value);
          setVoiceoverLines(spoken);
          setScriptView('timestamp');
          setModeScripts(current => current.map(item => item.id === activeModeScriptId ? { ...item, script: value } : item));
          if (spoken.trim()) {
            setVoiceDrafts(current => ({ ...current, [sourceLanguage]: spoken }));
            setVoiceDraftStaleLangs(current => [...new Set([
              ...current,
              ...voiceLangs.filter(code => code !== sourceLanguage),
            ])]);
          }
          setVoiceoverAudios({});
          setAlignedCuesByLang({});
          setLanguageRenderOutputs({});
          setRenderOutputPath('');
          setModeNotice('脚本已手动修改，请保存草稿；如需配音或成片，请重新生成对应语种配音。');
        };
        const updateVoiceScriptContent = (code: string, value: string) => {
          setVoiceDrafts(current => ({ ...current, [code]: value }));
          if (code === detectedVoiceLang) setVoiceoverLines(value);
          setActiveVoiceLang(code);
          setLang(code);
          setScriptView('voiceover');
          setVoiceDraftStaleLangs(current => current.filter(item => item !== code));
          setVoiceoverAudios(current => { const next = { ...current }; delete next[code]; return next; });
          setAlignedCuesByLang(current => { const next = { ...current }; delete next[code]; return next; });
          setLanguageRenderOutputs({});
          setRenderOutputPath('');
          setVoiceDraftNotice(`${langZh(code) || code}脚本已手动修改，请保存草稿并重新生成该语种配音。`);
        };
        const scriptPreviewTabs = [
          {
            id: 'script',
            label: '脚本',
            content: script,
            placeholder: '可直接输入或粘贴完整时间戳脚本。保存后会写入当前草稿。',
            dir: detectScriptLanguageCode(script) === 'ar' ? 'rtl' : 'ltr',
            onChange: updatePrimaryScriptContent,
          },
          {
            id: 'voiceover',
            label: `${langZh(detectedVoiceLang) || detectedVoiceLang}口播`,
            content: voiceDrafts[detectedVoiceLang] || voiceoverLines || extractVoiceoverText(script),
            placeholder: '可直接编辑当前口播台词；修改后需重新生成配音。',
            dir: detectedVoiceLang === 'ar' ? 'rtl' : 'ltr',
            onChange: (value: string) => updateVoiceScriptContent(detectedVoiceLang, value),
          },
          ...voiceLangs.filter(code => code !== detectedVoiceLang).map(code => ({
            id: `lang:${code}`,
            label: LANGS.find(item => item.code === code)?.label.split(' - ')[1] || code.toUpperCase(),
            content: voiceDrafts[code] || '',
            placeholder: `可直接编辑${langZh(code) || code}版本脚本；修改后需重新生成该语种配音。`,
            dir: code === 'ar' ? 'rtl' : 'ltr',
            onChange: (value: string) => updateVoiceScriptContent(code, value),
          })),
        ];
        const activeScriptPreview = scriptPreviewTabs.find(tab => tab.id === scriptPreviewTab) || scriptPreviewTabs[0];
        const hasFactoryEvidence = materials.some(item => item.folder === 'factory') || /工厂|产线|质检|产能|factory|production line|quality control/i.test(activeProductInfo);
        const hasCaseEvidence = /客户案例|合作案例|案例结果|customer case|case study/i.test(activeProductInfo);
        const themeUnavailableReason = (theme: VideoTheme): string => {
          if (theme.requires.includes('product') && !activeProductInfo.trim()) return '需要先选择企业中心产品';
          if (theme.requires.includes('material') && !materials.some(item => item.type !== 'audio')) return '素材库中暂无可用画面证据';
          if (theme.requires.includes('factory') && !hasFactoryEvidence) return '缺少工厂、产线、质检或产能证据';
          if (theme.requires.includes('comparison') && selectedProductIds.length < 2) return '需要至少选择两个可比较产品';
          if (theme.requires.includes('case') && !hasCaseEvidence) return '企业资料中没有已确认客户案例';
          if (theme.requires.includes('trend') && !videoKickoff) return '缺少对标内容或趋势来源';
          return '';
        };
        return (
          <div className="grid w-full items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
          <div className="min-w-0">
            <div className="flex items-center justify-between mb-4">
              <SectionTitle title="分镜与声音" desc="先确认爆点迁移后的可执行分镜，再选择保留无口播、AI 配音或上传真人音频" noMargin />
            </div>

            <div className="mb-4 grid gap-2 md:grid-cols-3">
            {([
              { id: 'theme' as const, number: 1, title: '选择主题/分镜', desc: `${activeVideoTheme.title} · 选择主题并确认可执行分镜`, done: Boolean(videoThemeId) && hasTimestampScript },
              { id: 'voiceover' as const, number: 2, title: '选择声音策略', desc: '保留无口播，或提取台词做多语适配', done: voiceoverMode === 'none' || hasRequestedVoiceDrafts },
              { id: 'audio' as const, number: 3, title: '生成/确认声音', desc: voiceoverMode === 'none' ? '原片无口播，保留低信息噪声节奏' : '按真实音频校准时间轴', done: voiceoverMode === 'none' || hasRequestedVoiceovers || (voiceoverMode === 'upload' && Boolean(voiceoverUrl)) },
            ]).map(item => (
                <button type="button" key={item.number} onClick={() => setScriptStageTab(item.id)}
                  className={`rounded-xl border px-3 py-3 text-left transition ${scriptStageTab === item.id ? 'border-accent bg-accent/5 shadow-sm' : item.done ? 'border-accent/20 bg-surface hover:border-accent/40' : 'border-border bg-surface-2 hover:border-border-bright'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black ${item.done ? 'bg-accent text-white' : scriptStageTab === item.id ? 'border border-accent text-accent' : 'bg-white text-text-muted'}`}>
                      {item.done ? <Check size={12} /> : item.number}
                    </span>
                    <p className="text-xs font-black text-text-primary">{item.title}</p>
                  </div>
                  <p className="mt-1 pl-8 text-[10px] leading-4 text-text-muted">{item.desc}</p>
                </button>
              ))}
            </div>

            {scriptStageTab === 'theme' && (
              <div className="mb-4 rounded-2xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-text-primary">{mode === 'material' ? '当前钩子素材的内容类型' : '选择本条视频的核心主题'}</p>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">{mode === 'material' ? '系统根据钩子素材的分类、人物和镜头内容自动判定类型，并调用对应脚本策略。' : '系统会结合当前生成模式、企业事实和可用素材静默调用对应脚本策略；这里不需要手动选择 Skill。'}</p>
                  </div>
                  <span className="rounded-lg bg-accent/10 px-2.5 py-1.5 text-[10px] font-black text-accent">{mode === 'material' ? '已按素材自动判定' : 'AI策略已自动匹配'}</span>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {VIDEO_THEMES.map(theme => {
                    const selectedTheme = videoThemeId === theme.id;
                    return (
                      <button key={theme.id} type="button" title={theme.description}
                        onClick={() => {
                          setVideoThemeId(theme.id);
                          setThemePainPoint(theme.painPoint);
                          setThemeConversionGoal(DEFAULT_VIDEO_CONVERSION_GOAL);
                          if (script.trim()) setModeNotice(`视频主题已切换为“${theme.title}”，请重新生成可执行分镜。`);
                        }}
                        className={`rounded-xl border p-3 text-left transition ${selectedTheme ? 'border-accent bg-accent/5 shadow-sm' : 'border-border bg-white hover:border-accent/40'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-black text-text-primary">{theme.title}</p>
                          {selectedTheme && <Check size={13} className="text-accent" />}
                        </div>
                        <p className="mt-1 text-[10px] leading-4 text-text-muted">{theme.description}</p>
                      </button>
                    );
                  })}
                </div>
                {themeUnavailableReason(activeVideoTheme) && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                    <div>
                      <p className="text-xs font-black text-amber-900">缺少：{themeUnavailableReason(activeVideoTheme)}</p>
                      <p className="mt-1 text-[11px] text-amber-700">当前可先生成：产品识别 + 钩子结构</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setStepIdx(STEPS.findIndex(item => item.id === 'material'))} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-[11px] font-black text-amber-800">选择其他素材</button>
                      <button type="button" onClick={() => {
                        createScriptGapTask({ title: themeUnavailableReason(activeVideoTheme), productLabel: activeProductLabel || '当前产品', themeTitle: activeVideoTheme.title, shotBrief: `补拍可用于“${activeVideoTheme.title}”的${themeUnavailableReason(activeVideoTheme)}镜头`, suggestedDurationSec: 3, sourceProjectId: projectId || undefined, sourceStoryboardSlotId: activeStoryboardSlotId || undefined });
                        setModeNotice('已创建建议补拍任务，可在灵感大屏 → 待拍查看。');
                      }} className="rounded-lg bg-amber-600 px-3 py-2 text-[11px] font-black text-white">创建建议补拍</button>
                    </div>
                  </div>
                )}
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {availableCooperationRoutes.length > 1 && <label className="block">
                    <span className="mb-1.5 block text-[10px] font-black text-text-secondary">本条视频合作路线</span>
                    <select value={cooperationRoute} onChange={event => {
                      const route = event.target.value;
                      const defaults = enterpriseRouteStrategies[route];
                      setCooperationRoute(route);
                      if (defaults?.targetBuyerRoles?.[0]) setAudience(defaults.targetBuyerRoles[0]);
                      if (defaults?.primaryCta) setPrimaryCta(defaults.primaryCta);
                    }} className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs text-text-primary outline-none focus:border-accent">
                      {availableCooperationRoutes.map(route => <option key={route} value={route}>{route === 'oem_odm' ? 'OEM / ODM' : route === 'wholesale_distribution' ? '现货批发 / 经销' : 'C 端零售'}</option>)}
                    </select>
                  </label>}
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-black text-text-secondary">目标买家</span>
                    <textarea value={audience} onChange={event => setAudience(event.target.value)} rows={3}
                      className="w-full resize-none rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs leading-5 text-text-primary outline-none focus:border-accent" />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-black text-text-secondary">主 CTA</span>
                    <textarea value={primaryCta} onChange={event => setPrimaryCta(event.target.value)} rows={3}
                      className="w-full resize-none rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs leading-5 text-text-primary outline-none focus:border-accent" />
                  </label>
                </div>
              </div>
            )}

            {(scriptStageTab === 'theme' || scriptStageTab === 'script') && (
            <>
            <div className="mb-4 rounded-2xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-text-primary">
                    {mode === 'material' ? '素材库分镜生成' : mode === 'product' ? '产品分镜生成' : '爆款裂变分镜生成'}
                  </p>
                  <p className="mt-1 text-xs text-text-muted">
                    {mode === 'clone' ? (referenceAnalysisIncomplete ? '正在分析镜头…' : '镜头分析完成，可生成裂变脚本') : mode === 'product' ? '先生成带预估时间戳的可执行分镜；配音后再按真实音频校准时间轴。' : '按已选素材生成可执行分镜，再选择是否需要口播与配音。'}
                  </p>
                </div>
	                <button
	                  type="button"
	                  onClick={event => {
	                    event.preventDefault();
	                    event.stopPropagation();
	                    void generateTimestampScriptsForMode();
	                  }}
                  disabled={modeActionLoading || (mode === 'clone' && referenceAnalysisIncomplete)}
	                  title={referenceAnalysisIncomplete ? '对标逐镜分析不完整，点击查看处理提示' : undefined}
	                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60"
	                >
                  {modeActionLoading ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                  {modeActionLoading ? (modeActionStatus || '脚本生成中…') : mode === 'clone' && script.trim() ? 'AI重新生成分镜' : '生成可执行分镜'}
                </button>
              </div>
              {mode === 'clone' && !videoKickoff?.referenceAnalysis?.details?.length && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
                  当前为旧版草稿，未保存对标逐镜分析；请返回灵感大屏完成全片精确分析后再生成脚本。
                </p>
              )}
              {modeNotice && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-amber-800"
                >
                  <span className="min-w-0 flex-1">{modeNotice}</span>
                  {referenceAnalysisIncomplete && (
                    <button
                      type="button"
                      onClick={() => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'traffic', view: 'materials' } }))}
                      className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[10px] font-black text-amber-800 hover:bg-amber-100"
                    >
                      返回灵感大屏补全分析
                    </button>
                  )}
                  {languageConfigurationRequired && (
                    <button
                      type="button"
                      onClick={() => {
                        window.sessionStorage.setItem('lingshu:enterprise-focus', 'language-settings');
                        onNavigate?.('enterprise');
                      }}
                      className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[10px] font-black text-amber-800 hover:bg-amber-100"
                    >
                      前往企业中心配置
                    </button>
                  )}
                </div>
              )}
              {currentModeScripts.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {currentModeScripts.map(({ item, number }) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openModeScript(item)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${activeModeScriptId === item.id ? 'border-accent bg-accent-glow text-accent' : 'border-border bg-white text-text-muted hover:text-text-secondary'}`}
                    >
                      {item.title}{activeModeScriptId === item.id ? ' · 当前' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
            </>
            )}

            {scriptStageTab === 'voiceover' && (
            <div className="mb-5 rounded-2xl border border-border bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-text-primary">提取口播与多语种字幕</p>
                  <p className="mt-1 text-xs text-text-muted">从时间戳脚本里提取口播台词，保留时间段，再生成不同语种版本。</p>
                </div>
                <button
                  type="button"
                  onClick={() => void generateVoiceDrafts()}
                  disabled={voiceDraftLoading || !hasTimestampScript || !voiceLangs.length}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                >
                  {voiceDraftLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {voiceDraftLoading ? '生成中…' : '提取口播并翻译'}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/20 bg-accent-glow px-3 py-2">
                <span className="text-[10px] font-black text-accent">企业中心语种</span>
                {voiceLangs.length ? voiceLangs.map(code => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => { setActiveVoiceLang(code); setLang(code); }}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                      activeVoiceLang === code
                        ? 'border-accent bg-accent text-white'
                        : 'border-accent/30 bg-white text-accent hover:border-accent'
                    }`}
                  >
                    {langZh(code) || code}
                  </button>
                )) : (
                  <span className="text-xs font-semibold text-amber-700">企业中心尚未配置口播语言，请先到企业中心设置。</span>
                )}
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
                        {voiceDraftStaleLangs.includes(code) && <span className="ml-1 text-amber-600">待同步</span>}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={voiceDrafts[activeVoiceLang] || (activeVoiceLang === 'zh' ? '' : '翻译生成中或失败，请点击“提取口播并翻译”重试。')}
                    onChange={e => {
                      setVoiceDrafts(drafts => ({ ...drafts, [activeVoiceLang]: e.target.value }));
                      setVoiceoverAudios(current => { const next = { ...current }; delete next[activeVoiceLang]; return next; });
                      setAlignedCuesByLang(current => { const next = { ...current }; delete next[activeVoiceLang]; return next; });
                      if (activeVoiceLang === 'zh') setVoiceDraftStaleLangs(current => [...new Set([...current, ...voiceLangs.filter(code => code !== 'zh')])]);
                    }}
                    rows={6}
                    dir={activeVoiceLang === 'ar' ? 'rtl' : 'ltr'}
                    className="w-full rounded-xl border border-border bg-surface-2 p-3 font-mono text-sm leading-7 text-text-secondary outline-none focus:border-accent resize-none"
                  />
                  {voiceDraftStaleLangs.includes(activeVoiceLang) && (
                    <p className="text-xs font-semibold text-amber-700">主脚本已更新，此语言版本尚未同步。点击上方“提取口播并翻译”会重新本地化。</p>
                  )}
                </div>
              )}
            </div>
            )}

            {scriptStageTab === 'audio' && (<>
            <Field label="配音方式">
              <input ref={voiceoverInputRef} type="file" accept="audio/*" className="hidden"
                onChange={e => { void handleVoiceoverUpload(e.target.files); e.target.value = ''; }} />
              <input ref={voiceSampleInputRef} type="file" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-wav,audio/mp4" className="hidden"
                onChange={e => { void handleVoiceSampleUpload(e.target.files); e.target.value = ''; }} />
              <div className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-border bg-surface-2 p-1">
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
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-all ${voiceoverMode === option.id ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
                  >
                    <div className="flex h-6 w-6 items-center justify-center rounded-md"
                      style={{ background: voiceoverMode === option.id ? TRAFFIC_GREEN : 'transparent', color: voiceoverMode === option.id ? '#fff' : 'var(--color-text-muted)' }}>
                      {option.icon}
                    </div>
                    <span>
                      <span className="block text-xs font-bold">{option.title}</span>
                      <span className="block max-w-[130px] truncate text-[9px] text-text-muted">{option.desc}</span>
                    </span>
                  </button>
                ))}
              </div>

              {voiceoverMode === 'ai' && (
                <div className="mt-3 flex max-w-2xl flex-wrap items-end gap-2">
                  <div className="basis-full">
                    <span className="mb-1.5 block text-[10px] font-bold text-text-muted">音色候选（可多选）</span>
                    <div className="flex flex-wrap gap-2">
                      {[...VOICES, ...customVoices.map(item => ({ id: item.voiceId, name: item.name, tag: '自定义音色' })), ...(customVoiceId && customVoiceName && !customVoices.some(item => item.voiceId === customVoiceId) ? [{ id: customVoiceId, name: customVoiceName, tag: '自定义音色' }] : [])].map(item => {
                        const selectedCandidate = voiceCandidates.includes(item.id);
                        const activeCandidate = voice === item.id;
                        return <button key={item.id} type="button" onClick={() => {
                          const next = selectedCandidate ? voiceCandidates.filter(id => id !== item.id) : [...voiceCandidates, item.id];
                          if (!next.length) return;
                          setVoiceCandidates(next);
                          const nextActive = !selectedCandidate ? item.id : activeCandidate ? next[0]! : voice;
                          if (!selectedCandidate || activeCandidate) {
                            const stored = customVoices.find(candidate => candidate.voiceId === nextActive);
                            setCustomVoiceId(stored?.voiceId || ''); setCustomVoiceName(stored?.name || ''); setCustomVoiceUrl(stored?.url || '');
                            pickVoice(nextActive);
                          }
                        }} className={`rounded-xl border px-3 py-2 text-left text-xs transition ${activeCandidate ? 'border-accent bg-accent/10 text-accent' : selectedCandidate ? 'border-accent/40 bg-white text-text-primary' : 'border-border bg-white text-text-muted'}`}>
                          <span className="block font-bold">{item.name}</span><span className="mt-0.5 block text-[9px] opacity-70">{item.tag}{activeCandidate ? ' · 当前试听' : ''}</span>
                        </button>;
                      })}
                    </div>
                  </div>
                  <button type="button" onClick={openVoiceSamplePicker}
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-white px-3 text-xs font-bold text-text-secondary hover:border-accent hover:text-accent">
                    <Plus size={13} />增加新音色
                  </button>
                </div>
              )}

              {voiceoverMode === 'ai' && (
                <details data-lingshu-guide="ai-voice" className="group mt-3 max-w-2xl rounded-xl border border-border bg-surface-2">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-bold text-text-secondary [&::-webkit-details-marker]:hidden">
                    <span>高级配音设置</span>
                    <span className="flex items-center gap-2 text-[10px] font-medium text-text-muted">
                      {TTS_PRESETS.find(item => item.id === ttsPreset)?.label} · {ttsSpeed.toFixed(2)}x
                      <ChevronDown size={13} className="transition group-open:rotate-180" />
                    </span>
                  </summary>
                  <div className="border-t border-border p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-black text-text-primary">表达方式与目标时长</p>
                      <p className="mt-0.5 text-[10px] font-bold text-text-muted">当前：{LANGS.find(item => item.code === activeVoiceLang)?.label || activeVoiceLang} · 约 {duration}s</p>
                    </div>
                    <select value={ttsPreset} onChange={e => applyTtsPreset(e.target.value as TtsStyleOptions['preset'])}
                      className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-bold text-text-secondary outline-none">
                      {TTS_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </div>
                  {mode === 'clone' && referenceVoice.available && (
                    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/20 bg-accent/5 px-3 py-2">
                      <span className="text-[10px] font-bold text-text-primary">爆款裂变专属</span>
                      <button type="button" onClick={toggleReferenceVoiceStyle}
                        className={`rounded-lg px-2.5 py-1 text-[10px] font-bold ${useReferenceVoiceStyle ? 'bg-accent text-white' : 'border border-border bg-white text-text-muted'}`}>
                        沿用对标口播节奏
                      </button>
                      <span className="text-[10px] text-text-muted">{useReferenceVoiceStyle ? `已开启 · ${referenceVoice.summary}` : '已关闭 · 使用手动配音参数'}</span>
                    </div>
                  )}
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_150px_150px]">
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-bold text-text-muted">情绪描述</span>
                      <input value={ttsEmotion} onChange={e => { setTtsEmotion(e.target.value); setVoiceoverUrl(null); }}
                        className="w-full rounded-lg border border-border bg-white px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent" />
                    </label>
                    <label className="block">
                      <span className="mb-1 flex justify-between text-[10px] font-bold text-text-muted"><span>情绪强度</span><span>{ttsEmotionIntensity}%</span></span>
                      <input type="range" min={0} max={100} value={ttsEmotionIntensity}
                        onChange={e => { setTtsEmotionIntensity(+e.target.value); setVoiceoverUrl(null); }} className="w-full accent-[#16a34a]" />
                    </label>
                    <label className="block">
                      <span className="mb-1 flex justify-between text-[10px] font-bold text-text-muted"><span>语速</span><span>{ttsSpeed.toFixed(2)}x</span></span>
                      <input type="range" min={75} max={135} value={Math.round(ttsSpeed * 100)}
                        onChange={e => { setTtsSpeed(+e.target.value / 100); setVoiceoverUrl(null); }} className="w-full accent-[#16a34a]" />
                    </label>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-bold text-text-muted">口播停顿</span>
                      <select value={ttsPauseStyle} onChange={e => { setTtsPauseStyle(e.target.value as typeof ttsPauseStyle); setVoiceoverUrl(null); }}
                        className="w-full rounded-lg border border-border bg-white px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent">
                        <option value="few">少停顿</option>
                        <option value="natural">自然停顿</option>
                        <option value="dramatic">戏剧性停顿</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-bold text-text-muted">品牌/术语读法（每行：原词=期望读法）</span>
                      <textarea value={ttsPronunciationText} onChange={e => { setTtsPronunciationText(e.target.value); setVoiceoverUrl(null); }} rows={3}
                        placeholder={'GUIANFA=G U I A N F A\nST-ELLICE=ess tee eh-liss\nMOQ=M O Q'}
                        className="w-full rounded-lg border border-border bg-white px-2.5 py-2 font-mono text-[10px] text-text-primary outline-none focus:border-accent resize-none" />
                      <span className="mt-1 block text-[10px] leading-relaxed text-text-muted">逐字母读用空格分开；连读就写近似音节，例如 GUIANFA=gui-an-fa。重新生成配音后生效。</span>
                    </label>
                  </div>
                  <div className={`mt-3 rounded-xl border px-3 py-2 text-[10px] leading-relaxed ${audioCapabilities?.customVoice.synthesis ? 'border-accent/20 bg-accent/5 text-accent' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{audioCapabilities?.customVoice.message || '正在检测品牌音色引擎…'}</span>
                      <button type="button" onClick={() => void diagnoseMinimax()} disabled={minimaxDiagnosing || !audioCapabilities?.minimax?.configured}
                        className="inline-flex items-center gap-1 rounded-lg border border-current/20 bg-white/70 px-2 py-1 font-bold disabled:opacity-50">
                        {minimaxDiagnosing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}检查服务
                      </button>
                    </div>
                    {minimaxDiagnostic && <p className={`mt-1 font-semibold ${minimaxDiagnostic.includes('失败') ? 'text-red-600' : ''}`}>{minimaxDiagnostic}</p>}
                  </div>
                  </div>
                </details>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 max-w-xl">
                {voiceoverMode === 'ai' && voiceLangs.length > 1 && Object.keys(voiceDrafts).length > 0 && (
                  <div className="basis-full mb-1 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-2 p-2">
                    <span className="px-1 text-[10px] font-black text-text-muted">试听语种</span>
                    <div className="flex flex-wrap gap-1">
                      {voiceLangs.map(code => {
                        const hasAudio = Boolean(voiceoverAudios[code]?.url);
                        const active = activeVoiceLang === code;
                        return (
                          <button
                            key={`listen-lang-${code}`}
                            type="button"
                            onClick={() => switchVoicePreviewLanguage(code)}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition ${
                              active
                                ? 'bg-accent text-white'
                                : hasAudio
                                  ? 'bg-white text-text-secondary hover:text-accent'
                                  : 'bg-white text-text-muted opacity-75'
                            }`}
                          >
                            {langZh(code) || code}
                            <span className={`rounded px-1 py-0.5 text-[9px] ${active ? 'bg-white/20 text-white' : hasAudio ? 'bg-accent-glow text-accent' : 'bg-surface-2 text-text-muted'}`}>
                              {hasAudio ? '可试听' : '待生成'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {voiceoverMode === 'ai' && (
	                  <button
                        type="button"
	                    onClick={() => void genTts()}
	                    disabled={ttsLoading || !hasRequestedVoiceDrafts || (voice.startsWith('custom:') && audioCapabilities?.customVoice.synthesis === false)}
	                    aria-busy={batchTtsLoading}
	                    className="inline-flex min-w-[214px] items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
	                  >
	                    {batchTtsLoading ? <Loader2 size={12} className="animate-spin" /> : <Mic size={13} />}
	                    {batchTtsLoading ? `正在生成 ${voiceLangs.length || 1} 个语种试听配音…` : `生成 ${voiceLangs.length || 1} 个语种试听配音`}
	                  </button>
                )}
                {voiceoverMode === 'ai' && voiceLangs.length > 1 && (
                  <button type="button" onClick={() => void genTts(activeVoiceLang)}
                    disabled={ttsLoading || !voiceDrafts[activeVoiceLang]?.trim() || (voice.startsWith('custom:') && audioCapabilities?.customVoice.synthesis === false)}
                    aria-busy={singleTtsLoading}
                    className={`inline-flex min-w-[154px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition disabled:opacity-50 ${singleTtsLoading ? 'border-accent bg-accent text-white' : 'border-accent text-accent'}`}>
                    {singleTtsLoading ? <Loader2 size={12} className="animate-spin" /> : <Languages size={13} />}
                    {singleTtsLoading ? '正在生成当前语言…' : '只生成当前语言'}
                  </button>
                )}
                {voiceoverMode === 'ai' && !hasRequestedVoiceDrafts && (
                  <span className="basis-full text-xs font-semibold text-text-muted">请先完成口播提取与多语种翻译，再生成试听配音。</span>
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
                    当前使用真人音色：{customVoiceName}{customVoiceUrl ? '。' : '。'} 跨语言可保持品牌声线，但与录音语言不同的版本可能带原语言口音，建议逐语种试听确认。
                  </div>
                )}
                {voiceoverUrl && (
                  <button
                    type="button"
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
              <div id="subtitle-effect-preview" className="mt-5 scroll-mt-5 rounded-2xl border border-border bg-surface p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-text-primary">分镜拼接与 AI 口播确认</p>
                    <p className="mt-1 text-xs text-text-muted">
                      当前 {langZh(activeVoiceLang) || activeVoiceLang} · 录音 {voiceoverDur || 0}s · 字幕 {cues.length} 条 · 素材 {selectedClips.length} 段
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {voiceoverMode === 'ai' && voiceLangs.length > 1 && (
                      <div className="flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1">
                        {voiceLangs.map(code => {
                          const hasAudio = Boolean(voiceoverAudios[code]?.url);
                          return (
                            <button
                              key={`preview-lang-${code}`}
                              type="button"
                              onClick={() => switchVoicePreviewLanguage(code)}
                              disabled={!hasAudio}
                              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${activeVoiceLang === code ? 'bg-accent text-white' : 'bg-white text-text-muted hover:text-accent'}`}
                            >
                              {langZh(code) || code}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <button onClick={() => downloadSubtitleFile(cues, 'srt', activeVoiceLang)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary">
                      <Download size={12} /> SRT
                    </button>
                    <button onClick={() => downloadSubtitleFile(cues, 'vtt', activeVoiceLang)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary">
                      <Download size={12} /> VTT
                    </button>
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
                      <CoverFace coverUrl={coverUrl} frameUrl={coverFrameUrl} frameType={coverClip?.poster ? 'image' : coverClip?.type} fallbackVideoUrl={coverClip?.type === 'video' ? coverClip.url : undefined} title={coverTitle} style={coverStyle} />
                    )}
                    {subtitlesOn && cues[subPreviewIdx] && (
                      <div className="absolute inset-x-0 bottom-[26%] z-10 px-3 text-center pointer-events-none">
                        <p className="leading-snug text-white text-[12px] font-bold" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
                          {cues[subPreviewIdx].words?.length
                            ? cues[subPreviewIdx].words!.map((word, wordIndex) => (
                                <span key={`${word.start}-${wordIndex}`} style={ttsCurrentTime >= word.start && ttsCurrentTime < word.end ? { color: '#86efac' } : undefined}>
                                  {word.text}
                                </span>
                              ))
                            : cues[subPreviewIdx].text}
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
                        <div key={`${cue.start}-${i}`} onClick={() => setSubPreviewIdx(i)}
                          className={`rounded-lg border px-2.5 py-2 text-xs transition ${i === subPreviewIdx ? 'border-accent/30 bg-accent-glow' : 'border-transparent hover:bg-surface-2'}`}>
                          <div className="mb-1 flex items-center gap-1.5">
                            <input type="number" min={0} step={0.05} value={cue.start}
                              onChange={e => patchAlignedCue(i, { start: Math.max(0, +e.target.value) })}
                              className="w-16 rounded border border-border bg-white px-1.5 py-1 font-mono text-[10px] text-text-muted" />
                            <span className="text-text-muted">–</span>
                            <input type="number" min={0} step={0.05} value={cue.end}
                              onChange={e => patchAlignedCue(i, { end: Math.max(cue.start + 0.1, +e.target.value) })}
                              className="w-16 rounded border border-border bg-white px-1.5 py-1 font-mono text-[10px] text-text-muted" />
                            <span className="ml-auto text-[9px] font-bold text-text-muted">{cue.words?.length ? `${cue.words.length} 词已对齐` : '句级时间'}</span>
                          </div>
                          <textarea value={cue.text} rows={2} onChange={e => patchAlignedCue(i, { text: e.target.value })}
                            className="w-full resize-none rounded border border-border bg-white px-2 py-1.5 text-xs leading-5 text-text-secondary outline-none focus:border-accent" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            </>)}
          </div>
          <aside className="sticky top-0 min-w-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
            <div className="border-b border-border px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-text-primary">生成内容</p>
                  <p className="mt-0.5 text-[10px] text-text-muted">脚本、口播与多语言版本</p>
                </div>
                <div className="flex max-w-full flex-wrap justify-end gap-1">
                  {scriptPreviewTabs.map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setScriptPreviewTab(tab.id);
                        if (tab.id.startsWith('lang:')) {
                          const code = tab.id.slice(5);
                          setActiveVoiceLang(code);
                          setLang(code);
                        }
                      }}
                      className={`rounded-lg px-2.5 py-1.5 text-[10px] font-bold transition ${activeScriptPreview.id === tab.id ? 'bg-accent text-white' : 'bg-surface-2 text-text-muted hover:text-text-secondary'}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="min-h-[520px] p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="rounded-md bg-accent-glow px-2 py-1 text-[10px] font-black text-accent">{activeScriptPreview.label}</span>
                <div className="flex items-center gap-2">
                  {activeScriptPreview.content && (
                    <button type="button" onClick={() => void navigator.clipboard?.writeText(activeScriptPreview.content)} className="inline-flex items-center gap-1 text-[10px] font-bold text-text-muted hover:text-accent">
                      <Copy size={11} /> 复制
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void saveProject('draft')}
                    disabled={savingProj || voiceDraftLoading || ttsLoading}
                    className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[10px] font-black text-white disabled:opacity-50"
                  >
                    {savingProj ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                    保存
                  </button>
                </div>
              </div>
              <textarea
                value={activeScriptPreview.content}
                onChange={event => activeScriptPreview.onChange(event.target.value)}
                placeholder={activeScriptPreview.placeholder}
                dir={activeScriptPreview.dir}
                spellCheck={false}
                className="min-h-[430px] max-h-[620px] w-full resize-y overflow-y-auto rounded-xl border border-border bg-white p-4 font-sans text-xs leading-6 text-text-secondary outline-none focus:border-accent focus:bg-white"
              />
              {pendingClaimLocations(activeScriptPreview.content, activeProductInfo).length > 0 && (
                <div className="mt-3 space-y-2">
                  {pendingClaimLocations(activeScriptPreview.content, activeProductInfo).map((line, index) => <div key={`${line}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800"><span className="mr-1 font-black">待确认：</span>{line}</div>)}
                </div>
              )}
              {!activeScriptPreview.content && (
                <div className="mt-3 flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-2 px-8 text-center">
                  <FileText size={28} className="text-text-muted opacity-35" />
                  <p className="mt-3 text-xs font-bold text-text-secondary">{activeScriptPreview.id === 'script' ? '尚未生成脚本，也可以直接手动填写' : '尚未生成此版本，也可以直接手动填写'}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-text-muted">输入后点击“保存”，后续配音、素材匹配和成片会使用这里的最新内容。</p>
                </div>
              )}
            </div>
          </aside>
          </div>
        );
      }

      /* ④ 配乐 */
      case 'bgm': {
        const visibleBgms = bgmTab === 'favorites'
          ? bgms.filter(track => favoriteBgms.includes(track.id))
          : bgms;
        const activeBgmPreviewItem = previewIdx !== null ? previewTimeline[previewIdx] : null;
        const bgmPreviewDuration = previewTimeline.reduce((sum, item) => sum + Math.max(0.5, item.targetDuration || 0), 0);
        const firstBgmPreviewClip = previewTimeline[0]?.clip;
        const bgmPreviewPoster = firstBgmPreviewClip?.poster || (firstBgmPreviewClip?.type === 'image' ? firstBgmPreviewClip.url : coverFrameUrl);
        const generatedLanguages = voiceLangs.filter(code => voiceDrafts[code]?.trim());
        const effectiveLanguages = generatedLanguages.length ? generatedLanguages : [activeVoiceLang];
        const materialVersions = contentPlanVersions.flatMap((plan, planIndex) => effectiveLanguages.map((code, languageIndex) => ({
          key: materialVersionKey(plan.id, code), plan, code,
          name: `${plan.name || `视频${planIndex + 1}`} * ${langZh(code) || `语种${languageIndex + 1}`}`,
          language: LANGS.find(item => item.code === code)?.label || code.toUpperCase(),
          materialCount: timelineForAssembly(plan).length,
          hasScript: Boolean(voiceDrafts[code]?.trim()),
          hasAudio: voiceoverMode !== 'ai' || Boolean(voiceoverAudios[code]?.url),
        })));
        const activeVersionKey = materialVersionKey(activeAssemblyId, activeVoiceLang);
        const assignBgm = (trackId: string) => {
          setBgm(trackId);
          setAssemblyBgms(current => ({ ...current, [activeAssemblyId]: trackId }));
          setMaterialVersionBgms(current => ({ ...current, [activeVersionKey]: trackId }));
        };
        const switchMaterialVersion = (version: typeof materialVersions[number]) => {
          activateContentPlan(version.plan.id);
          previewLanguageVersion(version.code, false);
          setBgm(materialVersionBgms[version.key] ?? assemblyBgms[version.plan.id] ?? '');
          stopPreview();
        };
        const batchAssignBgms = () => {
          const candidates = (bgmCandidates.length ? bgmCandidates.map(id => bgms.find(track => track.id === id)) : bgms)
            .filter((track): track is Bgm => Boolean(track));
          if (!candidates.length) {
            setModeNotice('配乐库暂无可用音乐，请先展开配乐库并上传音乐。');
            setBgmLibraryOpen(true);
            return;
          }
          const next = Object.fromEntries(materialVersions.map((item, index) => [item.key, candidates[index % candidates.length]!.id]));
          setMaterialVersionBgms(current => ({ ...current, ...next }));
          setBgm(next[activeVersionKey] || candidates[0]!.id);
          setBgmMatchMode('smart');
          setPreviewBgmOn(true);
          setModeNotice(`已按版本节奏为 ${materialVersions.length} 个“语言 × 分镜组合 × 脚本”素材版本批量匹配配乐。`);
        };
        return (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(560px,1fr)_minmax(360px,460px)]">
          <div className="min-w-0">
            <div ref={bgmLibraryRef} className="relative z-30 mb-4 rounded-2xl border border-border bg-surface shadow-sm">
              <button type="button" onClick={() => setBgmLibraryOpen(open => !open)} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-surface-2/60">
                <span className="min-w-0">
                  <span className="block text-sm font-black text-text-primary">配乐库</span>
                  <span className="mt-0.5 block truncate text-[11px] text-text-muted">{selectedBgmTrack ? `当前：${selectedBgmTrack.name}` : `${bgms.length} 首音乐 · 点击展开选择`}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[11px] font-bold text-accent">{bgmLibraryOpen ? '收起乐库' : '展开乐库'}<ChevronDown size={15} className={`transition ${bgmLibraryOpen ? 'rotate-180' : ''}`} /></span>
              </button>
              {bgmLibraryOpen && <div className="absolute inset-x-0 top-full z-40 mt-2 max-h-[min(540px,calc(100vh-220px))] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface p-4 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <SectionTitle title="选择配乐" desc="试听后可应用到当前素材版本，也可加入批量候选" noMargin />
              <input ref={bgmInputRef} type="file" accept="audio/*" className="hidden"
                onChange={e => { void handleBgmUpload(e.target.files); e.target.value = ''; }} />
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => bgmInputRef.current?.click()} disabled={bgmUploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-60">
                  {bgmUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} 上传音乐
                </button>
                <button
                  type="button"
                  onClick={() => setBgmLibraryOpen(false)}
                  aria-label="收起配乐库"
                  title="收起配乐库"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted transition hover:border-border-bright hover:bg-surface-2 hover:text-text-primary"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="mb-4 inline-flex rounded-xl border border-border bg-surface-2 p-1">
              {[
                { id: 'library', label: '配乐曲库' },
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
            <div className="space-y-2 pr-1">
              <button onClick={() => { assignBgm(''); setBgmCandidates([]); if (audioRef.current) audioRef.current.pause(); setPlayingBgm(null); }}
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
                  <p className="mt-1 text-xs text-text-muted">在配乐曲库里点心形即可加入收藏。</p>
                </div>
              )}
              {visibleBgms.map(b => {
                const on = bgmCandidates.includes(b.id);
                const activePreview = bgm === b.id;
                const playing = playingBgm === b.id;
                const favored = favoriteBgms.includes(b.id);
                return (
                  <button key={b.id} onClick={() => {
                    if (on) {
                      const next = bgmCandidates.filter(id => id !== b.id);
                      setBgmCandidates(next);
                      if (activePreview) assignBgm(next[0] || '');
                    } else {
                      if (bgmCandidates.length >= 3) { setModeNotice('每套内容最多选择 3 首配乐候选。'); return; }
                      setBgmCandidates(current => [...current, b.id]); assignBgm(b.id);
                    }
                    setPreviewBgmOn(true);
                  }}
                    className="card !rounded-xl w-full p-3 flex items-center gap-3 text-left"
                    style={on ? { borderColor: TRAFFIC_GREEN, boxShadow: `0 0 0 1px ${TRAFFIC_GREEN}` } : undefined}>
                    {/* 试听播放/暂停 */}
                    <span onClick={e => { e.stopPropagation(); togglePlay(b); }}
                      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
                      style={{ background: playing ? TRAFFIC_GREEN : activePreview ? 'var(--color-accent-glow)' : 'var(--color-surface-2)', color: playing ? '#fff' : activePreview ? TRAFFIC_GREEN : 'var(--color-text-muted)' }}>
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
                      <p className="mt-0.5 text-[10px] font-semibold text-text-muted">
                        {b.scope === 'shared' ? `共享曲库 · ${b.uploadedBy || '灵枢管理员上传'}` : b.uploadedBy || '客户上传'}
                      </p>
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
              </div>}
            </div>
            <section className="mb-5 rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-text-primary">素材版本管理</p>
                  <p className="mt-1 text-[11px] text-text-muted">每个版本由生成语言、分镜素材组合和对应脚本共同确定；发布平台不参与版本划分。</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-accent-glow px-2 py-1 text-[10px] font-black text-accent">{materialVersions.filter(item => materialVersionBgms[item.key]).length}/{materialVersions.length} 已配乐</span>
                  <button type="button" onClick={batchAssignBgms} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[11px] font-black text-white">
                    <Sparkles size={12} />一键批量配乐
                  </button>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {materialVersions.map((item, index) => {
                  const active = item.key === activeVersionKey;
                  const itemAssignments = item.plan.id === activeAssemblyId ? storyboardAssignments : item.plan.assignments;
                  const itemSelected = item.plan.id === activeAssemblyId ? selected : item.plan.selected;
                  const matched = storyboardSlots.filter(slot => Boolean(itemAssignments[slot.id])).length;
                  const trackId = materialVersionBgms[item.key] ?? assemblyBgms[item.plan.id] ?? '';
                  const track = bgms.find(candidate => candidate.id === trackId);
                  const firstClipId = storyboardSlots.map(slot => itemAssignments[slot.id]).find(Boolean) || itemSelected[0];
                  const firstClip = firstClipId ? materialById.get(firstClipId) : undefined;
                  return (
                    <div key={item.key} className={`rounded-xl border p-3 transition ${active ? 'border-accent bg-accent/5 shadow-[0_0_0_1px_var(--color-accent)]' : 'border-border bg-white hover:border-border-bright'}`}>
                      <button type="button" onClick={() => switchMaterialVersion(item)} className="flex w-full items-center gap-3 text-left">
                        <span className="relative flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2">
                          {firstClip?.poster ? <img src={firstClip.poster} alt="" className="h-full w-full object-cover" /> : <Film size={17} className="text-text-muted" />}
                          <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 text-[8px] font-bold text-white">{index + 1}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2"><span className="text-xs font-black text-text-primary">{item.name}</span><span className="text-[9px] font-bold text-text-muted">{matched}/{storyboardSlots.length} 分镜</span></span>
                          <span className="mt-1 block truncate text-[10px] text-text-muted">{!item.hasScript
                            ? '脚本待生成'
                            : !item.hasAudio
                              ? '脚本已生成 · 配音待生成'
                              : track
                                ? `当前配乐：${track.name}`
                                : '脚本与配音已生成 · 尚未配乐'}</span>
                        </span>
                        {active && <span className="rounded-md bg-accent px-2 py-1 text-[9px] font-black text-white">预览中</span>}
                      </button>
                      <div className="mt-3 flex items-center gap-2 border-t border-border/70 pt-3">
                        <Music size={13} className="shrink-0 text-text-muted" />
                        <select value={trackId} onClick={event => event.stopPropagation()} onChange={event => {
                          const nextTrackId = event.target.value;
                          setMaterialVersionBgms(current => ({ ...current, [item.key]: nextTrackId }));
                          if (active) { setBgm(nextTrackId); setPreviewBgmOn(Boolean(nextTrackId)); }
                        }} className="min-w-0 flex-1 rounded-lg border border-border bg-white px-2.5 py-2 text-[11px] font-bold text-text-secondary outline-none focus:border-accent">
                          <option value="">不配乐</option>
                          {bgms.map(trackItem => <option key={trackItem.id} value={trackItem.id}>{trackItem.name} · {trackItem.mood}</option>)}
                        </select>
                        <button type="button" onClick={() => { switchMaterialVersion(item); setBgmLibraryOpen(true); }} className="rounded-lg border border-border px-2.5 py-2 text-[10px] font-black text-accent hover:border-accent">打开乐库</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            <div data-lingshu-guide="ai-audio-mix" className="rounded-2xl border border-border bg-surface p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-text-primary">音量调节</p>
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
          <aside className="sticky top-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-text-primary">实时混剪预览 · {assemblyName}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">切换左侧素材版本或配乐后立即同步试听，不生成正式文件</p>
              </div>
              <span className="shrink-0 rounded-md bg-accent-glow px-2 py-1 text-[10px] font-black text-accent">草稿</span>
            </div>

            <div className="mx-auto w-full max-w-[250px]">
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-xl">
                <div className="relative aspect-[9/16]">
                  {activeBgmPreviewItem ? (
                    activeBgmPreviewItem.clip.type === 'image' ? (
                      <img src={activeBgmPreviewItem.clip.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <>
                        {activeBgmPreviewItem.clip.poster && (
                          <img src={activeBgmPreviewItem.clip.poster} alt="素材预览帧" className="absolute inset-0 h-full w-full object-cover" />
                        )}
                        <video
                          key={`bgm-preview-${activeBgmPreviewItem.clipId}-${activeBgmPreviewItem.trimStart}-${activeBgmPreviewItem.clip.url}`}
                          ref={previewVideoRef}
                          src={activeBgmPreviewItem.clip.url}
                          poster={activeBgmPreviewItem.clip.poster}
                          autoPlay
                          preload="auto"
                          playsInline
                          muted={!previewOriginalOn}
                          className={`absolute inset-0 h-full w-full object-cover ${previewVideoReady ? 'opacity-100' : 'opacity-0'}`}
                          onLoadedData={() => { setPreviewVideoReady(true); setPreviewNote(false); }}
                          onCanPlay={() => setPreviewVideoReady(true)}
                          onError={() => {
                            setPreviewVideoReady(false);
                            setPreviewNote(true);
                            void refreshMaterialSource(activeBgmPreviewItem.clipId).then(refreshed => {
                              if (!refreshed) return;
                              setPreviewNote(false);
                              setPreviewVideoReady(false);
                            });
                          }}
                          onPause={pausePreviewAudio}
                          onPlay={resumePreviewAudio}
                          onWaiting={pausePreviewAudio}
                          onPlaying={resumePreviewAudio}
                          onTimeUpdate={updatePreviewClock}
                          onEnded={handlePreviewClipEnded}
                        />
                        {!activeBgmPreviewItem.clip.poster && !previewVideoReady && (
                          <div className="absolute inset-0 flex items-center justify-center text-white/60">
                            <Loader2 size={24} className="animate-spin" />
                          </div>
                        )}
                      </>
                    )
                  ) : bgmPreviewPoster ? (
                    <img src={bgmPreviewPoster} alt="粗剪预览封面" className="absolute inset-0 h-full w-full object-cover opacity-90" />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white/60">
                      <Film size={30} className="mb-3 opacity-60" />
                      <p className="text-xs font-bold">还没有可播放素材</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-white/45">返回“选素材”完成分镜匹配后即可预览</p>
                    </div>
                  )}

                  {activeBgmPreviewItem && (
                    <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-black/55 px-2 py-1 text-[10px] font-bold text-white">
                      镜头 {previewIdx! + 1}/{previewTimeline.length}
                    </div>
                  )}
                  {previewIdx !== null && activePreviewCue && subtitlesOn && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-[8%] z-20 px-3 text-center">
                      <p className="inline-block max-w-full rounded-md bg-black/45 px-2 py-1 text-sm font-black leading-tight text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,.9)' }}>
                        {activePreviewCue.text}
                      </p>
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={previewPlaying ? stopPreview : startPreview}
                      disabled={!previewTimeline.length}
                      className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-text-primary shadow-lg transition hover:scale-105 disabled:opacity-40"
                      aria-label={previewPlaying ? '停止粗剪预览' : '播放粗剪预览'}
                    >
                      {previewPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} className="ml-0.5" fill="currentColor" />}
                    </button>
                  </div>
                </div>
                <audio ref={previewBgmAudioRef} src={selectedBgmTrack?.url || undefined} preload="auto" />
                <audio ref={previewVoiceAudioRef} src={voiceoverMode === 'none' ? undefined : voiceoverUrl || undefined} preload="auto" />
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-text-muted">
                <span>{fmtDur(previewTime)}</span>
                <span>{fmtDur(bgmPreviewDuration || totalDur)}</span>
              </div>
              <div className="flex h-9 overflow-hidden rounded-lg border border-border bg-surface-2 p-1">
                {previewTimeline.length ? previewTimeline.map((item, index) => {
                  const active = previewIdx === index;
                  const width = `${Math.max(12, ((item.targetDuration || 1) / Math.max(1, bgmPreviewDuration)) * 100)}%`;
                  return (
                    <button
                      type="button"
                      key={`${item.clipId}-${index}`}
                      onClick={() => jumpToPreviewClip(index)}
                      title={`${index + 1}. ${item.name}`}
                      className="relative min-w-0 overflow-hidden rounded-md border-r border-white/70 px-1 text-[9px] font-bold transition"
                      style={{ width, background: active ? TRAFFIC_GREEN : '#e8eef5', color: active ? '#fff' : '#64748b' }}
                    >
                      <span className="block truncate">{index + 1}</span>
                    </button>
                  );
                }) : <div className="flex w-full items-center justify-center text-[10px] text-text-muted">暂无时间轴</div>}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { label: '原声', on: previewOriginalOn, toggle: () => setPreviewOriginalOn(value => !value) },
                { label: '口播', on: previewVoiceOn && voiceoverMode !== 'none' && Boolean(voiceoverUrl), toggle: () => setPreviewVoiceOn(value => !value), disabled: voiceoverMode === 'none' || !voiceoverUrl },
                { label: '配乐', on: previewBgmOn && Boolean(selectedBgmTrack?.url), toggle: () => setPreviewBgmOn(value => !value), disabled: !selectedBgmTrack?.url },
              ].map(item => (
                <button
                  type="button"
                  key={item.label}
                  onClick={item.toggle}
                  disabled={item.disabled}
                  className="rounded-xl border px-2 py-2 text-[11px] font-bold transition disabled:opacity-35"
                  style={item.on ? { borderColor: TRAFFIC_GREEN, background: 'var(--color-accent-glow)', color: TRAFFIC_GREEN } : { borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
                >
                  <Volume2 size={13} className="mx-auto mb-1" />{item.label}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-xl bg-surface-2 px-3 py-2.5">
              <p className="truncate text-xs font-bold text-text-primary">{selectedBgmTrack?.name || '当前未选择配乐'}</p>
              <p className="mt-1 text-[10px] text-text-muted">
                {previewVoiceOn && voiceoverUrl && bgm ? '口播出现时，配乐按当前设置自动降低' : bgm ? `配乐音量 ${bgmVol}%` : '选择一首音乐即可试听混剪效果'}
              </p>
            </div>
            {previewNote && <p className="mt-2 text-[11px] leading-relaxed text-amber-600">素材缺少可播放源文件，请返回上一步更换或上传素材。</p>}
          </aside>
          </div>
        );
      }

      /* ⑤ 封面 —— 用所选视频的真实帧画面，便于辨认内容 */
      case 'cover': {
        const SEG = (active: boolean) => `px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${active ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`;
        const SWATCHES = ['#ffffff', '#111827', '#16a34a', '#14b8a6', '#ef4444', '#3b82f6'];
        const ART_PRESETS: Array<{ id: NonNullable<CoverStyle['artPreset']>; label: string; sample: string; patch: Partial<CoverStyle> }> = [
          { id: 'clean', label: '简洁标题', sample: 'Clean', patch: { font: 'sans', color: '#ffffff', weight: 'bold' } },
          { id: 'outline', label: '描边爆款', sample: '爆款', patch: { font: 'impact', color: '#ffffff', weight: 'heavy' } },
          { id: 'highlight', label: '荧光高亮', sample: '重点', patch: { font: 'sans', color: '#111827', weight: 'heavy' } },
          { id: 'magazine', label: '杂志标题', sample: 'TREND', patch: { font: 'impact', color: '#ffffff', weight: 'heavy' } },
          { id: 'neon', label: '霓虹发光', sample: 'NEON', patch: { font: 'rounded', color: '#14b8a6', weight: 'heavy' } },
          { id: 'sticker', label: '贴纸立体', sample: 'WOW!', patch: { font: 'rounded', color: '#111827', weight: 'heavy' } },
        ];
        const generatedLanguages = voiceLangs.filter(code => voiceDrafts[code]?.trim());
        const effectiveLanguages = generatedLanguages.length ? generatedLanguages : [activeVoiceLang];
        const coverMaterialVersions = contentPlanVersions.flatMap((plan, planIndex) => effectiveLanguages.map((code, languageIndex) => {
          const key = materialVersionKey(plan.id, code);
          const timeline = timelineForAssembly(plan);
          return {
            key,
            plan,
            code,
            name: `${plan.name || `视频${planIndex + 1}`} * ${langZh(code) || `语种${languageIndex + 1}`}`,
            language: LANGS.find(item => item.code === code)?.label || code.toUpperCase(),
            materialCount: timeline.length || plan.selected.length,
            saved: materialVersionCovers[key],
          };
        }));
        const frameCandidatesForPlan = (plan: StoryboardAssembly) => {
          const ids = timelineForAssembly(plan).map(item => item.clipId).filter(Boolean) as string[];
          const sourceIds = ids.length ? ids : plan.selected;
          const seen = new Set<string>();
          return sourceIds
            .map(id => materialById.get(id))
            .filter((clip): clip is Clip => Boolean(clip && clip.type !== 'audio' && (clip.poster || clip.url)))
            .filter(clip => {
              if (seen.has(clip.id)) return false;
              seen.add(clip.id);
              return true;
            });
        };
        const activeCoverVersion = coverMaterialVersions.find(item => item.key === activeMaterialVersionKey) || coverMaterialVersions[0];
        const activeCoverFrameCandidates = activeCoverVersion ? frameCandidatesForPlan(activeCoverVersion.plan) : frameCandidates;
        const switchCoverMaterialVersion = (version: typeof coverMaterialVersions[number]) => {
          activateContentPlan(version.plan.id);
          previewLanguageVersion(version.code, false);
          const saved = materialVersionCovers[version.key];
          const candidates = frameCandidatesForPlan(version.plan);
          const savedCoverId = saved?.coverId && candidates.some(item => item.id === saved.coverId) ? saved.coverId : '';
          setCover(savedCoverId || candidates[0]?.id || '');
          setCoverTitle(saved?.title || coverTitle);
          setCoverStyle(saved?.style || coverStyle);
          setCoverUrl(saved?.coverUrl ?? null);
        };
        const batchApplyCoverStyle = () => {
          setMaterialVersionCovers(current => {
            const next = { ...current };
            coverMaterialVersions.forEach(version => {
              const candidates = frameCandidatesForPlan(version.plan);
              const currentCover = next[version.key];
              const coverId = currentCover?.coverId && candidates.some(item => item.id === currentCover.coverId)
                ? currentCover.coverId
                : candidates[0]?.id || cover;
              next[version.key] = { coverId, title: coverTitle, style: coverStyle, coverUrl: version.key === activeMaterialVersionKey ? coverUrl : null };
            });
            return next;
          });
          setModeNotice(`已将当前封面标题和艺术字参数同步到 ${coverMaterialVersions.length} 个素材版本。`);
        };
        const batchUseFirstFrames = () => {
          setMaterialVersionCovers(current => {
            const next = { ...current };
            coverMaterialVersions.forEach(version => {
              const first = frameCandidatesForPlan(version.plan)[0]?.id || '';
              next[version.key] = { coverId: first, title: current[version.key]?.title || coverTitle, style: current[version.key]?.style || coverStyle, coverUrl: null };
            });
            return next;
          });
          if (activeCoverFrameCandidates[0]?.id) {
            setCover(activeCoverFrameCandidates[0].id);
            setCoverUrl(null);
          }
          setModeNotice(`已为 ${coverMaterialVersions.length} 个素材版本按各自首个素材设置封面底图。`);
        };
        return (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(560px,1fr)_minmax(360px,460px)]">
            <div className="min-w-0 space-y-4">
              <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                <SectionTitle title="封面参数选择" desc="标题、艺术字和手动编辑会应用到当前选中的素材版本" noMargin />
                <div className="mt-4">
                  <p className="mb-1.5 text-xs font-semibold text-text-secondary">封面标题</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={coverTitle} onChange={e => setCoverTitle(e.target.value)}
                      className="min-w-[220px] flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
                    <button onClick={regenCovers} disabled={coverLoading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:border-border-bright disabled:opacity-60">
                      {coverLoading ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} AI 重写
                    </button>
                    <button onClick={() => void openCanvaCoverEditor()} disabled={coverCanvaOpening}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                      style={{ background: TRAFFIC_GREEN }}>
                      {coverCanvaOpening ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
                      编辑当前封面
                    </button>
                    <input ref={canvaReturnInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => void importCanvaCover(event.target.files)} />
                    <button type="button" onClick={() => canvaReturnInputRef.current?.click()} disabled={coverCanvaOpening}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:border-border-bright disabled:opacity-60">
                      <Upload size={13} /> 导回灵枢
                    </button>
                  </div>
                  {lang !== 'zh' && coverTitleZh && <p className="mt-1.5 text-[11px] text-text-muted">译：{coverTitleZh}</p>}
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-text-secondary">艺术字</p>
                      <p className="mt-0.5 text-[10px] text-text-muted">一键套用字体、颜色、描边和光影效果，仍可继续微调。</p>
                    </div>
                    <span className="rounded-md bg-accent-glow px-2 py-1 text-[10px] font-bold text-accent">即时预览</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {ART_PRESETS.map(preset => {
                      const active = (coverStyle.artPreset ?? 'clean') === preset.id;
                      const previewStyle = coverArtCss({ ...coverStyle, ...preset.patch, artPreset: preset.id });
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setCoverUrl(null);
                            setCoverStyle(current => ({ ...current, ...preset.patch, artPreset: preset.id }));
                          }}
                          className={`overflow-hidden rounded-xl border p-2 text-left transition ${active ? 'border-accent bg-accent/5 shadow-[0_0_0_1px_rgba(22,163,74,.18)]' : 'border-border bg-surface-2 hover:border-accent/40'}`}
                        >
                          <span className="flex h-12 items-center justify-center overflow-hidden rounded-lg bg-slate-800 px-1">
                            <span className="text-sm font-black leading-none" style={{ fontFamily: fontCss(preset.patch.font ?? coverStyle.font), ...previewStyle }}>{preset.sample}</span>
                          </span>
                          <span className="mt-1.5 block truncate text-center text-[10px] font-bold text-text-secondary">{preset.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-secondary">颜色</span>
                    {SWATCHES.map(c => (
                      <button key={c} onClick={() => setCoverStyle(s => ({ ...s, color: c }))}
                        className="h-5 w-5 rounded-full border transition-all"
                        style={{ background: c, borderColor: coverStyle.color === c ? TRAFFIC_GREEN : 'var(--color-border)', boxShadow: coverStyle.color === c ? `0 0 0 2px ${TRAFFIC_GREEN}` : undefined }} />
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-secondary">字号</span>
                    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
                      {(['S', 'M', 'L'] as const).map(z => <button key={z} className={SEG(coverStyle.size === z)} onClick={() => setCoverStyle(s => ({ ...s, size: z }))}>{z}</button>)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-secondary">位置</span>
                    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
                      {([['top', '上'], ['center', '中'], ['bottom', '下']] as const).map(([p, l]) => (
                        <button key={p} className={SEG(coverStyle.position === p && coverStyle.verticalPosition === undefined)} onClick={() => setCoverStyle(s => ({ ...s, position: p, verticalPosition: undefined }))}>{l}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-secondary">对齐</span>
                    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
                      {([['left', '左'], ['center', '居中']] as const).map(([a, l]) => <button key={a} className={SEG(coverStyle.align === a)} onClick={() => setCoverStyle(s => ({ ...s, align: a }))}>{l}</button>)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-secondary">粗细</span>
                    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
                      {([['regular', '常规'], ['bold', '加粗'], ['heavy', '特粗']] as const).map(([w, l]) => <button key={w} className={SEG((coverStyle.weight ?? 'bold') === w)} onClick={() => setCoverStyle(s => ({ ...s, weight: w }))}>{l}</button>)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-secondary">字体</span>
                    <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
                      {COVER_FONTS.map(f => <button key={f.id} className={SEG(coverStyle.font === f.id && !coverStyle.fontFamily)} style={{ fontFamily: f.css }} onClick={() => setCoverStyle(s => ({ ...s, font: f.id, fontFamily: undefined }))}>{f.label}</button>)}
                      {customFonts.map(cf => <button key={cf.family} className={SEG(coverStyle.fontFamily === cf.family)} style={{ fontFamily: cf.family }} onClick={() => setCoverStyle(s => ({ ...s, fontFamily: cf.family }))}>{cf.label}</button>)}
                    </div>
                    <input ref={fontInputRef} type="file" accept=".ttf,.otf,.woff,.woff2,font/*" className="hidden"
                      onChange={e => { void importFont(e.target.files); e.target.value = ''; }} />
                    <button onClick={() => fontInputRef.current?.click()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-text-muted hover:text-text-primary">
                      <Upload size={12} /> 导入字体模版
                    </button>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-text-primary">素材版本管理</p>
                    <p className="mt-1 text-[11px] text-text-muted">每个版本可独立选择封面底图；标题和艺术字可单独改，也可批量同步。</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-accent-glow px-2 py-1 text-[10px] font-black text-accent">{Object.keys(materialVersionCovers).length}/{coverMaterialVersions.length} 已配置</span>
                    <button type="button" onClick={batchApplyCoverStyle} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[11px] font-black text-white">
                      <Sparkles size={12} />批量同步参数
                    </button>
                    <button type="button" onClick={batchUseFirstFrames} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-black text-text-secondary hover:border-accent hover:text-accent">
                      <ImageIcon size={12} />批量首帧
                    </button>
                  </div>
                </div>
                <div className="mt-4 max-h-[min(520px,calc(100vh-520px))] min-h-[260px] space-y-2 overflow-y-auto pr-1">
                  {coverMaterialVersions.map((item, index) => {
                    const active = item.key === activeMaterialVersionKey;
                    const candidates = frameCandidatesForPlan(item.plan);
                    const saved = item.saved;
                    const coverId = active ? cover : (saved?.coverId || candidates[0]?.id || '');
                    const coverClipForVersion = candidates.find(candidate => candidate.id === coverId) || candidates[0];
                    return (
                      <div key={item.key} className={`rounded-xl border p-3 transition ${active ? 'border-accent bg-accent/5 shadow-[0_0_0_1px_var(--color-accent)]' : 'border-border bg-white hover:border-border-bright'}`}>
                        <button type="button" onClick={() => switchCoverMaterialVersion(item)} className="flex w-full items-center gap-3 text-left">
                          <span className="relative flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2">
                            {coverClipForVersion?.poster || coverClipForVersion?.url ? (
                              <img src={coverClipForVersion.poster || coverClipForVersion.url} alt="" className="h-full w-full object-cover" />
                            ) : <Film size={15} className="text-text-muted" />}
                            <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 text-[8px] font-bold text-white">{index + 1}</span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-xs font-black text-text-primary">{item.name}</span>
                              <span className="shrink-0 text-[9px] font-bold text-text-muted">{item.materialCount} 段素材</span>
                            </span>
                            <span className="mt-1 block truncate text-[10px] text-text-muted">{saved?.title || (active ? coverTitle : '沿用当前封面标题')}</span>
                          </span>
                          {active && <span className="rounded-md bg-accent px-2 py-1 text-[9px] font-black text-white">编辑中</span>}
                        </button>
                        <div className="mt-3 flex items-center gap-2 border-t border-border/70 pt-3">
                          <ImageIcon size={13} className="shrink-0 text-text-muted" />
                          <select
                            value={coverId}
                            onClick={event => event.stopPropagation()}
                            onChange={event => {
                              const nextCover = event.target.value;
                              if (!active) switchCoverMaterialVersion(item);
                              setCover(nextCover);
                              setCoverUrl(null);
                              setMaterialVersionCovers(current => ({
                                ...current,
                                [item.key]: { coverId: nextCover, title: active ? coverTitle : saved?.title || coverTitle, style: active ? coverStyle : saved?.style || coverStyle, coverUrl: null },
                              }));
                            }}
                            className="min-w-0 flex-1 rounded-lg border border-border bg-white px-2.5 py-2 text-[11px] font-bold text-text-secondary outline-none focus:border-accent"
                          >
                            {candidates.length ? candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>) : <option value="">暂无可用封面素材</option>}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                  {coverMaterialVersions.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border bg-surface-2 px-4 py-8 text-center text-xs text-text-muted">
                      暂无素材版本。请先完成分镜、配音和素材选择。
                    </div>
                  )}
                </div>
              </section>
            </div>

            <aside className="sticky top-4 rounded-2xl border border-border bg-surface p-4 shadow-sm">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-text-primary">实时封面预览</p>
                  <p className="mt-0.5 truncate text-[11px] text-text-muted">{activeCoverVersion?.name || '当前素材版本'}</p>
                </div>
                <span className="shrink-0 rounded-md bg-accent-glow px-2 py-1 text-[10px] font-black text-accent">草稿</span>
              </div>
              <div className="mx-auto w-full max-w-[260px]">
                <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-xl">
                  <div className="relative aspect-[9/16]">
                    {coverFrameUrl ? (
                      <CoverFace
                        coverUrl={coverUrl}
                        frameUrl={coverFrameUrl}
                        frameType={coverClip?.poster ? 'image' : coverClip?.type}
                        fallbackVideoUrl={coverClip?.type === 'video' ? coverClip.url : undefined}
                        title={coverTitle}
                        style={coverStyle}
                        editable
                        onTitleChange={setCoverTitle}
                        onStyleChange={nextStyle => { setCoverUrl(null); setCoverStyle(nextStyle); }}
                        onFrameReady={coverClip?.type === 'video' ? dataUrl => {
                          setMaterials(prev => prev.map(item => item.id === coverClip.id ? { ...item, poster: dataUrl } : item));
                        } : undefined}
                        onSourceError={() => { if (coverClip) void refreshMaterialSource(coverClip.id); }}
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white/60">
                        <ImageIcon size={30} className="mb-3 opacity-60" />
                        <p className="text-xs font-bold">还没有可用封面素材</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-white/45">返回“选素材”完成分镜匹配后即可预览</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-xl bg-surface-2 px-3 py-2.5">
                <p className="truncate text-xs font-bold text-text-primary">{coverClip?.name || '未选择封面底图'}</p>
                <p className="mt-1 text-[10px] leading-relaxed text-text-muted">在右侧预览里可直接编辑选中版本标题位置；使用“批量同步参数”可同步到全部版本。</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={batchApplyCoverStyle} className="rounded-xl border border-accent bg-accent-glow px-3 py-2 text-[11px] font-black text-accent">
                  批量封面编辑
                </button>
                <button type="button" onClick={() => void openCanvaCoverEditor()} disabled={coverCanvaOpening}
                  className="rounded-xl border border-border px-3 py-2 text-[11px] font-black text-text-secondary hover:border-accent hover:text-accent disabled:opacity-50">
                  编辑当前版本
                </button>
              </div>
            </aside>
          </div>
        );
      }

      /* ⑥ 成片预览 */
      case 'preview': {
        const activePreviewItem = previewIdx !== null ? previewTimeline[previewIdx] : null;
        const previewTimelineDuration = renderTimeline.reduce((sum, item) => sum + (item.targetDuration || 0), 0);
        const outputVersions = buildRenderableVideoVersions().map(({ key, code, plan, planIndex, languageIndex, bgmId, script: versionScript, timeline: planTimeline }) => ({
            id: key, key, code, plan, bgmId,
            name: `${plan.name || `视频${planIndex + 1}`} * ${langZh(code) || `语种${languageIndex + 1}`}`,
            language: LANGS.find(item => item.code === code)?.label || code.toUpperCase(),
            script: versionScript,
            materials: planTimeline.map(item => item.name),
            bgm: bgms.find(item => item.id === bgmId)?.name || '无配乐',
            output: languageRenderOutputs[key],
            generations: languageRenderVersions[key] || [],
          }));
        const fallbackActiveKey = renderCombinationKey(activeAssemblyId, activeVoiceLang, bgm);
        const activeOutputVersion = outputVersions.find(item => item.key === activeRenderCombinationKey)
          || outputVersions.find(item => item.key === fallbackActiveKey)
          || outputVersions[0];
        const hasFormalVideo = Boolean(renderOutputPath || outputVersions.some(version => (
          Boolean(version.output?.status === 'done' && version.output.path)
          || version.generations.some(generation => generation.status === 'done' && generation.path)
        )));
        const selectOutputVersion = (version: typeof outputVersions[number]) => {
          stopPreview();
          setActiveRenderCombinationKey(version.key);
          activateContentPlan(version.plan.id);
          setBgm(version.bgmId);
          previewLanguageVersion(version.code, false);
          if (version.output?.path) {
            setRenderOutputPath(version.output.path);
            setRenderOutputPreviewUrl(version.output.previewUrl || null);
          }
        };
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
                      // 按时间戳 timeline 播放：视频未解码前保留素材封面，避免实时预览只剩黑屏。
                      <>
                        {activePreviewItem.clip.poster && <img src={activePreviewItem.clip.poster} alt="素材预览帧" className="absolute inset-0 h-full w-full object-cover" />}
                        <video
                          key={`${activePreviewItem.clipId}-${activePreviewItem.trimStart}-${activePreviewItem.targetStart}`}
                          ref={previewVideoRef}
                          src={activePreviewItem.clip.url}
                          poster={activePreviewItem.clip.poster}
                          autoPlay
                          preload="auto"
                          controls
                          playsInline
                          muted={!previewOriginalOn}
                          className={`absolute inset-0 w-full h-full object-cover bg-black ${previewVideoReady ? 'opacity-100' : 'opacity-0'}`}
                          onLoadedData={() => { setPreviewVideoReady(true); setPreviewNote(false); }}
                          onCanPlay={() => setPreviewVideoReady(true)}
                          onError={() => { setPreviewVideoReady(false); setPreviewNote(true); }}
                          onPause={pausePreviewAudio}
                          onPlay={resumePreviewAudio}
                          onWaiting={pausePreviewAudio}
                          onPlaying={resumePreviewAudio}
                          onTimeUpdate={updatePreviewClock}
                          onEnded={handlePreviewClipEnded}
                        />
                      </>
                    )
                  ) : (
                    <CoverFace coverUrl={coverUrl} frameUrl={coverFrameUrl} frameType={coverClip?.poster ? 'image' : coverClip?.type} fallbackVideoUrl={coverClip?.type === 'video' ? coverClip.url : undefined} title={coverTitle} style={coverStyle} />
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
                        <p className="text-white text-xs font-medium">{renderPct >= 90 ? '正在写入 MP4…' : 'AI 合成中…'} {renderPct}%</p>
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
              <SectionTitle title="素材成片预览" desc="确认效果、下载本地成片或进入账号发布" />
              <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
                <div className="rounded-2xl border border-border bg-surface-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-text-primary">视频版本</p>
                      <p className="mt-0.5 text-xs text-text-muted">仅显示具备有效脚本和完整有效分镜的版本；配音、配乐为可选项。</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void renderLanguageVersions()}
                      disabled={batchRenderingLangs || outputVersions.length === 0}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {batchRenderingLangs ? <Loader2 size={13} className="animate-spin" /> : <Languages size={13} />}
                      {batchRenderingLangs ? '生成中...' : '生成全部视频'}
                    </button>
                  </div>
                  <div className="mt-3 grid max-h-[360px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
                    {outputVersions.map(version => {
                      const item = version.output;
                      const active = activeOutputVersion?.id === version.id;
                      return (
                        <div key={version.id} className={`rounded-xl border bg-white px-3 py-2.5 transition ${active ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]' : 'border-border'}`}>
                          <button type="button" onClick={() => selectOutputVersion(version)}
                            className="w-full text-left"
                            title="点击在左侧预览该视频版本">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-black text-text-primary">{version.name}</span>
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
                                : '可生成'}
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs font-bold text-text-secondary">{version.language}</p>
                          <p className="mt-1 truncate text-[10px] text-text-muted">{version.materials.length} 段素材 · {version.bgm}</p>
                          </button>
                          {version.generations.length > 0 && <div className="mt-2 flex flex-wrap gap-1 border-t border-border pt-2">
                            {version.generations.map(generation => <button key={generation.id} type="button" onClick={() => {
                              setLanguageRenderOutputs(prev => ({ ...prev, [version.key]: { status: generation.status, path: generation.path, previewUrl: generation.previewUrl, error: generation.error } }));
                              if (generation.path) {
                                setRenderOutputPath(generation.path);
                                setRenderOutputPreviewUrl(generation.previewUrl || null);
                              }
                            }} className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold text-text-secondary">
                              V{generation.versionNumber}{generation.status === 'failed' ? ' 失败' : ''}
                            </button>)}
                          </div>}
                          {item?.status === 'failed' && (
                            <button type="button" onClick={() => void retryLanguageRender(version)}
                              className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-accent">
                              <RefreshCw size={10} /> 仅重试此组合
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {outputVersions.length === 0 && (
                    <div className="mt-3 rounded-xl border border-dashed border-border bg-white px-4 py-8 text-center text-xs text-text-muted">
                      暂无符合生成条件的视频版本，请先完成有效脚本和全部分镜素材匹配。
                    </div>
                  )}
                  {activeOutputVersion && (
                    <div className="mt-3 rounded-xl border border-border bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-black text-text-primary">{activeOutputVersion.name} 配置</p>
                        <span className="text-[10px] font-bold text-accent">正在预览</span>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-lg bg-surface-2 px-2.5 py-2"><p className="text-[10px] text-text-muted">语言 / 脚本</p><p className="mt-0.5 truncate text-xs font-bold text-text-primary">{activeOutputVersion.language} · {activeOutputVersion.script || '无脚本'}</p></div>
                        <div className="rounded-lg bg-surface-2 px-2.5 py-2"><p className="text-[10px] text-text-muted">素材组合</p><p className="mt-0.5 truncate text-xs font-bold text-text-primary">{activeOutputVersion.materials.join('、') || '未选择素材'}</p></div>
                        <div className="rounded-lg bg-surface-2 px-2.5 py-2"><p className="text-[10px] text-text-muted">背景配乐</p><p className="mt-0.5 truncate text-xs font-bold text-text-primary">{activeOutputVersion.bgm}</p></div>
                        <div className="rounded-lg bg-surface-2 px-2.5 py-2"><p className="text-[10px] text-text-muted">输出状态</p><p className="mt-0.5 truncate text-xs font-bold text-text-primary">{activeOutputVersion.output?.status === 'done' ? '成片已生成' : activeOutputVersion.output?.status === 'rendering' ? '生成中' : '可实时预览'}</p></div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-4 rounded-2xl border border-accent/20 bg-accent/5 p-4">
                  <div className="flex items-start gap-3"><Globe size={16} className="mt-0.5 shrink-0 text-accent" /><div><p className="text-xs font-black text-text-primary">平台发布建议</p>
                    <p className="mt-1 text-xs leading-relaxed text-text-secondary">{platform === 'youtube'
                      ? '相同画面的多语言版本建议合并为 1 个 YouTube 视频，不同语言作为多语言音轨；只有素材、开场或叙事明显不同时才建议独立发布。'
                      : platform === 'tiktok'
                        ? '建议每套内容只选择 1 个最佳音色与配乐版本发布；仅更换音色、配乐或字幕的候选不建议在同一账号集中发布。'
                        : '建议每套内容只发布 1 个采用版本；仅更换配乐、音色、字幕或封面不视为独立内容。'}</p>
                  </div></div>
                </div>
                <button
                  onClick={() => void downloadMp4()}
                  disabled={rendering}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-4 text-base font-black text-white shadow-sm transition disabled:opacity-50 active:scale-[0.99]"
                >
                  {rendering ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  {rendering ? (renderPct >= 90 ? `正在写入 MP4 ${renderPct}%` : `正在生成本地成片 ${renderPct}%`) : renderOutputPath ? '打开本地成片' : '下载成片到本地'}
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
                  onClick={goPublishCurrentWork}
                  disabled={!hasFormalVideo || rendering || batchRenderingLangs}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-accent bg-white px-5 py-4 text-base font-black text-accent shadow-sm transition hover:bg-accent-glow active:scale-[0.99] disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-text-muted disabled:shadow-none"
                >
                  <Send size={18} />
                  {hasFormalVideo ? '去账号一键发布' : '请先生成成片'}
                </button>
                <p className="mt-3 text-xs leading-relaxed text-text-muted">
                  下载本地成片用于留档；一键发布会跳转到顶部总控的账号发布页，并带入当前作品标题、文案和成片信息。
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
          {mode === 'clone' && contentMode === 'video' && (
            <button onClick={() => void saveProject('template')} disabled={savingProj || voiceDraftLoading || ttsLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-50 transition-colors">
              <Copy size={13} /> 保存为母版
            </button>
          )}
          <button onClick={() => void saveProject('draft')} disabled={savingProj || voiceDraftLoading || ttsLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:border-border-bright disabled:opacity-50 transition-colors">
            {savingProj ? <Loader2 size={13} className="animate-spin" /> : savedTick ? <Check size={13} className="text-accent" /> : <Save size={13} />}
            {savedTick ? '已保存' : '保存草稿'}
          </button>
          <button onClick={() => void openProjects()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all active:scale-95"
            style={{ background: TRAFFIC_GREEN }}>
            <FolderOpen size={13} /> 我的创作
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
          {activeSteps.map((s, i) => {
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
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }} className="h-full">
              {renderStep()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* 底部导航条 */}
        <div data-lingshu-assistant-clearance="bottom-navigation" className="h-14 flex items-center justify-between px-6 border-t border-border flex-shrink-0">
          <button onClick={prev} disabled={stepIdx === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-text-secondary hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
            <ChevronLeft size={15} /> 上一步
          </button>
          <div className="flex items-center gap-1.5">
            {activeSteps.map((_, i) => (
              <span key={i} className="h-1 rounded-full transition-all"
                style={{ width: i === stepIdx ? 18 : 6, background: i <= stepIdx ? TRAFFIC_GREEN : 'var(--color-border)' }} />
            ))}
          </div>
          {!isLast ? (
            <button onClick={next} disabled={!canNext}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-40"
              style={{ background: TRAFFIC_GREEN }}>
              {step === 'script'
                ? scriptStageTab === 'theme' ? '确认主题并进入分镜生成' : voiceoverMode === 'none' ? '确认字幕并进入素材匹配' : '试听确认并进入素材匹配'
                : step === 'material' && contentMode === 'video'
                  ? canNext
                    ? '完成选材并进入配乐'
                    : `还需放入 ${Math.max(0, storyboardSlots.length - assignedCount)} 个分镜视频`
                  : '下一步'} <ChevronRight size={15} />
            </button>
          ) : (
            <span className="w-[88px]" />
          )}
        </div>
      </div>

      {/* ── ③ 对标内容 / 产品信息右侧栏 ────────────────── */}
      {step === 'mode' && (
        <aside data-studio-context-rail="true" className="hidden w-[280px] flex-shrink-0 overflow-y-auto border-l border-border bg-surface-2/30 p-3 lg:block xl:w-[360px] xl:p-4 2xl:w-[400px]">
          {mode === 'product'
            ? <ProductInfoPreview products={selectedProductOptions} />
            : <BenchmarkVideoPreview kickoff={videoKickoff} />}
        </aside>
      )}

      </div>

      {/* ── 我的作品 / 草稿 列表浮层 ─────────────────────── */}
      <AnimatePresence>
        {existingSourceDraftPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="existing-source-draft-title"
              className="grid w-full max-w-[720px] grid-cols-1 overflow-hidden rounded-lg border border-border bg-white shadow-2xl sm:grid-cols-[minmax(0,1fr)_220px]"
            >
              <div className="flex min-w-0 flex-col justify-center p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-glow text-accent">
                  <FolderOpen size={20} />
                </div>
                <h2 id="existing-source-draft-title" className="text-base font-black text-text-primary">
                  基于本素材已经生成过草稿了，是否要新建作品集？
                </h2>
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-muted">{existingSourceDraftPrompt.title}</p>
                <p className="mt-2 text-[11px] text-text-muted">
                  {existingSourceDraftPrompt.matchCount > 1
                    ? `检测到 ${existingSourceDraftPrompt.matchCount} 条历史草稿，将优先继续最近更新的一条。`
                    : '可以继续最近的草稿，也可以从当前素材重新创建。'}
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const project = existingSourceDraftPrompt.project;
                      setExistingSourceDraftPrompt(null);
                      setSourceDraftCheckPending(false);
                      loadProject(project);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-xs font-black text-white hover:bg-accent/90"
                  >
                    <FolderOpen size={14} />继续编辑已有草稿
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProjectId(null);
                      setExistingSourceDraftPrompt(null);
                      setSourceDraftCheckPending(false);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2.5 text-xs font-black text-text-secondary hover:border-accent/40 hover:bg-surface-2"
                  >
                    <Plus size={14} />新建作品集
                  </button>
                </div>
              </div>
              <div className="min-h-[180px] border-t border-border bg-surface-2 sm:min-h-[300px] sm:border-l sm:border-t-0">
                {existingSourceDraftPrompt.poster ? (
                  <img src={existingSourceDraftPrompt.poster} alt="来源视频素材封面" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full min-h-[180px] items-center justify-center text-text-muted sm:min-h-[300px]">
                    <Film size={34} className="opacity-35" />
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
        {showProjects && (
          <ProjectsOverlay
            projects={projects}
            batches={variationBatches}
            materials={materials}
            currentId={projectId}
            onClose={() => setShowProjects(false)}
            onLoad={loadProject}
            onDelete={removeProject}
            onReview={reviewVariationItem}
            onReuseProject={reuseProject}
            onReuse={reuseVariationBatch}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── 我的作品 / 草稿 浮层 ─────────────────────────────────────────────── */
function ProjectsOverlay({ projects, batches, materials, currentId, onClose, onLoad, onDelete, onReview, onReuseProject, onReuse }: {
  projects: StudioProject[];
  batches: VariationBatch[];
  materials: Clip[];
  currentId: string | null;
  onClose: () => void;
  onLoad: (p: StudioProject) => void;
  onDelete: (id: string) => void;
  onReview: (batchId: string, itemId: string, status: 'approved' | 'rejected') => void;
  onReuseProject: (p: StudioProject) => void | Promise<void>;
  onReuse: (batch: VariationBatch) => void;
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
              <div className="relative">
                <ProjectFirstFrameThumb project={p} materials={materials} />
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation();
                    void onReuseProject(p);
                  }}
                  className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-lg bg-accent px-2 py-1 text-[10px] font-black text-white shadow-sm hover:brightness-95"
                  title="复制为新草稿并进入编辑"
                >
                  <Copy size={10} /> 一键复用
                </button>
              </div>
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
            <span className="text-sm font-bold text-text-primary">我的创作</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-primary transition-colors">
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {drafts.length === 0 && works.length === 0 && batches.length === 0 ? (
            <div className="text-center py-12">
              <FolderOpen size={28} className="mx-auto text-text-muted mb-3 opacity-30" />
              <p className="text-sm text-text-muted">还没有保存任何草稿或作品</p>
              <p className="text-xs text-text-muted mt-1">在工作台点「保存草稿」即可留存</p>
            </div>
          ) : (
            <>
              <Section title="作品集草稿" items={drafts} />
              <Section title="已发布作品集" items={works} />
              {batches.length > 0 && (
                <div className="mb-5">
                  <p className="mb-2 text-xs font-semibold text-text-secondary">裂变批次 · {batches.length}</p>
                  <div className="space-y-2">
                    {batches.map(batch => (
                      <div key={batch.id} className="rounded-xl border border-border bg-surface-2 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div><p className="text-xs font-bold text-text-primary">{batch.title}</p><p className="mt-0.5 text-[10px] text-text-muted">{batch.items.length} 条 · 预算上限 ¥{batch.estimatedCostCny} · {batch.status}</p></div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button type="button" onClick={() => void onReuse(batch)}
                              className="flex items-center gap-1 rounded-md border border-accent/25 bg-white px-2 py-1 text-[10px] font-bold text-accent transition hover:bg-accent/10">
                              <Copy size={10} /> 复用
                            </button>
                          </div>
                        </div>
                        {batch.items.filter(item => item.status === 'review').map(item => (
                          <div key={item.id} className="mt-2 flex items-center gap-2 rounded-lg bg-surface px-2.5 py-2">
                            <p className="min-w-0 flex-1 truncate text-[10px] text-text-secondary">{Object.values(item.variables).join(' · ')}{item.qualityScore != null ? ` · 质检 ${item.qualityScore}` : ''}</p>
                            <button onClick={() => onReview(batch.id, item.id, 'approved')} className="text-[10px] font-bold text-accent">通过</button>
                            <button onClick={() => onReview(batch.id, item.id, 'rejected')} className="text-[10px] font-bold text-red">驳回</button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
