import { VIDEO_MODEL_LIST } from '@video-studio/shared';
import { Badge, Surface } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';

interface ModelPickerProps {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

export function ModelPicker({ value, onChange, disabled = false }: ModelPickerProps) {
  const { t } = useLanguage();

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wider opacity-60">
        {t('studio.model')}
      </legend>
      <div role="radiogroup" aria-label={t('studio.model')} className="flex flex-col gap-2">
        {VIDEO_MODEL_LIST.map((model) => {
          const checked = model.id === value;
          return (
            // biome-ignore lint/a11y/useSemanticElements: a radio input cannot contain the card's rich content; this is the ARIA radiogroup pattern, keyboard behaviour included
            <button
              key={model.id}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              onClick={() => onChange(model.id)}
              className="text-left disabled:opacity-50"
            >
              <Surface className={`p-3 ${checked ? 'ring-2 ring-current/40' : ''}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{model.name}</span>
                  <Badge tone={checked ? 'accent' : 'neutral'}>{model.maxResolution}</Badge>
                </span>
                <span className="mt-1 block text-xs opacity-70">{model.description}</span>
                <span className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone={model.supportsAudio ? 'success' : 'neutral'}>
                    {model.supportsAudio ? t('model.audio') : t('model.noAudio')}
                  </Badge>
                  {model.supportsLastFrame ? (
                    <Badge tone="success">{t('model.lastFrame')}</Badge>
                  ) : null}
                  {model.supportsImageToVideo ? (
                    <Badge tone="neutral">{t('model.imageToVideo')}</Badge>
                  ) : null}
                  <Badge tone="neutral">{model.supportedDurations.join(' / ')}s</Badge>
                </span>
              </Surface>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default ModelPicker;
