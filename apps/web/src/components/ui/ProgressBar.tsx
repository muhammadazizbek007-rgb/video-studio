import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type ProgressTone = 'accent' | 'success' | 'warning' | 'danger';

const toneClass: Record<ProgressTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export interface ProgressBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** 0..100. Ignored when `indeterminate`. */
  value?: number;
  tone?: ProgressTone;
  indeterminate?: boolean;
  label?: string;
  thickness?: 'sm' | 'md';
}

export function ProgressBar({
  value = 0,
  tone = 'accent',
  indeterminate = false,
  label,
  thickness = 'md',
  className,
  ...rest
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 100}
      aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
      className={cn(
        'relative w-full overflow-hidden rounded-full bg-surface shadow-neu-inset-sm',
        thickness === 'sm' ? 'h-1.5' : 'h-2.5',
        className,
      )}
      {...rest}
    >
      {indeterminate ? (
        <div
          className={cn('absolute inset-y-0 w-1/3 animate-neu-indeterminate', toneClass[tone])}
        />
      ) : (
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-300 ease-out',
            toneClass[tone],
          )}
          style={{ width: `${clamped}%` }}
        />
      )}
    </div>
  );
}
