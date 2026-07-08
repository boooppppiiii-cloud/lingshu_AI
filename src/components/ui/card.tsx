import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export const cardVariants = cva('rounded-xl border bg-surface shadow-sm', {
  variants: {
    variant: {
      default: 'border-border',
      muted: 'border-border bg-surface-2',
      selected: 'border-accent bg-accent-glow',
      warning: 'border-amber/20 bg-amber-dim',
      danger: 'border-red/20 bg-red/10',
    },
    padding: {
      none: 'p-0',
      sm: 'p-4',
      md: 'p-5',
      lg: 'p-6',
    },
  },
  defaultVariants: {
    variant: 'default',
    padding: 'md',
  },
});

export type CardProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof cardVariants>;

export function Card({ className, variant, padding, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant, padding }), className)} {...props} />;
}
