import type { CustomerProfile, CustomerView, TimelineEvent } from '../types';

export const VIEW_LABELS: Record<CustomerView, string> = {
  inbox: '待处理',
  leads: '潜客',
  won: '成交',
  silent: '沉默',
};

export function isLowValueAuto(customer: CustomerProfile) {
  return customer.automation === 'auto' || customer.intentScore < 55;
}

export function taskQueue(customers: CustomerProfile[]) {
  return customers
    .filter(customer => customer.inboxReason && !isLowValueAuto(customer))
    .sort((a, b) => b.priority - a.priority);
}

export function filterCustomers(view: CustomerView, customers: CustomerProfile[]) {
  if (view === 'inbox') return customers.filter(c => c.inboxReason).sort((a, b) => b.priority - a.priority);
  if (view === 'leads') return customers.filter(c => c.stage === '潜客' || c.stage === '询盘中' || c.stage === '已报价').sort((a, b) => b.intentScore - a.intentScore);
  if (view === 'won') return customers.filter(c => c.stage === '成交');
  return customers.filter(c => c.stage === '沉默30' || c.stage === '沉默60').sort((a, b) => b.intentScore - a.intentScore);
}

export function taskMeta(customer: CustomerProfile) {
  if (customer.inboxReason === 'call') return { label: '想通电话', tone: 'danger' as const, button: '查看简报，去回电' };
  if (customer.inboxReason === 'large') return { label: '大单预警', tone: 'warning' as const, button: '看一眼，发送' };
  if (customer.inboxReason === 'draft') return { label: '草稿待确认', tone: 'success' as const, button: '看一眼，发送' };
  if (customer.inboxReason === 'overdue') return { label: '45分钟未回', tone: 'danger' as const, button: '去回复' };
  return { label: '待回复', tone: 'default' as const, button: '处理' };
}

export function customerStatus(customer: CustomerProfile): 'unread' | 'handled' | 'call' {
  if (customer.inboxReason === 'call') return 'call';
  if (isLowValueAuto(customer)) return 'handled';
  return 'unread';
}

export function lastMessageSummary(customer: CustomerProfile) {
  const last = customer.timeline[customer.timeline.length - 1];
  if (last?.body) return last.body;
  return customer.summary || customer.nextStep;
}

export function aiSuggestion(customer: CustomerProfile) {
  if (customer.inboxReason === 'call') return `${customer.name} 想通电话，先看30秒简报再回拨。`;
  if (customer.inboxReason === 'large') return `${customer.name} 可能是大单，报价草稿已准备好。`;
  if (customer.inboxReason === 'draft') return `${customer.name} 的回复草稿好了，看一眼就能发。`;
  if (customer.stage === '沉默30' || customer.stage === '沉默60') return `${customer.name} ${customer.lastActive}，适合发这条唤醒消息。`;
  return `${customer.name} 有新消息，建议现在回复。`;
}

export function avatarInitial(customer: Pick<CustomerProfile, 'name' | 'countryName'>) {
  const first = customer.name.trim().charAt(0);
  return first || customer.countryName.trim().charAt(0) || '客';
}

export function mergeById(groups: CustomerProfile[][]) {
  const map = new Map<string, CustomerProfile>();
  for (const group of groups) {
    for (const customer of group) map.set(customer.id, { ...map.get(customer.id), ...customer });
  }
  return [...map.values()].sort((a, b) => b.priority - a.priority);
}

export function countryCode(country?: string, waId?: string): string {
  if (country?.includes('沙特') || waId?.startsWith('966')) return 'SA';
  if (country?.includes('阿联酋') || waId?.startsWith('971')) return 'AE';
  if (country?.includes('巴西') || waId?.startsWith('55')) return 'BR';
  if (country?.includes('美国') || waId?.startsWith('1')) return 'US';
  if (country?.includes('越南') || waId?.startsWith('84')) return 'VN';
  return 'GL';
}

export function formatLastActive(iso?: string): string {
  const t = iso ? Date.parse(iso) : 0;
  if (!t) return '未知';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins || 1}分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.round(hours / 24)}天前`;
}

export function localTimeFromWaId(waId?: string): string {
  const zone = waId?.startsWith('966') ? 'Asia/Riyadh'
    : waId?.startsWith('971') ? 'Asia/Dubai'
      : waId?.startsWith('55') ? 'America/Sao_Paulo'
        : waId?.startsWith('84') ? 'Asia/Ho_Chi_Minh'
          : 'America/New_York';
  return new Date().toLocaleTimeString('zh-CN', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false });
}

export function mapApiCustomer(raw: any): CustomerProfile {
  const customer = raw.customer ?? raw;
  const insight = raw.insight ?? null;
  const stage = customer.stage || '潜客';
  const score = Number(insight?.intent_score ?? customer.priority ?? 50);
  const signals = Array.isArray(insight?.signals) ? insight.signals.map((s: any) => `${s.label} +${s.score}`) : [];
  const countryName = insight?.country_guess || '';
  return {
    id: customer.id,
    name: customer.profile_name || customer.wa_id || 'WhatsApp 客户',
    country: countryCode(countryName, customer.wa_id),
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
    automation: customer.automation || 'confirm',
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

export function mapTimeline(raw: any): TimelineEvent {
  return {
    id: raw.id,
    type: raw.type === 'message' ? 'whatsapp' : raw.type,
    actor: raw.actor,
    title: raw.title,
    body: raw.body,
    time: raw.ts ? new Date(raw.ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
    status: raw.status,
  };
}
