import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Bot,
  FileText,
  Filter,
  GripVertical,
  Languages,
  MessageSquare,
  Phone,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { authHeader } from '../lib/auth';
import type { AgentAction, ConversationContext, KickoffSignal, RestoreSignal } from '../App';
import { BasicInfoWidget } from './customers/widgets/BasicInfoWidget';
import { IntentSignalsWidget } from './customers/widgets/IntentSignalsWidget';
import { OrderHistoryWidget } from './customers/widgets/OrderHistoryWidget';
import { TagsWidget } from './customers/widgets/TagsWidget';

type CustomerView = 'inbox' | 'leads' | 'won' | 'silent';
type CustomerStage = 'lead' | 'inquiry' | 'quoted' | 'won' | 'silent30' | 'silent60';
type HandlingMode = 'ai_auto' | 'ai_draft' | 'human_needed';
type AutomationLevel = 'auto' | 'confirm' | 'manual';
type TimelineType = 'whatsapp' | 'call' | 'note' | 'quote' | 'task';

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
  type: TimelineType;
  actor: 'buyer' | 'seller' | 'ai' | 'owner';
  title: string;
  body: string;
  time: string;
  autoSent?: boolean;
}

export interface CustomerProfile {
  id: string;
  name: string;
  avatar: string;
  countryName: string;
  email?: string;
  language: string;
  source: string;
  product: string;
  outboundProduct: string;
  estimatedValue: string;
  stage: CustomerStage;
  intentScore: number;
  intentSignals: string[];
  handlingMode: HandlingMode;
  handlingReason: string;
  aiAutoCount?: number;
  needCall?: boolean;
  priority: number;
  inboxReason?: 'call' | 'large' | 'draft' | 'overdue' | 'reply';
  lastActive: string;
  localTime: string;
  orders: OrderRecord[];
  tags: string[];
  summary: string;
  nextStep: string;
  timeline: TimelineEvent[];
}

export interface OrderRecord {
  id: string;
  status: 'paid' | 'refunded' | 'cancelled' | 'pending';
  total: string;
  createdAt: string;
  items?: { name: string; qty: number }[];
}

const VIEW_META: Record<CustomerView, { label: string; desc: string }> = {
  inbox: { label: '收件箱', desc: '按紧急程度排序的待处理会话。' },
  leads: { label: '潜客', desc: '新询盘和正在推进的商机。' },
  won: { label: '成交客户', desc: '已下单、待跟进的客户。' },
  silent: { label: '沉默客户', desc: '30/60 天未互动、需要唤醒的客户。' },
};

const STAGE_LABEL: Record<CustomerStage, string> = {
  lead: '潜客',
  inquiry: '询盘中',
  quoted: '已报价',
  won: '已成交',
  silent30: '沉默30天',
  silent60: '沉默60天',
};

const STAGE_META: Record<CustomerStage, { color: string; bg: string }> = {
  lead: { color: '#0891b2', bg: 'rgba(8,145,178,0.1)' },
  inquiry: { color: '#4f46e5', bg: 'rgba(79,70,229,0.1)' },
  quoted: { color: '#d97706', bg: 'rgba(217,119,6,0.1)' },
  won: { color: '#16a34a', bg: 'rgba(22,163,74,0.1)' },
  silent30: { color: '#ca8a04', bg: 'rgba(202,138,4,0.1)' },
  silent60: { color: '#dc2626', bg: 'rgba(220,38,38,0.1)' },
};

const AUTOMATION_META: Record<AutomationLevel, { label: string; desc: string; color: string; bg: string }> = {
  auto: { label: 'AI 自动接待', desc: '低价值询盘由 AI 自动首响和澄清。', color: '#16a34a', bg: 'rgba(22,163,74,0.1)' },
  confirm: { label: '草稿待确认', desc: 'AI 先生成回复草稿，人工看一眼后发送。', color: '#d97706', bg: 'rgba(217,119,6,0.1)' },
  manual: { label: '人工接管', desc: '大单或想通话的客户暂停自动回复，需要老板/销售接手。', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' },
};

type CustomerWidgetId = 'basicInfo' | 'orderHistory' | 'intentSignals' | 'tags';

const HANDLING_COLOR: Record<HandlingMode, string> = {
  ai_auto: '#16a34a',
  ai_draft: '#d97706',
  human_needed: '#dc2626',
};

const ADOPTION_STATS = [
  { category: '价格咨询', consecutiveUnedited: 18 },
  { category: '目录咨询', consecutiveUnedited: 9 },
];

const DEFAULT_WIDGET_ORDER: CustomerWidgetId[] = ['basicInfo', 'orderHistory', 'intentSignals', 'tags'];

const WIDGET_COMPONENTS: Record<CustomerWidgetId, ComponentType<{ customer: CustomerProfile }>> = {
  basicInfo: BasicInfoWidget,
  orderHistory: OrderHistoryWidget,
  intentSignals: IntentSignalsWidget,
  tags: TagsWidget,
};

function getTenantId() {
  try {
    const token = localStorage.getItem('overseas_token') || '';
    const payload = token.split('.')[1];
    if (!payload) return 'local';
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(normalized));
    return String(json.tenantId || json.tenant_id || json.userId || 'local');
  } catch {
    return 'local';
  }
}

function widgetOrderKey() {
  return `lingshu:crm:widget-order:${getTenantId()}`;
}

function readWidgetOrder(): CustomerWidgetId[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(widgetOrderKey()) || '[]');
    if (!Array.isArray(parsed)) return DEFAULT_WIDGET_ORDER;
    const valid = parsed.filter((id): id is CustomerWidgetId => DEFAULT_WIDGET_ORDER.includes(id));
    return [...valid, ...DEFAULT_WIDGET_ORDER.filter(id => !valid.includes(id))];
  } catch {
    return DEFAULT_WIDGET_ORDER;
  }
}

const CUSTOMERS: CustomerProfile[] = [
  {
    id: 'c1',
    name: 'Ahmed Al-Rashid',
    avatar: 'A',
    countryName: '沙特',
    language: '英语 / 阿语',
    source: 'WhatsApp',
    product: '定制假发 500 件',
    outboundProduct: 'custom hair wigs, 500 pcs',
    estimatedValue: '$2,400',
    stage: 'inquiry',
    intentScore: 96,
    intentSignals: ['问价格 +2', '问MOQ/船期 +3', '明确500件 +4', '想通电话 +6'],
    handlingMode: 'human_needed',
    handlingReason: '客户明确要求和经理通话，AI 已暂停自动回复',
    needCall: true,
    priority: 100,
    inboxReason: 'call',
    lastActive: '10 min',
    localTime: '15:20',
    orders: [
      { id: '#1001', status: 'paid', total: 'US $180.00', createdAt: '2025年11月18日 16:20', items: [{ name: '假发样品包', qty: 1 }] },
    ],
    tags: ['大单', 'OEM', '中东', '想通电话'],
    summary: '询问 500 件价格和船期，希望和经理通电话。',
    nextStep: 'Our manager will call you shortly. What time works best for you?',
    timeline: [
      { id: '1', type: 'whatsapp', actor: 'buyer', title: '客户消息', body: 'Can we talk with your manager today? I need 500 pcs custom hair wigs.', time: '10:15' },
      { id: '2', type: 'call', actor: 'ai', title: '识别到通话意图', body: '已暂停自动回复，只保留预约通话时间确认。', time: '10:16' },
      { id: '3', type: 'whatsapp', actor: 'seller', title: '销售回复', body: 'Our manager will call you shortly. What time works best for you?', time: '10:16' },
    ],
  },
  {
    id: 'c2',
    name: 'Fatima Hassan',
    avatar: 'F',
    countryName: '阿联酋',
    language: '阿语',
    source: 'WhatsApp',
    product: '香皂礼盒 1000 套',
    outboundProduct: 'soap gift boxes, 1000 sets',
    estimatedValue: '$1,800',
    stage: 'quoted',
    intentScore: 91,
    intentSignals: ['问价格 +2', '明确数量 +3', '节日前采购 +2'],
    handlingMode: 'ai_draft',
    handlingReason: '客户询价并明确数量，需要你确认报价草稿',
    priority: 88,
    inboxReason: 'large',
    lastActive: '45 min',
    localTime: '16:20',
    orders: [
      { id: '#1002', status: 'paid', total: 'US $420.00', createdAt: '2025年9月12日 11:05', items: [{ name: '香皂礼盒试单', qty: 200 }] },
    ],
    tags: ['大单预警', '阿语', '包装定制'],
    summary: '需要 1000 套定制 LOGO 礼盒，已给初步报价，等待确认包装方案。',
    nextStep: '发送阿语报价单和三套包装方案。',
    timeline: [
      { id: '1', type: 'whatsapp', actor: 'buyer', title: '客户消息', body: 'Need 1000 gift boxes with custom logo. What is the best price?', time: '昨天 16:00' },
      { id: '2', type: 'quote', actor: 'seller', title: '报价草稿', body: '$1.80 / set, custom logo included, 18 days lead time.', time: '昨天 16:02' },
      { id: '3', type: 'whatsapp', actor: 'ai', title: 'AI 草稿', body: 'We can support custom logo gift boxes. I will confirm the best price and packaging options for you.', time: '昨天 16:03' },
    ],
  },
  {
    id: 'c3',
    name: 'Maria Santos',
    avatar: 'M',
    countryName: '巴西',
    language: '西语',
    source: 'DM',
    product: '艾灸贴 200 件',
    outboundProduct: 'moxibustion patches, 200 pcs',
    estimatedValue: '$380',
    stage: 'lead',
    intentScore: 74,
    intentSignals: ['问价格 +2', '问样品 +2', '数量偏小 +1'],
    handlingMode: 'ai_draft',
    handlingReason: '客户询问样品和价格，AI 已准备筛选回复',
    priority: 62,
    inboxReason: 'draft',
    lastActive: '1h',
    localTime: '10:20',
    orders: [],
    tags: ['样品', '西语', '可培育'],
    summary: '小批量试单，适合走样品政策和后续复购培育。',
    nextStep: '询问收货地址，并发送样品政策。',
    timeline: [
      { id: '1', type: 'whatsapp', actor: 'buyer', title: '客户消息', body: 'Me interesa el parche de moxibustion, 200 piezas. Cual es el precio unitario?', time: '昨天 14:30' },
      { id: '2', type: 'task', actor: 'ai', title: 'AI 建议', body: '发送样品政策，并询问收货地址。', time: '昨天 14:31' },
    ],
  },
  {
    id: 'c4',
    name: 'John Thompson',
    avatar: 'J',
    countryName: '美国',
    language: '英语',
    source: 'Alibaba',
    product: '义乌小商品样品盒',
    outboundProduct: 'Yiwu sample box',
    estimatedValue: '$120',
    stage: 'won',
    intentScore: 82,
    intentSignals: ['给收货地址 +5', '确认样品 +2'],
    handlingMode: 'ai_auto',
    handlingReason: '成交后物流跟进，AI 可按固定话术提醒',
    aiAutoCount: 1,
    priority: 45,
    lastActive: '3h',
    localTime: '09:20',
    orders: [
      { id: '#1003', status: 'pending', total: 'US $120.00', createdAt: '今天 08:46', items: [{ name: '义乌小商品样品盒', qty: 1 }] },
    ],
    tags: ['已下单', '样品', '待发单号'],
    summary: '样品订单已确认，等待发送物流单号。',
    nextStep: '发送物流单号，并创建 3 天后的到货跟进。',
    timeline: [
      { id: '1', type: 'whatsapp', actor: 'buyer', title: '客户消息', body: 'Curated selection sounds great. Standard shipping is fine.', time: '今天 08:45' },
      { id: '2', type: 'task', actor: 'ai', title: '跟进任务', body: '创建物流单号跟进任务。', time: '今天 08:46' },
    ],
  },
  {
    id: 'c5',
    name: 'Khalid Mohammed',
    avatar: 'K',
    countryName: '沙特',
    language: '阿语',
    source: 'WhatsApp',
    product: '棕色直发 14 寸',
    outboundProduct: 'brown straight hair, 14 inch',
    estimatedValue: '$3,600',
    stage: 'silent60',
    intentScore: 89,
    intentSignals: ['历史大额采购 +4', '68天未互动', '新品匹配度高 +2'],
    handlingMode: 'human_needed',
    handlingReason: '高价值老客沉默 60 天，需要你判断唤醒力度',
    needCall: false,
    priority: 70,
    inboxReason: 'reply',
    lastActive: '68d',
    localTime: '15:20',
    orders: [
      { id: '#1004', status: 'paid', total: 'US $3,600.00', createdAt: '2026年3月4日 15:10', items: [{ name: '棕色直发 14 寸', qty: 600 }] },
      { id: '#0988', status: 'paid', total: 'US $1,900.00', createdAt: '2025年12月9日 14:35', items: [{ name: '假发补货批次', qty: 320 }] },
    ],
    tags: ['高价值老客', '沉默60天', '可唤醒'],
    summary: '高价值复购客户，适合用新品目录和老客价唤醒。',
    nextStep: '发送新品目录和老客专属价格。',
    timeline: [
      { id: '1', type: 'note', actor: 'owner', title: '历史偏好', body: '偏好自然黑/棕色直发，关注现货和补货速度。', time: '68天前' },
      { id: '2', type: 'task', actor: 'ai', title: '沉默雷达', body: '进入沉默60天状态，建议用新品目录唤醒。', time: '今天 09:00' },
    ],
  },
  {
    id: 'c6',
    name: 'Nguyen Van A',
    avatar: 'N',
    countryName: '越南',
    language: '英语',
    source: 'Instagram',
    product: '发饰批发',
    outboundProduct: 'wholesale hair accessories',
    estimatedValue: '$260',
    stage: 'lead',
    intentScore: 46,
    intentSignals: ['问目录 +1', '未给数量 +0'],
    handlingMode: 'ai_auto',
    handlingReason: '新客户首次进线，只咨询产品目录',
    aiAutoCount: 2,
    priority: 30,
    inboxReason: 'reply',
    lastActive: '昨天',
    localTime: '19:20',
    orders: [],
    tags: ['低分潜客', 'AI已自动回复', '目录'],
    summary: '只询问产品目录，AI 已自动发送基础目录。',
    nextStep: '继续由 AI 自动接待，直到客户提供采购数量。',
    timeline: [
      { id: '1', type: 'whatsapp', actor: 'buyer', title: '客户消息', body: 'Hi, interested in wholesale hair accessories. What collections do you have?', time: '昨天 11:00' },
      { id: '2', type: 'whatsapp', actor: 'ai', title: 'AI 自动回复', body: 'Thanks for reaching out. I sent our hair accessories catalog and 50 pcs mixed wholesale pack for your review.', time: '昨天 11:01', autoSent: true },
    ],
  },
];

function filterCustomers(view: CustomerView, customers: CustomerProfile[]) {
  if (view === 'inbox') return customers.filter(customer => customer.inboxReason).sort((a, b) => b.priority - a.priority);
  if (view === 'leads') return customers.filter(customer => ['lead', 'inquiry', 'quoted'].includes(customer.stage)).sort((a, b) => b.intentScore - a.intentScore);
  if (view === 'won') return customers.filter(customer => customer.stage === 'won');
  return customers.filter(customer => customer.stage === 'silent30' || customer.stage === 'silent60').sort((a, b) => b.intentScore - a.intentScore);
}

function replyLanguage(customer: CustomerProfile): string {
  if (customer.language.includes('阿语')) return 'Arabic';
  if (customer.language.includes('西语')) return 'Spanish';
  if (customer.language.includes('英语')) return 'English';
  return customer.language;
}

function fallbackCustomerReply(customer: CustomerProfile): string {
  if (replyLanguage(customer) === 'Arabic') {
    return `Thanks for your message. I will confirm the MOQ, best price, and delivery time for ${customer.outboundProduct}, then send you the details shortly.`;
  }
  if (replyLanguage(customer) === 'Spanish') {
    return `Gracias por tu mensaje. Voy a confirmar el MOQ, el mejor precio y el tiempo de entrega de ${customer.outboundProduct}, y te enviaré los detalles pronto.`;
  }
  return `Thanks for your message. I will confirm the MOQ, best price, and delivery time for ${customer.outboundProduct}, then send you the details shortly.`;
}

async function requestDraft(customer: CustomerProfile, instruction?: string, mode?: 'draft' | 'polish'): Promise<string> {
  try {
    const resp = await fetch('/api/overseas/agents/conversion/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        customerId: customer.id,
        timeline: customer.timeline.slice(-8),
        product: customer.outboundProduct,
        internalProduct: customer.product,
        language: replyLanguage(customer),
        stage: STAGE_LABEL[customer.stage],
        instruction,
        mode,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (typeof data?.draft === 'string' && data.draft.trim()) return data.draft.trim();
    }
  } catch {
    // Use local fallback when the API is unavailable in local preview.
  }
  return fallbackCustomerReply(customer);
}

function fallbackCustomerSuggestions(customer: CustomerProfile): string[] {
  if (customer.inboxReason === 'call') {
    return [
      `生成一条给 ${customer.name} 的通话承接回复，并询问方便通话的时间。`,
      `整理 ${customer.product} 的 30 秒通话简报，突出当前采购意向。`,
      '生成一条确认经理亲自跟进的稳单消息。',
    ];
  }
  if (customer.stage === 'silent30' || customer.stage === 'silent60') {
    return [
      `给 ${customer.name} 写一条自然的老客唤醒消息，给对方一个回复理由。`,
      `围绕 ${customer.product} 推荐一个不催促的跟进角度。`,
      '询问客户是否还需要样品或新版目录。',
    ];
  }
  if (customer.intentScore >= 80) {
    return [
      `为 ${customer.product} 生成一条简洁的报价跟进。`,
      '用一条消息确认数量、目的港和包装偏好。',
      '把客户自然推进到样品确认，不要显得催促。',
    ];
  }
  return [
    `继续让 ${customer.name} 由 AI 自动接待，并补问一个客资问题。`,
    `发送一条轻量目录回复，围绕 ${customer.product} 引导客户说出需求。`,
    '先询问目标采购数量，再决定是否转人工跟进。',
  ];
}

async function requestCustomerSuggestions(customer: CustomerProfile): Promise<string[]> {
  try {
    const resp = await fetch(`/api/overseas/customers/${encodeURIComponent(customer.id)}/suggestions`, {
      headers: authHeader(),
    });
    if (resp.ok) {
      const data = await resp.json();
      const items = Array.isArray(data?.items) ? data.items : data?.suggestions;
      if (Array.isArray(items)) {
        const suggestions = items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()).slice(0, 3);
        if (suggestions.length > 0) return suggestions;
      }
    }
  } catch {
    // Local fallback keeps the rail useful when the API is not running.
  }
  return fallbackCustomerSuggestions(customer);
}

function CompactCustomerList({
  view,
  selectedId,
  customers,
  onOpen,
  onViewChange,
}: {
  view: CustomerView;
  selectedId: string | null;
  customers: CustomerProfile[];
  onOpen: (id: string) => void;
  onViewChange: (view: CustomerView) => void;
}) {
  const list = filterCustomers(view, customers);
  return (
    <aside className="h-full w-80 shrink-0 overflow-hidden border-r border-border bg-white">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-text-primary">我的客户</p>
            <p className="mt-0.5 text-[11px] text-text-muted">{list.length} 个待处理 · 按最近动态排序</p>
          </div>
          <Filter size={14} className="text-text-muted" />
        </div>
        <div className="mt-3 flex gap-1 overflow-x-auto">
          {(Object.entries(VIEW_META) as [CustomerView, typeof VIEW_META[CustomerView]][]).map(([key, item]) => (
            <button
              key={key}
              type="button"
              onClick={() => onViewChange(key)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${view === key ? 'bg-slate-950 text-white' : 'bg-surface-2 text-text-muted hover:text-text-primary'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[calc(100%-84px)] overflow-y-auto">
        {list.map(customer => {
          const lastMessage = customer.timeline[customer.timeline.length - 1];
          const statusColor = HANDLING_COLOR[customer.handlingMode];
          return (
            <button
              key={customer.id}
              type="button"
              onClick={() => onOpen(customer.id)}
              className={`w-full border-b border-border px-4 py-3 text-left transition-colors hover:bg-surface-2 ${customer.id === selectedId ? 'bg-[#0891b2]/10' : 'bg-white'}`}
            >
              <div className="flex items-start gap-3">
                <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-sm font-black text-text-secondary">
                  <span className="absolute -left-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ backgroundColor: statusColor }} />
                  {customer.avatar}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="truncate text-sm font-bold text-text-primary">{customer.name}</p>
                    <span className="shrink-0 text-[11px] font-medium text-text-muted">{lastMessage?.time || customer.lastActive}</span>
                  </div>
                  <p className="mt-1 truncate text-xs leading-5 text-text-muted">{lastMessage?.body || customer.summary}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function DraftSuggestionBar({
  draft,
  onSend,
  onEdit,
  onDismiss,
}: {
  draft: string;
  onSend: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="relative rounded-xl border border-[#0891b2]/20 bg-[#0891b2]/[0.08] px-3 py-2">
      <button type="button" onClick={onDismiss} className="absolute right-2 top-2 rounded-full p-1 text-text-muted hover:bg-white/70">
        <X size={12} />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <div className="mt-0.5 flex shrink-0 items-center gap-1.5 text-xs font-black text-[#0891b2]">
          <Bot size={14} />
          AI 建议回复
        </div>
        <p className="line-clamp-2 min-w-0 flex-1 text-xs leading-5 text-text-secondary">{draft}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={onSend} className="rounded-lg bg-[#0891b2] px-3 py-1.5 text-xs font-bold text-white">直接发送</button>
          <button type="button" onClick={onEdit} className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-bold text-text-secondary">去修改</button>
        </div>
      </div>
    </div>
  );
}

function chineseMessageTranslation(body: string, customer: CustomerProfile): string | null {
  if (/[\u4e00-\u9fff]/.test(body)) return null;
  const normalized = body.replace(/\s+/g, ' ').trim().toLowerCase();

  const exact: Record<string, string> = {
    'can we talk with your manager today? i need 500 pcs custom hair wigs.': '今天可以和你们经理通话吗？我需要 500 件定制假发。',
    'our manager will call you shortly. what time works best for you?': '我们的经理很快会联系您。您什么时间方便？',
    'need 1000 gift boxes with custom logo. what is the best price?': '需要 1000 套定制 LOGO 礼盒，最优惠价格是多少？',
    'we can support custom logo gift boxes. i will confirm the best price and packaging options for you.': '我们可以支持定制 LOGO 礼盒。我会为您确认最优价格和包装方案。',
    'me interesa el parche de moxibustion, 200 piezas. cual es el precio unitario?': '我对艾灸贴感兴趣，200 件。单价是多少？',
    'curated selection sounds great. standard shipping is fine.': '这个精选组合听起来不错，标准运输就可以。',
    'hi, interested in wholesale hair accessories. what collections do you have?': '你好，我对发饰批发感兴趣。你们有哪些系列？',
    'thanks for reaching out. i sent our hair accessories catalog and 50 pcs mixed wholesale pack for your review.': '感谢联系。我已发送发饰目录和 50 件混批批发包，供您查看。',
  };

  if (exact[normalized]) return exact[normalized];
  if (normalized.includes('thanks for your message') && normalized.includes('moq')) {
    return `感谢您的消息。我会确认${customer.product}的 MOQ、最优价格和交期，然后尽快把详情发给您。`;
  }
  if (normalized.includes('best price') && normalized.includes('delivery time')) {
    return `我会为您确认${customer.product}的最优价格和交期。`;
  }
  return null;
}

function ChatThread({
  customer,
  draftSuggestion,
  input,
  onInputChange,
  onSend,
  onEditDraft,
  onSendDraft,
  onDismissDraft,
  onPolishInput,
  isPolishing,
}: {
  customer: CustomerProfile | null;
  draftSuggestion: string | null;
  input: string;
  onInputChange: (value: string) => void;
  onSend: (text: string) => void;
  onEditDraft: () => void;
  onSendDraft: () => void;
  onDismissDraft: () => void;
  onPolishInput: () => void;
  isPolishing: boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.selectionStart = inputRef.current.value.length;
    inputRef.current.selectionEnd = inputRef.current.value.length;
  }, [input]);

  if (!customer) {
    return (
      <section className="flex min-w-0 flex-1 items-center justify-center bg-white">
        <div className="text-center">
          <MessageSquare size={26} className="mx-auto text-text-muted" />
          <p className="mt-3 text-sm font-black text-text-primary">选择左侧一个客户开始</p>
          <p className="mt-1 text-xs text-text-muted">客户列表会一直保留，方便你快速切换处理。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
        <div>
          <p className="text-sm font-black text-text-primary">{customer.name}</p>
          <p className="text-[11px] text-text-muted">{STAGE_LABEL[customer.stage]} · {customer.source} · {customer.lastActive}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-bold text-text-secondary">
          对方当地 {customer.localTime}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-3xl space-y-4">
          {customer.timeline.map(event => {
            if (event.type !== 'whatsapp') {
              return (
                <div key={event.id} className="flex justify-center">
                  <div className="max-w-[82%] rounded-xl border border-border bg-surface px-3 py-2 text-center shadow-sm">
                    <p className="text-[11px] font-black text-text-primary">{event.title}</p>
                    <p className="mt-1 text-xs leading-5 text-text-muted">{event.body}</p>
                    <p className="mt-1 text-[10px] text-text-muted">{event.time}</p>
                  </div>
                </div>
              );
            }
            const isBuyer = event.actor === 'buyer';
            const isAi = event.actor === 'ai';
            const translation = chineseMessageTranslation(event.body, customer);
            return (
              <div key={event.id} className={`flex ${isBuyer ? 'justify-start' : 'justify-end'}`}>
                <div className={`relative max-w-[74%] rounded-2xl px-4 py-3 shadow-sm ${isBuyer ? 'rounded-tl-sm border border-border bg-surface-2 text-text-primary' : 'rounded-tr-sm bg-[#0891b2] text-white'}`}>
                  {isAi && <span className="absolute -top-2 right-3 rounded-full bg-white px-1.5 py-0.5 text-[9px] font-black text-[#0891b2] shadow-sm">AI</span>}
                  <div className="flex items-center justify-between gap-4">
                    <p className={`text-xs font-bold ${isBuyer ? 'text-text-primary' : 'text-white'}`}>{event.title}</p>
                    <span className={`text-[10px] ${isBuyer ? 'text-text-muted' : 'text-white/75'}`}>{event.time}</span>
                  </div>
                  <p className={`mt-1 whitespace-pre-line text-sm leading-relaxed ${isBuyer ? 'text-text-secondary' : 'text-white'}`}>{event.body}</p>
                  {translation && (
                    <div className={`mt-2 border-t pt-2 text-xs leading-relaxed ${isBuyer ? 'border-border text-text-muted' : 'border-white/20 text-white/80'}`}>
                      <span className="font-bold">中文翻译：</span>{translation}
                    </div>
                  )}
                  {event.autoSent && (
                    <div className="mt-2 flex justify-end">
                      <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-white/85">AI 自动回复</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="shrink-0 space-y-2 border-t border-border bg-white p-4">
        {draftSuggestion && (
          <div className="mx-auto max-w-3xl">
            <DraftSuggestionBar draft={draftSuggestion} onSend={onSendDraft} onEdit={onEditDraft} onDismiss={onDismissDraft} />
          </div>
        )}
        <div className="mx-auto max-w-3xl rounded-xl border border-border bg-surface-2 p-3">
          <textarea
            ref={inputRef}
            data-customer-reply-input
            rows={3}
            value={input}
            onChange={event => onInputChange(event.target.value)}
            placeholder="输入回复..."
            className="w-full resize-none bg-transparent text-sm leading-relaxed text-text-primary outline-none placeholder:text-text-muted"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onPolishInput}
              disabled={!input.trim() || isPolishing}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-white hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              title="翻译润色"
            >
              <Languages size={15} />
            </button>
            <button
              type="button"
              onClick={() => onSend(input)}
              disabled={!input.trim()}
              className="flex items-center gap-1.5 rounded-xl bg-[#0891b2] px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
              <Send size={13} /> 发送
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SortableWidget({
  id,
  customer,
}: {
  id: CustomerWidgetId;
  customer: CustomerProfile;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const Widget = WIDGET_COMPONENTS[id];

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative ${isDragging ? 'z-10 opacity-80' : ''}`}
    >
      <button
        type="button"
        className="absolute right-2 top-2 z-10 hidden h-7 w-7 items-center justify-center rounded-lg border border-border bg-white text-text-muted shadow-sm group-hover:flex"
        aria-label="Drag widget"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <Widget customer={customer} />
    </div>
  );
}

function HandlingStatusCard({
  customer,
  onModeChange,
  onToast,
}: {
  customer: CustomerProfile;
  onModeChange: (mode: HandlingMode) => void;
  onToast: (message: string) => void;
}) {
  const [recordOpen, setRecordOpen] = useState(false);
  const [callResult, setCallResult] = useState('有意向');
  const [note, setNote] = useState('');

  const switchMode = (mode: HandlingMode, message: string) => {
    onModeChange(mode);
    onToast(message);
  };

  if (customer.handlingMode === 'ai_auto') {
    return (
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
        <p className="text-sm font-black text-emerald-800">AI 接待中</p>
        <p className="mt-2 text-xs leading-relaxed text-emerald-700">{customer.handlingReason} · 已自动回复 {customer.aiAutoCount ?? 0} 条</p>
        <button type="button" onClick={() => switchMode('human_needed', '已转为你亲自接手')} className="mt-3 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100">
          转我接手
        </button>
      </div>
    );
  }

  if (customer.handlingMode === 'ai_draft') {
    return (
      <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
        <p className="text-sm font-black text-amber-800">等你审核</p>
        <p className="mt-2 text-xs leading-relaxed text-amber-700">{customer.handlingReason} · 草稿已备好，在下方聊天区确认</p>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => switchMode('human_needed', '已转为你亲自接手')} className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100">
            转我接手
          </button>
          <button type="button" onClick={() => switchMode('ai_auto', '已交回 AI 接待')} className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700">
            交回 AI
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
      <p className="text-sm font-black text-red-700">{customer.needCall ? '需要你通话 · 最高优先级' : '需要你出面'}</p>
      <p className="mt-2 text-xs leading-relaxed text-red-700/80">
        {customer.needCall ? `对方当地 ${customer.localTime}，${customer.handlingReason}` : customer.handlingReason}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {customer.needCall ? (
          <button type="button" onClick={() => onToast('已打开线上通话入口（演示）')} className="rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700">
            发起线上通话
          </button>
        ) : (
          <button type="button" onClick={() => onToast('请在中间聊天区回复客户')} className="rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700">
            打开聊天回复
          </button>
        )}
        <button type="button" onClick={() => switchMode('ai_draft', '已切换为 AI 写草稿，你来审核')} className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100">
          改为草稿审核
        </button>
      </div>
      {customer.needCall && (
        <div className="mt-3 rounded-xl border border-red-100 bg-white/75 p-3">
          <button type="button" onClick={() => setRecordOpen(v => !v)} className="flex w-full items-center justify-between text-left text-xs font-black text-red-700">
            通话后 15 秒记录
            <span>{recordOpen ? '收起' : '记录'}</span>
          </button>
          {recordOpen && (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                {['有意向', '要样品', '再联系', '无效'].map(item => (
                  <button key={item} type="button" onClick={() => setCallResult(item)} className={`rounded-lg border px-2 py-1.5 text-xs font-bold ${callResult === item ? 'border-red-400 bg-red-50 text-red-700' : 'border-border text-text-muted'}`}>
                    {item}
                  </button>
                ))}
              </div>
              <textarea value={note} onChange={event => setNote(event.target.value)} rows={2} placeholder="一句话记录通话结果..." className="w-full resize-none rounded-xl border border-border bg-white px-3 py-2 text-xs outline-none" />
              <button type="button" onClick={() => onToast(`已保存通话记录：${callResult}`)} className="w-full rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white">
                保存并生成下一步
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RulesDisclosure() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <button type="button" onClick={() => setOpen(v => !v)} className="flex w-full items-center justify-between text-left text-sm font-black text-text-primary">
        分工规则
        <span className="text-xs text-text-muted">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2 text-xs leading-relaxed text-text-secondary">
          <p>· 新客户咨询价格/产品/物流 → AI 用企业知识库自动回复</p>
          <p>· 出现采购数量/样品/收货信息 → AI 写草稿，你确认后发送</p>
          <p>· 讨价还价/订单条款/大单/新高价值客户 → 提醒你亲自接手</p>
          <button type="button" className="mt-2 text-xs font-bold text-primary hover:underline">在企业中心调整规则</button>
        </div>
      )}
    </div>
  );
}

function AdoptionPrompt({ onToast }: { onToast: (message: string) => void }) {
  const stat = ADOPTION_STATS.find(item => item.consecutiveUnedited >= 15);
  const [hidden, setHidden] = useState(() => {
    if (!stat) return true;
    const until = Number(localStorage.getItem(`lingshu:crm:adoption-dismiss:${stat.category}`) || 0);
    return Date.now() < until;
  });
  const [enabled, setEnabled] = useState(false);
  if (!stat || hidden || enabled) return null;
  return (
    <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
      <p className="text-xs leading-relaxed text-sky-800">过去两周你直接发送了 {stat.consecutiveUnedited} 条{stat.category}AI 草稿且未修改，要不要让 AI 自动回复这类消息？</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => { setEnabled(true); onToast(`已开启${stat.category}自动回复（演示）`); }} className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-700">
          开启自动回复
        </button>
        <button type="button" onClick={() => { localStorage.setItem(`lingshu:crm:adoption-dismiss:${stat.category}`, String(Date.now() + 30 * 24 * 60 * 60 * 1000)); setHidden(true); }} className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-bold text-sky-700 hover:bg-sky-100">
          暂不
        </button>
      </div>
    </div>
  );
}

function CustomerInfoRail({
  customer,
  onGenerateDraft,
  onHandlingModeChange,
  onToast,
}: {
  customer: CustomerProfile | null;
  onGenerateDraft: (instruction: string) => Promise<void> | void;
  onHandlingModeChange: (mode: HandlingMode) => void;
  onToast: (message: string) => void;
}) {
  const [widgetOrder, setWidgetOrder] = useState<CustomerWidgetId[]>(() => readWidgetOrder());
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState<number | null>(null);
  const generatingSuggestionRef = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!customer) {
      setSuggestions([]);
      return;
    }

    let alive = true;
    setSuggestions(fallbackCustomerSuggestions(customer));
    void requestCustomerSuggestions(customer).then(items => {
      if (alive) setSuggestions(items);
    });

    return () => {
      alive = false;
    };
  }, [customer]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setWidgetOrder(current => {
      const oldIndex = current.indexOf(active.id as CustomerWidgetId);
      const newIndex = current.indexOf(over.id as CustomerWidgetId);
      if (oldIndex < 0 || newIndex < 0) return current;
      const next = arrayMove(current, oldIndex, newIndex);
      localStorage.setItem(widgetOrderKey(), JSON.stringify(next));
      return next;
    });
  };

  const adoptSuggestion = async (suggestion: string, index: number) => {
    if (generatingSuggestionRef.current) return;
    generatingSuggestionRef.current = true;
    setActiveSuggestion(index);
    try {
      await onGenerateDraft(suggestion);
    } finally {
      generatingSuggestionRef.current = false;
      setActiveSuggestion(null);
    }
  };

  if (!customer) {
    return (
      <aside className="flex h-full w-[340px] shrink-0 items-center justify-center border-l border-border bg-surface px-6 text-center">
        <p className="text-xs leading-relaxed text-text-muted">选择客户后，这里会显示客户资料、订单、意向信号和 AI 动作。</p>
      </aside>
    );
  }

  return (
    <aside className="h-full w-[340px] shrink-0 overflow-y-auto border-l border-border bg-surface px-4 py-4">
      <div className="grid gap-3">
        <HandlingStatusCard customer={customer} onModeChange={onHandlingModeChange} onToast={onToast} />
        <AdoptionPrompt onToast={onToast} />
        <RulesDisclosure />
      </div>

      <div className="mt-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={widgetOrder} strategy={verticalListSortingStrategy}>
            <div className="grid gap-3">
              {widgetOrder.map(id => (
                <SortableWidget key={id} id={id} customer={customer} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </aside>
  );

  /*
  const automation = { desc: customer.handlingReason, label: customer.handlingMode, color: HANDLING_COLOR[customer.handlingMode], bg: 'rgba(15,23,42,0.06)' };

  return (
    <aside className="h-full w-[340px] shrink-0 overflow-y-auto border-l border-border bg-surface px-4 py-4">
      <div className="mb-3 rounded-2xl border border-primary/15 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles size={15} />
          </span>
          <div>
            <p className="text-sm font-black text-text-primary">灵小枢建议</p>
            <p className="text-[11px] text-text-muted">针对当前客户的下一步动作</p>
          </div>
        </div>
        <div className="mt-3 grid gap-2">
          {suggestions.slice(0, 3).map((suggestion, index) => (
            <div
              key={`${customer.id}-suggestion-${index}`}
              className="rounded-xl border border-border bg-surface-2 px-3 py-2 transition-colors hover:border-primary/30 hover:bg-primary/5"
            >
              <p className="line-clamp-2 text-xs font-semibold leading-relaxed text-text-secondary">{suggestion}</p>
              <button
                type="button"
                data-testid={`customer-suggestion-adopt-${index}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  void adoptSuggestion(suggestion, index);
                }}
                onClick={() => {
                  void adoptSuggestion(suggestion, index);
                }}
                disabled={activeSuggestion !== null}
                className="mt-2 inline-flex min-h-8 min-w-[64px] items-center justify-center rounded-full bg-slate-950 px-3 py-1 text-[11px] font-black text-white shadow-sm ring-1 ring-slate-950/10 transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-950/30 disabled:cursor-wait disabled:opacity-70"
              >
                {activeSuggestion === index ? '生成中...' : '采纳'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={widgetOrder} strategy={verticalListSortingStrategy}>
          <div className="grid gap-3">
            {widgetOrder.map(id => (
              <SortableWidget key={id} id={id} customer={customer} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="mt-3 rounded-2xl border border-border bg-white p-4">
        <div className="flex items-center gap-2">
          <Bot size={15} className="text-[#0891b2]" />
          <p className="text-sm font-black text-text-primary">AI 助手</p>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">{automation.desc}</p>
        <span className="mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ color: automation.color, background: automation.bg }}>
          {automation.label}
        </span>
        <div className="mt-3 grid gap-2">
          {[
            { icon: MessageSquare, label: '客资筛选回复', text: '生成一条简短的客资筛选回复。' },
            { icon: Languages, label: '翻译润色', text: `把下一条回复翻译并润色成${replyLanguage(customer)}。` },
            { icon: FileText, label: '报价推进', text: `为${customer.outboundProduct}生成一条报价推进回复。` },
            { icon: RefreshCw, label: '跟进唤醒', text: '生成一条跟进或老客唤醒消息。' },
          ].map(action => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                onClick={() => onGenerateDraft(action.text)}
                className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-left text-xs font-bold text-text-secondary hover:border-slate-300 hover:bg-surface-2"
              >
                <Icon size={13} className="text-[#0891b2]" />
                {action.label}
              </button>
            );
          })}
        </div>
      </div>

      {customer.inboxReason === 'call' && (
        <div className="mt-3 rounded-2xl border border-red-100 bg-red-50 p-4">
          <div className="flex items-center gap-2 text-red-700">
            <Phone size={15} />
            <p className="text-sm font-black">想通电话 · 最高优先级</p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-red-700/80">已暂停 AI 自动回复，需要老板或销售亲自接管。</p>
        </div>
      )}
    </aside>
  );
  */
}

function appendMessage(customer: CustomerProfile, body: string, actor: 'seller' | 'buyer' | 'ai'): CustomerProfile {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return {
    ...customer,
    lastActive: '刚刚',
    timeline: [
      ...customer.timeline,
      {
        id: `${customer.id}-${Date.now()}-${actor}`,
        type: 'whatsapp',
        actor,
        title: actor === 'buyer' ? '客户消息' : actor === 'ai' ? 'AI 回复' : '销售回复',
        body,
        time,
      },
    ],
  };
}

export default function ConversionPage({ onLeaveConversation: _onLeaveConversation }: Props) {
  const [view, setView] = useState<CustomerView>('inbox');
  const [customers, setCustomers] = useState<CustomerProfile[]>(CUSTOMERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftSuggestion, setDraftSuggestion] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isPolishing, setIsPolishing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastDraftKey, setLastDraftKey] = useState('');
  const selected = useMemo(() => (
    selectedId ? customers.find(customer => customer.id === selectedId) ?? null : null
  ), [customers, selectedId]);
  const activeView = VIEW_META[view];

  useEffect(() => {
    setDraftSuggestion(null);
    setInput('');
  }, [selectedId]);

  useEffect(() => {
    if (!selected) return;
    const lastBuyer = [...selected.timeline].reverse().find(event => event.type === 'whatsapp' && event.actor === 'buyer');
    if (!lastBuyer) return;
    const key = `${selected.id}:${lastBuyer.id}`;
    if (key === lastDraftKey) return;
    setLastDraftKey(key);
    void requestDraft(selected).then(setDraftSuggestion);
  }, [selected, lastDraftKey]);

  useEffect(() => {
    const viewLabel = selected ? `客户详情 / ${selected.name}` : activeView.label;
    const summary = selected
      ? `当前页面：客户详情。客户：${selected.name}。阶段：${STAGE_LABEL[selected.stage]}。意向：${selected.intentScore}。产品：${selected.product}。预估价值：${selected.estimatedValue}。摘要：${selected.summary}`
      : `当前页面：我的客户 - ${activeView.label}。${activeView.desc}`;
    window.dispatchEvent(new CustomEvent('lingshu-assistant-context', {
      detail: {
        agent: 'conversion',
        label: viewLabel,
        summary,
        suggestions: selected
          ? ['生成下一条回复', '准备通话简报', '生成报价跟进', '创建通话后任务']
          : ['现在该先回谁？', '筛选紧急客户', '筛选高意向客户', '创建老客唤醒批次'],
      },
    }));
  }, [view, selected, activeView]);

  const updateSelectedCustomer = (updater: (customer: CustomerProfile) => CustomerProfile) => {
    if (!selectedId) return;
    setCustomers(list => list.map(customer => customer.id === selectedId ? updater(customer) : customer));
  };

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(current => current === message ? null : current), 2200);
  };

  const updateHandlingMode = (mode: HandlingMode) => {
    updateSelectedCustomer(customer => ({
      ...customer,
      handlingMode: mode,
      needCall: mode === 'human_needed' ? customer.needCall : false,
      aiAutoCount: mode === 'ai_auto' ? customer.aiAutoCount ?? 0 : customer.aiAutoCount,
    }));
  };

  const sendReply = (text: string, actor: 'seller' | 'ai' = 'seller') => {
    const body = text.trim();
    if (!body) return;
    updateSelectedCustomer(customer => appendMessage(customer, body, actor));
    setInput('');
    setDraftSuggestion(null);
  };

  const generateManualDraft = async (instruction: string) => {
    if (!selected) return;
    setDraftSuggestion(null);
    const draft = await requestDraft(selected, instruction);
    setDraftSuggestion(draft);
  };

  const polishInput = async () => {
    if (!selected || !input.trim() || isPolishing) return;
    setIsPolishing(true);
    try {
      const polished = await requestDraft(selected, `Polish this seller reply without changing its meaning: ${input}`, 'polish');
      setInput(polished);
    } finally {
      setIsPolishing(false);
    }
  };

  const simulateBuyerMessage = () => {
    updateSelectedCustomer(customer => appendMessage(customer, 'Can you confirm the MOQ, delivery time, and best price today?', 'buyer'));
  };

  const editDraft = () => {
    if (!draftSuggestion) return;
    setInput(draftSuggestion);
    setDraftSuggestion(null);
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('[data-customer-reply-input]')?.focus();
    }, 0);
  };

  return (
    <div className="flex h-full min-w-0 bg-white">
      <CompactCustomerList view={view} selectedId={selectedId} customers={customers} onOpen={setSelectedId} onViewChange={setView} />
      <ChatThread
        customer={selected}
        draftSuggestion={draftSuggestion}
        input={input}
        onInputChange={setInput}
        onSend={sendReply}
        onEditDraft={editDraft}
        onSendDraft={() => draftSuggestion && sendReply(draftSuggestion, 'ai')}
        onDismissDraft={() => setDraftSuggestion(null)}
        onPolishInput={polishInput}
        isPolishing={isPolishing}
      />
      <CustomerInfoRail customer={selected} onGenerateDraft={generateManualDraft} onHandlingModeChange={updateHandlingMode} onToast={showToast} />
      {toast && (
        <div className="fixed bottom-24 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-slate-950 px-4 py-2 text-xs font-bold text-white shadow-lg">
          {toast}
        </div>
      )}
      {selected && (
        <button
          type="button"
          onClick={simulateBuyerMessage}
          className="fixed bottom-24 right-[370px] z-[60] rounded-full border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary shadow-lg hover:bg-surface-2"
        >
          模拟客户消息
        </button>
      )}
    </div>
  );
}
