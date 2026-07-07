import { useEffect, useMemo, useState } from 'react';
import {
  Bot, CalendarClock, CheckCircle2, ChevronLeft, Clock,
  FileText, Languages, MessageSquare, Mic, Phone, RefreshCw, Search, Send,
  Sparkles, StickyNote, Users,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { AgentAction, ConversationContext, KickoffSignal, RestoreSignal } from '../App';

type CustomerView = 'all' | 'leads' | 'won' | 'silent';
type CustomerStage = '潜客' | '询盘中' | '已报价' | '成交' | '沉默30' | '沉默60';
type AutomationLevel = 'auto' | 'confirm' | 'manual';
type TimelineEventType = 'whatsapp' | 'ai' | 'call' | 'note' | 'quote' | 'task';

interface Props {
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation: () => void;
  isInConversation: boolean;
  restore?: RestoreSignal;
  kickoff?: KickoffSignal;
  onAction?: AgentAction;
  onSessionRefresh?: () => void;
}

interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  actor: 'buyer' | 'seller' | 'ai' | 'owner';
  title: string;
  body: string;
  time: string;
}

interface CustomerProfile {
  id: string;
  name: string;
  country: string;
  countryName: string;
  language: string;
  timezone: string;
  localTime: string;
  source: string;
  product: string;
  estimatedValue: string;
  stage: CustomerStage;
  intentScore: number;
  intentSignals: string[];
  automation: AutomationLevel;
  priority: number;
  inboxReason?: 'call' | 'large' | 'draft' | 'overdue' | 'reply';
  lastActive: string;
  lastOrder?: string;
  orderHistory: string[];
  tags: string[];
  summary: string;
  nextStep: string;
  sla?: string;
  timeline: TimelineEvent[];
}

const STAGE_META: Record<CustomerStage, { color: string; bg: string }> = {
  潜客: { color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  询盘中: { color: '#4f46e5', bg: 'rgba(79,70,229,0.08)' },
  已报价: { color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  成交: { color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
  沉默30: { color: '#ca8a04', bg: 'rgba(202,138,4,0.08)' },
  沉默60: { color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
};

const AUTOMATION_META: Record<AutomationLevel, { label: string; desc: string; color: string; bg: string }> = {
  auto: { label: 'AI 自动回', desc: '低风险潜客，自动首响和目录跟进', color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
  confirm: { label: '草稿待确认', desc: '中高意向，AI 出草稿，人点发送', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  manual: { label: '老板接管', desc: '高价值/想通话，停止自动回复', color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
};

const CUSTOMERS: CustomerProfile[] = [
  {
    id: 'c1',
    name: 'Ahmed Al-Rashid',
    country: '🇸🇦',
    countryName: '沙特',
    language: 'English / Arabic',
    timezone: 'Asia/Riyadh',
    localTime: '15:20',
    source: 'WhatsApp',
    product: '假发定制 500件',
    estimatedValue: '$2,400',
    stage: '询盘中',
    intentScore: 96,
    intentSignals: ['问价格 +2', '问MOQ/船期 +3', '明确500件 +4', '想通电话 +6'],
    automation: 'manual',
    priority: 100,
    inboxReason: 'call',
    lastActive: '10分钟前',
    orderHistory: ['2025-11 样品单 $180'],
    tags: ['大单', 'OEM', '中东', '想通电话'],
    summary: '询问500件起订价，关心船期，态度积极，要求和经理语音沟通。',
    nextStep: '立即确认可通话时间，老板接管报价。',
    sla: '1小时45分后升级提醒',
    timeline: [
      { id: '1', type: 'whatsapp', actor: 'buyer', title: '客户消息', body: 'Can we talk with your manager today? I need 500 pcs custom hair wigs.', time: '10:15' },
      { id: '2', type: 'ai', actor: 'ai', title: 'AI 熔断', body: '识别 call_request，已停止自动回复，只发送预约时间确认。', time: '10:16' },
      { id: '3', type: 'whatsapp', actor: 'seller', title: '稳单确认', body: 'Our manager will call you shortly. What time works best for you?', time: '10:16' },
    ],
  },
  {
    id: 'c2',
    name: 'Fatima Hassan',
    country: '🇦🇪',
    countryName: '阿联酋',
    language: 'Arabic',
    timezone: 'Asia/Dubai',
    localTime: '16:20',
    source: 'WhatsApp',
    product: '香皂礼盒 1000套',
    estimatedValue: '$1,800',
    stage: '已报价',
    intentScore: 91,
    intentSignals: ['问价格 +2', '明确数量 +3', '节日前采购 +2', '要求设计目录 +2'],
    automation: 'confirm',
    priority: 88,
    inboxReason: 'large',
    lastActive: '45分钟前',
    orderHistory: ['2025-09 礼盒试单 $420'],
    tags: ['大单预警', '阿语', '礼盒', '已报价'],
    summary: '1000套香皂礼盒，已给初步报价，等待确认LOGO和包装方案。',
    nextStep: '发送阿语报价单和三套包装图。',
    sla: '45分钟未回',
    timeline: [
      { id: '1', type: 'whatsapp', actor: 'buyer', title: '客户询价', body: 'أريد طلب 1000 مجموعة من صناديق الصابون. ما هو أفضل سعر؟', time: '昨天 16:00' },
      { id: '2', type: 'quote', actor: 'seller', title: '报价草稿', body: '$1.80/套，含定制LOGO包装，交期18天。', time: '昨天 16:02' },
    ],
  },
  {
    id: 'c3',
    name: 'Maria Santos',
    country: '🇧🇷',
    countryName: '巴西',
    language: 'Spanish',
    timezone: 'America/Sao_Paulo',
    localTime: '10:20',
    source: '站内 DM',
    product: '艾灸贴 200件',
    estimatedValue: '$380',
    stage: '潜客',
    intentScore: 74,
    intentSignals: ['问价格 +2', '问样品 +2', '数量偏小 +1'],
    automation: 'confirm',
    priority: 62,
    inboxReason: 'draft',
    lastActive: '1小时前',
    orderHistory: [],
    tags: ['样品', '西语', '可培育'],
    summary: '小批量试单，适合走样品政策和复购培育。',
    nextStep: '确认收货地址，发送样品政策。',
    timeline: [
      { id: '1', type: 'whatsapp', actor: 'buyer', title: '客户询价', body: 'Me interesa el parche de moxibustión, 200 piezas. ¿Cuál es el precio unitario?', time: '昨天 14:30' },
      { id: '2', type: 'ai', actor: 'ai', title: 'AI 草稿', body: '建议发送样品政策，询问收货地址。', time: '昨天 14:31' },
    ],
  },
  {
    id: 'c4',
    name: 'John Thompson',
    country: '🇺🇸',
    countryName: '美国',
    language: 'English',
    timezone: 'America/New_York',
    localTime: '09:20',
    source: 'Alibaba',
    product: '义乌小商品样品盒',
    estimatedValue: '$120',
    stage: '成交',
    intentScore: 82,
    intentSignals: ['给收货地址 +5', '确认样品 +2', '接受标准运输 +1'],
    automation: 'confirm',
    priority: 45,
    lastActive: '3小时前',
    lastOrder: '样品盒 $120',
    orderHistory: ['2026-07 样品盒 $120'],
    tags: ['已下单', '样品', '待寄样'],
    summary: '已确认样品盒和标准运输，等待寄样单号。',
    nextStep: '同步仓库寄样，三天后提醒查收。',
    timeline: [
      { id: '1', type: 'whatsapp', actor: 'buyer', title: '确认订单', body: 'Curated selection sounds great. Standard shipping is fine.', time: '今天 08:45' },
      { id: '2', type: 'task', actor: 'ai', title: '自动跟进任务', body: '创建寄样跟进任务，2个工作日内发送单号。', time: '今天 08:46' },
    ],
  },
  {
    id: 'c5',
    name: 'Khalid Mohammed',
    country: '🇸🇦',
    countryName: '沙特',
    language: 'Arabic',
    timezone: 'Asia/Riyadh',
    localTime: '15:20',
    source: 'WhatsApp',
    product: '新款棕色直发14寸',
    estimatedValue: '$3,600',
    stage: '沉默60',
    intentScore: 89,
    intentSignals: ['历史大额采购 +4', '68天未互动', '新品匹配度高 +2'],
    automation: 'confirm',
    priority: 70,
    inboxReason: 'reply',
    lastActive: '68天未互动',
    lastOrder: '直发批量单 $3,600',
    orderHistory: ['2026-03 直发批量单 $3,600', '2025-12 补货 $1,900'],
    tags: ['高价值老客', '沉默60', '新品可唤醒'],
    summary: '高价值老客，历史采购直发类目，适合用新品目录和老客价唤醒。',
    nextStep: '发新品目录 + 老客价，若回复则流回询盘中。',
    timeline: [
      { id: '1', type: 'note', actor: 'owner', title: '历史偏好', body: '偏好自然黑/棕色直发，关注现货和补货速度。', time: '68天前' },
      { id: '2', type: 'task', actor: 'ai', title: '沉默雷达', body: '进入沉默60状态，建议触达新品目录。', time: '今天 09:00' },
    ],
  },
  {
    id: 'c6',
    name: 'Nguyen Van A',
    country: '🇻🇳',
    countryName: '越南',
    language: 'English',
    timezone: 'Asia/Ho_Chi_Minh',
    localTime: '19:20',
    source: 'Instagram',
    product: '发饰批发',
    estimatedValue: '$260',
    stage: '潜客',
    intentScore: 46,
    intentSignals: ['只问目录 +1', '未给数量 +0', '社媒来源 +1'],
    automation: 'auto',
    priority: 30,
    inboxReason: 'reply',
    lastActive: '昨天',
    orderHistory: [],
    tags: ['低分潜客', '自动回复', '目录'],
    summary: '只问产品目录，暂未表现明确采购意图，AI 自动发送目录并追踪点击。',
    nextStep: '自动发送目录，若点击高价款再转人工。',
    timeline: [
      { id: '1', type: 'whatsapp', actor: 'buyer', title: '客户消息', body: 'Hi, interested in wholesale hair accessories. What collections do you have?', time: '昨天 11:00' },
      { id: '2', type: 'ai', actor: 'ai', title: '自动首响', body: '已自动发送发饰目录和50件混款批发包。', time: '昨天 11:01' },
    ],
  },
];

const VIEW_META: Record<CustomerView, { label: string; desc: string }> = {
  all: { label: '全部', desc: '按姓名、渠道、产品搜索客户' },
  leads: { label: '潜客', desc: '新询盘和未成交客户' },
  won: { label: '成交', desc: '已下单客户和跟单任务' },
  silent: { label: '沉默', desc: '30/60天雷达和唤醒对象' },
};

function reasonLabel(reason?: CustomerProfile['inboxReason']) {
  if (reason === 'call') return { label: '⚡ 想通电话', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' };
  if (reason === 'large') return { label: '大单预警', color: '#d97706', bg: 'rgba(217,119,6,0.1)' };
  if (reason === 'draft') return { label: 'AI草稿待确认', color: '#4f46e5', bg: 'rgba(79,70,229,0.1)' };
  if (reason === 'overdue') return { label: '45分钟未回', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' };
  return { label: '待回复', color: '#0891b2', bg: 'rgba(8,145,178,0.1)' };
}

function filterCustomers(view: CustomerView) {
  if (view === 'all') return CUSTOMERS.slice().sort((a, b) => b.priority - a.priority);
  if (view === 'leads') return CUSTOMERS.filter(c => c.stage === '潜客' || c.stage === '询盘中' || c.stage === '已报价').sort((a, b) => b.intentScore - a.intentScore);
  if (view === 'won') return CUSTOMERS.filter(c => c.stage === '成交');
  return CUSTOMERS.filter(c => c.stage === '沉默30' || c.stage === '沉默60').sort((a, b) => b.intentScore - a.intentScore);
}

function taskTitle(customer: CustomerProfile) {
  if (customer.inboxReason === 'call') return `想通电话的 ${customer.name.split(' ')[0]}`;
  if (customer.inboxReason === 'large') return `${customer.name.split(' ')[0]} 的大单要盯一下`;
  if (customer.inboxReason === 'draft') return `${customer.name.split(' ')[0]} 的报价草稿好了`;
  if (customer.stage === '沉默60' || customer.stage === '沉默30') return `老客户 ${customer.name.split(' ')[0]} ${customer.lastActive}`;
  return `${customer.name.split(' ')[0]} 等你回复`;
}

function taskActionLabel(customer: CustomerProfile) {
  if (customer.inboxReason === 'call') return '查看简报，去回电';
  if (customer.inboxReason === 'large') return '看一眼，发送报价';
  if (customer.inboxReason === 'draft') return '看一眼，发送';
  if (customer.stage === '沉默60' || customer.stage === '沉默30') return '发这条唤醒消息';
  return '查看并处理';
}

function draftForCustomer(customer: CustomerProfile) {
  if (customer.inboxReason === 'call') return 'Our manager will call you shortly. What time works best for you?';
  if (customer.stage === '沉默60' || customer.stage === '沉默30') return `Hi ${customer.name.split(' ')[0]}, we have new arrivals matching your previous order. Would you like me to send the updated catalog and old-customer price?`;
  if (customer.inboxReason === 'large') return 'Thanks for your interest. I prepared the quotation with packaging options and delivery time. Please check if the logo size and target delivery date are correct.';
  return 'Thanks for reaching out. Could you share your delivery country and expected quantity? I will prepare the best option for you.';
}

function openGlobalAssistant(customer: CustomerProfile, text?: string) {
  window.dispatchEvent(new CustomEvent('lingshu-assistant-open', {
    detail: {
      text,
      context: {
        agent: 'conversion',
        label: `我的客户 / ${customer.name}`,
        summary: `当前在客户详情页：${customer.name}，${customer.countryName}，语言${customer.language}，阶段${customer.stage}，意向分${customer.intentScore}，产品${customer.product}，预估单值${customer.estimatedValue}。客户摘要：${customer.summary}`,
        suggestions: ['生成下一条回复建议', '生成报价草稿', '翻译最近消息', '整理通话简报'],
      },
    },
  }));
}

function CustomerRow({ customer, selected, onOpen }: { customer: CustomerProfile; selected?: boolean; onOpen: () => void }) {
  const stage = STAGE_META[customer.stage];
  const automation = AUTOMATION_META[customer.automation];
  const reason = reasonLabel(customer.inboxReason);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-xl border px-4 py-3 text-left transition-all hover:border-slate-300 hover:bg-surface-2 ${selected ? 'border-[#0891b2] bg-[#0891b2]/5' : 'border-border bg-white'}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-lg">
          {customer.country}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-bold text-text-primary">{customer.name}</p>
            {customer.inboxReason && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: reason.color, background: reason.bg }}>
                {reason.label}
              </span>
            )}
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: stage.color, background: stage.bg }}>
              {customer.stage}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-text-muted">{customer.product} · {customer.estimatedValue} · {customer.source}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: automation.color, background: automation.bg }}>
              {automation.label}
            </span>
            <span className="text-[10px] font-bold text-text-muted">下一步：{customer.nextStep}</span>
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-xs font-semibold text-text-secondary">{customer.lastActive}</p>
          <p className="mt-1 text-[10px] text-text-muted">当地 {customer.localTime}</p>
        </div>
      </div>
    </button>
  );
}

function TaskQueueView({
  customers,
  doneCount,
  onOpen,
  onDone,
  onOpenAll,
}: {
  customers: CustomerProfile[];
  doneCount: number;
  onOpen: (id: string) => void;
  onDone: (id: string) => void;
  onOpenAll: () => void;
}) {
  const visible = customers.slice(0, 3);
  const later = Math.max(0, customers.length - visible.length);
  const autoHandled = 12 + CUSTOMERS.filter(customer => customer.automation === 'auto').length;
  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-2xl font-black font-display text-text-primary">
              {customers.length ? `今天有 ${customers.length} 件事要处理` : '都处理完了'}
            </p>
            <p className="mt-1 text-sm text-text-muted">
              {customers.length ? '我已经按紧急度排好，先处理最上面这张。' : '今天的客户红点已经清空。'}
            </p>
          </div>
          <button type="button" onClick={onOpenAll} className="rounded-xl border border-border bg-white px-4 py-2 text-sm font-bold text-text-secondary hover:bg-surface-2">
            全部客户
          </button>
        </div>

        {!customers.length ? (
          <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-border bg-white text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-50 text-green-700">
              <CheckCircle2 size={32} />
            </div>
            <p className="mt-4 text-xl font-black text-text-primary">都处理完了</p>
            <p className="mt-2 text-sm text-text-muted">新的 WhatsApp 询盘、报价草稿和沉默唤醒会自动排进这里。</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((customer, index) => {
              const reason = reasonLabel(customer.inboxReason);
              return (
                <motion.div
                  key={customer.id}
                  layout
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  className="rounded-2xl border border-border bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-surface-2 text-2xl">{customer.country}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-black" style={{ color: reason.color, background: reason.bg }}>
                          {reason.label}
                        </span>
                        <span className="text-[10px] font-bold text-text-muted">#{index + 1}</span>
                        <span className="text-[10px] font-bold text-text-muted">{customer.source} · 当地 {customer.localTime}</span>
                      </div>
                      <p className="mt-2 text-lg font-black text-text-primary">{taskTitle(customer)}</p>
                      <p className="mt-1 text-sm leading-relaxed text-text-muted">{customer.summary}</p>
                      <div className="mt-3 rounded-xl bg-surface px-3 py-2">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-text-secondary">
                          <Sparkles size={12} className="text-[#0891b2]" />AI 建议
                        </div>
                        <p className="mt-1 text-sm font-semibold text-text-primary">{customer.nextStep}</p>
                      </div>
                    </div>
                    <div className="flex w-40 flex-shrink-0 flex-col gap-2">
                      <button type="button" onClick={() => onOpen(customer.id)} className="rounded-xl bg-slate-950 px-3 py-2.5 text-sm font-black text-white">
                        {taskActionLabel(customer)}
                      </button>
                      <button type="button" onClick={() => onDone(customer.id)} className="rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-muted hover:bg-surface-2">
                        已处理
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
            {later > 0 && (
              <div className="rounded-xl border border-border bg-white px-4 py-3 text-sm font-bold text-text-muted">
                还有 {later} 件低优先级事项已放到稍后
              </div>
            )}
            <button type="button" onClick={onOpenAll} className="w-full rounded-xl border border-dashed border-border bg-white px-4 py-3 text-sm font-bold text-text-secondary hover:bg-surface-2">
              AI 已自动接待 {autoHandled} 条新咨询 ✓（点开看）
            </button>
            {doneCount > 0 && <p className="text-center text-xs font-semibold text-text-muted">已清掉 {doneCount} 件事</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function AllCustomersView({ view, query, selectedId, onViewChange, onQueryChange, onOpen, onBack }: {
  view: CustomerView;
  query: string;
  selectedId: string;
  onViewChange: (view: CustomerView) => void;
  onQueryChange: (value: string) => void;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const normalized = query.trim().toLowerCase();
  const list = filterCustomers(view).filter(customer => {
    if (!normalized) return true;
    return [customer.name, customer.product, customer.countryName, customer.source, customer.stage, ...customer.tags].join(' ').toLowerCase().includes(normalized);
  });
  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto max-w-5xl px-6 py-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-2 text-sm font-bold text-text-secondary">
            <ChevronLeft size={15} />返回今日队列
          </button>
          <div className="relative w-72">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input value={query} onChange={event => onQueryChange(event.target.value)} placeholder="找客户、产品、渠道" className="w-full rounded-xl border border-border bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#0891b2]" />
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {(Object.entries(VIEW_META) as [CustomerView, typeof VIEW_META[CustomerView]][]).map(([key, item]) => (
            <button key={key} type="button" onClick={() => onViewChange(key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${view === key ? 'border-slate-950 bg-slate-950 text-white' : 'border-border bg-white text-text-secondary'}`}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {list.map(customer => (
            <CustomerRow key={customer.id} customer={customer} selected={customer.id === selectedId} onOpen={() => onOpen(customer.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProfileCard({ customer }: { customer: CustomerProfile }) {
  const stage = STAGE_META[customer.stage];
  return (
    <aside className="w-72 flex-shrink-0 overflow-y-auto border-r border-border bg-surface px-4 py-4">
      <div className="rounded-2xl border border-border bg-white p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-2xl">{customer.country}</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-text-primary">{customer.name}</p>
            <p className="text-xs text-text-muted">{customer.countryName} · {customer.source}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-text-muted">阶段</p>
            <p className="mt-1 font-bold" style={{ color: stage.color }}>{customer.stage}</p>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-text-muted">意向分</p>
            <p className="mt-1 font-bold text-text-primary">{customer.intentScore}</p>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-text-muted">语言</p>
            <p className="mt-1 font-bold text-text-primary">{customer.language}</p>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-text-muted">当地时间</p>
            <p className="mt-1 font-bold text-text-primary">{customer.localTime}</p>
          </div>
        </div>
      </div>
      <div className="mt-3 rounded-2xl border border-border bg-white p-4">
        <p className="text-xs font-bold text-text-primary">历史订单</p>
        <div className="mt-2 space-y-2">
          {customer.orderHistory.length ? customer.orderHistory.map(order => (
            <div key={order} className="rounded-lg bg-surface-2 px-3 py-2 text-xs font-semibold text-text-secondary">{order}</div>
          )) : <p className="text-xs text-text-muted">暂无订单</p>}
        </div>
      </div>
      <div className="mt-3 rounded-2xl border border-border bg-white p-4">
        <p className="text-xs font-bold text-text-primary">意向信号</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {customer.intentSignals.map(signal => (
            <span key={signal} className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-semibold text-text-secondary">{signal}</span>
          ))}
        </div>
      </div>
      <div className="mt-3 rounded-2xl border border-border bg-white p-4">
        <p className="text-xs font-bold text-text-primary">标签</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {customer.tags.map(tag => (
            <span key={tag} className="rounded-full border border-border px-2 py-1 text-[10px] font-semibold text-text-muted">{tag}</span>
          ))}
        </div>
      </div>
    </aside>
  );
}

function eventIcon(type: TimelineEventType) {
  if (type === 'ai') return Bot;
  if (type === 'call') return Phone;
  if (type === 'note') return StickyNote;
  if (type === 'quote') return FileText;
  if (type === 'task') return CalendarClock;
  return MessageSquare;
}

function Timeline({ customer }: { customer: CustomerProfile }) {
  return (
    <section className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
      <div className="mb-4 rounded-2xl border border-border bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black text-text-primary">{customer.product}</p>
            <p className="mt-1 text-sm leading-relaxed text-text-muted">{customer.summary}</p>
          </div>
          <div className="flex-shrink-0 rounded-xl bg-surface-2 px-3 py-2 text-right">
            <p className="text-[10px] font-semibold text-text-muted">预估单值</p>
            <p className="text-lg font-black text-text-primary">{customer.estimatedValue}</p>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {customer.timeline.map(event => {
          const Icon = eventIcon(event.type);
          const isBuyer = event.actor === 'buyer';
          return (
            <div key={event.id} className="flex gap-3">
              <div className={`mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${isBuyer ? 'bg-surface-2 text-text-secondary' : 'bg-[#0891b2]/10 text-[#0891b2]'}`}>
                <Icon size={14} />
              </div>
              <div className="min-w-0 flex-1 rounded-2xl border border-border bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-text-primary">{event.title}</p>
                  <span className="text-[10px] text-text-muted">{event.time}</span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-text-secondary">{event.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AssistantRail({ customer }: { customer: CustomerProfile }) {
  const automation = AUTOMATION_META[customer.automation];
  const [callNoteOpen, setCallNoteOpen] = useState(false);
  const [callResult, setCallResult] = useState('有意向');
  const [note, setNote] = useState('');
  const isCallLead = customer.inboxReason === 'call';
  return (
    <aside className="w-80 flex-shrink-0 overflow-y-auto border-l border-border bg-white px-4 py-4">
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <Bot size={15} className="text-[#0891b2]" />
          <p className="text-sm font-black text-text-primary">AI助手栏</p>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">{automation.desc}</p>
        <span className="mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ color: automation.color, background: automation.bg }}>
          {automation.label}
        </span>
      </div>

      {isCallLead && (
        <div className="mt-3 rounded-2xl border border-red-100 bg-red-50 p-4">
          <div className="flex items-center gap-2 text-red-700">
            <Phone size={15} />
            <p className="text-sm font-black">想通电话 · 已熔断自动回复</p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-red-700/80">
            当地时间 {customer.localTime}，建议现在接。{customer.sla}
          </p>
          <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white">
            <Phone size={13} />拉起 WhatsApp 通话
          </button>
        </div>
      )}

      <div className="mt-3 grid gap-2">
        {[
          { icon: MessageSquare, label: '回复建议', text: `请基于${customer.name}当前阶段，生成下一条WhatsApp回复。` },
          { icon: Languages, label: '翻译润色', text: `把给${customer.name}的回复翻译成${customer.language}并润色。` },
          { icon: FileText, label: '报价草稿', text: `为${customer.product}生成报价草稿，预估单值${customer.estimatedValue}。` },
          { icon: RefreshCw, label: '唤醒话术', text: `为${customer.name}生成老客唤醒话术，结合历史订单和偏好。` },
        ].map(action => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              onClick={() => openGlobalAssistant(customer, action.text)}
              className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-left text-xs font-bold text-text-secondary hover:border-slate-300 hover:bg-surface-2"
            >
              <Icon size={13} className="text-[#0891b2]" />
              {action.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-amber-600" />
          <p className="text-sm font-black text-text-primary">下一步</p>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">{customer.nextStep}</p>
      </div>

      <div className="mt-3 rounded-2xl border border-border bg-white p-4">
        <button type="button" onClick={() => setCallNoteOpen(v => !v)} className="flex w-full items-center justify-between text-left">
          <span className="flex items-center gap-2 text-sm font-black text-text-primary"><Mic size={14} />通话后15秒记录</span>
          <span className="text-xs text-text-muted">{callNoteOpen ? '收起' : '记录'}</span>
        </button>
        <AnimatePresence>
          {callNoteOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-1.5">
                  {['有意向', '要样品', '再联系', '无效'].map(item => (
                    <button key={item} type="button" onClick={() => setCallResult(item)}
                      className={`rounded-lg border px-2 py-1.5 text-xs font-bold ${callResult === item ? 'border-[#0891b2] bg-[#0891b2]/10 text-text-primary' : 'border-border text-text-muted'}`}>
                      {item}
                    </button>
                  ))}
                </div>
                <textarea value={note} onChange={event => setNote(event.target.value)} rows={2} placeholder="一句话备注，或粘贴语音转写..."
                  className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-xs outline-none" />
                <button type="button" className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white">
                  <Send size={12} />保存并生成下一步
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </aside>
  );
}

function CustomerDetail({ customer, onBack, onDone }: { customer: CustomerProfile; onBack: () => void; onDone: () => void }) {
  const [draft, setDraft] = useState(draftForCustomer(customer));
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2.5">
          <button onClick={onBack} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2">
            <ChevronLeft size={16} />
          </button>
          <div>
            <p className="text-sm font-black text-text-primary">{customer.name}</p>
            <p className="text-[10px] text-text-muted">{customer.stage} · {customer.source} · {customer.lastActive}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-bold text-text-secondary">
          <Clock size={12} />对方当地 {customer.localTime}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col px-5 py-4">
          <button type="button" onClick={() => setInfoOpen(v => !v)} className="mb-3 rounded-2xl border border-border bg-white px-4 py-3 text-left">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-text-primary">了解这个客户</p>
                <p className="mt-1 text-xs text-text-muted">{customer.countryName} · {customer.language} · {customer.source} · {customer.estimatedValue}</p>
              </div>
              <span className="text-xs font-bold text-text-muted">{infoOpen ? '收起' : '展开'}</span>
            </div>
            <AnimatePresence>
              {infoOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="mt-3 grid gap-3 border-t border-border pt-3">
                    <div>
                      <p className="text-xs font-bold text-text-muted">历史订单</p>
                      <p className="mt-1 text-sm text-text-secondary">{customer.orderHistory.length ? customer.orderHistory.join(' / ') : '暂无订单'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-text-muted">意向信号</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {customer.intentSignals.map(signal => <span key={signal} className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-bold text-text-secondary">{signal}</span>)}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-text-muted">标签</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {customer.tags.map(tag => <span key={tag} className="rounded-full border border-border px-2 py-1 text-[10px] font-bold text-text-muted">{tag}</span>)}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </button>

          <div className="flex-1 space-y-3">
            {customer.timeline.map(event => {
              const isBuyer = event.actor === 'buyer';
              const isSeller = event.actor === 'seller';
              return (
                <div key={event.id} className={`flex ${isSeller ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                    isBuyer ? 'rounded-tl-sm border border-border bg-white text-text-primary'
                      : isSeller ? 'rounded-tr-sm bg-[#0891b2] text-white'
                        : 'border border-border bg-white text-text-secondary'
                  }`}>
                    <div className="mb-1 flex items-center gap-2 text-[10px] font-bold opacity-70">
                      <span>{event.title}</span>
                      <span>{event.time}</span>
                    </div>
                    {event.body}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-border bg-white px-5 py-4">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 flex items-center gap-2 text-xs font-black text-text-primary">
            <Sparkles size={13} className="text-[#0891b2]" />AI 已写好，可改一句就发
          </div>
          <div className="rounded-2xl border border-border bg-surface p-3">
            <textarea value={draft} onChange={event => setDraft(event.target.value)} rows={3}
              className="w-full resize-none bg-transparent text-sm leading-relaxed text-text-primary outline-none" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={() => openGlobalAssistant(customer, `帮我优化这条发给${customer.name}的回复：${draft}`)}
                className="rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary">
                让灵枢润色
              </button>
              <div className="flex gap-2">
                {customer.inboxReason === 'call' && (
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-black text-white">
                    <Phone size={13} />去回电
                  </button>
                )}
                <button type="button" onClick={onDone} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white">
                  <Send size={13} />发送并完成
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ConversionPage({ onLeaveConversation }: Props) {
  const [view, setView] = useState<CustomerView>('all');
  const [selectedId, setSelectedId] = useState(CUSTOMERS[0].id);
  const [detailOpen, setDetailOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const selected = CUSTOMERS.find(customer => customer.id === selectedId) ?? CUSTOMERS[0];
  const queue = useMemo(
    () => CUSTOMERS.filter(customer => customer.inboxReason && customer.automation !== 'auto' && !doneIds.includes(customer.id)).sort((a, b) => b.priority - a.priority).slice(0, 7),
    [doneIds],
  );

  const openCustomer = (id: string) => {
    setSelectedId(id);
    setDetailOpen(true);
  };

  const markDone = (id: string) => {
    setDoneIds(prev => prev.includes(id) ? prev : [...prev, id]);
    setDetailOpen(false);
  };

  useEffect(() => {
    const viewLabel = detailOpen ? `客户详情 / ${selected.name}` : allOpen ? '全部客户' : '今日客户队列';
    const summary = detailOpen
      ? `当前在我的客户详情页：${selected.name}，产品${selected.product}，预估单值${selected.estimatedValue}。默认只展示对话和一条可编辑AI草稿。客户摘要：${selected.summary}`
      : allOpen
        ? '当前在我的客户 - 全部客户入口，可搜索和筛选潜客、成交、沉默客户。'
        : `当前在我的客户 - 今日任务卡队列。还有 ${queue.length} 件事待处理，按紧急度排序。`;
    window.dispatchEvent(new CustomEvent('lingshu-assistant-context', {
      detail: {
        agent: 'conversion',
        label: viewLabel,
        summary,
        suggestions: detailOpen
          ? ['润色这条回复', '生成通话前简报', '把回复翻译成客户语言', '生成通话后跟进任务']
          : ['告诉我先处理哪张卡', '生成通话客户简报', '生成沉默客户唤醒消息', '总结AI自动接待情况'],
      },
    }));
  }, [allOpen, detailOpen, queue.length, selected.id]);

  const handleBack = () => {
    onLeaveConversation();
    setDetailOpen(false);
  };

  return (
    <div className="flex h-full flex-col bg-white">
      {!detailOpen && (
        <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#0891b2]/10 text-[#0891b2]">
              <Users size={13} />
            </div>
            <div>
              <p className="text-sm font-black text-text-primary">我的客户</p>
              <p className="text-[10px] text-text-muted">秘书模式 · 先处理最重要的客户动作</p>
            </div>
          </div>
          {allOpen && <p className="text-xs font-bold text-text-muted">全部客户 · 搜索和筛选</p>}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {detailOpen ? (
            <motion.div key="detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <CustomerDetail customer={selected} onBack={handleBack} onDone={() => markDone(selected.id)} />
            </motion.div>
          ) : allOpen ? (
            <motion.div key="all-customers" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <AllCustomersView
                view={view}
                query={query}
                selectedId={selectedId}
                onViewChange={setView}
                onQueryChange={setQuery}
                onOpen={openCustomer}
                onBack={() => setAllOpen(false)}
              />
            </motion.div>
          ) : (
            <motion.div key="queue" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <TaskQueueView
                customers={queue}
                doneCount={doneIds.length}
                onOpen={openCustomer}
                onDone={markDone}
                onOpenAll={() => setAllOpen(true)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
