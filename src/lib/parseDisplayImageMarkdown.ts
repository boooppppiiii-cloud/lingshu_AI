/**
 * 解析「画面描述 + 动态口令」Markdown，提取画面描述与 1～5 条编号口令。
 */
export function parseDisplayImageMarkdown(text: string): {
  description: string;
  motionCards: string[];
} {
  const normalized = text.replace(/\r\n/g, '\n');
  const descMatch = normalized.match(/###\s*画面描述\s*\n([\s\S]*?)(?=###\s*动态口令)/i);
  const motionMatch = normalized.match(/###\s*动态口令[^\n]*\n([\s\S]+)/i);
  const description = (descMatch?.[1] ?? '').trim();
  const motionBlock = (motionMatch?.[1] ?? '').trim();
  const slots: (string | undefined)[] = Array(5).fill(undefined);
  for (const line of motionBlock.split('\n')) {
    const m = line.match(/^\s*(\d+)\.\s+(.+?)\s*$/);
    if (!m) continue;
    const idx = Number.parseInt(m[1]!, 10);
    if (idx >= 1 && idx <= 5) {
      slots[idx - 1] = m[2]!.trim();
    }
  }
  const motionCards = slots.map((s) => (s ?? '').trim());
  return {
    description: description || normalized.trim().slice(0, 4000),
    motionCards,
  };
}
