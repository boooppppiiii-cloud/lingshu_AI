import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Compass, Zap, MessageSquare, TrendingUp, Users, BarChart2, Sparkles, ChevronRight, Activity, CalendarDays } from 'lucide-react';
import type { AgentType } from '../App';
import { authHeader } from '../lib/auth';

const AGENTS = [
  { type: 'strategy' as AgentType, name: '首页', desc: '经营总览、策略编排和关键动作拆解', icon: Compass, color: '#4f46e5', bg: 'rgba(79,70,229,0.08)', status: 'active' as const, recentActivity: '等待真实经营数据接入', stats: [{ label: '本周方案', value: '—' }, { label: '协调任务', value: '—' }, { label: '采纳率', value: '—' }] },
  { type: 'traffic' as AgentType, name: '我的社媒', desc: '竞品视频克隆、脚本生成、素材去重矩阵', icon: Zap, color: '#d97706', bg: 'rgba(217,119,6,0.08)', status: 'idle' as const, recentActivity: '等待社媒账号授权', stats: [{ label: '今日脚本', value: '—' }, { label: '覆盖平台', value: '—' }, { label: '去重命中', value: '—' }] },
  { type: 'conversion' as AgentType, name: '我的客户', desc: '询盘筛选、自动回复、跟单建议和老客唤醒', icon: MessageSquare, color: '#0891b2', bg: 'rgba(8,145,178,0.08)', status: 'idle' as const, recentActivity: '等待 WhatsApp 客户接入', stats: [{ label: '今日询盘', value: '—' }, { label: '高意向', value: '—' }, { label: '待唤醒', value: '—' }] },
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

interface StoredConversation {
  agent: AgentType;
  messages?: { role: 'user' | 'assistant'; content: string }[];
  updatedAt?: number;
}

function todayStartMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function estimateTextTokens(value: string): number {
  const ascii = (value.match(/[\x00-\x7F]/g) ?? []).length;
  const nonAscii = value.length - ascii;
  return Math.ceil(ascii / 4 + nonAscii * 0.75);
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
  return String(tokens);
}

function readAgentTokenUsage(): Record<AgentType, number> {
  const usage: Record<AgentType, number> = { strategy: 0, traffic: 0, conversion: 0, retention: 0 };
  try {
    const list = JSON.parse(localStorage.getItem('ow_convs') || '[]') as StoredConversation[];
    const start = todayStartMs();
    for (const conv of Array.isArray(list) ? list : []) {
      if (!conv.agent || !(conv.agent in usage)) continue;
      if (conv.updatedAt && conv.updatedAt < start) continue;
      const messages = Array.isArray(conv.messages) ? conv.messages : [];
      const userTurns = messages.filter(msg => msg.role === 'user').length;
      const contentTokens = messages.reduce((sum, msg) => sum + estimateTextTokens(msg.content || ''), 0);
      usage[conv.agent] += contentTokens + userTurns * 1600;
    }
  } catch { /* ignore local storage parse errors */ }
  return usage;
}

const TASK_OWNER: Record<string, string> = {
  trend_report: '我的社媒',
  video_keyword_crawl: '我的社媒',
  weekly_review: '首页',
  crm_wakeup: '我的客户',
  exchange_rate: '我的客户',
  holiday_push: '首页',
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
    owner: TASK_OWNER[task.taskType] || '首页',
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
    { date: `${pad(1)}-${pad(3)}`, type: '运营周期', owner: '首页', action: '复盘上月 GMV、询盘、复购与素材消耗，拆成本月目标。', status: now.getDate() > 3 ? '已过' : '本周' },
    { date: `${pad(10)}-${pad(20)}`, type: '营销节点', owner: '首页', action: mainNode, status: now.getDate() <= 20 ? '进行中' : '已过' },
    { date: `${pad(Math.max(1, lastDay - 2))}-${pad(lastDay)}`, type: '关键行动', owner: '全体 Agent', action: '月末经营复盘、下月选题池、素材去重与自动任务校准。', status: now.getDate() >= lastDay - 2 ? '本周' : '待办' },
  ];
  return {
    label: `${year}年${monthNo}月`,
    rows: baseRows,
  };
}

export default function AgentWorkspace() {
  const monthPlan = useMemo(() => getBeijingMonthPlan(), []);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [agentTokens, setAgentTokens] = useState<Record<AgentType, number>>(() => readAgentTokenUsage());
  useEffect(() => {
    let alive = true;
    fetch('/api/overseas/scheduler', { headers: authHeader() })
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (alive && Array.isArray(data)) setTasks(data); })
      .catch(() => { if (alive) setTasks([]); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const refresh = () => setAgentTokens(readAgentTokenUsage());
    refresh();
    const timer = window.setInterval(refresh, 2500);
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const calendarRows = useMemo(
    () => [...monthPlan.rows.slice(0, 1), ...taskRows(tasks), ...monthPlan.rows.slice(1)],
    [monthPlan.rows, tasks],
  );
  const openAssistant = (agent: (typeof AGENTS)[number]) => {
    window.dispatchEvent(new CustomEvent('lingshu-assistant-open', {
      detail: {
        context: {
          agent: agent.type,
          label: agent.name,
          summary: `当前在首页 AI 智囊团，刚选择了${agent.name}。适合围绕${agent.desc}继续拆解动作，并结合当前经营数据给出下一步建议。`,
          suggestions: [
            `围绕${agent.name}给我下一步建议`,
            '把当前重点拆成今日任务',
            '生成可直接执行的清单',
            '同步到相关模块的工作流',
          ],
        },
      },
    }));
  };
  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-text-primary font-display">你的 AI 智囊团</h2>
        <p className="text-sm text-text-muted mt-0.5">一张脸，四个脑子 · 点击卡片唤起灵枢助手</p>
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
          {['社媒检测', '客户筛选', '生成话术', '待推送'].map((s, i) => (<div key={s} className="flex items-center gap-1 flex-1 min-w-0"><span className="text-[10px] text-text-muted truncate">{s}</span>{i < 3 && <ChevronRight size={10} className="text-border-bright flex-shrink-0" />}</div>))}
        </div>
        <span className="text-[10px] font-semibold text-accent bg-accent-glow px-2 py-0.5 rounded-full border border-accent/20 flex-shrink-0">今日触发 2 次</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {AGENTS.map((agent, i) => {
          const sm = SM[agent.status]; const Icon = agent.icon;
          const tokenUsage = agentTokens[agent.type] ?? 0;
          const tokenPct = Math.max(3, Math.min(100, (tokenUsage / 30_000) * 100));
          return (
            <motion.button key={agent.type} type="button" data-agent-card={agent.type}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
              className="card p-4 cursor-pointer flex flex-col gap-3 hover:border-border-bright text-left"
              onClick={() => openAssistant(agent)}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: agent.bg, color: agent.color }}><Icon size={18} /></div>
                  <div><p className="text-sm font-semibold text-text-primary">{agent.name}</p><div className="flex items-center gap-1 mt-0.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: sm.color, boxShadow: agent.status !== 'idle' ? `0 0 5px ${sm.color}` : undefined }} /><span className="text-[10px] font-medium" style={{ color: sm.color }}>{sm.label}</span></div></div>
                </div>
                <ChevronRight size={14} className="text-text-muted mt-1" />
              </div>
              <p className="text-[11px] text-text-muted leading-relaxed">{agent.desc}</p>
              <div>
                <div className="flex items-center justify-between mb-1"><span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">Token 用量</span><Sparkles size={10} style={{ color: agent.color }} /></div>
                <div className="flex items-center gap-2"><div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden"><motion.div initial={{ width: 0 }} animate={{ width: `${tokenPct}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} className="h-full rounded-full" style={{ background: agent.color }} /></div><span className="text-[11px] font-mono font-semibold text-text-secondary w-10 text-right">{formatTokens(tokenUsage)}</span></div>
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
