import { CheckCircle2, Inbox } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';

interface EmptyStateProps {
  mode: 'done' | 'empty' | 'error';
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function CustomerEmptyState({ mode, title, description, actionLabel, onAction }: EmptyStateProps) {
  const Icon = mode === 'done' ? CheckCircle2 : Inbox;
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <Card className="w-full max-w-md text-center" padding="lg">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-2">
          <Icon size={22} className={mode === 'done' ? 'text-green' : 'text-text-secondary'} />
        </div>
        <h2 className="mt-4 text-[24px] font-bold text-text-primary">{title}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-text-secondary">{description}</p>
        {actionLabel && onAction && (
          <Button type="button" onClick={onAction} variant={mode === 'error' ? 'outline' : 'default'} className="mt-5">
            {actionLabel}
          </Button>
        )}
      </Card>
    </div>
  );
}
