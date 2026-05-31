/** 触发 Node 对 buying_videos 记录做 Gemini 分析并 PATCH scriptTags / hookAnalysisJson */
const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export async function triggerBuyingVideoIngest(recordId: string): Promise<{
  ok: boolean;
  skipped?: boolean;
  error?: string;
}> {
  const res = await fetch(`${apiBase}/api/buying-videos/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordId }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; skipped?: boolean; error?: string };
  if (!res.ok) {
    return { ok: false, error: json.error ?? `HTTP ${res.status}` };
  }
  return { ok: true, skipped: json.skipped };
}
