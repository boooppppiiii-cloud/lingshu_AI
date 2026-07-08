import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export const badgeVariants = cva(
  'inline-flex items-center rounded-lg border px-2 py-1 text-[13px] font-bold leading-none',
  {
    variants: {
      variant: {
        default: 'border-border bg-surface-2 text-text-secondary',
        success: 'border-accent/20 bg-accent-glow text-green',
        warning: 'border-amber/20 bg-amber-dim text-amber',
        danger: 'border-red/20 bg-red/10 text-red',
        outline: 'border-border bg-surface text-text-muted',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
