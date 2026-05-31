/**
 * Gemini 调用仅在此文件执行，使用服务端环境变量 GEMINI_API_KEY。
 */
import { GoogleGenAI, MediaResolution, type Content } from '@google/genai';
import {
  buildFlowerExtractHighlightsSystemInstruction,
  buildFlowerExtractInspirationSystemInstruction,
  buildFlowerFlashInspirationSystemInstruction,
  buildFlowerGenerateFinalScriptSystemInstruction,
  buildFlowerGenerateThemesSystemInstruction,
  buildFlowerImageDescriptionSystemInstruction,
  buildFlowerInspirationIdeasSystemInstruction,
  buildFlowerInspirationIdeasUserPrompt,
  buildFlowerVoiceoverGameBlock,
  buildFlowerVoiceoverSystemInstruction,
  buildDisplayProductionScriptFormatBlock,
  FLOWER_AVOID_DEEP_SEA_SCENE_RULE,
  FLOWER_DISPLAY_PRODUCTION_SELLING_LINE,
  FLOWER_IMAGE_DESCRIPTION_FALLBACK_USER_TEXT,
} from './flowerGamePrompts';
import { newGameStoryboardCoreSellingEnumLine } from './gamePromptProfiles/new-game.prompts';
import { aceMechaStoryboardCoreSellingEnumLine } from './gamePromptProfiles/ace-mecha.prompts';
import { buildBuyingPageAssistantPrompt } from './buyingPageAssistant';
import { formatThemeTagCatalogForPrompt } from '../src/lib/buyingThemeTagCatalog';
import { readVideoStagingBase64 } from './videoStaging';
import {
  buildAceMechaExtractHighlightsSystemInstruction,
  buildAceMechaExtractInspirationSystemInstruction,
  buildAceMechaFlashInspirationSystemInstruction,
  buildAceMechaGenerateFinalScriptSystemInstruction,
  buildAceMechaGenerateThemesSystemInstruction,
  buildAceMechaImageDescriptionSystemInstruction,
  buildAceMechaInspirationIdeasSystemInstruction,
  buildAceMechaInspirationIdeasUserPrompt,
  buildAceMechaVoiceoverGameBlock,
  buildAceMechaVoiceoverSystemInstruction,
  ACE_MECHA_IMAGE_DESCRIPTION_FALLBACK_USER_TEXT,
} from './aceMechaGamePrompts';
import {
  buildXiyouExtractHighlightsSystemInstruction,
  buildXiyouExtractInspirationSystemInstruction,
  buildXiyouFlashInspirationSystemInstruction,
  buildXiyouGenerateFinalScriptSystemInstruction,
  buildXiyouGenerateThemesSystemInstruction,
  buildXiyouImageDescriptionSystemInstruction,
  buildXiyouInspirationIdeasSystemInstruction,
  buildXiyouInspirationIdeasUserPrompt,
  buildXiyouVoiceoverGameBlock,
  buildXiyouVoiceoverSystemInstruction,
  XIYOU_IMAGE_DESCRIPTION_FALLBACK_USER_TEXT,
} from './xiyouGamePrompts';
import { BUYING_GENRE_TAG_CLASSIFICATION_PROMPT } from '../src/lib/buyingGenreTag';
import { BUYING_FIRST3S_HOOK_TYPE_PROMPT_LIST } from '../src/lib/buyingHookTypes';
import { normalizeBuyingVideoAi } from './buyingVideoAnalysis';

export type GameProfileId = 'flower' | 'xiyou_card' | 'ace_mecha';
export type GeminiModelChoice = 'preview' | '2.5flash' | '2.5pro' | '3.5flash' | 'flash-latest' | 'lite';

type WithGameProfile<T> = T & { gameProfileId?: GameProfileId; modelChoice?: GeminiModelChoice };

/** 请求体可选 gameProfileId；未知值时走种花（flower）配置 */
export function resolveGameProfileId(body: { gameProfileId?: unknown }): GameProfileId {
  const raw = body.gameProfileId;
  if (raw === 'xiyou_card' || raw === 'ace_mecha') return raw;
  return 'flower';
}

function profilePick<T>(profile: GameProfileId, flower: T, xiyou: T, aceMecha: T): T {
  if (profile === 'xiyou_card') return xiyou;
  if (profile === 'ace_mecha') return aceMecha;
  return flower;
}

function modelId(modelChoice?: GeminiModelChoice) {
  if (modelChoice === '2.5flash') {
    return process.env.GEMINI_MODEL_25FLASH?.trim() || 'gemini-2.5-flash';
  }
  if (modelChoice === '2.5pro') {
    return process.env.GEMINI_MODEL_25PRO?.trim() || 'gemini-2.5-pro';
  }
  if (modelChoice === '3.5flash') {
    return process.env.GEMINI_MODEL_35FLASH?.trim() || 'gemini-3.5-flash';
  }
  if (modelChoice === 'flash-latest') {
    return process.env.GEMINI_MODEL_FLASH_LATEST?.trim() || 'gemini-flash-latest';
  }
  if (modelChoice === 'lite') {
    return process.env.GEMINI_MODEL_LITE?.trim() || 'gemini-2.5-flash';
  }
  // preview and unknown fall back to a stable fast default
  return process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
}

/** 灵光一闪等接口可传档位；缺省或与约定不符时按 10–15 秒 */
const FLASH_DURATION_PRESET_RANGES: Record<string, [number, number]> = {
  '1-5': [1, 5],
  '5-10': [5, 10],
  '10-15': [10, 15],
  '15-25': [15, 25],
  '50-60': [50, 60],
};

function flashScriptDurationRange(preset: string | undefined): [number, number] {
  if (preset && preset in FLASH_DURATION_PRESET_RANGES) {
    return FLASH_DURATION_PRESET_RANGES[preset]!;
  }
  return [10, 15];
}

export type GeminiOpBody =
  | WithGameProfile<{
      op: 'generateFlashInspiration';
      prompt: string;
      sellingPoints: string;
      style: string;
      moods: string;
      durationPreset?: string;
    }>
  | WithGameProfile<{
      op: 'generateVoiceoverScript';
      prompt: string;
      durationPreset?: string;
      flowerGame: boolean;
      voiceIdentity: string;
      voiceScene: string;
      voiceEmotion: string;
    }>
  | WithGameProfile<{ op: 'generateInspirationIdeas'; prompt: string; sellingPoints: string; style: string; moods: string }>
  | WithGameProfile<{
      op: 'generateImageDescription';
      imageBase64: string | null;
      prompt: string;
      sellingPoints: string;
      style: string;
      moods: string;
    }>
  | WithGameProfile<{
      op: 'generateDisplayProductionScript';
      motionCardText: string;
      durationSeconds: number;
      visualDescription: string;
      sellingPoints: string;
      style: string;
      moods: string;
    }>
  | WithGameProfile<{
      op: 'analyzeVideoIteration';
      videoBase64?: string;
      videoStagingId?: string;
      mimeType: string;
      style: string;
      moods: string;
    }>
  | WithGameProfile<{ op: 'extractHighlights'; videoBase64: string; mimeType: string }>
  | WithGameProfile<{ op: 'generateThemes'; selectedHighlights: string[]; sellingPoints: string }>
  | WithGameProfile<{
      op: 'generateFinalScript';
      themeTitle: string;
      themeDescription: string;
      style: string;
      moods: string;
      extraPrompt?: string;
    }>
  | WithGameProfile<{ op: 'extractInspiration'; videoBase64: string; mimeType: string; style: string; moods: string }>
  | WithGameProfile<{ op: 'diagnoseFlashScript'; script: string; sellingPoints?: string }>
  | WithGameProfile<{
      op: 'analyzeBuyingVideo';
      videoBase64: string;
      mimeType: string;
      fileName: string;
      /** 为 true 时额外输出前 5 秒与首卖点深度分析（找钩子模式） */
      includeHookDeepAnalysis: boolean;
      /** 历史主题标签频次，AI 须优先从中选取 themeTags */
      existingThemeTags?: { tag: string; count: number }[];
    }>
  | WithGameProfile<{
      op: 'askBuyingPageAssistant';
      question: string;
      context: import('../src/lib/buyingPageAssistantContext').BuyingPageAssistantContext;
      messages?: import('../src/lib/buyingPageAssistantContext').BuyingPageAssistantMessage[];
    }>;

function client() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set on the server');
  return new GoogleGenAI({ apiKey });
}

/** 创意迭代：从 staging 或 inline base64 解析视频载荷 */
export async function resolveAnalyzeVideoIterationVideo(body: {
  videoBase64?: string;
  videoStagingId?: string;
  mimeType: string;
}): Promise<{ videoBase64: string; mimeType: string }> {
  if (body.videoStagingId) {
    const staged = await readVideoStagingBase64(body.videoStagingId);
    return { videoBase64: staged.videoBase64, mimeType: staged.mimeType || body.mimeType };
  }
  if (body.videoBase64) {
    const videoBase64 = body.videoBase64.includes(',')
      ? body.videoBase64.split(',')[1]!
      : body.videoBase64;
    return { videoBase64, mimeType: body.mimeType };
  }
  throw new Error('videoBase64 or videoStagingId is required');
}

/** 创意迭代：视频 1:1 拆解（非流式与流式共用） */
function buildAnalyzeVideoIterationParams(body: {
  style: string;
  moods: string;
  videoBase64: string;
  mimeType: string;
}): { systemInstruction: string; contents: Content[] } {
  const systemInstruction = `你是一位专业的短视频拆解分析师。你的任务是对用户提供的视频进行 1:1 的脚本解析与复述，严禁进行任何形式的“自动加工”、“创意迭代”或“二次创作”。

请务必按以下结构精准还原视频内容：

【分析摘要】
指定画风：${body.style}（仅作标注说明）
核心情绪：${body.moods}（仅作标注说明）
竞品识别：自动识别视频中的 brand 名、游戏名或特定功能，并用 ==关键词== 包裹。

【分镜脚本】
请按视频的时间顺序，逐一记录每一个镜头的内容：
[时间点] 景别; 运镜; 画面内容与台词原话还原; 动作/表情细节; 音效/BGM描述。 各项之间以中文分号“；”连接。

【复述要求】
1. 必须 100% 还原视频中的台词原话，不得改写。
2. 必须实事求是地描述画面中出现的场景、人物和动作。
3. 严禁添加视频中不存在的剧情或元素。
4. 保持分析的中立性与客观性。

禁令：禁止任何开场白，直接输出内容。`;

  const contents: Content[] = [
    {
      parts: [
        { inlineData: { data: body.videoBase64, mimeType: body.mimeType } },
        { text: '请拆解这段视频。' },
      ],
    },
  ];
  return { systemInstruction, contents };
}

/**
 * 流式输出创意迭代拆解文本片段（每个 chunk 的增量文本，由调用方拼接）。
 */
const videoAnalyzeConfig = (systemInstruction: string) => ({
  systemInstruction,
  /** 降低视频采样分辨率，加快解析（1:1 拆解不依赖超高分辨率） */
  mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
});

export async function* streamAnalyzeVideoIterationDeltas(body: {
  videoBase64?: string;
  videoStagingId?: string;
  mimeType: string;
  style: string;
  moods: string;
  modelChoice?: GeminiModelChoice;
}): AsyncGenerator<string, void, unknown> {
  const ai = client();
  const video = await resolveAnalyzeVideoIterationVideo(body);
  const { systemInstruction, contents } = buildAnalyzeVideoIterationParams({
    ...body,
    ...video,
  });
  const started = Date.now();
  console.log(
    `[gemini] analyzeVideoIteration stream start b64≈${Math.round(video.videoBase64.length * 0.75 / 1024)}KB`,
  );
  const stream = await ai.models.generateContentStream({
    model: modelId(body.modelChoice),
    contents,
    config: videoAnalyzeConfig(systemInstruction),
  });
  let firstDeltaLogged = false;
  for await (const chunk of stream) {
    const t = chunk.text;
    if (t) {
      if (!firstDeltaLogged) {
        console.log(`[gemini] analyzeVideoIteration first delta ${Date.now() - started}ms`);
        firstDeltaLogged = true;
      }
      yield t;
    }
  }
}

export type GenerateDisplayProductionScriptInput = Omit<
  Extract<GeminiOpBody, { op: 'generateDisplayProductionScript' }>,
  'op'
>;

function displayProductionSellingLine(profile: GameProfileId): string {
  return profilePick(
    profile,
    FLOWER_DISPLAY_PRODUCTION_SELLING_LINE,
    newGameStoryboardCoreSellingEnumLine,
    aceMechaStoryboardCoreSellingEnumLine,
  );
}

function displayProductionSceneConstraint(profile: GameProfileId): string {
  return profilePick(profile, FLOWER_AVOID_DEEP_SEA_SCENE_RULE, '', '');
}

/** 展示类全文脚本是否含分镜三章 + 时间戳，且未落入旧「运镜/动态细节长段」写法 */
export function isValidDisplayProductionScript(text: string): boolean {
  const t = text.trim();
  if (!t.includes('【基本要求】') || !t.includes('【分镜脚本】') || !t.includes('【分镜标签】')) {
    return false;
  }
  if (!/\[\d{2}:\d{2}-\d{2}:\d{2}\]/.test(t)) return false;
  if (!t.startsWith('【基本要求】')) return false;
  if (/动态细节[：:]/.test(t)) return false;
  if (/运镜[：:]\s*全程/.test(t)) return false;
  if (t.includes('【自动根据剧情匹配合适的音效】')) return false;
  return true;
}

function* chunkTextForStream(text: string, size = 48): Generator<string, void, unknown> {
  for (let i = 0; i < text.length; i += size) {
    yield text.slice(i, i + size);
  }
}

function buildGenerateDisplayProductionScriptParams(
  body: GenerateDisplayProductionScriptInput,
  profile: GameProfileId,
  retry = false,
): {
  systemInstruction: string;
  contents: string;
} {
  const sec = Math.min(600, Math.max(1, Math.floor(Number(body.durationSeconds)) || 15));
  const formatBlock = buildDisplayProductionScriptFormatBlock(
    sec,
    displayProductionSellingLine(profile),
    displayProductionSceneConstraint(profile),
  );

  const systemInstruction = `你是短视频/买量广告「画面展示类」的分镜脚本编剧。你的输出只能是【基本要求】→【分镜脚本】→【分镜标签】三分镜表格式，不得使用任何其他版式。

${formatBlock}

创作输入：
- 目标成片时长：${sec} 秒
- 卖点（可为空）：${body.sellingPoints}
- 画风：${body.style}
- 情绪：${body.moods}
- 画面描述参考：${body.visualDescription || '（无）'}
- 用户选中的动态口令：${body.motionCardText}

将动态口令中的运镜与动作拆解为带时间戳的分镜段；与画面描述在人物/场景/主体上严格一致，可细化但不改世界观。`;

  const contents = retry
    ? `你上一次输出未遵守分镜表格式（可能误用了「运镜：」「动态细节：」长段或缺少【基本要求】/时间戳）。请严格按 system 中的【唯一合法结构】重写，从【基本要求】起笔，不要开场白。`
    : `请直接输出完整分镜脚本（从【基本要求】起笔，不要开场白）。`;

  return { systemInstruction, contents };
}

async function generateDisplayProductionScriptText(
  body: GenerateDisplayProductionScriptInput,
): Promise<string> {
  const ai = client();
  const profile = resolveGameProfileId(body);
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const { systemInstruction, contents } = buildGenerateDisplayProductionScriptParams(
      body,
      profile,
      attempt > 0,
    );
    const response = await ai.models.generateContent({
      model: modelId(body.modelChoice),
      contents,
      config: { systemInstruction },
    });
    last = (response.text || '').trim();
    if (isValidDisplayProductionScript(last)) return last;
  }
  return last;
}

/** 流式输出展示类「全文制作脚本」文本片段（生成后校验格式，必要时重试一次再分块输出）。 */
export async function* streamGenerateDisplayProductionScriptDeltas(
  body: GenerateDisplayProductionScriptInput,
): AsyncGenerator<string, void, unknown> {
  const text = await generateDisplayProductionScriptText(body);
  yield* chunkTextForStream(text);
}

export async function runGeminiOp(body: GeminiOpBody): Promise<unknown> {
  const ai = client();
  const profile = resolveGameProfileId(body);

  switch (body.op) {
    case 'generateFlashInspiration': {
      const [dMin, dMax] = flashScriptDurationRange(body.durationPreset);
      const systemInstruction = profilePick(
        profile,
        buildFlowerFlashInspirationSystemInstruction(
          dMin,
          dMax,
          body.sellingPoints,
          body.style,
          body.moods,
        ),
        buildXiyouFlashInspirationSystemInstruction(dMin, dMax, body.sellingPoints, body.style, body.moods),
        buildAceMechaFlashInspirationSystemInstruction(dMin, dMax, body.sellingPoints, body.style, body.moods),
      );

      const response = await ai.models.generateContent({
        model: modelId(body.modelChoice),
        contents: body.prompt,
        config: { systemInstruction },
      });
      return response.text;
    }

    case 'generateVoiceoverScript': {
      const [dMin, dMax] = flashScriptDurationRange(body.durationPreset);
      const anchor = Boolean(body.flowerGame);
      const identity = (body.voiceIdentity || '').trim();
      const scene = (body.voiceScene || '').trim();
      const emotion = (body.voiceEmotion || '').trim();
      const userPrompt = (body.prompt || '').trim();

      const gameBlock = profilePick(
        profile,
        buildFlowerVoiceoverGameBlock(anchor, identity, scene, emotion),
        buildXiyouVoiceoverGameBlock(anchor, identity, scene, emotion),
        buildAceMechaVoiceoverGameBlock(anchor, identity, scene, emotion),
      );
      const systemInstruction = profilePick(
        profile,
        buildFlowerVoiceoverSystemInstruction(dMin, dMax, gameBlock),
        buildXiyouVoiceoverSystemInstruction(dMin, dMax, gameBlock),
        buildAceMechaVoiceoverSystemInstruction(dMin, dMax, gameBlock),
      );

      const contents = `请根据系统指令生成口播台词。\n\n【用户提示词】\n${userPrompt || '（无）'}`;

      const response = await ai.models.generateContent({
        model: modelId(body.modelChoice),
        contents,
        config: { systemInstruction },
      });
      return response.text;
    }

    case 'generateInspirationIdeas': {
      const systemInstruction = profilePick(
        profile,
        buildFlowerInspirationIdeasSystemInstruction(),
        buildXiyouInspirationIdeasSystemInstruction(),
        buildAceMechaInspirationIdeasSystemInstruction(),
      );
      const userPrompt = profilePick(
        profile,
        buildFlowerInspirationIdeasUserPrompt(body.prompt, body.sellingPoints, body.style, body.moods),
        buildXiyouInspirationIdeasUserPrompt(body.prompt, body.sellingPoints, body.style, body.moods),
        buildAceMechaInspirationIdeasUserPrompt(body.prompt, body.sellingPoints, body.style, body.moods),
      );

      const response = await ai.models.generateContent({
        model: modelId(body.modelChoice),
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
        },
      });
      try {
        return JSON.parse(response.text || '[]');
      } catch {
        return [];
      }
    }

    case 'generateImageDescription': {
      const systemInstruction = profilePick(
        profile,
        buildFlowerImageDescriptionSystemInstruction(body.style, body.moods, body.sellingPoints),
        buildXiyouImageDescriptionSystemInstruction(body.style, body.moods, body.sellingPoints),
        buildAceMechaImageDescriptionSystemInstruction(body.style, body.moods, body.sellingPoints),
      );

      const contents: Content[] = [];
      const fallbackText = profilePick(
        profile,
        FLOWER_IMAGE_DESCRIPTION_FALLBACK_USER_TEXT,
        XIYOU_IMAGE_DESCRIPTION_FALLBACK_USER_TEXT,
        ACE_MECHA_IMAGE_DESCRIPTION_FALLBACK_USER_TEXT,
      );
      if (body.imageBase64) {
        const base64Data = body.imageBase64.includes(',') ? body.imageBase64.split(',')[1] : body.imageBase64;
        const mimeType = body.imageBase64.includes(';')
          ? body.imageBase64.split(';')[0].split(':')[1]
          : 'image/jpeg';

        contents.push({
          parts: [
            { inlineData: { data: base64Data, mimeType } },
            { text: body.prompt || '请根据这张图片生成画面描述和口令。' },
          ],
        });
      } else {
        contents.push({
          parts: [{ text: body.prompt || fallbackText }],
        });
      }

      const response = await ai.models.generateContent({
        model: modelId(body.modelChoice),
        contents,
        config: { systemInstruction },
      });
      return response.text;
    }

    case 'generateDisplayProductionScript': {
      return generateDisplayProductionScriptText(body);
    }

    case 'analyzeVideoIteration': {
      const video = await resolveAnalyzeVideoIterationVideo(body);
      const { systemInstruction, contents } = buildAnalyzeVideoIterationParams({
        style: body.style,
        moods: body.moods,
        ...video,
      });
      const response = await ai.models.generateContent({
        model: modelId(body.modelChoice),
        contents,
        config: videoAnalyzeConfig(systemInstruction),
      });
      return response.text;
    }

    case 'extractHighlights': {
      const systemInstruction = profilePick(
        profile,
        buildFlowerExtractHighlightsSystemInstruction(),
        buildXiyouExtractHighlightsSystemInstruction(),
        buildAceMechaExtractHighlightsSystemInstruction(),
      );

      const response = await ai.models.generateContent({
        model: modelId(body.modelChoice),
        contents: [
          {
            parts: [
              { inlineData: { data: body.videoBase64, mimeType: body.mimeType } },
              { text: '请分析视频并提取亮点。' },
            ],
          },
        ],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
        },
      });
      try {
        return JSON.parse(response.text || '{}');
      } catch {
        return null;
      }
    }

    case 'generateThemes': {
      const systemInstruction = profilePick(
        profile,
        buildFlowerGenerateThemesSystemInstruction(),
        buildXiyouGenerateThemesSystemInstruction(),
        buildAceMechaGenerateThemesSystemInstruction(),
      );

      const prompt = `选中的灵感点：${body.selectedHighlights.join(', ')}\n元素配置：${body.sellingPoints}`;

      const response = await ai.models.generateContent({
        model: modelId(body.modelChoice),
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
        },
      });
      try {
        return JSON.parse(response.text || '[]');
      } catch {
        return [];
      }
    }

    case 'generateFinalScript': {
      const systemInstruction = profilePick(
        profile,
        buildFlowerGenerateFinalScriptSystemInstruction(body.style, body.moods),
        buildXiyouGenerateFinalScriptSystemInstruction(body.style, body.moods),
        buildAceMechaGenerateFinalScriptSystemInstruction(body.style, body.moods),
      );

      const extra = (body.extraPrompt ?? '').trim();
      const prompt =
        extra.length > 0
          ? `选定的主题：${body.themeTitle}\n描述：${body.themeDescription}\n\n用户补充说明（请尽量落实）：\n${extra}`
          : `选定的主题：${body.themeTitle}\n描述：${body.themeDescription}`;

      const response = await ai.models.generateContent({
        model: modelId(body.modelChoice),
        contents: prompt,
        config: { systemInstruction },
      });
      return response.text;
    }

    case 'extractInspiration': {
      const systemInstruction = profilePick(
        profile,
        buildFlowerExtractInspirationSystemInstruction(body.style, body.moods),
        buildXiyouExtractInspirationSystemInstruction(body.style, body.moods),
        buildAceMechaExtractInspirationSystemInstruction(body.style, body.moods),
      );

      const response = await ai.models.generateContent({
        model: modelId(body.modelChoice),
        contents: [
          {
            parts: [
              { inlineData: { data: body.videoBase64, mimeType: body.mimeType } },
              { text: '请从这段视频中提取灵感并生成新脚本。' },
            ],
          },
        ],
        config: { systemInstruction },
      });
      return response.text;
    }

    case 'analyzeBuyingVideo': {
      const fileName = (body.fileName || 'video.mp4').trim().slice(0, 200);
      const themeCatalog = Array.isArray(body.existingThemeTags) ? body.existingThemeTags : [];
      const catalogPrompt = formatThemeTagCatalogForPrompt(themeCatalog);
      const systemInstruction = `你是买量短视频素材分析助手。请**通看全片**（重点前 3 秒钩子 + 全片卖点 + 结尾引导），判断题材与主题，输出结构化钩子分析与情绪节奏。

硬性要求：
1. 只输出**一个** JSON 对象，禁止 Markdown、禁止代码块、禁止任何开场白或尾注。
2. 所有中文须**简短**；标签类不要标点；卖点总结用顿号或逗号分隔关键词即可。

${catalogPrompt}

JSON 字段（必须全部输出）：
- genreTag: string，题材标签，**必须且只能是**：「剧情」「游戏玩法」「画面展示」三者之一（≤4字）。
${BUYING_GENRE_TAG_CLASSIFICATION_PROMPT}
- themeTags: string 数组，**恰好 2 个**主题标签，概括全片主题/梗/风格；**优先从上方现有标签库选取**（可同库内选两个不同标签），仅当库中无任何贴切项时才新增≤4字标签。
- hookAnalysis: 对象（禁止为 null），包含：
  - first3sVisual: **前3秒**画面呈现（主体、动作、字幕/贴纸、色调氛围），≤72字。
  - first3sDialogue: **前3秒**台词/字幕要点（无对白则写「无对白」并简述音效/BGM），≤72字。
  - first3sHookType: string，**前3秒**钩子类型，**必须且只能是**以下之一：${BUYING_FIRST3S_HOOK_TYPE_PROMPT_LIST}。审美视觉=前3秒以画面美感/美术/氛围抓眼；猎奇搞笑=猎奇、荒诞或搞笑反差抓眼。若无法归入前七类则填「其他」。
  - first3sHookTypeOther: string，仅当 first3sHookType 为「其他」时可写一句归类说明（≤24字）；否则输出空字符串 ""。
  - coreGameplaySellingPoints: string，**全片**出现的核心玩法卖点总结（如零氪体验、无需重度游玩、新手易上手），≤96字。
  - coreWelfareSellingPoints: string，**全片**出现的核心福利卖点总结（如可兑换小额红包、新手登录礼），≤96字。
  - endingGuidance: string，视频**结尾**引导语/CTA 原文或近义复述（如下方点击、领红包、下载试玩），≤72字；无明确口播则据画面字幕概括。
  - reusableViralPattern: string，**可复用爆款套路**分析：钩子如何抓注意力、绑定了哪些卖点、节奏与人群契合点，≤120字。
  - fullAnalysis: 对象（禁止为 null），全片情绪与卖点节奏：
    - totalSeconds: number，推断视频总时长（秒），至少 3，不超过 120。
    - emotionCurve: 数组，10–16 个元素，每个 { "t": number（0 到 totalSeconds）, "intensity": number（0–100 情绪/冲突强度）, "note": string（可选，≤12字） }，按 t 升序，首尾建议含 0 与 totalSeconds。
    - peak3sSec: number，**0–3 秒**内情绪/冲突强度峰值所在时刻（秒）。
    - peakFullSec: number，**全片**情绪/冲突强度峰值所在时刻（秒）。
    - firstSellingPointSec: number，游戏卖点/利益点/玩法价值**首次清晰出现**的时刻（秒）；若全片无明确卖点则取最接近的悬念或 CTA 时刻。

若视频不足3秒，按可见部分尽力分析。文件名「${fileName}」仅作辅助。`;

      const rawB64 = body.videoBase64.includes(',') ? body.videoBase64.split(',')[1]! : body.videoBase64;
      const mime = (body.mimeType || 'video/mp4').trim() || 'video/mp4';

      const response = await ai.models.generateContent({
        model: modelId(body.modelChoice),
        contents: [
          {
            parts: [
              { inlineData: { data: rawB64, mimeType: mime } },
              { text: `原始文件名：${fileName}\n请严格按系统指令只输出 JSON。` },
            ],
          },
        ],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
        },
      });

      try {
        const raw = JSON.parse(response.text || '{}') as Record<string, unknown>;
        return normalizeBuyingVideoAi(raw, { themeTagCatalog: themeCatalog });
      } catch {
        return normalizeBuyingVideoAi(
          {
            genreTag: '剧情',
            themeTags: ['待分析', '待分析'],
            hookAnalysis: {
              first3sVisual: '解析失败，请重试上传。',
              first3sDialogue: '—',
              first3sHookType: '其他',
              first3sHookTypeOther: '',
              coreGameplaySellingPoints: '—',
              coreWelfareSellingPoints: '—',
              endingGuidance: '—',
              reusableViralPattern: '—',
              fullAnalysis: {
                totalSeconds: 15,
                emotionCurve: [
                  { t: 0, intensity: 45 },
                  { t: 15, intensity: 50 },
                ],
                peak3sSec: 1.5,
                peakFullSec: 8,
                firstSellingPointSec: 8,
              },
            },
          },
          { themeTagCatalog: themeCatalog },
        );
      }
    }

    case 'diagnoseFlashScript': {
      const selling = (body.sellingPoints ?? '').trim() || '（未指定，按脚本内卖点与核心冲突推断）';
      const systemInstruction = `你是短视频买量脚本诊断专家。根据用户提供的分镜脚本全文，只做结构化分析，不要复述脚本。

诊断框架（买量常见节奏）：
1. 「3 秒吸睛」：检查 0–3 秒内是否具备强钩子（冲突、反转预兆、视觉奇观、悬念、情绪爆点之一即可）。
2. 「8 秒卖点」：检查 0–8 秒内是否清晰传达可感知的利益点或游戏价值（与脚本中的核心卖点、玩法或奖励相关）。

同时根据脚本各段落的戏剧张力与情绪起伏，生成一条「情绪曲线」：横轴为时间（秒），纵轴为 0–100 的情绪/冲突强度（主观但需与分镜内容一致）。

只输出一个 JSON 对象，禁止 Markdown、禁止代码块、禁止任何开场白。字段要求：
- totalSeconds: number，推断的脚本总时长（秒），须与分镜时间戳逻辑一致，至少为 5。
- emotionCurve: 数组，10–16 个元素，每个为 { "t": number（秒，0 到 totalSeconds）, "intensity": number（0–100）, "note": string（可选，≤12 字） }，按 t 严格升序，首尾 t 建议为 0 与 totalSeconds。
- hook3s: { "status": "strong" | "ok" | "weak", "score": number（1–10）, "finding": string（一句中文）, "suggestions": string[]（2–4 条可执行改写建议） }
- selling8s: { "status": "strong" | "ok" | "weak", "score": number（1–10）, "finding": string（一句中文）, "suggestions": string[]（2–4 条可执行改写建议） }

用户侧卖点参考（诊断 8 秒卖点时可对照，脚本未体现则判弱并建议）：${selling}`;

      const response = await ai.models.generateContent({
        model: modelId(body.modelChoice),
        contents: `以下为待诊断脚本全文：\n\n${body.script}`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
        },
      });
      try {
        const raw = JSON.parse(response.text || '{}') as Record<string, unknown>;
        const totalSeconds = Math.max(5, Math.min(120, Number(raw.totalSeconds) || 15));
        let curve = Array.isArray(raw.emotionCurve) ? raw.emotionCurve : [];
        curve = curve
          .map((p) => {
            const o = p as Record<string, unknown>;
            return {
              t: Math.max(0, Math.min(totalSeconds, Number(o.t) || 0)),
              intensity: Math.max(0, Math.min(100, Number(o.intensity) || 0)),
              note: typeof o.note === 'string' ? o.note.slice(0, 24) : undefined,
            };
          })
          .sort((a, b) => a.t - b.t);
        const hook3s = raw.hook3s && typeof raw.hook3s === 'object' ? (raw.hook3s as Record<string, unknown>) : {};
        const selling8Raw =
          raw.selling8s && typeof raw.selling8s === 'object'
            ? (raw.selling8s as Record<string, unknown>)
            : raw.sellPoint8s && typeof raw.sellPoint8s === 'object'
              ? (raw.sellPoint8s as Record<string, unknown>)
              : {};
        const pickDiag = (o: Record<string, unknown>) => ({
          status: (['strong', 'ok', 'weak'].includes(String(o.status)) ? o.status : 'ok') as 'strong' | 'ok' | 'weak',
          score: Math.max(1, Math.min(10, Math.round(Number(o.score) || 5))),
          finding: typeof o.finding === 'string' ? o.finding : '',
          suggestions: Array.isArray(o.suggestions)
            ? (o.suggestions as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 6)
            : [],
        });
        return {
          totalSeconds,
          emotionCurve: curve,
          hook3s: pickDiag(hook3s),
          selling8s: pickDiag(selling8Raw),
        };
      } catch {
        return null;
      }
    }

    case 'askBuyingPageAssistant': {
      const { systemInstruction, userText } = buildBuyingPageAssistantPrompt({
        question: body.question,
        context: body.context,
        messages: body.messages,
      });
      const useGoogleSearch = process.env.BUYING_ASSISTANT_GOOGLE_SEARCH !== '0';
      const contents = [{ role: 'user' as const, parts: [{ text: userText }] }];
      const baseConfig = { systemInstruction };
      const withSearchConfig = { ...baseConfig, tools: [{ googleSearch: {} }] };

      let response;
      let searchAttempted = false;
      try {
        if (useGoogleSearch) {
          searchAttempted = true;
          response = await ai.models.generateContent({
            model: modelId(body.modelChoice),
            contents,
            config: withSearchConfig,
          });
        } else {
          response = await ai.models.generateContent({
            model: modelId(body.modelChoice),
            contents,
            config: baseConfig,
          });
        }
      } catch (searchErr) {
        if (!searchAttempted) throw searchErr;
        console.warn('askBuyingPageAssistant googleSearch failed, retry without tools', searchErr);
        response = await ai.models.generateContent({
          model: modelId(body.modelChoice),
          contents,
          config: baseConfig,
        });
      }

      const grounding = response.candidates?.[0]?.groundingMetadata;
      const usedWebSearch = Boolean(
        useGoogleSearch &&
          (grounding?.webSearchQueries?.length ||
            grounding?.groundingChunks?.length ||
            grounding?.searchEntryPoint),
      );
      const reply = (response.text ?? '').trim() || '抱歉，我暂时想不出回答，请稍后再试～';
      return { reply, usedWebSearch };
    }

    default:
      throw new Error(`Unknown op: ${(body as { op?: string }).op ?? 'missing'}`);
  }
}
