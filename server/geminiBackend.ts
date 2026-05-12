/**
 * Gemini 调用仅在此文件执行，使用服务端环境变量 GEMINI_API_KEY。
 */
import { GoogleGenAI, type Content } from '@google/genai';

/** 在请求时读取，确保主进程已执行 dotenv.config；可用 GEMINI_MODEL 覆盖 */
function modelId() {
  return process.env.GEMINI_MODEL?.trim() || 'gemini-3-flash-preview';
}

/** 灵光一闪等接口可传档位；缺省或与约定不符时按 10–15 秒 */
const FLASH_DURATION_PRESET_RANGES: Record<string, [number, number]> = {
  '1-5': [1, 5],
  '5-10': [5, 10],
  '10-15': [10, 15],
  '15-25': [15, 25],
};

function flashScriptDurationRange(preset: string | undefined): [number, number] {
  if (preset && preset in FLASH_DURATION_PRESET_RANGES) {
    return FLASH_DURATION_PRESET_RANGES[preset]!;
  }
  return [10, 15];
}

/** 脚本与创意输出勿默认写成深海/海洋世界观，除非用户明确要求 */
const AVOID_DEEP_SEA_SCENE_RULE = `场景与意象约束：除非用户在需求描述中明确要求，否则禁止在标题、灵感点、画面、台词与设定中强调「深海、海底、海洋深处、水族馆、潜水、潜艇、浪下世界」等与深海或大洋强绑定的元素或隐喻；默认优先花园、阳台、阳光花房、客厅绿植、小院露台、花店等生活化种花与居家疗愈场景。`;

function scriptFormatInstruction(totalDurationMin: number, totalDurationMax: number): string {
  return `
输出格式严格遵守以下结构：

【分镜标签】
核心冲突：[内容]
情绪：[内容]
景别：[内容]
运镜：[内容]
画面：[内容]
动作：[内容]
配音：[内容]
核心卖点：[必须从以下选择：种花送时装、种花送家装、种花治愈、种花经营、种花送真花、萌宠及其他]

【基本要求】
规定本脚本的画风、主要场景、核心情绪、氛围基调。

【分镜脚本】
每个分镜必须单独分段输出（严禁合并在一段内），每个分镜段落必须以具体的时间戳开头，例如：[00:00-00:05]。

格式示例：
[00:00-00:05] 景别; 运镜; 画面内容细节; 音效/BGM；
台词内容必须严格遵循“人物说：‘内容’”的格式，若无台词则省略，例如：小明说：“这也太解压了吧！”

1. 脚本总时长必须严格控制在 ${totalDurationMin}-${totalDurationMax} 秒之间；各分镜时间戳须连贯铺满从 [00:00] 到结束，且首尾时间与总时长一致。
2. 每个分镜必须分行/分段输出，不得连成一段。
3. 动作描述保持夸张、戏剧化（Drama），符合买量广告高强度吸睛的需求。
4. 台词必须采用中文引号。

${AVOID_DEEP_SEA_SCENE_RULE}

使用中文。`;
}

export type GeminiOpBody =
  | {
      op: 'generateFlashInspiration';
      prompt: string;
      sellingPoints: string;
      style: string;
      moods: string;
      durationPreset?: string;
    }
  | { op: 'generateInspirationIdeas'; prompt: string; sellingPoints: string; style: string; moods: string }
  | {
      op: 'generateImageDescription';
      imageBase64: string | null;
      prompt: string;
      sellingPoints: string;
      style: string;
      moods: string;
    }
  | { op: 'analyzeVideoIteration'; videoBase64: string; mimeType: string; style: string; moods: string }
  | { op: 'extractHighlights'; videoBase64: string; mimeType: string }
  | { op: 'generateThemes'; selectedHighlights: string[]; sellingPoints: string }
  | { op: 'generateFinalScript'; themeTitle: string; themeDescription: string; style: string; moods: string }
  | { op: 'extractInspiration'; videoBase64: string; mimeType: string; style: string; moods: string }
  | { op: 'diagnoseFlashScript'; script: string; sellingPoints?: string };

function client() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set on the server');
  return new GoogleGenAI({ apiKey });
}

export async function runGeminiOp(body: GeminiOpBody): Promise<unknown> {
  const ai = client();

  switch (body.op) {
    case 'generateFlashInspiration': {
      const [dMin, dMax] = flashScriptDurationRange(body.durationPreset);
      const systemInstruction = `你是一位顶尖受众心理学家。你的任务是根据用户的需求，为治愈系种花经营手游生成极具爆发力的买量广告脚本。
${scriptFormatInstruction(dMin, dMax)}
本次广告必填卖点：${body.sellingPoints}
指定画风：${body.style}
核心情绪：${body.moods}
游戏类型：治愈系种花经营手游，包含种花、装饰、互动、解压治愈。`;

      const response = await ai.models.generateContent({
        model: modelId(),
        contents: body.prompt,
        config: { systemInstruction },
      });
      return response.text;
    }

    case 'generateInspirationIdeas': {
      const systemInstruction = `你是一位顶尖短视频买量广告创意总监。
你的任务是根据用户的核心创意描述和需求，生成 10 个简短且极具爆发力的创意灵感点。

${AVOID_DEEP_SEA_SCENE_RULE}

每个灵感点应包含：
1. 标题：一个吸引人的短句。
2. 核心梗：一句话说明这个创意的精髓（反转、悬念、视觉奇丽等）。
3. 爆点分析：为什么这段内容能火。

输出格式要求：
请务必以 JSON 数组格式输出，数组每个元素包含 "title", "concept", "hook" 三个字段。
不要包含任何 MarkDown 代码块包裹或解释性文字。
严格遵循 JSON 格式。`;

      const userPrompt = `需求描述：${body.prompt}\n游戏类型：治愈系种花经营手游，包含种花、装饰、互动、解压治愈\n卖点：${body.sellingPoints}\n风格：${body.style}\n情绪：${body.moods}`;

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
      const systemInstruction = `你是一位顶尖买量广告视觉指导和视频大模型提示词专家。
你的任务是根据提供的图片（若有）和创意描述，生成详细的【画面描述】和 3-5 条专为 Seedance、Runway 等视频生成模型设计的【动态口令】（运动脚本）。

${AVOID_DEEP_SEA_SCENE_RULE}

【画面描述】要求：
1. 极其精准：涵盖景别、构图、光影、材质和静态细节。
2. 风格匹配：必须符合指定的画风：${body.style}。
3. 氛围感：符合核心情绪：${body.moods}。

【动态口令】（动画脚本）要求：
1. 专为视频大模型设计：描述镜头推进、主体动作变化、光影流转或粒子流动。
2. 动态自然：追求平滑的运动感，确保动态与${body.style}画风相符。
3. 脚本化语言：使用类似“镜头缓慢平移”、“主体微微转头”、“光效如呼吸般闪烁”等指令。
4. 如果指定了卖点，通过动态表现出来：${body.sellingPoints}。

输出格式：
请用 Markdown 格式输出。
### 画面描述
[内容]

### 动态口令 (Seedance/Luma 指令)
1. [运动脚本1]
2. [运动脚本2]
...`;

      const contents: Content[] = [];
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
          parts: [{ text: body.prompt || '请根据治愈系卖点生成画面描述和口令。' }],
        });
      }

      const response = await ai.models.generateContent({
        model: modelId(),
        contents,
        config: { systemInstruction },
      });
      return response.text;
    }

    case 'analyzeVideoIteration': {
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

      const response = await ai.models.generateContent({
        model: modelId(),
        contents: [
          {
            parts: [
              { inlineData: { data: body.videoBase64, mimeType: body.mimeType } },
              { text: '请拆解这段视频。' },
            ],
          },
        ],
        config: { systemInstruction },
      });
      return response.text;
    }

    case 'extractHighlights': {
      const systemInstruction = `你是一位创意策划。请分析视频并提取全文核心灵感亮点，仅以 JSON 格式输出：
{
"theme": ["亮点1", "亮点2", "亮点3", "亮点4"],
"plot": ["亮点1", "亮点2", "亮点3", "亮点4"],
"mood": ["亮点1", "亮点2", "亮点3", "亮点4"],
"hook": ["亮点1", "亮点2", "亮点3", "亮点4"]
}
要求：
1. 每个维度必须输出至少 4 个具体的中文亮点，不含多余解释。
2. 'mood'（氛围）维度的标签必须严格限制为 2 个汉字（例如：治愈、反转、打脸、温情）。
3. 'hook'（钩子）维度必须极度聚焦于视频前 3 秒的画面内容、视觉冲击或悬念。
4. 若原视频未直接呈现深海、海底或海洋场景，各维度亮点中不得主动加入或强化深海、海洋类意象与措辞。`;

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
      const systemInstruction = `你是一款治愈系种花经营手游（面向20-40岁女性）的营销专家。
任务 1：结合用户选中的灵感点和元素配置，生成 5 版不同的创意主题（包含标题和 100 字内描述）。

${AVOID_DEEP_SEA_SCENE_RULE}

创意风格要求：
1. 必须全部是【剧情类】或【戏剧性的人物互动】。
2. 核心冲突点应聚焦于：反转、打脸、攀比、误会或情感波动。
3. 描述中要体现出种花类治愈经营手游的特色（如：种花配送真花、精致经营）。
要求：以 JSON 数组格式输出，每个对象包含 title 和 description。
禁令：禁止任何开场白，直接输出 JSON。`;

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
      const systemInstruction = `你是一款治愈系种花经营手游（面向20-40岁女性）的营销专家。
任务 2：当用户选定主题后，将其转化为脚本。

${scriptFormatInstruction(10, 25)}
指定画风：${body.style}
核心情绪：${body.moods}

脚本要求：
1. 剧情核心：必须包含强烈的戏剧冲突或反转，侧重于人物之间的互动。
2. 戏剧性强调：必须通过夸张的对比或情绪爆发展示“反转”、“打脸”或“冲突”。
禁令：禁止任何开场白，直接输出内容。`;

      const prompt = `选定的主题：${body.themeTitle}\n描述：${body.themeDescription}`;

      const response = await ai.models.generateContent({
        model: modelId(),
        contents: prompt,
        config: { systemInstruction },
      });
      return response.text;
    }

    case 'extractInspiration': {
      const systemInstruction = `你是一位创意黑客。请分析用户提供的视频，并严格按以下要求输出灵感提取版本：
${scriptFormatInstruction(10, 25)}
指定画风：${body.style}
核心情绪：${body.moods}
主要任务：从视频中提取最吸睛的卖点逻辑，并结合治愈系种花经营手游的设定进行二次重构。
禁令：禁止任何开场白，直接输出脚本内容。`;

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
