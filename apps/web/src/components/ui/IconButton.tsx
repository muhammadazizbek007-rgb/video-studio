import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonVariant = 'ghost' | 'primary' | 'danger';

const sizeClass: Record<IconButtonSize, string> = {
  sm: 'size-9 rounded-sm [&_svg]:size-4',
  md: 'size-11 rounded-md [&_svg]:size-5',
  lg: 'size-13 rounded-md [&_svg]:size-6',
};

const variantClass: Record<IconButtonVariant, string> = {
  ghost: 'text-text-muted shadow-neu-raised-sm hover:text-text-primary hover:shadow-neu-raised',
  primary: 'bg-accent text-accent-contrast shadow-neu-raised',
  danger: 'text-danger shadow-neu-raised-sm hover:shadow-neu-raised',
};

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required: an icon-only control has no accessible name without it. */
  label: string;
  icon: ReactNode;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  loading?: boolean;
  round?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon,
    size = 'md',
    variant = 'ghost',
    loading = false,
    round = false,
    disabled,
    className,
    onClick,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isBlocked = loading || disabled === true;

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (isBlocked) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      disabled={isBlocked}
      aria-busy={loading || undefined}
      onClick={handleClick}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center bg-surface',
        'transition-[box-shadow,transform,color] duration-[120ms] ease-out',
        'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent',
        'active:scale-[0.94] active:shadow-neu-inset-sm',
        'disabled:pointer-events-none disabled:opacity-55 disabled:shadow-neu-inset-sm',
        sizeClass[size],
        variantClass[variant],
        round && 'rounded-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 'lg' ? 'md' : 'sm'} /> : icon}
    </button>
  );
});
