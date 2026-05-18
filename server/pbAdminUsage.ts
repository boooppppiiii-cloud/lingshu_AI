import { formatUsageDayShanghai } from './usageDay';

export const PB_URL = (
  process.env.POCKETBASE_URL ||
  process.env.VITE_POCKETBASE_URL ||
  'http://127.0.0.1:8090'
).replace(/\/$/, '');

const ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL?.trim();
const ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD?.trim();

let cachedToken: string | null = null;

async function getAdminToken(): Promise<string | null> {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return null;
  if (cachedToken) return cachedToken;
  const body = JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  try {
    // PocketBase 0.23+：管理员改为系统集合 `_superusers`
    let res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      // PocketBase 0.22 及更早：旧 `/api/admins/auth-with-password`
      res = await fetch(`${PB_URL}/api/admins/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.warn('[usage_events admin] auth failed', res.status, t.slice(0, 120));
      return null;
    }
    const json = (await res.json()) as { token?: string };
    if (!json.token) return null;
    cachedToken = json.token;
    return cachedToken;
  } catch (e) {
    console.warn('[usage_events admin]', e);
    return null;
  }
}

/** 用当前登录用户的 PocketBase token 换 user id（auth-refresh） */
export async function getAuthenticatedUserIdFromPocketBase(
  authHeader: string | undefined,
): Promise<string | null> {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const res = await fetch(`${PB_URL}/api/collections/users/auth-refresh`, {
      method: 'POST',
      headers: { Authorization: token },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { record?: { id?: string } };
    return json.record?.id ?? null;
  } catch {
    return null;
  }
}

export async function adminCreateUsageRecord(record: Record<string, unknown>): Promise<boolean> {
  const token = await getAdminToken();
  if (!token) return false;
  try {
    const res = await fetch(`${PB_URL}/api/collections/usage_events/records`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      body: JSON.stringify(record),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.warn('[usage_events admin] create failed', res.status, t.slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[usage_events admin] create', e);
    return false;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/** 服务端写入 gemini.call 流水（不阻塞、失败仅 warn） */
export async function logGeminiCallUsage(input: {
  op: string;
  ok: boolean;
  durationMs: number;
  userId?: string;
  errorMessage?: string;
}): Promise<void> {
  const meta: Record<string, unknown> = {
    op: input.op,
    ok: input.ok,
    duration_ms: input.durationMs,
  };
  if (input.errorMessage) meta.error = truncate(input.errorMessage, 240);

  const body: Record<string, unknown> = {
    day: formatUsageDayShanghai(),
    event: 'gemini.call',
    source: 'express',
    meta,
  };
  if (input.userId) body.user = input.userId;

  void adminCreateUsageRecord(body);
}

export const BUYING_VIDEOS = 'buying_videos';

/** Admin GET /api/collections/:name/records/:id */
export async function pbAdminGetRecord(
  collectionName: string,
  recordId: string,
): Promise<Record<string, unknown> | null> {
  const token = await getAdminToken();
  if (!token) return null;
  try {
    const res = await fetch(
      `${PB_URL}/api/collections/${encodeURIComponent(collectionName)}/records/${encodeURIComponent(recordId)}`,
      { headers: { Authorization: token } },
    );
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Admin PATCH /api/collections/:name/records/:id */
export async function pbAdminPatchRecord(
  collectionName: string,
  recordId: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const token = await getAdminToken();
  if (!token) return false;
  try {
    const res = await fetch(
      `${PB_URL}/api/collections/${encodeURIComponent(collectionName)}/records/${encodeURIComponent(recordId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** 下载集合内文件（需 Admin token；与前端 pb.files.getURL 路径规则一致） */
export async function pbAdminDownloadFile(
  collectionName: string,
  recordId: string,
  fileName: string,
): Promise<{ buf: Buffer; contentType: string } | null> {
  const token = await getAdminToken();
  if (!token) return null;
  const url = `${PB_URL}/api/files/${encodeURIComponent(collectionName)}/${encodeURIComponent(recordId)}/${encodeURIComponent(fileName)}`;
  try {
    const res = await fetch(url, { headers: { Authorization: token } });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const ct = res.headers.get('content-type') || 'application/octet-stream';
    return { buf: Buffer.from(ab), contentType: ct };
  } catch {
    return null;
  }
}

