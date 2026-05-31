/** 竞品 TOP 表格 — 投放日期（PocketBase `runDates` JSON 文本数组） */

export function formatRunDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 近 N 天日期预设（含今天，降序） */
export function recentRunDatePresets(days = 60): string[] {
  const out: string[] = [];
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push(formatRunDateYmd(d));
  }
  return out;
}

/** 将用户输入规范为 YYYY-MM-DD；无法识别则返回 trim 后的原文（便于保留备注类日期） */
export function normalizeRunDateInput(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    const y = iso[1]!;
    const m = String(Number(iso[2])).padStart(2, '0');
    const d = String(Number(iso[3])).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }
  const md = s.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (md) {
    const y = String(new Date().getFullYear());
    const m = String(Number(md[1])).padStart(2, '0');
    const d = String(Number(md[2])).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return s.slice(0, 32);
}

export function parseRunDates(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of v) {
      if (typeof x !== 'string') continue;
      const n = normalizeRunDateInput(x);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out.sort((a, b) => b.localeCompare(a, 'zh-CN'));
  } catch {
    return [];
  }
}

export function mergeRunDatesList(dates: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of dates) {
    const n = normalizeRunDateInput(x);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.sort((a, b) => b.localeCompare(a, 'zh-CN'));
}

export function parseManualRunDateLines(text: string): string[] {
  return mergeRunDatesList(
    text
      .split(/[\n,，;；]+/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

export function runDatesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x.localeCompare(y, 'zh-CN'));
  const sb = [...b].sort((x, y) => x.localeCompare(y, 'zh-CN'));
  return sa.every((v, i) => v === sb[i]);
}
