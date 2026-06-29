export type Platform = 'tiktok' | 'instagram' | 'youtube' | 'facebook' | 'pinterest';
export type VideoStatus = 'pending' | 'analyzed' | 'failed';
export type ScriptType = 'voiceover' | 'storyboard';
export type ScriptStatus = 'draft' | 'reviewed' | 'published';
export type AssetType = 'image' | 'video';
export type AssetStatus = 'generating' | 'done' | 'failed';
export type TrendStatus = 'pending' | 'selected';
export type YouTubeAccountStatus = 'connected' | 'error' | 'expired';

export interface VideoAiAnalysis {
  theme: string;
  hooks: string[];
  sellingPoints: string[];
  mood: string;
  structure: string;
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

// YouTube Integration Types
export interface YouTubeChannelInfo {
  id: string;
  title: string;
  description: string;
  customUrl?: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  thumbnailUrl?: string;
}

export interface YouTubeVideoData {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnailUrl: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  duration: string;
}

export interface YouTubeCommentData {
  id: string;
  authorName: string;
  authorProfileImageUrl?: string;
  textDisplay: string;
  likeCount: number;
  publishedAt: string;
  videoId: string;
}

export interface YouTubeSuperChatData {
  id: string;
  authorName: string;
  authorProfileImageUrl?: string;
  textDisplay: string;
  amountMicros: number;
  currency: string;
  publishedAt: string;
  videoId?: string;
}

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
