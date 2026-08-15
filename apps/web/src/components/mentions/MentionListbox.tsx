import type { VideoElementCategory } from '@video-studio/shared';
import { Mic } from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import type { MentionSuggestion } from './useMentionAutocomplete';

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

/** The one heading voices sit under; elements keep their category headings. */
const VOICE_GROUP_KEY: TranslationKey = 'mentions.category.voice';

export interface MentionListboxProps {
  id: string;
  suggestions: readonly MentionSuggestion[];
  activeIndex: number;
  onSelect: (suggestion: MentionSuggestion) => void;
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
      {suggestions.map((suggestion, index) => {
        const previous = suggestions[index - 1];
        // A heading appears wherever the group changes; voices are one group of their own.
        const group =
          suggestion.kind === 'element'
            ? CATEGORY_KEYS[suggestion.element.category]
            : VOICE_GROUP_KEY;
        const previousGroup =
          previous === undefined
            ? null
            : previous.kind === 'element'
              ? CATEGORY_KEYS[previous.element.category]
              : VOICE_GROUP_KEY;

        return (
          // biome-ignore lint/a11y/useFocusableInteractive: WAI-ARIA combobox; focus stays in the field and the active option is pointed at by aria-activedescendant
          <li
            key={`${suggestion.kind}-${suggestion.id}`}
            id={`${id}-${index}`}
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: listbox options must carry the option role; selection is driven from the field's keydown handler
            role="option"
            aria-selected={index === activeIndex}
          >
            {group !== previousGroup ? (
              <span
                aria-hidden="true"
                className="block px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider opacity-50"
              >
                {t(group)}
              </span>
            ) : null}

            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(event) => {
                // Losing focus first would close the popup before the click ever landed.
                event.preventDefault();
                onSelect(suggestion);
              }}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                index === activeIndex ? 'bg-current/10' : ''
              }`}
            >
              {suggestion.kind === 'voice' ? (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-current/10">
                  <Mic className="size-4 opacity-70" aria-hidden />
                </span>
              ) : suggestion.element.imageUrl ? (
                <img
                  src={suggestion.element.imageUrl}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="h-8 w-8 shrink-0 rounded-lg bg-current/10" />
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {suggestion.kind === 'voice' ? suggestion.voice.name : suggestion.element.handle}
                </span>
                <span className="block truncate text-xs opacity-60">
                  {suggestion.kind === 'voice'
                    ? suggestion.voice.prompt
                    : `${suggestion.element.name}${suggestion.element.description ? ` · ${suggestion.element.description}` : ''}`}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default MentionListbox;
