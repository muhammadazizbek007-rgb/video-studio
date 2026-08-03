import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
export type BadgeSize = 'sm' | 'md';

const toneClass: Record<BadgeTone, string> = {
  neutral: 'text-text-muted',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

const dotClass: Record<BadgeTone, string> = {
  neutral: 'bg-text-subtle',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

const sizeClass: Record<BadgeSize, string> = {
  sm: 'h-6 gap-1.5 px-2.5 text-xs',
  md: 'h-7 gap-2 px-3 text-sm',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Sunken instead of raised — reads as a passive tag rather than a status chip. */
  sunken?: boolean;
  dot?: boolean;
}

export function Badge({
  tone = 'neutral',
  size = 'sm',
  sunken = false,
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-surface font-medium whitespace-nowrap',
        sunken ? 'shadow-neu-inset-sm' : 'shadow-neu-raised-sm',
        sizeClass[size],
        toneClass[tone],
        className,
      )}
      {...rest}
    >
      {dot ? <span aria-hidden className={cn('size-1.5 rounded-full', dotClass[tone])} /> : null}
      {children}
    </span>
  );
}
