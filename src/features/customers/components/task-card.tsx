import { Check, ChevronRight } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Avatar } from '../../../components/ui/avatar';
import type { CustomerProfile } from '../types';
import { avatarInitial, customerStatus, lastMessageSummary } from '../lib/customer-utils';

interface TaskCardProps {
  customer: CustomerProfile;
  index: number;
  onOpen: () => void;
  onDone: () => void;
}

export function CustomerTaskCard({ customer, index, onOpen, onDone }: TaskCardProps) {
  return (
    <Card className="group overflow-hidden transition-colors hover:bg-surface-2" padding="none">
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <Avatar status={customerStatus(customer)}>
            {avatarInitial(customer)}
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[15px] font-bold text-text-primary">{customer.name}</span>
              <span className="hidden text-[13px] text-text-muted sm:inline">#{index + 1}</span>
            </span>
            <span className="mt-1 block truncate text-[15px] text-text-muted">{lastMessageSummary(customer)}</span>
          </span>
          <span className="shrink-0 self-start text-[13px] font-semibold text-text-muted">{customer.lastActive}</span>
        </button>
        <div className="hidden items-center gap-1 group-hover:flex">
          <Button type="button" onClick={onDone} variant="ghost" size="icon" title="已处理">
            <Check size={15} />
          </Button>
          <Button type="button" onClick={onOpen} variant="ghost" size="icon" title="查看对话">
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>
    </Card>
  );
}
