import type {
  ElementDto,
  ProjectPromptDto,
  VideoElementCategory,
  VoiceDto,
} from '@video-studio/shared';
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

/**
 * Fits three lists into one popup without letting the first one eat it.
 *
 * Concatenating and cutting to the cap is the obvious thing and it is wrong: elements come
 * first, so an account with eight of them pushed every voice and every project prompt off
 * the end. They were not missing — they were never reachable, which is indistinguishable
 * from missing to whoever is typing.
 *
 * Places are dealt round-robin so each list that has a match is represented before any list
 * takes a second, then the winners are put back in list order — the popup draws a heading
 * wherever the group changes, and an interleaved list would be all headings.
 */
function shareTheCap(groups: readonly MentionSuggestion[][]): MentionSuggestion[] {
  const pools = groups.map((group) => [...group]);
  const picked: MentionSuggestion[] = [];

  while (picked.length < MAX_SUGGESTIONS && pools.some((pool) => pool.length > 0)) {
    for (const pool of pools) {
      if (picked.length >= MAX_SUGGESTIONS) break;
      const next = pool.shift();
      if (next) picked.push(next);
    }
  }

  return groups.flatMap((group) => group.filter((item) => picked.includes(item)));
}

/**
 * What `@` can offer: a saved element or a saved narrator.
 *
 * They resolve in opposite directions and that is the whole reason for the union. An element
 * stays a handle — the server looks it up at generation time and attaches its photo, so the
 * prompt must keep the token. A voice has no server-side mention step, so picking one writes
 * its description straight into the text: what the user reads is what the model gets, and
 * they can edit it afterwards like any other words.
 */
export type MentionSuggestion =
  | { kind: 'element'; id: string; element: ElementDto }
  | { kind: 'voice'; id: string; voice: VoiceDto }
  | { kind: 'project'; id: string; projectPrompt: ProjectPromptDto };

export interface MentionAutocompleteInput<T extends MentionField> {
  value: string;
  onChange: (value: string) => void;
  elements: readonly ElementDto[];
  voices?: readonly VoiceDto[];
  projectPrompts?: readonly ProjectPromptDto[];
  /**
   * Prefix put in front of an inserted voice description.
   *
   * Load-bearing, not decoration: the server appends "no spoken narration" whenever the
   * scene says nothing about sound, so a description that never mentions a voice would be
   * followed by an instruction to stay silent.
   */
  voicePrefix?: string;
  fieldRef: RefObject<T | null>;
  maxLength?: number;
}

export interface MentionAutocomplete<T extends MentionField> {
  open: boolean;
  suggestions: MentionSuggestion[];
  activeIndex: number;
  listboxId: string;
  insert: (suggestion: MentionSuggestion) => void;
  close: () => void;
  handleChange: (event: ChangeEvent<T>) => void;
  /** Returns true when the key was consumed by the popup, so the caller can stop there. */
  handleKeyDown: (event: KeyboardEvent<T>) => boolean;
}

export function useMentionAutocomplete<T extends MentionField>({
  value,
  onChange,
  elements,
  voices = [],
  projectPrompts = [],
  voicePrefix = '',
  fieldRef,
  maxLength,
}: MentionAutocompleteInput<T>): MentionAutocomplete<T> {
  const listboxId = useId();
  const [query, setQuery] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions = useMemo<MentionSuggestion[]>(() => {
    if (query === null) return [];
    const needle = query.toLowerCase();
    const usage = readElementUsage();

    const matchedElements = elements
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
      .map((element): MentionSuggestion => ({ kind: 'element', id: element.id, element }));

    const matchedVoices = voices
      .filter((voice) => needle === '' || voice.name.toLowerCase().includes(needle))
      .map((voice): MentionSuggestion => ({ kind: 'voice', id: voice.id, voice }));

    const matchedProjects = projectPrompts
      .filter((entry) => needle === '' || entry.name.toLowerCase().includes(needle))
      .map(
        (projectPrompt): MentionSuggestion => ({
          kind: 'project',
          id: projectPrompt.id,
          projectPrompt,
        }),
      );

    return shareTheCap([matchedElements, matchedVoices, matchedProjects]);
  }, [elements, voices, projectPrompts, query]);

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

  function insert(suggestion: MentionSuggestion) {
    const field = fieldRef.current;
    const caret = field?.selectionStart ?? value.length;
    const before = value.slice(0, start);
    const after = value.slice(caret);

    // Only an element stays a token; everything else is pasted as the words it stands for.
    const written =
      suggestion.kind === 'element'
        ? suggestion.element.handle
        : suggestion.kind === 'voice'
          ? `${voicePrefix} ${suggestion.voice.prompt}`.trim()
          : suggestion.projectPrompt.prompt;

    const merged = `${before}${written} ${after}`;
    onChange(maxLength ? merged.slice(0, maxLength) : merged);
    setQuery(null);
    if (suggestion.kind === 'element') markElementUsed(suggestion.element.id);

    // The caret has to land after the inserted text, and only after React has written the
    // new value back into the field.
    const caretAfter = start + written.length + 1;
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
      const suggestion = suggestions[activeIndex];
      if (!suggestion) return false;
      event.preventDefault();
      insert(suggestion);
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
