import type { InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export type InputSize = 'sm' | 'md' | 'lg';

const sizeClass: Record<InputSize, string> = {
  sm: 'h-9 rounded-sm px-3.5 text-sm',
  md: 'h-11 rounded-md px-4 text-base',
  lg: 'h-13 rounded-md px-5 text-lg',
};

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  inputSize?: InputSize;
  invalid?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { inputSize = 'md', invalid = false, leading, trailing, containerClassName, className, ...rest },
  ref,
) {
  const field = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full bg-surface text-text-primary shadow-neu-inset-sm outline-none',
        'transition-shadow duration-[120ms] ease-out placeholder:text-text-subtle',
        'focus:shadow-neu-inset focus-visible:outline-2 focus-visible:outline-offset-[3px]',
        'focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-55',
        sizeClass[inputSize],
        invalid && 'text-danger focus-visible:outline-danger',
        leading != null && 'pl-11',
        trailing != null && 'pr-11',
        className,
      )}
      {...rest}
    />
  );

  if (leading == null && trailing == null) return field;

  return (
    <span className={cn('relative inline-flex w-full items-center', containerClassName)}>
      {leading != null ? (
        <span className="pointer-events-none absolute left-4 flex text-text-subtle [&_svg]:size-4">
          {leading}
        </span>
      ) : null}
      {field}
      {trailing != null ? (
        <span className="absolute right-4 flex text-text-subtle [&_svg]:size-4">{trailing}</span>
      ) : null}
    </span>
  );
});
