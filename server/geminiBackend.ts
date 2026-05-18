/**
 * Gemini 调用仅在此文件执行，使用服务端环境变量 GEMINI_API_KEY。
 */
import { GoogleGenAI, type Content } from '@google/genai';
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
  FLOWER_IMAGE_DESCRIPTION_FALLBACK_USER_TEXT,
} from './flowerGamePrompts';
import { aceMechaDisplayProductionStyleReferenceExample } from './aceMechaGamePrompts';
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
import { newGameDisplayProductionStyleReferenceExample } from './gamePromptProfiles/new-game.prompts';
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

export type GameProfileId = 'flower' | 'xiyou_card' | 'ace_mecha';

type WithGameProfile<T> = T & { gameProfileId?: GameProfileId };

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

function modelId() {
  return process.env.GEMINI_MODEL?.trim() || 'gemini-3-flash-preview';
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
  | WithGameProfile<{ op: 'analyzeVideoIteration'; videoBase64: string; mimeType: string; style: string; moods: string }>
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
    }>;

function client() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set on the server');
  return new GoogleGenAI({ apiKey });
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
export async function* streamAnalyzeVideoIterationDeltas(body: {
  videoBase64: string;
  mimeType: string;
  style: string;
  moods: string;
}): AsyncGenerator<string, void, unknown> {
  const ai = client();
  const { systemInstruction, contents } = buildAnalyzeVideoIterationParams(body);
  const stream = await ai.models.generateContentStream({
    model: modelId(),
    contents,
    config: { systemInstruction },
  });
  for await (const chunk of stream) {
    const t = chunk.text;
    if (t) yield t;
  }
}

export type GenerateDisplayProductionScriptInput = Omit<
  Extract<GeminiOpBody, { op: 'generateDisplayProductionScript' }>,
  'op'
>;

function buildGenerateDisplayProductionScriptParams(
  body: GenerateDisplayProductionScriptInput,
  profile: GameProfileId,
): {
  systemInstruction: string;
  contents: string;
} {
  const sec = Math.min(600, Math.max(1, Math.floor(Number(body.durationSeconds)) || 15));
  const flowerStyleExample = `固定镜头，画面中，一群可爱的猫咪在泳池乐园玩耍，中间的布偶猫躺在草莓泳圈上开心地笑着，其他猫咪或在泳圈上漂浮、或滑滑梯，背景是彩虹、棕榈树和遮阳伞。运镜：全程固定镜头，画面稳定不推拉摇移，动态细节按顺序呈现。动态细节：微风轻拂下，棕榈树叶轻轻摇曳，阳光在水面上洒下波光粼粼的光斑；中心的布偶猫开心地晃着爪子和尾巴，身体随着水波轻轻晃动；滑梯上的猫咪带着水花滑入泳池，溅起层层涟漪；西瓜泳圈上的小猫戴着草帽，歪头张望；其他泳圈上的猫咪随着水波缓缓漂浮，尾巴和耳朵微微摆动；透明泡泡和玩具球在水面上轻轻漂浮，彩虹和云朵带着轻微的光影变化，营造慵懒治愈的夏日派对氛围。整体线条柔和，色彩通透清新，无文字干扰、无变形，动态自然丝滑无卡顿。`;
  const styleExample = `${profilePick(
    profile,
    flowerStyleExample,
    newGameDisplayProductionStyleReferenceExample,
    aceMechaDisplayProductionStyleReferenceExample,
  )}
【自动根据剧情匹配合适的音效】`;

  const systemInstruction = `你是短视频/买量广告制作向的脚本编剧兼分镜指导。用户已从「动态口令」中选定一条作为创意核心，并给出目标成片时长（约 ${sec} 秒）。请将该口令与画面描述融合，扩展为**一条连贯、可拍摄**的完整制作脚本。

硬性要求：
1. 全文以自然段为主输出；不要使用 Markdown 的 # 标题层级。可按叙事需要穿插简短中文引导语（如「运镜：」「动态细节：」），但禁止机械分栏堆砌无意义小标题。
2. 必须包含：明确的运镜指令（含稳定器/固定镜头等画面稳定要求）；按时间顺序展开、逻辑连续、前后不自相矛盾的动态细节分镜；环境氛围与光影质感描写；智能配音语气与音效/环境声建议（可用括号内短注形式）。
3. 画面稳定原则：强调少无关晃动、主体运动与镜头运动有目的性，剪辑点清晰。
4. 必须与【画面描述参考】及【用户选中的动态口令】在人物/场景/动作上严格延续，可合理细化，禁止凭空更换世界观或主体。
5. 目标总观感时长约 ${sec} 秒（不必逐秒写时间码，但整体信息密度与节奏应与之匹配）。
6. 全文最后一行且单独成行，**必须且仅能**输出以下标记（一字不改）：【自动根据剧情匹配合适的音效】

风格与结构参考（勿照抄题材与物象，只学习「运镜 + 动态细节 + 氛围 + 音效行」的写法）：
${styleExample}

卖点（可为空）：${body.sellingPoints}
画风：${body.style}
情绪：${body.moods}

【画面描述参考】
${body.visualDescription || '（无）'}

【用户选中的动态口令】
${body.motionCardText}`;

  const contents = '请直接输出完整制作脚本正文（从第一段画面叙述开始，不要开场白）。';
  return { systemInstruction, contents };
}

/** 流式输出展示类「全文制作脚本」文本片段（由调用方拼接）。 */
export async function* streamGenerateDisplayProductionScriptDeltas(
  body: GenerateDisplayProductionScriptInput,
): AsyncGenerator<string, void, unknown> {
  const ai = client();
  const profile = resolveGameProfileId(body);
  const { systemInstruction, contents } = buildGenerateDisplayProductionScriptParams(body, profile);
  const stream = await ai.models.generateContentStream({
    model: modelId(),
    contents,
    config: { systemInstruction },
  });
  for await (const chunk of stream) {
    const t = chunk.text;
    if (t) yield t;
  }
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
        model: modelId(),
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
        model: modelId(),
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
        model: modelId(),
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
        model: modelId(),
        contents,
        config: { systemInstruction },
      });
      return response.text;
    }

    case 'generateDisplayProductionScript': {
      const { systemInstruction, contents } = buildGenerateDisplayProductionScriptParams(body, profile);
      const response = await ai.models.generateContent({
        model: modelId(),
        contents,
        config: { systemInstruction },
      });
      return response.text;
    }

    case 'analyzeVideoIteration': {
      const { systemInstruction, contents } = buildAnalyzeVideoIterationParams({
        style: body.style,
        moods: body.moods,
        videoBase64: body.videoBase64,
        mimeType: body.mimeType,
      });
      const response = await ai.models.generateContent({
        model: modelId(),
        contents,
        config: { systemInstruction },
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
        model: modelId(),
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
        model: modelId(),
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
        model: modelId(),
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
        model: modelId(),
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
      const deep = Boolean(body.includeHookDeepAnalysis);
      const systemInstruction = `你是买量短视频素材分析助手。用户上传的是广告/买量类视频，另附原始文件名供你推断产品名。

硬性要求：
1. 只输出**一个** JSON 对象，禁止 Markdown、禁止代码块、禁止任何开场白或尾注。
2. 所有中文描述须**简短**，便于大屏一行展示，不要长句堆砌。

JSON 字段说明：
- gameName: string，结合画面与原始文件名「${fileName}」推断游戏或产品简称；≤8 个汉字（或等宽英文字母/数字组合）；无法识别填「未知」。
- videoType: string，必须是且只能是以下之一：「序列帧混剪类」「剧情类」「审美展示类」。
- hook3sTags: string 数组，**恰好 2 个元素**。分别概括视频**首 3 秒内**的视觉焦点与音画冲击力（各一个核心标签），每个标签≤6 个汉字，不要标点符号。
${
        deep
          ? `- hooksDeep: 对象（禁止为 null），包含：
  - first5sSummary: string，概括前 5 秒画面与节奏，≤42 字。
  - firstSellingPoint: object，含 approxTimeSec（number，首次核心卖点大致出现秒数，0–120）、method（≤16 字，如口播/字幕/UI演示/对比等）、visualAnalysis（≤42 字，该时刻画面与信息呈现）。`
          : `- hooksDeep: 必须为 null（不要输出对象）。`
      }

若视频过短仍尽力按可见内容推断；不确定的时间用合理估计并偏小。`;

      const rawB64 = body.videoBase64.includes(',') ? body.videoBase64.split(',')[1]! : body.videoBase64;
      const mime = (body.mimeType || 'video/mp4').trim() || 'video/mp4';

      const response = await ai.models.generateContent({
        model: modelId(),
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

      const types = new Set(['序列帧混剪类', '剧情类', '审美展示类']);
      const clamp = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');

      try {
        const raw = JSON.parse(response.text || '{}') as Record<string, unknown>;
        const gameName = clamp(raw.gameName, 10) || '未知';
        const vt = clamp(raw.videoType, 12);
        const videoType = types.has(vt) ? vt : '剧情类';
        let hook3sTags: string[] = [];
        if (Array.isArray(raw.hook3sTags)) {
          hook3sTags = (raw.hook3sTags as unknown[])
            .filter((x): x is string => typeof x === 'string')
            .map((t) => t.replace(/\s+/g, '').slice(0, 8))
            .filter(Boolean)
            .slice(0, 2);
        }
        while (hook3sTags.length < 2) {
          hook3sTags.push(hook3sTags.length === 0 ? '吸睛画面' : '节奏紧凑');
        }

        let hooksDeep: Record<string, unknown> | null = null;
        if (deep && raw.hooksDeep && typeof raw.hooksDeep === 'object' && raw.hooksDeep !== null) {
          const hd = raw.hooksDeep as Record<string, unknown>;
          const fsp = hd.firstSellingPoint && typeof hd.firstSellingPoint === 'object' ? (hd.firstSellingPoint as Record<string, unknown>) : {};
          hooksDeep = {
            firstFiveSecondsSummary: clamp(hd.first5sSummary ?? hd.firstFiveSecondsSummary, 48),
            firstSellingPoint: {
              approxTimeSec: Math.max(0, Math.min(120, Number(fsp.approxTimeSec) || 0)),
              method: clamp(fsp.method, 20),
              visualAnalysis: clamp(fsp.visualAnalysis, 48),
            },
          };
        }

        if (deep && hooksDeep === null) {
          hooksDeep = {
            firstFiveSecondsSummary: '（模型未返回细分分析）',
            firstSellingPoint: { approxTimeSec: 0, method: '', visualAnalysis: '' },
          };
        }

        return {
          gameName,
          videoType,
          hook3sTags: hook3sTags.slice(0, 2),
          hooksDeep,
        };
      } catch {
        return {
          gameName: fileName.replace(/\.[^.]+$/, '').slice(0, 8) || '未知',
          videoType: '剧情类',
          hook3sTags: ['待分析', '待分析'],
          hooksDeep: deep
            ? {
                firstFiveSecondsSummary: '解析失败，请重试上传。',
                firstSellingPoint: { approxTimeSec: 0, method: '', visualAnalysis: '' },
              }
            : null,
        };
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
        model: modelId(),
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

    default:
      throw new Error(`Unknown op: ${(body as { op?: string }).op ?? 'missing'}`);
  }
}
