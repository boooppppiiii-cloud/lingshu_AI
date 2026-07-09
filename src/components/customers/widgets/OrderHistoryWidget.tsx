import { useState } from 'react';
import { Card, CardContent, CardHeader } from '../../ui/card';
import type { CustomerProfile, OrderRecord } from '../../ConversionPage';

const STATUS_STYLE: Record<OrderRecord['status'], string> = {
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  refunded: 'bg-slate-100 text-slate-600 border-slate-200',
  cancelled: 'bg-red-50 text-red-700 border-red-100',
  pending: 'bg-amber-50 text-amber-700 border-amber-100',
};

const STATUS_LABEL: Record<OrderRecord['status'], string> = {
  paid: '已支付',
  refunded: '已退款',
  cancelled: '已取消',
  pending: '待处理',
};

function actionSoon(action: string, orderId: string) {
  console.log(`[orders] ${action} clicked for ${orderId}: coming soon`);
}

function OrderDetail({ customer, order }: { customer: CustomerProfile; order: OrderRecord }) {
  return (
    <div className="mt-3 rounded-xl border border-border bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black text-text-primary">灵枢演示店铺</p>
          <p className="mt-1 text-[11px] text-text-muted">{customer.orders.length} 笔订单 · 累计消费 {customer.orders.reduce((sum, item) => sum + Number(item.total.replace(/[^\d.]/g, '') || 0), 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[order.status]}`}>
          {STATUS_LABEL[order.status]}
        </span>
      </div>

      <div className="mt-3 flex gap-1.5">
        {['退款', '取消', '编辑'].map(action => (
          <button
            key={action}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              actionSoon(action, order.id);
            }}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-bold text-text-secondary hover:bg-surface-2"
          >
            {action}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-2 rounded-lg bg-surface-2 p-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-text-muted">创建时间</span>
          <span className="font-semibold text-text-primary">{order.createdAt}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-text-muted">金额</span>
          <span className="font-black text-text-primary">{order.total}</span>
        </div>
        {!!order.items?.length && (
          <div className="border-t border-border pt-2">
            {order.items.map(item => (
              <div key={`${item.name}-${item.qty}`} className="flex items-center justify-between gap-3">
                <span className="truncate text-text-secondary">{item.name}</span>
                <span className="font-semibold text-text-muted">x{item.qty}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function OrderHistoryWidget({ customer }: { customer: CustomerProfile }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <p className="text-xs font-bold text-text-primary">订单历史</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {customer.orders.length ? customer.orders.map(order => {
            const expanded = expandedId === order.id;
            return (
              <div
                key={order.id}
                className="rounded-lg bg-surface-2 px-3 py-2 text-xs transition-colors hover:bg-slate-100"
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : order.id)}
                  className="flex w-full items-center justify-between gap-2 text-left"
                >
                  <span className="font-black text-text-primary">{order.id}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[order.status]}`}>
                    {STATUS_LABEL[order.status]}
                  </span>
                  <span className="ml-auto font-bold text-text-primary">{order.total}</span>
                </button>
                {expanded && <OrderDetail customer={customer} order={order} />}
              </div>
            );
          }) : <p className="text-xs text-text-muted">暂无订单</p>}
        </div>
      </CardContent>
    </Card>
  );
}
