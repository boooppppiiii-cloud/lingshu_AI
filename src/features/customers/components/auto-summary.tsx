import { Bot } from 'lucide-react';
import { Card } from '../../../components/ui/card';

export function AutoSummary({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count <= 0) return null;
  return (
    <button type="button" onClick={onOpen} className="w-full text-left">
      <Card className="flex items-center justify-between transition-colors hover:bg-surface-2" padding="sm">
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-glow text-green">
            <Bot size={16} />
          </span>
          <span className="truncate text-[15px] font-bold text-text-secondary">AI已自动接待{count}条新咨询</span>
        </span>
        <span className="text-[13px] font-bold text-green">点开看</span>
      </Card>
    </button>
  );
}
