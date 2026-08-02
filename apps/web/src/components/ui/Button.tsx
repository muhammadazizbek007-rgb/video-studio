import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-9 gap-1.5 rounded-sm px-4 text-sm',
  md: 'h-11 gap-2 rounded-md px-5 text-base',
  lg: 'h-13 gap-2.5 rounded-md px-7 text-lg',
};

// Only `primary` fills — the rest stay on the page's surface colour and separate
// themselves by text colour and elevation, which is what keeps the set coherent.
const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast shadow-neu-raised',
  secondary: 'text-accent shadow-neu-raised-sm hover:shadow-neu-raised',
  ghost: 'text-text-primary shadow-neu-raised-sm hover:shadow-neu-raised',
  danger: 'text-danger shadow-neu-raised-sm hover:shadow-neu-raised',
};

const spinnerSize: Record<ButtonSize, 'sm' | 'md'> = { sm: 'sm', md: 'sm', lg: 'md' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconPosition?: 'start' | 'end';
  fullWidth?: boolean;
}

/**
 * The press affordance — raised flipping to inset — is the core interaction of the whole system.
 * It animates box-shadow and transform only, so it stays on the compositor and reads as instant.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'ghost',
    size = 'md',
    loading = false,
    icon,
    iconPosition = 'start',
    fullWidth = false,
    disabled,
    className,
    children,
    onClick,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isBlocked = loading || disabled === true;
  const glyph = loading ? <Spinner size={spinnerSize[size]} /> : icon;

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    // `disabled` already stops real clicks; this also stops programmatic ones mid-flight.
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
      disabled={isBlocked}
      aria-busy={loading || undefined}
      onClick={handleClick}
      className={cn(
        'relative inline-flex select-none items-center justify-center bg-surface font-medium',
        'transition-[box-shadow,transform,color] duration-[120ms] ease-out',
        'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent',
        'active:scale-[0.985] active:shadow-neu-inset',
        'disabled:pointer-events-none disabled:opacity-55 disabled:shadow-neu-inset-sm',
        sizeClass[size],
        variantClass[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {glyph && iconPosition === 'start' ? (
        <span className="inline-flex shrink-0 items-center">{glyph}</span>
      ) : null}
      {children}
      {glyph && iconPosition === 'end' ? (
        <span className="inline-flex shrink-0 items-center">{glyph}</span>
      ) : null}
    </button>
  );
});
