import type { RecordModel } from 'pocketbase';
import { normalizeBuyingFirst3sHookType } from './buyingHookTypes';
import type {
  BuyingDashboardMode,
  BuyingEmotionPoint,
  BuyingFullAnalysis,
  BuyingHookAnalysis,
  BuyingRankingSegment,
  BuyingVideoAdMetrics,
  BuyingVideoItem,
} from '../types';
import { normalizeGameProfileId } from './gameProfiles';
import { parseBuyingPlacements } from './buyingPlacements';
import { parseRunDates } from './buyingRunDates';
import { parseBuyingTitleNaming } from './buyingTitleNaming';
import { pb } from './pb';

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function parseEmotionCurve(raw: unknown, totalSeconds: number): BuyingEmotionPoint[] {
  if (!Array.isArray(raw)) return [];
  const curve = raw
    .map((p) => {
      const o = p as Record<string, unknown>;
      return {
        t: Math.max(0, Math.min(totalSeconds, Number(o.t) || 0)),
        intensity: Math.max(0, Math.min(100, Number(o.intensity) || 0)),
        note: typeof o.note === 'string' ? o.note.slice(0, 24) : undefined,
      };
    })
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  return curve;
}

function parseFullAnalysis(v: Record<string, unknown>): BuyingFullAnalysis | null {
  const fa = v.fullAnalysis;
  if (!fa || typeof fa !== 'object') return null;
  const raw = fa as Record<string, unknown>;
  const totalSeconds = Math.max(3, Math.min(180, Number(raw.totalSeconds) || 0));
  if (!totalSeconds) return null;
  let curve = parseEmotionCurve(raw.emotionCurve, totalSeconds);
  if (curve.length < 2) return null;
  const clampSec = (val: unknown) => Math.max(0, Math.min(totalSeconds, Number(val) || 0));
  return {
    totalSeconds,
    emotionCurve: curve,
    peak3sSec: Math.min(3, clampSec(raw.peak3sSec ?? raw.peak3s)),
    peakFullSec: clampSec(raw.peakFullSec ?? raw.peakFull),
    firstSellingPointSec: clampSec(raw.firstSellingPointSec ?? raw.firstSellingPoint),
  };
}

function parseHookAnalysis(raw: unknown): BuyingHookAnalysis | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object') return null;

    const out: BuyingHookAnalysis = {};
    const str = (key: string) => (typeof v[key] === 'string' && v[key] ? String(v[key]) : undefined);

    out.first3sVisual = str('first3sVisual') ?? str('first3sVisualPresentation');
    out.first3sDialogue = str('first3sDialogue');
    const hookTypeRaw = str('first3sHookType') ?? str('hookType');
    if (hookTypeRaw) out.first3sHookType = normalizeBuyingFirst3sHookType(hookTypeRaw);
    out.first3sHookTypeOther = str('first3sHookTypeOther') ?? str('hookTypeOtherNote');
    out.coreGameplaySellingPoints =
      str('coreGameplaySellingPoints') ?? str('gameplaySellingPoints');
    out.coreWelfareSellingPoints =
      str('coreWelfareSellingPoints') ?? str('welfareSellingPoints');
    out.endingGuidance = str('endingGuidance') ?? str('endingCta');
    out.reusableViralPattern =
      str('reusableViralPattern') ?? str('viralPatternAnalysis');

    out.firstFrameVisual = str('firstFrameVisual');
    out.first5sCamera = str('first5sCamera');
    out.first5sAvSync = str('first5sAvSync');
    out.first5sMood = str('first5sMood');
    const conflictRaw = v.conflictOpening ?? v.opensWithConflict;
    if (typeof conflictRaw === 'boolean') {
      out.conflictOpening = conflictRaw;
    } else if (typeof conflictRaw === 'string') {
      const s = conflictRaw.trim().toLowerCase();
      out.conflictOpening = ['true', 'yes', '1', '是', '有', '冲突'].some(
        (x) => s === x || s.includes(x),
      );
    }
    out.conflictOpeningNote = str('conflictOpeningNote') ?? str('conflictOpeningBrief');
    if (!out.conflictOpening) out.conflictOpeningNote = undefined;

    const sum =
      typeof v.firstFiveSecondsSummary === 'string'
        ? v.firstFiveSecondsSummary
        : typeof v.first5sSummary === 'string'
          ? v.first5sSummary
          : undefined;
    if (sum) out.firstFiveSecondsSummary = sum;
    if (!out.first3sVisual) {
      const legacyVisual = [out.firstFrameVisual, out.first5sCamera].filter(Boolean).join('；');
      out.first3sVisual = legacyVisual || sum;
    }
    if (!out.firstFrameVisual && out.first3sVisual) out.firstFrameVisual = out.first3sVisual;

    const fspRaw = v.firstSellingPoint;
    const fsp =
      fspRaw && typeof fspRaw === 'object' ? (fspRaw as Record<string, unknown>) : undefined;
    if (fsp) {
      out.firstSellingPoint = {
        approxTimeSec:
          typeof fsp.approxTimeSec === 'number'
            ? fsp.approxTimeSec
            : Number.isFinite(Number(fsp.approxTimeSec))
              ? Number(fsp.approxTimeSec)
              : undefined,
        method: typeof fsp.method === 'string' ? fsp.method : undefined,
        visualAnalysis: typeof fsp.visualAnalysis === 'string' ? fsp.visualAnalysis : undefined,
      };
    }

    out.fullAnalysis = parseFullAnalysis(v);

    const hasNew =
      out.first3sVisual ||
      out.first3sDialogue ||
      out.first3sHookType ||
      out.coreGameplaySellingPoints ||
      out.coreWelfareSellingPoints ||
      out.endingGuidance ||
      out.reusableViralPattern ||
      out.firstFrameVisual ||
      out.first5sCamera ||
      out.conflictOpening ||
      out.fullAnalysis;
    if (!hasNew && !out.firstFiveSecondsSummary && !out.firstSellingPoint) return null;
    return out;
  } catch {
    return null;
  }
}

function asDashboardMode(v: unknown): BuyingDashboardMode {
  return v === 'ranking' || v === 'hooks' || v === 'trending' || v === 'material_library' ? v : 'ranking';
}

function asRankingSegment(v: unknown): BuyingRankingSegment | '' {
  return v === 'internal_top' || v === 'competitor_top' ? v : '';
}

/** 将「12w」「3.5万」等片段换算为可比较的数值（用于跑量排序） */
function numberWithUnit(numStr: string, unit: string): number {
  const n = parseFloat(numStr.replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  const u = unit.trim().toLowerCase();
  if (u === '万' || u === 'w') return n * 1e4;
  if (u === '亿') return n * 1e8;
  if (u === '千' || u === 'k') return n * 1e3;
  return n;
}

/**
 * 从跑量数据自由文本中提取排序用分值（越大越靠前）。
 * 优先识别「消耗/花费/投放」后的数值；否则取文中可解析的最大数量级。
 */
export function parseRunVolumeSortScore(runVolumeText: string): number {
  const raw = runVolumeText.trim();
  if (!raw) return 0;

  const spendMatch = raw.match(
    /(?:消耗|花费|投放|跑量|spend|cost)[:：\s]*([\d,.]+)\s*([万亿wkWK千%]?)/i,
  );
  if (spendMatch) {
    return numberWithUnit(spendMatch[1], spendMatch[2]);
  }

  let max = 0;
  const re = /([\d,.]+)\s*([万亿wkWK千]?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    max = Math.max(max, numberWithUnit(m[1], m[2]));
  }
  return max;
}

/** 跑量数据从高到低；同分按入库时间新→旧 */
export function sortBuyingVideosByRunVolumeDesc(items: BuyingVideoItem[]): BuyingVideoItem[] {
  return [...items].sort((a, b) => {
    const diff = parseRunVolumeSortScore(b.runVolumeText) - parseRunVolumeSortScore(a.runVolumeText);
    if (diff !== 0) return diff;
    return b.created.localeCompare(a.created);
  });
}

/**
 * 从标题解析「8 位日期后的序号」，如 `织梦森林-20260519-36-微信视频号` → 36。
 * 无匹配时返回 null。
 */
export function parseBuyingTitleSequence(title: string): number | null {
  const seq = parseBuyingTitleNaming(title).sequence;
  if (seq === '—') return null;
  const n = parseInt(seq, 10);
  return Number.isFinite(n) ? n : null;
}

/** 名称中日期后序号从低到高；无序号标题排在末尾，其间按跑量降序 */
export function sortBuyingVideosByTitleSequenceAsc(items: BuyingVideoItem[]): BuyingVideoItem[] {
  return [...items].sort((a, b) => {
    const sa = parseBuyingTitleSequence(a.title);
    const sb = parseBuyingTitleSequence(b.title);
    const hasA = sa !== null;
    const hasB = sb !== null;
    if (hasA && hasB && sa !== sb) return sa - sb;
    if (hasA !== hasB) return hasA ? -1 : 1;
    const volDiff =
      parseRunVolumeSortScore(b.runVolumeText) - parseRunVolumeSortScore(a.runVolumeText);
    if (volDiff !== 0) return volDiff;
    return b.created.localeCompare(a.created);
  });
}

/** PocketBase buying_videos 投放指标（与 Admin 中 *Text 字段名一致） */
function metricStr(r: RecordModel, key: string): string {
  const v = r[key];
  if (v === null || v === undefined || v === '') return '';
  return String(v).trim();
}

function parseAdMetrics(r: RecordModel): BuyingVideoAdMetrics {
  return {
    bidMethod: metricStr(r, 'bidMethodText'),
    roi: metricStr(r, 'roiBidText'),
    miniGameDay1PayRoi: metricStr(r, 'miniGameDay1RoiText'),
    shallowBid: metricStr(r, 'shallowBidText'),
    ctr: metricStr(r, 'ctrText'),
    miniGameRegisterCost: metricStr(r, 'miniGameRegCostText'),
    miniGameDay1PayCost: metricStr(r, 'miniGameDay1PayCostText'),
    day1PayArppu: metricStr(r, 'day1PayArppuText'),
  };
}

export function recordToBuyingVideo(r: RecordModel): BuyingVideoItem {
  const coverFn = typeof r.cover === 'string' ? r.cover : '';
  const previewFn = typeof r.preview === 'string' ? r.preview : '';
  return {
    id: r.id,
    userId: String(r.userId ?? ''),
    gameProfileId: normalizeGameProfileId(r.gameProfileId),
    dashboardMode: asDashboardMode(r.dashboardMode),
    rankingSegment: asRankingSegment(r.rankingSegment),
    title: String(r.title ?? ''),
    sourceType: r.sourceType === 'external' ? 'external' : 'internal',
    sourceLabel: String(r.sourceLabel ?? ''),
    runTimeText: String(r.runTimeText ?? ''),
    runVolumeText: String(r.runVolumeText ?? ''),
    runDates: parseRunDates(r.runDates),
    placements: parseBuyingPlacements(r.placements),
    scriptTags: parseJsonArray(r.scriptTags),
    hookAnalysis: parseHookAnalysis(r.hookAnalysisJson),
    coverUrl: coverFn ? pb.files.getURL(r, coverFn) : '',
    previewUrl: previewFn ? pb.files.getURL(r, previewFn) : '',
    created: String(r.created ?? ''),
    adMetrics: parseAdMetrics(r),
  };
}
