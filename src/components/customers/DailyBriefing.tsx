import { X } from 'lucide-react';
import type { CustomerProfile } from '../../types/customer';
import { buildPrioritySuggestion, completedTodoCustomers, pendingCustomers } from '../../lib/customerPriority';
import { SourceIcon } from './SourceIcon';

interface Props {
  customers: CustomerProfile[];
  onSelectCustomer: (id: string) => void;
  onClose: () => void;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function groupLabel(mode: CustomerProfile['handlingMode']) {
  if (mode === 'human_needed') return '需要你处理';
  if (mode === 'ai_draft') return '等你确认';
  return 'AI 接待中';
}

function priorityDot(customer: CustomerProfile) {
  const suggestion = buildPrioritySuggestion(customer);
  if (suggestion.tone === 'red') return 'bg-red-500';
  if (suggestion.tone === 'amber') return 'bg-amber-500';
  if (suggestion.tone === 'blue') return 'bg-sky-500';
  return 'bg-emerald-500';
}

export function DailyBriefing({ customers, onSelectCustomer, onClose }: Props) {
  const pending = pendingCustomers(customers);
  const completed = completedTodoCustomers(customers);
  const grouped = [
    { mode: 'human_needed' as const, items: pending.filter(customer => customer.handlingMode === 'human_needed') },
    { mode: 'ai_draft' as const, items: pending.filter(customer => customer.handlingMode === 'ai_draft') },
  ].filter(group => group.items.length > 0);
  const first = pending[0];

  const select = (id: string) => {
    onSelectCustomer(id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 px-4">
      <div className="w-full max-w-[480px] rounded-2xl border border-border bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <img src="/brand-logo.png" alt="灵小枢" className="h-8 w-8 object-contain" />
            <div>
              <p className="text-sm font-black text-text-primary">{greeting()}，今天有 {pending.length} 件事需要你</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2" title="关闭">
            <X size={15} />
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            {grouped.map(group => (
              <section key={group.mode}>
                <p className="mb-2 text-[11px] font-black text-text-muted">{groupLabel(group.mode)}</p>
                <div className="space-y-2">
                  {group.items.map(customer => {
                    const suggestion = buildPrioritySuggestion(customer);
                    return (
                      <button
                        key={customer.id}
                        type="button"
                        onClick={() => select(customer.id)}
                        className="flex w-full items-start gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-slate-300 hover:bg-white"
                      >
                        <SourceIcon source={customer.source} size={15} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-xs font-black text-text-primary">{customer.name}</p>
                            <span className={`h-2 w-2 rounded-full ${priorityDot(customer)}`} />
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-text-muted">{suggestion.reason}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            {completed.length > 0 && (
              <section>
                <p className="mb-2 text-[11px] font-black text-text-muted">已完成</p>
                <div className="space-y-2">
                  {completed.map(customer => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => select(customer.id)}
                      className="flex w-full items-start gap-3 rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-2.5 text-left transition-colors hover:border-emerald-200 hover:bg-emerald-50"
                    >
                      <SourceIcon source={customer.source} size={15} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-xs font-black text-text-primary">{customer.name}</p>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">已完成</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-emerald-700">今天已处理，已放到待办底部。</p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2">
            稍后
          </button>
          <button type="button" onClick={() => first && select(first.id)} disabled={!first} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
            开始处理
          </button>
        </div>
      </div>
    </div>
  );
}
