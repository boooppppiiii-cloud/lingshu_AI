import fs from 'node:fs';

export const DEFAULT_REANALYZE_PROGRESS_FILE = '/tmp/reanalyze-buying-videos.progress.json';

export type ReanalyzeProgressStatus = 'running' | 'done' | 'error';

export type ReanalyzeProgressPhase = 'idle' | 'gemini' | 'wait' | 'page';

export type ReanalyzeProgressState = {
  status: ReanalyzeProgressStatus;
  startedAt: string;
  updatedAt: string;
  totalItems: number;
  totalPages: number;
  currentPage: number;
  /** 已处理（成功 + 失败 + 本批跳过）累计 */
  completed: number;
  ingested: number;
  failed: number;
  skipped: number;
  currentRecordId: string | null;
  currentTitle: string | null;
  phase: ReanalyzeProgressPhase;
  lastMessage: string;
  percent: number;
};

export function readReanalyzeProgress(
  file = DEFAULT_REANALYZE_PROGRESS_FILE,
): ReanalyzeProgressState | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as ReanalyzeProgressState;
  } catch {
    return null;
  }
}

export function writeReanalyzeProgress(
  patch: Partial<ReanalyzeProgressState> & Pick<ReanalyzeProgressState, 'lastMessage'>,
  file = DEFAULT_REANALYZE_PROGRESS_FILE,
): ReanalyzeProgressState {
  const prev = readReanalyzeProgress(file);
  const now = new Date().toISOString();
  const totalItems = patch.totalItems ?? prev?.totalItems ?? 0;
  const completed = patch.completed ?? prev?.completed ?? 0;
  const percent =
    patch.percent ??
    (totalItems > 0 ? Math.min(100, Math.round((completed / totalItems) * 100)) : 0);

  const next: ReanalyzeProgressState = {
    status: patch.status ?? prev?.status ?? 'running',
    startedAt: patch.startedAt ?? prev?.startedAt ?? now,
    updatedAt: now,
    totalItems,
    totalPages: patch.totalPages ?? prev?.totalPages ?? 1,
    currentPage: patch.currentPage ?? prev?.currentPage ?? 1,
    completed,
    ingested: patch.ingested ?? prev?.ingested ?? 0,
    failed: patch.failed ?? prev?.failed ?? 0,
    skipped: patch.skipped ?? prev?.skipped ?? 0,
    currentRecordId:
      patch.currentRecordId !== undefined ? patch.currentRecordId : (prev?.currentRecordId ?? null),
    currentTitle:
      patch.currentTitle !== undefined ? patch.currentTitle : (prev?.currentTitle ?? null),
    phase: patch.phase ?? prev?.phase ?? 'idle',
    lastMessage: patch.lastMessage,
    percent,
  };

  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function initReanalyzeProgress(
  totalItems: number,
  totalPages: number,
  file = DEFAULT_REANALYZE_PROGRESS_FILE,
): ReanalyzeProgressState {
  const now = new Date().toISOString();
  return writeReanalyzeProgress(
    {
      status: 'running',
      startedAt: now,
      totalItems,
      totalPages,
      currentPage: 1,
      completed: 0,
      ingested: 0,
      failed: 0,
      skipped: 0,
      currentRecordId: null,
      currentTitle: null,
      phase: 'idle',
      lastMessage: `全库重分析开始，共 ${totalItems} 条`,
      percent: 0,
    },
    file,
  );
}
