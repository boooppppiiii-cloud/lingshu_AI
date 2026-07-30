import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ListChecks, Target, TrendingUp, Users, Zap, MessageSquare, ArrowUpRight, CircleDollarSign, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
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

interface AdvisorRecommendation {
  id: string;
  title: string;
  desc: string;
  basis: string;
  target: string;
  confidence: '高' | '中' | '低';
  limitation: string;
  action: { page: Page; view?: string };
}

interface AdvisorResult {
  generatedAt: string;
  periodLabel: string;
  recommendations: AdvisorRecommendation[];
  dataQuality: { note: string };
  marketContext: {
    summary: string;
    sources: Array<{ title: string; uri: string }>;
    generatedAt: string;
  };
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
  const [exposure, setExposure] = useState<{ loaded: boolean; ready: boolean; value: number; accountCount: number }>({ loaded: false, ready: false, value: 0, accountCount: 0 });
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [advisor, setAdvisor] = useState<AdvisorResult | null>(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorError, setAdvisorError] = useState('');
  const { customers, loading: customersLoading } = useCustomers();
  const windowDays = 30;

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
      setExposure({ loaded: true, ready: socialItems.length + youtubeItems.length > 0, value: videoViews || accountViews, accountCount: socialItems.length + youtubeItems.length });
      setOrders(Array.isArray(orderData.items) ? orderData.items : []);
    })();
    return () => { alive = false; };
  }, []);

  const loadAdvisor = async (refreshExternal = false) => {
    setAdvisorLoading(true);
    setAdvisorError('');
    try {
      const response = await fetch('/api/overseas/strategy/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          refreshExternal,
          snapshot: {
            exposureReady: exposure.ready,
            exposure: exposure.value,
            inquiries: effectiveInquiries.length,
            quoted: convertedInquiries.length,
            orders: validOrders.length,
            followup: needsFollowup.length,
            accountCount: exposure.accountCount,
          },
        }),
      });
      if (!response.ok) throw new Error(`advisor_${response.status}`);
      setAdvisor(await response.json() as AdvisorResult);
    } catch {
      setAdvisorError('经营建议暂时无法刷新，请稍后重试。');
    } finally {
      setAdvisorLoading(false);
    }
  };

  useEffect(() => {
    if (!exposure.loaded || customersLoading) return;
    void loadAdvisor(false);
  }, [exposure.loaded, exposure.ready, exposure.value, exposure.accountCount, customersLoading, effectiveInquiries.length, convertedInquiries.length, validOrders.length, needsFollowup.length]);

  const chainMetrics = useMemo(() => {
    const inquiryCount = effectiveInquiries.length;
    const conversionRate = inquiryCount ? convertedInquiries.length / inquiryCount * 100 : 0;
    return [
      {
        id: 'exposure' as const,
        icon: <Zap size={15} className="text-green-600" />,
        label: '视频曝光',
        value: exposure.ready ? compact(exposure.value) : '/',
        desc: exposure.ready ? '来自已授权社媒账号返回的视频播放量。' : '尚未接入可读取曝光量的社媒账号。',
        source: exposure.ready ? '来源：社媒账号接口' : '暂无真实数据',
        trend: '',
      },
      {
        id: 'inquiry' as const,
        icon: <MessageSquare size={15} className="text-green-600" />,
        label: '有效询盘',
        value: String(inquiryCount),
        desc: '按我的客户 tab 中 WhatsApp 且意向分 >= 70 的客户计算。',
        source: '来源：我的客户 / WhatsApp',
        trend: '',
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
        trend: '',
      },
      {
        id: 'followup' as const,
        icon: <Target size={15} className="text-green-600" />,
        label: '客户待跟进',
        value: String(needsFollowup.length),
        desc: '按 WhatsApp 客户中需人工处理或有待办原因的记录计算。',
        source: '来源：我的客户 / WhatsApp',
        trend: '',
      },
    ];
  }, [convertedInquiries.length, effectiveInquiries.length, exposure, needsFollowup.length, validOrders.length]);

  const channelData = useMemo(() => {
    const grouped = new Map<string, { channel: string; inquiries: number; converted: number }>();
    for (const customer of customers) {
      const channel = customer.source || 'unknown';
      const item = grouped.get(channel) || { channel, inquiries: 0, converted: 0 };
      item.inquiries += 1;
      if (customer.stage === 'quoted' || customer.stage === 'won' || customer.orders.length > 0) item.converted += 1;
      grouped.set(channel, item);
    }
    return [...grouped.values()];
  }, [customers]);

  const funnelData = [
    ['内容曝光', exposure.ready ? compact(exposure.value) : '/', exposure.ready ? '社媒账号接口' : '未接入'],
    ['有效询盘', String(effectiveInquiries.length), '真实客户'],
    ['进入报价', String(convertedInquiries.length), '真实客户'],
    ['有效订单', String(validOrders.length), '真实订单'],
  ];

  const actionItems = advisor?.recommendations ?? [];

  const executeAdvisorAction = (item: AdvisorRecommendation) => {
    const { page, view } = item.action;
    try {
      if (page === 'traffic' && view) localStorage.setItem('lingshu:traffic:initial-view', view);
      if (page === 'conversion' && view) localStorage.setItem('lingshu:conversion:initial-view', view);
      if (page === 'enterprise' && view) localStorage.setItem('lingshu:enterprise:initial-view', view);
      localStorage.setItem('lingshu:advisor:last-action', JSON.stringify({ id: item.id, title: item.title, at: Date.now() }));
    } catch { /* ignore unavailable storage */ }
    onNavigate?.(page);
  };

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
                <h2 className="text-base font-black text-text-primary">当前获客经营总览</h2>
                <p className="mt-1 text-[11px] text-text-muted">从内容曝光到成交推进，先看趋势，再看渠道和待办。</p>
              </div>
              <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[10px] font-bold text-green-700">真实数据</span>
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
                    {item.trend ? <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-green-700"><ArrowUpRight size={10} />{item.trend}</span> : <span />}
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
                  <span className="rounded-lg bg-green-50 px-2 py-1 text-[10px] font-bold text-green-700">询盘效率 {exposure.ready && exposure.value > 0 ? `${(effectiveInquiries.length / exposure.value * 10000).toFixed(2)} / 万曝光` : '暂无真实数据'}</span>
                </div>
                <div className="flex h-[220px] items-center justify-center rounded-xl bg-surface-2 px-6 text-center text-xs text-text-muted">当前接口仅返回累计曝光，没有按日历史序列。接入平台 insights 时间序列后，这里将展示真实趋势。</div>
              </section>

              <section className="rounded-2xl border border-border bg-white p-4">
                <div className="mb-3"><p className={bodyTitle}>渠道询盘贡献</p><p className="mt-1 text-[10px] text-text-muted">对比询盘量与已转化数量，避免只看流量</p></div>
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={channelData} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
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
              <div className="flex items-center gap-2"><span className={sectionIcon}><CircleDollarSign size={14}/></span><p className={bodyTitle}>获客转化漏斗</p><span className="ml-auto text-[10px] text-text-muted">当前累计快照</span></div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {funnelData.map(([label,value,rate],index)=><div key={label} className="relative rounded-xl border border-border bg-white p-3"><p className="text-[10px] font-semibold text-text-muted">{label}</p><p className="mt-1 text-xl font-black text-text-primary">{value}</p><p className="mt-1 text-[9px] font-bold text-green-700">{rate}</p>{index<3&&<ArrowRight size={13} className="absolute -right-2.5 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white text-text-muted"/>}</div>)}
              </div>
            </section>

            <div className="mt-3 grid gap-3">
              <section className="rounded-2xl border border-border bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className={sectionTitle}>
                    <span className={sectionIcon}><ListChecks size={14} /></span>
                    <h2>本周优先动作</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadAdvisor(true)}
                    disabled={advisorLoading}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 text-[11px] font-bold text-text-secondary hover:bg-surface-2 disabled:opacity-60"
                  >
                    {advisorLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {advisorLoading ? '分析中' : '刷新分析'}
                  </button>
                </div>
                <div className="mt-3 space-y-2.5">
                  {advisorLoading && !actionItems.length && (
                    <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-border bg-surface text-xs text-text-muted">
                      <Loader2 size={14} className="mr-2 animate-spin" />正在结合经营数据与外部趋势生成建议
                    </div>
                  )}
                  {advisorError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{advisorError}</p>}
                  {actionItems.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => executeAdvisorAction(item)}
                      className="flex w-full items-start gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-green-200 hover:bg-green-50/60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={actionTitleText}>{item.title}</span>
                          <span className="rounded-md border border-green-200 bg-green-50 px-1.5 py-0.5 text-[9px] font-bold text-green-700">置信度 {item.confidence}</span>
                        </span>
                        <span className={`mt-1 block ${bodyText}`}>{item.desc}</span>
                        <span className={`mt-1.5 block ${supplementText}`}>{item.basis}</span>
                        <span className="mt-1 block text-[11px] font-semibold text-text-secondary">{item.target}</span>
                        <span className="mt-1 block text-[10px] text-text-muted">限制：{item.limitation}</span>
                      </span>
                      <ArrowRight size={14} className="mt-1 text-text-muted" />
                    </button>
                  ))}
                </div>
                {advisor?.marketContext.summary && (
                  <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/60 px-3.5 py-3">
                    <p className="text-[11px] font-black text-sky-900">外部市场信号</p>
                    <p className="mt-1 whitespace-pre-line text-[11px] leading-5 text-sky-900/80">{advisor.marketContext.summary}</p>
                    {!!advisor.marketContext.sources.length && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {advisor.marketContext.sources.map(source => (
                          <a key={source.uri} href={source.uri} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 rounded-md bg-white px-2 py-1 text-[10px] font-bold text-sky-700 hover:underline">
                            <ExternalLink size={10} /><span className="truncate">{source.title}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {advisor?.dataQuality.note && <p className="mt-2 text-[10px] text-text-muted">数据口径：{advisor.dataQuality.note}</p>}
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
