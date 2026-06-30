import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Compass, Zap, MessageSquare, RefreshCw, TrendingUp, Users, BarChart2, Sparkles, ChevronRight, Activity, CalendarDays } from 'lucide-react';
import type { AgentType, ConversationContext } from '../App';
import { authHeader } from '../lib/auth';

const AGENTS = [
  { type: 'strategy' as AgentType, name: '策略专家', desc: '跨三侧策略编排，经营分析与多 Agent 协调', icon: Compass, color: '#4f46e5', bg: 'rgba(79,70,229,0.08)', maturity: 85, status: 'active' as const, recentActivity: '生成斋月中东推广方案', stats: [{ label: '本周方案', value: '6' }, { label: '协调任务', value: '14' }, { label: '采纳率', value: '91%' }] },
  { type: 'traffic' as AgentType, name: '流量专家', desc: '竞品视频克隆、脚本生成、素材去重矩阵', icon: Zap, color: '#d97706', bg: 'rgba(217,119,6,0.08)', maturity: 72, status: 'running' as const, recentActivity: '分析 TikTok 10 条假发爆款', stats: [{ label: '今日脚本', value: '12' }, { label: '覆盖平台', value: '5' }, { label: '去重命中', value: '3' }] },
  { type: 'conversion' as AgentType, name: '转化专家', desc: '多语种 24/7 接待，大单预警，AI+人工无缝切换', icon: MessageSquare, color: '#0891b2', bg: 'rgba(8,145,178,0.08)', maturity: 61, status: 'idle' as const, recentActivity: '处理 3 条 WhatsApp 阿语询盘', stats: [{ label: '今日询盘', value: '23' }, { label: '转报价', value: '8' }, { label: '大单预警', value: '1' }] },
  { type: 'retention' as AgentType, name: '留存专家', desc: '老客画像沉淀、生命周期唤醒、行动建议', icon: RefreshCw, color: '#16a34a', bg: 'rgba(22,163,74,0.08)', maturity: 89, status: 'active' as const, recentActivity: '识别 2 个采购周期到期老客', stats: [{ label: '老客总数', value: '632' }, { label: '本月唤醒', value: '47' }, { label: '复购率', value: '34%' }] },
];
const SM = { active: { label: '运行中', color: '#16a34a' }, running: { label: '执行中', color: '#d97706' }, idle: { label: '待机', color: '#94a3b8' } };

interface ScheduledTask {
  id: string;
  name: string;
  taskType: string;
  cronLabel: string;
  enabled: boolean;
  lastRun?: string;
  lastResult?: string;
  config?: Record<string, string>;
}

interface CalendarRow {
  id?: string;
  date: string;
  type: string;
  owner: string;
  action: string;
  status: string;
}

const TASK_OWNER: Record<string, string> = {
  trend_report: '流量专家',
  video_keyword_crawl: '流量专家',
  weekly_review: '策略专家',
  crm_wakeup: '留存专家',
  exchange_rate: '转化专家',
  holiday_push: '策略专家',
};

function taskAction(task: ScheduledTask): string {
  if (task.taskType === 'video_keyword_crawl') {
    const platforms = (task.config?.platforms || 'youtube')
      .split(/[\n,，;；、]+/)
      .map(platform => platform.trim().toLowerCase())
      .filter(Boolean)
      .map(platform => platform === 'youtube' ? 'YouTube' : platform === 'tiktok' ? 'TikTok' : platform)
      .join(' / ');
    const keywords = task.config?.keywords ? `关键词：${task.config.keywords}` : '关键词视频';
    return `自动采集 ${platforms} ${keywords}，同步素材库、视频级分析和脚本方向。`;
  }
  if (task.taskType === 'trend_report') return '生成社媒爆款趋势日报，沉淀热门品类、标签和借势策略。';
  if (task.taskType === 'holiday_push') return '扫描未来节日营销节点，生成推品、内容和客户触达动作。';
  if (task.taskType === 'exchange_rate') return '更新汇率报价提醒，辅助多币种询盘和大额报价有效期设置。';
  if (task.taskType === 'weekly_review') return '复盘本周经营数据，拆解下周流量、转化、留存行动。';
  if (task.taskType === 'crm_wakeup') return '筛选沉默客户并生成 WhatsApp / 邮件唤醒批次。';
  return task.name;
}

function taskStatus(task: ScheduledTask): string {
  if (!task.enabled) return '停用';
  if (task.lastRun) return '已同步';
  return '循环';
}

function taskRows(tasks: ScheduledTask[]): CalendarRow[] {
  return tasks.map(task => ({
    id: task.id,
    date: task.cronLabel || '定时',
    type: '定时任务',
    owner: TASK_OWNER[task.taskType] || '策略专家',
    action: taskAction(task),
    status: taskStatus(task),
  }));
}

function getBeijingMonthPlan() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthNo = month + 1;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const pad = (day: number) => `${monthNo}/${day}`;
  const isJune = monthNo === 6;
  const isNovember = monthNo === 11;
  const isDecember = monthNo === 12;
  const mainNode = isJune ? '年中大促 / 618 复盘'
    : isNovember ? '黑五网一备战'
      : isDecember ? '圣诞季收口'
        : '本月主推市场营销节点';
  const baseRows: CalendarRow[] = [
    { date: `${pad(1)}-${pad(3)}`, type: '运营周期', owner: '策略专家', action: '复盘上月 GMV、询盘、复购与素材消耗，拆成本月目标。', status: now.getDate() > 3 ? '已过' : '本周' },
    { date: `${pad(10)}-${pad(20)}`, type: '营销节点', owner: '策略专家', action: mainNode, status: now.getDate() <= 20 ? '进行中' : '已过' },
    { date: `${pad(Math.max(1, lastDay - 2))}-${pad(lastDay)}`, type: '关键行动', owner: '全体 Agent', action: '月末经营复盘、下月选题池、素材去重与自动任务校准。', status: now.getDate() >= lastDay - 2 ? '本周' : '待办' },
  ];
  return {
    label: `${year}年${monthNo}月`,
    rows: baseRows,
  };
}

export default function AgentWorkspace({ onEnterConversation }: { onEnterConversation: (ctx: ConversationContext) => void }) {
  const monthPlan = useMemo(() => getBeijingMonthPlan(), []);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  useEffect(() => {
    let alive = true;
    fetch('/api/overseas/scheduler', { headers: authHeader() })
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (alive && Array.isArray(data)) setTasks(data); })
      .catch(() => { if (alive) setTasks([]); });
    return () => { alive = false; };
  }, []);
  const calendarRows = useMemo(
    () => [...monthPlan.rows.slice(0, 1), ...taskRows(tasks), ...monthPlan.rows.slice(1)],
    [monthPlan.rows, tasks],
  );
  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-text-primary font-display">你的 AI 智囊团</h2>
        <p className="text-sm text-text-muted mt-0.5">4 位 AI 专家实时运行 · 点击卡片进入对话</p>
      </div>
      <section className="mb-6 rounded-2xl border border-border bg-surface overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-accent-glow text-accent flex items-center justify-center">
              <CalendarDays size={16} />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">工作日历</p>
              <p className="text-[11px] text-text-muted">北京时间 · {monthPlan.label} · 已同步 {tasks.length} 个定时任务 / 营销节点 / 运营周期</p>
            </div>
          </div>
          <span className="text-[10px] font-semibold text-accent bg-accent-glow px-2.5 py-1 rounded-full border border-accent/20">本月视图</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-surface-2 text-text-muted">
              <tr>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">时间</th>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">类型</th>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">负责 Agent</th>
                <th className="px-4 py-2.5 font-semibold">关键行动</th>
                <th className="px-4 py-2.5 font-semibold whitespace-nowrap">状态</th>
              </tr>
            </thead>
            <tbody>
              {calendarRows.map((row, index) => (
                <tr key={row.id || `${row.date}-${row.type}-${index}`} className="border-t border-border/70">
                  <td className="px-4 py-2.5 font-medium text-text-primary whitespace-nowrap">{row.date}</td>
                  <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">{row.type}</td>
                  <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">{row.owner}</td>
                  <td className="px-4 py-2.5 text-text-secondary leading-relaxed min-w-72">{row.action}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="rounded-full bg-surface-2 border border-border px-2 py-0.5 text-[10px] font-semibold text-text-muted">{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="card p-3.5 mb-6 flex items-center gap-3">
        <div className="flex items-center gap-1.5 flex-shrink-0"><Activity size={13} className="text-accent" /><span className="text-xs font-semibold text-text-primary">行动建议流水线</span></div>
        <div className="flex-1 flex items-center gap-1">
          {['社媒检测', 'CRM筛选', '生成话术', '待推送'].map((s, i) => (<div key={s} className="flex items-center gap-1 flex-1 min-w-0"><span className="text-[10px] text-text-muted truncate">{s}</span>{i < 3 && <ChevronRight size={10} className="text-border-bright flex-shrink-0" />}</div>))}
        </div>
        <span className="text-[10px] font-semibold text-accent bg-accent-glow px-2 py-0.5 rounded-full border border-accent/20 flex-shrink-0">今日触发 2 次</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {AGENTS.map((agent, i) => {
          const sm = SM[agent.status]; const Icon = agent.icon;
          return (
            <motion.button key={agent.type} type="button" data-agent-card={agent.type}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
              className="card p-4 cursor-pointer flex flex-col gap-3 hover:border-border-bright text-left"
              onClick={() => onEnterConversation({ agent: agent.type })}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: agent.bg, color: agent.color }}><Icon size={18} /></div>
                  <div><p className="text-sm font-semibold text-text-primary">{agent.name}</p><div className="flex items-center gap-1 mt-0.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: sm.color, boxShadow: agent.status !== 'idle' ? `0 0 5px ${sm.color}` : undefined }} /><span className="text-[10px] font-medium" style={{ color: sm.color }}>{sm.label}</span></div></div>
                </div>
                <ChevronRight size={14} className="text-text-muted mt-1" />
              </div>
              <p className="text-[11px] text-text-muted leading-relaxed">{agent.desc}</p>
              <div>
                <div className="flex items-center justify-between mb-1"><span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">成熟度</span><Sparkles size={10} style={{ color: agent.color }} /></div>
                <div className="flex items-center gap-2"><div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden"><motion.div initial={{ width: 0 }} animate={{ width: `${agent.maturity}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} className="h-full rounded-full" style={{ background: agent.color }} /></div><span className="text-[11px] font-mono font-semibold text-text-secondary w-7 text-right">{agent.maturity}</span></div>
              </div>
              <div className="grid grid-cols-3 gap-1 pt-2 border-t border-border">{agent.stats.map(s => (<div key={s.label} className="text-center"><p className="text-sm font-bold text-text-primary font-display">{s.value}</p><p className="text-[9px] text-text-muted mt-0.5">{s.label}</p></div>))}</div>
              <div className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: agent.bg }}><TrendingUp size={10} className="flex-shrink-0 mt-0.5" style={{ color: agent.color }} /><p className="text-[10px] leading-relaxed" style={{ color: agent.color }}>{agent.recentActivity}</p></div>
            </motion.button>
          );
        })}
      </div>
      <div className="mt-6 grid grid-cols-3 gap-3">
        {[{ icon: Users, label: '今日协作任务', value: '16', color: '#4f46e5' }, { icon: BarChart2, label: '自动化触发', value: '2', color: '#d97706' }, { icon: Sparkles, label: '待确认进化建议', value: '3', color: '#16a34a' }].map(stat => { const I = stat.icon; return (<div key={stat.label} className="card p-3 flex items-center gap-2.5"><I size={14} style={{ color: stat.color }} /><div><p className="text-base font-bold text-text-primary font-display leading-none">{stat.value}</p><p className="text-[10px] text-text-muted mt-0.5">{stat.label}</p></div></div>); })}
      </div>
    </div>
  );
}
