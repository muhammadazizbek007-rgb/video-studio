import { ImagePlus, X } from 'lucide-react';
import type { DragEvent } from 'react';
import { useState } from 'react';
import { MediaPicker } from '@/components/media/MediaPicker';
import { IconButton, ProgressBar, Surface } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import { api } from '@/lib/api';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;

interface UploadSlotProps {
  label: string;
  hint: string;
  value: string | null;
  onChange: (url: string | null) => void;
  disabled: boolean;
}

function UploadSlot({ label, hint, value, onChange, disabled }: UploadSlotProps) {
  const { t } = useLanguage();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  /**
   * Dropping a file still uploads it directly — the picker is for choosing, and someone
   * who dragged a file onto the slot has already chosen.
   */
  async function uploadDropped(file: File) {
    setError('');
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(t('upload.badType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('upload.tooLarge'));
      return;
    }

    setProgress(50);
    try {
      const uploaded = await api.media.upload(file);
      setProgress(100);
      onChange(uploaded.url);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t('upload.failed'));
    } finally {
      window.setTimeout(() => setProgress(null), 400);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = event.dataTransfer.files.item(0);
    if (file) void uploadDropped(file);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider opacity-60">{label}</span>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target has no ARIA role, and the
          keyboard path is the button inside it — not this wrapper */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <Surface
          className={`relative overflow-hidden p-0 ${dragging ? 'ring-2 ring-current/40' : ''}`}
        >
          {value ? (
            <div className="relative">
              <img src={value} alt={label} className="aspect-video w-full object-cover" />
              <span className="absolute right-2 top-2 flex gap-1">
                <IconButton
                  type="button"
                  label={t('media.change')}
                  disabled={disabled}
                  icon={<ImagePlus />}
                  onClick={() => setPickerOpen(true)}
                />
                <IconButton
                  type="button"
                  label={t('upload.remove')}
                  disabled={disabled}
                  icon={<X />}
                  onClick={() => onChange(null)}
                />
              </span>
            </div>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setPickerOpen(true)}
              className="flex aspect-video w-full flex-col items-center justify-center gap-2 p-4 text-center disabled:opacity-50"
            >
              <ImagePlus className="h-6 w-6 opacity-50" />
              <span className="text-sm font-medium">{t('upload.cta')}</span>
              <span className="text-xs opacity-60">{hint}</span>
            </button>
          )}

          {progress !== null ? (
            <div className="absolute inset-x-0 bottom-0 p-2">
              <ProgressBar value={progress} aria-label={t('upload.progress')} />
            </div>
          ) : null}
        </Surface>
      </div>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        accept="image"
        selectedUrl={value}
        title={label}
        onSelect={(asset) => {
          onChange(asset.url);
          setPickerOpen(false);
        }}
      />

      {error ? (
        <p role="alert" className="text-xs opacity-80">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface ReferenceUploaderProps {
  supportsLastFrame: boolean;
  firstFrameUrl: string | null;
  lastFrameUrl: string | null;
  onFirstFrameChange: (url: string | null) => void;
  onLastFrameChange: (url: string | null) => void;
  disabled?: boolean;
}

export function ReferenceUploader({
  supportsLastFrame,
  firstFrameUrl,
  lastFrameUrl,
  onFirstFrameChange,
  onLastFrameChange,
  disabled = false,
}: ReferenceUploaderProps) {
  const { t } = useLanguage();

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <UploadSlot
        label={t('upload.firstFrame')}
        hint={t('upload.hint')}
        value={firstFrameUrl}
        onChange={onFirstFrameChange}
        disabled={disabled}
      />
      {supportsLastFrame ? (
        <UploadSlot
          label={t('upload.lastFrame')}
          hint={t('upload.hint')}
          value={lastFrameUrl}
          onChange={onLastFrameChange}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}

export default ReferenceUploader;
