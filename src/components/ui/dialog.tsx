import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from './button';

export const dialogVariants = cva(
  'fixed z-50 flex flex-col border border-border bg-surface shadow-sm',
  {
    variants: {
      variant: {
        drawer: 'inset-y-0 right-0 w-full max-w-md rounded-l-xl',
        modal: 'left-1/2 top-1/2 max-h-[86vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl',
      },
      size: {
        md: '',
        lg: 'max-w-2xl',
      },
    },
    defaultVariants: {
      variant: 'modal',
      size: 'md',
    },
  },
);

export interface DialogProps extends VariantProps<typeof dialogVariants> {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ open, title, onClose, children, variant, size, className }: DialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-text-primary/20" onClick={onClose}>
      <section className={cn(dialogVariants({ variant, size }), className)} onClick={event => event.stopPropagation()}>
        {title && (
          <header className="flex items-center justify-between border-b border-border px-5 py-4">
            <p className="text-[20px] font-bold text-text-primary">{title}</p>
            <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
              <X size={18} />
            </Button>
          </header>
        )}
        {children}
      </section>
    </div>
  );
}
