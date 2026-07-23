import OpenAI from 'openai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VideoAiAnalysis } from '../types/index.js';
import { normalizeVideoAnalysis } from './gemini.js';

const QWEN_VL_MODEL = () => (process.env.QWEN_VL_MODEL ?? 'qwen-vl-max').trim();
const QWEN_EXACT_VL_MODEL = () => (process.env.QWEN_EXACT_VL_MODEL ?? 'qwen3-vl-flash').trim();
const BASE_URL = () => (process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1').trim();

function client(): OpenAI {
  const keyFile = (process.env.DASHSCOPE_API_KEY_FILE || path.join(os.homedir(), '.config/lingshu/dashscope.key')).trim();
  let fileKey = '';
  try { fileKey = fs.readFileSync(keyFile, 'utf8').trim(); } catch { /* optional local secret file */ }
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim() || fileKey;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY is not set');
  return new OpenAI({
    apiKey,
    baseURL: BASE_URL(),
    timeout: Math.max(30_000, Number(process.env.QWEN_REQUEST_TIMEOUT_MS || 90_000)),
    maxRetries: Math.max(0, Math.min(2, Number(process.env.QWEN_MAX_RETRIES || 0))),
  });
}

export interface QwenAsrSegment { start: number; end: number; text: string; confidence?: number }
export interface ImagePostEvidenceAnalysis {
  version: 2;
  status: 'analyzed';
  observedFacts: Array<{ imageIndex: number; subjects: string[]; scene: string; composition: string; colors: string[]; visibleText: string[]; confidence: number }>;
  carouselFlow: Array<{ imageIndex: number; role: 'attention' | 'product' | 'detail' | 'proof' | 'process' | 'cta' | 'unknown'; evidence: string; confidence: number }>;
  copyEvidence: { hooks: Array<{ text: string; source: 'caption' | 'ocr'; evidence: string }>; sellingPoints: Array<{ text: string; source: 'caption' | 'ocr'; evidence: string }>; cta: string[] };
  reusableModules: Array<{ module: string; evidence: string; preserve: string; replace: string; confidence: number }>;
  uncertainties: string[];
}
export async function transcribeAudioWithQwen(opts: { audio: Buffer; fileName?: string }): Promise<{ text: string; segments: QwenAsrSegment[] }> {
  const completion = await client().chat.completions.create({
    model: process.env.QWEN_ASR_MODEL || 'qwen3-asr-flash',
    messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/mpeg;base64,${opts.audio.toString('base64')}` } }] as any }],
    stream: false,
    asr_options: { enable_itn: true },
  } as any);
  const text = String(completion.choices[0]?.message?.content || '').trim();
  return { text, segments: text ? [{ start: 0, end: 0, text }] : [] };
}

function parseJson<T>(raw: string, fallback: T): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    try { return JSON.parse(match[0]) as T; } catch { return fallback; }
  }
}

export async function analyzeVideoFramesWithQwen(opts: {
  frames: Array<{ base64: string; mimeType: string; timeLabel: string }>;
  title?: string;
  platform?: string;
  duration?: number;
  views?: string;
  tags?: string[];
  transcript?: { text: string; segments: QwenAsrSegment[] };
  analysisMode?: 'strategy' | 'exact';
}): Promise<VideoAiAnalysis> {
  if (opts.frames.length === 0) throw new Error('Qwen frame analysis requires at least one frame');

  const modeInstruction = opts.analysisMode === 'exact'
    ? '当前为全片精确分析：逐张比较全片高密度关键帧，主体动作、对象、构图、运镜、台词或营销功能变化时必须新建镜头，不得合并有效动作。'
    : '当前为全片策略分析：必须覆盖从 0 秒到结尾，但镜头密度跟随真实内容变化；重复或稳定画面合并为区间并用 beats 记录变化，禁止无意义逐秒拆分。';
  const systemPrompt = `你是一个面向出海电商营销的短视频内容分析专家。
${modeInstruction}
你会收到按时间顺序排列的关键帧，以及标题、平台、热度、标签等资料。视频首 4 秒按每秒 3 帧密集抽取，其余为均匀帧和转场帧；必须逐张比较相邻帧，时间精度以帧间隔为上限。
请基于画面、字幕、标题和元数据推断短视频结构。无法从关键帧确认的字幕、音频或口播必须留空，不要写“按画面/字幕推断”，不要编造品牌、@账号、字幕或台词。
必须严格区分“可见事实”和“表达意图”：可见事实只写帧中实际出现的物体状态、接触关系、动作和变化；表达意图允许根据上下文推断营销含义，但不得把推断的前因补写成画面动作。例如首帧纸巾已经湿润、随后直接落下，只能写“湿纸巾已位于眼下并落下”，不得编造“流泪后反复擦眼睛”。
动作分析必须记录：动作开始/结束时间、手是否入镜、手与物体/面部是否接触、物体初始和结束状态、眼神方向、表情、头部姿态、镜头是否真的移动。界面贴纸、平台 UI 和字幕层必须与真人实拍内容分开。
除 recommendedScriptType 字段外，所有字符串内容必须使用简体中文输出。
只输出合法 JSON，不要 markdown，不要代码块，不要前后解释。

必需 JSON 字段：
- theme: string，用一句中文概括视频核心主题/产品/场景
- hooks: string[], 2-4 个中文开头钩子或吸引注意力的方法
- sellingPoints: string[], 3-6 个中文卖点、利益点或画面展示点
- mood: string，中文情绪/风格描述
- structure: string，中文叙事结构，例如“痛点 -> 展示 -> 证明 -> CTA”
- baseRequirements: string，作为第一段“基础要求”输出，必须包含情绪氛围、光影、全片主要场景、质感、基础创作要求；基础创作要求需明确强反转、真人口播、卡点、特效拉满、产品质感等可执行方向
- firstTenSeconds: object，详细分析视频前 10 秒，包含中文字段 atmosphere、audioVisual、camera、visuals、voiceMusic
- coarseStructure: array，覆盖原视频完整时长，按内容结构变化拆解；每项包含 time、label、description
- scriptSummary15s: object，15 秒脚本详析摘要，包含 visualStyle、coreEmotion、competitors
  - scriptDetails15s: array（字段名仅为历史兼容），必须覆盖原视频完整时长，不得在15秒处截断；按导演镜头详析；每项包含 time（start-end区间，最多两位小数）、environment、shot、camera、purpose、visual、dialogue、onScreenText、ambientSound、bgm、soundEffects、beats、persistentState、authenticity、observedFacts、inferredIntent、causalGap、omniPrompt、omniNegativePrompt、confidence、needsReview、subtitle、audio、note。observedFacts 只写可见事实；inferredIntent 明确标注推断的表达意图；causalGap 写意图中存在但视频未展示的因果动作；omniPrompt 用英文写可直接交给视频模型的逐时段动作提示，必须复现可见动作，不得擅自补 causalGap；omniNegativePrompt 用英文列出最容易生成错的动作、物理关系和 UI。主体动作/对象/运镜/营销功能改变才切镜；长镜头用 beats 记录镜头内 time/action/dialogue/onScreenText。口播、画面字幕、环境声、BGM和音效必须分开；无法确认留空，专名/价格/左右方向/ASR不确定需 needsReview=true
- recommendedScriptType: "voiceover" | "storyboard"`;

  const meta = [
    `标题：${opts.title || '未知'}`,
    `平台：${opts.platform || '未知'}`,
    opts.duration ? `时长：${opts.duration}s` : '',
    opts.views ? `热度/播放：${opts.views}` : '',
    opts.tags?.length ? `标签：${opts.tags.join(', ')}` : '',
    `关键帧时间：${opts.frames.map(frame => frame.timeLabel).join(', ')}`,
    opts.transcript?.segments.length ? `独立ASR逐段转写（优先用于dialogue，专名/价格仍需结合画面校验）：\n${opts.transcript.segments.map(item => `[${item.start.toFixed(1)}-${item.end.toFixed(1)}s] ${item.text}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');

  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: `${meta}\n\n请分析这些关键帧，输出上述 JSON。` },
    ...opts.frames.map(frame => ({
      type: 'image_url',
      image_url: { url: `data:${frame.mimeType};base64,${frame.base64}` },
    })),
  ];

  const completion = await client().chat.completions.create({
    model: opts.analysisMode === 'exact' ? QWEN_EXACT_VL_MODEL() : QWEN_VL_MODEL(),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: content as any },
    ],
    response_format: { type: 'json_object' },
    max_tokens: Number(opts.duration || 0) > 60 ? 8000 : 4500,
  });

  const raw = completion.choices[0]?.message?.content ?? '';
  const parsed = parseJson<Partial<VideoAiAnalysis>>(raw, {});
  let normalized = normalizeVideoAnalysis(parsed);
  if (!normalized.scriptDetails15s?.length) {
    const repair = await client().chat.completions.create({
      model: opts.analysisMode === 'exact' ? QWEN_EXACT_VL_MODEL() : QWEN_VL_MODEL(),
      messages: [
        { role: 'system', content: `你是视频导演分镜修复器。只输出合法JSON对象，且只能包含scriptDetails15s。首4秒是每秒3帧，必须逐相邻帧比较，不得跳过亚秒动作。每项包含time、environment、shot、camera、purpose、visual、dialogue、onScreenText、ambientSound、bgm、soundEffects、beats、persistentState、authenticity、observedFacts、inferredIntent、causalGap、omniPrompt、omniNegativePrompt、confidence、needsReview、subtitle、audio、note。observedFacts只能写实际可见内容，inferredIntent写推断含义，causalGap写未展示的因果动作；绝不能把causalGap补进visual、beats或omniPrompt。omniPrompt和omniNegativePrompt使用英文。time必须为start-end s区间；口播与屏幕字幕分离；品牌、款名、价格、左右眼不确定时needsReview=true。` },
        { role: 'user', content: content as any },
      ],
      response_format: { type: 'json_object' },
      max_tokens: Number(opts.duration || 0) > 60 ? 8000 : 4500,
    });
    const repaired = parseJson<Partial<VideoAiAnalysis>>(repair.choices[0]?.message?.content ?? '', {});
    normalized = normalizeVideoAnalysis({ ...parsed, scriptDetails15s: repaired.scriptDetails15s });
  }
  return normalized;
}

export async function analyzeImagePostEvidenceWithQwen(opts: {
  images: Array<{ base64: string; mimeType: string; imageIndex: number }>;
  title?: string;
  caption?: string;
  platform?: string;
  tags?: string[];
}): Promise<ImagePostEvidenceAnalysis> {
  if (!opts.images.length) throw new Error('Qwen image evidence analysis requires at least one image');
  const prompt = `你是外贸 B2B 社媒竞品图文的证据提取器。你会收到按轮播顺序排列的公开图片，以及原始 caption 和标签。
只描述图片中实际可见或原文中明确出现的内容，不判断“为什么爆”，不编造目标人群、效果、认证、价格、MOQ、工厂资质或互动结果。
必须区分观察事实与推断。无法确认就写入 uncertainties。所有字符串用简体中文。只输出合法 JSON。

Schema:
{
  "version": 2,
  "status": "analyzed",
  "observedFacts": [{"imageIndex":1,"subjects":[],"scene":"","composition":"","colors":[],"visibleText":[],"confidence":0.0}],
  "carouselFlow": [{"imageIndex":1,"role":"attention|product|detail|proof|process|cta|unknown","evidence":"基于可见内容的理由","confidence":0.0}],
  "copyEvidence": {
    "hooks": [{"text":"原文或OCR中的文字","source":"caption|ocr","evidence":"对应原句"}],
    "sellingPoints": [{"text":"原文或OCR中的明确卖点","source":"caption|ocr","evidence":"对应原句"}],
    "cta": ["原文或OCR中明确出现的行动指令"]
  },
  "reusableModules": [{"module":"布局或信息模块","evidence":"可见证据","preserve":"可复用的通用结构","replace":"必须替换的竞品内容","confidence":0.0}],
  "uncertainties": []
}

硬规则：
- observedFacts 按每张图分别输出，imageIndex 从 1 开始。
- visibleText 只能写实际能读清的 OCR 文字。
- reusableModules 只能复用构图、信息层级、色彩关系、轮播功能；竞品品牌、Logo、产品、包装、联系方式必须写入 replace。
- 不输出爆款评分，不根据点赞量推断因果。`;
  const meta = [
    `标题：${opts.title || ''}`,
    `原始 caption：${opts.caption || ''}`,
    `平台：${opts.platform || ''}`,
    opts.tags?.length ? `标签：${opts.tags.join(', ')}` : '',
    `图片数量：${opts.images.length}`,
  ].filter(Boolean).join('\n');
  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: `${meta}\n\n按顺序分析下面的轮播图片。` },
    ...opts.images.sort((a, b) => a.imageIndex - b.imageIndex).map(image => ({
      type: 'image_url',
      image_url: { url: `data:${image.mimeType};base64,${image.base64.replace(/^data:[^,]+,/, '')}` },
    })),
  ];
  const completion = await client().chat.completions.create({
    model: QWEN_VL_MODEL(),
    messages: [{ role: 'system', content: prompt }, { role: 'user', content: content as any }],
    response_format: { type: 'json_object' },
    max_tokens: 7000,
  });
  const parsed = parseJson<Partial<ImagePostEvidenceAnalysis>>(completion.choices[0]?.message?.content ?? '', {});
  if (!Array.isArray(parsed.observedFacts) || !parsed.observedFacts.length) throw new Error('Qwen returned no image facts');
  return {
    version: 2,
    status: 'analyzed',
    observedFacts: parsed.observedFacts.slice(0, opts.images.length),
    carouselFlow: Array.isArray(parsed.carouselFlow) ? parsed.carouselFlow.slice(0, opts.images.length) : [],
    copyEvidence: {
      hooks: Array.isArray(parsed.copyEvidence?.hooks) ? parsed.copyEvidence!.hooks.slice(0, 8) : [],
      sellingPoints: Array.isArray(parsed.copyEvidence?.sellingPoints) ? parsed.copyEvidence!.sellingPoints.slice(0, 12) : [],
      cta: Array.isArray(parsed.copyEvidence?.cta) ? parsed.copyEvidence!.cta.slice(0, 6) : [],
    },
    reusableModules: Array.isArray(parsed.reusableModules) ? parsed.reusableModules.slice(0, 12) : [],
    uncertainties: Array.isArray(parsed.uncertainties) ? parsed.uncertainties.map(String).slice(0, 12) : [],
  };
}
