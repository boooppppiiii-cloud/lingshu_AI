export type AssistantAvatarOption = 0 | 1 | 2;

export type AssistantAvatarConfig = {
  hair: AssistantAvatarOption;
  pose: AssistantAvatarOption;
  bodyColor: AssistantAvatarOption;
  expression: AssistantAvatarOption;
  headAccessory: AssistantAvatarOption;
  faceAccessory: AssistantAvatarOption;
  bodyAccessory: AssistantAvatarOption;
};

export const DEFAULT_ASSISTANT_AVATAR: AssistantAvatarConfig = {
  hair: 0,
  pose: 0,
  bodyColor: 0,
  expression: 0,
  headAccessory: 0,
  faceAccessory: 0,
  bodyAccessory: 0,
};

export type AssistantAvatarCategory = keyof AssistantAvatarConfig;

export const ASSISTANT_AVATAR_CATEGORIES: {
  key: AssistantAvatarCategory;
  label: string;
  options: [string, string, string];
}[] = [
  { key: 'hair', label: '发型', options: ['天线呆毛', '短刺发', '猫耳'] },
  { key: 'pose', label: '默认姿势', options: ['挥手待命', '举手欢呼', '端正站立'] },
  { key: 'bodyColor', label: '身体颜色', options: ['科技蓝', '薄荷绿', '活力橙'] },
  { key: 'expression', label: '面部表情', options: ['微笑', '开心', '认真'] },
  { key: 'headAccessory', label: '头饰', options: ['无', '星星冠', '运动头带'] },
  { key: 'faceAccessory', label: '面部配饰', options: ['无', '圆框眼镜', '墨镜'] },
  { key: 'bodyAccessory', label: '身饰', options: ['无', '领带领结', '胸章'] },
];

export type BodyColorPalette = {
  body: string;
  bodyStroke: string;
  head: string;
  base: string;
  base2: string;
};

export const BODY_COLOR_PALETTES: BodyColorPalette[] = [
  { body: '#60a5fa', bodyStroke: '#2563eb', head: '#93c5fd', base: '#4f46e5', base2: '#6366f1' },
  { body: '#34d399', bodyStroke: '#059669', head: '#6ee7b7', base: '#047857', base2: '#10b981' },
  { body: '#fb923c', bodyStroke: '#ea580c', head: '#fdba74', base: '#c2410c', base2: '#f97316' },
];

function storageKey(userId: string) {
  return `assistant_avatar_${userId}`;
}

function clampOption(n: unknown): AssistantAvatarOption {
  const v = Number(n);
  if (v === 1 || v === 2) return v;
  return 0;
}

export function normalizeAssistantAvatar(raw: unknown): AssistantAvatarConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    hair: clampOption(o.hair),
    pose: clampOption(o.pose),
    bodyColor: clampOption(o.bodyColor),
    expression: clampOption(o.expression),
    headAccessory: clampOption(o.headAccessory),
    faceAccessory: clampOption(o.faceAccessory),
    bodyAccessory: clampOption(o.bodyAccessory),
  };
}

export function loadAssistantAvatar(userId: string): AssistantAvatarConfig {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { ...DEFAULT_ASSISTANT_AVATAR };
    return normalizeAssistantAvatar(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_ASSISTANT_AVATAR };
  }
}

export function saveAssistantAvatar(userId: string, config: AssistantAvatarConfig): void {
  localStorage.setItem(storageKey(userId), JSON.stringify(normalizeAssistantAvatar(config)));
}
