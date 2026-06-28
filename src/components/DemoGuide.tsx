import { useState } from 'react';
import { Check, ChevronDown, Play, RotateCcw } from 'lucide-react';
import type { AgentAction, Page } from '../App';

const STORAGE_KEY = 'ow_demo_steps';

const STEPS = [
  { id: 'template', label: '加载企业模板' },
  { id: 'strategy', label: '获取策略建议' },
  { id: 'traffic', label: '生成社媒内容' },
  { id: 'conversion', label: '处理模拟询盘' },
  { id: 'retention', label: '创建老客唤醒' },
  { id: 'scheduler', label: '查看自动任务' },
];

function loadDone(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

function saveDone(next: Record<string, boolean>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export default function DemoGuide({ onNavigate, onAction }: { onNavigate: (p: Page) => void; onAction?: AgentAction }) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>(loadDone);

  const mark = (id: string) => {
    const next = { ...done, [id]: true };
    setDone(next);
    saveDone(next);
  };

  const start = async () => {
    setBusy(true);
    try {
      await fetch('/api/overseas/enterprise/demo/templates/template-a/apply', { method: 'POST' });
      mark('template');
      mark('strategy');
      onAction?.('strategy', '请基于当前 Demo 企业资料，生成一份出海营销行动计划，并明确拆分给流量、转化、留存三个专家的下一步任务。');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await fetch('/api/overseas/enterprise/demo/reset', { method: 'POST' });
      setDone({});
      saveDone({});
      onNavigate('enterprise');
    } finally {
      setBusy(false);
    }
  };

  const jump = (step: string) => {
    if (step === 'template') onNavigate('enterprise');
    if (step === 'strategy') onNavigate('strategy');
    if (step === 'traffic') onNavigate('traffic');
    if (step === 'conversion') onNavigate('conversion');
    if (step === 'retention') onNavigate('retention');
    if (step === 'scheduler') onNavigate('scheduled');
    mark(step);
  };

  return (
    <div className="mx-3 mb-3 rounded-xl border border-border bg-white/80 overflow-hidden">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-3 py-2">
        <span className="text-xs font-bold text-text-primary">Demo 演示链路</span>
        <ChevronDown size={13} className={`text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-3">
          <div className="grid grid-cols-2 gap-1.5 mb-2">
            <button onClick={start} disabled={busy}
              className="flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
              style={{ background: '#16a34a' }}>
              <Play size={11} />开始
            </button>
            <button onClick={reset} disabled={busy}
              className="flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold border border-border text-text-secondary disabled:opacity-50">
              <RotateCcw size={11} />重置
            </button>
          </div>
          <div className="space-y-1">
            {STEPS.map((s, idx) => (
              <button key={s.id} onClick={() => jump(s.id)}
                className="w-full flex items-center gap-2 text-left rounded-lg px-2 py-1.5 hover:bg-surface-2 transition-colors">
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] flex-shrink-0 ${done[s.id] ? 'bg-accent text-white' : 'bg-surface-2 text-text-muted'}`}>
                  {done[s.id] ? <Check size={10} /> : idx + 1}
                </span>
                <span className="text-[11px] text-text-secondary truncate">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
