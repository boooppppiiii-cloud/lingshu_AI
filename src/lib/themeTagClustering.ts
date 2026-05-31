/**
 * 主题标签（≤4 字）专用聚类：
 * - 仅当共享「有含义词根」白名单（如「萌宠」）时可合并
 * - 每个共性簇最多合并 2 个不同标签
 */
import {
  cosineSimilarity,
  normalizeTextForSimilarity,
  textToNgramVector,
  type TextCluster,
  type TextClusterInput,
  type TextClusterMember,
} from './textCosineSimilarity';

/** 允许触发合并的有含义词根（需业务维护；泛化词不要加入） */
export const MEANINGFUL_THEME_ROOTS = ['萌宠'] as const;

export const MAX_THEME_TAGS_PER_CLUSTER = 2;

function tagContainsRoot(tag: string, root: string): boolean {
  return normalizeTextForSimilarity(tag).includes(normalizeTextForSimilarity(root));
}

/** 两标签共同命中的有含义词根 */
export function sharedMeaningfulThemeRoots(a: string, b: string): string[] {
  return MEANINGFUL_THEME_ROOTS.filter((root) => tagContainsRoot(a, root) && tagContainsRoot(b, root));
}

/** 两枚主题标签是否应并入同一共性簇（仅白名单词根、且至多 2 标签） */
export function shouldMergeThemeTags(a: string, b: string): boolean {
  const na = normalizeTextForSimilarity(a);
  const nb = normalizeTextForSimilarity(b);
  if (!na || !nb) return false;
  if (na === nb) return false;
  return sharedMeaningfulThemeRoots(a, b).length > 0;
}

class UnionFind {
  parent: number[];
  tagSets: Set<string>[];

  constructor(tags: string[]) {
    this.parent = tags.map((_, i) => i);
    this.tagSets = tags.map((t) => new Set([t]));
  }

  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]!);
    return this.parent[x]!;
  }

  canUnion(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    return this.tagSets[ra]!.size + this.tagSets[rb]!.size <= MAX_THEME_TAGS_PER_CLUSTER;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    for (const t of this.tagSets[rb]!) this.tagSets[ra]!.add(t);
    this.tagSets[rb] = new Set();
    this.parent[rb] = ra;
  }
}

function uniqueVideoCount(members: TextClusterMember[]): number {
  return new Set(members.map((m) => m.itemId)).size;
}

export function clusterThemeTagInputs(
  inputs: TextClusterInput[],
  options?: { bundleSingletons?: boolean; miscLabel?: string },
): TextCluster[] {
  if (inputs.length === 0) return [];

  const uniqueTags = [...new Set(inputs.map((i) => i.text.trim()).filter(Boolean))];
  const uf = new UnionFind(uniqueTags);

  for (let i = 0; i < uniqueTags.length; i++) {
    for (let j = i + 1; j < uniqueTags.length; j++) {
      if (!shouldMergeThemeTags(uniqueTags[i]!, uniqueTags[j]!)) continue;
      if (uf.canUnion(i, j)) uf.union(i, j);
    }
  }

  const tagGroups = new Map<number, string[]>();
  for (let i = 0; i < uniqueTags.length; i++) {
    const root = uf.find(i);
    const list = tagGroups.get(root) ?? [];
    list.push(uniqueTags[i]!);
    tagGroups.set(root, list);
  }

  const tagFreq = new Map<string, number>();
  for (const row of inputs) {
    tagFreq.set(row.text, (tagFreq.get(row.text) ?? 0) + 1);
  }

  const clusters: TextCluster[] = [];
  const miscLabel = options?.miscLabel ?? '其他零散（暂未形成共性簇）';
  const orphans: TextClusterInput[] = [];

  for (const tags of tagGroups.values()) {
    const sortedTags = [...new Set(tags)].sort(
      (a, b) => (tagFreq.get(b) ?? 0) - (tagFreq.get(a) ?? 0) || a.localeCompare(b, 'zh-CN'),
    );
    const displayTags = sortedTags.slice(0, MAX_THEME_TAGS_PER_CLUSTER);
    const representative = displayTags[0]!;
    const repVec = textToNgramVector(representative);
    const members: TextClusterMember[] = [];
    for (const row of inputs) {
      if (!sortedTags.includes(row.text.trim())) continue;
      const sim = cosineSimilarity(textToNgramVector(row.text), repVec);
      members.push({ itemId: row.itemId, text: row.text, similarity: sim });
    }
    members.sort((a, b) => b.similarity - a.similarity);

    const label =
      displayTags.length === 1
        ? displayTags[0]!
        : `${displayTags[0]} / ${displayTags[1]}`;

    const cluster: TextCluster = {
      clusterId: `theme-${normalizeTextForSimilarity(representative).slice(0, 20)}`,
      label,
      members,
    };

    if (uniqueVideoCount(members) >= 2) {
      clusters.push(cluster);
    } else {
      orphans.push(...members.map((m) => ({ itemId: m.itemId, text: m.text })));
    }
  }

  if (options?.bundleSingletons !== false && orphans.length > 0) {
    const repVec = textToNgramVector(orphans[0]!.text);
    clusters.push({
      clusterId: '__misc__',
      label: miscLabel,
      isMiscBucket: true,
      members: orphans.map((row) => ({
        itemId: row.itemId,
        text: row.text,
        similarity: cosineSimilarity(textToNgramVector(row.text), repVec),
      })),
    });
  } else if (orphans.length > 0) {
    for (const row of orphans) {
      clusters.push({
        clusterId: `theme-single-${row.itemId}`,
        label: row.text,
        members: [{ itemId: row.itemId, text: row.text, similarity: 1 }],
      });
    }
  }

  return clusters.sort((a, b) => {
    if (a.isMiscBucket && !b.isMiscBucket) return 1;
    if (!a.isMiscBucket && b.isMiscBucket) return -1;
    return uniqueVideoCount(b.members) - uniqueVideoCount(a.members);
  });
}
