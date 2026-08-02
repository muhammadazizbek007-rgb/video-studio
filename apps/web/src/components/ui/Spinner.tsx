import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type SpinnerSize = 'sm' | 'md' | 'lg';

const sizeClass: Record<SpinnerSize, string> = {
  sm: 'size-3.5 border-2',
  md: 'size-5 border-2',
  lg: 'size-8 border-[3px]',
};

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
  /** Announced to assistive tech. Omit inside a control that already reports aria-busy. */
  label?: string;
}

export function Spinner({ size = 'md', label, className, ...rest }: SpinnerProps) {
  return (
    <span
      className={cn('inline-flex items-center justify-center', className)}
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      <span
        className={cn(
          'animate-spin rounded-full border-current border-r-transparent opacity-70',
          sizeClass[size],
        )}
      />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
