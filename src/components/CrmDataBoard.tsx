import { useMemo, useState, useEffect } from 'react';
import { Info, Sparkles, Loader2, Moon } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from 'recharts';
import { studioApi } from '../lib/studioApi';

/* CRM 页 = 客户经营（复购/留存视角）。
   命题：复购同期群 cohort · LTV / LTV:CAC · 分层 · 获客来源 · 沉睡唤醒。占位数据，接订单+客户库后替换。 */

interface Rec {
  id: string; name: string; tier: '新客' | '复购客' | 'VIP' | '沉睡客'; source: string; market: string;
  orders: number; lastDays: number; ltv: number; refund: number | null;
}

const RECORDS: Rec[] = [
  { id: 'c1',  name: 'Ahmed K.',  tier: 'VIP',    source: '达人',   market: '阿语', orders: 8, lastDays: 3,  ltv: 640, refund: 1.1 },
  { id: 'c2',  name: 'Maria L.',  tier: '复购客', source: '平台',   market: '西语', orders: 3, lastDays: 12, ltv: 186, refund: 2.3 },
  { id: 'c3',  name: 'John P.',   tier: '新客',   source: '内容',   market: '英语', orders: 1, lastDays: 5,  ltv: 39,  refund: 4.1 },
  { id: 'c4',  name: 'Fatima Z.', tier: 'VIP',    source: '达人',   market: '阿语', orders: 6, lastDays: 8,  ltv: 520, refund: 1.4 },
  { id: 'c5',  name: 'Diego R.',  tier: '沉睡客', source: '内容',   market: '西语', orders: 1, lastDays: 72, ltv: 44,  refund: null },
  { id: 'c6',  name: 'Sara M.',   tier: '复购客', source: '内容',   market: '阿语', orders: 4, lastDays: 6,  ltv: 210, refund: 2.0 },
  { id: 'c7',  name: 'Noor A.',   tier: 'VIP',    source: '投流',   market: '阿语', orders: 7, lastDays: 4,  ltv: 580, refund: 1.2 },
  { id: 'c8',  name: 'Tom W.',    tier: '新客',   source: '内容',   market: '英语', orders: 1, lastDays: 9,  ltv: 40,  refund: 5.0 },
  { id: 'c9',  name: 'Chen Y.',   tier: '沉睡客', source: '平台',   market: '英语', orders: 2, lastDays: 88, ltv: 94,  refund: null },
  { id: 'c10', name: 'Layla H.',  tier: '复购客', source: '内容',   market: '阿语', orders: 3, lastDays: 11, ltv: 168, refund: 2.6 },
  { id: 'c11', name: 'Pablo S.',  tier: '新客',   source: '平台',   market: '西语', orders: 1, lastDays: 14, ltv: 42,  refund: 3.8 },
  { id: 'c12', name: 'Yusuf B.',  tier: 'VIP',    source: '达人',   market: '阿语', orders: 9, lastDays: 7,  ltv: 720, refund: 1.0 },
  { id: 'c13', name: 'Emma D.',   tier: '沉睡客', source: '内容',   market: '英语', orders: 1, lastDays: 95, ltv: 38,  refund: null },
  { id: 'c14', name: 'Anna K.',   tier: '复购客', source: '内容',   market: '英语', orders: 2, lastDays: 22, ltv: 120, refund: 4.2 },
];

// 复购同期群（按首购月分组，第 0..5 个月的复购率%）
const COHORT = [
  { m: '1 月', r: [100, 32, 24, 19, 16, 14] },
  { m: '2 月', r: [100, 30, 22, 18, 15, null] },
  { m: '3 月', r: [100, 34, 26, 20, null, null] },
  { m: '4 月', r: [100, 29, 21, null, null, null] },
  { m: '5 月', r: [100, 31, null, null, null, null] },
  { m: '6 月', r: [100, null, null, null, null, null] },
];
const RETENTION = [{ m: 'M0', ret: 100 }, { m: 'M1', ret: 31 }, { m: 'M2', ret: 23 }, { m: 'M3', ret: 19 }, { m: 'M4', ret: 16 }, { m: 'M5', ret: 14 }];
const TIERS = [{ k: '新客', v: 56, c: '#9ca3af', ltv: 39 }, { k: '复购客', v: 29, c: '#3b82f6', ltv: 186 }, { k: 'VIP', v: 5, c: '#16a34a', ltv: 640 }, { k: '沉睡客', v: 11, c: '#a855f7', ltv: 94 }];
const ACQ = [{ src: '内容', v: 1480 }, { src: '平台自然', v: 880 }, { src: '达人', v: 720 }, { src: '投流', v: 340 }];

const uniq = (k: keyof Rec) => ['全部', ...Array.from(new Set(RECORDS.map(r => String(r[k]))))];
const F = { tier: uniq('tier'), source: uniq('source'), market: uniq('market') };
const TIER_C: Record<string, { bg: string; fg: string }> = {
  新客: { bg: 'var(--color-surface-2)', fg: 'var(--color-text-secondary)' }, 复购客: { bg: '#E6F1FB', fg: '#185FA5' },
  VIP: { bg: '#E1F5EE', fg: '#0F6E56' }, 沉睡客: { bg: '#EEEDFE', fg: '#534AB7' },
};
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const C = { bg: '#EEEDFE', label: '#534AB7', value: '#3C3489' };

export default function CrmDataBoard({ windowDays = 30 }: { windowDays?: number }) {
  const [tf, setTf] = useState({ tier: '全部', source: '全部', market: '全部' });
  const setF = (k: keyof typeof tf, v: string) => setTf(s => ({ ...s, [k]: v }));
  const [insight, setInsight] = useState<{ summary: string; actions: string[] } | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);

  const newAdd = Math.round(286 * (windowDays / 30));

  const rows = useMemo(() => RECORDS.filter(r =>
    (tf.tier === '全部' || r.tier === tf.tier)
    && (tf.source === '全部' || r.source === tf.source)
    && (tf.market === '全部' || r.market === tf.market)), [tf]);

  useEffect(() => {
    let cancelled = false; setInsightLoading(true);
    const t = setTimeout(async () => {
      const r = await studioApi.insight({ scope: 'crm', metrics: { 客户总数: 3420, 复购率: '27%', LTV: '$118', 'LTV:CAC': '3.4x', 沉睡客: 412, 复购贡献GMV: '38%', 最强市场: '阿语', VIP_LTV: '$640' } });
      if (cancelled) return;
      if (r.summary) setInsight({ summary: r.summary, actions: r.actions ?? [] });
      else setInsight({ summary: '复购贡献 38% GMV，VIP 客户 LTV $640；412 沉睡客可唤醒，阿语市场复购最强。', actions: ['唤醒 412 沉睡客', 'VIP 专属复购权益', '阿语市场加大复购触达'] });
      setInsightLoading(false);
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowDays]);

  const card = 'card !rounded-xl p-4';
  const cohortColor = (v: number | null) => v === null ? 'transparent' : `rgba(83,74,183,${0.12 + v / 100 * 0.78})`;

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="max-w-5xl mx-auto">
        {/* AI 结论 */}
        <div className="rounded-xl p-3.5 mb-5 flex items-start gap-2.5" style={{ background: 'var(--color-accent-glow)' }}>
          <Sparkles size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-accent)' }} />
          <div className="min-w-0 flex-1">
            {insightLoading && !insight ? (
              <p className="text-sm text-text-secondary flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> AI 正在解读客户经营…</p>
            ) : (
              <>
                <p className="text-sm font-semibold text-text-primary leading-snug">{insight?.summary}</p>
                {insight?.actions?.length ? <div className="flex flex-wrap gap-1.5 mt-2">{insight.actions.map((x, i) => <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-surface text-text-secondary border border-border">{x}</span>)}</div> : null}
              </>
            )}
          </div>
        </div>

        {/* 一号位：KPI + 沉睡唤醒 */}
        <div className="grid lg:grid-cols-3 gap-4 mb-6">
          <div className={`${card} lg:col-span-2`}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[['客户总数', '3,420', `+${newAdd} 新增`], ['复购率', '27%', '老客贡献 38% GMV'], ['LTV', '$118', 'VIP 达 $640'], ['LTV:CAC', '3.4x', '健康线 ≥3x ✓']].map(([l, v, sub]) => (
                <div key={l} className="rounded-lg p-3" style={{ background: C.bg }}>
                  <p className="text-[11px]" style={{ color: C.label }}>{l}</p>
                  <p className="text-xl font-bold mt-0.5" style={{ color: C.value }}>{v}</p>
                  <p className="text-[10px] mt-1" style={{ color: C.label }}>{sub}</p>
                </div>
              ))}
            </div>
          </div>
          <div className={card} style={{ borderColor: '#AFA9EC' }}>
            <div className="flex items-center gap-2 mb-2"><Moon size={16} style={{ color: '#534AB7' }} /><span className="text-sm font-semibold text-text-primary">沉睡客唤醒</span></div>
            <p className="text-4xl font-bold" style={{ color: '#3C3489' }}>412</p>
            <p className="text-xs text-text-muted mt-1">60 天未互动 · 占客户 11%</p>
            <p className="text-[11px] text-text-muted mt-3">沉睡客 LTV 均值 $94，唤醒成本远低于拉新</p>
            <button className="btn-primary w-full !py-2 mt-3 !text-xs">生成唤醒方案</button>
          </div>
        </div>

        {/* 复购同期群 cohort */}
        <div className={`${card} mb-6`}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold text-text-primary">复购同期群（cohort）</span>
            <span className="text-xs text-text-muted">按首购月分组 · 各月复购率</span>
          </div>
          <p className="text-[11px] text-text-muted mb-3">颜色越深复购越高——看留存策略是否见效</p>
          <div className="overflow-x-auto">
            <table className="text-xs" style={{ minWidth: 520 }}>
              <thead>
                <tr className="text-text-muted">
                  <th className="px-2 py-1 text-left font-medium">首购月</th>
                  {['M0', 'M1', 'M2', 'M3', 'M4', 'M5'].map(h => <th key={h} className="px-2 py-1 text-center font-medium w-16">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {COHORT.map(row => (
                  <tr key={row.m}>
                    <td className="px-2 py-1 text-text-secondary whitespace-nowrap">{row.m}</td>
                    {row.r.map((v, i) => (
                      <td key={i} className="px-1 py-1">
                        <div className="h-8 rounded flex items-center justify-center text-[11px] font-semibold"
                          style={{ background: cohortColor(v), color: v !== null && v > 55 ? '#fff' : '#3C3489' }}>
                          {v === null ? '' : `${v}%`}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 留存曲线 + 客户分层 */}
        <div className="grid lg:grid-cols-2 gap-4 mb-6">
          <div className={card}>
            <p className="text-sm font-semibold text-text-primary mb-1">留存曲线</p>
            <p className="text-[11px] text-text-muted mb-2">首购后各月仍复购的比例</p>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={RETENTION} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="m" tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" unit="%" />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={((v: number) => [`${v}%`, '留存']) as never} />
                  <Line type="monotone" dataKey="ret" stroke="#534AB7" strokeWidth={2} dot={{ r: 3, fill: '#534AB7' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className={card}>
            <p className="text-sm font-semibold text-text-primary mb-3">客户分层</p>
            <div className="flex h-7 rounded-md overflow-hidden mb-3">
              {TIERS.map(t => <div key={t.k} style={{ width: `${t.v}%`, background: t.c }} className="flex items-center justify-center text-[11px] font-semibold text-white">{t.v}%</div>)}
            </div>
            <div className="space-y-1.5">
              {TIERS.map(t => (
                <div key={t.k} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: t.c }} />
                  <span className="flex-1">{t.k}</span>
                  <span className="text-text-muted">{t.v}%</span>
                  <span className="text-text-secondary w-20 text-right">LTV {usd(t.ltv)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 获客来源 */}
        <div className={`${card} mb-6`}>
          <p className="text-sm font-semibold text-text-primary mb-1">客户从哪来（获客来源）</p>
          <p className="text-[11px] text-text-muted mb-2">回溯到获客的内容 / 平台 / 达人（接流量页）</p>
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ACQ} layout="vertical" margin={{ top: 6, right: 16, bottom: 0, left: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" />
                <YAxis type="category" dataKey="src" tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" width={64} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={((v: number) => [`${Math.round(Number(v)).toLocaleString()} 客户`, '获客']) as never} cursor={{ fill: 'var(--color-surface-2)' }} />
                <Bar dataKey="v" radius={[0, 4, 4, 0]} fill="#7F77DD" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 明细表（列头下拉筛选） */}
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
            <colgroup><col style={{ width: '16%' }} />{Array.from({ length: 7 }).map((_, i) => <col key={i} />)}</colgroup>
            <thead>
              <tr className="bg-surface-2 text-text-secondary align-bottom">
                <th className="px-1.5 py-2 text-left font-semibold">客户</th>
                {([['tier', '分层'], ['source', '获客来源'], ['market', '市场']] as const).map(([k, label]) => (
                  <th key={k} className="px-1 py-1.5 text-left font-semibold">
                    <select value={tf[k]} onChange={e => setF(k, e.target.value)} className={`w-full bg-transparent text-[11px] font-semibold outline-none cursor-pointer ${tf[k] === '全部' ? 'text-text-secondary' : 'text-amber'}`}>
                      {F[k].map(o => <option key={o} value={o}>{o === '全部' ? label : o}</option>)}
                    </select>
                  </th>
                ))}
                {['订单', '最近购买', 'LTV', '退款率'].map(h => <th key={h} className="px-1.5 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-1.5 py-2 truncate">{r.name}</td>
                  <td className="px-1.5 py-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: TIER_C[r.tier].bg, color: TIER_C[r.tier].fg }}>{r.tier}</span></td>
                  <td className="px-1.5 py-2">{r.source}</td>
                  <td className="px-1.5 py-2">{r.market}</td>
                  <td className="px-1.5 py-2">{r.orders} 单</td>
                  <td className="px-1.5 py-2" style={r.lastDays > 60 ? { color: '#534AB7' } : undefined}>{r.lastDays} 天前</td>
                  <td className="px-1.5 py-2 font-semibold" style={{ color: '#3C3489' }}>{usd(r.ltv)}</td>
                  <td className="px-1.5 py-2">{r.refund === null ? '—' : `${r.refund}%`}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="px-2 py-8 text-center text-text-muted">当前筛选无数据</td></tr>}
            </tbody>
          </table>
        </div>

        <p className="flex items-center gap-1.5 text-[11px] text-text-muted mt-4">
          <Info size={12} /> 数据来源：客户与价值取自订单+客户库，获客来源回溯到内容/平台/达人，cohort 按首购月计算
        </p>
      </div>
    </div>
  );
}
