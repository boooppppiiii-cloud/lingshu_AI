import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export const avatarVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 font-bold text-text-secondary',
  {
    variants: {
      size: {
        sm: 'h-8 w-8 text-[13px]',
        md: 'h-10 w-10 text-[15px]',
        lg: 'h-12 w-12 text-[17px]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

export const avatarStatusVariants = cva(
  'absolute -left-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-surface',
  {
    variants: {
      status: {
        unread: 'bg-accent',
        handled: 'bg-text-muted',
        call: 'bg-red',
      },
    },
    defaultVariants: {
      status: 'handled',
    },
  },
);

export type AvatarProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof avatarVariants> &
  VariantProps<typeof avatarStatusVariants> & {
    showStatus?: boolean;
  };

export function Avatar({ className, size, status, showStatus = true, children, ...props }: AvatarProps) {
  return (
    <div className={cn(avatarVariants({ size }), className)} {...props}>
      {showStatus && <span className={avatarStatusVariants({ status })} />}
      {children}
    </div>
  );
}
