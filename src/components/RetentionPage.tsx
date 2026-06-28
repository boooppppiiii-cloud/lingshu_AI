import { useState, useEffect } from 'react';
import { RefreshCw, LayoutGrid, MessageSquare, Users, TrendingUp, Sparkles, Bell, Send, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AgentChatPage from './AgentChatPage';
import type { ConversationContext, RestoreSignal, KickoffSignal, AgentAction } from '../App';

type ViewMode = 'dashboard' | 'chat';

interface Props {
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation: () => void;
  isInConversation: boolean;
  restore?: RestoreSignal;
  kickoff?: KickoffSignal;
  onAction?: AgentAction;
}

const SEGMENTS = [
  { label: '高价值老客', count: 87,  desc: '客单价 > $500，近90天活跃', color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
  { label: '30天沉默',   count: 47,  desc: '距上次采购30-60天',          color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  { label: '60天沉默',   count: 18,  desc: '距上次采购60-90天',          color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
  { label: '待推品客户', count: 124, desc: '历史偏好与新品匹配',          color: '#4f46e5', bg: 'rgba(79,70,229,0.08)' },
];

const REACTIVATIONS = [
  { buyer: 'Khalid Mohammed', country: '🇸🇦', lastOrder: '68天前', product: '假发', suggest: '新款棕色直发14寸' },
  { buyer: 'Linh Nguyen',     country: '🇻🇳', lastOrder: '45天前', product: '发饰', suggest: '春季新款发箍套装' },
  { buyer: 'Carlos Rivera',   country: '🇲🇽', lastOrder: '55天前', product: '艾灸贴', suggest: '升级版热敷贴' },
];

const EVENTS = [
  { label: '斋月开始',    date: '2026-02-27', days: 61, color: '#d97706' },
  { label: '母亲节',      date: '2026-05-10', days: 153, color: '#ec4899' },
  { label: '黑色星期五',  date: '2026-11-27', days: 354, color: '#dc2626' },
];

function Dashboard({ onChatClick }: { onChatClick: () => void }) {
  const [created, setCreated] = useState<Record<string, boolean>>({});
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-5 space-y-5">

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: '老客总数',   value: '632', icon: <Users size={14} />,       color: '#16a34a' },
            { label: '本月复购率', value: '34%', icon: <TrendingUp size={14} />,  color: '#4f46e5' },
            { label: '待唤醒',     value: '65',  icon: <Bell size={14} />,        color: '#d97706' },
            { label: '推品命中率', value: '78%', icon: <Sparkles size={14} />,   color: '#0891b2' },
          ].map(s => (
            <div key={s.label} className="card p-4">
              <div className="flex items-center gap-1.5 mb-2" style={{ color: s.color }}>{s.icon}<span className="text-[11px] font-medium text-text-muted">{s.label}</span></div>
              <p className="text-2xl font-bold font-display text-text-primary">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Segments */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-text-primary">客户分层</p>
            <button onClick={onChatClick}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-white transition-all"
              style={{ background: '#16a34a' }}>
              <RefreshCw size={12} />让 留存专家 制定策略
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {SEGMENTS.map(seg => (
              <div key={seg.label} className="card p-4 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: seg.bg, color: seg.color }}>
                  <Users size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-text-primary">{seg.label}</p>
                    <p className="text-lg font-bold font-display" style={{ color: seg.color }}>{seg.count}</p>
                  </div>
                  <p className="text-[11px] text-text-muted mt-0.5">{seg.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Reactivation suggestions */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold text-text-primary">唤醒建议 · 今日优先</p>
          </div>
          <div className="divide-y divide-border">
            {REACTIVATIONS.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors">
                <div className="w-8 h-8 rounded-full bg-surface-2 border border-border flex items-center justify-center text-sm flex-shrink-0">
                  {r.country}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{r.buyer}</p>
                  <p className="text-xs text-text-muted">上次购：{r.product} · {r.lastOrder}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[11px] text-text-muted">推荐推品</p>
                  <p className="text-xs font-medium text-text-secondary">{r.suggest}</p>
                </div>
                <button onClick={() => setCreated(prev => ({ ...prev, [r.buyer]: true }))}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white flex-shrink-0"
                  style={{ background: created[r.buyer] ? '#16a34a' : '#0f172a' }}>
                  {created[r.buyer] ? <CheckCircle2 size={11} /> : <Send size={11} />}
                  {created[r.buyer] ? '已创建' : 'Demo 触达'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Marketing calendar */}
        <div className="card p-4">
          <p className="text-sm font-semibold text-text-primary mb-3">营销节点</p>
          <div className="space-y-2">
            {EVENTS.map(ev => (
              <div key={ev.label} className="flex items-center gap-3">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ev.color }} />
                <p className="text-sm text-text-secondary flex-1">{ev.label}</p>
                <p className="text-xs text-text-muted">{ev.date}</p>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: `${ev.color}12`, color: ev.color }}>
                  {ev.days}天后
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

export default function RetentionPage({ onEnterConversation, onLeaveConversation, isInConversation, restore, kickoff, onAction }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  useEffect(() => { if (restore) setViewMode('chat'); }, [restore?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (kickoff) setViewMode('chat'); }, [kickoff?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEnterChat = (ctx: ConversationContext) => {
    setViewMode('chat');
    onEnterConversation(ctx);
  };

  const handleLeave = () => {
    setViewMode('dashboard');
    onLeaveConversation();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="h-12 flex items-center justify-between px-5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>
            <RefreshCw size={13} />
          </div>
          <span className="text-sm font-semibold text-text-primary">留存</span>
          {isInConversation && viewMode === 'chat' && (
            <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ml-1" style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />留存专家
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
          {([
            { mode: 'dashboard' as ViewMode, icon: <LayoutGrid size={12} />, label: '工作台' },
            { mode: 'chat' as ViewMode,      icon: <MessageSquare size={12} />, label: '对话' },
          ] as const).map(({ mode, icon, label }) => (
            <button key={mode} onClick={() => { if (mode === 'chat') handleEnterChat({ agent: 'retention' }); else setViewMode(mode); }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${viewMode === mode ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
              {icon}<span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {viewMode === 'dashboard' ? (
            <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <Dashboard onChatClick={() => handleEnterChat({ agent: 'retention' })} />
            </motion.div>
          ) : (
            <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <AgentChatPage
                config={{
                  type: 'retention',
                  apiPath: '/api/overseas/agents/retention/chat',
                  color: '#16a34a',
                  bg: 'rgba(22,163,74,0.1)',
                  icon: <RefreshCw size={13} />,
                  name: '留存专家',
                  tagline: '老客画像 · 生命周期唤醒 · 行动建议',
                  suggestions: [
                    '找出过去60天没有复购的中东老客',
                    '斋月前我应该怎么唤醒沉默客户？',
                    '根据老客偏好推荐适合加推的新品',
                    '帮我写一条越南老客复购提醒消息',
                  ],
                }}
                onEnterConversation={handleEnterChat}
                onLeaveConversation={handleLeave}
                isInConversation={isInConversation}
                restoreKey={restore?.key}
                restoreMessages={restore?.messages}
                kickoff={kickoff}
                onAction={onAction}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
