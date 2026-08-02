import { X } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { IconButton } from './IconButton';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const sizeClass: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  size?: ModalSize;
  closeOnBackdropClick?: boolean;
  showCloseButton?: boolean;
  closeLabel?: string;
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  size = 'md',
  closeOnBackdropClick = true,
  showCloseButton = true,
  closeLabel = 'Закрыть',
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  useEffect(() => {
    if (!open) return;

    const active = document.activeElement;
    restoreRef.current = active instanceof HTMLElement ? active : null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();

    // Escape lives on the document so it still fires when focus sits on the backdrop.
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') closeRef.current();
    }
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  function trapTab(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      panel.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-gutter">
      {closeOnBackdropClick ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={closeLabel}
          onClick={onClose}
          className="absolute inset-0 animate-neu-fade-in cursor-default bg-backdrop"
        />
      ) : (
        <div className="absolute inset-0 animate-neu-fade-in bg-backdrop" />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title != null ? titleId : undefined}
        aria-describedby={description != null ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={cn(
          'relative flex max-h-[85vh] w-full flex-col gap-4 overflow-y-auto rounded-lg bg-surface',
          'animate-neu-pop-in p-8 shadow-neu-raised-lg outline-none',
          sizeClass[size],
          className,
        )}
      >
        {title != null || showCloseButton ? (
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              {title != null ? (
                <h2 id={titleId} className="text-xl font-medium text-text-primary">
                  {title}
                </h2>
              ) : null}
              {description != null ? (
                <p id={descriptionId} className="text-sm text-text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            {showCloseButton ? (
              <IconButton
                label={closeLabel}
                icon={<X />}
                size="sm"
                round
                onClick={onClose}
                className="-mt-2 -mr-2"
              />
            ) : null}
          </div>
        ) : null}
        {children}
        {footer != null ? <div className="flex justify-end gap-3 pt-2">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
