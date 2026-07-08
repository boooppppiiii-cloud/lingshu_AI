import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Dialog } from '../../../components/ui/dialog';
import type { CustomerProfile, CustomerView } from '../types';
import { avatarInitial, filterCustomers, VIEW_LABELS } from '../lib/customer-utils';

interface AllCustomersDrawerProps {
  open: boolean;
  customers: CustomerProfile[];
  onClose: () => void;
  onOpenCustomer: (id: string) => void;
}

export function AllCustomersDrawer({ open, customers, onClose, onOpenCustomer }: AllCustomersDrawerProps) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<CustomerView>('leads');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return filterCustomers(view, customers).filter(customer => {
      if (!q) return true;
      return [customer.name, customer.product, customer.countryName, customer.source]
        .some(value => value.toLowerCase().includes(q));
    });
  }, [customers, query, view]);

  return (
    <Dialog open={open} onClose={onClose} title="全部客户" variant="drawer">
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
          <Search size={16} className="text-text-muted" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-text-muted"
            placeholder="搜索客户、商品、国家"
          />
        </div>
        <div className="mt-3 flex gap-2">
          {(['leads', 'won', 'silent'] as CustomerView[]).map(key => (
            <Button key={key} type="button" variant={view === key ? 'secondary' : 'outline'} size="sm" onClick={() => setView(key)}>
              {VIEW_LABELS[key]}
            </Button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-[15px] text-text-secondary">没有匹配客户</div>
        ) : list.map(customer => (
          <button
            key={customer.id}
            type="button"
            onClick={() => onOpenCustomer(customer.id)}
            className="flex w-full items-center gap-3 rounded-lg border-b border-border bg-surface px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-surface-2"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-[15px] font-bold text-text-secondary">{avatarInitial(customer)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold text-text-primary">{customer.name}</span>
              <span className="block truncate text-[13px] text-text-muted">{customer.product}</span>
            </span>
            <Badge variant="outline">{customer.stage}</Badge>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
