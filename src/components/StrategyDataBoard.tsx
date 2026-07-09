import { useState } from 'react';
import { ArrowRight, ListChecks, Target, TrendingUp, Users, Zap, MessageSquare } from 'lucide-react';
import TrafficDataBoard from './TrafficDataBoard';
import InquiryDataBoard from './InquiryDataBoard';
import CrmDataBoard from './CrmDataBoard';
import type { AgentAction } from '../App';

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

const chainMetrics = [
  {
    id: 'exposure' as const,
    icon: <Zap size={15} className="text-green-600" />,
    label: '视频曝光',
    value: '/',
    desc: '等待 TikTok / Instagram / YouTube 真实账号授权后回填。',
    source: '来源：社媒账号接口',
  },
  {
    id: 'inquiry' as const,
    icon: <MessageSquare size={15} className="text-green-600" />,
    label: '有效询盘',
    value: '/',
    desc: '等待 WhatsApp、站内 DM、表单等真实询盘数据回填。',
    source: '来源：WhatsApp / 社媒私信 / 表单',
  },
  {
    id: 'conversion' as const,
    icon: <TrendingUp size={15} className="text-green-600" />,
    label: '询盘转化率',
    value: '/',
    desc: '需要询盘、报价、成交订单打通后计算真实转化。',
    source: '来源：询盘记录 + 订单数据',
  },
  {
    id: 'followup' as const,
    icon: <Target size={15} className="text-green-600" />,
    label: '客户待跟进',
    value: '/',
    desc: '需要客户互动、报价状态和历史采购数据来识别优先级。',
    source: '来源：客户中心 / WhatsApp / 订单',
  },
];

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

const titleLevel1 = 'text-2xl font-bold text-text-primary font-display';
const titleLevel2 = 'text-lg font-bold';
const sectionTitle = 'flex items-center gap-2 text-lg font-bold text-text-primary';
const sectionIcon = 'flex h-7 w-7 items-center justify-center rounded-lg bg-green-50 text-green-700';
const bodyTitle = 'text-base font-bold text-text-primary';
const metricValueText = 'text-3xl font-bold text-text-primary';
const actionTitleText = 'text-sm font-bold text-green-700';
const bodyText = 'text-sm leading-relaxed text-text-secondary';
const noteText = 'text-xs leading-relaxed text-text-muted';
const supplementText = 'text-xs font-bold leading-relaxed text-green-700';

export default function StrategyDataBoard({ onAction }: { onAction?: AgentAction }) {
  const [tab, setTab] = useState<TabId>('traffic');
  const windowDays = 30;

  const Active = (TABS.find(t => t.id === tab) ?? TABS[0]).Comp;
  const selectedMetrics = new Set(selectedMetricByTab[tab]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-5 pb-4 border-b border-border flex-shrink-0">
        <h1 className={titleLevel1}>经营仪表盘</h1>
        <div className="mt-4 grid w-full grid-cols-3 gap-2 rounded-2xl border border-border bg-surface-2 p-1 shadow-sm">
          {TABS.map(x => (
            <button key={x.id} onClick={() => setTab(x.id)}
              className={`flex h-12 items-center justify-center gap-2 rounded-xl ${titleLevel2} transition-all ${
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
        <div className="px-6 py-5">
          <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="grid gap-3 md:grid-cols-4">
              {chainMetrics.map(item => {
                const active = selectedMetrics.has(item.id);
                return (
                <div
                  key={item.label}
                  className={`rounded-xl border p-4 transition-all ${
                    active
                      ? 'border-green-200 bg-green-50 shadow-sm ring-1 ring-green-100'
                      : 'border-border bg-surface'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {item.icon}
                    <h3 className={bodyTitle}>{item.label}</h3>
                  </div>
                  <p className={`mt-3 ${metricValueText}`}>{item.value}</p>
                  <p className={`mt-1 ${noteText}`}>{item.desc}</p>
                  <p className={`mt-3 ${supplementText}`}>{item.source}</p>
                </div>
                );
              })}
            </div>

            <div className="mt-5 grid gap-4">
              <section className="rounded-2xl border border-border bg-white p-5">
                <div className={sectionTitle}>
                  <span className={sectionIcon}><ListChecks size={15} /></span>
                  <h2>本周优先动作</h2>
                </div>
                <p className={`mt-2 ${noteText}`}>动作只基于已接入数据或明确标注的数据缺口生成。</p>
                <div className="mt-4 space-y-3">
                  {actionItems.map(item => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => onAction?.(item.agent, item.task)}
                      className="flex w-full items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 text-left transition-colors hover:border-green-200 hover:bg-green-50/60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className={`block ${actionTitleText}`}>{item.title}</span>
                        <span className={`mt-1.5 block ${bodyText}`}>{item.desc}</span>
                        <span className={`mt-2.5 block ${supplementText}`}>{item.basis}</span>
                      </span>
                      <ArrowRight size={14} className="mt-1 text-text-muted" />
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </section>
        </div>

        <div className="min-h-[520px] border-t border-border">
          <Active windowDays={windowDays} />
        </div>
      </div>
    </div>
  );
}
