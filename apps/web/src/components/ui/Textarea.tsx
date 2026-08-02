import type { TextareaHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /** Grows with its content via CSS `field-sizing`; falls back to a scrollbar where unsupported. */
  autoResize?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, autoResize = false, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full resize-y rounded-md bg-surface px-4 py-3 text-base text-text-primary',
        'shadow-neu-inset-sm outline-none transition-shadow duration-[120ms] ease-out',
        'placeholder:text-text-subtle focus:shadow-neu-inset',
        'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-55',
        invalid && 'text-danger focus-visible:outline-danger',
        autoResize && 'field-sizing-content resize-none',
        className,
      )}
      {...rest}
    />
  );
});
