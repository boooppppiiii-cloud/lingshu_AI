import { useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Sparkles, Target, TrendingUp, Users, X, Zap, MessageSquare } from 'lucide-react';
import TrafficDataBoard from './TrafficDataBoard';
import InquiryDataBoard from './InquiryDataBoard';
import CrmDataBoard from './CrmDataBoard';
import type { AgentAction } from '../App';

/* 策略页「数据大屏」——全平台经营数据只在策略 agent 看（负责"想"）；
   流量/转化/留存三个 agent 是干活的工作台，不看数据。
   三个 tab：社媒 / 询盘 / 客户；时间维度（月/周/日 + 自定义日期范围）在壳层统一控制。 */

const TABS = [
  { id: 'traffic', label: '社媒', icon: Zap, Comp: TrafficDataBoard },
  { id: 'inquiry', label: '询盘', icon: MessageSquare, Comp: InquiryDataBoard },
  { id: 'crm', label: '客户', icon: Users, Comp: CrmDataBoard },
] as const;
const PRESETS = [['月', 30], ['周', 7], ['日', 1]] as const;
const today = new Date().toISOString().slice(0, 10);

const actionItems = [
  {
    title: '生成本周经营优先级',
    desc: '让策略专家把市场、产品和渠道动作排成一张执行表。',
    agent: 'strategy' as const,
    task: '诊断当前经营状态，输出今日异常、机会、待确认动作和本周优先级。',
  },
  {
    title: '拆 5 条热点素材脚本',
    desc: '让社媒流量围绕当前素材库提炼可发布脚本。',
    agent: 'traffic' as const,
    task: '基于当前素材库，筛选 5 个值得跟进的美妆内容角度，并生成短视频脚本。',
  },
  {
    title: '整理老客唤醒批次',
    desc: '让留存专家先处理最近 60 天未互动客户。',
    agent: 'retention' as const,
    task: '筛选最近 60 天未互动老客，生成分层唤醒计划和 WhatsApp 文案。',
  },
];

const discoveries = [
  { label: '内容机会', text: '近期素材里“敏感肌、快速吸收、妆前不搓泥”重复出现，可拆成短视频脚本角度。' },
  { label: '转化提醒', text: '询盘进入批发语境时，建议优先使用阶梯报价和 MOQ 解释模板。' },
  { label: '留存动作', text: '60 天未互动老客适合按历史品类分层唤醒，先触达高客单客户。' },
];

const opportunities = [
  '复盘美国 DTC 美妆品牌转化机会',
  '判断中东美妆批发商增长优先级',
  '整理维 C 亮肤精华备货决策',
];

export default function StrategyDataBoard({ onAction }: { onAction?: AgentAction }) {
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
        <h2 className="text-base font-bold text-text-primary font-display">经营仪表盘</h2>
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

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-6 py-5">
          <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-50 text-green-700">
                    <Sparkles size={16} />
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-text-muted">经营诊断</p>
                    <h3 className="text-lg font-bold text-text-primary">经营状态日报</h3>
                  </div>
                </div>
                <p className="mt-2 text-sm text-text-muted">今日异常、机会、任务和待确认动作</p>
              </div>
              <div className="rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700">
                策略专家主视图
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-4">
              {[
                { icon: <AlertTriangle size={14} className="text-green-600" />, label: '今日异常', value: '0', desc: '暂无需要立即阻断处理的经营异常。' },
                { icon: <TrendingUp size={14} className="text-emerald-600" />, label: '今日机会', value: '4', desc: '批发询盘、热点素材、市场增长和老客唤醒均可推进。' },
                { icon: <Clock3 size={14} className="text-blue-600" />, label: '待处理任务', value: '5', desc: '含内容采集、素材分析和客户唤醒动作。' },
                { icon: <CheckCircle2 size={14} className="text-green-600" />, label: '可推进动作', value: '3', desc: '策略复盘、素材脚本、老客唤醒均可立即推进。' },
              ].map(item => (
                <div key={item.label} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    {item.icon}
                    {item.label}
                  </div>
                  <p className="mt-3 text-2xl font-bold text-text-primary">{item.value}</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">{item.desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
              <section className="rounded-2xl border border-border bg-white p-4">
                <h4 className="text-sm font-bold text-text-primary">待确认动作</h4>
                <p className="mt-0.5 text-xs text-text-muted">确认后直接交给对应专家执行。</p>
                <div className="mt-3 space-y-2">
                  {actionItems.map(item => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => onAction?.(item.agent, item.task)}
                      className="flex w-full items-start gap-3 rounded-xl border border-border bg-surface px-3 py-3 text-left transition-colors hover:border-green-200 hover:bg-green-50/60"
                    >
                      <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white text-green-700 shadow-sm">
                        <Target size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-text-primary">{item.title}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-text-muted">{item.desc}</span>
                      </span>
                      <ArrowRight size={14} className="mt-1 text-text-muted" />
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-white p-4">
                <h4 className="text-sm font-bold text-text-primary">AI 发现</h4>
                <div className="mt-3 space-y-2">
                  {discoveries.map(item => (
                    <div key={item.label} className="rounded-xl border border-border bg-surface px-3 py-3">
                      <p className="text-xs font-semibold text-green-700">{item.label}</p>
                      <p className="mt-1 text-xs leading-relaxed text-text-secondary">{item.text}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="mt-5 rounded-2xl border border-border bg-surface p-4">
              <h4 className="text-sm font-bold text-text-primary">机会线索</h4>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {opportunities.map(item => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => onAction?.('strategy', `请围绕「${item}」做经营诊断，输出机会判断、风险和下一步动作。`)}
                    className="rounded-xl border border-border bg-white px-3 py-3 text-left text-xs font-semibold text-text-secondary transition-colors hover:border-green-200 hover:text-green-700"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </section>
          </section>
        </div>

        <div className="min-h-[520px] border-t border-border">
          <Active windowDays={windowDays} />
        </div>
      </div>
    </div>
  );
}
