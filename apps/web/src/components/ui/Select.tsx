import { ChevronDown } from 'lucide-react';
import type { SelectHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export type SelectSize = 'sm' | 'md' | 'lg';

const sizeClass: Record<SelectSize, string> = {
  sm: 'h-9 rounded-sm pl-3.5 pr-10 text-sm',
  md: 'h-11 rounded-md pl-4 pr-11 text-base',
  lg: 'h-13 rounded-md pl-5 pr-12 text-lg',
};

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  selectSize?: SelectSize;
  invalid?: boolean;
  containerClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { selectSize = 'md', invalid = false, containerClassName, className, children, ...rest },
  ref,
) {
  return (
    <span className={cn('relative inline-flex w-full items-center', containerClassName)}>
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'w-full appearance-none bg-surface text-text-primary shadow-neu-inset-sm outline-none',
          'transition-shadow duration-[120ms] ease-out focus:shadow-neu-inset',
          'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent',
          'disabled:cursor-not-allowed disabled:opacity-55',
          sizeClass[selectSize],
          invalid && 'text-danger focus-visible:outline-danger',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-4 size-4 text-text-subtle"
      />
    </span>
  );
});
