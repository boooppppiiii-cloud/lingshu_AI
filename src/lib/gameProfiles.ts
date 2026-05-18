/**
 * 与后端 `gameProfileId` / `server/gamePromptProfiles/*.prompts.ts` 对齐；变更枚举时请同步服务端文案。
 */
export type GameProfileId = 'flower' | 'xiyou_card' | 'ace_mecha';

export const GAME_PROFILE_STORAGE_KEY = 'lingqi-game-profile-v1';

export const GAME_PROFILE_OPTIONS: readonly {
  id: GameProfileId;
  label: string;
  shortLabel: string;
  subtitle: string;
}[] = [
  { id: 'flower', label: '治愈种花', shortLabel: '种花', subtitle: 'Creative Studio' },
  { id: 'xiyou_card', label: '西游卡牌', shortLabel: '西游', subtitle: 'Creative Studio' },
  { id: 'ace_mecha', label: '王牌机甲', shortLabel: '机甲', subtitle: 'Creative Studio' },
] as const;

const KNOWN_PROFILE_IDS: readonly GameProfileId[] = ['flower', 'xiyou_card', 'ace_mecha'];

/** 读库时：未写入或非已知值时按治愈种花处理 */
export function normalizeGameProfileId(raw: unknown): GameProfileId {
  if (raw === 'xiyou_card' || raw === 'ace_mecha') return raw;
  return 'flower';
}

export function isGameProfileId(raw: unknown): raw is GameProfileId {
  return typeof raw === 'string' && (KNOWN_PROFILE_IDS as readonly string[]).includes(raw);
}

/**
 * PocketBase `filter` 片段：只包含该游戏版本下的记录。
 * 上线前无 `gameProfileId` 的数据视为治愈种花（flower）。
 */
export function gameProfileScopeFilterExpr(fieldName: string, id: GameProfileId): string {
  if (id === 'flower') {
    return `(${fieldName} = "flower" || ${fieldName} = "" || ${fieldName} = null)`;
  }
  return `${fieldName} = ${JSON.stringify(id)}`;
}

export const FLOWER_SELLING_POINTS = [
  '种花送时装',
  '种花送家装',
  '种花领限定花种',
  '种花送真花',
  '种花解锁多种玩法',
  '其他',
] as const;

export const FLOWER_STYLES = ['真人3D写实风格', '华丽建模动画画风', 'Q版动漫人物画风', '赛博奇幻画风', '其他'] as const;

export const FLOWER_MOODS = [
  '温情',
  '治愈',
  '热血',
  '悲伤',
  '惊喜',
  '戏剧性',
  '反转打脸',
  '其他',
] as const;

export const XIYOU_SELLING_POINTS = [
  '抽卡高稀有',
  '抽卡高爆率',
  '零氪金',
  '无任务系统干扰',
  '无新手任务',
  '阵容羁绊',
  '职业搭配',
  '技能搭配',
  '养成突破',
  '限时活动',
  '福利登录',
  '国风美术',
  '其他',
] as const;

export const XIYOU_STYLES = [
  '二次元画风',
  '新中式水墨风格',
  'Q版画风',
  '3D动漫炫酷画风',
  '复古平涂质感',
  '传统手绘国风动画',
  '其他（须填写）',
] as const;

export const XIYOU_MOODS = [
  '战斗对峙',
  '紧张刺激',
  '3D高燃',
  '沉稳隐忍',
  '霸气凌厉',
  '其他（须填写）',
] as const;

export const ACE_MECHA_SELLING_POINTS = [
  '登录送SSR机体',
  '抽卡高爆率',
  '零氪可玩',
  '机体合体变身',
  '技能连招',
  '养成突破',
  'PVP竞技',
  '挂机收益',
  '限时活动',
  '科幻美术',
  '其他（须填写）',
] as const;

export const ACE_MECHA_STYLES = [
  '3D硬面机甲',
  '赛博朋克',
  '二次元机甲',
  '写实科幻',
  'Q版机甲',
  '其他（须填写）',
] as const;

export const ACE_MECHA_MOODS = [
  '燃炸对战',
  '紧张刺激',
  '史诗压迫',
  '热血逆袭',
  '冷静克制',
  '其他（须填写）',
] as const;

/** 创意工坊 → 灵光一闪 → 分镜脚本：核心创意输入框占位示例 */
export const FLOWER_FLASH_STORYBOARD_PLACEHOLDER =
  '例如：想要一个反转剧脚本，主角先是被看不起，然后通过展示奢华场景打脸对方...';

export const XIYOU_FLASH_STORYBOARD_PLACEHOLDER =
  '例如：卖点（十连高爆抽卡+羁绊连携翻盘）+玩法（取经路Boss战布阵，关键一抽神将触发羁绊以弱胜强反杀打脸）+情绪（3D高燃、霸气凌厉）';

export const ACE_MECHA_FLASH_STORYBOARD_PLACEHOLDER =
  '例如：卖点（登录送SSR+机体合体变身）+玩法（Boss战绝境触发合体反手斩杀翻盘）+情绪（燃炸对战、史诗压迫）';

/** 创意工坊 → 灵光一闪 → 展示类脚本：画面需求输入框占位示例 */
export const FLOWER_FLASH_DISPLAY_PLACEHOLDER =
  '描述希望突出的画面元素；可不填，仅依赖参考图。';

export const XIYOU_FLASH_DISPLAY_PLACEHOLDER =
  '例如：悬浮卡牌阵面流光、神将立绘对峙、取经路沙暴与法宝光轨；强调国风战斗粒子与一触即发氛围。可不填，仅依赖参考图。';

export const ACE_MECHA_FLASH_DISPLAY_PLACEHOLDER =
  '例如：巨型机甲对峙、驾驶舱HUD、推进器尾焰与战场硝烟粒子；强调科幻战斗氛围。可不填，仅依赖参考图。';

export type GameCreativeProfileBundle = {
  sellingPoints: readonly string[];
  styles: readonly string[];
  moods: readonly string[];
  defaultStyle: string;
  defaultStyleLabel: string;
  defaultMoods: string;
  customSellingPlaceholder: string;
  flashStoryboardPlaceholder: string;
  flashDisplayPlaceholder: string;
  /** 灵光一闪是否展示「混剪口播脚本」书签（仅种花） */
  supportsVoiceoverFlash: boolean;
};

export function getGameCreativeProfile(id: GameProfileId): GameCreativeProfileBundle {
  switch (id) {
    case 'xiyou_card':
      return {
        sellingPoints: XIYOU_SELLING_POINTS,
        styles: XIYOU_STYLES,
        moods: XIYOU_MOODS,
        defaultStyle: '二次元画风',
        defaultStyleLabel: '二次元画风 (默认)',
        defaultMoods: '紧张刺激、3D高燃',
        customSellingPlaceholder: '例如：十连高爆、羁绊连携翻盘、登录送抽…',
        flashStoryboardPlaceholder: XIYOU_FLASH_STORYBOARD_PLACEHOLDER,
        flashDisplayPlaceholder: XIYOU_FLASH_DISPLAY_PLACEHOLDER,
        supportsVoiceoverFlash: false,
      };
    case 'ace_mecha':
      return {
        sellingPoints: ACE_MECHA_SELLING_POINTS,
        styles: ACE_MECHA_STYLES,
        moods: ACE_MECHA_MOODS,
        defaultStyle: '3D硬面机甲',
        defaultStyleLabel: '3D硬面机甲 (默认)',
        defaultMoods: '燃炸对战、史诗压迫',
        customSellingPlaceholder: '例如：登录送SSR机体、机体合体变身、技能连招…',
        flashStoryboardPlaceholder: ACE_MECHA_FLASH_STORYBOARD_PLACEHOLDER,
        flashDisplayPlaceholder: ACE_MECHA_FLASH_DISPLAY_PLACEHOLDER,
        supportsVoiceoverFlash: false,
      };
    default:
      return {
        sellingPoints: FLOWER_SELLING_POINTS,
        styles: FLOWER_STYLES,
        moods: FLOWER_MOODS,
        defaultStyle: '真人3D写实风格',
        defaultStyleLabel: '真人3D写实 (默认)',
        defaultMoods: '治愈、惊喜',
        customSellingPlaceholder: '例如：种花兑换周边礼盒、限时花房装修…',
        flashStoryboardPlaceholder: FLOWER_FLASH_STORYBOARD_PLACEHOLDER,
        flashDisplayPlaceholder: FLOWER_FLASH_DISPLAY_PLACEHOLDER,
        supportsVoiceoverFlash: true,
      };
  }
}
