import type {
  CameraMotion,
  ElementDto,
  ElementRef,
  VideoGenerationMode,
  VideoStylePreset,
} from '@video-studio/shared';
import { ELEMENT_CATEGORY_LABELS } from '@video-studio/shared';
import { Sparkles } from 'lucide-react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useId, useMemo, useRef, useState } from 'react';
import { Button, Surface, Textarea } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import { api } from '@/lib/api';

const MENTION_PATTERN = /@([\wа-яёА-ЯЁ]*)$/;
const MAX_SUGGESTIONS = 6;
/** Word-level diffing is quadratic; long prompts fall back to a plain before/after view. */
const MAX_DIFF_WORDS = 400;

interface DiffToken {
  text: string;
  kind: 'same' | 'added' | 'removed';
}

export function diffWords(before: string, after: string): DiffToken[] {
  const source = before.split(/(\s+)/).filter((token) => token !== '');
  const target = after.split(/(\s+)/).filter((token) => token !== '');
  if (source.length > MAX_DIFF_WORDS || target.length > MAX_DIFF_WORDS) {
    return [
      { text: before, kind: 'removed' },
      { text: after, kind: 'added' },
    ];
  }

  const rows = source.length + 1;
  const cols = target.length + 1;
  const lengths = new Int32Array(rows * cols);
  for (let i = source.length - 1; i >= 0; i -= 1) {
    for (let j = target.length - 1; j >= 0; j -= 1) {
      lengths[i * cols + j] =
        source[i] === target[j]
          ? (lengths[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(lengths[(i + 1) * cols + j] ?? 0, lengths[i * cols + j + 1] ?? 0);
    }
  }

  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < source.length && j < target.length) {
    if (source[i] === target[j]) {
      tokens.push({ text: source[i] ?? '', kind: 'same' });
      i += 1;
      j += 1;
    } else if ((lengths[(i + 1) * cols + j] ?? 0) >= (lengths[i * cols + j + 1] ?? 0)) {
      tokens.push({ text: source[i] ?? '', kind: 'removed' });
      i += 1;
    } else {
      tokens.push({ text: target[j] ?? '', kind: 'added' });
      j += 1;
    }
  }
  while (i < source.length) {
    tokens.push({ text: source[i] ?? '', kind: 'removed' });
    i += 1;
  }
  while (j < target.length) {
    tokens.push({ text: target[j] ?? '', kind: 'added' });
    j += 1;
  }
  return tokens;
}

export interface EnrichContext {
  stylePreset: VideoStylePreset;
  cameraMotion: CameraMotion;
  mode: VideoGenerationMode;
  elements: ElementRef[];
}

interface PromptComposerProps {
  value: string;
  onChange: (value: string) => void;
  elements: readonly ElementDto[];
  enrichContext: EnrichContext;
  maxLength?: number;
  disabled?: boolean;
}

export function PromptComposer({
  value,
  onChange,
  elements,
  enrichContext,
  maxLength = 8000,
  disabled = false,
}: PromptComposerProps) {
  const { t } = useLanguage();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listboxId = useId();

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [enriching, setEnriching] = useState(false);
  const [enriched, setEnriched] = useState<string | null>(null);
  const [enrichError, setEnrichError] = useState('');

  const suggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.toLowerCase();
    return elements
      .filter(
        (element) =>
          query === '' ||
          element.name.toLowerCase().includes(query) ||
          element.handle.toLowerCase().includes(query),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [elements, mentionQuery]);

  const open = mentionQuery !== null && suggestions.length > 0;

  function syncMention(nextValue: string, caret: number) {
    const match = MENTION_PATTERN.exec(nextValue.slice(0, caret));
    if (match) {
      setMentionQuery(match[1] ?? '');
      setMentionStart(caret - match[0].length);
      setActiveIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value.slice(0, maxLength);
    onChange(next);
    syncMention(next, event.target.selectionStart ?? next.length);
  }

  function insertMention(element: ElementDto) {
    const caret = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, mentionStart);
    const after = value.slice(caret);
    const next = `${before}${element.handle} ${after}`.slice(0, maxLength);
    onChange(next);
    setMentionQuery(null);

    const caretAfter = mentionStart + element.handle.length + 1;
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(caretAfter, caretAfter);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setMentionQuery(null);
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const element = suggestions[activeIndex];
      if (!element) return;
      event.preventDefault();
      insertMention(element);
    }
  }

  async function enhance() {
    const prompt = value.trim();
    if (!prompt) return;
    setEnriching(true);
    setEnrichError('');
    try {
      const result = await api.prompt.enrich({
        prompt,
        stylePreset: enrichContext.stylePreset,
        cameraMotion: enrichContext.cameraMotion,
        mode: enrichContext.mode,
        elements: enrichContext.elements,
      });
      setEnriched(result.enrichedPrompt);
    } catch (error) {
      setEnrichError(error instanceof Error ? error.message : t('prompt.enrichFailed'));
    } finally {
      setEnriching(false);
    }
  }

  const diff = enriched === null ? [] : diffWords(value.trim(), enriched);
  const overLimit = value.length >= maxLength;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider opacity-60">
          {t('studio.prompt')}
        </span>
        <span className={`text-xs tabular-nums ${overLimit ? 'font-semibold' : 'opacity-60'}`}>
          {value.length} / {maxLength}
        </span>
      </div>

      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={value}
          disabled={disabled}
          rows={6}
          maxLength={maxLength}
          placeholder={t('studio.promptPlaceholder')}
          aria-label={t('studio.prompt')}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => window.setTimeout(() => setMentionQuery(null), 120)}
        />

        {open ? (
          <ul
            id={listboxId}
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a combobox popup is specified as a listbox, and a list is the correct host for its options
            role="listbox"
            aria-label={t('studio.mentions')}
            className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-current/10 bg-current/5 backdrop-blur"
          >
            {suggestions.map((element, index) => (
              // biome-ignore lint/a11y/useFocusableInteractive: WAI-ARIA combobox; focus stays in the textarea and the active option is pointed at by aria-activedescendant
              <li
                key={element.id}
                id={`${listboxId}-${index}`}
                // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: listbox options must carry the option role; selection is driven from the textarea's keydown handler
                role="option"
                aria-selected={index === activeIndex}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insertMention(element);
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
                      {element.name} · {ELEMENT_CATEGORY_LABELS[element.category]}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={enriching}
          disabled={disabled || value.trim().length === 0}
          onClick={() => void enhance()}
        >
          <Sparkles className="h-4 w-4" />
          {t('prompt.enhance')}
        </Button>
        <span className="text-xs opacity-60">{t('studio.mentionHint')}</span>
      </div>

      {enrichError ? (
        <p role="alert" className="text-xs opacity-80">
          {enrichError}
        </p>
      ) : null}

      {enriched !== null ? (
        <Surface className="flex flex-col gap-3 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-60">
            {t('prompt.enrichedTitle')}
          </p>
          <p className="text-sm leading-6">
            {diff.map((token, index) => (
              <span
                key={`${token.kind}-${index}`}
                className={
                  token.kind === 'added'
                    ? 'rounded bg-current/10 font-medium'
                    : token.kind === 'removed'
                      ? 'line-through opacity-50'
                      : ''
                }
              >
                {token.text}
              </span>
            ))}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onChange(enriched.slice(0, maxLength));
                setEnriched(null);
              }}
            >
              {t('prompt.accept')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEnriched(null)}>
              {t('prompt.reject')}
            </Button>
          </div>
        </Surface>
      ) : null}
    </div>
  );
}

export default PromptComposer;
