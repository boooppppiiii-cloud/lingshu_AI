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
  Check,
  ChevronDown,
  Eye,
  FileText,
  Filter,
  GripVertical,
  Languages,
  MessageSquare,
  Phone,
  RefreshCw,
  Send,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { authHeader } from '../lib/auth';
import type { AgentAction, ConversationContext, KickoffSignal, RestoreSignal } from '../App';
import { BasicInfoWidget } from './customers/widgets/BasicInfoWidget';
import { IntentSignalsWidget } from './customers/widgets/IntentSignalsWidget';
import { OrderHistoryWidget } from './customers/widgets/OrderHistoryWidget';
import { TagsWidget } from './customers/widgets/TagsWidget';
import { SourceIcon } from './customers/SourceIcon';
import { DailyBriefing } from './customers/DailyBriefing';
import { useCustomers } from '../hooks/useCustomers';
import { buildPrioritySuggestion, dailyTodoCustomers, isTodoCompleted, pendingCount, sortCustomersByPriority, type PrioritySuggestion } from '../lib/customerPriority';
import type { AutonomyLevel, CustomerProfile, CustomerStage, HandlingMode, TimelineEvent } from '../types/customer';

type CustomerView = 'inbox' | 'leads' | 'won' | 'silent';
type AutomationLevel = 'auto' | 'confirm' | 'manual';
type DraftIntent = 'reply' | 'opener' | 'followup' | 'reactivate' | 'post_call' | 'polish' | 'handoff_summary';
type CustomerFilterKey = 'source' | 'country' | 'language' | 'stage' | 'handling' | 'tag';

interface CustomerListFilters {
  source: string;
  country: string;
  language: string;
  stage: string;
  handling: string;
  tag: string;
  unreadOnly: boolean;
  highIntentOnly: boolean;
}

declare global {
  interface Window {
    __lingshuDemo?: {
      pushBuyerMessage?: (customerId: string, text: string) => void;
    };
  }
}

interface Props {
  onEnterConversation: (ctx: ConversationContext) => void;
  onLeaveConversation: () => void;
  isInConversation: boolean;
  restore?: RestoreSignal;
  kickoff?: KickoffSignal;
  onAction?: AgentAction;
  onSessionRefresh?: () => void;
  isDemo?: boolean;
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

const EMPTY_CUSTOMER_FILTERS: CustomerListFilters = {
  source: 'all',
  country: 'all',
  language: 'all',
  stage: 'all',
  handling: 'all',
  tag: 'all',
  unreadOnly: false,
  highIntentOnly: false,
};

const AUTOMATION_META: Record<AutomationLevel, { label: string; desc: string; color: string; bg: string }> = {
  auto: { label: 'AI 自动接待', desc: '低价值询盘由 AI 自动首响和澄清。', color: '#16a34a', bg: 'rgba(22,163,74,0.1)' },
  confirm: { label: '草稿待确认', desc: 'AI 先生成回复草稿，人工看一眼后发送。', color: '#d97706', bg: 'rgba(217,119,6,0.1)' },
  manual: { label: '人工接管', desc: '大单或想通话的客户暂停自动回复，需要老板/销售接手。', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' },
};

type CustomerWidgetId = 'basicInfo' | 'orderHistory' | 'intentSignals' | 'tags';
type CustomerWidgetProps = { customer: CustomerProfile; onCustomerPatch: (patch: Partial<CustomerProfile>) => void };

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

const WIDGET_COMPONENTS: Record<CustomerWidgetId, ComponentType<CustomerWidgetProps>> = {
  basicInfo: BasicInfoWidget,
  orderHistory: ({ customer, onCustomerPatch }) => <OrderHistoryWidget customer={customer} onCustomerPatch={onCustomerPatch} />,
  intentSignals: ({ customer }) => <IntentSignalsWidget customer={customer} />,
  tags: ({ customer }) => <TagsWidget customer={customer} />,
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

function filterCustomers(view: CustomerView, customers: CustomerProfile[]) {
  if (view === 'inbox') return sortCustomersByPriority(customers.filter(customer => customer.inboxReason));
  if (view === 'leads') return customers.filter(customer => ['lead', 'inquiry', 'quoted'].includes(customer.stage)).sort((a, b) => b.intentScore - a.intentScore);
  if (view === 'won') return customers.filter(customer => customer.stage === 'won');
  return sortCustomersByPriority(customers.filter(customer => customer.stage === 'silent30' || customer.stage === 'silent60'));
}

function applyCustomerListFilters(customers: CustomerProfile[], filters: CustomerListFilters) {
  return customers.filter(customer => {
    if (filters.source !== 'all' && customer.source !== filters.source) return false;
    if (filters.country !== 'all' && customer.countryName !== filters.country) return false;
    if (filters.language !== 'all' && customer.language !== filters.language) return false;
    if (filters.stage !== 'all' && customer.stage !== filters.stage) return false;
    if (filters.handling !== 'all' && customer.handlingMode !== filters.handling) return false;
    if (filters.tag !== 'all' && !customer.tags.includes(filters.tag)) return false;
    if (filters.unreadOnly && !customer.hasUnread) return false;
    if (filters.highIntentOnly && customer.intentScore < 80) return false;
    return true;
  });
}

function replyLanguage(customer: CustomerProfile): string {
  if (customer.language.includes('阿语')) return 'Arabic';
  if (customer.language.includes('西语')) return 'Spanish';
  if (customer.language.includes('英语')) return 'English';
  return customer.language;
}

function latestBuyerMessage(customer: CustomerProfile): string {
  return [...customer.timeline].reverse().find(event => event.type === 'whatsapp' && event.actor === 'buyer')?.body || '';
}

function inferMessageLanguage(text: string): 'Arabic' | 'Spanish' | 'English' | null {
  const body = text.trim();
  if (!body) return null;
  if (/[\u0600-\u06ff]/.test(body)) return 'Arabic';
  const lower = body.toLowerCase();
  if (/[????????]/i.test(body) || /\b(hola|gracias|precio|envio|env?o|cuanto|cu?nto|piezas|interesa)\b/.test(lower)) return 'Spanish';
  if (/[a-z]/i.test(body)) return 'English';
  return null;
}

function customerConversationLanguage(customer: CustomerProfile): string {
  return replyLanguage(customer);
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

function fallbackCustomerReplyZh(customer: CustomerProfile): string {
  if (customer.needCall || customer.inboxReason === 'call') {
    return `您好，我们可以根据您要的${customer.product}快速确认规格、价格和交期。请您补充一下目标规格、包装要求和交付时间，我会尽快整理方案给您。`;
  }
  if (customer.stage === 'silent30' || customer.stage === 'silent60') {
    return `您好，之前您关注过${customer.product}，我们最近有新款和更适合批量采购的方案。如果您还在看这类产品，我可以发一份最新目录给您参考。`;
  }
  return `您好，感谢您的咨询。我先为您确认${customer.product}的起订量、最优价格和交期，稍后把完整信息发给您。`;
}

function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function normalizeDraftForChineseEditing(draft: string, customer: CustomerProfile): string {
  if (containsChinese(draft)) return draft;
  const normalized = draft.toLowerCase();
  if (normalized.includes('call') || normalized.includes('manager')) {
    return fallbackCustomerReplyZh(customer);
  }
  return fallbackCustomerReplyZh(customer);
}

function translateChineseReplyForCustomer(customer: CustomerProfile, text: string): string {
  const body = text.trim();
  if (!containsChinese(body)) return body;

  const product = customer.outboundProduct;
  const language = customerConversationLanguage(customer);
  const wantsCall = body.includes('通话') || body.includes('电话');
  const isWakeup = body.includes('最新目录') || body.includes('新款');

  if (language === 'Arabic') {
    if (wantsCall) return `شكرًا لرسالتك. بخصوص ${product}، يمكن لمديرنا شرح الخيارات والسعر ومدة التسليم في مكالمة قصيرة. ما الوقت المناسب لك اليوم؟`;
    if (isWakeup) return `مرحبًا، لدينا خيارات جديدة من ${product}. إذا كنت لا تزال مهتمًا، يمكنني إرسال الكتالوج الأحدث لك.`;
    return `شكرًا لرسالتك. سأؤكد لك الحد الأدنى للطلب وأفضل سعر ومدة التسليم لـ ${product}، ثم أرسل لك التفاصيل قريبًا.`;
  }
  if (language === 'Spanish') {
    if (wantsCall) return `Gracias por tu mensaje. Para ${product}, nuestro gerente puede explicarte las opciones, el precio y el plazo de entrega en una llamada breve. ¿Qué horario te conviene hoy?`;
    if (isWakeup) return `Hola, tenemos nuevas opciones de ${product}. Si todavía te interesa, puedo enviarte el catálogo actualizado.`;
    return `Gracias por tu mensaje. Voy a confirmar el MOQ, el mejor precio y el tiempo de entrega de ${product}, y te enviaré los detalles pronto.`;
  }
  if (wantsCall) return `Thanks for your message. For ${product}, our manager can explain the options, price, and delivery time in a short call. What time works for you today?`;
  if (isWakeup) return `Hi, we have new options for ${product}. If you are still interested, I can send you the latest catalog for review.`;
  return `Thanks for your message. I will confirm the MOQ, best price, and delivery time for ${product}, then send you the details shortly.`;
}

async function requestDraft(customer: CustomerProfile, instruction?: string, mode?: 'draft' | 'polish', intent: DraftIntent = mode === 'polish' ? 'polish' : 'reply'): Promise<string> {
  try {
    const resp = await fetch('/api/overseas/agents/conversion/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        customerId: customer.id,
        timeline: customer.timeline.slice(-8),
        product: customer.outboundProduct,
        internalProduct: customer.product,
        language: customer.language,
        stage: STAGE_LABEL[customer.stage],
        instruction,
        mode,
        intent,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (typeof data?.draft === 'string' && data.draft.trim()) return normalizeDraftForChineseEditing(data.draft.trim(), customer);
    }
  } catch {
    // Use local fallback when the API is unavailable in local preview.
  }
  return fallbackCustomerReplyZh(customer);
}

function fallbackHandoffSummary(customer: CustomerProfile): string {
  return [
    `客户想要：${customer.summary}`,
    `当前进展：${customer.nextStep}`,
    `需要人工原因：${customer.handlingReason}`,
  ].join('\n');
}

async function requestHandoffSummary(customer: CustomerProfile): Promise<string> {
  try {
    const resp = await fetch('/api/overseas/agents/conversion/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        customerId: customer.id,
        timeline: customer.timeline.slice(-8),
        product: customer.outboundProduct,
        internalProduct: customer.product,
        language: customer.language,
        stage: STAGE_LABEL[customer.stage],
        intent: 'handoff_summary',
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (typeof data?.draft === 'string' && data.draft.trim()) return data.draft.trim();
    }
  } catch {
    // Local fallback keeps the handoff context available.
  }
  return fallbackHandoffSummary(customer);
}

function fallbackCustomerSuggestions(customer: CustomerProfile): string[] {
  if (customer.inboxReason === 'call') {
    return [
      `生成一条给 ${customer.name} 的今日主动触达草稿，确认规格、包装和交期。`,
      `整理 ${customer.product} 的触达要点，突出当前采购数量和待确认信息。`,
      '生成一条确认尽快整理方案的稳单消息。',
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
  const [aiAutoExpanded, setAiAutoExpanded] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<CustomerListFilters>(EMPTY_CUSTOMER_FILTERS);
  const baseList = filterCustomers(view, customers);
  const list = applyCustomerListFilters(baseList, filters);
  const activeFilterCount = [
    filters.source !== 'all',
    filters.country !== 'all',
    filters.language !== 'all',
    filters.stage !== 'all',
    filters.handling !== 'all',
    filters.tag !== 'all',
    filters.unreadOnly,
    filters.highIntentOnly,
  ].filter(Boolean).length;
  const setFilterValue = (key: CustomerFilterKey, value: string) => setFilters(current => ({ ...current, [key]: value }));
  const optionList = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
  const sourceOptions = optionList(customers.map(customer => customer.source));
  const countryOptions = optionList(customers.map(customer => customer.countryName));
  const languageOptions = optionList(customers.map(customer => customer.language));
  const tagOptions = optionList(customers.flatMap(customer => customer.tags));
  const FilterSelect = ({ label, value, onChange, options, renderLabel }: {
    label: string;
    value: string;
    onChange: (next: string) => void;
    options: string[];
    renderLabel?: (item: string) => string;
  }) => (
    <label className="block">
      <span className="text-[10px] font-bold text-text-muted">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-white px-2.5 py-2 text-xs font-semibold text-text-primary outline-none focus:border-[#0891b2]"
      >
        <option value="all">全部</option>
        {options.map(item => <option key={item} value={item}>{renderLabel ? renderLabel(item) : item}</option>)}
      </select>
    </label>
  );
  const renderCustomer = (customer: CustomerProfile) => {
    const lastMessage = customer.timeline[customer.timeline.length - 1];
    const statusColor = HANDLING_COLOR[customer.handlingMode];
    const hasUnread = Boolean(customer.hasUnread);
    return (
      <button
        key={customer.id}
        type="button"
        onClick={() => onOpen(customer.id)}
        className={`w-full border-b border-border px-4 py-3 text-left transition-colors hover:bg-surface-2 ${customer.id === selectedId ? 'bg-[#0891b2]/10' : 'bg-white'}`}
      >
        <div className="flex items-start gap-3">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-sm font-black text-text-secondary">
            <span className="absolute -left-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white transition-opacity" style={{ backgroundColor: hasUnread ? '#dc2626' : statusColor, opacity: hasUnread ? 1 : 0 }} />
            {customer.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="truncate text-sm font-bold text-text-primary">{customer.name}</p>
                <SourceIcon source={customer.source} size={11} />
              </div>
              <span className="shrink-0 text-[11px] font-medium text-text-muted">{lastMessage?.time || customer.lastActive}</span>
            </div>
            <p className="mt-1 truncate text-xs leading-5 text-text-muted">{lastMessage?.body || customer.summary}</p>
          </div>
        </div>
      </button>
    );
  };
  const inboxGroups = [
    { key: 'human_needed', label: '需要你处理', items: list.filter(customer => customer.handlingMode === 'human_needed') },
    { key: 'ai_draft', label: '等你确认', items: list.filter(customer => customer.handlingMode === 'ai_draft') },
    { key: 'ai_auto', label: 'AI 接待中', items: list.filter(customer => customer.handlingMode === 'ai_auto') },
  ] as const;
  const aiAutoCount = inboxGroups[2].items.length;
  const aiAutoReplies = inboxGroups[2].items.reduce((sum, customer) => sum + (customer.aiAutoCount ?? 0), 0);

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col overflow-hidden border-r border-border bg-white">
      <div className="border-b border-border px-4 py-3">
        <div className="relative flex items-center justify-between gap-3">
          <p className="text-[11px] text-text-muted">{list.length} 个待处理 · 按最近动态排序</p>
          <button
            type="button"
            onClick={() => setFilterOpen(open => !open)}
            className={`relative flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${activeFilterCount ? 'border-[#0891b2] bg-[#0891b2]/10 text-[#0891b2]' : 'border-transparent text-text-muted hover:border-border hover:bg-surface-2'}`}
            title="筛选客户"
          >
            <Filter size={14} />
            {activeFilterCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0891b2] px-1 text-[9px] font-black text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
          {filterOpen && (
            <div className="absolute right-0 top-9 z-30 w-72 rounded-2xl border border-border bg-white p-3 shadow-xl">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black text-text-primary">筛选客户</p>
                  <p className="mt-0.5 text-[10px] text-text-muted">当前命中 {list.length}/{baseList.length}</p>
                </div>
                <button type="button" onClick={() => setFilterOpen(false)} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2">
                  <X size={13} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <FilterSelect label="来源渠道" value={filters.source} onChange={value => setFilterValue('source', value)} options={sourceOptions} />
                <FilterSelect label="国家/地区" value={filters.country} onChange={value => setFilterValue('country', value)} options={countryOptions} />
                <FilterSelect label="语言" value={filters.language} onChange={value => setFilterValue('language', value)} options={languageOptions} />
                <FilterSelect label="客户阶段" value={filters.stage} onChange={value => setFilterValue('stage', value)} options={Object.keys(STAGE_LABEL)} renderLabel={item => STAGE_LABEL[item as CustomerStage] || item} />
                <FilterSelect label="处理方式" value={filters.handling} onChange={value => setFilterValue('handling', value)} options={['human_needed', 'ai_draft', 'ai_auto']} renderLabel={item => item === 'human_needed' ? '需要你处理' : item === 'ai_draft' ? '等你确认' : 'AI 接待中'} />
                <FilterSelect label="客户标签" value={filters.tag} onChange={value => setFilterValue('tag', value)} options={tagOptions} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[
                  { key: 'unreadOnly' as const, label: '只看未读' },
                  { key: 'highIntentOnly' as const, label: '高意向 80+' },
                ].map(item => {
                  const active = filters[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setFilters(current => ({ ...current, [item.key]: !current[item.key] }))}
                      className={`flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-bold transition-colors ${active ? 'border-[#0891b2] bg-[#0891b2]/10 text-[#0891b2]' : 'border-border text-text-muted hover:text-text-primary'}`}
                    >
                      {active && <Check size={12} />}
                      {item.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <button type="button" onClick={() => setFilters(EMPTY_CUSTOMER_FILTERS)} className="text-xs font-bold text-text-muted hover:text-text-primary">
                  清空筛选
                </button>
                <button type="button" onClick={() => setFilterOpen(false)} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white">
                  应用
                </button>
              </div>
            </div>
          )}
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view !== 'inbox' && list.map(renderCustomer)}
        {view === 'inbox' && (
          <div>
            <div className="border-b border-border bg-surface-2 px-4 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-black text-text-secondary">需要你处理</p>
                <span className="min-w-5 rounded-full bg-red-600 px-1.5 py-0.5 text-center text-[10px] font-black text-white">{inboxGroups[0].items.length}</span>
              </div>
            </div>
            {inboxGroups[0].items.map(renderCustomer)}

            <div className="border-b border-border bg-surface-2 px-4 py-2">
              <p className="text-[11px] font-black text-text-secondary">等你确认</p>
            </div>
            {inboxGroups[1].items.map(renderCustomer)}

            <button
              type="button"
              onClick={() => setAiAutoExpanded(open => !open)}
              className="flex w-full items-center justify-between border-b border-border bg-surface-2 px-4 py-2 text-left"
            >
              <span className="text-[11px] font-black text-text-secondary">AI 正在接待 {aiAutoCount} 位客户 · 今日已自动回复 {aiAutoReplies} 条</span>
              <ChevronDown size={14} className={`text-text-muted transition-transform ${aiAutoExpanded ? 'rotate-180' : ''}`} />
            </button>
            {aiAutoExpanded && inboxGroups[2].items.map(renderCustomer)}
          </div>
        )}
      </div>
    </aside>
  );
}

function DraftSuggestionBar({
  draft,
  translatedDraft,
  isTemplate,
  onSend,
  onEdit,
  onDismiss,
  onRegenerate,
}: {
  draft: string;
  translatedDraft: string;
  isTemplate: boolean;
  onSend: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div data-draft-suggestion className="relative ml-auto max-w-[74%] rounded-2xl rounded-tr-sm border border-dashed border-[#0891b2]/35 bg-[#0891b2]/[0.08] px-4 py-3 shadow-sm">
      <button type="button" onClick={onDismiss} className="absolute right-2 top-2 rounded-full p-1 text-text-muted hover:bg-white/70">
        <X size={12} />
      </button>
      <div className="pr-6">
        <div className="flex shrink-0 items-center gap-1.5 text-xs font-black text-[#0891b2]">
          <Bot size={14} />
          {'AI \u5efa\u8bae\u56de\u590d'}
          {isTemplate && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700">{'\u6a21\u677f'}</span>}
          <button type="button" onClick={onRegenerate} className="ml-1 rounded-full p-1 text-[#0891b2] hover:bg-white" title="\u6362\u4e00\u7248">
            <RefreshCw size={12} />
          </button>
        </div>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text-primary">{translatedDraft}</p>
        <div className="mt-2 rounded-xl border border-[#0891b2]/15 bg-white/70 px-3 py-2 text-xs leading-relaxed text-text-secondary">
          <span className="font-bold text-text-primary">{'\u4e2d\u6587\u8349\u7a3f\uff1a'}</span>{draft}
        </div>
        <div className="mt-3 flex justify-end gap-1.5">
          <button type="button" onClick={onSend} className="rounded-lg bg-[#0891b2] px-3 py-1.5 text-xs font-bold text-white">{'\u76f4\u63a5\u53d1\u9001'}</button>
          <button type="button" onClick={onEdit} className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-bold text-text-secondary">{'\u4fee\u6539'}</button>
        </div>
      </div>
    </div>
  );
}

function chineseMessageTranslation(body: string, customer: CustomerProfile): string | null {
  if (/[\u4e00-\u9fff]/.test(body)) return null;
  const normalized = body.replace(/\s+/g, ' ').trim().toLowerCase();

  const exact: Record<string, string> = {
    'hi, i need 500 pcs custom hair wigs. please share moq, best price, and delivery time.': '你好，我需要 500 件定制假发。请提供起订量、最优价格和交期。',
    'i can ask our manager to walk you through the options by a short call. what time works for you?': '我可以安排经理通过一次简短通话为您说明方案。您什么时间方便？',
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

function timelineEventAgeHours(event?: TimelineEvent): number {
  const time = String(event?.time || '').trim();
  if (!time) return 0;
  const hourMatch = time.match(/(\d+)\s*(?:h|\u5c0f\u65f6|\u5c0f\u6642)/i);
  if (hourMatch) return Number(hourMatch[1]);
  const dayMatch = time.match(/(\d+)\s*(?:d|\u5929)/i);
  if (dayMatch) return Number(dayMatch[1]) * 24;
  if (time.includes('\u6628\u5929')) return 30;
  return 0;
}

function lastBuyerEvent(customer: CustomerProfile): TimelineEvent | undefined {
  return [...customer.timeline].reverse().find(event => event.type === 'whatsapp' && event.actor === 'buyer');
}

function sceneChips(customer: CustomerProfile): { intent: DraftIntent; label: string }[] {
  const chips: { intent: DraftIntent; label: string }[] = [];
  const hasSellerOrAi = customer.timeline.some(event => event.type === 'whatsapp' && (event.actor === 'seller' || event.actor === 'ai'));
  const last = customer.timeline[customer.timeline.length - 1];
  const lastBuyer = lastBuyerEvent(customer);
  if (customer.stage === 'lead' && !hasSellerOrAi) chips.push({ intent: 'opener', label: '\u5199\u4e00\u6761\u5f00\u573a\u767d' });
  if (customer.stage === 'quoted' && timelineEventAgeHours(lastBuyer) > 72) chips.push({ intent: 'followup', label: '\u5199\u4e00\u6761\u8ddf\u8fdb' });
  if (customer.stage === 'silent30' || customer.stage === 'silent60') chips.push({ intent: 'reactivate', label: '\u5199\u4e00\u6761\u5524\u9192\u6d88\u606f' });
  if (last?.type === 'call') chips.push({ intent: 'post_call', label: '\u6309\u901a\u8bdd\u7ed3\u679c\u5199\u8ddf\u8fdb' });
  return chips.slice(0, 3);
}

function ChatThread({
  customer,
  draftSuggestion,
  input,
  translatedInput,
  onInputChange,
  onTranslatedInputChange: _onTranslatedInputChange,
  onSend,
  onEditDraft,
  onSendDraft,
  onDismissDraft,
  onPolishInput,
  onRegenerateDraft,
  onSceneDraft,
  onPreviewTranslate,
  isPolishing,
}: {
  customer: CustomerProfile | null;
  draftSuggestion: string | null;
  input: string;
  translatedInput: string;
  onInputChange: (value: string) => void;
  onTranslatedInputChange: (value: string) => void;
  onSend: () => void;
  onEditDraft: () => void;
  onSendDraft: () => void;
  onDismissDraft: () => void;
  onPolishInput: () => void;
  onRegenerateDraft: () => void;
  onSceneDraft: (intent: DraftIntent) => void;
  onPreviewTranslate: () => void;
  isPolishing: boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const composerState = draftSuggestion ? 'draft' : input.trim() ? 'typing' : 'idle';
  const isOutsideWindow = customer ? timelineEventAgeHours(lastBuyerEvent(customer)) > 24 : false;
  const chips = customer && composerState === 'idle' ? sceneChips(customer) : [];

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.selectionStart = inputRef.current.value.length;
    inputRef.current.selectionEnd = inputRef.current.value.length;
  }, [input]);

  useEffect(() => {
    if (!previewOpen || !input.trim()) return;
    const timer = window.setTimeout(() => onPreviewTranslate(), 800);
    return () => window.clearTimeout(timer);
  }, [previewOpen, input, onPreviewTranslate]);

  if (!customer) {
    return (
      <section className="flex min-w-0 flex-1 items-center justify-center bg-white">
        <div className="text-center">
          <MessageSquare size={26} className="mx-auto text-text-muted" />
          <p className="mt-3 text-sm font-black text-text-primary">{'\u9009\u62e9\u5de6\u4fa7\u4e00\u4e2a\u5ba2\u6237\u5f00\u59cb'}</p>
          <p className="mt-1 text-xs text-text-muted">{'\u67e5\u770b\u5bf9\u8bdd\u3001\u7f16\u8f91 AI \u8349\u7a3f\u5e76\u53d1\u9001\u56de\u590d'}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
        <div>
          <p className="text-sm font-black text-text-primary">{customer.name}</p>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-muted">
            <span>{STAGE_LABEL[customer.stage]}</span>
            <span>·</span>
            <SourceIcon source={customer.source} size={12} />
            <span>·</span>
            <span>{customer.lastActive}</span>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-bold text-text-secondary">{'\u5f53\u5730\u65f6\u95f4'} {customer.localTime}</div>
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
                      <span className="font-bold">{'\u4e2d\u6587\u7ffb\u8bd1\uff1a'}</span>{translation}
                    </div>
                  )}
                  {event.autoSent && <div className="mt-2 flex justify-end"><span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-white/85">{'AI \u81ea\u52a8\u56de\u590d'}</span></div>}
                </div>
              </div>
            );
          })}
          {draftSuggestion && (
            <DraftSuggestionBar draft={draftSuggestion} translatedDraft={translateChineseReplyForCustomer(customer, draftSuggestion)} isTemplate={isOutsideWindow} onSend={onSendDraft} onEdit={onEditDraft} onDismiss={onDismissDraft} onRegenerate={onRegenerateDraft} />
          )}
        </div>
      </div>
      <div className="shrink-0 space-y-2 border-t border-border bg-white p-4">
        <div className="mx-auto max-w-3xl space-y-2">
          {isOutsideWindow && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{'\u8ddd\u5ba2\u6237\u4e0a\u6b21\u6d88\u606f\u5df2\u8d85\u8fc724\u5c0f\u65f6\uff0cWhatsApp \u8981\u6c42\u4ee5\u6a21\u677f\u6d88\u606f\u53d1\u9001'}</div>}
          {composerState === 'idle' && chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map(chip => <button key={chip.intent} type="button" onClick={() => onSceneDraft(chip.intent)} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-bold text-text-secondary hover:border-primary/30 hover:bg-primary/5 hover:text-primary"><Sparkles size={13} /> {chip.label}</button>)}
            </div>
          )}
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            {previewOpen && translatedInput && <div className="mb-3 rounded-xl border border-border bg-white px-3 py-2 text-xs leading-relaxed text-text-secondary"><span className="font-black text-text-primary">{'\u8bd1\u6587\u9884\u89c8\uff1a'}</span>{translatedInput}</div>}
            <textarea ref={inputRef} data-customer-reply-input rows={3} value={input} onChange={event => onInputChange(event.target.value)} placeholder="\u8f93\u5165\u4e2d\u6587\u56de\u590d..." className="w-full resize-none bg-transparent text-sm leading-relaxed text-text-primary outline-none placeholder:text-text-muted" />
            <div className="mt-2 flex items-center justify-between gap-2">
              {composerState === 'typing' ? (
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={onPolishInput} disabled={!input.trim() || isPolishing} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-white hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40" title="\u7ffb\u8bd1\u6da6\u8272"><Languages size={15} /></button>
                  <button type="button" onClick={() => { setPreviewOpen(open => !open); if (!previewOpen) onPreviewTranslate(); }} disabled={!input.trim()} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-white hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40" title="\u8bd1\u6587\u9884\u89c8"><Eye size={15} /></button>
                </div>
              ) : <span />}
               <button type="button" onClick={onSend} disabled={!input.trim()} className="flex items-center gap-1.5 rounded-xl bg-[#0891b2] px-4 py-2 text-xs font-bold text-white disabled:opacity-40"><Send size={13} /> {'\u53d1\u9001'}</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SortableWidget({
  id,
  customer,
  onCustomerPatch,
}: {
  id: CustomerWidgetId;
  customer: CustomerProfile;
  onCustomerPatch: (patch: Partial<CustomerProfile>) => void;
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
      <Widget customer={customer} onCustomerPatch={onCustomerPatch} />
    </div>
  );
}

function suggestionDismissKey(customerId: string, suggestionType: string) {
  return `lingshu:crm:dismissed:${customerId}:${suggestionType}`;
}

function isSuggestionDismissed(customerId: string, suggestionType: string) {
  const until = Number(localStorage.getItem(suggestionDismissKey(customerId, suggestionType)) || 0);
  return Date.now() < until;
}

function suggestionToneClass(tone: PrioritySuggestion['tone']) {
  if (tone === 'red') return 'border-l-red-500 bg-red-50 text-red-700';
  if (tone === 'amber') return 'border-l-amber-500 bg-amber-50 text-amber-800';
  if (tone === 'blue') return 'border-l-sky-500 bg-sky-50 text-sky-800';
  return 'border-l-emerald-500 bg-emerald-50 text-emerald-800';
}

function PrimaryActionCard({
  customer,
  onModeChange,
  onToast,
  onGenerateDraft,
  onFocusReply,
  onViewDraft,
  onCompleteTodo,
}: {
  customer: CustomerProfile;
  onModeChange: (mode: HandlingMode) => void;
  onToast: (message: string) => void;
  onGenerateDraft: (instruction: string, intent?: DraftIntent) => Promise<void> | void;
  onFocusReply: () => void;
  onViewDraft: () => void;
  onCompleteTodo: () => void;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [dismissTick, setDismissTick] = useState(0);
  const [handoffSummary, setHandoffSummary] = useState('');
  const rawSuggestion = buildPrioritySuggestion(customer);
  const dismissed = rawSuggestion.suggestionType !== 'none' && isSuggestionDismissed(customer.id, rawSuggestion.suggestionType);
  const suggestion: PrioritySuggestion = dismissed
    ? {
      customerId: customer.id,
      suggestionType: 'none',
      headline: '今日任务已完成',
      reason: '已暂不处理，24 小时内不再提醒',
      evidence: ['已按你的选择静默 24 小时'],
      priorityScore: 0,
      tone: 'green',
    }
    : rawSuggestion;

  const switchMode = (mode: HandlingMode, message: string) => {
    onModeChange(mode);
    onToast(message);
  };

  useEffect(() => {
    setEvidenceOpen(false);
    setHandoffSummary('');
  }, [customer.id, suggestion.suggestionType]);

  useEffect(() => {
    if (!evidenceOpen || suggestion.suggestionType !== 'handoff' || handoffSummary) return;
    let alive = true;
    void requestHandoffSummary(customer).then(summary => {
      if (alive) setHandoffSummary(summary);
    });
    return () => {
      alive = false;
    };
  }, [customer, evidenceOpen, handoffSummary, suggestion.suggestionType]);

  const dismissSuggestion = () => {
    localStorage.setItem(suggestionDismissKey(customer.id, suggestion.suggestionType), String(Date.now() + 24 * 60 * 60 * 1000));
    onCompleteTodo();
    setDismissTick(value => value + 1);
    onToast('已暂不处理，24 小时内不再提醒');
  };

  void dismissTick;

  const primaryAction = () => {
    if (suggestion.suggestionType === 'call') {
      void onGenerateDraft('生成一条主动触达草稿，语气自然，不承诺价格、折扣、付款条款或交期。', 'reactivate');
      return;
    }
    if (suggestion.suggestionType === 'handoff') {
      onFocusReply();
      onToast('已聚焦回复框');
      return;
    }
    if (suggestion.suggestionType === 'draft_review' || suggestion.suggestionType === 'blocked_auto') {
      onViewDraft();
      return;
    }
    if (suggestion.suggestionType === 'touch') {
      void onGenerateDraft('生成一条主动触达草稿，语气自然，不承诺价格、折扣、付款条款或交期。', 'reactivate');
      return;
    }
  };

  const secondaryAction = () => {
    if (suggestion.suggestionType === 'call') {
      dismissSuggestion();
      return;
    }
    if (suggestion.suggestionType === 'handoff') {
      switchMode('ai_auto', '已交回 AI 接待');
      return;
    }
    if (suggestion.suggestionType === 'draft_review' || suggestion.suggestionType === 'blocked_auto') {
      dismissSuggestion();
      return;
    }
    if (suggestion.suggestionType === 'touch') {
      dismissSuggestion();
    }
  };

  const primaryLabel: Record<PrioritySuggestion['suggestionType'], string> = {
    call: '生成触达草稿',
    handoff: '打开回复',
    draft_review: '查看草稿',
    touch: '生成触达草稿',
    blocked_auto: '查看草稿',
    none: '知道了',
  };
  const secondaryLabel: Record<PrioritySuggestion['suggestionType'], string> = {
    call: '暂不处理',
    handoff: '交回 AI',
    draft_review: '忽略此条',
    touch: '暂不处理',
    blocked_auto: '忽略此条',
    none: '',
  };

  return (
    <div className={`rounded-2xl border border-border border-l-4 p-4 ${suggestionToneClass(suggestion.tone)}`}>
      <p className="text-sm font-black">{suggestion.headline}</p>
      <p className="mt-2 text-xs leading-relaxed opacity-85">{suggestion.reason}</p>
      {suggestion.suggestionType !== 'none' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={primaryAction} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800">
            {primaryLabel[suggestion.suggestionType]}
          </button>
          {secondaryLabel[suggestion.suggestionType] && (
            <button type="button" onClick={secondaryAction} className="rounded-xl border border-current/20 bg-white px-3 py-2 text-xs font-bold hover:bg-white/80">
              {secondaryLabel[suggestion.suggestionType]}
            </button>
          )}
        </div>
      )}
      {suggestion.suggestionType !== 'none' && (
        <button type="button" onClick={() => setEvidenceOpen(open => !open)} className="mt-3 flex w-full items-center justify-between rounded-xl bg-white/70 px-3 py-2 text-left text-xs font-black">
          AI 判断依据
          <ChevronDown size={14} className={`transition-transform ${evidenceOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
      {evidenceOpen && (
        <div className="mt-2 rounded-xl bg-white/75 px-3 py-3 text-xs leading-relaxed">
          {suggestion.suggestionType === 'handoff' && (
            <div className="mb-3 whitespace-pre-line rounded-lg bg-surface-2 px-3 py-2 text-text-secondary">
              {handoffSummary || '正在整理交接摘要...'}
            </div>
          )}
          <div className="space-y-1.5">
            {suggestion.evidence.map(item => (
              <p key={item} className="flex gap-2 text-text-secondary"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50" />{item}</p>
            ))}
          </div>
        </div>
      )}
      {customer.handlingMode === 'ai_auto' && suggestion.suggestionType === 'none' && (
        <button type="button" onClick={() => switchMode('human_needed', '已转为你亲自接手')} className="mt-3 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100">
          转我接手
        </button>
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

function AdoptionPrompt({ autonomyLevel, onToast }: { autonomyLevel: AutonomyLevel; onToast: (message: string) => void }) {
  const stat = ADOPTION_STATS.find(item => item.consecutiveUnedited >= 15);
  const [hidden, setHidden] = useState(() => {
    if (!stat) return true;
    const until = Number(localStorage.getItem(`lingshu:crm:adoption-dismiss:${stat.category}`) || 0);
    return Date.now() < until;
  });
  const [enabled, setEnabled] = useState(false);
  if (!stat || hidden || enabled || autonomyLevel !== 'draft') return null;
  return (
    <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
      <p className="text-xs leading-relaxed text-sky-800">过去两周你直接发送了 {stat.consecutiveUnedited} 条{stat.category}AI 草稿且未修改。可以把全局 AI 参与程度调到“低风险消息自动回”，让 L3 动作自动处理。</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => { setEnabled(true); localStorage.setItem('lingshu:enterprise:highlight-autonomy', 'auto'); window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } })); onToast('已跳转到企业中心 AI 参与程度设置'); }} className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-700">
          去设置自动档
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
  autonomyLevel,
  onGenerateDraft,
  onHandlingModeChange,
  onCustomerPatch,
  onToast,
  onFocusReply,
  onViewDraft,
  onCompleteTodo,
}: {
  customer: CustomerProfile | null;
  autonomyLevel: AutonomyLevel;
  onGenerateDraft: (instruction: string, intent?: DraftIntent) => Promise<void> | void;
  onHandlingModeChange: (mode: HandlingMode) => void;
  onCustomerPatch: (patch: Partial<CustomerProfile>) => void;
  onToast: (message: string) => void;
  onFocusReply: () => void;
  onViewDraft: () => void;
  onCompleteTodo: () => void;
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
      <div className="mb-2 px-1">
        <p className="text-xs font-black text-text-primary">今日处理</p>
        <p className="mt-0.5 text-[11px] text-text-muted">先看是否需要你接手，再看客户资料。</p>
      </div>
      <div className="grid gap-3">
        <PrimaryActionCard customer={customer} onModeChange={onHandlingModeChange} onToast={onToast} onGenerateDraft={onGenerateDraft} onFocusReply={onFocusReply} onViewDraft={onViewDraft} onCompleteTodo={onCompleteTodo} />
        <AdoptionPrompt autonomyLevel={autonomyLevel} onToast={onToast} />
      </div>

      <div className="mt-3">
        <div className="mb-2 px-1">
          <p className="text-xs font-black text-text-primary">客户资料</p>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={widgetOrder} strategy={verticalListSortingStrategy}>
            <div className="grid gap-3">
              {widgetOrder.map(id => (
                <SortableWidget key={id} id={id} customer={customer} onCustomerPatch={onCustomerPatch} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
      <div className="mt-3">
        <RulesDisclosure />
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

function createMessageEvent(customerId: string, body: string, actor: 'seller' | 'buyer' | 'ai'): TimelineEvent {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return {
    id: `${customerId}-${Date.now()}-${actor}`,
    type: 'whatsapp',
    actor,
    title: actor === 'buyer' ? '客户消息' : actor === 'ai' ? 'AI 回复' : '销售回复',
    body,
    time,
  };
}

export default function ConversionPage({ onLeaveConversation: _onLeaveConversation, isDemo = false }: Props) {
  const [view, setView] = useState<CustomerView>('inbox');
  const { customers, updateCustomer, appendTimelineEvent } = useCustomers();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>('draft');
  const [dailyBriefingOpen, setDailyBriefingOpen] = useState(false);
  const [draftSuggestion, setDraftSuggestion] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [translatedInput, setTranslatedInput] = useState('');
  const [isPolishing, setIsPolishing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastDraftKey, setLastDraftKey] = useState('');
  const selected = useMemo(() => (
    selectedId ? customers.find(customer => customer.id === selectedId) ?? null : null
  ), [customers, selectedId]);
  const activeView = VIEW_META[view];
  const customerPendingCount = useMemo(() => pendingCount(customers), [customers]);
  const customerTodoItems = useMemo(() => (
    dailyTodoCustomers(customers).map(customer => {
      const suggestion = buildPrioritySuggestion(customer);
      const completed = isTodoCompleted(customer);
      return {
        id: customer.id,
        name: customer.name,
        product: customer.product,
        source: customer.source,
        headline: completed ? '今日任务已处理' : suggestion.headline,
        reason: completed ? '今天已处理，已放到待办底部' : suggestion.reason,
        tone: completed ? 'green' : suggestion.tone,
        completed,
      };
    })
  ), [customers]);

  useEffect(() => {
    customers.forEach(customer => {
      if (customer.todoCompletedAt) return;
      const suggestion = buildPrioritySuggestion(customer);
      if (suggestion.suggestionType !== 'none' && isSuggestionDismissed(customer.id, suggestion.suggestionType)) {
        updateCustomer(customer.id, { todoCompletedAt: new Date().toISOString(), hasUnread: false });
      }
    });
  }, [customers, updateCustomer]);

  useEffect(() => {
    fetch('/api/overseas/enterprise/profile', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => {
        const value = data?.strategy?.aiAutonomy;
        if (value === 'remind' || value === 'draft' || value === 'auto') setAutonomyLevel(value);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (customerPendingCount <= 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const key = 'lingshu:briefing:lastShown';
    if (localStorage.getItem(key) === today) return;
    localStorage.setItem(key, today);
    setDailyBriefingOpen(true);
  }, [customerPendingCount]);

  useEffect(() => {
    const handler = () => setDailyBriefingOpen(true);
    window.addEventListener('lingshu:open-daily-briefing', handler);
    return () => window.removeEventListener('lingshu:open-daily-briefing', handler);
  }, []);

  useEffect(() => {
    setDraftSuggestion(null);
    setInput('');
    setTranslatedInput('');
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
        pendingCount: customerPendingCount,
        todoItems: customerTodoItems,
        suggestions: selected
          ? ['生成下一条回复', '整理触达要点', '生成报价跟进', '创建今日触达任务']
          : ['现在该先回谁？', '筛选紧急客户', '筛选高意向客户', '创建老客唤醒批次'],
      },
    }));
  }, [view, selected, activeView, customerPendingCount, customerTodoItems]);

  const updateSelectedCustomer = (updater: (customer: CustomerProfile) => CustomerProfile) => {
    if (!selectedId) return;
    const customer = customers.find(item => item.id === selectedId);
    if (!customer) return;
    updateCustomer(selectedId, updater(customer));
  };

  const markTodoCompleted = (id: string) => {
    updateCustomer(id, { todoCompletedAt: new Date().toISOString(), hasUnread: false });
  };

  const markSelectedTodoCompleted = () => {
    if (selected) markTodoCompleted(selected.id);
  };

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(current => current === message ? null : current), 2200);
  };

  useEffect(() => {
    if (!isDemo) return;
    const previousDemo = window.__lingshuDemo;
    const previousPushBuyerMessage = previousDemo?.pushBuyerMessage;

    window.__lingshuDemo = {
      ...(previousDemo ?? {}),
      pushBuyerMessage: (customerId: string, text: string) => {
        const body = text.trim();
        if (!customerId || !body) return;
        appendTimelineEvent(customerId, createMessageEvent(customerId, body, 'buyer'));
        updateCustomer(customerId, { hasUnread: true, lastActive: '刚刚' });
      },
    };

    return () => {
      if (!window.__lingshuDemo) return;
      if (previousPushBuyerMessage) {
        window.__lingshuDemo.pushBuyerMessage = previousPushBuyerMessage;
        return;
      }
      delete window.__lingshuDemo.pushBuyerMessage;
      if (Object.keys(window.__lingshuDemo).length === 0) delete window.__lingshuDemo;
    };
  }, [appendTimelineEvent, isDemo, updateCustomer]);

  const updateHandlingMode = (mode: HandlingMode) => {
    updateSelectedCustomer(customer => ({
      ...customer,
      handlingMode: mode,
      needCall: mode === 'human_needed' ? customer.needCall : false,
      aiAutoCount: mode === 'ai_auto' ? customer.aiAutoCount ?? 0 : customer.aiAutoCount,
      todoCompletedAt: mode === 'ai_auto' ? new Date().toISOString() : undefined,
    }));
  };

  const sendReply = () => {
    if (!selected) return;
    const body = (translatedInput.trim() || (containsChinese(input) ? translateChineseReplyForCustomer(selected, input) : input.trim()));
    if (!body) return;
    appendTimelineEvent(selected.id, createMessageEvent(selected.id, body, 'seller'));
    updateCustomer(selected.id, { lastActive: '刚刚', hasUnread: false, todoCompletedAt: new Date().toISOString() });
    setInput('');
    setTranslatedInput('');
    setDraftSuggestion(null);
  };

  const sendDraftDirectly = () => {
    if (!selected || !draftSuggestion) return;
    appendTimelineEvent(selected.id, createMessageEvent(selected.id, translateChineseReplyForCustomer(selected, draftSuggestion), 'seller'));
    updateCustomer(selected.id, { lastActive: '刚刚', hasUnread: false, todoCompletedAt: new Date().toISOString() });
    setDraftSuggestion(null);
    setInput('');
    setTranslatedInput('');
  };

  const generateManualDraft = async (instruction: string, intent: DraftIntent = 'reply') => {
    if (!selected) return;
    setDraftSuggestion(null);
    const draft = await requestDraft(selected, instruction, undefined, intent);
    setDraftSuggestion(draft);
  };

  const regenerateDraft = async () => {
    if (!selected) return;
    const draft = await requestDraft(selected, undefined, undefined, 'reply');
    setDraftSuggestion(draft);
  };

  const polishInput = async () => {
    if (!selected || !input.trim() || isPolishing) return;
    setIsPolishing(true);
    try {
      const polished = await requestDraft(selected, input, 'polish', 'polish');
      setInput(polished);
      setTranslatedInput('');
    } finally {
      setIsPolishing(false);
    }
  };

  const previewTranslate = () => {
    if (!selected || !input.trim()) return;
    setTranslatedInput(translateChineseReplyForCustomer(selected, input));
  };

  const openCustomer = (id: string) => {
    setSelectedId(id);
    updateCustomer(id, { hasUnread: false });
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id) openCustomer(id);
    };
    window.addEventListener('lingshu:select-customer', handler);
    return () => window.removeEventListener('lingshu:select-customer', handler);
  }, [customers]);

  const editDraft = () => {
    if (!selected || !draftSuggestion) return;
    setInput(draftSuggestion);
    setTranslatedInput(translateChineseReplyForCustomer(selected, draftSuggestion));
    setDraftSuggestion(null);
    window.setTimeout(() => {
      const inputEl = document.querySelector<HTMLTextAreaElement>('[data-customer-reply-input]');
      inputEl?.focus();
      if (inputEl) {
        inputEl.selectionStart = inputEl.value.length;
        inputEl.selectionEnd = inputEl.value.length;
      }
    }, 0);
  };

  const focusReplyInput = () => {
    const inputEl = document.querySelector<HTMLTextAreaElement>('[data-customer-reply-input]');
    inputEl?.focus();
    inputEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const viewDraftSuggestion = () => {
    const draftEl = document.querySelector<HTMLElement>('[data-draft-suggestion]');
    if (draftEl) {
      draftEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    focusReplyInput();
  };


  return (
    <div className="flex h-full min-w-0 flex-col bg-white">
      <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg" style={{ background: 'rgba(22,163,74,0.1)', color: '#16a34a' }}>
            <Users size={13} />
          </div>
          <span className="text-sm font-semibold text-text-primary">我的客户</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <CompactCustomerList view={view} selectedId={selectedId} customers={customers} onOpen={openCustomer} onViewChange={setView} />
        <ChatThread
          customer={selected}
          draftSuggestion={draftSuggestion}
          input={input}
          translatedInput={translatedInput}
          onInputChange={(value) => { setInput(value); setTranslatedInput(''); }}
          onTranslatedInputChange={setTranslatedInput}
          onSend={sendReply}
          onEditDraft={editDraft}
          onSendDraft={sendDraftDirectly}
          onDismissDraft={() => setDraftSuggestion(null)}
          onPolishInput={polishInput}
          onRegenerateDraft={regenerateDraft}
          onSceneDraft={(intent) => void generateManualDraft('', intent)}
          onPreviewTranslate={previewTranslate}
          isPolishing={isPolishing}
        />
        <CustomerInfoRail
          customer={selected}
          autonomyLevel={autonomyLevel}
          onGenerateDraft={generateManualDraft}
          onHandlingModeChange={updateHandlingMode}
          onCustomerPatch={(patch) => {
            if (selected) updateCustomer(selected.id, patch);
          }}
          onToast={showToast}
          onFocusReply={focusReplyInput}
          onViewDraft={viewDraftSuggestion}
          onCompleteTodo={markSelectedTodoCompleted}
        />
      </div>
      {dailyBriefingOpen && (
        <DailyBriefing customers={customers} onSelectCustomer={openCustomer} onClose={() => setDailyBriefingOpen(false)} />
      )}
      {toast && (
        <div className="fixed bottom-24 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-slate-950 px-4 py-2 text-xs font-bold text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
