import type { ElementType, HTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import type { SurfaceElevation, SurfaceRadius } from './Surface';
import { elevationClass, radiusClass } from './Surface';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const paddingClass: Record<CardPadding, string> = {
  none: 'p-0',
  sm: 'p-field',
  md: 'p-gutter',
  lg: 'p-8',
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  elevation?: SurfaceElevation;
  radius?: SurfaceRadius;
  padding?: CardPadding;
  /** Lifts on hover and presses on click. Pass `as="button"` or a link for real semantics. */
  interactive?: boolean;
}

export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  {
    as,
    elevation = 'raised',
    radius = 'lg',
    padding = 'md',
    interactive = false,
    className,
    ...rest
  },
  ref,
) {
  const Component = (as ?? 'div') as ElementType;
  return (
    <Component
      ref={ref}
      className={cn(
        'bg-surface text-text-primary',
        elevationClass[elevation],
        radiusClass[radius],
        paddingClass[padding],
        interactive && [
          'cursor-pointer text-left transition-[box-shadow,transform] duration-[120ms] ease-out',
          'hover:-translate-y-0.5 hover:shadow-neu-raised-lg',
          'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent',
          'active:translate-y-0 active:shadow-neu-inset-sm',
        ],
        className,
      )}
      {...rest}
    />
  );
});
