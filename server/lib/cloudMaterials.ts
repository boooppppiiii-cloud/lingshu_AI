import { adminFetch, getPbUrl } from '../storage/pb.js';
import { createFilePlaybackUrl } from '../storage/files.js';

export interface CloudMaterialRecord extends Record<string, unknown> { id: string; videoFile?: string; posterFile?: string }

export async function listCloudMaterials(): Promise<Array<Record<string, unknown>>> {
  const response = await adminFetch('/api/collections/materials/records?perPage=500');
  if (!response.ok) return [];
  const data = await response.json() as { items?: CloudMaterialRecord[] };
  return (data.items || []).map(item => ({
    id: `pb-${item.id}`,
    name: String(item.title || item.sourceName || '云端素材'),
    folder: String(item.folder || 'upload'),
    type: 'video',
    duration: Number(item.duration || 0),
    size: humanSize(Number(item.sizeBytes || 0)),
    file: String(item.videoFile || ''),
    url: `/api/overseas/studio/materials/pb/${item.id}/media`,
    poster: item.posterFile ? `/api/overseas/studio/materials/pb/${item.id}/poster` : undefined,
    scope: String(item.scope || 'shared'),
    usage: String(item.usage || 'editable'),
    sourceType: String(item.sourceType || 'licensed_upload'),
    sourceUrl: '',
    industry: String(item.industry || ''),
    shotFunction: String(item.shotFunction || ''),
    applicability: String(item.applicability || ''),
    tags: String(item.tags || ''),
    createdAt: String(item.created || new Date().toISOString()),
  }));
}

export async function fetchCloudMaterial(id: string, field: 'videoFile' | 'posterFile', range?: string): Promise<Response | null> {
  const response = await adminFetch(`/api/collections/materials/records/${encodeURIComponent(id)}`);
  if (!response.ok) return null;
  const record = await response.json() as CloudMaterialRecord;
  const filename = String(record[field] || '');
  if (!filename) return null;
  const url = await createFilePlaybackUrl('materials', id, filename);
  if (!url) return null;
  const upstream = await fetch(url, { headers: range ? { Range: range } : undefined });
  return upstream.ok ? upstream : null;
}

function humanSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
