export type Platform = 'tiktok' | 'instagram' | 'youtube' | 'facebook';
export type VideoStatus = 'pending' | 'analyzed' | 'failed';
export type ScriptType = 'voiceover' | 'storyboard';
export type ScriptStatus = 'draft' | 'reviewed' | 'published';
export type AssetType = 'image' | 'video';
export type AssetStatus = 'generating' | 'done' | 'failed';
export type TrendStatus = 'pending' | 'selected';

export interface VideoAiAnalysis {
  theme: string;
  hooks: string[];
  sellingPoints: string[];
  mood: string;
  structure: string;
  firstTenSeconds?: {
    atmosphere?: string;
    audioVisual?: string;
    camera?: string;
    visuals?: string;
    voiceMusic?: string;
  };
  coarseStructure?: Array<{
    time?: string;
    frame?: string;
    label?: string;
    description?: string;
  }>;
  scriptSummary15s?: {
    visualStyle?: string;
    coreEmotion?: string;
    competitors?: string[];
  };
  scriptDetails15s?: Array<{
    time?: string;
    timestamp?: string;
    shot?: string;
    camera?: string;
    visual?: string;
    subtitle?: string;
    audio?: string;
    note?: string;
  }>;
  recommendedScriptType: 'voiceover' | 'storyboard';
}

export interface VoiceoverContent {
  hook: string;
  body: string[];
  cta: string;
  duration: string;
  hashtags: string[];
}

export interface StoryboardScene {
  index: number;
  duration: number;
  shot: string;
  camera: string;
  action: string;
  voiceover: string;
  caption: string;
}

export interface StoryboardContent {
  scenes: StoryboardScene[];
}

export type ScriptContent = VoiceoverContent | StoryboardContent;

export const SUPPORTED_LANGUAGES = [
  'en', 'zh', 'es', 'ar', 'fr', 'de', 'pt', 'ru', 'ja', 'ko',
  'it', 'nl', 'pl', 'tr', 'vi', 'th', 'id', 'ms', 'hi', 'bn',
  'fa', 'uk', 'ro', 'sv', 'da', 'fi',
] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English', zh: '中文', es: 'Español', ar: 'العربية', fr: 'Français',
  de: 'Deutsch', pt: 'Português', ru: 'Русский', ja: '日本語', ko: '한국어',
  it: 'Italiano', nl: 'Nederlands', pl: 'Polski', tr: 'Türkçe', vi: 'Tiếng Việt',
  th: 'ภาษาไทย', id: 'Bahasa Indonesia', ms: 'Bahasa Melayu', hi: 'हिन्दी',
  bn: 'বাংলা', fa: 'فارسی', uk: 'Українська', ro: 'Română', sv: 'Svenska',
  da: 'Dansk', fi: 'Suomi',
};
