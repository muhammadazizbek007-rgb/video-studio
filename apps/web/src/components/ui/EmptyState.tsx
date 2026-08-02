import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  children,
  ...rest
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg bg-surface px-8 py-section',
        'text-center shadow-neu-inset-sm',
        className,
      )}
      {...rest}
    >
      {icon != null ? (
        <span
          aria-hidden
          className={cn(
            'mb-1 inline-flex size-14 items-center justify-center rounded-full bg-surface',
            'text-text-subtle shadow-neu-raised-sm [&_svg]:size-6',
          )}
        >
          {icon}
        </span>
      ) : null}
      <p className="text-lg font-medium text-text-primary">{title}</p>
      {description != null ? (
        <p className="max-w-prose text-sm text-text-muted">{description}</p>
      ) : null}
      {action != null ? <div className="mt-2">{action}</div> : null}
      {children}
    </div>
  );
}
