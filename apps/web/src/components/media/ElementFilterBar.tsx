import type { VideoElementCategory } from '@video-studio/shared';
import {
  ArrowDownAZ,
  CalendarPlus,
  Check,
  History,
  Image as ImageIcon,
  type Images,
  ListFilter,
  Package,
  Save,
  Search,
  Smile,
} from 'lucide-react';
import { useId } from 'react';
import { Input, Surface } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { cn } from '@/lib/cn';

export type ElementSort = 'created' | 'used' | 'name';
/** `all` is the unfiltered view; the rest match an element's own category. */
export type ElementCategoryFilter = 'all' | VideoElementCategory;

interface MenuItem<T extends string> {
  value: T;
  label: TranslationKey;
  Icon: typeof Images;
}

const SORTS: readonly MenuItem<ElementSort>[] = [
  { value: 'created', label: 'elementFilter.sortCreated', Icon: CalendarPlus },
  { value: 'used', label: 'elementFilter.sortUsed', Icon: History },
  { value: 'name', label: 'elementFilter.sortName', Icon: ArrowDownAZ },
];

const CATEGORIES: readonly MenuItem<ElementCategoryFilter>[] = [
  { value: 'all', label: 'elementFilter.all', Icon: Package },
  { value: 'character', label: 'elementFilter.characters', Icon: Smile },
  { value: 'location', label: 'elementFilter.locations', Icon: ImageIcon },
  { value: 'prop', label: 'elementFilter.props', Icon: Save },
  { value: 'general', label: 'elementFilter.general', Icon: Package },
];

export interface ElementFilterBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  sort: ElementSort;
  onSortChange: (value: ElementSort) => void;
  category: ElementCategoryFilter;
  onCategoryChange: (value: ElementCategoryFilter) => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}

/** The strip above the Elements grid: what to show, and in what order. */
export function ElementFilterBar({
  query,
  onQueryChange,
  sort,
  onSortChange,
  category,
  onCategoryChange,
  menuOpen,
  onMenuOpenChange,
}: ElementFilterBarProps) {
  const { t } = useLanguage();
  const menuId = useId();

  // Neither section is a filter that can be switched off, so both always carry a checkmark —
  // the menu is two radio groups wearing the same clothes.
  function renderItem<T extends string>(
    item: MenuItem<T>,
    selected: boolean,
    onPick: (value: T) => void,
  ) {
    return (
      <button
        key={item.value}
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        onClick={() => {
          onPick(item.value);
          onMenuOpenChange(false);
        }}
        className={cn(
          'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm',
          'transition-colors duration-[120ms]',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
          selected ? 'text-text-primary' : 'text-text-muted hover:text-text-primary',
        )}
      >
        <item.Icon className="size-4 shrink-0 opacity-70" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
        {selected ? <Check className="size-4 shrink-0 text-accent" aria-hidden /> : null}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-auto text-sm font-semibold text-text-muted">
        {t('elementFilter.heading')}
      </span>

      <div className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          onClick={() => onMenuOpenChange(!menuOpen)}
          className={cn(
            'flex items-center gap-2 rounded-full bg-surface px-3.5 py-2 text-xs font-semibold',
            'transition-[box-shadow,color] duration-[120ms]',
            'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent',
            menuOpen
              ? 'text-text-primary shadow-neu-inset-sm'
              : 'text-text-subtle shadow-neu-raised-sm hover:text-text-primary',
          )}
        >
          <ListFilter className="size-3.5" aria-hidden />
          {t('elementFilter.filter')}
        </button>

        {menuOpen ? (
          <>
            {/* Sibling, not parent: an outside click must not pass through the panel. */}
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => onMenuOpenChange(false)}
            />
            <Surface
              id={menuId}
              role="menu"
              aria-label={t('elementFilter.filter')}
              elevation="raised-lg"
              radius="md"
              className="absolute right-0 top-full z-50 mt-2 w-56 animate-neu-pop-in overflow-hidden py-1"
            >
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-text-subtle">
                {t('elementFilter.sortBy')}
              </p>
              {SORTS.map((item) => renderItem(item, item.value === sort, onSortChange))}

              <p className="mt-1 border-t border-text-subtle/15 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-text-subtle">
                {t('elementFilter.category')}
              </p>
              {CATEGORIES.map((item) =>
                renderItem(item, item.value === category, onCategoryChange),
              )}
            </Surface>
          </>
        ) : null}
      </div>

      <Input
        inputSize="sm"
        type="search"
        value={query}
        leading={<Search aria-hidden />}
        aria-label={t('elementFilter.search')}
        placeholder={t('elementFilter.search')}
        onChange={(event) => onQueryChange(event.target.value)}
        containerClassName="w-44 shrink-0"
        className="rounded-full text-xs"
      />
    </div>
  );
}

export default ElementFilterBar;
