export type Platform = 'tiktok' | 'instagram' | 'youtube' | 'facebook';
export type VideoStatus = 'pending' | 'analyzed' | 'failed';
export type ScriptType = 'voiceover' | 'storyboard';
export type ScriptStatus = 'draft' | 'reviewed' | 'published';
export type AssetType = 'image' | 'video';
export type AssetStatus = 'generating' | 'done' | 'failed';
export type TrendStatus = 'pending' | 'selected';

export interface VideoGlobalSettings {
  visualStyle?: string;
  aspectRatio?: string;
  lighting?: string;
  subtitlePolicy?: string;
  audioPolicy?: string;
  identityConsistency?: string;
  productConsistency?: string;
  negativeConstraints?: string[];
}

export interface VideoSpatialContinuity {
  scene?: string;
  subjectAnchors?: Array<{
    subject?: string;
    position?: string;
    facing?: string;
    gazeTarget?: string;
    orientation?: string;
  }>;
  background?: string;
  backgroundPriority?: 'low' | 'medium' | 'high';
  depthOfField?: 'shallow' | 'moderate' | 'deep';
}

export interface VideoAiAnalysis {
  theme: string;
  hooks: string[];
  sellingPoints: string[];
  mood: string;
  structure: string;
  baseRequirements?: string;
  globalSettings?: VideoGlobalSettings;
  spatialContinuity?: VideoSpatialContinuity;
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
    environment?: string;
    shot?: string;
    camera?: string;
    angle?: string;
    composition?: string;
    visual?: string;
    subtitle?: string;
    audio?: string;
    note?: string;
    purpose?: string;
    dialogue?: string;
    onScreenText?: string;
    ambientSound?: string;
    bgm?: string;
    soundEffects?: string[];
    beats?: Array<{ time?: string; action?: string; dialogue?: string; onScreenText?: string }>;
    persistentState?: string;
    startState?: string;
    endState?: string;
    transitionToNext?: string;
    backgroundPriority?: 'low' | 'medium' | 'high';
    depthOfField?: 'shallow' | 'moderate' | 'deep';
    authenticity?: string;
    observedFacts?: string;
    inferredIntent?: string;
    causalGap?: string;
    omniPrompt?: string;
    omniNegativePrompt?: string;
    confidence?: number;
    needsReview?: boolean;
    estimatedSpeechDuration?: number;
    dialogueFits?: boolean;
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
  startTime?: number;
  endTime?: number;
  angle?: string;
  composition?: string;
  purpose?: string;
  startState?: string;
  endState?: string;
  transitionToNext?: string;
  lighting?: string;
  backgroundPriority?: 'low' | 'medium' | 'high';
  depthOfField?: 'shallow' | 'moderate' | 'deep';
  estimatedSpeechDuration?: number;
  dialogueFits?: boolean;
  ambientSound?: string;
  bgm?: string;
  soundEffects?: string[];
  generationPrompt?: string;
  negativePrompt?: string;
}

export interface StoryboardContent {
  scenes: StoryboardScene[];
  globalSettings?: VideoGlobalSettings;
  spatialContinuity?: VideoSpatialContinuity;
  totalDuration?: number;
  continuitySummary?: string;
  emotionArc?: string[];
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
