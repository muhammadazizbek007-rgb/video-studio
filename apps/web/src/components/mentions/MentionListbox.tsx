import type { ElementDto, VideoElementCategory } from '@video-studio/shared';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';

/**
 * The popup itself. Options are grouped under their category heading: a flat list of names
 * gives no hint that `@Кафе` is a place and `@Мухаммад` is a person, which is exactly what
 * the user is choosing between. Keyboard navigation still runs over one flat array — the
 * grouping is presentation only.
 */

const CATEGORY_KEYS: Record<VideoElementCategory, TranslationKey> = {
  character: 'mentions.category.character',
  location: 'mentions.category.location',
  prop: 'mentions.category.prop',
  general: 'mentions.category.general',
};

export interface MentionListboxProps {
  id: string;
  suggestions: readonly ElementDto[];
  activeIndex: number;
  onSelect: (element: ElementDto) => void;
  /** `bottom` opens upwards, for a field pinned to the bottom of the screen. */
  placement?: 'top' | 'bottom';
}

export function MentionListbox({
  id,
  suggestions,
  activeIndex,
  onSelect,
  placement = 'top',
}: MentionListboxProps) {
  const { t } = useLanguage();

  return (
    <ul
      id={id}
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a combobox popup is specified as a listbox, and a list is the correct host for its options
      role="listbox"
      aria-label={t('studio.mentions')}
      data-testid="mention-listbox"
      className={`absolute inset-x-0 z-20 overflow-hidden rounded-xl border border-current/10 bg-surface shadow-neu-raised-lg ${
        placement === 'bottom' ? 'bottom-full mb-1' : 'top-full mt-1'
      }`}
    >
      {suggestions.map((element, index) => (
        // biome-ignore lint/a11y/useFocusableInteractive: WAI-ARIA combobox; focus stays in the field and the active option is pointed at by aria-activedescendant
        <li
          key={element.id}
          id={`${id}-${index}`}
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: listbox options must carry the option role; selection is driven from the field's keydown handler
          role="option"
          aria-selected={index === activeIndex}
        >
          {/* The list is sorted by category, so a heading appears wherever it changes. */}
          {element.category !== suggestions[index - 1]?.category ? (
            <span
              aria-hidden="true"
              className="block px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider opacity-50"
            >
              {t(CATEGORY_KEYS[element.category])}
            </span>
          ) : null}

          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(event) => {
              // Losing focus first would close the popup before the click ever landed.
              event.preventDefault();
              onSelect(element);
            }}
            className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
              index === activeIndex ? 'bg-current/10' : ''
            }`}
          >
            {element.imageUrl ? (
              <img
                src={element.imageUrl}
                alt=""
                className="h-8 w-8 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="h-8 w-8 shrink-0 rounded-lg bg-current/10" />
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{element.handle}</span>
              <span className="block truncate text-xs opacity-60">
                {element.name}
                {element.description ? ` · ${element.description}` : ''}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default MentionListbox;
