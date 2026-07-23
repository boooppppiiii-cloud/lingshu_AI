import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, DollarSign, Loader2, PackageCheck, RefreshCw, ShoppingBag, Users } from 'lucide-react';
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

interface CustomerFromOrders {
  buyer: string;
  markets: string[];
  channels: string[];
  products: string[];
  orders: number;
  validOrders: number;
  amount: number;
  latestDate: string;
  latestStatus: OrderStatus;
  owner: string;
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

function money(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function isValidOrder(order: OrderRecord) {
  return order.status !== '待付款' && order.status !== '退款';
}

function aggregateCustomers(orders: OrderRecord[]): CustomerFromOrders[] {
  const map = new Map<string, CustomerFromOrders>();
  orders.forEach(order => {
    const current = map.get(order.buyer) ?? {
      buyer: order.buyer,
      markets: [],
      channels: [],
      products: [],
      orders: 0,
      validOrders: 0,
      amount: 0,
      latestDate: order.orderDate,
      latestStatus: order.status,
      owner: order.owner,
    };
    current.orders += 1;
    if (isValidOrder(order)) {
      current.validOrders += 1;
      current.amount += order.amount;
    }
    if (!current.markets.includes(order.market)) current.markets.push(order.market);
    if (!current.channels.includes(order.channel)) current.channels.push(order.channel);
    if (!current.products.includes(order.product)) current.products.push(order.product);
    if (order.orderDate >= current.latestDate) {
      current.latestDate = order.orderDate;
      current.latestStatus = order.status;
      current.owner = order.owner;
    }
    map.set(order.buyer, current);
  });
  return [...map.values()].sort((a, b) => b.amount - a.amount || b.latestDate.localeCompare(a.latestDate));
}

export default function CrmDataBoard(_props: { windowDays?: number }) {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    readJson<{ items?: OrderRecord[] }>('/api/overseas/enterprise/orders', { items: [] })
      .then(data => {
        if (!alive) return;
        setOrders(Array.isArray(data.items) ? data.items : []);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [refreshKey]);

  const customers = useMemo(() => aggregateCustomers(orders), [orders]);
  const validOrders = useMemo(() => orders.filter(isValidOrder), [orders]);

  const summary = useMemo(() => {
    const revenue = validOrders.reduce((sum, order) => sum + order.amount, 0);
    const cost = validOrders.reduce((sum, order) => sum + order.cost, 0);
    const pending = orders.filter(order => order.status === '已付款' || order.status === '生产中').length;
    return {
      customerCount: customers.length,
      orderCount: validOrders.length,
      revenue,
      margin: revenue ? (revenue - cost) / revenue * 100 : 0,
      pending,
    };
  }, [customers.length, orders, validOrders]);

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-text-primary">客户真实数据</p>
          <p className="mt-1 text-xs text-text-muted">数据来自「我的订单」tab 的订单记录。</p>
        </div>
        <button type="button" onClick={() => setRefreshKey(v => v + 1)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary">
          <RefreshCw size={12} />刷新
        </button>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center gap-2 text-sm text-text-muted"><Loader2 size={16} className="animate-spin" />读取我的订单数据...</div>
      ) : orders.length === 0 ? (
        <EmptyState text="我的订单 tab 暂无订单记录，因此客户页不展示无订单来源支撑的客户画像、LTV 或复购组件。" />
      ) : (
        <>
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <StatCard label="订单客户" value={String(summary.customerCount)} icon={<Users size={14} />} />
            <StatCard label="有效订单" value={String(summary.orderCount)} icon={<ShoppingBag size={14} />} />
            <StatCard label="有效GMV" value={money(summary.revenue)} icon={<DollarSign size={14} />} />
            <StatCard label="待履约" value={String(summary.pending)} icon={<PackageCheck size={14} />} />
          </div>

          <section className="mb-4 rounded-xl border border-border bg-white">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-bold text-text-primary">订单客户汇总</p>
              <p className="mt-1 text-xs text-text-muted">按买家名称从我的订单聚合，金额只统计已付款/生产中/已发货/已完成订单。</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-text-secondary">
                  <tr>
                    {['客户', '市场/渠道', '订单数', '有效GMV', '最近订单', '最近状态', '负责人'].map(head => (
                      <th key={head} className="px-3 py-2 text-left font-semibold">{head}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {customers.slice(0, 30).map(customer => (
                    <tr key={customer.buyer} className="border-t border-border">
                      <td className="px-3 py-2">
                        <p className="font-semibold text-text-primary">{customer.buyer}</p>
                        <p className="mt-0.5 max-w-[280px] truncate text-text-muted">{customer.products.slice(0, 2).join(' / ')}</p>
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{customer.markets.join('、')} · {customer.channels.join('、')}</td>
                      <td className="px-3 py-2">{customer.orders}</td>
                      <td className="px-3 py-2 font-semibold text-text-primary">{money(customer.amount)}</td>
                      <td className="px-3 py-2 text-text-secondary">{customer.latestDate}</td>
                      <td className="px-3 py-2">
                        <span className="rounded bg-green-50 px-2 py-0.5 font-semibold text-green-700">{customer.latestStatus}</span>
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{customer.owner}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-white">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-bold text-text-primary">最近订单明细</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-text-secondary">
                  <tr>
                    {['订单号', '客户', '产品', '数量', '金额', '状态', '日期'].map(head => (
                      <th key={head} className="px-3 py-2 text-left font-semibold">{head}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...orders].sort((a, b) => b.orderDate.localeCompare(a.orderDate)).slice(0, 50).map(order => (
                    <tr key={order.id} className="border-t border-border">
                      <td className="px-3 py-2 font-semibold text-text-primary">{order.orderNo}</td>
                      <td className="px-3 py-2">{order.buyer}</td>
                      <td className="px-3 py-2 text-text-secondary">{order.product}</td>
                      <td className="px-3 py-2">{order.quantity}</td>
                      <td className="px-3 py-2 font-semibold text-text-primary">{money(order.amount)}</td>
                      <td className="px-3 py-2">{order.status}</td>
                      <td className="px-3 py-2 text-text-muted">{order.orderDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="mt-3 text-xs font-semibold text-green-700">订单毛利率：{summary.margin.toFixed(1)}%</p>
        </>
      )}

    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-white p-3">
      <div className="flex items-center gap-2 text-green-700">{icon}<span className="text-xs font-semibold text-text-secondary">{label}</span></div>
      <p className="mt-2 text-2xl font-bold leading-none text-text-primary">{value}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-text-muted">
      <div className="flex items-start gap-2"><AlertCircle size={16} className="mt-0.5 text-text-muted" /><p>{text}</p></div>
    </div>
  );
}
