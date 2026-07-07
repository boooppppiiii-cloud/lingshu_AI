import { useState, type ReactNode } from 'react';
import { Check, Copy, Zap } from 'lucide-react';
import type { AgentType } from '../App';

/* 渲染 Agent 回复的轻量 Markdown：
   ## / ### 分级加粗标题，**加粗**强调结论，- / 1. 列表，[文字](链接) 可点跳转。
   支持 Markdown 表格、引用/话术块、代码块复制。
   并把"建议触发 [X专家] 执行：任务"识别成「一键执行」按钮。 */

const AGENT_BY_NAME: Record<string, AgentType> = {
  流量专家: 'traffic',
  我的社媒: 'traffic',
  转化专家: 'conversion',
  留存专家: 'retention',
  我的客户: 'conversion',
  策略专家: 'strategy',
  首页: 'strategy',
};
const ACTION_RE = /建议触发\s*[【[]?\s*(流量专家|我的社媒|转化专家|留存专家|我的客户|策略专家|首页)\s*[】\]]?\s*执行[:：]\s*(.+)/;

function cleanLooseMarkdown(text: string): string {
  let out = text.replace(/<br\s*\/?>/gi, '\n');
  const boldMarks = (out.match(/\*\*/g) ?? []).length;
  if (boldMarks % 2 !== 0) out = out.replace(/\*\*/g, '');
  out = out
    .replace(/^\s*#{1,6}\s*$/, '')
    .replace(/^\s*#{4,6}\s*(\d+[.、)])\s*/, '$1 ')
    .replace(/\s*#{3,6}\s*$/g, '')
    .replace(/\*\*(\s|$)/g, '$1')
    .replace(/(^|\s)\*\*/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out;
}

function inline(text: string, kb: string): ReactNode[] {
  const safeText = cleanLooseMarkdown(text);
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0, idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(safeText)) !== null) {
    if (m.index > last) nodes.push(cleanLooseMarkdown(safeText.slice(last, m.index)));
    if (m[1] !== undefined) {
      nodes.push(<strong key={`${kb}b${idx}`} className="font-bold text-text-primary">{cleanLooseMarkdown(m[1])}</strong>);
    } else {
      nodes.push(
        <a key={`${kb}l${idx}`} href={m[3]} target="_blank" rel="noopener noreferrer"
          className="text-accent underline underline-offset-2 hover:opacity-80 break-all">{m[2]}</a>,
      );
    }
    last = re.lastIndex; idx++;
  }
  if (last < safeText.length) nodes.push(cleanLooseMarkdown(safeText.slice(last)));
  return nodes;
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim().replace(/<br\s*\/?>/gi, '；'));
}

function isTableLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.includes('|');
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" onClick={copy}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-white/80 px-2 py-1 text-[10px] font-semibold text-text-muted hover:text-text-primary transition-colors">
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? '已复制' : label}
    </button>
  );
}

function CopyBlock({ text, title, tone = 'neutral' }: { text: string; title?: string; tone?: 'neutral' | 'quote' }) {
  return (
    <div className={`my-2 overflow-hidden rounded-xl border ${tone === 'quote' ? 'border-accent/20 bg-accent-glow' : 'border-border bg-white/75'}`}>
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-1.5">
        <span className="text-[10px] font-semibold text-text-muted">{title || '可复制内容'}</span>
        <CopyButton text={text} />
      </div>
      <div className="whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-relaxed text-text-primary">{cleanLooseMarkdown(text)}</div>
    </div>
  );
}

export default function AgentReply({ content, sources, onAction }: { content: string; sources?: { title: string; uri: string }[]; onAction?: (agent: AgentType, task: string) => void }) {
  const lines = content.split('\n');
  const blocks: ReactNode[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flush = () => {
    if (!list) return;
    const { type, items } = list;
    blocks.push(
      type === 'ol'
        ? <ol key={`l${blocks.length}`} className="list-decimal pl-5 space-y-1 my-1.5">{items.map((it, i) => <li key={i} className="leading-relaxed">{inline(it, `o${blocks.length}_${i}`)}</li>)}</ol>
        : <ul key={`l${blocks.length}`} className="list-disc pl-5 space-y-1 my-1.5">{items.map((it, i) => <li key={i} className="leading-relaxed">{inline(it, `u${blocks.length}_${i}`)}</li>)}</ul>,
    );
    list = null;
  };

  const actionButton = (line: string, key: string) => {
    const cleaned = line.replace(/^\s*(?:[-*•·]|\d+[.、)])\s*/, '').replace(/\*\*/g, '').trim();
    const act = onAction ? cleaned.match(ACTION_RE) : null;
    if (!act) return null;
    const agent = AGENT_BY_NAME[act[1]]; const task = act[2].trim();
    return (
      <button key={key} onClick={() => onAction!(agent, task)}
        className="inline-flex items-start gap-1.5 my-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white text-left transition-all active:scale-[0.98]"
        style={{ background: 'var(--color-accent)' }}>
        <Zap size={13} className="flex-shrink-0 mt-0.5" />
        <span>一键执行 · 让{act[1]}{task.length > 22 ? `${task.slice(0, 22)}…` : task}</span>
      </button>
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flush(); continue; }
    if (/^\s*#{1,6}\s*$/.test(line)) { flush(); continue; }

    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      flush();
      const lang = fence[1] || 'text';
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      blocks.push(<CopyBlock key={`code_${i}`} title={lang === 'copy' ? '话术 / 文案' : lang} text={body.join('\n').trim()} />);
      continue;
    }

    if (/^\s*>/.test(line)) {
      flush();
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      i--;
      blocks.push(<CopyBlock key={`quote_${i}`} title="高亮话术" text={body.join('\n').trim()} tone="quote" />);
      continue;
    }

    if (isTableLine(line)) {
      flush();
      const tableLines: string[] = [];
      while (i < lines.length && isTableLine(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      i--;
      const hasSeparator = tableLines.length > 1 && isTableSeparator(tableLines[1]);
      const header = splitTableRow(tableLines[0]);
      const rows = tableLines.slice(hasSeparator ? 2 : 1).map(splitTableRow);
      blocks.push(
        <div key={`table_${i}`} className="my-2 overflow-x-auto rounded-xl border border-border bg-white/70">
          <table className="min-w-full border-collapse text-left text-xs">
            <thead className="bg-surface">
              <tr>{header.map((cell, idx) => <th key={idx} className="border-b border-border px-3 py-2 font-semibold text-text-primary whitespace-nowrap">{inline(cell, `th_${i}_${idx}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="border-t border-border/70 align-top">
                  {header.map((_, cIdx) => <td key={cIdx} className="px-3 py-2 text-text-secondary leading-relaxed min-w-24">{inline(row[cIdx] ?? '', `td_${i}_${rIdx}_${cIdx}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 一键执行：把"建议触发 [X专家] 执行：任务"渲染成按钮
    const action = actionButton(line, `act_${i}`);
    if (action) {
      flush();
      blocks.push(action);
      continue;
    }
    const heading = line.match(/^#{1,6}\s*(.+)/);
    const h3 = line.match(/^###\s+(.*)/);
    const h2 = line.match(/^##\s+(.*)/);
    const ol = line.match(/^\s*\d+[.、)]\s+(.*)/);
    const ul = line.match(/^\s*[-*•·]\s+(.*)/);
    if (heading) {
      flush();
      const level = (line.match(/^#+/)?.[0].length ?? 2) <= 2 ? 'text-base mt-3.5 mb-1.5' : 'text-sm mt-3 mb-1';
      blocks.push(<p key={i} className={`${level} font-bold text-text-primary`}>{inline(heading[1], `hx_${i}`)}</p>);
      continue;
    }
    if (h3) { flush(); blocks.push(<p key={i} className="text-sm font-bold text-text-primary mt-3 mb-1">{inline(h3[1], `h3_${i}`)}</p>); continue; }
    if (h2) { flush(); blocks.push(<p key={i} className="text-base font-bold text-text-primary mt-3.5 mb-1.5">{inline(h2[1], `h2_${i}`)}</p>); continue; }
    if (ol) { if (list?.type !== 'ol') { flush(); list = { type: 'ol', items: [] }; } list.items.push(cleanLooseMarkdown(ol[1])); continue; }
    if (ul) { if (list?.type !== 'ul') { flush(); list = { type: 'ul', items: [] }; } list.items.push(cleanLooseMarkdown(ul[1])); continue; }
    flush();
    const cleanedLine = cleanLooseMarkdown(line);
    if (cleanedLine) blocks.push(<p key={i} className="leading-relaxed my-1 whitespace-pre-wrap">{inline(cleanedLine, `p_${i}`)}</p>);
  }
  flush();

  return (
    <div className="text-sm text-text-primary [&>*:first-child]:mt-0">
      {blocks}
      {sources && sources.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-border">
          <p className="text-[10px] font-semibold text-text-muted mb-1">参考来源</p>
          <div className="flex flex-col gap-0.5">
            {sources.map((s, i) => (
              <a key={i} href={s.uri} target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-accent hover:underline truncate">
                {i + 1}. {s.title}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
