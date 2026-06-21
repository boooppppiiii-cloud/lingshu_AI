import { motion } from 'motion/react';
import { Compass, Zap, MessageSquare, RefreshCw, TrendingUp, Users, BarChart2, Sparkles, ChevronRight, Activity } from 'lucide-react';
import type { AgentType, ConversationContext } from '../App';

const AGENTS = [
  { type: 'strategy' as AgentType, name: '顾问 Agent', desc: '跨三侧策略编排，经营分析与多 Agent 协调', icon: Compass, color: '#4f46e5', bg: 'rgba(79,70,229,0.08)', maturity: 85, status: 'active' as const, recentActivity: '生成斋月中东推广方案', stats: [{ label: '本周方案', value: '6' }, { label: '协调任务', value: '14' }, { label: '采纳率', value: '91%' }] },
  { type: 'traffic' as AgentType, name: '社媒 Agent', desc: '竞品视频克隆、脚本生成、素材去重矩阵', icon: Zap, color: '#d97706', bg: 'rgba(217,119,6,0.08)', maturity: 72, status: 'running' as const, recentActivity: '分析 TikTok 10 条假发爆款', stats: [{ label: '今日脚本', value: '12' }, { label: '覆盖平台', value: '5' }, { label: '去重命中', value: '3' }] },
  { type: 'conversion' as AgentType, name: '客服 Agent', desc: '多语种 24/7 接待，大单预警，AI+人工无缝切换', icon: MessageSquare, color: '#0891b2', bg: 'rgba(8,145,178,0.08)', maturity: 61, status: 'idle' as const, recentActivity: '处理 3 条 WhatsApp 阿语询盘', stats: [{ label: '今日询盘', value: '23' }, { label: '转报价', value: '8' }, { label: '大单预警', value: '1' }] },
  { type: 'retention' as AgentType, name: 'CRM Agent', desc: '老客画像沉淀、生命周期唤醒、反向动态推品', icon: RefreshCw, color: '#16a34a', bg: 'rgba(22,163,74,0.08)', maturity: 89, status: 'active' as const, recentActivity: '识别 2 个采购周期到期老客', stats: [{ label: '老客总数', value: '632' }, { label: '本月唤醒', value: '47' }, { label: '复购率', value: '34%' }] },
];
const SM = { active: { label: '运行中', color: '#16a34a' }, running: { label: '执行中', color: '#d97706' }, idle: { label: '待机', color: '#94a3b8' } };

export default function AgentWorkspace({ onEnterConversation }: { onEnterConversation: (ctx: ConversationContext) => void }) {
  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-text-primary font-display">数字团队工作台</h2>
        <p className="text-sm text-text-muted mt-0.5">4 个 Agent 实时运行 · 点击卡片进入对话</p>
      </div>
      <div className="card p-3.5 mb-6 flex items-center gap-3">
        <div className="flex items-center gap-1.5 flex-shrink-0"><Activity size={13} className="text-accent" /><span className="text-xs font-semibold text-text-primary">反向推品流水线</span></div>
        <div className="flex-1 flex items-center gap-1">
          {['社媒检测', 'CRM筛选', '生成话术', '待推送'].map((s, i) => (<div key={s} className="flex items-center gap-1 flex-1 min-w-0"><span className="text-[10px] text-text-muted truncate">{s}</span>{i < 3 && <ChevronRight size={10} className="text-border-bright flex-shrink-0" />}</div>))}
        </div>
        <span className="text-[10px] font-semibold text-accent bg-accent-glow px-2 py-0.5 rounded-full border border-accent/20 flex-shrink-0">今日触发 2 次</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {AGENTS.map((agent, i) => {
          const sm = SM[agent.status]; const Icon = agent.icon;
          return (
            <motion.div key={agent.type} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }} className="card p-4 cursor-pointer flex flex-col gap-3 hover:border-border-bright" onClick={() => onEnterConversation({ agent: agent.type })}>
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
            </motion.div>
          );
        })}
      </div>
      <div className="mt-6 grid grid-cols-3 gap-3">
        {[{ icon: Users, label: '今日协作任务', value: '16', color: '#4f46e5' }, { icon: BarChart2, label: '自动化触发', value: '2', color: '#d97706' }, { icon: Sparkles, label: '待确认进化建议', value: '3', color: '#16a34a' }].map(stat => { const I = stat.icon; return (<div key={stat.label} className="card p-3 flex items-center gap-2.5"><I size={14} style={{ color: stat.color }} /><div><p className="text-base font-bold text-text-primary font-display leading-none">{stat.value}</p><p className="text-[10px] text-text-muted mt-0.5">{stat.label}</p></div></div>); })}
      </div>
    </div>
  );
}
