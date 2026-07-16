import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Download,
  Filter,
  LineChart as LineChartIcon,
  PackageCheck,
  Plus,
  Save,
  Search,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from 'recharts';
import { authHeader } from '../lib/auth';

type OrderStatus = '待付款' | '已付款' | '生产中' | '已发货' | '已完成' | '退款';

interface OrderRecord {
  id: string;
  orderNo: string;
  buyer: string;
  market: string;
  channel: string;
  product: string;
  quantity: number;
  amount: number;
  cost: number;
  status: OrderStatus;
  orderDate: string;
  owner: string;
  source?: string;
  sourceRef?: string;
  importedAt?: string;
  updatedAt?: string;
}

type DraftOrder = Omit<OrderRecord, 'id' | 'orderNo'>;

const today = new Date().toISOString().slice(0, 10);

const EMPTY_DRAFT: DraftOrder = {
  buyer: '',
  market: '中东',
  channel: 'WhatsApp',
  product: '',
  quantity: 100,
  amount: 0,
  cost: 0,
  status: '已付款',
  orderDate: today,
  owner: 'Mia',
};

const STATUS_STYLE: Record<OrderStatus, { bg: string; fg: string }> = {
  待付款: { bg: '#FEF3C7', fg: '#92400E' },
  已付款: { bg: '#DBEAFE', fg: '#1D4ED8' },
  生产中: { bg: '#EDE9FE', fg: '#6D28D9' },
  已发货: { bg: '#DCFCE7', fg: '#166534' },
  已完成: { bg: '#D1FAE5', fg: '#047857' },
  退款: { bg: '#FEE2E2', fg: '#B91C1C' },
};

const statusList: OrderStatus[] = ['待付款', '已付款', '生产中', '已发货', '已完成', '退款'];
const markets = ['全部', '中东', '东南亚', '拉美', '北美', '欧洲', '东亚'];
const channels = ['全部', 'WhatsApp', 'TikTok Shop', 'Facebook', 'Instagram', 'Shopify', 'Email', 'TikTok'];

const money = (value: number) => `$${Math.round(value).toLocaleString('en-US')}`;
const pct = (value: number) => `${value.toFixed(1)}%`;
const tooltipNumber = (value: unknown) => Number(value ?? 0);

function loadOrders(): OrderRecord[] { return []; }

function nextOrderNo(date: string, length: number) {
  const compact = date.replaceAll('-', '');
  return `LS-${compact}-${String(length + 1).padStart(3, '0')}`;
}

export default function OrderManagementPage() {
  const [orders, setOrders] = useState<OrderRecord[]>(loadOrders);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftOrder>(EMPTY_DRAFT);
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState('全部');
  const [channel, setChannel] = useState('全部');
  const [status, setStatus] = useState<'全部' | OrderStatus>('全部');

  useEffect(() => {
    fetch('/api/overseas/enterprise/orders', { headers: authHeader() })
      .then(r => r.json())
      .then((data: { items?: OrderRecord[] }) => setOrders(Array.isArray(data.items) ? data.items : []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter(order => (
      (!q || `${order.orderNo} ${order.buyer} ${order.product} ${order.owner}`.toLowerCase().includes(q)) &&
      (market === '全部' || order.market === market) &&
      (channel === '全部' || order.channel === channel) &&
      (status === '全部' || order.status === status)
    )).sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  }, [orders, query, market, channel, status]);

  const summary = useMemo(() => {
    const paidLike = filtered.filter(order => order.status !== '待付款' && order.status !== '退款');
    const gmv = paidLike.reduce((sum, order) => sum + order.amount, 0);
    const cost = paidLike.reduce((sum, order) => sum + order.cost, 0);
    const pending = filtered.filter(order => order.status === '已付款' || order.status === '生产中').length;
    const refund = filtered.filter(order => order.status === '退款').reduce((sum, order) => sum + order.amount, 0);
    return {
      gmv,
      cost,
      orders: paidLike.length,
      aov: paidLike.length ? gmv / paidLike.length : 0,
      margin: gmv ? (gmv - cost) / gmv * 100 : 0,
      pending,
      refund,
    };
  }, [filtered]);

  const dailyTrend = useMemo(() => {
    const map = new Map<string, { day: string; gmv: number; orders: number }>();
    filtered.forEach(order => {
      if (order.status === '待付款' || order.status === '退款') return;
      const day = order.orderDate.slice(5);
      const current = map.get(day) ?? { day, gmv: 0, orders: 0 };
      current.gmv += order.amount;
      current.orders += 1;
      map.set(day, current);
    });
    return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [filtered]);

  const marketBars = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach(order => {
      if (order.status === '待付款' || order.status === '退款') return;
      map.set(order.market, (map.get(order.market) ?? 0) + order.amount);
    });
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const canSave = draft.buyer.trim() && draft.product.trim() && draft.amount > 0;

  const addOrder = async () => {
    if (!canSave) return;
    const payload = {
      ...draft,
      orderNo: nextOrderNo(draft.orderDate, orders.length),
      quantity: Math.max(1, Number(draft.quantity) || 1),
      amount: Math.max(0, Number(draft.amount) || 0),
      cost: Math.max(0, Number(draft.cost) || 0),
      source: '手工录入',
    };
    const next = await fetch('/api/overseas/enterprise/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
    }).then(r => r.json());
    setOrders(prev => [next, ...prev.filter(order => order.orderNo !== next.orderNo)]);
    setDraft(EMPTY_DRAFT);
  };

  const setOrderStatus = async (id: string, nextStatus: OrderStatus) => {
    const updated = await fetch(`/api/overseas/enterprise/orders/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ status: nextStatus }),
    }).then(r => r.json());
    setOrders(prev => prev.map(order => order.id === id ? updated : order));
  };

  const exportCsv = () => {
    const headers = ['订单号', '客户', '市场', '渠道', '商品', '数量', 'GMV', '成本', '状态', '日期', '负责人', '来源', '来源凭证'];
    const rows = filtered.map(order => [order.orderNo, order.buyer, order.market, order.channel, order.product, order.quantity, order.amount, order.cost, order.status, order.orderDate, order.owner, order.source || '', order.sourceRef || '']);
    const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lingshu-orders-${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const input = 'h-9 rounded-lg border border-border bg-surface px-3 text-xs outline-none transition-colors hover:border-border-bright focus:border-accent';
  const smallInput = `${input} w-full`;

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-green-50 text-green-700">
            <ShoppingCart size={13} />
          </div>
          <p className="text-sm font-black text-text-primary">我的订单</p>
        </div>
        <button type="button" onClick={exportCsv} className="btn-ghost flex items-center gap-2 !px-3 !py-2">
          <Download size={14} />
          导出 CSV
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-5">
          <div className="mb-5 rounded-xl border border-border bg-surface px-4 py-3">
            <div className="flex items-start gap-2.5">
              <PackageCheck size={15} className="mt-0.5 text-green-700" />
              <div>
                <p className="text-sm font-semibold text-text-primary">订单经营数据</p>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">记录真实订单、GMV、毛利、渠道来源和履约状态；数据来自企业中心导入或手工录入。</p>
              </div>
            </div>
          </div>

        <div className="mb-5 grid gap-3 md:grid-cols-4">
          {[
            { label: '有效 GMV', value: money(summary.gmv), desc: `${summary.orders} 个有效订单`, icon: <DollarSign size={14} />, color: '#047857', bg: '#D1FAE5' },
            { label: '平均客单价', value: money(summary.aov), desc: '按有效订单计算', icon: <TrendingUp size={14} />, color: '#1D4ED8', bg: '#DBEAFE' },
            { label: '毛利率', value: pct(summary.margin), desc: `毛利 ${money(summary.gmv - summary.cost)}`, icon: <LineChartIcon size={14} />, color: '#6D28D9', bg: '#EDE9FE' },
            { label: '待履约', value: String(summary.pending), desc: `退款金额 ${money(summary.refund)}`, icon: <PackageCheck size={14} />, color: '#92400E', bg: '#FEF3C7' },
          ].map(item => (
            <div key={item.label} className="card !rounded-xl p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-text-muted">{item.label}</span>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: item.bg, color: item.color }}>{item.icon}</span>
              </div>
              <p className="text-2xl font-bold font-display text-text-primary">{item.value}</p>
              <p className="mt-1 text-xs text-text-muted">{item.desc}</p>
            </div>
          ))}
        </div>

        <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="card !rounded-xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-text-primary">GMV 趋势</p>
                <p className="text-[11px] text-text-muted">按订单日期聚合，排除待付款与退款。</p>
              </div>
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-semibold text-text-muted">当前筛选</span>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyTrend} margin={{ top: 8, right: 16, bottom: 0, left: -6 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--color-text-muted)" tickFormatter={(value: number | string) => `$${Math.round(Number(value) / 1000)}k`} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(value: unknown, name: unknown) => [name === 'gmv' ? money(tooltipNumber(value)) : tooltipNumber(value), name === 'gmv' ? 'GMV' : '订单']} />
                  <Line type="monotone" dataKey="gmv" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3, fill: '#16a34a' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card !rounded-xl p-4">
            <p className="text-sm font-semibold text-text-primary">市场贡献</p>
            <p className="mb-3 mt-0.5 text-[11px] text-text-muted">识别 GMV 主力市场，辅助备货与投放。</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={marketBars} layout="vertical" margin={{ top: 6, right: 16, bottom: 0, left: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" width={56} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(value: unknown) => [money(tooltipNumber(value)), 'GMV']} />
                  <Bar dataKey="value" fill="#22c55e" radius={[0, 5, 5, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <section className="mb-5 rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center gap-2">
            <Plus size={15} className="text-green-700" />
            <p className="text-sm font-semibold text-text-primary">新增订单记录</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-6">
            <input value={draft.buyer} onChange={e => setDraft(s => ({ ...s, buyer: e.target.value }))} placeholder="客户名称" className={smallInput} />
            <input value={draft.product} onChange={e => setDraft(s => ({ ...s, product: e.target.value }))} placeholder="商品 / SKU" className={smallInput} />
            <select value={draft.market} onChange={e => setDraft(s => ({ ...s, market: e.target.value }))} className={smallInput}>
              {markets.filter(x => x !== '全部').map(x => <option key={x} value={x}>{x}</option>)}
            </select>
            <select value={draft.channel} onChange={e => setDraft(s => ({ ...s, channel: e.target.value }))} className={smallInput}>
              {channels.filter(x => x !== '全部').map(x => <option key={x} value={x}>{x}</option>)}
            </select>
            <input type="number" min={1} value={draft.quantity} onChange={e => setDraft(s => ({ ...s, quantity: Number(e.target.value) }))} placeholder="数量" className={smallInput} />
            <input type="date" value={draft.orderDate} onChange={e => setDraft(s => ({ ...s, orderDate: e.target.value }))} className={smallInput} />
            <input type="number" min={0} value={draft.amount || ''} onChange={e => setDraft(s => ({ ...s, amount: Number(e.target.value) }))} placeholder="GMV / 美元" className={smallInput} />
            <input type="number" min={0} value={draft.cost || ''} onChange={e => setDraft(s => ({ ...s, cost: Number(e.target.value) }))} placeholder="成本 / 美元" className={smallInput} />
            <select value={draft.status} onChange={e => setDraft(s => ({ ...s, status: e.target.value as OrderStatus }))} className={smallInput}>
              {statusList.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
            <input value={draft.owner} onChange={e => setDraft(s => ({ ...s, owner: e.target.value }))} placeholder="负责人" className={smallInput} />
            <button type="button" onClick={addOrder} disabled={!canSave} className="btn-primary flex h-9 items-center justify-center gap-2 !px-3 !py-0 disabled:cursor-not-allowed disabled:opacity-50 lg:col-span-2">
              <Save size={14} />
              保存订单
            </button>
          </div>
        </section>

        <section className="card !rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <div className="relative min-w-[220px] flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索订单号、客户、商品、负责人" className={`${input} w-full pl-9`} />
            </div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
              <Filter size={13} />
              筛选
            </div>
            <select value={market} onChange={e => setMarket(e.target.value)} className={input}>{markets.map(x => <option key={x} value={x}>{x === '全部' ? '全部市场' : x}</option>)}</select>
            <select value={channel} onChange={e => setChannel(e.target.value)} className={input}>{channels.map(x => <option key={x} value={x}>{x === '全部渠道' ? x : x}</option>)}</select>
            <select value={status} onChange={e => setStatus(e.target.value as '全部' | OrderStatus)} className={input}>
              <option value="全部">全部状态</option>
              {statusList.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-xs">
              <thead className="bg-surface-2 text-text-muted">
                <tr>
                  {['订单号', '客户 / 商品', '市场', '渠道', '数量', 'GMV', '毛利率', '状态', '日期', '负责人', '操作'].map(head => (
                    <th key={head} className="px-4 py-2.5 font-semibold whitespace-nowrap">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(order => {
                  const margin = order.amount ? (order.amount - order.cost) / order.amount * 100 : 0;
                  const style = STATUS_STYLE[order.status];
                  return (
                    <tr key={order.id} className="hover:bg-surface-2/70">
                      <td className="px-4 py-3 font-mono text-[11px] text-text-secondary">{order.orderNo}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-text-primary">{order.buyer}</p>
                        <p className="mt-0.5 text-[11px] text-text-muted">{order.product}</p>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{order.market}</td>
                      <td className="px-4 py-3 text-text-secondary">{order.channel}</td>
                      <td className="px-4 py-3 text-text-secondary">{order.quantity.toLocaleString()}</td>
                      <td className="px-4 py-3 font-semibold text-text-primary">{money(order.amount)}</td>
                      <td className="px-4 py-3">
                        <span className={margin < 25 ? 'font-semibold text-amber' : 'font-semibold text-green'}>
                          {pct(margin)}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: style.bg, color: style.fg }}>{order.status}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-text-secondary">{order.orderDate}</td>
                      <td className="px-4 py-3 text-text-secondary">{order.owner}</td>
                      <td className="px-4 py-3">
                        <select value={order.status} onChange={e => setOrderStatus(order.id, e.target.value as OrderStatus)} className="rounded-md border border-border bg-white px-2 py-1 text-[11px] outline-none">
                          {statusList.map(x => <option key={x} value={x}>{x}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-text-muted">
                      <div className="flex items-center justify-center gap-2">
                        <AlertTriangle size={14} />
                        {loading ? '正在读取真实订单数据…' : '暂无真实订单记录，请先在企业中心导入 CSV 或手工录入订单'}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
          <CheckCircle2 size={12} />
          订单仅展示当前企业空间已导入或手工录入的真实记录；后续可继续接入 Shopify、ERP、支付和履约系统自动同步。
        </div>
        </div>
      </div>
    </div>
  );
}
