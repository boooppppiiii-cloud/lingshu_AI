import { LayoutGrid } from 'lucide-react';

export default function OrdersPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="h-12 flex-shrink-0 border-b border-border px-5 flex items-center gap-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-2 text-text-secondary">
          <LayoutGrid size={13} />
        </div>
        <span className="text-sm font-semibold text-text-primary">我的订单</span>
      </div>
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white text-text-muted">
            <LayoutGrid size={20} />
          </div>
          <p className="text-sm font-bold text-text-primary">我的订单</p>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">订单数据接入后，会在这里展示订单列表、履约状态和客户跟进动作。</p>
        </div>
      </div>
    </div>
  );
}
