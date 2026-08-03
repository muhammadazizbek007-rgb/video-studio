import type {
  CameraMotion,
  VeoModelSpec,
  VideoAspectRatio,
  VideoDuration,
  VideoGenerationMode,
  VideoStylePreset,
} from '@video-studio/shared';
import { CAMERA_MOTIONS, resolveDuration, STYLE_PRESETS } from '@video-studio/shared';
import { useId } from 'react';
import { SegmentedControl, Select } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';

const MODES: readonly VideoGenerationMode[] = [
  'text_to_video',
  'image_to_video',
  'reference_to_video',
];

// Whole keys rather than suffixes: a `stylePreset.${string}` template cannot be proven
// to be a real TranslationKey, so a typo would only surface as a missing string at runtime.
export const STYLE_PRESET_KEYS: Record<VideoStylePreset, TranslationKey> = {
  Cinematic: 'stylePreset.cinematic',
  UGC: 'stylePreset.ugc',
  'App Promo': 'stylePreset.appPromo',
  'Product Demo': 'stylePreset.productDemo',
  'Character Story': 'stylePreset.characterStory',
  'Social Ad': 'stylePreset.socialAd',
};

export const CAMERA_MOTION_KEYS: Record<CameraMotion, TranslationKey> = {
  Static: 'cameraMotion.static',
  'Zoom in': 'cameraMotion.zoomIn',
  'Dolly in': 'cameraMotion.dollyIn',
  Handheld: 'cameraMotion.handheld',
  Orbit: 'cameraMotion.orbit',
  Pan: 'cameraMotion.pan',
};

function toMode(value: string): VideoGenerationMode | undefined {
  return MODES.find((mode) => mode === value);
}

function toStylePreset(value: string): VideoStylePreset | undefined {
  return STYLE_PRESETS.find((preset) => preset === value);
}

function toCameraMotion(value: string): CameraMotion | undefined {
  return CAMERA_MOTIONS.find((motion) => motion === value);
}

interface GenerationSettingsProps {
  model: VeoModelSpec;
  mode: VideoGenerationMode;
  onModeChange: (mode: VideoGenerationMode) => void;
  aspectRatio: VideoAspectRatio;
  onAspectRatioChange: (aspectRatio: VideoAspectRatio) => void;
  duration: VideoDuration;
  onDurationChange: (duration: VideoDuration) => void;
  stylePreset: VideoStylePreset;
  onStylePresetChange: (stylePreset: VideoStylePreset) => void;
  cameraMotion: CameraMotion;
  onCameraMotionChange: (cameraMotion: CameraMotion) => void;
  referenceCount: number;
  disabled?: boolean;
}

export function GenerationSettings({
  model,
  mode,
  onModeChange,
  aspectRatio,
  onAspectRatioChange,
  duration,
  onDurationChange,
  stylePreset,
  onStylePresetChange,
  cameraMotion,
  onCameraMotionChange,
  referenceCount,
  disabled = false,
}: GenerationSettingsProps) {
  const { t } = useLanguage();
  const stylePresetId = useId();
  const cameraMotionId = useId();

  const modeOptions = MODES.map((option) => ({
    value: option,
    // The long "Text → video" form overflows this column; MODE above supplies the context.
    label: t(`mode.short.${option}`),
    disabled:
      option === 'text_to_video'
        ? false
        : !model.supportsImageToVideo ||
          (option === 'image_to_video' ? referenceCount < 1 : referenceCount < 2),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider opacity-60">
          {t('studio.mode')}
        </span>
        <SegmentedControl
          fullWidth
          aria-label={t('studio.mode')}
          value={mode}
          disabled={disabled}
          options={modeOptions}
          onChange={(value: string) => {
            const next = toMode(value);
            if (next) onModeChange(next);
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider opacity-60">
          {t('studio.aspectRatio')}
        </span>
        <SegmentedControl
          fullWidth
          aria-label={t('studio.aspectRatio')}
          value={aspectRatio}
          disabled={disabled}
          options={model.aspectRatios.map((ratio) => ({ value: ratio, label: ratio }))}
          onChange={(value: string) => {
            const next = model.aspectRatios.find((ratio) => ratio === value);
            if (next) onAspectRatioChange(next);
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider opacity-60">
          {t('studio.duration')}
        </span>
        <SegmentedControl
          fullWidth
          aria-label={t('studio.duration')}
          value={String(duration)}
          disabled={disabled}
          options={model.supportedDurations.map((value) => ({
            value: String(value),
            label: `${value}s`,
          }))}
          onChange={(value: string) => onDurationChange(resolveDuration(model, Number(value)))}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={stylePresetId}
            className="text-xs font-semibold uppercase tracking-wider opacity-60"
          >
            {t('studio.stylePreset')}
          </label>
          <Select
            id={stylePresetId}
            value={stylePreset}
            disabled={disabled}
            onChange={(event) => {
              const next = toStylePreset(event.target.value);
              if (next) onStylePresetChange(next);
            }}
          >
            {STYLE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {t(STYLE_PRESET_KEYS[preset])}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={cameraMotionId}
            className="text-xs font-semibold uppercase tracking-wider opacity-60"
          >
            {t('studio.cameraMotion')}
          </label>
          <Select
            id={cameraMotionId}
            value={cameraMotion}
            disabled={disabled}
            onChange={(event) => {
              const next = toCameraMotion(event.target.value);
              if (next) onCameraMotionChange(next);
            }}
          >
            {CAMERA_MOTIONS.map((motion) => (
              <option key={motion} value={motion}>
                {t(CAMERA_MOTION_KEYS[motion])}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
}

export default GenerationSettings;
