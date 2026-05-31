/**
 * 强制重跑库内全部 buying_videos 的 Gemini 分析（覆盖 scriptTags / hookAnalysisJson）。
 *
 *   npm run reanalyze:buying-videos          # 启动
 *   npm run reanalyze:status                 # 查看进度
 *   tail -f /tmp/reanalyze-buying-videos.log # 实时日志
 *
 * 可选环境变量：
 *   REANALYZE_PER_PAGE=50   每页条数
 *   REANALYZE_START_PAGE=1  起始页
 *   REANALYZE_PROGRESS_FILE=/tmp/reanalyze-buying-videos.progress.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { backfillBuyingVideoTags } from '../backfillBuyingVideos';
import { setupOutboundProxy } from '../outboundProxy';
import {
  DEFAULT_REANALYZE_PROGRESS_FILE,
  initReanalyzeProgress,
  writeReanalyzeProgress,
} from '../reanalyzeProgress';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '../..');
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '.env.local'), override: true });

function mergePocketBaseAdminFromDisk(baseDir: string) {
  const files = [path.join(baseDir, '.env'), path.join(baseDir, '.env.local')];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key !== 'POCKETBASE_ADMIN_EMAIL' && key !== 'POCKETBASE_ADMIN_PASSWORD') continue;
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (val) process.env[key] = val;
    }
  }
}
mergePocketBaseAdminFromDisk(root);
setupOutboundProxy();

const perPage = Math.min(Math.max(Number(process.env.REANALYZE_PER_PAGE) || 50, 1), 200);
let page = Math.max(1, Number(process.env.REANALYZE_START_PAGE) || 1);
const progressFile =
  process.env.REANALYZE_PROGRESS_FILE?.trim() || DEFAULT_REANALYZE_PROGRESS_FILE;

async function main() {
  let totalIngested = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalCompleted = 0;
  const allErrors: string[] = [];
  let totalItems = 0;
  let totalPages = 1;

  console.log(`[reanalyze] 开始全库强制重分析 perPage=${perPage} startPage=${page}`);
  console.log(`[reanalyze] 进度文件: ${progressFile}`);
  console.log(`[reanalyze] 查看进度: npm run reanalyze:status`);

  initReanalyzeProgress(0, 1, progressFile);

  for (;;) {
    const out = await backfillBuyingVideoTags({
      force: true,
      page,
      perPage,
      limit: perPage,
      progressFile,
      runningTotals: {
        ingested: totalIngested,
        failed: totalFailed,
        skipped: totalSkipped,
        completed: totalCompleted,
      },
    });

    if (out.totalItems > 0 && totalItems === 0) {
      totalItems = out.totalItems;
      totalPages = out.totalPages;
      console.log(`[reanalyze] 共 ${totalItems} 条，${totalPages} 页`);
    }

    totalIngested += out.ingested;
    totalSkipped += out.skipped;
    totalFailed += out.failed;
    totalCompleted += out.ingested + out.skipped + out.failed;
    allErrors.push(...out.errors);

    console.log(
      `[reanalyze] page ${out.page}/${out.totalPages} scanned=${out.scanned} ingested=${out.ingested} skipped=${out.skipped} failed=${out.failed} 累计 ${totalCompleted}/${totalItems}`,
    );
    if (out.errors.length) {
      for (const e of out.errors.slice(0, 5)) console.warn(`  - ${e}`);
      if (out.errors.length > 5) console.warn(`  - ... +${out.errors.length - 5} more`);
    }

    writeReanalyzeProgress(
      {
        status: 'running',
        totalItems: totalItems || out.totalItems,
        totalPages: totalPages || out.totalPages,
        currentPage: out.page,
        ingested: totalIngested,
        failed: totalFailed,
        skipped: totalSkipped,
        completed: totalCompleted,
        phase: 'page',
        lastMessage: `第 ${out.page}/${out.totalPages} 页完成，累计 ${totalCompleted}/${totalItems || out.totalItems}`,
      },
      progressFile,
    );

    if (!out.hasMore || !out.nextPage) break;
    page = out.nextPage;
  }

  const finalMsg = `全库完成：成功 ${totalIngested}，失败 ${totalFailed}，跳过 ${totalSkipped}`;
  writeReanalyzeProgress(
    {
      status: 'done',
      totalItems,
      totalPages,
      completed: totalCompleted,
      ingested: totalIngested,
      failed: totalFailed,
      skipped: totalSkipped,
      currentRecordId: null,
      currentTitle: null,
      phase: 'idle',
      lastMessage: finalMsg,
      percent: 100,
    },
    progressFile,
  );
  console.log(`[reanalyze] ${finalMsg}`);
  if (totalFailed > 0) process.exitCode = 1;
}

main().catch((e) => {
  writeReanalyzeProgress(
    {
      status: 'error',
      phase: 'idle',
      currentRecordId: null,
      currentTitle: null,
      lastMessage: e instanceof Error ? e.message : String(e),
    },
    progressFile,
  );
  console.error('[reanalyze] fatal', e);
  process.exitCode = 1;
});
