/**
 * 治愈系种花经营手游（默认产品）相关 Prompt 文案与组装逻辑。
 * 从 geminiBackend 抽离，便于后续增加其他游戏 Profile；当前输出应与抽离前完全一致。
 *
 * ── 与工作流 / 书签的对应关系（只读注释，便于维护）──
 * - 「灵感工坊」顶部 Tab：灵光一闪 | 创意迭代 | 灵感萃取（见前端 CreativeWorkshop / InspirationExtraction 等）。
 * - 「灵光一闪」内三个书签：分镜脚本 | 混剪口播脚本 | 展示类脚本。
 * - 「跨多个工作流复用」：指同一段规则/格式被拼进不同 op 的 system 里，不是指前端同一个按钮。
 * - 未包含在本文件：op `generateDisplayProductionScript`（展示类「全文制作脚本」长示例）、`diagnoseFlashScript`（分镜诊断）仍在 geminiBackend.ts。
 * - 「创意迭代」Tab（ContentIteration，视频 1:1 拆解）走 op `analyzeVideoIteration`，与本文件无关。
 */

/**
 * 【跨多个工作流复用 · 场景/意象约束】
 * 嵌入位置：本文件内 `flowerScriptFormatInstruction`；以及「灵光一闪·分镜」灵感 JSON、「灵光一闪·展示类」画面口令、
 * 「灵感萃取」主题生成等独立 system 文案中（见各 build* 函数内 `${FLOWER_AVOID_DEEP_SEA_SCENE_RULE}`）。
 * 规定的是「输出里不要默认写深海、优先生活化种花场景」这一类全局偏好，不是某一个书签独有。
 */
export const FLOWER_AVOID_DEEP_SEA_SCENE_RULE = `场景与意象约束：除非用户在需求描述中明确要求，否则禁止在标题、灵感点、画面、台词与设定中强调「深海、海底、海洋深处、水族馆、潜水、潜艇、浪下世界」等与深海或大洋强绑定的元素或隐喻；默认优先花园、阳台、阳光花房、客厅绿植、小院露台、花店等生活化种花与居家疗愈场景。`;

/**
 * 【跨多个工作流复用 · 分镜脚本输出格式】
 * 用于：① 灵感工坊 → 灵光一闪 → 书签「分镜脚本」→ 直接生成全文 / 从灵感卡片生成全文（op: generateFlashInspiration）；
 * ② 灵感工坊 → Tab「灵感萃取」→ 选定主题后生成定稿脚本（op: generateFinalScript）；
 * ③ 服务端 op: extractInspiration（当前仓库内前端未调用；若接入则与「视频→带分镜结构的脚本」一致，仍走本格式）。
 * 内含分镜台词示例句、种花核心卖点枚举、以及上面的深海/场景约束片段。
 */
export function flowerScriptFormatInstruction(totalDurationMin: number, totalDurationMax: number): string {
  // 模板内依次为：输出顺序与章节、基本要求字段、分镜段落示例、分镜标签、时长规则、深海/场景约束、中文要求。
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
[00:00-00:05] 近景固定镜头下，阳光花房里花瓣簌簌落下；小花惊恐地瞪大眼睛、夸张张开嘴巴说：「这也太解压了吧！」背景轻柔的钢琴 BGM 渐强。

【分镜标签】
核心冲突：[内容]
情绪：[内容]
景别：[内容]
运镜：[内容]
画面：[内容]
动作：[内容]
配音：[内容]
核心卖点：[必须从以下选择：种花送时装、种花送家装、种花治愈、种花经营、种花送真花、萌宠及其他]

1. 脚本总时长必须严格控制在 ${totalDurationMin}-${totalDurationMax} 秒之间；各分镜时间戳须连贯铺满从 [00:00] 到结束，且首尾时间与总时长一致。
2. 每个分镜必须单独分段输出，不得连成一段。
3. 动作描述保持夸张、戏剧化（Drama），符合买量广告高强度吸睛的需求。
4. 台词必须采用中文引号「」。

${FLOWER_AVOID_DEEP_SEA_SCENE_RULE}

使用中文。`;
}

/**
 * 【仅 · 灵感工坊 → 灵光一闪 → 书签「分镜脚本」】
 * op: generateFlashInspiration。与「生成创意灵感」JSON（见下方 buildFlowerInspirationIdeas*）是两条不同链路。
 */
export function buildFlowerFlashInspirationSystemInstruction(
  dMin: number,
  dMax: number,
  sellingPoints: string,
  style: string,
  moods: string,
): string {
  return `你是一位顶尖受众心理学家。你的任务是根据用户的需求，为治愈系种花经营手游生成极具爆发力的买量广告脚本。
${flowerScriptFormatInstruction(dMin, dMax)}
本次广告必填卖点：${sellingPoints}
指定画风：${style}
核心情绪：${moods}
游戏类型：治愈系种花经营手游，包含种花、装饰、互动、解压治愈。
禁令：禁止开场白；必须严格按【基本要求】→【分镜脚本】→【分镜标签】顺序输出，分镜脚本每段以时间戳起首、一段一分镜。`;
}

/**
 * 【仅 · 灵感工坊 → 灵光一闪 → 书签「混剪口播脚本」】
 * op: generateVoiceoverScript 中「是否锚定种花世界观」分支文案；与 buildFlowerVoiceoverSystemInstruction 成对使用。
 */
export function buildFlowerVoiceoverGameBlock(
  flower: boolean,
  identity: string,
  scene: string,
  emotion: string,
): string {
  return flower
    ? `用户已勾选「种花游戏」口播：内容需围绕治愈系种花经营类休闲手游展开，可自然融入种花、装饰花园、治愈解压、线上花店、兑换真花包邮到家等利益点中的 1～3 个，语气像真实玩家或主创分享；产品名可虚构（如「深海花园」类），不要堆砌超过三个硬广词。
口播身份：${identity}
场景设定：${scene}
情绪基调：${emotion}`
    : `用户未勾选「种花游戏」：严格依据用户提示词创作，不要擅自加入种花手游设定或产品名，除非用户提示词里已出现相关内容。`;
}

/**
 * 【仅 · 灵感工坊 → 灵光一闪 → 书签「混剪口播脚本」】
 * op: generateVoiceoverScript 的 system；内含口播语气/钩子/时长等规则 + 风格参考示例 bullet（非分镜格式）。
 */
export function buildFlowerVoiceoverSystemInstruction(dMin: number, dMax: number, gameBlock: string): string {
  return `你是短视频买量「混剪口播」方向的口播文案作者。

${gameBlock}

硬性要求：
1. 只输出一段连续的中文口播台词，适合配音直接朗读；不要使用分镜、时间码、Markdown 标题或小标题，不要编号列表，一段到底。
2. 前 1～2 句必须极具吸引力或情绪张力（钩子），随后信息紧凑、转折利落，口语化、有节奏感，适合混剪画面快速切换。
3. 口播可读时长目标约 ${dMin}～${dMax} 秒（按正常语速控制篇幅，宁精勿滥）。
4. 禁止输出任何前言或尾注（如「以下是口播」），只输出台词正文。

风格参考（学习语气与信息密度，勿照抄）：
- 普通玩家 + 姐妹情感共鸣 + 惊喜：可先以强情绪口语开场，铺陈现实痛点，再转向产品带来的治愈与轻量成就。
- 游戏制作人 + 权威采访 + 惊喜：诚恳、第一人称谈创作初心，温暖克制，少用喊麦式辞令。`;
}

/**
 * 【仅 · 灵感工坊 → 灵光一闪 → 书签「分镜脚本」】
 * op: generateInspirationIdeas 的 system（与下方 userPrompt 配对）；只负责「10 条灵感 JSON」结构，不用于口播/展示类。
 */
export function buildFlowerInspirationIdeasSystemInstruction(): string {
  return `你是一位顶尖短视频买量广告创意总监。
你的任务是根据用户的核心创意描述和需求，生成 10 个简短且极具爆发力的创意灵感点。

${FLOWER_AVOID_DEEP_SEA_SCENE_RULE}

每个灵感点应包含：
1. 标题：一个吸引人的短句。
2. 核心梗：一句话说明这个创意的精髓（反转、悬念、视觉奇丽等）。
3. 爆点分析：为什么这段内容能火。

输出格式要求：
请务必以 JSON 数组格式输出，数组每个元素包含 "title", "concept", "hook" 三个字段。
不要包含任何 MarkDown 代码块包裹或解释性文字。
严格遵循 JSON 格式。`;
}

/**
 * 【仅 · 灵感工坊 → 灵光一闪 → 书签「分镜脚本」】
 * op: generateInspirationIdeas 的 user 侧拼接（与上条 system 配对）。
 */
export function buildFlowerInspirationIdeasUserPrompt(
  prompt: string,
  sellingPoints: string,
  style: string,
  moods: string,
): string {
  return `需求描述：${prompt}\n游戏类型：治愈系种花经营手游，包含种花、装饰、互动、解压治愈\n卖点：${sellingPoints}\n风格：${style}\n情绪：${moods}`;
}

/**
 * 【仅 · 灵感工坊 → 灵光一闪 → 书签「展示类脚本」】
 * op: generateImageDescription 的 system（画面描述 + 5 条动态口令 Markdown）；与口播/分镜全文不是同一套提示。
 */
export function buildFlowerImageDescriptionSystemInstruction(
  style: string,
  moods: string,
  sellingPoints: string,
): string {
  return `你是一位顶尖买量广告视觉指导和视频大模型提示词专家。
你的任务是根据提供的图片（若有）和创意描述，生成详细的【画面描述】和恰好 5 条、彼此明显不同的专为 Seedance、Runway 等视频生成模型设计的【动态口令】（运动脚本）。5 条口令须在镜头侧重、运动方式或情绪张力上各有区分，禁止 5 条雷同或仅换一两个词。

${FLOWER_AVOID_DEEP_SEA_SCENE_RULE}

【画面描述】要求：
1. 极其精准：涵盖景别、构图、光影、材质和静态细节。
2. 风格匹配：必须符合指定的画风：${style}。
3. 氛围感：符合核心情绪：${moods}。

【动态口令】（动画脚本）要求：
1. 专为视频大模型设计：描述镜头推进、主体动作变化、光影流转或粒子流动。
2. 动态自然：追求平滑的运动感，确保动态与${style}画风相符。
3. 脚本化语言：使用类似“镜头缓慢平移”、“主体微微转头”、“光效如呼吸般闪烁”等指令。
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

/**
 * 【仅 · 灵感工坊 → 灵光一闪 → 书签「展示类脚本」】
 * op: generateImageDescription：无参考图且用户未填 prompt 时，写入请求 parts 的默认用户句（非 system）。
 */
export const FLOWER_IMAGE_DESCRIPTION_FALLBACK_USER_TEXT = '请根据治愈系卖点生成画面描述和口令。';

/**
 * 【仅 · 灵感工坊 → Tab「灵感萃取」】
 * op: generateThemes（提取视频亮点之后、生成 5 个主题卡片那一步）；不属于灵光一闪任一书签。
 */
export function buildFlowerGenerateThemesSystemInstruction(): string {
  return `你是一款治愈系种花经营手游（面向20-40岁女性）的营销专家。
任务 1：结合用户选中的灵感点和元素配置，生成 5 版不同的创意主题（包含标题和 100 字内描述）。

${FLOWER_AVOID_DEEP_SEA_SCENE_RULE}

创意风格要求：
1. 必须全部是【剧情类】或【戏剧性的人物互动】。
2. 核心冲突点应聚焦于：反转、打脸、攀比、误会或情感波动。
3. 描述中要体现出种花类治愈经营手游的特色（如：种花配送真花、精致经营）。
要求：以 JSON 数组格式输出，每个对象包含 title 和 description。
禁令：禁止任何开场白，直接输出 JSON。`;
}

/**
 * 【仅 · 灵感工坊 → Tab「灵感萃取」】
 * op: generateFinalScript（用户选定主题后的定稿脚本）；内部复用了 `flowerScriptFormatInstruction`（见文件顶部「跨工作流」说明）。
 */
export function buildFlowerGenerateFinalScriptSystemInstruction(style: string, moods: string): string {
  return `你是一款治愈系种花经营手游（面向20-40岁女性）的营销专家。
任务 2：当用户选定主题后，将其转化为脚本。

${flowerScriptFormatInstruction(10, 25)}
指定画风：${style}
核心情绪：${moods}

脚本要求：
1. 剧情核心：必须包含强烈的戏剧冲突或反转，侧重于人物之间的互动。
2. 戏剧性强调：必须通过夸张的对比或情绪爆发展示“反转”、“打脸”或“冲突”。
禁令：禁止任何开场白，直接输出内容。`;
}

/**
 * 【服务端 op: extractInspiration · 当前仓库前端未调用】
 * 若将来接入，语义为「视频 → 按分镜格式输出的灵感/脚本」；与灵光一闪书签、灵感萃取 Tab 的现有按钮无直接一一对应。
 * 同样复用 `flowerScriptFormatInstruction`。
 */
export function buildFlowerExtractInspirationSystemInstruction(style: string, moods: string): string {
  return `你是一位创意黑客。请分析用户提供的视频，并严格按以下要求输出灵感提取版本：
${flowerScriptFormatInstruction(10, 25)}
指定画风：${style}
核心情绪：${moods}
主要任务：从视频中提取最吸睛的卖点逻辑，并结合治愈系种花经营手游的设定进行二次重构。
禁令：禁止任何开场白，直接输出脚本内容。`;
}

/**
 * 【仅 · 灵感工坊 → Tab「灵感萃取」】
 * op: extractHighlights（上传视频后第一步：theme/plot/mood/hook 四类亮点 JSON）；与分镜/口播/展示类书签无关。
 */
export function buildFlowerExtractHighlightsSystemInstruction(): string {
  return `你是一位创意策划。请分析视频并提取全文核心灵感亮点，仅以 JSON 格式输出：
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
}
