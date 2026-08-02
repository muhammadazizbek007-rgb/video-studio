import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef, useId, useState } from 'react';
import { cn } from '@/lib/cn';

export type ToggleSize = 'sm' | 'md';

const trackClass: Record<ToggleSize, string> = {
  sm: 'h-6 w-11',
  md: 'h-7 w-13',
};

const knobClass: Record<ToggleSize, string> = {
  sm: 'size-4',
  md: 'size-5',
};

const knobOffClass: Record<ToggleSize, string> = {
  sm: 'translate-x-1',
  md: 'translate-x-1',
};

const knobOnClass: Record<ToggleSize, string> = {
  sm: 'translate-x-6',
  md: 'translate-x-7',
};

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: ReactNode;
  size?: ToggleSize;
  containerClassName?: string;
}

export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(function Toggle(
  {
    checked,
    defaultChecked = false,
    onCheckedChange,
    label,
    size = 'md',
    containerClassName,
    className,
    disabled,
    onClick,
    id,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const labelId = `${id ?? generatedId}-label`;
  const [internal, setInternal] = useState(defaultChecked);
  const isControlled = checked !== undefined;
  const value = isControlled ? checked : internal;

  const control = (
    <button
      ref={ref}
      id={id}
      type="button"
      role="switch"
      aria-checked={value}
      aria-labelledby={label != null ? labelId : undefined}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        const next = !value;
        if (!isControlled) setInternal(next);
        onCheckedChange?.(next);
      }}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full bg-surface shadow-neu-inset-sm',
        'transition-colors duration-[120ms] ease-out',
        'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-55',
        trackClass[size],
        value && 'bg-accent-soft',
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none rounded-full shadow-neu-raised-sm',
          'transition-[transform,background-color] duration-[120ms] ease-out',
          knobClass[size],
          value ? knobOnClass[size] : knobOffClass[size],
          value ? 'bg-accent' : 'bg-surface',
        )}
      />
    </button>
  );

  if (label == null) return control;

  return (
    <span className={cn('inline-flex items-center gap-3', containerClassName)}>
      {control}
      <span id={labelId} className="text-sm text-text-muted">
        {label}
      </span>
    </span>
  );
});
