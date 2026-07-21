import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ListChecks, Target, TrendingUp, Users, Zap, MessageSquare } from 'lucide-react';
import TrafficDataBoard from './TrafficDataBoard';
import InquiryDataBoard from './InquiryDataBoard';
import CrmDataBoard from './CrmDataBoard';
import { CalendarPlanner } from './publishing/CalendarPlanner';
import type { AgentAction, Page } from '../App';
import { authHeader } from '../lib/auth';
import { useCustomers } from '../hooks/useCustomers';

/* 策略页「数据大屏」——全平台经营数据只在策略 agent 看（负责"想"）；
   流量/转化/留存三个 agent 是干活的工作台，不看数据。
   三个 tab：社媒 / 询盘 / 客户。 */

const TABS = [
  { id: 'traffic', label: '社媒', icon: Zap, Comp: TrafficDataBoard },
  { id: 'inquiry', label: '询盘', icon: MessageSquare, Comp: InquiryDataBoard },
  { id: 'crm', label: '客户', icon: Users, Comp: CrmDataBoard },
] as const;
type TabId = typeof TABS[number]['id'];
type MetricId = 'exposure' | 'inquiry' | 'conversion' | 'followup';

type OrderStatus = '待付款' | '已付款' | '生产中' | '已发货' | '已完成' | '退款';
interface OrderRecord {
  buyer: string;
  amount: number;
  status: OrderStatus;
}
interface SocialAccount {
  id: string;
  platform: 'tiktok' | 'instagram' | 'facebook';
  title?: string;
  handle?: string;
  viewCount?: number;
}
interface YouTubeAccount {
  id: string;
  channelTitle?: string;
  viewCount?: number;
}

async function readJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { headers: authHeader() });
    if (!res.ok) return fallback;
    return await res.json() as T;
  } catch {
    return fallback;
  }
}

function num(value: unknown): number {
  return Number(value || 0) || 0;
}

function compact(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString();
}

function pct(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

const selectedMetricByTab: Record<TabId, MetricId[]> = {
  traffic: ['exposure', 'inquiry'],
  inquiry: ['inquiry', 'conversion'],
  crm: ['conversion', 'followup'],
};

const actionItems = [
  {
    title: '接入社媒与询盘真实数据',
    desc: '先完成 TikTok / Instagram / YouTube 与 WhatsApp 授权，再生成获客和销转动作。',
    basis: '依据：当前仪表盘未读取到真实社媒曝光、询盘、成交链路数据。',
    agent: 'traffic' as const,
    task: '检查社媒账号和 WhatsApp 询盘数据接入状态，只基于已授权的真实数据输出缺口和下一步接入清单。',
  },
  {
    title: '整理企业中心可用经营资料',
    desc: '把主推品、MOQ、认证、价格带、目标市场补齐，作为后续脚本和报价的可信依据。',
    basis: '依据：企业中心资料可作为内容和报价生成的唯一内部业务来源。',
    agent: 'conversion' as const,
    task: '基于企业中心资料整理可用于询盘回复的产品、MOQ、认证、价格带和交期信息；缺失项必须标出，不允许补写。',
  },
  {
    title: '联网校验行业趋势后再给策略',
    desc: '涉及市场趋势、平台打法或竞品机会时，必须引用可核验来源，不用猜测替代。',
    basis: '依据：外部市场判断需来自公开行业数据、平台报告或可访问网页。',
    agent: 'retention' as const,
    task: '在没有真实客户和订单数据前，只输出需要联网核验的行业问题清单；不要生成未证实的复购名单或数字。',
  },
];

const titleLevel2 = 'text-base font-bold';
const sectionTitle = 'flex items-center gap-2 text-base font-bold text-text-primary';
const sectionIcon = 'flex h-6 w-6 items-center justify-center rounded-lg bg-green-50 text-green-700';
const bodyTitle = 'text-sm font-bold text-text-primary';
const metricValueText = 'text-2xl font-bold leading-none text-text-primary';
const actionTitleText = 'text-sm font-bold text-text-primary';
const bodyText = 'text-xs leading-snug text-text-secondary';
const noteText = 'text-[11px] leading-snug text-text-muted';
const supplementText = 'text-[11px] font-bold leading-snug text-green-700';

export default function StrategyDataBoard({
  onAction,
  onNavigate,
}: {
  onAction?: AgentAction;
  onNavigate?: (page: Page) => void;
}) {
  const [tab, setTab] = useState<TabId>('traffic');
  const [exposure, setExposure] = useState<{ ready: boolean; value: number }>({ ready: false, value: 0 });
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const { customers } = useCustomers();
  const windowDays = 30;

  const Active = (TABS.find(t => t.id === tab) ?? TABS[0]).Comp;
  const selectedMetrics = new Set(selectedMetricByTab[tab]);
  const whatsAppInquiries = useMemo(() => customers.filter(customer => customer.source === 'whatsapp'), [customers]);
  const effectiveInquiries = useMemo(() => whatsAppInquiries.filter(customer => customer.intentScore >= 70), [whatsAppInquiries]);
  const validOrders = useMemo(() => orders.filter(order => order.status !== '待付款' && order.status !== '退款'), [orders]);
  const convertedInquiries = useMemo(() => whatsAppInquiries.filter(customer => customer.stage === 'quoted' || customer.stage === 'won' || customer.orders.length > 0), [whatsAppInquiries]);
  const needsFollowup = useMemo(() => whatsAppInquiries.filter(customer => customer.handlingMode !== 'ai_auto' || customer.inboxReason), [whatsAppInquiries]);

  const openPublishForDate = (date: Date) => {
    const draft = { title: `排期内容 ${date.toLocaleDateString()}`, description: '', videoPath: '' };
    try {
      localStorage.setItem('ow_publish_draft', JSON.stringify(draft));
      localStorage.setItem('lingshu:traffic:initial-view', 'publish');
    } catch { /* ignore */ }
    onNavigate?.('traffic');
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const [social, youtube, orderData] = await Promise.all([
        readJson<{ items?: SocialAccount[] }>('/api/overseas/social/accounts', { items: [] }),
        readJson<{ items?: YouTubeAccount[] }>('/api/overseas/youtube/accounts', { items: [] }),
        readJson<{ items?: OrderRecord[] }>('/api/overseas/enterprise/orders', { items: [] }),
      ]);
      const socialItems = social.items ?? [];
      const youtubeItems = youtube.items ?? [];
      const videoResults = await Promise.allSettled([
        ...socialItems.map(async account => {
          const data = await readJson<{ videos?: any[] }>(`/api/overseas/social/accounts/${account.id}/videos?maxResults=50`, { videos: [] });
          return (data.videos ?? []).reduce((sum, video) => sum + num(video.viewCount || video.statistics?.viewCount), 0);
        }),
        ...youtubeItems.map(async account => {
          const data = await readJson<{ videos?: any[] }>(`/api/overseas/youtube/accounts/${account.id}/videos?maxResults=50`, { videos: [] });
          return (data.videos ?? []).reduce((sum, video) => sum + num(video.viewCount || video.statistics?.viewCount), 0);
        }),
      ]);
      const videoViews = videoResults.reduce((sum, result) => sum + (result.status === 'fulfilled' ? result.value : 0), 0);
      const accountViews = [...socialItems, ...youtubeItems].reduce((sum, account) => sum + num(account.viewCount), 0);
      if (!alive) return;
      setExposure({ ready: socialItems.length + youtubeItems.length > 0, value: videoViews || accountViews });
      setOrders(Array.isArray(orderData.items) ? orderData.items : []);
    })();
    return () => { alive = false; };
  }, []);

  const chainMetrics = useMemo(() => {
    const inquiryCount = effectiveInquiries.length;
    const conversionRate = inquiryCount ? convertedInquiries.length / inquiryCount * 100 : 0;
    return [
      {
        id: 'exposure' as const,
        icon: <Zap size={15} className="text-green-600" />,
        label: '视频曝光',
        value: exposure.ready ? compact(exposure.value) : '/',
        desc: exposure.ready ? '来自已授权社媒账号返回的视频播放量。' : '等待 TikTok / Instagram / YouTube 真实账号授权后回填。',
        source: '来源：社媒账号接口',
      },
      {
        id: 'inquiry' as const,
        icon: <MessageSquare size={15} className="text-green-600" />,
        label: '有效询盘',
        value: String(inquiryCount),
        desc: '按我的客户 tab 中 WhatsApp 且意向分 >= 70 的客户计算。',
        source: '来源：我的客户 / WhatsApp',
      },
      {
        id: 'conversion' as const,
        icon: <TrendingUp size={15} className="text-green-600" />,
        label: '询盘转化率',
        value: inquiryCount ? pct(conversionRate) : '/',
        desc: validOrders.length
          ? `按已报价/成交 WhatsApp 询盘计算，并参考 ${validOrders.length} 个有效订单。`
          : '按已报价/成交 WhatsApp 询盘计算；订单未打通时不额外推断。',
        source: '来源：我的客户 + 我的订单',
      },
      {
        id: 'followup' as const,
        icon: <Target size={15} className="text-green-600" />,
        label: '客户待跟进',
        value: String(needsFollowup.length),
        desc: '按 WhatsApp 客户中需人工处理或有待办原因的记录计算。',
        source: '来源：我的客户 / WhatsApp',
      },
    ];
  }, [convertedInquiries.length, effectiveInquiries.length, exposure, needsFollowup.length, validOrders.length]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-3 pb-3 border-b border-border flex-shrink-0">
        <div className="grid w-full grid-cols-3 gap-1.5 rounded-2xl border border-border bg-surface-2 p-1 shadow-sm">
          {TABS.map(x => (
            <button key={x.id} onClick={() => setTab(x.id)}
              className={`flex h-10 items-center justify-center gap-2 rounded-xl ${titleLevel2} transition-all ${
                tab === x.id
                  ? 'bg-white text-green-700 shadow-md ring-1 ring-green-100'
                  : 'text-text-muted hover:bg-white/70 hover:text-text-primary'
              }`}>
              <x.icon size={18} /> {x.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-6 py-4">
          <section className="rounded-2xl border border-border bg-white p-4 shadow-sm">
            <div className="grid gap-2.5 md:grid-cols-4">
              {chainMetrics.map(item => {
                const active = selectedMetrics.has(item.id);
                return (
                <div
                  key={item.label}
                  className={`rounded-xl border p-3 transition-all ${
                    active
                      ? 'border-green-200 bg-green-50 shadow-sm ring-1 ring-green-100'
                      : 'border-border bg-surface'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {item.icon}
                    <h3 className={bodyTitle}>{item.label}</h3>
                  </div>
                  <p className={`mt-2.5 ${metricValueText}`}>{item.value}</p>
                  <p className={`mt-1 ${noteText}`}>{item.desc}</p>
                  <p className={`mt-2 ${supplementText}`}>{item.source}</p>
                </div>
                );
              })}
            </div>

            <div className="mt-3 grid gap-3">
              <section className="rounded-2xl border border-border bg-white p-4">
                <div className={sectionTitle}>
                  <span className={sectionIcon}><ListChecks size={14} /></span>
                  <h2>本周优先动作</h2>
                </div>
                <p className={`mt-1.5 ${noteText}`}>动作只基于已接入数据或明确标注的数据缺口生成。</p>
                <div className="mt-3 space-y-2.5">
                  {actionItems.map(item => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => onAction?.(item.agent, item.task)}
                      className="flex w-full items-start gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-green-200 hover:bg-green-50/60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className={`block ${actionTitleText}`}>{item.title}</span>
                        <span className={`mt-1 block ${bodyText}`}>{item.desc}</span>
                        <span className={`mt-1.5 block ${supplementText}`}>{item.basis}</span>
                      </span>
                      <ArrowRight size={14} className="mt-1 text-text-muted" />
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </section>
        </div>

        {tab === 'traffic' && (
          <section className="border-t border-border px-6 py-5" id="content-calendar">
            <CalendarPlanner
              onCreate={openPublishForDate}
              onOpenPost={() => document.getElementById('social-real-data')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            />
          </section>
        )}

        <div className="min-h-[520px] border-t border-border" id={tab === 'traffic' ? 'social-real-data' : undefined}>
          <Active windowDays={windowDays} />
        </div>
      </div>
    </div>
  );
}
