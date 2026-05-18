/**
 * 王牌机甲 — Prompt 文案仓库；`server/aceMechaGamePrompts.ts` 在 `gameProfileId === 'ace_mecha'` 时启用。
 */

export const ACE_MECHA_PROFILE_ID = 'ace_mecha' as const;

export const ACE_MECHA_DISPLAY_LABEL = '王牌机甲';

export const ACE_MECHA_VISUAL_STYLE_OPTIONS = [
  '3D硬面机甲',
  '赛博朋克',
  '二次元机甲',
  '写实科幻',
  'Q版机甲',
  '其他（须填写）',
] as const;

export const ACE_MECHA_CORE_MOOD_OPTIONS = [
  '燃炸对战',
  '紧张刺激',
  '史诗压迫',
  '热血逆袭',
  '冷静克制',
  '其他（须填写）',
] as const;

export const ACE_MECHA_GAME_TYPE_OPTIONS = ['机甲', '射击', '策略', '养成', 'PVP竞技'] as const;

export const ACE_MECHA_SELECTION_GUIDANCE_FOR_PROMPT = `【用户侧选填约定（与产品配置一致）】
指定画风：通常从以下择一写入画风字段（选「其他（须填写）」时须在请求或自定义栏给出具体画风描述）：${ACE_MECHA_VISUAL_STYLE_OPTIONS.join('、')}
核心情绪：通常从以下择一写入情绪字段（选「其他（须填写）」时须给出具体情绪基调）：${ACE_MECHA_CORE_MOOD_OPTIONS.join('、')}
游戏类型标签：从以下择一或组合理解：${ACE_MECHA_GAME_TYPE_OPTIONS.join('、')}`;

export const aceMechaStoryboardCoreSellingEnumLine = `核心卖点：[必须从以下选择：登录送SSR机体、抽卡高爆率、零氪可玩、机体合体变身、技能连招、养成突破、PVP竞技、挂机收益、限时活动、科幻美术、及其他]`;

export const aceMechaFlashInspirationRoleAndGenreBlock = `你是一位熟悉科幻机甲与动作射击买量的创意编剧。你的任务是根据用户需求，为「王牌机甲」手游（驾驶机甲征战、机体收集与改装为核心，PVP竞技与关卡推图为玩法）生成极具爆发力的买量广告脚本。
游戏类型标签：${ACE_MECHA_GAME_TYPE_OPTIONS.join('、')}；玩法包含机体养成、武器改装、技能连招、合体变身、Boss战、竞技排位与科幻战斗演出。`;

export const aceMechaInspirationIdeasGameTypeLine = `游戏类型标签：${ACE_MECHA_GAME_TYPE_OPTIONS.join('、')}；内容侧重：SSR机体收集、合体变身、技能连招、绝境翻盘、竞技碾压、活动福利`;

export const aceMechaVoiceoverAnchoredWorldBlock = `用户已勾选「王牌机甲」口播：内容需围绕机甲驾驶与机体对战展开，可自然融入登录送SSR、抽卡高爆、合体变身、技能连招、零氪可玩、PVP竞技等利益点中的 1～3 个，语气像老玩家安利或策划爆料；产品名可虚构（如「王牌机甲」类），不要堆砌超过三个硬广词。`;

export const aceMechaVoiceoverFreeformBlock = `用户未勾选「王牌机甲」：严格依据用户提示词创作，不要擅自加入机甲、合体或抽卡话术，除非用户提示词里已出现相关内容。`;

export const aceMechaVoiceoverStyleReferenceBullets = `- 热血玩家 + 逆袭爽点 + 惊喜：可先以强冲突口语开场，再转向合体/连招翻盘带来的爽感与操作感。
- 策划视角 + 爆料口吻 + 期待：克制透露版本设计意图，突出「这台机体改写了战局」一类信息密度。`;

export const aceMechaImageDescriptionExpertPreamble = `你是一位顶尖买量视觉指导，擅长科幻机甲对战场面。生成画面与动态口令时，优先体现：巨型机甲轮廓、驾驶舱HUD、武器充能光轨、推进器尾焰、战场硝烟粒子、城市废墟或太空港背景等与王牌机甲气质一致的元素。`;

export const aceMechaImageDescriptionFallbackUserText =
  '请根据王牌机甲卖点与科幻战斗气质生成画面描述和口令。';

export const aceMechaGenerateThemesExpertAndTaskBlock = `你是一款科幻机甲类手游的营销专家（面向喜爱机甲收集与硬核对战的玩家）。
任务 1：结合用户选中的灵感点和元素配置，生成 5 版不同的创意主题（包含标题和 100 字内描述）。

创意风格要求：
1. 是【画面展示类】或【剧情类】，依据用户选择而定。可与机甲合体、Boss压制、竞技碾压或驾驶员成长线结合。
2. 核心冲突点应聚焦于：主角逆袭、绝境合体、凭借技能连招以弱胜强、机体改装翻盘、抽卡悬念或阵营对立。
3. 描述中要体现出机甲对战的爽点（如：合体变身、关键一炮翻盘、Boss机制破解、无限搭配从而逆转战局）。`;

export const aceMechaGenerateFinalScriptTaskBlock = `任务 2：当用户选定主题后，将其转化为脚本。
脚本要求：
1. 剧情核心：必须包含强烈的戏剧冲突或反转，可围绕驾驶员、敌对阵营、机体抉择或战场局势展开。
2. 戏剧性强调：通过夸张对比或情绪爆发展示「反转」「打脸」「绝地翻盘」。
禁令：禁止任何开场白，直接输出内容。`;

export const aceMechaExtractInspirationMissionLine = `主要任务：从视频中提取最吸睛的卖点逻辑，并结合王牌机甲（机体养成+竞技对战）的设定进行二次重构。`;

export const aceMechaExtractHighlightsMoodExamplesLine = `（例如：燃炸、压迫、逆袭、机甲、连招、反转、打脸）`;

export const aceMechaDisplayProductionStyleReferenceExample =
  '固定镜头，画面中，废墟城市天际线下两台巨型机甲对峙，前景是半透明驾驶舱HUD与充能进度条闪烁；中景主角机体肩甲推进器点燃蓝色尾焰，对面重型机甲炮口聚能却停在锁定线外；远景战场硝烟与激光轨迹划过楼宇残骸。运镜：全程固定镜头，画面稳定不推拉摇移，动态细节按顺序呈现。动态细节：HUD数值跳动、机体装甲反光随光源扫过；推进器粒子向后喷射，地面碎石被气流卷起；炮口能量环逐级亮起后骤停，冲击波在机甲脚边荡开涟漪；远处爆炸火光间歇闪烁，尾焰在烟尘中拉出长光带，营造一触即发的科幻机甲战斗氛围。整体线条硬朗，色彩饱和偏青橙与金属灰对比，无文字干扰、无变形，动态自然丝滑无卡顿。';
