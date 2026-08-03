import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type SkeletonVariant = 'text' | 'rect' | 'circle';

const variantClass: Record<SkeletonVariant, string> = {
  text: 'h-4 rounded-sm',
  rect: 'rounded-lg',
  circle: 'aspect-square rounded-full',
};

const LINE_KEYS = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'] as const;

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  variant?: SkeletonVariant;
  /** Renders N stacked text lines, the last one short, like a real paragraph. */
  lines?: number;
}

/** Sits sunken so it occupies the same visual plane the real content will land in. */
export function Skeleton({ variant = 'text', lines = 1, className, ...rest }: SkeletonProps) {
  if (variant === 'text' && lines > 1) {
    const keys = LINE_KEYS.slice(0, Math.min(lines, LINE_KEYS.length));
    const last = keys.at(-1);
    return (
      <div className="flex w-full flex-col gap-2.5" aria-hidden {...rest}>
        {keys.map((key) => (
          <div
            key={key}
            className={cn(
              'neu-shimmer shadow-neu-inset-sm',
              variantClass.text,
              key === last ? 'w-2/3' : 'w-full',
              className,
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      aria-hidden
      className={cn('neu-shimmer shadow-neu-inset-sm', variantClass[variant], className)}
      {...rest}
    />
  );
}
