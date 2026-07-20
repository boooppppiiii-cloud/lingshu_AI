export interface MaterialPolicyInput {
  id?: string;
  name?: string;
  folder?: string;
  scope?: string;
  usage?: string;
  sourceType?: string;
  sourceUrl?: string;
}

export type MaterialUsage = 'editable' | 'reference_only';

/**
 * Legacy crawled videos predate explicit usage metadata. Keep them available for
 * competitor analysis, but never expose them as downloadable editing assets.
 */
export function materialUsage(material: MaterialPolicyInput): MaterialUsage {
  if (material.usage === 'reference_only') return 'reference_only';
  if (/^(youtube|facebook|instagram|tiktok)$/i.test(String(material.sourceType || ''))) return 'reference_only';
  if (/youtube\.com|youtu\.be|facebook\.com|instagram\.com|tiktok\.com/i.test(String(material.sourceUrl || ''))) return 'reference_only';
  if (material.folder === 'hot' && /爆款[·・](?:YouTube|Facebook|Instagram|TikTok)/i.test(String(material.name || ''))) {
    return 'reference_only';
  }
  return 'editable';
}

export function isReferenceOnlyMaterial(material: MaterialPolicyInput): boolean {
  return materialUsage(material) === 'reference_only';
}

export function canAppearInSharedLibrary(material: MaterialPolicyInput): boolean {
  return material.scope === 'shared' && !isReferenceOnlyMaterial(material);
}
