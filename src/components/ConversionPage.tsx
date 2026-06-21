import { useState } from 'react';
import { MessageSquare, LayoutGrid, AlertTriangle, Clock, TrendingUp, CheckCircle2, Circle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AgentChatPage from './AgentChatPage';
import type { ConversationContext } from '../App';

type ViewMode = 'dashboard' | 'chat';

interface Props {
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation: () => void;
  isInConversation: boolean;
}

const INQUIRIES = [
  { id: '1', buyer: 'Ahmed Al-Rashid', country: '🇸🇦', product: '假发定制 500件', amount: '$2,400', status: 'hot', time: '10分钟前', lang: 'AR' },
  { id: '2', buyer: 'Maria Santos',    country: '🇧🇷', product: '艾灸贴 200件',   amount: '$380',  status: 'pending', time: '1小时前',  lang: 'ES' },
  { id: '3', buyer: 'John Thompson',  country: '🇺🇸', product: '义乌小商品样品',  amount: '$120',  status: 'replied', time: '3小时前',  lang: 'EN' },
  { id: '4', buyer: 'Fatima Hassan',  country: '🇦🇪', product: '香皂礼盒 1000套', amount: '$1,800', status: 'hot', time: '昨天',     lang: 'AR' },
  { id: '5', buyer: 'Nguyen Van A',   country: '🇻🇳', product: '发饰批发',        amount: '$260',  status: 'pending', time: '昨天',     lang: 'EN' },
];

const STATUS_META = {
  hot:     { label: '⚠️ 大单', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  pending: { label: '待回复',  color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  replied: { label: '已回复',  color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
};

const TASKS = [
  { label: '回复 Ahmed 假发定制询盘（大单）', done: false, urgent: true },
  { label: '发送 Maria 艾灸贴报价单', done: false, urgent: false },
  { label: '跟进 John 样品寄送进度', done: true,  urgent: false },
  { label: '更新 WhatsApp 阿语话术模板', done: true,  urgent: false },
];

function Dashboard({ onChatClick }: { onChatClick: () => void }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-5 space-y-5">

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: '今日询盘', value: '23', icon: <MessageSquare size={14} />, color: '#0891b2' },
            { label: '待回复',   value: '5',  icon: <Clock size={14} />,         color: '#d97706' },
            { label: '转报价率', value: '35%', icon: <TrendingUp size={14} />,   color: '#16a34a' },
            { label: '⚠️ 大单预警', value: '2', icon: <AlertTriangle size={14} />, color: '#dc2626' },
          ].map(s => (
            <div key={s.label} className="card p-4">
              <div className="flex items-center gap-1.5 mb-2" style={{ color: s.color }}>{s.icon}<span className="text-[11px] font-medium text-text-muted">{s.label}</span></div>
              <p className="text-2xl font-bold font-display text-text-primary">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Inquiry list */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold text-text-primary">近期询盘</p>
            <button onClick={onChatClick}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all text-white"
              style={{ background: '#0891b2' }}>
              <MessageSquare size={12} />让客服 Agent 回复
            </button>
          </div>
          <div className="divide-y divide-border">
            {INQUIRIES.map(inq => {
              const st = STATUS_META[inq.status as keyof typeof STATUS_META];
              return (
                <div key={inq.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-surface-2 border border-border flex items-center justify-center text-sm flex-shrink-0">
                    {inq.country}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-text-primary truncate">{inq.buyer}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-surface-2 border border-border text-text-muted">{inq.lang}</span>
                    </div>
                    <p className="text-xs text-text-muted truncate">{inq.product}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-text-primary">{inq.amount}</p>
                    <p className="text-[10px] text-text-muted">{inq.time}</p>
                  </div>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: st.bg, color: st.color }}>
                    {st.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Task list */}
        <div className="card p-4">
          <p className="text-sm font-semibold text-text-primary mb-3">今日待办</p>
          <div className="space-y-2">
            {TASKS.map((t, i) => (
              <div key={i} className="flex items-center gap-2.5">
                {t.done ? <CheckCircle2 size={15} className="text-accent flex-shrink-0" /> : <Circle size={15} className="text-text-muted flex-shrink-0" />}
                <span className={`text-sm flex-1 ${t.done ? 'text-text-muted line-through' : 'text-text-secondary'}`}>{t.label}</span>
                {t.urgent && !t.done && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}>紧急</span>}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

export default function ConversionPage({ onEnterConversation, onLeaveConversation, isInConversation }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');

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
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-5 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(8,145,178,0.1)', color: '#0891b2' }}>
            <MessageSquare size={13} />
          </div>
          <span className="text-sm font-semibold text-text-primary">转化</span>
          {isInConversation && viewMode === 'chat' && (
            <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ml-1" style={{ background: 'rgba(8,145,178,0.1)', color: '#0891b2' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />客服 Agent
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
          {([
            { mode: 'dashboard' as ViewMode, icon: <LayoutGrid size={12} />, label: '工作台' },
            { mode: 'chat' as ViewMode,      icon: <MessageSquare size={12} />, label: '对话' },
          ] as const).map(({ mode, icon, label }) => (
            <button key={mode} onClick={() => { if (mode === 'chat') handleEnterChat({ agent: 'conversion' }); else setViewMode(mode); }}
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
              <Dashboard onChatClick={() => handleEnterChat({ agent: 'conversion' })} />
            </motion.div>
          ) : (
            <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <AgentChatPage
                config={{
                  type: 'conversion',
                  apiPath: '/api/overseas/agents/conversion/chat',
                  color: '#0891b2',
                  bg: 'rgba(8,145,178,0.1)',
                  icon: <MessageSquare size={13} />,
                  name: '客服 Agent',
                  tagline: '多语种 24/7 · 大单预警 · AI+人工切换',
                  suggestions: [
                    '帮我写一段阿拉伯语的产品询盘回复模板',
                    '有买家问能不能做500件定制，怎么跟进？',
                    '分析本月询盘转化率低的原因',
                    '生成英文WhatsApp跟单话术（3天未回复）',
                  ],
                }}
                onEnterConversation={handleEnterChat}
                onLeaveConversation={handleLeave}
                isInConversation={isInConversation}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
