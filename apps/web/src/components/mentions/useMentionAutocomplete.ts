import type { ElementDto, VideoElementCategory } from '@video-studio/shared';
import type { ChangeEvent, KeyboardEvent, RefObject } from 'react';
import { useId, useMemo, useState } from 'react';
import { markElementUsed, readElementUsage } from '@/lib/elementUsage';

/**
 * The `@` popup, shared by every prompt field.
 *
 * The studio types into a textarea and the cinema bar into a single-line input, but the
 * behaviour has to be identical — same handles, same ordering, same keys — so it lives here
 * rather than being written twice and drifting.
 */

/** Any script: an ASCII-only class stopped the popup dead on `@Мух`. */
const MENTION_PATTERN = /@([\p{L}\p{N}_]*)$/u;
const MAX_SUGGESTIONS = 8;

/** Characters first — the category people reach for, and the one Veo honours best. */
export const MENTION_CATEGORY_ORDER: readonly VideoElementCategory[] = [
  'character',
  'location',
  'prop',
  'general',
];

type MentionField = HTMLTextAreaElement | HTMLInputElement;

export interface MentionAutocompleteInput<T extends MentionField> {
  value: string;
  onChange: (value: string) => void;
  elements: readonly ElementDto[];
  fieldRef: RefObject<T | null>;
  maxLength?: number;
}

export interface MentionAutocomplete<T extends MentionField> {
  open: boolean;
  suggestions: ElementDto[];
  activeIndex: number;
  listboxId: string;
  insert: (element: ElementDto) => void;
  close: () => void;
  handleChange: (event: ChangeEvent<T>) => void;
  /** Returns true when the key was consumed by the popup, so the caller can stop there. */
  handleKeyDown: (event: KeyboardEvent<T>) => boolean;
}

export function useMentionAutocomplete<T extends MentionField>({
  value,
  onChange,
  elements,
  fieldRef,
  maxLength,
}: MentionAutocompleteInput<T>): MentionAutocomplete<T> {
  const listboxId = useId();
  const [query, setQuery] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions = useMemo(() => {
    if (query === null) return [];
    const needle = query.toLowerCase();
    const usage = readElementUsage();

    return elements
      .filter(
        (element) =>
          needle === '' ||
          element.name.toLowerCase().includes(needle) ||
          element.handle.toLowerCase().includes(needle),
      )
      .slice()
      .sort((a, b) => {
        const byCategory =
          MENTION_CATEGORY_ORDER.indexOf(a.category) - MENTION_CATEGORY_ORDER.indexOf(b.category);
        if (byCategory !== 0) return byCategory;
        // Recently used first within a category; never-used fall back to newest.
        const usedA = usage[a.id] ?? '';
        const usedB = usage[b.id] ?? '';
        if (usedA !== usedB) return usedB.localeCompare(usedA);
        return b.createdAt.localeCompare(a.createdAt);
      })
      .slice(0, MAX_SUGGESTIONS);
  }, [elements, query]);

  const open = query !== null && suggestions.length > 0;

  function sync(next: string, caret: number) {
    const match = MENTION_PATTERN.exec(next.slice(0, caret));
    if (!match) {
      setQuery(null);
      return;
    }
    setQuery(match[1] ?? '');
    setStart(caret - match[0].length);
    setActiveIndex(0);
  }

  function handleChange(event: ChangeEvent<T>) {
    const next = maxLength ? event.target.value.slice(0, maxLength) : event.target.value;
    onChange(next);
    sync(next, event.target.selectionStart ?? next.length);
  }

  function insert(element: ElementDto) {
    const field = fieldRef.current;
    const caret = field?.selectionStart ?? value.length;
    const before = value.slice(0, start);
    const after = value.slice(caret);
    const merged = `${before}${element.handle} ${after}`;
    onChange(maxLength ? merged.slice(0, maxLength) : merged);
    setQuery(null);
    markElementUsed(element.id);

    // The caret has to land after the inserted handle, and only after React has written the
    // new value back into the field.
    const caretAfter = start + element.handle.length + 1;
    requestAnimationFrame(() => {
      const target = fieldRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(caretAfter, caretAfter);
    });
  }

  function handleKeyDown(event: KeyboardEvent<T>): boolean {
    if (!open) return false;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setQuery(null);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const element = suggestions[activeIndex];
      if (!element) return false;
      event.preventDefault();
      insert(element);
      return true;
    }
    return false;
  }

  return {
    open,
    suggestions,
    activeIndex,
    listboxId,
    insert,
    close: () => setQuery(null),
    handleChange,
    handleKeyDown,
  };
}
