import type { ElementType, HTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export type SurfaceElevation = 'flat' | 'raised-sm' | 'raised' | 'raised-lg' | 'inset-sm' | 'inset';

export type SurfaceRadius = 'none' | 'sm' | 'md' | 'lg' | 'full';

export const elevationClass: Record<SurfaceElevation, string> = {
  flat: 'shadow-none',
  'raised-sm': 'shadow-neu-raised-sm',
  raised: 'shadow-neu-raised',
  'raised-lg': 'shadow-neu-raised-lg',
  'inset-sm': 'shadow-neu-inset-sm',
  inset: 'shadow-neu-inset',
};

export const radiusClass: Record<SurfaceRadius, string> = {
  none: 'rounded-none',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
};

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  elevation?: SurfaceElevation;
  radius?: SurfaceRadius;
}

/**
 * The one primitive every other component is built on. It never changes the fill — rule 1 of the
 * design note — so `elevation` is the only way to express depth.
 */
export const Surface = forwardRef<HTMLElement, SurfaceProps>(function Surface(
  { as, elevation = 'raised', radius = 'md', className, ...rest },
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
        className,
      )}
      {...rest}
    />
  );
});
