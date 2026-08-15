import type {
  CameraMotion,
  ElementDto,
  ElementRef,
  VideoGenerationMode,
  VideoStylePreset,
} from '@video-studio/shared';
import { Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { MentionListbox } from '@/components/mentions/MentionListbox';
import { useMentionAutocomplete } from '@/components/mentions/useMentionAutocomplete';
import { Button, Surface, Textarea } from '@/components/ui';
import { useVoices } from '@/hooks/useVoices';
import { useLanguage } from '@/i18n/LanguageContext';
import { api } from '@/lib/api';

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

  const [enriching, setEnriching] = useState(false);
  const [enriched, setEnriched] = useState<string | null>(null);
  const [enrichError, setEnrichError] = useState('');

  const voices = useVoices();
  const mentions = useMentionAutocomplete<HTMLTextAreaElement>({
    value,
    onChange,
    elements,
    voices: voices.data ?? [],
    voicePrefix: t('voices.inlinePrefix'),
    fieldRef: textareaRef,
    maxLength,
  });

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
          aria-expanded={mentions.open}
          aria-controls={mentions.open ? mentions.listboxId : undefined}
          aria-activedescendant={
            mentions.open ? `${mentions.listboxId}-${mentions.activeIndex}` : undefined
          }
          onChange={mentions.handleChange}
          onKeyDown={mentions.handleKeyDown}
          // Closing on the next tick, so a click on an option still lands first.
          onBlur={() => window.setTimeout(mentions.close, 120)}
        />

        {mentions.open ? (
          <MentionListbox
            id={mentions.listboxId}
            suggestions={mentions.suggestions}
            activeIndex={mentions.activeIndex}
            onSelect={mentions.insert}
          />
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
