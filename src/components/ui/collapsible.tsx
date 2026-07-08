import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export const collapsibleVariants = cva('border-b border-border', {
  variants: {
    density: {
      default: 'py-0',
      compact: 'py-0',
    },
  },
  defaultVariants: {
    density: 'default',
  },
});

interface CollapsibleProps extends VariantProps<typeof collapsibleVariants> {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function Collapsible({ title, defaultOpen = true, density, children }: CollapsibleProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className={collapsibleVariants({ density })}>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-[15px] font-bold text-text-primary hover:bg-surface-2"
      >
        {title}
        <ChevronDown size={16} className={cn('text-text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}
