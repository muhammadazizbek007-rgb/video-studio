import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useId } from 'react';
import { Surface } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface ChipOption<T extends string | number> {
  value: T;
  label: string;
  /** Second line under the label — the model picker uses it for provider and limits. */
  secondary?: string;
  badge?: ReactNode;
}

export interface ChipDropdownProps<T extends string | number> {
  /** Uppercase caption on the panel's header strip. */
  caption: string;
  /** What the closed chip shows — an icon plus the current value. */
  children: ReactNode;
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tailwind width for the open panel; the model list is the wide one. */
  panelWidth?: string;
  scrollable?: boolean;
  disabled?: boolean;
}

/**
 * One chip, one panel that opens upward.
 *
 * The panel is anchored `bottom-full` because the whole settings row sits at the bottom of
 * the tab — opening downward would push it off-screen. The full-screen backdrop behind it
 * is what closes the panel on an outside click; it is a sibling rather than a wrapper so
 * clicks inside the panel never reach it.
 */
export function ChipDropdown<T extends string | number>({
  caption,
  children,
  options,
  value,
  onChange,
  open,
  onOpenChange,
  panelWidth = 'w-40',
  scrollable = false,
  disabled = false,
}: ChipDropdownProps<T>) {
  const panelId = useId();

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => onOpenChange(!open)}
        className={cn(
          'flex items-center gap-1.5 rounded-sm bg-surface px-2.5 py-1.5 text-xs font-semibold',
          'text-text-muted shadow-neu-raised-sm transition-[box-shadow,color] duration-[120ms]',
          'hover:text-text-primary hover:shadow-neu-raised',
          'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent',
          'disabled:pointer-events-none disabled:opacity-55',
          open && 'text-text-primary shadow-neu-inset-sm',
        )}
      >
        {children}
        <ChevronDown className="size-3 opacity-60" aria-hidden />
      </button>

      {open ? (
        <>
          {/* Sibling, not parent: an outside click must not pass through the panel. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => onOpenChange(false)}
          />
          <Surface
            id={panelId}
            role="listbox"
            aria-label={caption}
            elevation="raised-lg"
            radius="md"
            className={cn(
              'absolute bottom-full left-0 z-50 mb-2 overflow-hidden py-1',
              'animate-neu-pop-in',
              panelWidth,
            )}
          >
            <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-widest text-text-subtle">
              {caption}
            </p>
            <div className={cn(scrollable && 'max-h-72 overflow-y-auto')}>
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <button
                    key={String(option.value)}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(option.value);
                      onOpenChange(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm',
                      'transition-[box-shadow,color] duration-[120ms]',
                      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                      selected
                        ? 'font-semibold text-text-primary'
                        : 'text-text-muted hover:text-text-primary',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate">{option.label}</span>
                        {option.badge}
                      </span>
                      {option.secondary ? (
                        <span className="mt-0.5 block truncate text-xs font-normal text-text-subtle">
                          {option.secondary}
                        </span>
                      ) : null}
                    </span>
                    {selected ? (
                      <span aria-hidden className="size-2 shrink-0 rounded-full bg-accent" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Surface>
        </>
      ) : null}
    </div>
  );
}

export default ChipDropdown;
