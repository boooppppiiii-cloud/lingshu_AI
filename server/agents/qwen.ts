import OpenAI from 'openai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VideoAiAnalysis } from '../types/index.js';
import { normalizeVideoAnalysis } from './gemini.js';

const QWEN_VL_MODEL = () => (process.env.QWEN_VL_MODEL ?? 'qwen-vl-max').trim();
const BASE_URL = () => (process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1').trim();

function client(): OpenAI {
  const keyFile = (process.env.DASHSCOPE_API_KEY_FILE || path.join(os.homedir(), '.config/lingshu/dashscope.key')).trim();
  let fileKey = '';
  try { fileKey = fs.readFileSync(keyFile, 'utf8').trim(); } catch { /* optional local secret file */ }
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim() || fileKey;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY is not set');
  return new OpenAI({ apiKey, baseURL: BASE_URL() });
}

export interface QwenAsrSegment { start: number; end: number; text: string; confidence?: number }
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
    model: QWEN_VL_MODEL(),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: content as any },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 8000,
  });

  const raw = completion.choices[0]?.message?.content ?? '';
  const parsed = parseJson<Partial<VideoAiAnalysis>>(raw, {});
  let normalized = normalizeVideoAnalysis(parsed);
  if (!normalized.scriptDetails15s?.length) {
    const repair = await client().chat.completions.create({
      model: QWEN_VL_MODEL(),
      messages: [
        { role: 'system', content: `你是视频导演分镜修复器。只输出合法JSON对象，且只能包含scriptDetails15s。首4秒是每秒3帧，必须逐相邻帧比较，不得跳过亚秒动作。每项包含time、environment、shot、camera、purpose、visual、dialogue、onScreenText、ambientSound、bgm、soundEffects、beats、persistentState、authenticity、observedFacts、inferredIntent、causalGap、omniPrompt、omniNegativePrompt、confidence、needsReview、subtitle、audio、note。observedFacts只能写实际可见内容，inferredIntent写推断含义，causalGap写未展示的因果动作；绝不能把causalGap补进visual、beats或omniPrompt。omniPrompt和omniNegativePrompt使用英文。time必须为start-end s区间；口播与屏幕字幕分离；品牌、款名、价格、左右眼不确定时needsReview=true。` },
        { role: 'user', content: content as any },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 8000,
    });
    const repaired = parseJson<Partial<VideoAiAnalysis>>(repair.choices[0]?.message?.content ?? '', {});
    normalized = normalizeVideoAnalysis({ ...parsed, scriptDetails15s: repaired.scriptDetails15s });
  }
  return normalized;
}

export async function analyzeImagePostWithQwen(opts: {
  imageBase64: string;
  mimeType: string;
  title?: string;
  caption?: string;
  platform?: string;
  views?: string;
  tags?: string[];
  imageCount?: number;
}): Promise<VideoAiAnalysis> {
  if (!opts.imageBase64) throw new Error('Qwen image analysis requires an image');

  const systemPrompt = `你是一个面向出海 B2B 社媒获客的图文海报分析专家。
你会收到一张社媒图文帖的首图，以及标题、caption、平台、互动数据、标签等资料。
请分析它作为“爆款图文/海报参考”的可复用模块，并输出兼容短视频分析结构的 JSON。所有字符串用简体中文。
只输出合法 JSON，不要 markdown，不要代码块，不要前后解释。

必需 JSON 字段：
- theme: string，概括这张图文/海报的产品、场景和营销目标
- hooks: string[], 2-4 个可复用开头钩子/爆点，必须结合 caption 与画面
- sellingPoints: string[], 3-6 个可复用卖点表达或信息模块
- mood: string，视觉风格/审美质感，例如“高端工厂招商海报”“洁净实验室背书”“节日促销图文”
- structure: string，模块结构，例如“标题区 -> 产品主视觉 -> 背景氛围 -> 信息栏 -> 认证徽章 -> CTA”
- baseRequirements: string，说明可复用的画风、构图、色彩、光影、排版密度和图文生成注意点
- firstTenSeconds: object，虽然是静态图，也按五维输出：atmosphere、audioVisual、camera、visuals、voiceMusic；audioVisual/voiceMusic 可写“静态图无音频，caption 承担解释”
- coarseStructure: array，把图文拆成可复用模块；每项包含 time、label、description。time 可用“标题区/产品主视觉/背景/信息栏/CTA”
- scriptSummary15s: object，包含 visualStyle、coreEmotion、competitors
- scriptDetails15s: array，逐模块详析，每项包含 time、environment、shot、camera、visual、subtitle、audio、note；subtitle 只写画面中能看清的文字或 caption 中确定表达，不能编造
- recommendedScriptType: "storyboard"`;

  const meta = [
    `标题：${opts.title || '未知'}`,
    opts.caption ? `原始 caption：${opts.caption}` : '',
    `平台：${opts.platform || '未知'}`,
    opts.views ? `互动/热度：${opts.views}` : '',
    opts.imageCount ? `图组张数：${opts.imageCount}` : '',
    opts.tags?.length ? `标签：${opts.tags.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const completion = await client().chat.completions.create({
    model: QWEN_VL_MODEL(),
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: `${meta}\n\n请拆解这张图文/海报，输出上述 JSON。` },
          { type: 'image_url', image_url: { url: `data:${opts.mimeType};base64,${opts.imageBase64.replace(/^data:[^,]+,/, '')}` } },
        ] as any,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0]?.message?.content ?? '';
  const parsed = parseJson<Partial<VideoAiAnalysis>>(raw, {});
  return normalizeVideoAnalysis({ ...parsed, recommendedScriptType: 'storyboard' });
}
