/**
 * 西游题材卡牌类 — Prompt 文案仓库；`server/xiyouGamePrompts.ts` 会引用本文件并在 `geminiBackend` 中于 `gameProfileId === 'xiyou_card'` 时启用。
 * 与 `flowerGamePrompts.ts` 的对应关系见各小节标题（便于逐项迁移）。
 */

/** 未来与请求体 `gameProfileId` 对齐时使用 */
export const NEW_GAME_PROFILE_ID = 'xiyou_card' as const;

/** 管理后台 / 调试展示名 */
export const NEW_GAME_DISPLAY_LABEL = '西游卡牌（草案）';

// ── 与前端下拉 / 请求体「画风、情绪、游戏类型」对齐（接入时在 prompt 中引用；前端选项请与此保持一致）──

/** 指定画风：选「其他（须填写）」须在请求或自定义栏填写具体画风描述 */
export const XIYOU_VISUAL_STYLE_OPTIONS = [
  '二次元画风',
  '新中式水墨风格',
  'Q版画风',
  '3D动漫炫酷画风',
  '复古平涂质感',
  '传统手绘国风动画',
  '其他（须填写）',
] as const;

/** 核心情绪：选「其他（须填写）」须填写具体情绪基调 */
export const XIYOU_CORE_MOOD_OPTIONS = [
  '战斗对峙',
  '紧张刺激',
  '3D高燃',
  '沉稳隐忍',
  '霸气凌厉',
  '其他（须填写）',
] as const;

/** 游戏类型标签（可与西游世界观组合理解） */
export const XIYOU_GAME_TYPE_OPTIONS = ['卡牌', '休闲', '战斗', '自走棋', '全新版本'] as const;

/**
 * 供未来拼进各 op 的 system：说明用户侧「画风 / 情绪 / 游戏类型」与上列枚举的对应关系。
 */
export const XIYOU_SELECTION_GUIDANCE_FOR_PROMPT = `【用户侧选填约定（与产品配置一致）】
指定画风：通常从以下择一写入画风字段（选「其他（须填写）」时须在请求或自定义栏给出具体画风描述）：${XIYOU_VISUAL_STYLE_OPTIONS.join('、')}
核心情绪：通常从以下择一写入情绪字段（选「其他（须填写）」时须给出具体情绪基调）：${XIYOU_CORE_MOOD_OPTIONS.join('、')}
游戏类型标签：从以下择一或组合理解：${XIYOU_GAME_TYPE_OPTIONS.join('、')}`;

// 说明：西游卡牌草案暂不维护「场景 / 禁忌 / 默认意象」独立约束段（原 newGameSceneConstraintRule）；需要时再加回并与各 build 拼接。

// ── 对应 flower: flowerScriptFormatInstruction 内「核心卖点」枚举与分镜结构说明 ──
export const newGameStoryboardCoreSellingEnumLine = `核心卖点：[必须从以下选择：抽卡高稀有、抽卡高爆率、零氪金、无任务系统干扰、无新手任务、阵容羁绊、职业搭配、技能搭配、养成突破、限时活动、福利登录、国风美术、及其他]`;

// ── 对应 flower: buildFlowerFlashInspirationSystemInstruction 中「角色 + 游戏类型」段（不含分镜格式块时可只写人设句）──
export const newGameFlashInspirationRoleAndGenreBlock = `你是一位熟悉国风神话与卡牌买量的创意编剧。你的任务是根据用户需求，为「西游题材卡牌类」手游（取经路与神妖对决为核心，卡牌收集与阵容策略为玩法）生成极具爆发力的买量广告脚本。
游戏类型标签：${XIYOU_GAME_TYPE_OPTIONS.join('、')}；玩法包含抽卡、布阵、羁绊、闯关、对战、养成与国风战斗演出。`;

// ── 对应 flower: buildFlowerInspirationIdeasUserPrompt 里「游戏类型：…」那一行 ──
export const newGameInspirationIdeasGameTypeLine = `游戏类型标签：${XIYOU_GAME_TYPE_OPTIONS.join('、')}；内容侧重：神佛妖将收集、阵容羁绊、取经路关卡、技能职业搭配、活动福利`;

// ── 对应 flower: buildFlowerVoiceoverGameBlock 勾选「锚定游戏」时的长说明 ──
export const newGameVoiceoverAnchoredWorldBlock = `用户已勾选「西游卡牌」口播：内容需围绕西游故事背景与卡牌策略对战展开，可自然融入抽卡爆稀有、羁绊连携、放置养成、无限策略搭配、登录送抽、国风战斗特效等利益点中的 1～3 个，语气像老玩家安利或策划揭秘；产品名可虚构（如「西行卡组」类），不要堆砌超过三个硬广词。`;

// ── 对应 flower: buildFlowerVoiceoverGameBlock 未勾选时的否定说明 ──
export const newGameVoiceoverFreeformBlock = `用户未勾选「西游卡牌」：严格依据用户提示词创作，不要擅自加入西游卡牌设定、取经路或抽卡话术，除非用户提示词里已出现相关内容。`;

// ── 对应 flower: buildFlowerVoiceoverSystemInstruction 末尾「风格参考」bullet ──
export const newGameVoiceoverStyleReferenceBullets = `- 热血玩家 + 逆袭爽点 + 惊喜：可先以强冲突口语开场，再转向抽卡/羁绊翻盘带来的爽感与策略感。
- 策划视角 + 爆料口吻 + 期待：克制透露版本设计意图，突出「这张卡改写了战局」一类信息密度。`;

// ── 对应 flower: buildFlowerImageDescriptionSystemInstruction 中除变量插值外的专有说明（可选整段覆盖）──
export const newGameImageDescriptionExpertPreamble = `你是一位顶尖买量视觉指导，擅长男性向卡牌对战场面。生成画面与动态口令时，优先体现：卡牌阵面、角色立绘剪影、法宝光轨、祥云妖雾、取经路途景、战斗 UI 粒子等与西游卡牌气质一致的元素。`;

// ── 对应 flower: FLOWER_IMAGE_DESCRIPTION_FALLBACK_USER_TEXT ──
export const newGameImageDescriptionFallbackUserText =
  '请根据西游卡牌卖点与热血战斗气质生成画面描述和口令。';

// ── 对应 flower: buildFlowerGenerateThemesSystemInstruction 里「营销专家 + 任务1」人设与种花特色段 ──
export const newGameGenerateThemesExpertAndTaskBlock = `你是一款西游题材卡牌类手游的营销专家（面向喜爱国风神话与策略对战的玩家）。
任务 1：结合用户选中的灵感点和元素配置，生成 5 版不同的创意主题（包含标题和 100 字内描述）。

创意风格要求：
1. 是【画面展示类】或【剧情类】，依据用户选择而定。可与取经、斗法、因果反转或西游记本身故事背景或角色性格结合。
2. 核心冲突点应聚焦于：主角逆袭、任务打斗、凭借卡牌技能组合以弱胜强越级挑战、羁绊翻盘、抽卡悬念或阵营对立。
3. 描述中要体现出卡牌对战的爽点（如：羁绊连携、关键一抽翻盘、闯关BOSS机制、无限搭配从而以弱胜强）。`;

// ── 对应 flower: buildFlowerGenerateFinalScriptSystemInstruction 里「任务2 + 脚本要求」──
export const newGameGenerateFinalScriptTaskBlock = `任务 2：当用户选定主题后，将其转化为脚本。
脚本要求：
1. 剧情核心：必须包含强烈的戏剧冲突或反转，可围绕取经小队、妖王、天庭博弈或卡组策略抉择展开。
2. 戏剧性强调：通过夸张对比或情绪爆发展示「反转」「打脸」「绝地翻盘」。
禁令：禁止任何开场白，直接输出内容。`;

// ── 对应 flower: buildFlowerExtractInspirationSystemInstruction 里「主要任务」一句 ──
export const newGameExtractInspirationMissionLine = `主要任务：从视频中提取最吸睛的卖点逻辑，并结合西游题材卡牌类（取经闯关+阵容对战）的设定进行二次重构。`;

// ── 对应 flower: buildFlowerExtractHighlightsSystemInstruction 里 mood 举例等 ──
export const newGameExtractHighlightsMoodExamplesLine = `（例如：燃斗、谋略、神妖、羁绊、反转、打脸、温情）`;

// ── 对应 geminiBackend 内 buildGenerateDisplayProductionScriptParams 的「风格与结构参考」长示例（猫咪泳池类）──
export const newGameDisplayProductionStyleReferenceExample =
  '固定镜头，画面中，取经路沙暴渐起，前景是悬浮旋转的金色卡牌阵面，卡牌上闪过神将剪影与羁绊符文；中景孙悟空单手持棒立于裂石之上，衣带与毫毛随风微动，对面妖王化出黑雾爪影却停在阵前一步；远景天际线露出灵山轮廓与破碎天门光柱。运镜：全程固定镜头，画面稳定不推拉摇移，动态细节按顺序呈现。动态细节：风沙颗粒在光束中缓慢翻滚，卡牌边缘流光沿纹路脉动；孙悟空肩甲与棒身火星细溅，瞳孔中映出对手技能读条；黑雾爪影与金色阵纹碰撞时激起环形冲击波，地面裂纹微亮；远处云层缓慢位移，法宝余晖在沙面拉出长影，营造神妖对峙、一触即发的国风战斗氛围。整体线条利落，色彩饱和偏金红与玄黑对比，无文字干扰、无变形，动态自然丝滑无卡顿。';