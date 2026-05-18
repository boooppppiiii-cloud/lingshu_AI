import { pb } from './pb';
import { formatUsageDayShanghai } from './usageDay';

/**
 * 写入 `usage_events` 日流水（需登录；失败仅 console.warn，不影响主流程）。
 *
 * PocketBase：只需一个**顶层**集合 `usage_events`（不要嵌在 assets / market 里）。
 * 建议字段：day, event, user, source?, ref_collection?, ref_id?, meta?（JSON）
 * meta 内可含 `operator_display_name`（账号展示昵称，便于后台识别操作人，与 `user` id 对应）。
 */
export async function logUsageEvent(
  userId: string,
  event: string,
  opts?: {
    source?: string;
    refCollection?: string;
    refId?: string;
    /** 写入 meta.operator_display_name，列表/后台可直接读昵称而无需再查 users */
    operatorDisplayName?: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  if (!userId) return;
  const day = formatUsageDayShanghai();
  const body: Record<string, unknown> = {
    day,
    event,
    user: userId,
  };
  if (opts?.source) body.source = opts.source;
  if (opts?.refCollection) body.ref_collection = opts.refCollection;
  if (opts?.refId) body.ref_id = opts.refId;
  const meta: Record<string, unknown> = opts?.meta ? { ...opts.meta } : {};
  const nick = opts?.operatorDisplayName?.trim();
  if (nick) meta.operator_display_name = nick;
  if (Object.keys(meta).length > 0) body.meta = meta;
  try {
    await pb.collection('usage_events').create(body);
  } catch (e) {
    console.warn('[usage_events]', e);
  }
}
