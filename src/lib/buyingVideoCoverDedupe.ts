import type { BuyingVideoItem } from '../types';

export async function sha256HexFromBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 按封面内容哈希去重，保留列表中靠前的一条（调用方应先按展示排序） */
export function dedupeBuyingVideosByCoverHash(
  items: BuyingVideoItem[],
  hashById: Readonly<Record<string, string>>,
): { items: BuyingVideoItem[]; hiddenCount: number } {
  const seen = new Set<string>();
  const out: BuyingVideoItem[] = [];

  for (const item of items) {
    const coverUrl = item.coverUrl.trim();
    if (!coverUrl) {
      out.push(item);
      continue;
    }

    const hash = hashById[item.id];
    if (!hash) {
      out.push(item);
      continue;
    }

    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push(item);
  }

  return { items: out, hiddenCount: items.length - out.length };
}

const HASH_CACHE_PREFIX = 'buying-cover-hash:';

function hashCacheKey(item: BuyingVideoItem): string {
  return `${HASH_CACHE_PREFIX}${item.id}:${item.coverUrl}`;
}

export function readCachedCoverHash(item: BuyingVideoItem): string | null {
  try {
    return sessionStorage.getItem(hashCacheKey(item));
  } catch {
    return null;
  }
}

export function writeCachedCoverHash(item: BuyingVideoItem, hash: string): void {
  try {
    sessionStorage.setItem(hashCacheKey(item), hash);
  } catch {
    /* ignore */
  }
}

/** 并发拉取封面并计算 SHA-256（用于识别像素级相同封面） */
export async function buildCoverHashMap(
  items: BuyingVideoItem[],
  options?: { signal?: AbortSignal; concurrency?: number },
): Promise<Record<string, string>> {
  const concurrency = options?.concurrency ?? 6;
  const result: Record<string, string> = {};
  const queue = items.filter((i) => i.coverUrl.trim());

  let index = 0;
  async function worker() {
    while (index < queue.length) {
      if (options?.signal?.aborted) return;
      const item = queue[index++]!;
      const cached = readCachedCoverHash(item);
      if (cached) {
        result[item.id] = cached;
        continue;
      }
      try {
        const res = await fetch(item.coverUrl, { credentials: 'include', signal: options?.signal });
        if (!res.ok) continue;
        const hash = await sha256HexFromBlob(await res.blob());
        result[item.id] = hash;
        writeCachedCoverHash(item, hash);
      } catch {
        /* 单条失败则不去重该条，展示时仍保留 */
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
  return result;
}
