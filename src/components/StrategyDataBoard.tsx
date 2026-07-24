import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ListChecks, Target, TrendingUp, Users, Zap, MessageSquare, ArrowUpRight, CircleDollarSign } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import TrafficDataBoard from './TrafficDataBoard';
import InquiryDataBoard from './InquiryDataBoard';
import CrmDataBoard from './CrmDataBoard';
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

const defaultActionItems = [
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

const MOCK_TREND = [
  { label: '06-13', exposure: 28600, inquiries: 4 },
  { label: '06-20', exposure: 34200, inquiries: 6 },
  { label: '06-27', exposure: 39800, inquiries: 7 },
  { label: '07-04', exposure: 41600, inquiries: 8 },
  { label: '07-11', exposure: 52200, inquiries: 10 },
  { label: '07-18', exposure: 57700, inquiries: 12 },
  { label: '07-24', exposure: 72300, inquiries: 15 },
];

const MOCK_CHANNELS = [
  { channel: 'Facebook', inquiries: 18, converted: 6 },
  { channel: 'Instagram', inquiries: 13, converted: 4 },
  { channel: 'WhatsApp', inquiries: 9, converted: 3 },
  { channel: 'TikTok', inquiries: 5, converted: 1 },
  { channel: 'YouTube', inquiries: 2, converted: 0 },
];

const MOCK_ACTIONS = [
  {
    title: '优先跟进 3 个高意向报价客户',
    desc: 'Emma、Ahmed 和 Daniel 已进入报价或规格确认阶段，今天完成价格、MOQ 与样品确认。',
    basis: '依据：高意向客户 9 个，其中 3 个需要人工确认后才能继续推进。',
    agent: 'conversion' as const,
    task: '基于当前高意向客户与对话记录，整理今天必须人工确认的报价、MOQ、认证和样品事项。',
  },
  {
    title: '复用 Facebook 高转化内容结构',
    desc: 'Facebook 贡献 38% 的询盘和 43% 的已转化客户，下一批内容优先复用产品证明与工厂可信度结构。',
    basis: '依据：近 30 天渠道询盘与转化贡献对比。',
    agent: 'traffic' as const,
    task: '根据首页渠道贡献数据，整理 Facebook 高转化内容的可复用结构并生成下一批选题。',
  },
  {
    title: '唤醒 2 个沉默客户',
    desc: 'Olivia 与 Lucas 分别因预算和 MOQ 停滞，用低 MOQ、新品与混批方案做差异化唤醒。',
    basis: '依据：我的客户中沉默 30/60 天客户与最近异议。',
    agent: 'retention' as const,
    task: '为沉默客户分别生成基于其真实异议的唤醒策略，不发送泛化促销话术。',
  },
];

const titleLevel2 = 'text-base font-bold';
const sectionTitle = 'flex items-center gap-2 text-base font-bold text-text-primary';
const sectionIcon = 'flex h-6 w-6 items-center justify-center rounded-lg bg-green-50 text-green-700';
const bodyTitle = 'text-sm font-bold text-text-primary';
const metricValueText = 'text-2xl font-bold leading-none text-text-primary';
const actionTitleText = 'text-sm font-bold text-text-primary';
const bodyText = 'text-xs leading-snug text-text-secondary';
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
  const useMockOverview = !exposure.ready && orders.length === 0;

  const Active = (TABS.find(t => t.id === tab) ?? TABS[0]).Comp;
  const selectedMetrics = new Set(selectedMetricByTab[tab]);
  const whatsAppInquiries = useMemo(() => customers.filter(customer => customer.source === 'whatsapp'), [customers]);
  const effectiveInquiries = useMemo(() => whatsAppInquiries.filter(customer => customer.intentScore >= 70), [whatsAppInquiries]);
  const validOrders = useMemo(() => orders.filter(order => order.status !== '待付款' && order.status !== '退款'), [orders]);
  const convertedInquiries = useMemo(() => whatsAppInquiries.filter(customer => customer.stage === 'quoted' || customer.stage === 'won' || customer.orders.length > 0), [whatsAppInquiries]);
  const needsFollowup = useMemo(() => whatsAppInquiries.filter(customer => customer.handlingMode !== 'ai_auto' || customer.inboxReason), [whatsAppInquiries]);

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
    const inquiryCount = useMockOverview ? 47 : effectiveInquiries.length;
    const conversionRate = useMockOverview ? 14.9 : inquiryCount ? convertedInquiries.length / inquiryCount * 100 : 0;
    return [
      {
        id: 'exposure' as const,
        icon: <Zap size={15} className="text-green-600" />,
        label: '视频曝光',
        value: exposure.ready ? compact(exposure.value) : useMockOverview ? '28.6万' : '/',
        desc: exposure.ready ? '来自已授权社媒账号返回的视频播放量。' : '近 30 天内容曝光，演示数据。',
        source: exposure.ready ? '来源：社媒账号接口' : '演示数据 · 近30天',
        trend: '+31.6%',
      },
      {
        id: 'inquiry' as const,
        icon: <MessageSquare size={15} className="text-green-600" />,
        label: '有效询盘',
        value: String(inquiryCount),
        desc: '按我的客户 tab 中 WhatsApp 且意向分 >= 70 的客户计算。',
        source: '来源：我的客户 / WhatsApp',
        trend: '+17.5%',
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
        trend: '+3.2pp',
      },
      {
        id: 'followup' as const,
        icon: <Target size={15} className="text-green-600" />,
        label: '客户待跟进',
        value: String(useMockOverview ? 12 : needsFollowup.length),
        desc: '按 WhatsApp 客户中需人工处理或有待办原因的记录计算。',
        source: '来源：我的客户 / WhatsApp',
        trend: '-4',
      },
    ];
  }, [convertedInquiries.length, effectiveInquiries.length, exposure, needsFollowup.length, useMockOverview, validOrders.length]);

  const actionItems = useMockOverview ? MOCK_ACTIONS : defaultActionItems;

  return (
    <div className="h-full flex flex-col" data-lingshu-guide="strategy-dashboard">
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
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-text-primary">近 30 天获客经营总览</h2>
                <p className="mt-1 text-[11px] text-text-muted">从内容曝光到成交推进，先看趋势，再看渠道和待办。</p>
              </div>
              {useMockOverview && <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">演示数据</span>}
            </div>
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
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-green-700"><ArrowUpRight size={10} />{item.trend}</span>
                    <span className="truncate text-[9px] text-text-muted">{item.source}</span>
                  </div>
                </div>
                );
              })}
            </div>

            <div className="mt-3 grid gap-3 xl:grid-cols-[1.45fr_1fr]">
              <section className="rounded-2xl border border-border bg-white p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div><p className={bodyTitle}>获客趋势</p><p className="mt-1 text-[10px] text-text-muted">曝光持续增长时，询盘是否同步增长</p></div>
                  <span className="rounded-lg bg-green-50 px-2 py-1 text-[10px] font-bold text-green-700">询盘效率 1.64 / 万曝光</span>
                </div>
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={MOCK_TREND} margin={{ top: 8, right: 6, left: -16, bottom: 0 }}>
                      <defs>
                        <linearGradient id="exposureFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#16a34a" stopOpacity={0.28}/><stop offset="95%" stopColor="#16a34a" stopOpacity={0.02}/></linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false}/>
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}/>
                      <YAxis yAxisId="left" tickFormatter={value => `${Math.round(Number(value) / 1000)}k`} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}/>
                      <YAxis yAxisId="right" orientation="right" domain={[0, 18]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}/>
                      <Tooltip formatter={(value, name) => [name === 'exposure' ? compact(Number(value)) : value, name === 'exposure' ? '曝光' : '询盘']} labelStyle={{ fontSize: 11 }} contentStyle={{ borderRadius: 12, borderColor: '#dcfce7', fontSize: 11 }}/>
                      <Area yAxisId="left" type="monotone" dataKey="exposure" stroke="#16a34a" strokeWidth={2.5} fill="url(#exposureFill)"/>
                      <Area yAxisId="right" type="monotone" dataKey="inquiries" stroke="#0f766e" strokeWidth={2} fill="transparent"/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-1 flex items-center gap-4 text-[10px] text-text-muted"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-green-600"/>曝光</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-teal-700"/>询盘</span></div>
              </section>

              <section className="rounded-2xl border border-border bg-white p-4">
                <div className="mb-3"><p className={bodyTitle}>渠道询盘贡献</p><p className="mt-1 text-[10px] text-text-muted">对比询盘量与已转化数量，避免只看流量</p></div>
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={MOCK_CHANNELS} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false}/>
                      <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}/>
                      <YAxis type="category" dataKey="channel" width={62} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false}/>
                      <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#dcfce7', fontSize: 11 }}/>
                      <Bar dataKey="inquiries" name="询盘" fill="#86efac" radius={[0, 5, 5, 0]} barSize={12}/>
                      <Bar dataKey="converted" name="已转化" fill="#15803d" radius={[0, 5, 5, 0]} barSize={12}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </div>

            <section className="mt-3 rounded-2xl border border-border bg-surface-2 p-4">
              <div className="flex items-center gap-2"><span className={sectionIcon}><CircleDollarSign size={14}/></span><p className={bodyTitle}>获客转化漏斗</p><span className="ml-auto text-[10px] text-text-muted">近30天</span></div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {[['内容曝光','28.6万','100%'],['有效询盘','47','1.64/万曝光'],['进入报价','18','38.3%'],['已成交','7','14.9%']].map(([label,value,rate],index)=><div key={label} className="relative rounded-xl border border-border bg-white p-3"><p className="text-[10px] font-semibold text-text-muted">{label}</p><p className="mt-1 text-xl font-black text-text-primary">{value}</p><p className="mt-1 text-[9px] font-bold text-green-700">{rate}</p>{index<3&&<ArrowRight size={13} className="absolute -right-2.5 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white text-text-muted"/>}</div>)}
              </div>
            </section>

            <div className="mt-3 grid gap-3">
              <section className="rounded-2xl border border-border bg-white p-4">
                <div className={sectionTitle}>
                  <span className={sectionIcon}><ListChecks size={14} /></span>
                  <h2>本周优先动作</h2>
                </div>
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

        <div className="min-h-[520px] border-t border-border" id={tab === 'traffic' ? 'social-real-data' : undefined}>
          <Active windowDays={windowDays} />
        </div>
      </div>
    </div>
  );
}
