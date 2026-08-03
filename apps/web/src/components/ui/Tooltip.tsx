import type {
  FocusEventHandler,
  HTMLAttributes,
  KeyboardEventHandler,
  MouseEventHandler,
  ReactElement,
  ReactNode,
} from 'react';
import { Children, cloneElement, useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

const sideClass: Record<TooltipSide, string> = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
  left: 'top-1/2 right-full mr-2 -translate-y-1/2',
  right: 'top-1/2 left-full ml-2 -translate-y-1/2',
};

export interface TooltipProps {
  content: ReactNode;
  /** Exactly one interactive element — it receives aria-describedby and the open/close handlers. */
  children: ReactElement<HTMLAttributes<HTMLElement>>;
  side?: TooltipSide;
  delayMs?: number;
  className?: string;
  containerClassName?: string;
}

export function Tooltip({
  content,
  children,
  side = 'top',
  delayMs = 120,
  className,
  containerClassName,
}: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  function show(immediate: boolean) {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (immediate || delayMs <= 0) {
      setOpen(true);
      return;
    }
    timerRef.current = setTimeout(() => setOpen(true), delayMs);
  }

  function hide() {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setOpen(false);
  }

  const child = Children.only(children);
  const childProps = child.props;

  const onMouseEnter: MouseEventHandler<HTMLElement> = (event) => {
    childProps.onMouseEnter?.(event);
    show(false);
  };
  const onMouseLeave: MouseEventHandler<HTMLElement> = (event) => {
    childProps.onMouseLeave?.(event);
    hide();
  };
  const onFocus: FocusEventHandler<HTMLElement> = (event) => {
    childProps.onFocus?.(event);
    show(true);
  };
  const onBlur: FocusEventHandler<HTMLElement> = (event) => {
    childProps.onBlur?.(event);
    hide();
  };
  const onKeyDown: KeyboardEventHandler<HTMLElement> = (event) => {
    childProps.onKeyDown?.(event);
    if (event.key === 'Escape') hide();
  };

  return (
    <span className={cn('relative inline-flex', containerClassName)}>
      {cloneElement(child, {
        'aria-describedby': open ? id : childProps['aria-describedby'],
        onMouseEnter,
        onMouseLeave,
        onFocus,
        onBlur,
        onKeyDown,
      })}
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-40 animate-neu-fade-in rounded-sm bg-surface',
            'px-3 py-1.5 text-xs whitespace-nowrap text-text-muted shadow-neu-raised-sm',
            sideClass[side],
            className,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
