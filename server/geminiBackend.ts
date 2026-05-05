/**
 * Gemini 调用仅在此文件执行，使用服务端环境变量 GEMINI_API_KEY。
 */
import { GoogleGenAI, type Content } from '@google/genai';

/** 在请求时读取，确保主进程已执行 dotenv.config；可用 GEMINI_MODEL 覆盖 */
function modelId() {
  return process.env.GEMINI_MODEL?.trim() || 'gemini-3-flash-preview';
}

const SCRIPT_FORMAT_INSTRUCTION = `
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

1. 脚本总时长必须严格控制在 10-25 秒之间。
2. 每个分镜必须分行/分段输出，不得连成一段。
3. 动作描述保持夸张、戏剧化（Drama），符合买量广告高强度吸睛的需求。
4. 台词必须采用中文引号。

使用中文。`;

export type GeminiOpBody =
  | { op: 'generateFlashInspiration'; prompt: string; sellingPoints: string; style: string; moods: string }
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
  | { op: 'extractInspiration'; videoBase64: string; mimeType: string; style: string; moods: string };

function client() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set on the server');
  return new GoogleGenAI({ apiKey });
}

export async function runGeminiOp(body: GeminiOpBody): Promise<unknown> {
  const ai = client();

  switch (body.op) {
    case 'generateFlashInspiration': {
      const systemInstruction = `你是一位顶尖受众心理学家。你的任务是根据用户的需求，为治愈系手游《深海花园》生成极具爆发力的买量广告脚本。
${SCRIPT_FORMAT_INSTRUCTION}
本次广告必填卖点：${body.sellingPoints}
指定画风：${body.style}
核心情绪：${body.moods}
游戏背景：深海花园（治愈系经营手游，包含种花、装饰、互动、解压治愈）。`;

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

每个灵感点应包含：
1. 标题：一个吸引人的短句。
2. 核心梗：一句话说明这个创意的精髓（反转、悬念、视觉奇丽等）。
3. 爆点分析：为什么这段内容能火。

输出格式要求：
请务必以 JSON 数组格式输出，数组每个元素包含 "title", "concept", "hook" 三个字段。
不要包含任何 MarkDown 代码块包裹或解释性文字。
严格遵循 JSON 格式。`;

      const userPrompt = `需求描述：${body.prompt}\n游戏背景：深海花园（治愈系经营手游，包含种花、装饰、互动、解压治愈）\n卖点：${body.sellingPoints}\n风格：${body.style}\n情绪：${body.moods}`;

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
3. 'hook'（钩子）维度必须极度聚焦于视频前 3 秒的画面内容、视觉冲击或悬念。`;

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
      const systemInstruction = `你是《深海花园》（20-40岁女性治愈手游）的营销专家。
任务 1：结合用户选中的灵感点和元素配置，生成 5 版不同的创意主题（包含标题和 100 字内描述）。
创意风格要求：
1. 必须全部是【剧情类】或【戏剧性的人物互动】。
2. 核心冲突点应聚焦于：反转、打脸、攀比、误会或情感波动。
3. 描述中要体现出《深海花园》的特色（如：种花配送真花、精致经营）。
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
      const systemInstruction = `你是《深海花园》（20-40岁女性治愈手游）的营销专家。
任务 2：当用户选定主题后，将其转化为脚本。

${SCRIPT_FORMAT_INSTRUCTION}
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
${SCRIPT_FORMAT_INSTRUCTION}
指定画风：${body.style}
核心情绪：${body.moods}
主要任务：从视频中提取最吸睛的卖点逻辑，并根据深海花园的设定进行二次重构。
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

    default:
      throw new Error(`Unknown op: ${(body as { op?: string }).op ?? 'missing'}`);
  }
}
