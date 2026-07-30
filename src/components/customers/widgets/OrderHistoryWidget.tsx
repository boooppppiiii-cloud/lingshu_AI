import { useState } from 'react';
import { Card, CardContent, CardHeader } from '../../ui/card';
import type { CustomerProfile, OrderRecord } from '../../../types/customer';

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

const emptyDraft = () => ({
  id: '',
  total: '',
  status: 'pending' as OrderRecord['status'],
  createdAt: new Date().toISOString().slice(0, 10),
});

function OrderDetail({
  customer,
  order,
  onEdit,
  onStatus,
}: {
  customer: CustomerProfile;
  order: OrderRecord;
  onEdit: () => void;
  onStatus: (status: OrderRecord['status']) => void;
}) {
  const cumulative = customer.orders.reduce((sum, item) => sum + Number(item.total.replace(/[^\d.]/g, '') || 0), 0);
  return (
    <div className="mt-3 rounded-xl border border-border bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black text-text-primary">订单详情</p>
          <p className="mt-1 text-[11px] text-text-muted">{customer.orders.length} 笔订单 · 累计金额 {cumulative.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[order.status]}`}>{STATUS_LABEL[order.status]}</span>
      </div>
      <div className="mt-3 grid gap-2 rounded-lg bg-surface-2 p-3 text-xs">
        <div className="flex items-center justify-between gap-3"><span className="text-text-muted">创建时间</span><span className="font-semibold text-text-primary">{order.createdAt}</span></div>
        <div className="flex items-center justify-between gap-3"><span className="text-text-muted">金额</span><span className="font-black text-text-primary">{order.total}</span></div>
        {!!order.items?.length && (
          <div className="border-t border-border pt-2">
            {order.items.map(item => <div key={`${item.name}-${item.qty}`} className="flex items-center justify-between gap-3"><span className="truncate text-text-secondary">{item.name}</span><span className="font-semibold text-text-muted">×{item.qty}</span></div>)}
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onEdit} className="rounded-lg border border-border bg-white px-3 py-1.5 text-[11px] font-bold text-text-secondary hover:bg-surface-2">编辑</button>
        {order.status !== 'paid' && order.status !== 'refunded' && order.status !== 'cancelled' && <button type="button" onClick={() => onStatus('paid')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white">标记已支付</button>}
        {order.status === 'paid' && <button type="button" onClick={() => onStatus('refunded')} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700">标记退款</button>}
        {order.status !== 'cancelled' && order.status !== 'refunded' && <button type="button" onClick={() => onStatus('cancelled')} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[11px] font-bold text-red-700">取消订单</button>}
      </div>
    </div>
  );
}

export function OrderHistoryWidget({ customer, onCustomerPatch }: { customer: CustomerProfile; onCustomerPatch?: (patch: Partial<CustomerProfile>) => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftOrder, setDraftOrder] = useState(emptyDraft);
  const [formError, setFormError] = useState('');

  const openCreate = () => {
    setEditingId(null);
    setDraftOrder(emptyDraft());
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (order: OrderRecord) => {
    setEditingId(order.id);
    setDraftOrder({ id: order.id, total: order.total, status: order.status, createdAt: order.createdAt });
    setFormError('');
    setFormOpen(true);
  };

  const saveOrder = () => {
    const id = draftOrder.id.trim();
    const total = draftOrder.total.trim();
    if (!id || !total) { setFormError('请填写订单号和金额'); return; }
    if (!onCustomerPatch) { setFormError('当前客户不能编辑订单'); return; }
    if (!editingId && customer.orders.some(order => order.id === id)) { setFormError('订单号已存在'); return; }
    const nextOrder: OrderRecord = { id, total, status: draftOrder.status, createdAt: draftOrder.createdAt || new Date().toISOString().slice(0, 10) };
    const orders = editingId
      ? customer.orders.map(order => order.id === editingId ? { ...order, ...nextOrder } : order)
      : [...customer.orders, nextOrder];
    onCustomerPatch({ orders });
    setExpandedId(id);
    setDraftOrder(emptyDraft());
    setEditingId(null);
    setFormOpen(false);
    setFormError('');
  };

  const updateStatus = (orderId: string, status: OrderRecord['status']) => {
    onCustomerPatch?.({ orders: customer.orders.map(order => order.id === orderId ? { ...order, status } : order) });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-text-primary">订单历史</p>
          {customer.isReal && <button type="button" onClick={openCreate} className="rounded-lg border border-border bg-white px-2.5 py-1 text-[11px] font-bold text-text-secondary hover:bg-surface-2">添加订单</button>}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {customer.orders.length ? customer.orders.map(order => {
            const expanded = expandedId === order.id;
            return (
              <div key={order.id} className="rounded-lg bg-surface-2 px-3 py-2 text-xs transition-colors hover:bg-slate-100">
                <button type="button" onClick={() => setExpandedId(expanded ? null : order.id)} aria-expanded={expanded} className="flex w-full items-center justify-between gap-2 text-left">
                  <span className="font-black text-text-primary">{order.id}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[order.status]}`}>{STATUS_LABEL[order.status]}</span>
                  <span className="ml-auto font-bold text-text-primary">{order.total}</span>
                </button>
                {expanded && <OrderDetail customer={customer} order={order} onEdit={() => openEdit(order)} onStatus={status => updateStatus(order.id, status)} />}
              </div>
            );
          }) : <div className="rounded-lg border border-dashed border-border bg-surface-2 px-3 py-3"><p className="text-xs font-bold text-text-primary">还没有订单记录</p><p className="mt-1 text-[11px] text-text-muted">成交后可在这里补录订单，便于客服了解客户价值。</p></div>}

          {formOpen && (
            <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
              <p className="mb-2 text-xs font-black text-text-primary">{editingId ? '编辑订单' : '添加订单'}</p>
              <div className="grid gap-2">
                <input value={draftOrder.id} onChange={event => setDraftOrder(prev => ({ ...prev, id: event.target.value }))} placeholder="订单号" aria-label="订单号" className="rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none" />
                <input value={draftOrder.total} onChange={event => setDraftOrder(prev => ({ ...prev, total: event.target.value }))} placeholder="金额，例如 US $120.00" aria-label="订单金额" className="rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none" />
                <select value={draftOrder.status} onChange={event => setDraftOrder(prev => ({ ...prev, status: event.target.value as OrderRecord['status'] }))} aria-label="订单状态" className="rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none">
                  <option value="pending">待处理</option><option value="paid">已支付</option><option value="refunded">已退款</option><option value="cancelled">已取消</option>
                </select>
                <input type="date" value={draftOrder.createdAt} onChange={event => setDraftOrder(prev => ({ ...prev, createdAt: event.target.value }))} aria-label="订单日期" className="rounded-lg border border-border bg-white px-3 py-2 text-xs outline-none" />
                {formError && <p className="text-[11px] font-bold text-red-600">{formError}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => { setFormOpen(false); setFormError(''); }} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary">取消</button>
                  <button type="button" onClick={saveOrder} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white">保存订单</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
