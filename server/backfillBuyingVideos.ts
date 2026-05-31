import { ingestBuyingVideoRecord } from './buyingVideoIngest';
import { needsBuyingVideoAiBackfill } from './buyingVideoAnalysis';
import { BUYING_VIDEOS, PB_URL, getPbAdminTokenResult } from './pbAdminUsage';
import { writeReanalyzeProgress, type ReanalyzeProgressState } from './reanalyzeProgress';

export type BackfillBuyingVideosOptions = {
  /** 本批最多处理条数（force 时默认等于 perPage，上限 500） */
  limit?: number;
  /** true：忽略已有标签，全部重新走 Gemini */
  force?: boolean;
  /** PocketBase 列表页码，从 1 开始 */
  page?: number;
  /** 每页拉取条数，默认 50 */
  perPage?: number;
  /** 写入进度 JSON 并打印每条日志（全库重分析脚本用） */
  progressFile?: string;
  /** 全库累计（跨页） */
  runningTotals?: Pick<ReanalyzeProgressState, 'ingested' | 'failed' | 'skipped' | 'completed'>;
};

export type BackfillBuyingVideosResult = {
  scanned: number;
  ingested: number;
  skipped: number;
  failed: number;
  errors: string[];
  page: number;
  totalPages: number;
  totalItems: number;
  hasMore: boolean;
  nextPage: number | null;
};

/** 补全或强制重跑 buying_videos 的 scriptTags / hookAnalysisJson（每条调 Gemini，较慢） */
export async function backfillBuyingVideoTags(
  options: BackfillBuyingVideosOptions = {},
): Promise<BackfillBuyingVideosResult> {
  const force = options.force === true;
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(Math.max(options.perPage ?? 50, 1), 200);
  const cap = force
    ? Math.max(1, Math.min(options.limit ?? perPage, 500))
    : Math.max(1, Math.min(options.limit ?? 5, 30));

  const empty: BackfillBuyingVideosResult = {
    scanned: 0,
    ingested: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    page,
    totalPages: 0,
    totalItems: 0,
    hasMore: false,
    nextPage: null,
  };

  const auth = await getPbAdminTokenResult();
  if (!auth.ok) {
    const msg =
      auth.reason === 'missing_creds'
        ? 'POCKETBASE_ADMIN_EMAIL/PASSWORD 未配置（检查项目根 .env）'
        : 'PocketBase 超级用户登录失败：请核对 .env 里的邮箱与密码（须为 Admin → Superusers，不是 GitHub/普通用户密码）';
    return { ...empty, errors: [msg] };
  }
  const token = auth.token;

  const res = await fetch(
    `${PB_URL}/api/collections/${BUYING_VIDEOS}/records?perPage=${perPage}&page=${page}&sort=-created`,
    { headers: { Authorization: token } },
  );
  if (!res.ok) {
    return { ...empty, errors: [`list failed HTTP ${res.status}`] };
  }

  const json = (await res.json()) as {
    items?: Record<string, unknown>[];
    totalPages?: number;
    totalItems?: number;
  };
  const items = json.items ?? [];
  const totalPages = json.totalPages ?? 1;
  const totalItems = json.totalItems ?? items.length;

  let ingested = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;
  const errors: string[] = [];
  const progressFile = options.progressFile;
  const baseTotals = options.runningTotals ?? { ingested: 0, failed: 0, skipped: 0, completed: 0 };

  const syncProgress = (
    patch: Partial<ReanalyzeProgressState> & { lastMessage: string },
  ) => {
    if (!progressFile) return;
    writeReanalyzeProgress(
      {
        totalItems,
        totalPages,
        currentPage: page,
        ingested: baseTotals.ingested + ingested,
        failed: baseTotals.failed + failed,
        skipped: baseTotals.skipped + skipped,
        completed: baseTotals.completed + ingested + failed + skipped,
        ...patch,
      },
      progressFile,
    );
  };

  if (progressFile) {
    syncProgress({
      phase: 'page',
      lastMessage: `第 ${page}/${totalPages} 页，本页 ${items.length} 条`,
    });
  }

  for (const rec of items) {
    if (processed >= cap) break;
    const id = typeof rec.id === 'string' ? rec.id : '';
    if (!id) continue;
    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    const done = baseTotals.completed + ingested + failed + skipped;

    if (!force && !needsBuyingVideoAiBackfill(rec)) {
      skipped++;
      if (progressFile) {
        const msg = `[${done + 1}/${totalItems}] 跳过 ${id.slice(0, 8)}… 已有标签`;
        console.log(`[reanalyze] ${msg}`);
        syncProgress({
          phase: 'idle',
          currentRecordId: id,
          currentTitle: title || null,
          lastMessage: msg,
        });
      }
      continue;
    }

    const preview = typeof rec.preview === 'string' ? rec.preview : '';
    if (!preview) {
      failed++;
      errors.push(`${id}: 无 preview`);
      processed++;
      if (progressFile) {
        const msg = `[${done + 1}/${totalItems}] 失败 ${id.slice(0, 8)}… 无 preview`;
        console.warn(`[reanalyze] ${msg}`);
        syncProgress({
          phase: 'idle',
          currentRecordId: id,
          currentTitle: title || null,
          lastMessage: msg,
        });
      }
      continue;
    }

    processed++;
    if (progressFile) {
      const msg = `[${done + 1}/${totalItems}] 分析中 ${title || id.slice(0, 8)}…`;
      console.log(`[reanalyze] ${msg}`);
      syncProgress({
        phase: 'gemini',
        currentRecordId: id,
        currentTitle: title || null,
        lastMessage: msg,
      });
    }

    const out = await ingestBuyingVideoRecord(id, { force });
    if (out.ok && !out.skipped) ingested++;
    else if (out.skipped) skipped++;
    else {
      failed++;
      errors.push(`${id}: ${out.error ?? 'ingest failed'}`);
    }

    if (progressFile) {
      const after = baseTotals.completed + ingested + failed + skipped;
      const ok = out.ok && !out.skipped;
      const msg = ok
        ? `[${after}/${totalItems}] 完成 ${title || id.slice(0, 8)}…`
        : out.skipped
          ? `[${after}/${totalItems}] 跳过 ${id.slice(0, 8)}…`
          : `[${after}/${totalItems}] 失败 ${title || id.slice(0, 8)}… ${out.error ?? ''}`;
      console.log(`[reanalyze] ${msg}`);
      syncProgress({
        phase: 'wait',
        currentRecordId: null,
        currentTitle: null,
        lastMessage: msg,
      });
    }

    await new Promise((r) => setTimeout(r, out.ok && !out.skipped ? 2500 : 4000));
  }

  const hasMore = page < totalPages;

  return {
    scanned: items.length,
    ingested,
    skipped,
    failed,
    errors,
    page,
    totalPages,
    totalItems,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
  };
}

/** @deprecated 请用 backfillBuyingVideoTags；保留兼容旧 curl */
export async function backfillEmptyBuyingVideoTags(
  limit = 5,
): Promise<Omit<BackfillBuyingVideosResult, 'page' | 'totalPages' | 'totalItems' | 'hasMore' | 'nextPage'>> {
  const out = await backfillBuyingVideoTags({ limit, force: false });
  return {
    scanned: out.scanned,
    ingested: out.ingested,
    skipped: out.skipped,
    failed: out.failed,
    errors: out.errors,
  };
}
