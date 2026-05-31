import {
  buildThemeTagCatalogFromScriptTagsList,
  type ThemeTagCatalogEntry,
} from '../src/lib/buyingThemeTagCatalog';
import { BUYING_VIDEOS, getPbAdminToken, PB_URL } from './pbAdminUsage';

function parseScriptTagsField(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x ?? ''));
  } catch {
    return [];
  }
}

/** 拉取同游戏版本下已有 buying_videos 的主题标签频次（供 AI 优先复用） */
export async function fetchThemeTagCatalogForGameProfile(
  gameProfileId: string,
  options?: { perPage?: number },
): Promise<ThemeTagCatalogEntry[]> {
  const token = await getPbAdminToken();
  if (!token) return [];

  const perPage = Math.min(options?.perPage ?? 200, 500);
  const filter = encodeURIComponent(`gameProfileId = ${JSON.stringify(gameProfileId)}`);
  const res = await fetch(
    `${PB_URL}/api/collections/${BUYING_VIDEOS}/records?perPage=${perPage}&page=1&sort=-created&filter=${filter}`,
    { headers: { Authorization: token } },
  );
  if (!res.ok) return [];

  const json = (await res.json()) as { items?: Record<string, unknown>[] };
  const rows = (json.items ?? []).map((rec) => parseScriptTagsField(rec.scriptTags));
  return buildThemeTagCatalogFromScriptTagsList(rows);
}
