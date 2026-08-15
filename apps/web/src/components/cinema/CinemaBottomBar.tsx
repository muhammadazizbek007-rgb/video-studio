import type {
  CameraMotion,
  ElementDto,
  VeoModelSpec,
  VideoAspectRatio,
  VideoDuration,
  VideoStylePreset,
} from '@video-studio/shared';
import {
  CAMERA_MOTIONS,
  DEFAULT_IMAGE_MODEL_ID,
  getImageModel,
  IMAGE_MODEL_LIST,
  requireImageModel,
  STYLE_PRESETS,
  VIDEO_MODEL_LIST,
} from '@video-studio/shared';
import {
  Camera,
  Clapperboard,
  Clock,
  FileVideo,
  Image as ImageIcon,
  Minus,
  Palette,
  Plus,
  Ratio,
  Sparkles,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { MentionListbox } from '@/components/mentions/MentionListbox';
import { useMentionAutocomplete } from '@/components/mentions/useMentionAutocomplete';
import { Badge, Button, Input, Surface } from '@/components/ui';
import { useVoices } from '@/hooks/useVoices';
import { useLanguage } from '@/i18n/LanguageContext';
import { cn } from '@/lib/cn';
import { ChipDropdown } from './ChipDropdown';

export type CinemaInputMode = 'Image' | 'Video';

/** Only these four close one another; the model panel is independent, as the spec has it. */
type SettingChip = 'aspect' | 'duration' | 'style' | 'camera';

const MAX_SEGMENTS = 12;

export interface CinemaBottomBarProps {
  mode: CinemaInputMode;
  onModeChange: (mode: CinemaInputMode) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  /** The account's saved elements, so `@` offers the same list the studio does. */
  elements?: readonly ElementDto[];
  model: VeoModelSpec;
  modelId: string;
  onModelChange: (id: string) => void;
  /** Image mode picks from the Imagen/Gemini list instead, kept apart from the Veo one. */
  imageModelId: string;
  onImageModelChange: (id: string) => void;
  aspect: VideoAspectRatio;
  onAspectChange: (value: VideoAspectRatio) => void;
  duration: VideoDuration;
  onDurationChange: (value: VideoDuration) => void;
  stylePreset: VideoStylePreset;
  onStylePresetChange: (value: VideoStylePreset) => void;
  cameraMotion: CameraMotion;
  onCameraMotionChange: (value: CameraMotion) => void;
  samples: number;
  onSamplesChange: (value: number) => void;
  busy: boolean;
  onGenerate: () => void;
}

export function CinemaBottomBar({
  mode,
  onModeChange,
  prompt,
  onPromptChange,
  elements = [],
  model,
  modelId,
  onModelChange,
  imageModelId,
  onImageModelChange,
  aspect,
  onAspectChange,
  duration,
  onDurationChange,
  stylePreset,
  onStylePresetChange,
  cameraMotion,
  onCameraMotionChange,
  samples,
  onSamplesChange,
  busy,
  onGenerate,
}: CinemaBottomBarProps) {
  const { t } = useLanguage();
  const [modelOpen, setModelOpen] = useState(false);
  const [openChip, setOpenChip] = useState<SettingChip | null>(null);

  // Segments are generated from this field, so a character mentioned here has to attach the
  // same way it does in the studio — otherwise a storyboard is the one place where a saved
  // face silently turns back into plain text.
  const promptRef = useRef<HTMLInputElement | null>(null);
  const voices = useVoices();
  const mentions = useMentionAutocomplete<HTMLInputElement>({
    value: prompt,
    onChange: onPromptChange,
    elements,
    voices: voices.data ?? [],
    voicePrefix: t('voices.inlinePrefix'),
    fieldRef: promptRef,
  });

  const toggleChip = (chip: SettingChip) => (open: boolean) => setOpenChip(open ? chip : null);

  // Image mode is served by Imagen/Gemini, not Veo, and has no duration to pick — both the
  // model list and the chip row follow the mode.
  const isImage = mode === 'Image';
  const imageModel = getImageModel(imageModelId) ?? requireImageModel(DEFAULT_IMAGE_MODEL_ID);

  function selectMode(value: CinemaInputMode) {
    // A panel left open would be listing the other mode's options.
    setModelOpen(false);
    setOpenChip(null);
    onModeChange(value);
  }

  const modes: readonly { value: CinemaInputMode; label: string; Icon: typeof ImageIcon }[] = [
    { value: 'Image', label: t('cinema.modeImage'), Icon: ImageIcon },
    { value: 'Video', label: t('cinema.modeVideo'), Icon: FileVideo },
  ];

  return (
    <div className="absolute inset-x-0 bottom-0 px-4 pb-6 sm:px-8">
      <Surface
        elevation="raised-lg"
        radius="md"
        className="mx-auto flex max-w-3xl items-stretch gap-3 p-2"
      >
        <fieldset className="flex shrink-0 flex-col gap-1">
          <legend className="sr-only">{t('cinema.modeLabel')}</legend>
          {modes.map(({ value, label, Icon }) => {
            const active = mode === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => selectMode(value)}
                className={cn(
                  'flex h-10 w-14 flex-col items-center justify-center gap-0.5 rounded-sm bg-surface',
                  'text-[10px] font-semibold transition-[box-shadow,color] duration-[120ms]',
                  'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent',
                  active
                    ? 'text-accent shadow-neu-inset-sm'
                    : 'text-text-subtle shadow-neu-raised-sm hover:text-text-primary',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            );
          })}
        </fieldset>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="relative">
            <Input
              ref={promptRef}
              value={prompt}
              onChange={mentions.handleChange}
              placeholder={t('cinema.promptPlaceholder')}
              aria-label={t('studio.prompt')}
              aria-autocomplete="list"
              aria-expanded={mentions.open}
              aria-controls={mentions.open ? mentions.listboxId : undefined}
              aria-activedescendant={
                mentions.open ? `${mentions.listboxId}-${mentions.activeIndex}` : undefined
              }
              onBlur={() => window.setTimeout(mentions.close, 120)}
              onKeyDown={(event) => {
                // Enter picks the highlighted element while the popup is open; only once it
                // is closed does Enter mean "generate".
                if (mentions.handleKeyDown(event)) return;
                if (event.key === 'Enter' && !event.shiftKey && prompt.trim() && !busy) {
                  event.preventDefault();
                  onGenerate();
                }
              }}
            />

            {mentions.open ? (
              <MentionListbox
                id={mentions.listboxId}
                suggestions={mentions.suggestions}
                activeIndex={mentions.activeIndex}
                onSelect={mentions.insert}
                placement="bottom"
              />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isImage ? (
              <ChipDropdown
                caption={t('cinema.pickModel')}
                value={imageModel.id}
                onChange={onImageModelChange}
                open={modelOpen}
                onOpenChange={setModelOpen}
                panelWidth="w-64"
                scrollable
                options={IMAGE_MODEL_LIST.map((spec) => ({
                  value: spec.id,
                  label: spec.name,
                  secondary: spec.description,
                  badge: spec.supportsEditing ? (
                    <Badge tone="accent" size="sm" className="h-5 px-2 text-[9px] uppercase">
                      {t('model.editing')}
                    </Badge>
                  ) : undefined,
                }))}
              >
                <ImageIcon className="size-3.5" aria-hidden />
                <span className="max-w-32 truncate">{imageModel.name}</span>
              </ChipDropdown>
            ) : (
              <ChipDropdown
                caption={t('cinema.pickModel')}
                value={modelId}
                onChange={onModelChange}
                open={modelOpen}
                onOpenChange={setModelOpen}
                panelWidth="w-64"
                scrollable
                options={VIDEO_MODEL_LIST.map((spec) => ({
                  value: spec.id,
                  label: spec.name,
                  secondary: `${spec.maxResolution} · ${t('cinema.upTo')} ${Math.max(
                    ...spec.supportedDurations,
                  )}${t('cinema.secondsShort')}`,
                  badge: spec.supportsAudio ? (
                    <Badge tone="accent" size="sm" className="h-5 px-2 text-[9px] uppercase">
                      {t('model.audio')}
                    </Badge>
                  ) : undefined,
                }))}
              >
                <Clapperboard className="size-3.5" aria-hidden />
                <span className="max-w-32 truncate">{model.name}</span>
              </ChipDropdown>
            )}

            <ChipDropdown
              caption={t('cinema.pickAspect')}
              value={aspect}
              onChange={onAspectChange}
              open={openChip === 'aspect'}
              onOpenChange={toggleChip('aspect')}
              panelWidth="w-36"
              // Driven by the model, not a fixed list: Veo rejects a ratio it does not support.
              options={model.aspectRatios.map((ratio) => ({ value: ratio, label: ratio }))}
            >
              <Ratio className="size-3.5" aria-hidden />
              {aspect}
            </ChipDropdown>

            {/* Duration only exists for video — a still has no length to set. */}
            {isImage ? null : (
              <ChipDropdown
                caption={t('cinema.pickDuration')}
                value={duration}
                onChange={onDurationChange}
                open={openChip === 'duration'}
                onOpenChange={toggleChip('duration')}
                panelWidth="w-32"
                options={model.supportedDurations.map((value) => ({
                  value,
                  label: `${value}${t('cinema.secondsShort')}`,
                }))}
              >
                <Clock className="size-3.5" aria-hidden />
                {duration}
                {t('cinema.secondsShort')}
              </ChipDropdown>
            )}

            <ChipDropdown
              caption={t('cinema.pickStyle')}
              value={stylePreset}
              onChange={onStylePresetChange}
              open={openChip === 'style'}
              onOpenChange={toggleChip('style')}
              panelWidth="w-48"
              options={STYLE_PRESETS.map((value) => ({ value, label: value }))}
            >
              <Palette className="size-3.5" aria-hidden />
              <span className="max-w-24 truncate">{stylePreset}</span>
            </ChipDropdown>

            {/* Camera motion only exists for video — a still frame has no movement to direct. */}
            {isImage ? null : (
              <ChipDropdown
                caption={t('cinema.pickCamera')}
                value={cameraMotion}
                onChange={onCameraMotionChange}
                open={openChip === 'camera'}
                onOpenChange={toggleChip('camera')}
                panelWidth="w-44"
                options={CAMERA_MOTIONS.map((value) => ({ value, label: value }))}
              >
                <Camera className="size-3.5" aria-hidden />
                <span className="max-w-24 truncate">{cameraMotion}</span>
              </ChipDropdown>
            )}

            <div className="flex items-center gap-1 rounded-sm bg-surface px-1.5 py-1 shadow-neu-inset-sm">
              <button
                type="button"
                aria-label={t('cinema.segmentRemove')}
                disabled={samples <= 1}
                onClick={() => onSamplesChange(Math.max(1, samples - 1))}
                className="inline-flex size-5 items-center justify-center rounded-full text-text-muted hover:text-text-primary disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              >
                <Minus className="size-3" />
              </button>
              <span className="min-w-4 text-center text-xs font-semibold tabular-nums">
                {samples}
              </span>
              <button
                type="button"
                aria-label={t('cinema.segmentAdd')}
                disabled={samples >= MAX_SEGMENTS}
                onClick={() => onSamplesChange(Math.min(MAX_SEGMENTS, samples + 1))}
                className="inline-flex size-5 items-center justify-center rounded-full text-text-muted hover:text-text-primary disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              >
                <Plus className="size-3" />
              </button>
            </div>
          </div>
        </div>

        <Button
          variant="primary"
          size="md"
          loading={busy}
          disabled={prompt.trim().length === 0}
          onClick={onGenerate}
          data-testid="cinema-generate"
          className="min-w-[104px] shrink-0 self-stretch"
          icon={busy ? undefined : <Sparkles className="size-4" />}
        >
          {t('cinema.generate')}
        </Button>
      </Surface>
    </div>
  );
}

export default CinemaBottomBar;
