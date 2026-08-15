import { Mic, MicOff } from 'lucide-react';
import { useId } from 'react';
import { Select } from '@/components/ui';
import { useVoices } from '@/hooks/useVoices';
import { useLanguage } from '@/i18n/LanguageContext';

export interface VoicePickerProps {
  value: string | null;
  onChange: (voiceId: string | null) => void;
  disabled?: boolean;
  /** False for a model with no audio track, where a narrator would be a promise it cannot keep. */
  supported?: boolean;
}

/**
 * Which saved narrator speaks in this clip.
 *
 * Empty means what it has always meant — Veo fills the track with scene ambience and nobody
 * talks. Choosing a voice swaps that for the saved description, so the same person turns up
 * in every clip of a campaign instead of a new stranger each time.
 */
export function VoicePicker({
  value,
  onChange,
  disabled = false,
  supported = true,
}: VoicePickerProps) {
  const { t } = useLanguage();
  const voices = useVoices();
  const selectId = useId();

  const items = voices.data ?? [];

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={selectId}
        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider opacity-60"
      >
        {value && supported ? (
          <Mic className="size-3.5" aria-hidden />
        ) : (
          <MicOff className="size-3.5" aria-hidden />
        )}
        {t('voices.pickerLabel')}
      </label>

      <Select
        id={selectId}
        value={value ?? ''}
        disabled={disabled || !supported}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">{t('voices.none')}</option>
        {items.map((voice) => (
          <option key={voice.id} value={voice.id}>
            {voice.name}
          </option>
        ))}
      </Select>

      {!supported ? (
        <p className="text-xs text-text-subtle">{t('voices.modelHasNoAudio')}</p>
      ) : items.length === 0 ? (
        // Pointing at the tab rather than offering to create one here: a voice is written
        // once and reused, so its home is settings, not the middle of a generation form.
        <p className="text-xs text-text-subtle">{t('voices.emptyHint')}</p>
      ) : null}
    </div>
  );
}

export default VoicePicker;
