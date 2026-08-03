import type { InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: ReactNode;
  /** Rendered opposite the label — usually the formatted current value. */
  valueLabel?: ReactNode;
  containerClassName?: string;
}

/**
 * A real `<input type="range">`; the inset track and raised thumb live in `.neu-range` because
 * vendor thumb pseudo-elements cannot be reached from utility classes.
 */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { label, valueLabel, containerClassName, className, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className={cn('flex w-full flex-col gap-2', containerClassName)}>
      {label != null || valueLabel != null ? (
        <div className="flex items-baseline justify-between gap-3">
          {label != null ? (
            <label htmlFor={inputId} className="text-sm text-text-muted">
              {label}
            </label>
          ) : (
            <span />
          )}
          {valueLabel != null ? (
            <span className="text-sm tabular-nums text-text-primary">{valueLabel}</span>
          ) : null}
        </div>
      ) : null}
      <input id={inputId} ref={ref} type="range" className={cn('neu-range', className)} {...rest} />
    </div>
  );
});
