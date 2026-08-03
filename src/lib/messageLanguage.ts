export function isPredominantlyChineseText(value: unknown): boolean {
  const text = String(value ?? '').trim();
  if (!text) return false;
  const hanCount = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  if (hanCount < 2) return false;
  const latinCount = text.match(/[a-z]/gi)?.length ?? 0;
  if (!latinCount) return true;
  return hanCount >= Math.max(2, Math.ceil(latinCount * 0.2));
}
