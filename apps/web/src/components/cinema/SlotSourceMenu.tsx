import { Images, Upload } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Surface } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import { cn } from '@/lib/cn';

export interface SlotSourceMenuProps {
  /** Viewport rect of the slot that opened the menu — the panel is placed above it. */
  anchor: DOMRect;
  /** Label of that slot (`X.1` / `X.2`), shown as the panel caption. */
  slot: string;
  onUpload: () => void;
  onLibrary: () => void;
  onClose: () => void;
}

/** Matches `w-52`; the panel is positioned by hand, so the number has to be known here. */
const MENU_WIDTH = 208;
const GAP = 8;
const EDGE = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The two ways a frame can arrive: a file from the machine, or a still the user already
 * generated here.
 *
 * Rendered in a portal at fixed coordinates rather than inside the slot: the segment strip
 * scrolls horizontally, and an absolutely positioned panel would be clipped by that
 * scroll container instead of floating over the bar.
 */
export function SlotSourceMenu({
  anchor,
  slot,
  onUpload,
  onLibrary,
  onClose,
}: SlotSourceMenuProps) {
  const { t } = useLanguage();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  const left = clamp(
    anchor.left + anchor.width / 2 - MENU_WIDTH / 2,
    EDGE,
    Math.max(EDGE, window.innerWidth - MENU_WIDTH - EDGE),
  );
  // Anchored by its bottom edge, so the panel grows upward and never needs measuring.
  const bottom = Math.max(EDGE, window.innerHeight - anchor.top + GAP);

  const items: readonly { label: string; Icon: typeof Upload; onClick: () => void }[] = [
    { label: t('cinema.slotFromDevice'), Icon: Upload, onClick: onUpload },
    { label: t('cinema.slotFromLibrary'), Icon: Images, onClick: onLibrary },
  ];

  return createPortal(
    <>
      {/* Sibling, not parent: an outside click must not pass through the panel. */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        className="fixed inset-0 z-40 cursor-default"
        onClick={onClose}
      />
      <Surface
        role="menu"
        aria-label={`${slot} — ${t('cinema.slotSource')}`}
        elevation="raised-lg"
        radius="md"
        className="fixed z-50 animate-neu-pop-in overflow-hidden py-1"
        style={{ left, bottom, width: MENU_WIDTH }}
      >
        <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-widest text-text-subtle">
          {t('cinema.slotSource')}
        </p>
        {items.map(({ label, Icon, onClick }) => (
          <button
            key={label}
            type="button"
            role="menuitem"
            onClick={onClick}
            className={cn(
              'flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-text-muted',
              'transition-colors duration-[120ms] hover:text-text-primary',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
            )}
          >
            <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </Surface>
    </>,
    document.body,
  );
}

export default SlotSourceMenu;
