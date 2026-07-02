import { useState, useEffect, useRef } from 'react';
import {
  RefreshCw, LayoutGrid, MessageSquare, Users, TrendingUp, Sparkles, Bell,
  Send, CheckCircle2, ChevronLeft, Bot, User, Package, Plus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AgentChatPage from './AgentChatPage';
import type { ConversationContext, RestoreSignal, KickoffSignal, AgentAction } from '../App';

type ViewMode = 'dashboard' | 'chat' | 'customer-chat';

interface Props {
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation: () => void;
  isInConversation: boolean;
  restore?: RestoreSignal;
  kickoff?: KickoffSignal;
  onAction?: AgentAction;
  onSessionRefresh?: () => void;
}

interface RetentionCustomer {
  id: string;
  buyer: string;
  country: string;
  segment: string;
  lastOrder: string;
  lastFollowupMins: number;
  product: string;
  suggest: string;
  orders: number;
  amount: string;
  stage: string;
}

const SEGMENTS = [
  { label: '高价值老客', count: 87,  desc: '客单价 > $500，近90天活跃', color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
  { label: '30天沉默',   count: 47,  desc: '距上次采购30-60天',          color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  { label: '60天沉默',   count: 18,  desc: '距上次采购60-90天',          color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
  { label: '待推品客户', count: 124, desc: '历史偏好与新品匹配',          color: '#4f46e5', bg: 'rgba(79,70,229,0.08)' },
];

const RETENTION_CUSTOMERS: RetentionCustomer[] = [
  { id: 'r1', buyer: 'Khalid Mohammed', country: '🇸🇦', segment: '60天沉默', lastOrder: '68天前', lastFollowupMins: 35, product: '假发', suggest: '新款棕色直发14寸', orders: 3, amount: '$3,420', stage: '二销' },
  { id: 'r2', buyer: 'Linh Nguyen',     country: '🇻🇳', segment: '30天沉默', lastOrder: '45天前', lastFollowupMins: 12, product: '发饰', suggest: '春季新款发箍套装', orders: 2, amount: '$860',   stage: '首购' },
  { id: 'r3', buyer: 'Carlos Rivera',   country: '🇲🇽', segment: '30天沉默', lastOrder: '55天前', lastFollowupMins: 80, product: '艾灸贴', suggest: '升级版热敷贴',     orders: 4, amount: '$1,960', stage: '三销' },
  { id: 'r4', buyer: 'Aisha Khan',      country: '🇦🇪', segment: '高价值老客', lastOrder: '18天前', lastFollowupMins: 18, product: '香皂礼盒', suggest: '节日香氛礼盒',   orders: 9, amount: '$7,800', stage: '三销' },
  { id: 'r5', buyer: 'Emma Wilson',     country: '🇬🇧', segment: '高价值老客', lastOrder: '9天前',  lastFollowupMins: 6,  product: '义乌小商品', suggest: '新品混合样品箱', orders: 12, amount: '$9,240', stage: '三销' },
  { id: 'r6', buyer: 'Noor Ahmed',      country: '🇶🇦', segment: '待推品客户', lastOrder: '22天前', lastFollowupMins: 28, product: '美妆套装', suggest: '旅行装护肤套装', orders: 5, amount: '$2,620', stage: '二销' },
  { id: 'r7', buyer: 'Pablo Santos',    country: '🇧🇷', segment: '待推品客户', lastOrder: '31天前', lastFollowupMins: 96, product: '收纳用品', suggest: '直播热卖收纳组', orders: 2, amount: '$740',   stage: '首购' },
  { id: 'r8', buyer: 'Mina Park',       country: '🇰🇷', segment: '60天沉默', lastOrder: '72天前', lastFollowupMins: 55, product: '饰品', suggest: '夏季项链套装',       orders: 3, amount: '$1,120', stage: '二销' },
];

const EVENTS = [
  { label: '斋月开始',   date: '2026-02-27', days: 61,  color: '#d97706' },
  { label: '母亲节',     date: '2026-05-10', days: 153, color: '#ec4899' },
  { label: '黑色星期五', date: '2026-11-27', days: 354, color: '#dc2626' },
];

const STAGE_SEQUENCE = ['首购', '二销', '三销', '四销', '五销', '六销', '七销', '八销', '九销', '十销'];

function customerThread(customer: RetentionCustomer) {
  return [
    { role: 'buyer' as const, time: '昨天 16:20', content: `Hi, we bought ${customer.product} before. Do you have any new options?`, zh: `客户曾采购${customer.product}，询问是否有新品` },
    { role: 'seller' as const, time: '昨天 16:23', content: `Yes, we prepared ${customer.suggest} for your market. I can send a bundle offer today.`, byAi: true, zh: `已推荐${customer.suggest}，准备组合报价` },
    { role: 'buyer' as const, time: '今天 09:10', content: 'Please send details and delivery time.', zh: '客户要求发送详情和交期' },
  ];
}

function followupText(mins: number) {
  if (mins < 60) return `${mins}分钟前`;
  return `${Math.floor(mins / 60)}小时前`;
}

function Dashboard({
  onChatClick,
  onCustomerClick,
}: {
  onChatClick: () => void;
  onCustomerClick: (id: string) => void;
}) {
  const [created, setCreated] = useState<Record<string, boolean>>({});
  const [activeSegment, setActiveSegment] = useState(SEGMENTS[0].label);
  const segmentCustomers = RETENTION_CUSTOMERS
    .filter(c => c.segment === activeSegment)
    .sort((a, b) => a.lastFollowupMins - b.lastFollowupMins);
  const orders = [...RETENTION_CUSTOMERS].sort((a, b) => b.orders - a.orders).slice(0, 5);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-5 space-y-5">
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: '老客总数', value: '632', icon: <Users size={14} />, color: '#16a34a' },
            { label: '本月复购率', value: '34%', icon: <TrendingUp size={14} />, color: '#4f46e5' },
            { label: '待唤醒', value: '65', icon: <Bell size={14} />, color: '#d97706' },
            { label: '推品命中率', value: '78%', icon: <Sparkles size={14} />, color: '#0891b2' },
          ].map(s => (
            <div key={s.label} className="card p-4">
              <div className="flex items-center gap-1.5 mb-2" style={{ color: s.color }}>{s.icon}<span className="text-[11px] font-medium text-text-muted">{s.label}</span></div>
              <p className="text-2xl font-bold font-display text-text-primary">{s.value}</p>
            </div>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-text-primary">客户分层</p>
            <button
              data-demo-target="retention_prompt"
              onClick={onChatClick}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg text-white transition-all"
              style={{ background: '#16a34a' }}>
              <RefreshCw size={12} />让 留存专家 制定策略
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {SEGMENTS.map(seg => {
              const selected = activeSegment === seg.label;
              return (
                <button key={seg.label} onClick={() => setActiveSegment(seg.label)}
                  className={`card p-4 flex items-start gap-3 text-left transition-all ${selected ? 'ring-2 ring-offset-0' : 'hover:border-border-bright'}`}
                  style={selected ? { boxShadow: `0 0 0 2px ${seg.color}22`, borderColor: `${seg.color}55` } : undefined}>
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
                </button>
              );
            })}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <p className="text-sm font-semibold text-text-primary">{activeSegment} · 客户列表</p>
            <p className="text-[11px] text-text-muted">按近期跟进时间排序</p>
          </div>
          <div className="divide-y divide-border">
            {segmentCustomers.map(c => (
              <button key={c.id} onClick={() => onCustomerClick(c.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors">
                <div className="w-9 h-9 rounded-full bg-surface-2 border border-border flex items-center justify-center text-sm flex-shrink-0">{c.country}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary">{c.buyer}</p>
                  <p className="text-xs text-text-muted">上次购：{c.product} · {c.lastOrder}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[11px] text-text-muted">最近跟进</p>
                  <p className="text-xs font-semibold text-text-secondary">{followupText(c.lastFollowupMins)}</p>
                </div>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(22,163,74,0.08)', color: '#16a34a' }}>{c.stage}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Package size={14} style={{ color: '#16a34a' }} />
            <p className="text-sm font-semibold text-text-primary">订单管理</p>
          </div>
          <div className="divide-y divide-border">
            {orders.map(c => (
              <div key={c.id} className="grid grid-cols-[1.2fr_1fr_.8fr_.8fr_1.2fr] gap-3 px-4 py-3 items-center">
                <p className="text-sm font-medium text-text-primary truncate">{c.buyer}</p>
                <p className="text-xs text-text-secondary truncate">{c.product} · {c.lastOrder}</p>
                <p className="text-xs text-text-muted">{c.orders} 单</p>
                <p className="text-xs font-semibold text-text-primary">{c.amount}</p>
                <p className="text-xs text-text-secondary truncate">{c.suggest}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold text-text-primary">唤醒建议 · 今日优先</p>
          </div>
          <div className="divide-y divide-border">
            {RETENTION_CUSTOMERS.slice(0, 3).map(r => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors">
                <div className="w-8 h-8 rounded-full bg-surface-2 border border-border flex items-center justify-center text-sm flex-shrink-0">{r.country}</div>
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

function RetentionCustomerChatView({
  selectedId,
  onSelectCustomer,
  onBack,
  onLeaveConversation,
}: {
  selectedId: string;
  onSelectCustomer: (id: string) => void;
  onBack: () => void;
  onLeaveConversation: () => void;
}) {
  const [stageOptions, setStageOptions] = useState(STAGE_SEQUENCE.slice(0, 3));
  const [stageByCustomer, setStageByCustomer] = useState<Record<string, string>>(
    Object.fromEntries(RETENTION_CUSTOMERS.map(c => [c.id, c.stage]))
  );
  const [humanInput, setHumanInput] = useState('');
  const [sentMessages, setSentMessages] = useState<ReturnType<typeof customerThread>>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const customers = [...RETENTION_CUSTOMERS].sort((a, b) => a.lastFollowupMins - b.lastFollowupMins);
  const customer = RETENTION_CUSTOMERS.find(c => c.id === selectedId) ?? RETENTION_CUSTOMERS[0];
  const thread = [...customerThread(customer), ...sentMessages];
  const currentStage = stageByCustomer[selectedId] ?? '首购';

  useEffect(() => {
    setHumanInput('');
    setSentMessages([]);
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = () => {
    const text = humanInput.trim();
    if (!text) return;
    setSentMessages(prev => [...prev, {
      role: 'seller',
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      content: text,
      byAi: false,
      zh: '已记录本次人工跟进，并同步更新客户近期跟进时间',
    }]);
    setHumanInput('');
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  const addNextStage = () => {
    setStageOptions(prev => {
      const next = STAGE_SEQUENCE[prev.length] ?? `${prev.length + 1}销`;
      return prev.includes(next) ? prev : [...prev, next];
    });
  };

  const handleBack = () => {
    onLeaveConversation();
    onBack();
  };

  return (
    <div className="flex h-full">
      <div className="w-56 border-r border-border flex flex-col flex-shrink-0">
        <div className="px-3 py-2.5 border-b border-border">
          <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">老客列表</p>
          <p className="text-[11px] text-text-muted mt-1">按最近跟进排序</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {customers.map(c => (
            <button key={c.id} onClick={() => onSelectCustomer(c.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-l-2 ${
                c.id === selectedId ? 'bg-surface-2 border-l-[#16a34a]' : 'hover:bg-surface-2 border-l-transparent'
              }`}>
              <span className="text-base leading-none">{c.country}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-text-primary truncate">{c.buyer}</p>
                <p className="text-[10px] text-text-muted truncate mt-0.5">{followupText(c.lastFollowupMins)} · {c.segment}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-12 flex items-center justify-between px-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <button onClick={handleBack} className="p-1 rounded-md hover:bg-surface-2 text-text-muted transition-colors flex-shrink-0">
              <ChevronLeft size={16} />
            </button>
            <span className="text-base leading-none">{customer.country}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary leading-none truncate">{customer.buyer}</p>
              <p className="text-[10px] text-text-muted mt-0.5 truncate">{customer.product} · {customer.amount}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(22,163,74,0.08)', color: '#16a34a' }}>
            <Bot size={11} />留存专家辅助
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {thread.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === 'seller' ? 'flex-row-reverse' : ''}`}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm mt-0.5"
                style={{ background: msg.role === 'buyer' ? 'rgba(107,114,128,0.12)' : msg.byAi ? 'rgba(22,163,74,0.15)' : 'rgba(107,114,128,0.15)' }}>
                {msg.role === 'buyer' ? customer.country : msg.byAi ? <Bot size={13} style={{ color: '#16a34a' }} /> : <User size={13} style={{ color: '#6b7280' }} />}
              </div>
              <div className="max-w-[72%]">
                <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'buyer' ? 'bg-surface-2 border border-border text-text-primary rounded-tl-sm' : 'text-white rounded-tr-sm'
                }`} style={msg.role === 'seller' ? { background: msg.byAi ? '#16a34a' : '#374151' } : {}}>
                  {msg.content}
                </div>
                <div className={`flex items-center gap-1.5 mt-1 px-1 ${msg.role === 'seller' ? 'flex-row-reverse' : ''}`}>
                  <span className="text-[10px] text-text-muted">{msg.time}</span>
                  {msg.byAi && msg.role === 'seller' && (
                    <span className="flex items-center gap-0.5 text-[10px]" style={{ color: '#16a34a' }}>
                      <Sparkles size={9} />AI 推荐
                    </span>
                  )}
                </div>
                {msg.zh && <p className={`text-[10px] leading-relaxed text-text-muted mt-1 px-1 ${msg.role === 'seller' ? 'text-right' : ''}`}>中：{msg.zh}</p>}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="px-4 pb-4 pt-2 flex-shrink-0">
          <div className="rounded-2xl border border-border bg-surface-2 overflow-hidden focus-within:border-border-bright transition-colors">
            <textarea
              value={humanInput}
              onChange={e => setHumanInput(e.target.value)}
              placeholder="输入跟进消息..."
              rows={2}
              className="w-full px-4 pt-3 pb-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted resize-none outline-none" />
            <div className="flex items-center justify-between px-3 pb-3 pt-1">
              <span className="text-[11px] text-text-muted">推荐推品：{customer.suggest}</span>
              <button onClick={handleSend} disabled={!humanInput.trim()}
                className="w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-40"
                style={{ background: '#16a34a', boxShadow: '0 2px 8px rgba(22,163,74,0.3)' }}>
                <Send size={13} className="text-white" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="w-60 border-l border-border bg-surface flex-shrink-0 px-4 py-4 overflow-y-auto">
        <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-2">复购阶段</p>
        <div className="rounded-2xl border border-border bg-surface-2 p-3 mb-4">
          <p className="text-sm font-semibold text-text-primary">{customer.buyer}</p>
          <p className="text-xs text-text-muted mt-1">最近跟进 {followupText(customer.lastFollowupMins)}</p>
          <p className="text-xl font-bold font-display mt-3" style={{ color: '#16a34a' }}>{currentStage}</p>
        </div>
        <div className="space-y-2">
          {stageOptions.map((stage, idx) => {
            const active = stage === currentStage;
            return (
              <button key={stage} onClick={() => setStageByCustomer(prev => ({ ...prev, [selectedId]: stage }))}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                  active ? 'border-[#16a34a] bg-[#16a34a]/10 text-text-primary' : 'border-border hover:border-border-bright text-text-secondary'
                }`}>
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{ background: active ? '#16a34a' : 'rgba(107,114,128,0.12)', color: active ? '#fff' : '#6b7280' }}>
                  {idx + 1}
                </span>
                <span className="text-sm font-semibold">{stage}</span>
              </button>
            );
          })}
          <button onClick={addNextStage}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-border hover:border-border-bright text-xs font-semibold text-text-muted hover:text-text-secondary transition-all">
            <Plus size={12} />添加下一阶段
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RetentionPage({ onEnterConversation, onLeaveConversation, isInConversation, restore, kickoff, onAction, onSessionRefresh }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [selectedCustomerId, setSelectedCustomerId] = useState(RETENTION_CUSTOMERS[0].id);

  useEffect(() => { if (restore) setViewMode('chat'); }, [restore?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (kickoff) setViewMode('chat'); }, [kickoff?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCustomerChat = (id: string) => {
    setSelectedCustomerId(id);
    setViewMode('customer-chat');
  };

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
      {viewMode !== 'customer-chat' && (
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
              { mode: 'chat' as ViewMode, icon: <MessageSquare size={12} />, label: '对话' },
            ] as const).map(({ mode, icon, label }) => (
              <button key={mode} onClick={() => { if (mode === 'chat') handleEnterChat({ agent: 'retention' }); else setViewMode(mode); }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${viewMode === mode ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}>
                {icon}<span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {viewMode === 'dashboard' && (
            <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <Dashboard onChatClick={() => handleEnterChat({ agent: 'retention' })} onCustomerClick={openCustomerChat} />
            </motion.div>
          )}
          {viewMode === 'chat' && (
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
                    '老客唤醒策略',
                    '复购加推组合',
                    '节前触达节奏',
                    '复购消息模板',
                  ],
                }}
                onEnterConversation={handleEnterChat}
                onLeaveConversation={handleLeave}
                isInConversation={isInConversation}
                restoreKey={restore?.key}
                restoreMessages={restore?.messages}
                kickoff={kickoff}
                onAction={onAction}
                onSessionRefresh={onSessionRefresh}
              />
            </motion.div>
          )}
          {viewMode === 'customer-chat' && (
            <motion.div key="customer-chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <RetentionCustomerChatView
                selectedId={selectedCustomerId}
                onSelectCustomer={setSelectedCustomerId}
                onBack={() => setViewMode('dashboard')}
                onLeaveConversation={onLeaveConversation}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
