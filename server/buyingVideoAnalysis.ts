/**
 * 买量大屏 AI 分析结果归一化（scriptTags + hookAnalysisJson）
 */
import {
  BUYING_GENRE_TAGS,
  normalizeBuyingGenreTag,
  type BuyingGenreTag,
} from '../src/lib/buyingGenreTag';
import {
  BUYING_FIRST3S_HOOK_TYPES,
  normalizeBuyingFirst3sHookType,
  type BuyingFirst3sHookType,
} from '../src/lib/buyingHookTypes';
import {
  resolveThemeTagAgainstCatalog,
  type ThemeTagCatalogEntry,
} from '../src/lib/buyingThemeTagCatalog';

export { BUYING_GENRE_TAGS, type BuyingGenreTag };
export { BUYING_FIRST3S_HOOK_TYPES, type BuyingFirst3sHookType };

export interface BuyingEmotionPointPayload {
  t: number;
  intensity: number;
  note?: string;
}

export interface BuyingFullAnalysisPayload {
  totalSeconds: number;
  emotionCurve: BuyingEmotionPointPayload[];
  peak3sSec: number;
  peakFullSec: number;
  firstSellingPointSec: number;
}

export interface BuyingHookAnalysisPayload {
  first3sVisual: string;
  first3sDialogue: string;
  first3sHookType: BuyingFirst3sHookType;
  first3sHookTypeOther: string;
  coreGameplaySellingPoints: string;
  coreWelfareSellingPoints: string;
  endingGuidance: string;
  reusableViralPattern: string;
  fullAnalysis?: BuyingFullAnalysisPayload;
}

export interface BuyingVideoAiNormalized {
  scriptTags: [string, string, string];
  hookAnalysis: BuyingHookAnalysisPayload;
}

function clamp(s: unknown, max: number): string {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function normalizeGenreTag(raw: unknown): BuyingGenreTag {
  return normalizeBuyingGenreTag(clamp(raw, 24));
}

function normalizeThemeTags(
  raw: unknown,
  catalog?: readonly ThemeTagCatalogEntry[],
): [string, string] {
  let list: string[] = [];
  if (Array.isArray(raw)) {
    list = raw
      .filter((x): x is string => typeof x === 'string')
      .map((t) => t.replace(/\s+/g, '').slice(0, 4))
      .filter(Boolean);
  }
  if (catalog && catalog.length > 0) {
    list = list.map((t) => resolveThemeTagAgainstCatalog(t, catalog));
  }
  const deduped: string[] = [];
  for (const t of list) {
    if (!deduped.includes(t)) deduped.push(t);
  }
  list = deduped;
  while (list.length < 2) {
    list.push(list.length === 0 ? '吸睛开场' : '强节奏');
  }
  return [list[0]!, list[1]!];
}

function readHookField(obj: Record<string, unknown>, ...keys: string[]): string;
function readHookField(obj: Record<string, unknown>, maxLen: number, ...keys: string[]): string;
function readHookField(obj: Record<string, unknown>, ...args: (string | number)[]): string {
  const maxLen = typeof args[0] === 'number' ? args[0] : 120;
  const keys = (typeof args[0] === 'number' ? args.slice(1) : args) as string[];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return clamp(v, maxLen);
  }
  return '';
}

function mergeLegacyFirst3sVisual(hookRaw: Record<string, unknown>): string {
  const direct = readHookField(hookRaw, 96, 'first3sVisual', 'first3sVisualPresentation');
  if (direct) return direct;
  const parts = [
    readHookField(hookRaw, 48, 'firstFrameVisual', 'firstFrameVisualAnalysis'),
    readHookField(hookRaw, 48, 'first5sCamera', 'first5sCameraMovement'),
    readHookField(hookRaw, 48, 'firstFiveSecondsSummary', 'first5sSummary'),
  ].filter(Boolean);
  return parts.join('；').slice(0, 96);
}

export type NormalizeBuyingVideoAiOptions = {
  themeTagCatalog?: ThemeTagCatalogEntry[];
};

export function normalizeBuyingVideoAi(
  raw: Record<string, unknown>,
  options?: NormalizeBuyingVideoAiOptions,
): BuyingVideoAiNormalized {
  const genreTag = normalizeGenreTag(raw.genreTag ?? raw.genre ?? raw.videoType);
  const themeTags = normalizeThemeTags(raw.themeTags ?? raw.themeTag, options?.themeTagCatalog);

  let hookRaw: Record<string, unknown> | null = null;
  if (raw.hookAnalysis && typeof raw.hookAnalysis === 'object' && raw.hookAnalysis !== null) {
    hookRaw = raw.hookAnalysis as Record<string, unknown>;
  } else if (raw.hooksDeep && typeof raw.hooksDeep === 'object' && raw.hooksDeep !== null) {
    hookRaw = raw.hooksDeep as Record<string, unknown>;
  }

  const hookTypeRaw = hookRaw
    ? hookRaw.first3sHookType ?? hookRaw.hookType ?? hookRaw.first3sHookCategory
    : undefined;
  let first3sHookType = normalizeBuyingFirst3sHookType(hookTypeRaw);
  if (!hookTypeRaw && hookRaw) {
    const conflict = hookRaw.conflictOpening ?? hookRaw.opensWithConflict;
    if (conflict === true || conflict === 'true' || conflict === '是') {
      first3sHookType = '痛点暴击';
    }
  }

  const hookAnalysis: BuyingHookAnalysisPayload = {
    first3sVisual: hookRaw ? mergeLegacyFirst3sVisual(hookRaw) : '',
    first3sDialogue: hookRaw
      ? readHookField(
          hookRaw,
          96,
          'first3sDialogue',
          'first3sDialogueAndVoice',
          'first3sVoiceover',
          'first3sLines',
          'first3sSubtitles',
        )
      : '',
    first3sHookType,
    first3sHookTypeOther: hookRaw
      ? readHookField(hookRaw, 48, 'first3sHookTypeOther', 'hookTypeOtherNote', 'hookTypeManualNote')
      : '',
    coreGameplaySellingPoints: hookRaw
      ? readHookField(
          hookRaw,
          120,
          'coreGameplaySellingPoints',
          'gameplaySellingPoints',
          'corePlaySellingPoints',
        )
      : '',
    coreWelfareSellingPoints: hookRaw
      ? readHookField(
          hookRaw,
          120,
          'coreWelfareSellingPoints',
          'welfareSellingPoints',
          'benefitSellingPoints',
        )
      : '',
    endingGuidance: hookRaw
      ? readHookField(hookRaw, 96, 'endingGuidance', 'endingCta', 'closingGuidance')
      : '',
    reusableViralPattern: hookRaw
      ? readHookField(
          hookRaw,
          160,
          'reusableViralPattern',
          'viralPatternAnalysis',
          'reusablePattern',
        )
      : '',
  };

  const fill = (key: keyof BuyingHookAnalysisPayload, fallback: string) => {
    const v = hookAnalysis[key];
    if (typeof v === 'string' && !v) hookAnalysis[key] = fallback as never;
  };
  fill('first3sVisual', '（待分析）');
  fill('first3sDialogue', '（待分析）');
  fill('coreGameplaySellingPoints', '（待分析）');
  fill('coreWelfareSellingPoints', '（待分析）');
  fill('endingGuidance', '（待分析）');
  fill('reusableViralPattern', '（待分析）');
  if (hookAnalysis.first3sHookType !== '其他') {
    hookAnalysis.first3sHookTypeOther = '';
  }

  const fullRaw =
    raw.fullAnalysis && typeof raw.fullAnalysis === 'object'
      ? (raw.fullAnalysis as Record<string, unknown>)
      : hookRaw?.fullAnalysis && typeof hookRaw.fullAnalysis === 'object'
        ? (hookRaw.fullAnalysis as Record<string, unknown>)
        : null;

  if (fullRaw) {
    const totalSeconds = Math.max(3, Math.min(180, Number(fullRaw.totalSeconds) || 15));
    let curve = Array.isArray(fullRaw.emotionCurve) ? fullRaw.emotionCurve : [];
    curve = curve
      .map((p) => {
        const o = p as Record<string, unknown>;
        return {
          t: Math.max(0, Math.min(totalSeconds, Number(o.t) || 0)),
          intensity: Math.max(0, Math.min(100, Number(o.intensity) || 0)),
          note: typeof o.note === 'string' ? o.note.slice(0, 16) : undefined,
        };
      })
      .filter((p) => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);
    if (curve.length < 2) {
      curve = [
        { t: 0, intensity: 40 },
        { t: totalSeconds, intensity: 50 },
      ];
    }
    const clampSec = (v: unknown) =>
      Math.max(0, Math.min(totalSeconds, Number(v) || 0));
    hookAnalysis.fullAnalysis = {
      totalSeconds,
      emotionCurve: curve,
      peak3sSec: clampSec(fullRaw.peak3sSec ?? fullRaw.peak3s ?? 1.5),
      peakFullSec: clampSec(fullRaw.peakFullSec ?? fullRaw.peakFull ?? totalSeconds * 0.6),
      firstSellingPointSec: clampSec(
        fullRaw.firstSellingPointSec ?? fullRaw.firstSellingPoint ?? 8,
      ),
    };
    hookAnalysis.fullAnalysis.peak3sSec = Math.min(3, hookAnalysis.fullAnalysis.peak3sSec);
  }

  return {
    scriptTags: [genreTag, themeTags[0], themeTags[1]],
    hookAnalysis,
  };
}

const HOOK_PLACEHOLDER = '（待分析）';

function hookFieldMeaningful(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0 && v.trim() !== HOOK_PLACEHOLDER && v.trim() !== '—';
}

/** 是否已有新版 7 项钩子分析（仅旧版首帧/前5秒字段不算） */
export function hasMeaningfulHookAnalysis(record: Record<string, unknown>): boolean {
  const raw = record.hookAnalysisJson;
  if (typeof raw !== 'string' || !raw.trim() || raw === '{}' || raw === '[]') return false;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (
      hookFieldMeaningful(v.first3sHookType) ||
      hookFieldMeaningful(v.coreGameplaySellingPoints) ||
      hookFieldMeaningful(v.coreWelfareSellingPoints) ||
      hookFieldMeaningful(v.reusableViralPattern)
    ) {
      return true;
    }
    if (v.first3sHookType === '其他' && hookFieldMeaningful(v.first3sHookTypeOther)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function needsBuyingVideoAiBackfill(record: Record<string, unknown>): boolean {
  return !hasMeaningfulBuyingScriptTags(record) || !hasMeaningfulHookAnalysis(record);
}

export function hasMeaningfulBuyingScriptTags(record: Record<string, unknown>): boolean {
  const raw = record.scriptTags;
  if (typeof raw !== 'string' || !raw.trim()) return false;
  try {
    const arr = JSON.parse(raw) as unknown[];
    if (!Array.isArray(arr) || arr.length < 2) return false;
    const tags = arr.map((x) => String(x ?? '').trim()).filter(Boolean);
    if (tags.length >= 3 && !tags.slice(1).every((t) => t === '待分析')) return true;
    return tags.length >= 2 && tags[0].length > 0 && tags[1].length > 0;
  } catch {
    return false;
  }
}
