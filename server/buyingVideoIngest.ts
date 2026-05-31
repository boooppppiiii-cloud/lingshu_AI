/**
 * PocketBase `buying_videos` 入库后由 HTTP 触发：拉取预览视频 → Gemini analyzeBuyingVideo → PATCH 同一条记录。
 */
import { resolveGameProfileId, type GeminiOpBody } from './geminiBackend';
import { runGeminiOpWithRetry } from './geminiRetry';
import { needsBuyingVideoAiBackfill } from './buyingVideoAnalysis';
import { fetchThemeTagCatalogForGameProfile } from './buyingThemeTagCatalogServer';
import { BUYING_VIDEOS, logGeminiCallUsage, pbAdminDownloadFile, pbAdminGetRecord, pbAdminPatchRecord } from './pbAdminUsage';

function pickVideoMime(contentType: string, fileName: string): string {
  const ct = contentType.split(';')[0]!.trim().toLowerCase();
  if (ct.startsWith('video/')) return ct;
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  return 'video/mp4';
}

export type IngestBuyingVideoOptions = {
  /** true：即使已有 scriptTags / hookAnalysis 也重新分析并覆盖 */
  force?: boolean;
};

export async function ingestBuyingVideoRecord(
  recordId: string,
  options?: IngestBuyingVideoOptions,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const started = Date.now();
  const rec = await pbAdminGetRecord(BUYING_VIDEOS, recordId);
  if (!rec) {
    return { ok: false, error: 'record not found or PocketBase admin 未配置/鉴权失败' };
  }

  if (!options?.force && !needsBuyingVideoAiBackfill(rec)) {
    return { ok: true, skipped: true };
  }

  const preview = typeof rec.preview === 'string' ? rec.preview : '';
  if (!preview) {
    return { ok: false, error: '记录缺少 preview 文件，无法自动分析' };
  }

  const dl = await pbAdminDownloadFile(BUYING_VIDEOS, recordId, preview);
  if (!dl) {
    return { ok: false, error: '下载 preview 失败' };
  }

  const mime = pickVideoMime(dl.contentType, preview);
  const title = typeof rec.title === 'string' ? rec.title : '';
  const base = (title || 'video').replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 80) || 'video';
  const fileNameForAi = `${base}.mp4`;

  const gameProfileId = resolveGameProfileId(rec);
  const existingThemeTags = await fetchThemeTagCatalogForGameProfile(gameProfileId);

  const body: GeminiOpBody = {
    op: 'analyzeBuyingVideo',
    videoBase64: dl.buf.toString('base64'),
    mimeType: mime,
    fileName: fileNameForAi,
    gameProfileId,
    existingThemeTags,
  };

  let ai: { scriptTags: [string, string, string]; hookAnalysis: Record<string, string> };
  try {
    ai = (await runGeminiOpWithRetry(body)) as typeof ai;
    void logGeminiCallUsage({
      op: 'analyzeBuyingVideo',
      ok: true,
      durationMs: Date.now() - started,
      userId: typeof rec.userId === 'string' ? rec.userId : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void logGeminiCallUsage({
      op: 'analyzeBuyingVideo',
      ok: false,
      durationMs: Date.now() - started,
      userId: typeof rec.userId === 'string' ? rec.userId : undefined,
      errorMessage: msg,
    });
    return { ok: false, error: msg };
  }

  const patched = await pbAdminPatchRecord(BUYING_VIDEOS, recordId, {
    scriptTags: JSON.stringify(ai.scriptTags),
    hookAnalysisJson: JSON.stringify(ai.hookAnalysis ?? {}),
  });
  if (!patched) {
    return { ok: false, error: 'PATCH 失败，请检查 POCKETBASE_ADMIN 凭据' };
  }

  return { ok: true };
}
