import { useMemo, useState, useEffect } from 'react';
import { Info, Sparkles, Loader2, AlertCircle, Clock } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { studioApi } from '../lib/studioApi';
import { authHeader } from '../lib/auth';

/* 询盘页 = 线索经营（跨境询盘视角）。
   命题：漏斗转化 · 响应时效 · 来源 · 内容回溯 · 跟进。占位数据，接入 WhatsApp/DM/邮件/表单+订单后替换。 */

interface Rec {
  id: string; customer: string; channel: string; platform: string; lang: string;
  intent: '高' | '中' | '低'; product: string; firstResp: number | null;
  status: '待响应' | '待跟进' | '已报价' | '已成交' | '流失'; amount: number; daysAgo: number;
}

const RECORDS: Rec[] = [
  { id: 'i1',  customer: 'Ahmed K.',  channel: 'WhatsApp',   platform: 'TikTok',    lang: '阿语', intent: '高', product: '', firstResp: 4,    status: '已成交', amount: 3900, daysAgo: 0 },
  { id: 'i2',  customer: 'Maria L.',  channel: '站内 DM',     platform: 'Instagram', lang: '西语', intent: '中', product: '', firstResp: 11,   status: '已报价', amount: 0,    daysAgo: 1 },
  { id: 'i3',  customer: 'John P.',   channel: '邮件',        platform: 'YouTube',   lang: '英语', intent: '中', product: '', firstResp: 38,   status: '待跟进', amount: 0,    daysAgo: 2 },
  { id: 'i4',  customer: 'Fatima Z.', channel: 'WhatsApp',   platform: 'TikTok',    lang: '阿语', intent: '高', product: '', firstResp: 6,    status: '已成交', amount: 2740, daysAgo: 2 },
  { id: 'i5',  customer: 'Diego R.',  channel: '站内 DM',     platform: 'Instagram', lang: '西语', intent: '低', product: '', firstResp: 22,   status: '流失',   amount: 0,    daysAgo: 3 },
  { id: 'i6',  customer: 'Sara M.',   channel: 'WhatsApp',   platform: 'TikTok',    lang: '阿语', intent: '高', product: '', firstResp: 5,    status: '已成交', amount: 1980, daysAgo: 4 },
  { id: 'i8',  customer: 'Layla H.',  channel: 'WhatsApp',   platform: 'Instagram', lang: '阿语', intent: '中', product: '', firstResp: 9,    status: '已报价', amount: 0,    daysAgo: 6 },
  { id: 'i9',  customer: 'Chen Y.',   channel: '邮件',        platform: 'YouTube',   lang: '英语', intent: '低', product: '', firstResp: 41,   status: '待跟进', amount: 0,    daysAgo: 8 },
  { id: 'i10', customer: 'Noor A.',   channel: 'WhatsApp',   platform: 'TikTok',    lang: '阿语', intent: '高', product: '', firstResp: 7,    status: '已成交', amount: 3400, daysAgo: 9 },
  { id: 'i11', customer: 'Pablo S.',  channel: '站内 DM',     platform: 'Instagram', lang: '西语', intent: '中', product: '', firstResp: 14,   status: '已报价', amount: 0,    daysAgo: 11 },
  { id: 'i13', customer: 'Yusuf B.',  channel: 'WhatsApp',   platform: 'TikTok',    lang: '阿语', intent: '高', product: '', firstResp: 8,    status: '已成交', amount: 2200, daysAgo: 15 },
  { id: 'i14', customer: 'Anna K.',   channel: '邮件',        platform: 'YouTube',   lang: '英语', intent: '中', product: '', firstResp: 35,   status: '流失',   amount: 0,    daysAgo: 22 },
];

// 汇总（按 30 天基准，随窗口缩放）
const BASE = { inq: 642, resp: 603, quote: 271, deal: 198, firstResp: 8, respRate: 94, conv: 31, unresp: 23 };
const TIMING = [{ band: '<5分', conv: 39 }, { band: '5-15分', conv: 32 }, { band: '15-60分', conv: 23 }, { band: '>1时', conv: 13 }];
const SOURCE = [{ name: 'WhatsApp', value: 71, conv: 33, color: '#185FA5' }, { name: '站内 DM', value: 18, conv: 30, color: '#1D9E75' }, { name: '邮件', value: 8, conv: 26, color: '#BA7517' }, { name: '独立站表单', value: 3, conv: 22, color: '#7F77DD' }];
const TRACE = [{ topic: '痛点解决', inq: 142 }, { topic: '促销', inq: 88 }, { topic: '达人种草', inq: 74 }, { topic: '测评', inq: 61 }];
const INTENT = [{ k: '高', v: 28, c: '#16a34a' }, { k: '中', v: 49, c: '#3b82f6' }, { k: '低', v: 23, c: '#9ca3af' }];
const REJECT = [{ k: '价格', v: 38 }, { k: '物流时效', v: 24 }, { k: 'MOQ', v: 19 }, { k: '缺货', v: 11 }, { k: '其他', v: 8 }];

const uniq = (k: keyof Rec) => ['全部', ...Array.from(new Set(RECORDS.map(r => String(r[k]))))];
const F = { channel: uniq('channel'), platform: uniq('platform'), lang: uniq('lang'), intent: uniq('intent'), status: uniq('status') };
const STATUS_C: Record<string, { bg: string; fg: string }> = {
  待响应: { bg: '#FAEEDA', fg: '#854F0B' }, 待跟进: { bg: '#FAEEDA', fg: '#854F0B' },
  已报价: { bg: '#E6F1FB', fg: '#185FA5' }, 已成交: { bg: '#E1F5EE', fg: '#0F6E56' }, 流失: { bg: 'var(--color-surface-2)', fg: 'var(--color-text-muted)' },
};
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const C = { bg: '#E6F1FB', label: '#185FA5', value: '#0C447C' };

interface EnterpriseProfileForBoard {
  products?: { categories?: string; highlights?: string; moq?: string };
  strategy?: { focusProducts?: string };
}

function splitProductText(value?: string): string[] {
  return String(value || '')
    .split(/[\n,，;；、/]+/)
    .map(item => item.trim().replace(/^[-*]\s*/, ''))
    .filter(Boolean)
    .filter(item => item.length <= 24);
}

function productOptionsFromProfile(profile: EnterpriseProfileForBoard | null): string[] {
  const names = [
    ...splitProductText(profile?.strategy?.focusProducts),
    ...splitProductText(profile?.products?.categories),
  ];
  const uniqNames = Array.from(new Set(names)).slice(0, 6);
  return uniqNames.length ? uniqNames : ['企业中心主推品'];
}

function productForRow(products: string[], index: number): string {
  const qty = [500, 200, 100, 300, 150, 80, 250][index % 7];
  const name = products[index % products.length] || '企业中心主推品';
  return index % 3 === 2 ? name : `${name} ×${qty}`;
}

export default function InquiryDataBoard({ windowDays = 30 }: { windowDays?: number }) {
  const [tf, setTf] = useState({ channel: '全部', platform: '全部', lang: '全部', intent: '全部', status: '全部' });
  const setF = (k: keyof typeof tf, v: string) => setTf(s => ({ ...s, [k]: v }));
  const [insight, setInsight] = useState<{ summary: string; actions: string[] } | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [enterpriseProducts, setEnterpriseProducts] = useState<string[]>(['企业中心主推品']);

  useEffect(() => {
    let alive = true;
    fetch('/api/overseas/enterprise/profile', { headers: authHeader() })
      .then(r => r.ok ? r.json() : null)
      .then((profile: EnterpriseProfileForBoard | null) => {
        if (alive) setEnterpriseProducts(productOptionsFromProfile(profile));
      })
      .catch(() => { if (alive) setEnterpriseProducts(['企业中心主推品']); });
    return () => { alive = false; };
  }, []);

  const mul = windowDays / 30;
  const a = useMemo(() => ({
    inq: Math.round(BASE.inq * mul), resp: Math.round(BASE.resp * mul), quote: Math.round(BASE.quote * mul),
    deal: Math.round(BASE.deal * mul), unresp: Math.round(BASE.unresp * mul),
  }), [mul]);
  const funnel = [
    { name: '询盘', value: a.inq, color: '#0C447C' },
    { name: '响应', value: a.resp, color: '#185FA5' },
    { name: '报价', value: a.quote, color: '#378ADD' },
    { name: '成交', value: a.deal, color: '#16a34a' },
  ];

  const rows = useMemo(() => RECORDS.map((r, index) => ({ ...r, product: productForRow(enterpriseProducts, index) })).filter(r => r.daysAgo <= windowDays
    && (tf.channel === '全部' || r.channel === tf.channel)
    && (tf.platform === '全部' || r.platform === tf.platform)
    && (tf.lang === '全部' || r.lang === tf.lang)
    && (tf.intent === '全部' || r.intent === tf.intent)
    && (tf.status === '全部' || r.status === tf.status)), [windowDays, tf, enterpriseProducts]);

  useEffect(() => {
    let cancelled = false; setInsightLoading(true);
    const t = setTimeout(async () => {
      const r = await studioApi.insight({ scope: 'inquiry', metrics: { 询盘: a.inq, 响应率: `${BASE.respRate}%`, 首响: `${BASE.firstResp}分`, 成交转化: `${BASE.conv}%`, 未响应: a.unresp, 主力渠道: 'WhatsApp 71%', 最高转化市场: '阿语' } });
      if (cancelled) return;
      if (r.summary) setInsight({ summary: r.summary, actions: r.actions ?? [] });
      else setInsight({ summary: `本期 ${a.inq} 询盘，WhatsApp 占 71%，阿语市场转化最高；${a.unresp} 条超时未响应待跟进。`, actions: ['优先跟进未响应询盘', 'WhatsApp 配自动首响', '高意向阿语单优先报价'] });
      setInsightLoading(false);
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.inq, a.unresp]);

  const sel = 'rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs outline-none hover:border-border-bright';
  const card = 'card !rounded-xl p-4';

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="max-w-5xl mx-auto">
        {/* AI 结论 */}
        <div className="rounded-xl p-3.5 mb-5 flex items-start gap-2.5" style={{ background: 'var(--color-accent-glow)' }}>
          <Sparkles size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-accent)' }} />
          <div className="min-w-0 flex-1">
            {insightLoading && !insight ? (
              <p className="text-sm text-text-secondary flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> AI 正在解读本期询盘…</p>
            ) : (
              <>
                <p className="text-sm font-semibold text-text-primary leading-snug">{insight?.summary}</p>
                {insight?.actions?.length ? <div className="flex flex-wrap gap-1.5 mt-2">{insight.actions.map((x, i) => <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-surface text-text-secondary border border-border">{x}</span>)}</div> : null}
              </>
            )}
          </div>
        </div>

        {/* 一号位：漏斗 + KPI + 未响应 */}
        <div className="grid lg:grid-cols-3 gap-4 mb-6">
          <div className={`${card} lg:col-span-2`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-text-primary">询盘转化漏斗</span>
              <span className="text-xs text-text-muted">询盘 → 成交 {BASE.conv}%</span>
            </div>
            <div className="space-y-2">
              {funnel.map((s, i) => {
                const w = Math.round(s.value / funnel[0].value * 100);
                const conv = i === 0 ? null : Math.round(s.value / funnel[i - 1].value * 100);
                return (
                  <div key={s.name} className="flex items-center gap-3">
                    <span className="w-8 text-xs text-text-secondary flex-shrink-0">{s.name}</span>
                    <div className="flex-1 h-7 rounded-md relative overflow-hidden bg-surface-2">
                      <div className="h-full rounded-md flex items-center px-2" style={{ width: `${w}%`, background: s.color }}>
                        <span className="text-[11px] font-semibold text-white">{s.value.toLocaleString()}</span>
                      </div>
                    </div>
                    <span className="w-12 text-[11px] text-text-muted flex-shrink-0 text-right">{conv === null ? '—' : `↓ ${conv}%`}</span>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-3 mt-4">
              {[['首响时长', `${BASE.firstResp} 分钟`], ['响应率', `${BASE.respRate}%`], ['询盘→成交', `${BASE.conv}%`]].map(([l, v]) => (
                <div key={l} className="rounded-lg p-2.5" style={{ background: C.bg }}><p className="text-[11px]" style={{ color: C.label }}>{l}</p><p className="text-lg font-bold mt-0.5" style={{ color: C.value }}>{v}</p></div>
              ))}
            </div>
          </div>
          {/* 未响应跟进 */}
          <div className={card} style={{ borderColor: '#EF9F27' }}>
            <div className="flex items-center gap-2 mb-2"><AlertCircle size={16} style={{ color: '#BA7517' }} /><span className="text-sm font-semibold text-text-primary">待跟进</span></div>
            <p className="text-4xl font-bold" style={{ color: '#854F0B' }}>{a.unresp}</p>
            <p className="text-xs text-text-muted mt-1">条超时未响应（&gt;30 分钟）</p>
            <p className="text-[11px] text-text-muted mt-3 flex items-center gap-1"><Clock size={12} /> 首响每快 10 分钟，成交率约 +6pp</p>
            <button className="btn-primary w-full !py-2 mt-3 !text-xs">一键分配跟进</button>
          </div>
        </div>

        {/* 响应时效 → 成交率 + 来源拆分 */}
        <div className="grid lg:grid-cols-2 gap-4 mb-6">
          <div className={card}>
            <p className="text-sm font-semibold text-text-primary mb-1">响应越快，成交越高</p>
            <p className="text-[11px] text-text-muted mb-2">按首响时长分档的成交率</p>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={TIMING} margin={{ top: 8, right: 10, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="band" tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" unit="%" />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={((v: number) => [`${v}%`, '成交率']) as never} cursor={{ fill: 'var(--color-surface-2)' }} />
                  <Bar dataKey="conv" radius={[4, 4, 0, 0]}>
                    {TIMING.map((_, i) => <Cell key={i} fill={i === 0 ? '#16a34a' : '#185FA5'} fillOpacity={1 - i * 0.18} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className={card}>
            <p className="text-sm font-semibold text-text-primary mb-2">询盘来源</p>
            <div className="flex items-center gap-3">
              <div className="w-[130px] h-[150px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={SOURCE} dataKey="value" nameKey="name" innerRadius={38} outerRadius={62} paddingAngle={2} stroke="none">
                      {SOURCE.map((s, i) => <Cell key={i} fill={s.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={((v: number, n: string) => [`${v}%`, n]) as never} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                {SOURCE.map(s => (
                  <div key={s.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="text-text-muted">{s.value}%</span>
                    <span className="text-text-secondary w-14 text-right">转化 {s.conv}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 内容回溯 + 意向 */}
        <div className="grid lg:grid-cols-2 gap-4 mb-6">
          <div className={card}>
            <p className="text-sm font-semibold text-text-primary mb-1">询盘来自哪类内容</p>
            <p className="text-[11px] text-text-muted mb-3">回溯到带来询盘的内容选题（接流量页）</p>
            {TRACE.map(t => (
              <div key={t.topic} className="mb-2.5">
                <div className="flex justify-between text-xs"><span>{t.topic}</span><span className="text-text-muted">{t.inq} 询盘</span></div>
                <div className="h-1.5 rounded-full bg-surface-2 mt-1 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${t.inq / TRACE[0].inq * 100}%`, background: '#185FA5' }} /></div>
              </div>
            ))}
          </div>
          <div className={card}>
            <p className="text-sm font-semibold text-text-primary mb-3">意向分级</p>
            <div className="flex h-7 rounded-md overflow-hidden mb-3">
              {INTENT.map(x => <div key={x.k} style={{ width: `${x.v}%`, background: x.c }} className="flex items-center justify-center text-[11px] font-semibold text-white">{x.v}%</div>)}
            </div>
            <div className="flex gap-4">
              {INTENT.map(x => <span key={x.k} className="flex items-center gap-1.5 text-xs text-text-secondary"><span className="w-2.5 h-2.5 rounded-full" style={{ background: x.c }} />{x.k}意向</span>)}
            </div>
            <p className="text-[11px] text-text-muted mt-4">拒绝/流失原因</p>
            <div className="flex h-2.5 rounded-full overflow-hidden mt-2">
              {REJECT.map((x, i) => <div key={x.k} style={{ width: `${x.v}%`, background: `hsl(210 50% ${68 - i * 8}%)` }} />)}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {REJECT.map(x => <span key={x.k} className="text-[10px] text-text-muted">{x.k} {x.v}%</span>)}
            </div>
          </div>
        </div>

        {/* 明细表（列头下拉筛选） */}
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
            <colgroup><col style={{ width: '16%' }} />{Array.from({ length: 8 }).map((_, i) => <col key={i} />)}</colgroup>
            <thead>
              <tr className="bg-surface-2 text-text-secondary align-bottom">
                <th className="px-1.5 py-2 text-left font-semibold">客户</th>
                {([['channel', '来源'], ['platform', '平台'], ['lang', '语言'], ['intent', '意向'], ['status', '状态']] as const).map(([k, label]) => (
                  <th key={k} className="px-1 py-1.5 text-left font-semibold">
                    <select value={tf[k]} onChange={e => setF(k, e.target.value)} className={`w-full bg-transparent text-[11px] font-semibold outline-none cursor-pointer ${tf[k] === '全部' ? 'text-text-secondary' : 'text-amber'}`}>
                      {F[k].map(o => <option key={o} value={o}>{o === '全部' ? label : o}</option>)}
                    </select>
                  </th>
                ))}
                {['产品', '首响', '金额'].map(h => <th key={h} className="px-1.5 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-1.5 py-2 truncate">{r.customer}</td>
                  <td className="px-1.5 py-2 whitespace-nowrap">{r.channel}</td>
                  <td className="px-1.5 py-2">{r.platform}</td>
                  <td className="px-1.5 py-2">{r.lang}</td>
                  <td className="px-1.5 py-2">{r.intent}</td>
                  <td className="px-1.5 py-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: STATUS_C[r.status].bg, color: STATUS_C[r.status].fg }}>{r.status}</span></td>
                  <td className="px-1.5 py-2 truncate" title={r.product}>{r.product}</td>
                  <td className="px-1.5 py-2">{r.firstResp === null ? <span style={{ color: '#BA7517' }}>未响应</span> : `${r.firstResp} 分`}</td>
                  <td className="px-1.5 py-2 font-semibold" style={{ color: r.amount ? '#0F6E56' : 'var(--color-text-muted)' }}>{r.amount ? usd(r.amount) : '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="px-2 py-8 text-center text-text-muted">当前筛选无数据</td></tr>}
            </tbody>
          </table>
        </div>

        <p className="flex items-center gap-1.5 text-[11px] text-text-muted mt-4">
          <Info size={12} /> 数据来源：询盘取自 WhatsApp / 站内 DM / 邮件 / 独立站表单，成交回挂订单，内容回溯接流量页归因
        </p>
      </div>
    </div>
  );
}
