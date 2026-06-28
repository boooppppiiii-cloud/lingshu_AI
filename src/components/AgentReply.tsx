import type { ReactNode } from 'react';
import { Zap } from 'lucide-react';
import type { AgentType } from '../App';

/* 渲染 Agent 回复的轻量 Markdown：
   ## / ### 分级加粗标题，**加粗**强调结论，- / 1. 列表，[文字](链接) 可点跳转。
   并把"建议触发 [X专家] 执行：任务"识别成「一键执行」按钮。 */

const AGENT_BY_NAME: Record<string, AgentType> = { 流量专家: 'traffic', 转化专家: 'conversion', 留存专家: 'retention', 策略专家: 'strategy' };
const ACTION_RE = /建议触发\s*[【[]?\s*(流量专家|转化专家|留存专家|策略专家)\s*[】\]]?\s*执行[:：]\s*(.+)/;

function inline(text: string, kb: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0, idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      nodes.push(<strong key={`${kb}b${idx}`} className="font-bold text-text-primary">{m[1]}</strong>);
    } else {
      nodes.push(
        <a key={`${kb}l${idx}`} href={m[3]} target="_blank" rel="noopener noreferrer"
          className="text-accent underline underline-offset-2 hover:opacity-80 break-all">{m[2]}</a>,
      );
    }
    last = re.lastIndex; idx++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
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

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flush(); return; }
    // 一键执行：把"建议触发 [X专家] 执行：任务"渲染成按钮
    const cleaned = line.replace(/^\s*(?:[-*•·]|\d+[.、)])\s*/, '').replace(/\*\*/g, '').trim();
    const act = onAction ? cleaned.match(ACTION_RE) : null;
    if (act) {
      flush();
      const agent = AGENT_BY_NAME[act[1]]; const task = act[2].trim();
      blocks.push(
        <button key={i} onClick={() => onAction!(agent, task)}
          className="inline-flex items-start gap-1.5 my-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white text-left transition-all active:scale-[0.98]"
          style={{ background: 'var(--color-accent)' }}>
          <Zap size={13} className="flex-shrink-0 mt-0.5" />
          <span>一键执行 · 让{act[1]}{task.length > 22 ? `${task.slice(0, 22)}…` : task}</span>
        </button>,
      );
      return;
    }
    const h3 = line.match(/^###\s+(.*)/);
    const h2 = line.match(/^##\s+(.*)/);
    const ol = line.match(/^\s*\d+[.、)]\s+(.*)/);
    const ul = line.match(/^\s*[-*•·]\s+(.*)/);
    if (h3) { flush(); blocks.push(<p key={i} className="text-sm font-bold text-text-primary mt-3 mb-1">{inline(h3[1], `h3_${i}`)}</p>); return; }
    if (h2) { flush(); blocks.push(<p key={i} className="text-base font-bold text-text-primary mt-3.5 mb-1.5">{inline(h2[1], `h2_${i}`)}</p>); return; }
    if (ol) { if (list?.type !== 'ol') { flush(); list = { type: 'ol', items: [] }; } list.items.push(ol[1]); return; }
    if (ul) { if (list?.type !== 'ul') { flush(); list = { type: 'ul', items: [] }; } list.items.push(ul[1]); return; }
    flush();
    blocks.push(<p key={i} className="leading-relaxed my-1">{inline(line, `p_${i}`)}</p>);
  });
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
