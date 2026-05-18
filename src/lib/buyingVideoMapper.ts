import type { RecordModel } from 'pocketbase';
import type {
  BuyingDashboardMode,
  BuyingHookAnalysis,
  BuyingRankingSegment,
  BuyingTrendingPlacement,
  BuyingVideoItem,
} from '../types';
import { normalizeGameProfileId } from './gameProfiles';
import { pb } from './pb';

const PLACEMENT_SET = new Set<BuyingTrendingPlacement>([
  'douyin_portrait_916',
  'tencent_landscape_169',
  'tencent_portrait_916',
]);

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function parsePlacements(raw: unknown): BuyingTrendingPlacement[] {
  const arr = parseJsonArray(raw);
  return arr.filter((x): x is BuyingTrendingPlacement => PLACEMENT_SET.has(x as BuyingTrendingPlacement));
}

function parseHookAnalysis(raw: unknown): BuyingHookAnalysis | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object') return null;
    const sum =
      typeof v.firstFiveSecondsSummary === 'string'
        ? v.firstFiveSecondsSummary
        : typeof v.first5sSummary === 'string'
          ? v.first5sSummary
          : undefined;
    const fspRaw = v.firstSellingPoint;
    const fsp =
      fspRaw && typeof fspRaw === 'object' ? (fspRaw as Record<string, unknown>) : undefined;
    const out: BuyingHookAnalysis = {};
    if (sum) out.firstFiveSecondsSummary = sum;
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
    if (!out.firstFiveSecondsSummary && !out.firstSellingPoint) return null;
    return out;
  } catch {
    return null;
  }
}

function asDashboardMode(v: unknown): BuyingDashboardMode {
  return v === 'ranking' || v === 'hooks' || v === 'trending' ? v : 'ranking';
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
    placements: parsePlacements(r.placements),
    scriptTags: parseJsonArray(r.scriptTags),
    hookAnalysis: parseHookAnalysis(r.hookAnalysisJson),
    coverUrl: coverFn ? pb.files.getURL(r, coverFn) : '',
    previewUrl: previewFn ? pb.files.getURL(r, previewFn) : '',
    created: String(r.created ?? ''),
  };
}
