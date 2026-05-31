import { BUYING_HOOK_DISPLAY_FIELDS } from './buyingHookAnalysisDisplay';
import type { BuyingVideoAdMetrics } from '../types';

export const COMPETITOR_TABLE_CHECKBOX_CLASS =
  'h-3.5 w-3.5 shrink-0 rounded border border-slate-200 bg-white accent-accent-blue';

export type CompetitorMetricColumnId = keyof Pick<
  BuyingVideoAdMetrics,
  | 'roi'
  | 'miniGameDay1PayRoi'
  | 'shallowBid'
  | 'ctr'
  | 'miniGameRegisterCost'
  | 'miniGameDay1PayCost'
  | 'day1PayArppu'
>;

export type CompetitorTableColumnId =
  | 'preview'
  | 'title'
  | 'titleCompetitor'
  | 'titleUploadDate'
  | 'titleSequence'
  | 'titlePlacement'
  | 'dates'
  | 'source'
  | 'placements'
  | 'uploadTime'
  | 'scriptTags'
  | `hook:${string}`
  | 'bidMethod'
  | `metric:${CompetitorMetricColumnId}`;

export type CompetitorTableColumnDef = {
  id: CompetitorTableColumnId;
  label: string;
  minWidth: number;
  /** 不可在「自定义列表」中隐藏 */
  locked?: boolean;
};

/** 投放专员表格：视频名称右侧，从命名解析展示 */
export const TITLE_NAMING_TABLE_COLUMNS: CompetitorTableColumnDef[] = [
  { id: 'titleCompetitor', label: '竞品名称', minWidth: 100 },
  { id: 'titleUploadDate', label: '上传日期', minWidth: 96 },
  { id: 'titleSequence', label: '序号', minWidth: 64 },
  { id: 'titlePlacement', label: '版位', minWidth: 120 },
];

const BASE_COLUMNS: CompetitorTableColumnDef[] = [
  { id: 'preview', label: '压缩视频', minWidth: 120, locked: true },
  { id: 'title', label: '视频名称', minWidth: 140 },
  { id: 'dates', label: '日期', minWidth: 130 },
  { id: 'source', label: '上传来源', minWidth: 120 },
  { id: 'placements', label: '版位', minWidth: 160 },
  { id: 'uploadTime', label: '上传时间', minWidth: 130 },
  { id: 'scriptTags', label: '脚本标签', minWidth: 140 },
];

const HOOK_COLUMNS: CompetitorTableColumnDef[] = BUYING_HOOK_DISPLAY_FIELDS.map((f) => ({
  id: `hook:${f.key}` as CompetitorTableColumnId,
  label: f.label,
  minWidth: 160,
}));

const METRIC_COLUMNS: CompetitorTableColumnDef[] = [
  { id: 'bidMethod', label: '出价方式', minWidth: 88 },
  { id: 'metric:roi', label: 'roi', minWidth: 72 },
  { id: 'metric:miniGameDay1PayRoi', label: '小游戏首日付费roi', minWidth: 120 },
  { id: 'metric:shallowBid', label: '浅层出价', minWidth: 88 },
  { id: 'metric:ctr', label: 'ctr', minWidth: 64 },
  { id: 'metric:miniGameRegisterCost', label: '小游戏注册成本', minWidth: 110 },
  { id: 'metric:miniGameDay1PayCost', label: '小游戏首日付费成本', minWidth: 120 },
  { id: 'metric:day1PayArppu', label: '首日付费ARPPU', minWidth: 110 },
];

export const COMPETITOR_TABLE_COLUMNS: CompetitorTableColumnDef[] = [
  ...BASE_COLUMNS,
  ...HOOK_COLUMNS,
  ...METRIC_COLUMNS,
];

export function getCompetitorTableColumns(includeTitleNaming: boolean): CompetitorTableColumnDef[] {
  if (!includeTitleNaming) return COMPETITOR_TABLE_COLUMNS;
  const titleIdx = COMPETITOR_TABLE_COLUMNS.findIndex((c) => c.id === 'title');
  if (titleIdx < 0) return COMPETITOR_TABLE_COLUMNS;
  return [
    ...COMPETITOR_TABLE_COLUMNS.slice(0, titleIdx + 1),
    ...TITLE_NAMING_TABLE_COLUMNS,
    ...COMPETITOR_TABLE_COLUMNS.slice(titleIdx + 1),
  ];
}

export function getCompetitorTableHideableColumns(includeTitleNaming: boolean): CompetitorTableColumnDef[] {
  return getCompetitorTableColumns(includeTitleNaming).filter((c) => !c.locked);
}

export const COMPETITOR_TABLE_HIDEABLE_COLUMNS = COMPETITOR_TABLE_COLUMNS.filter((c) => !c.locked);

export const COMPETITOR_TABLE_HIDDEN_STORAGE_KEY = 'competitor-top-hidden-columns';

export function loadHiddenCompetitorColumns(includeTitleNaming = false): Set<CompetitorTableColumnId> {
  try {
    const raw = sessionStorage.getItem(COMPETITOR_TABLE_HIDDEN_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    const valid = new Set(getCompetitorTableColumns(includeTitleNaming).map((c) => c.id));
    return new Set(
      arr.filter((id): id is CompetitorTableColumnId => typeof id === 'string' && valid.has(id as CompetitorTableColumnId)),
    );
  } catch {
    return new Set();
  }
}

export function saveHiddenCompetitorColumns(hidden: Set<CompetitorTableColumnId>) {
  try {
    sessionStorage.setItem(
      COMPETITOR_TABLE_HIDDEN_STORAGE_KEY,
      JSON.stringify([...hidden]),
    );
  } catch {
    /* ignore */
  }
}

export function isCompetitorColumnVisible(
  id: CompetitorTableColumnId,
  hidden: Set<CompetitorTableColumnId>,
): boolean {
  return !hidden.has(id);
}

export function competitorTableMinWidth(
  hidden: Set<CompetitorTableColumnId>,
  selectColWidth = 44,
  includeTitleNaming = false,
): number {
  const visible = getCompetitorTableColumns(includeTitleNaming).filter((c) =>
    isCompetitorColumnVisible(c.id, hidden),
  );
  return selectColWidth + visible.reduce((sum, c) => sum + c.minWidth, 0);
}

export function parseMetricColumnId(id: CompetitorTableColumnId): CompetitorMetricColumnId | null {
  if (!id.startsWith('metric:')) return null;
  return id.slice(7) as CompetitorMetricColumnId;
}
