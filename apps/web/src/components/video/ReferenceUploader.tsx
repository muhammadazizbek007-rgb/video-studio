import { ImagePlus, X } from 'lucide-react';
import type { DragEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function stopProgress() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function upload(file: File) {
    setError('');
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(t('upload.badType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('upload.tooLarge'));
      return;
    }

    // fetch gives no upload-progress events, so the bar advances on a timer and
    // only the final jump to 100% reflects the server actually answering.
    setProgress(5);
    stopProgress();
    timerRef.current = setInterval(() => {
      setProgress((current) => (current === null ? current : Math.min(current + 7, 90)));
    }, 180);

    try {
      const uploaded = await api.media.upload(file);
      setProgress(100);
      onChange(uploaded.url);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t('upload.failed'));
    } finally {
      stopProgress();
      window.setTimeout(() => setProgress(null), 400);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = event.dataTransfer.files.item(0);
    if (file) void upload(file);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider opacity-60">{label}</span>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target has no ARIA role, and the
          keyboard path is the button and file input inside it — not this wrapper */}
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
              <span className="absolute right-2 top-2">
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
              onClick={() => inputRef.current?.click()}
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

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        className="sr-only"
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
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
