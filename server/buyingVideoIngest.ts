/**
 * PocketBase `buying_videos` 入库后由 HTTP 触发：拉取预览视频 → Gemini analyzeBuyingVideo → PATCH 同一条记录。
 * 与前端上传流程共用同一套分析逻辑（runGeminiOp）。
 */
import { runGeminiOp, resolveGameProfileId, type GeminiOpBody } from './geminiBackend';
import { BUYING_VIDEOS, logGeminiCallUsage, pbAdminDownloadFile, pbAdminGetRecord, pbAdminPatchRecord } from './pbAdminUsage';

function hasMeaningfulScriptTags(record: Record<string, unknown>): boolean {
  const raw = record.scriptTags;
  if (typeof raw !== 'string' || !raw.trim()) return false;
  try {
    const arr = JSON.parse(raw) as unknown[];
    if (!Array.isArray(arr) || arr.length < 2) return false;
    const a0 = String(arr[0] ?? '').trim();
    const a1 = String(arr[1] ?? '').trim();
    return a0.length > 0 && a1.length > 0;
  } catch {
    return false;
  }
}

function pickVideoMime(contentType: string, fileName: string): string {
  const ct = contentType.split(';')[0]!.trim().toLowerCase();
  if (ct.startsWith('video/')) return ct;
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  return 'video/mp4';
}

export async function ingestBuyingVideoRecord(
  recordId: string,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const started = Date.now();
  const rec = await pbAdminGetRecord(BUYING_VIDEOS, recordId);
  if (!rec) {
    return { ok: false, error: 'record not found or PocketBase admin 未配置/鉴权失败' };
  }

  if (hasMeaningfulScriptTags(rec)) {
    return { ok: true, skipped: true };
  }

  const preview = typeof rec.preview === 'string' ? rec.preview : '';
  if (!preview) {
    return { ok: false, error: '记录缺少 preview 文件，无法自动分析（请先上传含预览的素材）' };
  }

  const dl = await pbAdminDownloadFile(BUYING_VIDEOS, recordId, preview);
  if (!dl) {
    return { ok: false, error: '下载 preview 失败（检查文件权限与 POCKETBASE_URL）' };
  }

  const mime = pickVideoMime(dl.contentType, preview);
  const dashboardMode = rec.dashboardMode === 'hooks' ? 'hooks' : rec.dashboardMode === 'trending' ? 'trending' : 'ranking';
  const includeHookDeep = dashboardMode === 'hooks';

  const title = typeof rec.title === 'string' ? rec.title : '';
  const base = (title || 'video').replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 80) || 'video';
  const fileNameForAi = `${base}.mp4`;

  const body: GeminiOpBody = {
    op: 'analyzeBuyingVideo',
    videoBase64: dl.buf.toString('base64'),
    mimeType: mime,
    fileName: fileNameForAi,
    includeHookDeepAnalysis: includeHookDeep,
    gameProfileId: resolveGameProfileId(rec),
  };

  let ai: {
    gameName: string;
    videoType: string;
    hook3sTags: string[];
    hooksDeep: unknown;
  };
  try {
    ai = (await runGeminiOp(body)) as typeof ai;
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

  const h0 = ai.hook3sTags?.[0] ?? '钩子1';
  const h1 = ai.hook3sTags?.[1] ?? '钩子2';
  const scriptTags = [String(ai.gameName ?? ''), String(ai.videoType ?? ''), String(h0), String(h1)];

  let hookPayload: Record<string, unknown> = {};
  if (includeHookDeep && ai.hooksDeep && typeof ai.hooksDeep === 'object' && ai.hooksDeep !== null) {
    const hd = ai.hooksDeep as Record<string, unknown>;
    hookPayload = {
      firstFiveSecondsSummary: hd.firstFiveSecondsSummary,
      firstSellingPoint: hd.firstSellingPoint,
    };
  }

  const patch: Record<string, unknown> = {
    scriptTags: JSON.stringify(scriptTags),
    hookAnalysisJson: JSON.stringify(hookPayload),
  };

  const patched = await pbAdminPatchRecord(BUYING_VIDEOS, recordId, patch);
  if (!patched) {
    return { ok: false, error: 'PATCH 记录失败（请检查 buying_videos 写权限与字段 scriptTags / hookAnalysisJson）' };
  }

  return { ok: true };
}