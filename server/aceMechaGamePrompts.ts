/**
 * 王牌机甲 — 与 `flowerGamePrompts.ts` / `xiyouGamePrompts.ts` 对位的组装逻辑，供 geminiBackend 在 gameProfileId === 'ace_mecha' 时调用。
 */
import {
  ACE_MECHA_SELECTION_GUIDANCE_FOR_PROMPT,
  aceMechaDisplayProductionStyleReferenceExample,
  aceMechaExtractHighlightsMoodExamplesLine,
  aceMechaExtractInspirationMissionLine,
  aceMechaFlashInspirationRoleAndGenreBlock,
  aceMechaGenerateThemesExpertAndTaskBlock,
  aceMechaImageDescriptionExpertPreamble,
  aceMechaImageDescriptionFallbackUserText,
  aceMechaInspirationIdeasGameTypeLine,
  aceMechaStoryboardCoreSellingEnumLine,
  aceMechaVoiceoverAnchoredWorldBlock,
  aceMechaVoiceoverFreeformBlock,
  aceMechaVoiceoverStyleReferenceBullets,
} from './gamePromptProfiles/ace-mecha.prompts';

export function aceMechaScriptFormatInstruction(totalDurationMin: number, totalDurationMax: number): string {
  return `
输出格式严格遵守以下结构与顺序（禁止颠倒章节、禁止在【基本要求】未写完前开始【分镜脚本】、禁止省略章节标题）：

【基本要求】
（必须最先完整输出；全部写完后再开始【分镜脚本】）
必须逐项写明：
- 风格：本脚本的整体画风与视觉调性
- 主要场景：核心取景地与空间环境
- 情绪氛围：全片情绪基调与氛围描述

【分镜脚本】
（仅在【基本要求】全部输出完毕后才能开始）
- 每个分镜单独成段，严禁多个分镜合并在同一段。
- 每个段落必须以时间戳开头，例如：[00:00-00:05]
- 段落内用连贯的叙事性中文描写画面与表演（景别、运镜、动作、表情、音效/BGM 自然融入句中），禁止用分号清单式罗列字段。
- 台词须嵌入叙述，格式为：人物+神态/动作描写+说：「台词」；若无台词则只写画面与表演。

格式示例：
[00:00-00:05] 广角摇镜掠过战场废墟；驾驶员惊恐地瞪大眼睛、夸张张开嘴巴说：「合体完成，这一炮定胜负！」机甲引擎轰鸣与警报声叠入。

【分镜标签】
核心冲突：[内容]
情绪：[内容]
景别：[内容]
运镜：[内容]
画面：[内容]
动作：[内容]
配音：[内容]
${aceMechaStoryboardCoreSellingEnumLine}

1. 脚本总时长必须严格控制在 ${totalDurationMin}-${totalDurationMax} 秒之间；各分镜时间戳须连贯铺满从 [00:00] 到结束，且首尾时间与总时长一致。
2. 每个分镜必须单独分段输出，不得连成一段。
3. 动作描述保持夸张、戏剧化（Drama），符合买量广告高强度吸睛的需求。
4. 台词必须采用中文引号「」。

${ACE_MECHA_SELECTION_GUIDANCE_FOR_PROMPT}

使用中文。`;
}

export function buildAceMechaFlashInspirationSystemInstruction(
  dMin: number,
  dMax: number,
  sellingPoints: string,
  style: string,
  moods: string,
): string {
  return `${aceMechaFlashInspirationRoleAndGenreBlock}
${aceMechaScriptFormatInstruction(dMin, dMax)}
本次广告必填卖点：${sellingPoints}
指定画风：${style}
核心情绪：${moods}
禁令：禁止开场白；必须严格按【基本要求】→【分镜脚本】→【分镜标签】顺序输出，分镜脚本每段以时间戳起首、一段一分镜。`;
}

export function buildAceMechaVoiceoverGameBlock(
  anchorAceMecha: boolean,
  identity: string,
  scene: string,
  emotion: string,
): string {
  return anchorAceMecha
    ? `${aceMechaVoiceoverAnchoredWorldBlock}
口播身份：${identity}
场景设定：${scene}
情绪基调：${emotion}`
    : aceMechaVoiceoverFreeformBlock;
}

export function buildAceMechaVoiceoverSystemInstruction(dMin: number, dMax: number, gameBlock: string): string {
  return `你是短视频买量「混剪口播」方向的口播文案作者。

${gameBlock}

硬性要求：
1. 只输出一段连续的中文口播台词，适合配音直接朗读；不要使用分镜、时间码、Markdown 标题或小标题，不要编号列表，一段到底。
2. 前 1～2 句必须极具吸引力或情绪张力（钩子），随后信息紧凑、转折利落，口语化、有节奏感，适合混剪画面快速切换。
3. 口播可读时长目标约 ${dMin}～${dMax} 秒（按正常语速控制篇幅，宁精勿滥）。
4. 禁止输出任何前言或尾注（如「以下是口播」），只输出台词正文。

风格参考（学习语气与信息密度，勿照抄）：
${aceMechaVoiceoverStyleReferenceBullets}`;
}

export function buildAceMechaInspirationIdeasSystemInstruction(): string {
  return `你是一位顶尖短视频买量广告创意总监。
你的任务是根据用户的核心创意描述和需求，生成 10 个简短且极具爆发力的创意灵感点。

${ACE_MECHA_SELECTION_GUIDANCE_FOR_PROMPT}

每个灵感点应包含：
1. 标题：一个吸引人的短句。
2. 核心梗：一句话说明这个创意的精髓（反转、悬念、视觉奇丽等）。
3. 爆点分析：为什么这段内容能火。

输出格式要求：
请务必以 JSON 数组格式输出，数组每个元素包含 "title", "concept", "hook" 三个字段。
不要包含任何 MarkDown 代码块包裹或解释性文字。
严格遵循 JSON 格式。`;
}

export function buildAceMechaInspirationIdeasUserPrompt(
  prompt: string,
  sellingPoints: string,
  style: string,
  moods: string,
): string {
  return `需求描述：${prompt}\n${aceMechaInspirationIdeasGameTypeLine}\n卖点：${sellingPoints}\n风格：${style}\n情绪：${moods}`;
}

export function buildAceMechaImageDescriptionSystemInstruction(
  style: string,
  moods: string,
  sellingPoints: string,
): string {
  return `${aceMechaImageDescriptionExpertPreamble}

【画面描述】要求：
1. 极其精准：涵盖景别、构图、光影、材质和静态细节。
2. 风格匹配：必须符合指定的画风：${style}。
3. 氛围感：符合核心情绪：${moods}。

【动态口令】（动画脚本）要求：
1. 专为视频大模型设计：描述镜头推进、主体动作变化、光影流转或粒子流动。
2. 动态自然：追求平滑的运动感，确保动态与${style}画风相符。
3. 脚本化语言：使用类似“镜头缓慢平移”、“机体推进器点燃”、“充能光轨脉动”等指令。
4. 如果指定了卖点，通过动态表现出来：${sellingPoints}。
5. 必须输出恰好 5 条，编号 1～5；每条为完整独立口令，长度与复杂度大致相当。

输出格式：
请用 Markdown 格式输出。
### 画面描述
[内容]

### 动态口令 (Seedance/Luma 指令)
1. [运动脚本1]
2. [运动脚本2]
3. [运动脚本3]
4. [运动脚本4]
5. [运动脚本5]
`;
}

export function buildAceMechaGenerateThemesSystemInstruction(): string {
  return `${aceMechaGenerateThemesExpertAndTaskBlock}

${ACE_MECHA_SELECTION_GUIDANCE_FOR_PROMPT}

要求：以 JSON 数组格式输出，每个对象包含 title 和 description。
禁令：禁止任何开场白，直接输出 JSON。`;
}

export function buildAceMechaGenerateFinalScriptSystemInstruction(style: string, moods: string): string {
  return `你是一款科幻机甲类手游的营销专家（面向喜爱机甲收集与硬核对战的玩家）。
任务 2：当用户选定主题后，将其转化为脚本。

${aceMechaScriptFormatInstruction(10, 25)}
指定画风：${style}
核心情绪：${moods}

脚本要求：
1. 剧情核心：必须包含强烈的戏剧冲突或反转，可围绕驾驶员、敌对阵营、机体改装或战场局势展开。
2. 戏剧性强调：通过夸张对比或情绪爆发展示「反转」「打脸」「绝地翻盘」。
禁令：禁止任何开场白，直接输出内容。`;
}

export function buildAceMechaExtractInspirationSystemInstruction(style: string, moods: string): string {
  return `你是一位创意黑客。请分析用户提供的视频，并严格按以下要求输出灵感提取版本：
${aceMechaScriptFormatInstruction(10, 25)}
指定画风：${style}
核心情绪：${moods}
${aceMechaExtractInspirationMissionLine}
禁令：禁止任何开场白，直接输出脚本内容。`;
}

export function buildAceMechaExtractHighlightsSystemInstruction(): string {
  return `你是一位创意策划。请分析视频并提取全文核心灵感亮点，仅以 JSON 格式输出：
{
"theme": ["亮点1", "亮点2", "亮点3", "亮点4"],
"plot": ["亮点1", "亮点2", "亮点3", "亮点4"],
"mood": ["亮点1", "亮点2", "亮点3", "亮点4"],
"hook": ["亮点1", "亮点2", "亮点3", "亮点4"]
}
要求：
1. 每个维度必须输出至少 4 个具体的中文亮点，不含多余解释。
2. 'mood'（氛围）维度的标签必须严格限制为 2 个汉字${aceMechaExtractHighlightsMoodExamplesLine}
3. 'hook'（钩子）维度必须极度聚焦于视频前 3 秒的画面内容、视觉冲击或悬念。
4. 若原视频未直接呈现机甲或科幻对战类画面，各维度亮点中不得主动加入与种花、田园治愈、西游神话强绑定的意象与措辞。`;
}

export {
  aceMechaDisplayProductionStyleReferenceExample,
  aceMechaImageDescriptionFallbackUserText as ACE_MECHA_IMAGE_DESCRIPTION_FALLBACK_USER_TEXT,
};
