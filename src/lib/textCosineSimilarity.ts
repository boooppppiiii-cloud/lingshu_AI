/** 字符 n-gram 向量 + 余弦相似度（用于中文短文本聚类，无需外部 embedding 服务） */

export function normalizeTextForSimilarity(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：「」『』（）【】《》"'…—\-·,.!?;:'"()[\]{}]/g, '');
}

export function textToNgramVector(text: string): Map<string, number> {
  const normalized = normalizeTextForSimilarity(text);
  const grams = new Map<string, number>();
  if (!normalized) return grams;

  for (let i = 0; i < normalized.length; i++) {
    const uni = normalized[i]!;
    grams.set(uni, (grams.get(uni) ?? 0) + 1);
    if (i < normalized.length - 1) {
      const bi = normalized.slice(i, i + 2);
      grams.set(bi, (grams.get(bi) ?? 0) + 1);
    }
  }

  let norm = 0;
  for (const v of grams.values()) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (const [k, v] of grams) {
    grams.set(k, v / norm);
  }
  return grams;
}

export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [k, v] of small) {
    const w = large.get(k);
    if (w !== undefined) dot += v * w;
  }
  return Math.max(0, Math.min(1, dot));
}

export function averageVectors(vectors: Map<string, number>[]): Map<string, number> {
  const sum = new Map<string, number>();
  if (vectors.length === 0) return sum;
  for (const v of vectors) {
    for (const [k, val] of v) {
      sum.set(k, (sum.get(k) ?? 0) + val);
    }
  }
  let norm = 0;
  for (const v of sum.values()) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (const [k, v] of sum) {
    sum.set(k, v / norm);
  }
  return sum;
}

export type TextClusterInput = { itemId: string; text: string };

export type TextClusterMember = {
  itemId: string;
  text: string;
  similarity: number;
};

export type TextCluster = {
  clusterId: string;
  label: string;
  members: TextClusterMember[];
  /** 是否为未归并的零散素材汇总桶 */
  isMiscBucket?: boolean;
};

type PendingRow = TextClusterInput & { vector: Map<string, number> };

function uniqueVideoCount(members: TextClusterMember[]): number {
  return new Set(members.map((m) => m.itemId)).size;
}

function buildClusterFromIndices(
  pending: PendingRow[],
  memberIndices: number[],
  clusterId: string,
  label: string,
): TextCluster {
  const vectors = memberIndices.map((i) => pending[i]!.vector);
  const centroid = averageVectors(vectors);
  const members: TextClusterMember[] = memberIndices.map((i) => {
    const row = pending[i]!;
    return {
      itemId: row.itemId,
      text: row.text,
      similarity: cosineSimilarity(row.vector, centroid),
    };
  });
  members.sort((a, b) => b.similarity - a.similarity);
  return { clusterId, label, members };
}

function greedyCluster(pending: PendingRow[], threshold: number, maxClusters: number): TextCluster[] {
  const assigned = new Set<number>();
  const clusters: TextCluster[] = [];
  const sortedIndices = pending
    .map((_, i) => i)
    .sort((a, b) => pending[b]!.text.length - pending[a]!.text.length);

  for (const seedIdx of sortedIndices) {
    if (assigned.has(seedIdx)) continue;
    if (clusters.length >= maxClusters) break;

    const seed = pending[seedIdx]!;
    const memberIndices = [seedIdx];
    assigned.add(seedIdx);

    for (let j = 0; j < pending.length; j++) {
      if (assigned.has(j)) continue;
      if (cosineSimilarity(seed.vector, pending[j]!.vector) >= threshold) {
        memberIndices.push(j);
        assigned.add(j);
      }
    }

    clusters.push(
      buildClusterFromIndices(
        pending,
        memberIndices,
        `c-${clusters.length}-${normalizeTextForSimilarity(seed.text).slice(0, 24)}`,
        seed.text,
      ),
    );
  }

  return clusters;
}

function clusterByExactText(inputs: TextClusterInput[]): TextCluster[] {
  const buckets = new Map<string, TextClusterInput[]>();
  for (const row of inputs) {
    const key = normalizeTextForSimilarity(row.text);
    if (!key) continue;
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }

  return [...buckets.entries()]
    .map(([key, rows], i) => {
      const pending: PendingRow[] = rows.map((r) => ({
        ...r,
        vector: textToNgramVector(r.text),
      }));
      const indices = pending.map((_, idx) => idx);
      return buildClusterFromIndices(pending, indices, `exact-${i}-${key.slice(0, 16)}`, rows[0]!.text);
    })
    .sort((a, b) => uniqueVideoCount(b.members) - uniqueVideoCount(a.members));
}

function findBestClusterForVector(
  clusters: TextCluster[],
  vector: Map<string, number>,
  minSim: number,
): { index: number; sim: number } | null {
  let best: { index: number; sim: number } | null = null;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]!;
    if (uniqueVideoCount(c.members) < 1) continue;
    const centroid = averageVectors(
      c.members.map((m) => textToNgramVector(m.text)),
    );
    const sim = cosineSimilarity(vector, centroid);
    if (sim >= minSim && (!best || sim > best.sim)) {
      best = { index: i, sim };
    }
  }
  return best;
}

function mergeClusterMembers(target: TextCluster, incoming: TextClusterMember[]): void {
  target.members.push(...incoming);
  const vectors = target.members.map((m) => textToNgramVector(m.text));
  const centroid = averageVectors(vectors);
  for (const m of target.members) {
    m.similarity = cosineSimilarity(textToNgramVector(m.text), centroid);
  }
  target.members.sort((a, b) => b.similarity - a.similarity);
}

export type ClusterTextsOptions = {
  threshold?: number;
  maxClusters?: number;
  /** 单条簇尝试并入最近共性簇的最低相似度 */
  orphanMergeThreshold?: number;
  /** 仍未归并的单条是否收入「零散」汇总桶 */
  bundleRemainingSingletons?: boolean;
  miscLabel?: string;
  /** 仅按归一化文本完全一致分组（钩子类型等） */
  categoricalExact?: boolean;
  /** 若单条簇占比过高，自动降低阈值重聚类（最多迭代次数） */
  adaptivePasses?: number;
};

export function clusterTextsByCosineSimilarity(
  inputs: TextClusterInput[],
  options?: ClusterTextsOptions,
): TextCluster[] {
  const filtered = inputs.filter((x) => normalizeTextForSimilarity(x.text).length > 0);
  if (filtered.length === 0) return [];

  if (options?.categoricalExact) {
    return clusterByExactText(filtered);
  }

  const maxClusters = options?.maxClusters ?? 40;
  const orphanMergeThreshold = options?.orphanMergeThreshold ?? 0.48;
  const bundleRemaining = options?.bundleRemainingSingletons !== false;
  const miscLabel = options?.miscLabel ?? '其他零散（暂未形成共性簇）';
  const adaptivePasses = options?.adaptivePasses ?? 2;

  const pending: PendingRow[] = filtered.map((x) => ({
    ...x,
    vector: textToNgramVector(x.text),
  }));

  let threshold = options?.threshold ?? 0.58;
  let clusters: TextCluster[] = [];

  for (let pass = 0; pass <= adaptivePasses; pass++) {
    clusters = greedyCluster(pending, threshold, maxClusters);

    const multi: TextCluster[] = [];
    const orphans: TextCluster[] = [];

    for (const c of clusters) {
      if (uniqueVideoCount(c.members) >= 2) multi.push(c);
      else orphans.push(c);
    }

    for (const single of orphans) {
      const vec = textToNgramVector(single.members[0]!.text);
      const hit = findBestClusterForVector(multi, vec, orphanMergeThreshold);
      if (hit) {
        mergeClusterMembers(multi[hit.index]!, single.members);
      }
    }

    const stillOrphan = orphans.filter((single) => {
      const vec = textToNgramVector(single.members[0]!.text);
      return !findBestClusterForVector(multi, vec, orphanMergeThreshold);
    });

    const singletonRatio =
      clusters.length > 0 ? stillOrphan.length / clusters.length : 0;

    clusters = [...multi];
    if (bundleRemaining && stillOrphan.length > 0) {
      const miscMembers = stillOrphan.flatMap((c) => c.members);
      clusters.push({
        clusterId: '__misc__',
        label: miscLabel,
        members: miscMembers,
        isMiscBucket: true,
      });
    } else {
      clusters.push(...stillOrphan);
    }

    if (singletonRatio <= 0.45 || pass === adaptivePasses) break;
    threshold = Math.max(0.42, threshold - 0.06);
  }

  return clusters.sort((a, b) => {
    if (a.isMiscBucket && !b.isMiscBucket) return 1;
    if (!a.isMiscBucket && b.isMiscBucket) return -1;
    return uniqueVideoCount(b.members) - uniqueVideoCount(a.members);
  });
}
