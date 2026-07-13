import OpenAI from 'openai';
import type { VideoAiAnalysis } from '../types/index.js';
import { normalizeVideoAnalysis } from './gemini.js';

const QWEN_VL_MODEL = () => (process.env.QWEN_VL_MODEL ?? 'qwen-vl-max').trim();
const BASE_URL = () => (process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1').trim();

function client(): OpenAI {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY is not set');
  return new OpenAI({ apiKey, baseURL: BASE_URL() });
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
}): Promise<VideoAiAnalysis> {
  if (opts.frames.length === 0) throw new Error('Qwen frame analysis requires at least one frame');

  const systemPrompt = `你是一个面向出海电商营销的短视频内容分析专家。
你会收到从公开视频中抽取的关键帧，以及标题、平台、热度、标签等资料。
请基于画面、字幕、标题和元数据推断短视频结构。无法从关键帧确认的字幕、音频或口播必须留空，不要写“按画面/字幕推断”，不要编造品牌、@账号、字幕或台词。
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
- coarseStructure: array，粗略脚本结构，按约 3 秒一帧拆解 0-30 秒；每项包含 time、label、description
- scriptSummary15s: object，15 秒脚本详析摘要，包含 visualStyle、coreEmotion、competitors
- scriptDetails15s: array，逐时间戳详析 0-15 秒，每项包含 time、environment、shot、camera、visual、subtitle、audio、note；subtitle/audio 只能写可确认内容，无法确认填空字符串；每个分镜要能按“时间戳 + 段落”展示，段落信息覆盖环境、景别、运镜、配乐、台词、画面，字段之间语义上可用分号连接
- recommendedScriptType: "voiceover" | "storyboard"`;

  const meta = [
    `标题：${opts.title || '未知'}`,
    `平台：${opts.platform || '未知'}`,
    opts.duration ? `时长：${opts.duration}s` : '',
    opts.views ? `热度/播放：${opts.views}` : '',
    opts.tags?.length ? `标签：${opts.tags.join(', ')}` : '',
    `关键帧时间：${opts.frames.map(frame => frame.timeLabel).join(', ')}`,
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
  });

  const raw = completion.choices[0]?.message?.content ?? '';
  const parsed = parseJson<Partial<VideoAiAnalysis>>(raw, {});
  return normalizeVideoAnalysis(parsed);
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
