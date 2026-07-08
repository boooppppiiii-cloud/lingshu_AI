import { useEffect, useMemo, useState } from 'react';
import { Search, UserRound, Users } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { authHeader } from '../../lib/auth';
import { MOCK_CUSTOMERS } from './data/mock-customers';
import { AllCustomersDrawer } from './components/all-customers-drawer';
import { AutoSummary } from './components/auto-summary';
import { CustomerDetail } from './components/customer-detail';
import { CustomerEmptyState } from './components/empty-state';
import { CustomerTaskCard } from './components/task-card';
import type { CustomerPageProps, CustomerProfile, CustomerView } from './types';
import { isLowValueAuto, mapApiCustomer, mapTimeline, mergeById, taskQueue } from './lib/customer-utils';

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...authHeader(), ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data as T;
}

function LoadingQueue() {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-3 px-6 py-6">
      {[0, 1, 2].map(item => (
        <div key={item} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 animate-pulse rounded-lg bg-surface-2" />
            <div className="min-w-0 flex-1">
              <div className="h-4 w-1/3 animate-pulse rounded bg-surface-2" />
              <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-surface-2" />
            </div>
            <div className="h-10 w-32 animate-pulse rounded-lg bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function QueueHeader({ count, onOpenAll }: { count: number; onOpenAll: () => void }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
      <div>
        <p className="text-[13px] font-bold text-text-muted">今日队列</p>
        <h2 className="mt-1 text-[24px] font-bold text-text-primary">今天有 {count} 件事要处理</h2>
        <p className="mt-1 text-[15px] text-text-secondary">先回最上面的客户，其余交给 AI 排队。</p>
      </div>
      <Button type="button" variant="ghost" onClick={onOpenAll}>
        <Users size={16} /> 全部客户
      </Button>
    </div>
  );
}

interface TaskQueueProps {
  customers: CustomerProfile[];
  loading: boolean;
  error: string;
  handledIds: string[];
  onDone: (id: string) => void;
  onOpenCustomer: (id: string) => void;
  onOpenAll: () => void;
  onRetry: () => void;
  onSeed: () => void;
}

function TaskQueueView({ customers, loading, error, handledIds, onDone, onOpenCustomer, onOpenAll, onRetry, onSeed }: TaskQueueProps) {
  const queue = taskQueue(customers).filter(customer => !handledIds.includes(customer.id));
  const visibleQueue = queue.slice(0, 3);
  const lowAutoCount = customers.filter(customer => customer.inboxReason && isLowValueAuto(customer)).length;

  if (loading) return <LoadingQueue />;
  if (error) {
    return (
      <CustomerEmptyState
        mode="error"
        title="客户数据暂时没读到"
        description={error}
        actionLabel="重新读取"
        onAction={onRetry}
      />
    );
  }
  if (visibleQueue.length === 0) {
    return (
      <CustomerEmptyState
        mode="done"
        title="都处理完了"
        description="现在没有需要你亲自处理的客户。AI 会继续接待低优先级新咨询。"
        actionLabel="注入演示进线"
        onAction={onSeed}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-surface-2">
      <div className="mx-auto grid max-w-4xl gap-4 px-6 py-6">
        <QueueHeader count={queue.length} onOpenAll={onOpenAll} />
        <div className="grid gap-3">
          {visibleQueue.map((customer, index) => (
            <CustomerTaskCard
              key={customer.id}
              customer={customer}
              index={index}
              onOpen={() => onOpenCustomer(customer.id)}
              onDone={() => onDone(customer.id)}
            />
          ))}
        </div>
        <AutoSummary count={lowAutoCount} onOpen={onOpenAll} />
      </div>
    </div>
  );
}

export default function CustomersFeature({ onLeaveConversation }: CustomerPageProps) {
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [handledIds, setHandledIds] = useState<string[]>([]);
  const selected = customers.find(customer => customer.id === selectedId) ?? customers[0] ?? null;
  const taskCount = useMemo(() => taskQueue(customers).filter(customer => !handledIds.includes(customer.id)).length, [customers, handledIds]);

  const loadCustomers = async () => {
    setLoading(true);
    setError('');
    try {
      const groups = await Promise.all((['inbox', 'leads', 'won', 'silent'] as CustomerView[]).map(async view => {
        const data = await apiJson<{ items: any[] }>(`/api/overseas/customers?view=${view}`);
        return data.items.map(mapApiCustomer);
      }));
      const next = mergeById(groups);
      setCustomers(next.length ? next : MOCK_CUSTOMERS);
      if (!selectedId && next[0]) setSelectedId(next[0].id);
    } catch (err) {
      setCustomers(MOCK_CUSTOMERS);
      setError(err instanceof Error ? err.message : '读取失败，已保留演示数据');
    } finally {
      setLoading(false);
    }
  };

  const loadCustomerDetail = async (id: string) => {
    setError('');
    try {
      const [detail, timeline] = await Promise.all([
        apiJson<any>(`/api/overseas/customers/${id}`),
        apiJson<{ items: any[] }>(`/api/overseas/customers/${id}/timeline`),
      ]);
      const mapped = { ...mapApiCustomer(detail), timeline: timeline.items.map(mapTimeline) };
      setCustomers(prev => {
        const exists = prev.some(customer => customer.id === mapped.id);
        return exists ? prev.map(customer => customer.id === mapped.id ? mapped : customer) : [mapped, ...prev];
      });
      setSelectedId(mapped.id);
    } catch {
      setSelectedId(id);
    }
  };

  const openCustomer = (id: string) => {
    setSelectedId(id);
    setDetailOpen(true);
    setDrawerOpen(false);
    void loadCustomerDetail(id);
  };

  const seedCustomers = async () => {
    setLoading(true);
    setError('');
    try {
      await apiJson('/api/overseas/dev/wa/seed', { method: 'POST' });
      await loadCustomers();
    } catch {
      setCustomers(MOCK_CUSTOMERS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadCustomers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const label = detailOpen && selected ? `客户详情 / ${selected.name}` : '我的客户 / 今日待办';
    const summary = detailOpen && selected
      ? `当前在客户详情页：${selected.name}，阶段${selected.stage}，产品${selected.product}。默认只展示对话流和一条AI草稿。`
      : `当前在我的客户任务队列。还有${taskCount}件事要处理，低分咨询由AI自动接待。`;
    window.dispatchEvent(new CustomEvent('lingshu-assistant-context', {
      detail: {
        agent: 'conversion',
        label,
        summary,
        suggestions: detailOpen
          ? ['生成下一条回复建议', '翻译最近消息', '生成报价草稿', '整理通话简报']
          : ['告诉我先回谁', '解释今天待办排序', '筛选想通电话客户', '查看AI自动接待了什么'],
      },
    }));
  }, [detailOpen, selected, taskCount]);

  const backToQueue = () => {
    onLeaveConversation();
    setDetailOpen(false);
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      {!detailOpen && (
        <header className="flex min-h-16 flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-2">
              <UserRound size={18} className="text-text-secondary" />
            </div>
            <div>
              <h1 className="text-[20px] font-bold text-text-primary">我的客户</h1>
              <p className="text-[13px] text-text-muted">收件箱式处理客户跟进</p>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => setDrawerOpen(true)}>
            <Search size={16} /> 找客户
          </Button>
        </header>
      )}

      <main className="min-h-0 flex-1 overflow-hidden">
        {detailOpen && selected ? (
          <CustomerDetail
            customer={selected}
            customers={customers}
            onBack={backToQueue}
            onOpenCustomer={openCustomer}
            onSent={() => void loadCustomerDetail(selected.id)}
            apiJson={apiJson}
          />
        ) : (
          <TaskQueueView
            customers={customers}
            loading={loading}
            error={error}
            handledIds={handledIds}
            onDone={id => setHandledIds(prev => [...prev, id])}
            onOpenCustomer={openCustomer}
            onOpenAll={() => setDrawerOpen(true)}
            onRetry={() => void loadCustomers()}
            onSeed={seedCustomers}
          />
        )}
      </main>

      <AllCustomersDrawer open={drawerOpen} customers={customers} onClose={() => setDrawerOpen(false)} onOpenCustomer={openCustomer} />
    </div>
  );
}
