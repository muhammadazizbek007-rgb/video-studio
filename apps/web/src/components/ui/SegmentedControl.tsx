import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { useRef } from 'react';
import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export type SegmentedSize = 'sm' | 'md';

const itemSizeClass: Record<SegmentedSize, string> = {
  sm: 'h-8 rounded-sm px-3 text-sm',
  md: 'h-10 rounded-sm px-4 text-base',
};

export interface SegmentedControlProps<T extends string>
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group; required unless you pass aria-labelledby. */
  label?: string;
  size?: SegmentedSize;
  fullWidth?: boolean;
  /** Disables the whole group; individual options can still opt out via their own flag. */
  disabled?: boolean;
}

/** A radiogroup with roving tabindex: one tab stop, arrows move and select. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  fullWidth = false,
  disabled = false,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  const nodes = useRef<(HTMLButtonElement | null)[]>([]);

  function moveTo(index: number) {
    const total = options.length;
    if (total === 0 || disabled) return;
    for (let step = 0; step < total; step += 1) {
      const candidateIndex = (((index + step) % total) + total) % total;
      const candidate = options[candidateIndex];
      if (candidate && candidate.disabled !== true) {
        onChange(candidate.value);
        nodes.current[candidateIndex]?.focus();
        return;
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const activeIndex = options.findIndex((option) => option.value === value);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveTo(activeIndex + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveTo(activeIndex - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveTo(options.length - 1);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-surface p-1 shadow-neu-inset-sm',
        fullWidth && 'flex w-full',
        className,
      )}
      {...rest}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: roving-tabindex ARIA radiogroup; real radio inputs would each be a tab stop, which is what this control exists to avoid
          <button
            key={option.value}
            ref={(node) => {
              nodes.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || option.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!disabled && option.disabled !== true) onChange(option.value);
            }}
            className={cn(
              'inline-flex select-none items-center justify-center whitespace-nowrap bg-surface',
              'transition-[box-shadow,color,transform] duration-[120ms] ease-out',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              'disabled:cursor-not-allowed disabled:opacity-45',
              itemSizeClass[size],
              fullWidth && 'flex-1',
              selected
                ? 'font-medium text-text-primary shadow-neu-raised-sm'
                : 'text-text-muted shadow-none hover:text-text-primary',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
