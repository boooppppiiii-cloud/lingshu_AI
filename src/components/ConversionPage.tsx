import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BellRing, Bot, CalendarClock, CheckCircle2, ChevronLeft, Clock,
  FileText, Filter, Languages, MessageSquare, Mic, Phone, RefreshCw, Send,
  Sparkles, StickyNote, TrendingUp, UserRound, Users,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { AgentAction, ConversationContext, KickoffSignal, RestoreSignal } from '../App';
import { authHeader } from '../lib/auth';

type CustomerView = 'inbox' | 'leads' | 'won' | 'silent';
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
  status?: string;
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
  channelId?: string;
  waId?: string;
  phone?: string;
  insight?: {
    language?: string;
    country_guess?: string;
    product?: string;
    quantity?: string;
    budget?: string;
    urgency?: string;
    call_request?: boolean;
    complaint?: boolean;
    intent_score?: number;
    signals?: { label: string; score: number }[];
    missing_fields?: string[];
  } | null;
  window?: { open: boolean; closesAt: string | null };
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

const VIEW_META: Record<CustomerView, { label: string; icon: typeof MessageSquare; desc: string }> = {
  inbox: { label: '收件箱', icon: BellRing, desc: '所有待处理会话，按紧急度排序' },
  leads: { label: '潜客', icon: Filter, desc: '新询盘、未成交，带AI意向评分' },
  won: { label: '成交客户', icon: CheckCircle2, desc: '已下单客户和跟单任务' },
  silent: { label: '沉默客户', icon: RefreshCw, desc: '30/60天雷达与老客唤醒' },
};

function reasonLabel(reason?: CustomerProfile['inboxReason']) {
  if (reason === 'call') return { label: '⚡ 想通电话', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' };
  if (reason === 'large') return { label: '大单预警', color: '#d97706', bg: 'rgba(217,119,6,0.1)' };
  if (reason === 'draft') return { label: 'AI草稿待确认', color: '#4f46e5', bg: 'rgba(79,70,229,0.1)' };
  if (reason === 'overdue') return { label: '45分钟未回', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' };
  return { label: '待回复', color: '#0891b2', bg: 'rgba(8,145,178,0.1)' };
}

function filterCustomers(view: CustomerView, customers: CustomerProfile[]) {
  if (view === 'inbox') return customers.filter(c => c.inboxReason).sort((a, b) => b.priority - a.priority);
  if (view === 'leads') return customers.filter(c => c.stage === '潜客' || c.stage === '询盘中' || c.stage === '已报价').sort((a, b) => b.intentScore - a.intentScore);
  if (view === 'won') return customers.filter(c => c.stage === '成交');
  return customers.filter(c => c.stage === '沉默30' || c.stage === '沉默60').sort((a, b) => b.intentScore - a.intentScore);
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...authHeader(), ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data as T;
}

function countryFlag(country?: string, waId?: string): string {
  if (country?.includes('沙特') || waId?.startsWith('966')) return '🇸🇦';
  if (country?.includes('阿联酋') || waId?.startsWith('971')) return '🇦🇪';
  if (country?.includes('巴西') || waId?.startsWith('55')) return '🇧🇷';
  if (country?.includes('美国') || waId?.startsWith('1')) return '🇺🇸';
  if (country?.includes('越南') || waId?.startsWith('84')) return '🇻🇳';
  return '🌍';
}

function formatLastActive(iso?: string): string {
  const t = iso ? Date.parse(iso) : 0;
  if (!t) return '未知';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins || 1}分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.round(hours / 24)}天前`;
}

function localTimeFromWaId(waId?: string): string {
  const zone = waId?.startsWith('966') ? 'Asia/Riyadh'
    : waId?.startsWith('971') ? 'Asia/Dubai'
      : waId?.startsWith('55') ? 'America/Sao_Paulo'
        : waId?.startsWith('84') ? 'Asia/Ho_Chi_Minh'
          : 'America/New_York';
  return new Date().toLocaleTimeString('zh-CN', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false });
}

function mapApiCustomer(raw: any): CustomerProfile {
  const customer = raw.customer ?? raw;
  const insight = raw.insight ?? null;
  const stage = (customer.stage || '潜客') as CustomerStage;
  const score = Number(insight?.intent_score ?? customer.priority ?? 50);
  const signals = Array.isArray(insight?.signals) ? insight.signals.map((s: any) => `${s.label} +${s.score}`) : [];
  const countryName = insight?.country_guess || '';
  return {
    id: customer.id,
    name: customer.profile_name || customer.wa_id || 'WhatsApp 客户',
    country: countryFlag(countryName, customer.wa_id),
    countryName: countryName || '未知国家',
    language: insight?.language || 'Unknown',
    timezone: '',
    localTime: localTimeFromWaId(customer.wa_id),
    source: customer.first_source?.source_type || 'WhatsApp',
    product: insight?.product || customer.next_step || '待识别产品',
    estimatedValue: insight?.budget || customer.estimatedValue || '-',
    stage,
    intentScore: score,
    intentSignals: signals.length ? signals : ['等待更多消息'],
    automation: (customer.automation || 'confirm') as AutomationLevel,
    priority: Number(customer.priority ?? score),
    inboxReason: customer.inboxReason,
    lastActive: customer.lastActiveLabel || formatLastActive(customer.last_inbound_at),
    orderHistory: Array.isArray(customer.orderHistory) ? customer.orderHistory : [],
    tags: Array.isArray(customer.tags) ? customer.tags : [],
    summary: insight?.missing_fields?.length ? `缺失字段：${insight.missing_fields.join('、')}` : 'AI 正在根据 WhatsApp 消息补全客户画像。',
    nextStep: customer.next_step || '生成下一步跟进建议',
    channelId: customer.channelId,
    waId: customer.wa_id,
    phone: customer.phone || customer.wa_id,
    insight,
    window: raw.window,
    timeline: [],
  };
}

function mapTimeline(raw: any): TimelineEvent {
  const type = raw.type === 'message' ? 'whatsapp' : raw.type;
  return {
    id: raw.id,
    type,
    actor: raw.actor,
    title: raw.title,
    body: raw.body,
    time: raw.ts ? new Date(raw.ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
    status: raw.status,
  };
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
            <span className="text-xs font-bold text-text-primary">意向 {customer.intentScore}</span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-[#0891b2]" style={{ width: `${customer.intentScore}%` }} />
            </div>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: automation.color, background: automation.bg }}>
              {automation.label}
            </span>
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

function CustomerListView({ view, customers, selectedId, onOpen, loading, onSeed }: { view: CustomerView; customers: CustomerProfile[]; selectedId: string; onOpen: (id: string) => void; loading?: boolean; onSeed: () => void }) {
  const list = filterCustomers(view, customers);
  const stats = [
    { label: '待处理', value: String(filterCustomers('inbox', customers).length), color: '#dc2626' },
    { label: '想通话', value: String(customers.filter(c => c.inboxReason === 'call').length), color: '#dc2626' },
    { label: '高意向', value: String(customers.filter(c => c.intentScore >= 85).length), color: '#16a34a' },
    { label: '沉默客户', value: String(filterCustomers('silent', customers).length), color: '#d97706' },
  ];
  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto max-w-5xl px-6 py-5">
        <div className="mb-4 grid grid-cols-4 gap-3">
          {stats.map(item => (
            <div key={item.label} className="rounded-xl border border-border bg-white p-4">
              <p className="text-[11px] font-semibold text-text-muted">{item.label}</p>
              <p className="mt-2 text-2xl font-black font-display" style={{ color: item.color }}>{item.value}</p>
            </div>
          ))}
        </div>
        {view === 'silent' && (
          <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-800">
              <RefreshCw size={14} />
              沉默客户回复后自动流回“询盘中”，重新进入收件箱
            </div>
          </div>
        )}
        <div className="space-y-2">
          {loading && <div className="rounded-xl border border-border bg-white p-6 text-sm text-text-muted">正在读取 WhatsApp 客户...</div>}
          {!loading && list.map(customer => (
            <CustomerRow key={customer.id} customer={customer} selected={customer.id === selectedId} onOpen={() => onOpen(customer.id)} />
          ))}
          {!loading && list.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-white p-8 text-center">
              <p className="text-sm font-bold text-text-primary">还没有 WhatsApp 进线</p>
              <p className="mt-1 text-xs text-text-muted">可先用模拟器注入 6 个客户，验证进线、建档、时间线和熔断链路。</p>
              <button type="button" onClick={onSeed} className="mt-4 rounded-xl bg-[#0891b2] px-4 py-2 text-xs font-bold text-white">
                注入演示进线
              </button>
            </div>
          )}
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
                {event.status === 'pending_credentials' && (
                  <span className="mt-2 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                    待发送（凭证未配置）
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReplyComposer({ customer, onSent }: { customer: CustomerProfile; onSent: () => void }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState('');
  const open = customer.window?.open ?? true;
  const latestDraft = [...customer.timeline].reverse().find(event => event.status === 'ai_draft')?.body || '';
  const closesAt = customer.window?.closesAt ? new Date(customer.window.closesAt) : null;
  const countdown = closesAt
    ? `${Math.max(0, Math.floor((closesAt.getTime() - Date.now()) / 3600000))}小时${Math.max(0, Math.floor((closesAt.getTime() - Date.now()) / 60000) % 60)}分钟`
    : '未知';

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    setError('');
    try {
      await apiJson(`/api/overseas/customers/${customer.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'text', body: text.trim(), aiDraft: latestDraft || text.trim() }),
      });
      setText('');
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  const regenerateDraft = async () => {
    setDrafting(true);
    setError('');
    try {
      const data = await apiJson<{ draft?: { reply_text?: string; should_escalate?: boolean; reason?: string } }>(`/api/overseas/customers/${customer.id}/draft`, { method: 'POST' });
      if (data.draft?.should_escalate) setError(data.draft.reason || '需要人工确认，AI 未生成可发送草稿');
      else setText(data.draft?.reply_text || '');
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成草稿失败');
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="border-t border-border bg-white px-5 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${open ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          {open ? `24h 窗口剩余 ${countdown}` : '24h 窗口已关闭，需模板消息'}
        </span>
        <div className="flex items-center gap-2">
          {latestDraft && (
            <button type="button" onClick={() => setText(latestDraft)} className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-bold text-cyan-700">
              使用AI草稿
            </button>
          )}
          <button type="button" onClick={regenerateDraft} disabled={drafting} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-text-secondary disabled:opacity-50">
            {drafting ? '生成中' : '重新生成草稿'}
          </button>
          {error && <span className="text-[11px] font-semibold text-red-600">{error}</span>}
        </div>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={event => setText(event.target.value)}
          rows={2}
          disabled={!open || sending}
          placeholder={open ? '输入 WhatsApp 回复，当前无凭证时会进入待发送...' : '窗口已关闭，明早配置模板消息后可发送'}
          className="min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[#0891b2] disabled:opacity-60"
        />
        <button
          type="button"
          onClick={send}
          disabled={!open || !text.trim() || sending}
          className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[#0891b2] px-4 text-xs font-bold text-white disabled:opacity-50"
        >
          <Send size={13} />
          {sending ? '发送中' : '发送'}
        </button>
      </div>
    </div>
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
          <button
            type="button"
            onClick={() => window.open(`https://wa.me/${customer.phone || customer.waId || ''}`, '_blank')}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white"
          >
            <Phone size={13} />打开 WhatsApp 联系
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

function CustomerDetail({ customer, onBack, onSent }: { customer: CustomerProfile; onBack: () => void; onSent: () => void }) {
  return (
    <div className="flex h-full flex-col">
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
      <div className="flex min-h-0 flex-1">
        <ProfileCard customer={customer} />
        <Timeline customer={customer} />
        <AssistantRail customer={customer} />
      </div>
      <ReplyComposer customer={customer} onSent={onSent} />
    </div>
  );
}

export default function ConversionPage({ onLeaveConversation }: Props) {
  const [view, setView] = useState<CustomerView>('inbox');
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const selected = customers.find(customer => customer.id === selectedId) ?? customers[0] ?? null;
  const activeView = VIEW_META[view];

  const loadCustomers = async (nextView = view) => {
    setLoading(true);
    try {
      const data = await apiJson<{ items: any[] }>(`/api/overseas/customers?view=${nextView}`);
      const next = data.items.map(mapApiCustomer);
      setCustomers(next);
      if (!selectedId && next[0]) setSelectedId(next[0].id);
    } catch {
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  };

  const loadCustomerDetail = async (id: string) => {
    const [detail, timeline] = await Promise.all([
      apiJson<any>(`/api/overseas/customers/${id}`),
      apiJson<{ items: any[] }>(`/api/overseas/customers/${id}/timeline`),
    ]);
    const mapped = { ...mapApiCustomer(detail), timeline: timeline.items.map(mapTimeline) };
    setCustomers(prev => {
      const exists = prev.some(customer => customer.id === mapped.id);
      return exists ? prev.map(customer => customer.id === mapped.id ? mapped : customer) : [mapped, ...prev];
    });
    setSelectedId(mapped.id);
  };

  const openCustomer = (id: string) => {
    setSelectedId(id);
    setDetailOpen(true);
    void loadCustomerDetail(id);
  };

  const seedCustomers = async () => {
    setLoading(true);
    try {
      await apiJson('/api/overseas/dev/wa/seed', { method: 'POST' });
      await loadCustomers(view);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadCustomers(view); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return;
    const viewLabel = detailOpen ? `客户详情 / ${selected.name}` : activeView.label;
    const summary = detailOpen
      ? `当前在我的客户详情页：${selected.name}，阶段${selected.stage}，意向分${selected.intentScore}，产品${selected.product}，预估单值${selected.estimatedValue}。${selected.summary}`
      : `当前在我的客户 - ${activeView.label}视图。${activeView.desc}。默认按“现在该回谁”处理客户。`;
    window.dispatchEvent(new CustomEvent('lingshu-assistant-context', {
      detail: {
        agent: 'conversion',
        label: viewLabel,
        summary,
        suggestions: detailOpen
          ? ['生成下一条回复建议', '生成通话前简报', '整理报价草稿', '生成通话后跟进任务']
          : ['告诉我现在该先回谁', '筛选想通电话客户', '解释意向评分', '生成沉默客户唤醒批次'],
      },
    }));
  }, [view, detailOpen, selected?.id]);

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
              <p className="text-[10px] text-text-muted">一张客户列表 · 一条完整时间线</p>
            </div>
          </div>
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
            {(Object.entries(VIEW_META) as [CustomerView, typeof VIEW_META[CustomerView]][]).map(([key, item]) => {
              const Icon = item.icon;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold transition-all ${view === key ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
                >
                  <Icon size={12} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {detailOpen ? (
            <motion.div key="detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              {selected ? (
                <CustomerDetail customer={selected} onBack={handleBack} onSent={() => void loadCustomerDetail(selected.id)} />
              ) : (
                <CustomerListView view={view} customers={customers} selectedId={selectedId} onOpen={openCustomer} loading={loading} onSeed={seedCustomers} />
              )}
            </motion.div>
          ) : (
            <motion.div key={view} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
              <CustomerListView view={view} customers={customers} selectedId={selectedId} onOpen={openCustomer} loading={loading} onSeed={seedCustomers} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
