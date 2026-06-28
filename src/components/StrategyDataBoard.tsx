import { useState } from 'react';
import { Zap, MessageSquare, Users, X } from 'lucide-react';
import TrafficDataBoard from './TrafficDataBoard';
import InquiryDataBoard from './InquiryDataBoard';
import CrmDataBoard from './CrmDataBoard';

/* 策略页「数据大屏」——全平台经营数据只在策略 agent 看（负责"想"）；
   流量/转化/留存三个 agent 是干活的工作台，不看数据。
   三个 tab：流量 / 询盘 / CRM；时间维度（月/周/日 + 自定义日期范围）在壳层统一控制。 */

const TABS = [
  { id: 'traffic', label: '流量', icon: Zap, Comp: TrafficDataBoard },
  { id: 'inquiry', label: '询盘', icon: MessageSquare, Comp: InquiryDataBoard },
  { id: 'crm', label: 'CRM', icon: Users, Comp: CrmDataBoard },
] as const;
const PRESETS = [['月', 30], ['周', 7], ['日', 1]] as const;
const today = new Date().toISOString().slice(0, 10);

export default function StrategyDataBoard() {
  const [tab, setTab] = useState<typeof TABS[number]['id']>('traffic');
  const [days, setDays] = useState(30);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const custom = !!(start && end);
  const windowDays = custom
    ? Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1)
    : days;

  const Active = (TABS.find(t => t.id === tab) ?? TABS[0]).Comp;
  const seg = (active: boolean) => `px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${active ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`;
  const dateInput = 'rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none hover:border-border-bright text-text-secondary';

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-5 pb-3 flex items-center gap-3 flex-wrap border-b border-border flex-shrink-0">
        <h2 className="text-base font-bold text-text-primary font-display">数据大屏</h2>
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
          {TABS.map(x => (
            <button key={x.id} onClick={() => setTab(x.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${tab === x.id ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
              <x.icon size={12} /> {x.label}
            </button>
          ))}
        </div>

        {/* 时间维度：月/周/日 + 自定义起止 */}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
            {PRESETS.map(([l, d]) => (
              <button key={l} className={seg(!custom && days === d)} onClick={() => { setDays(d); setStart(''); setEnd(''); }}>{l}</button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <input type="date" max={end || today} value={start} onChange={e => setStart(e.target.value)} className={dateInput} />
            <span className="text-text-muted text-xs">至</span>
            <input type="date" max={today} min={start || undefined} value={end} onChange={e => setEnd(e.target.value)} className={dateInput} />
            {custom && (
              <button onClick={() => { setStart(''); setEnd(''); }} aria-label="清除自定义日期"
                className="w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-2">
                <X size={13} />
              </button>
            )}
          </div>
          <span className="text-[11px] text-text-muted">{custom ? `${start} ~ ${end} · ${windowDays} 天` : `近 ${windowDays} 天`}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <Active windowDays={windowDays} />
      </div>
    </div>
  );
}
