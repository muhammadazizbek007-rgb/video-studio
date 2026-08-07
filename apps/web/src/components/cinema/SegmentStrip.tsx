import { Images, Plus, Trash2, TriangleAlert } from 'lucide-react';
import type { MouseEvent } from 'react';
import { Spinner, Surface } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import { cn } from '@/lib/cn';

export type SegmentState = 'done' | 'generating' | 'failed' | 'empty';

/** `X.1` is the first frame of segment X, `X.2` its last frame. */
export function slotLabel(segment: string, slot: 1 | 2): string {
  return `${segment}.${slot}`;
}

export interface SegmentStripProps {
  segments: readonly string[];
  slotImages: Readonly<Record<string, string>>;
  segmentVideos: Readonly<Record<string, string>>;
  segmentStates: Readonly<Record<string, SegmentState>>;
  /** Opens the media picker for this slot; Ctrl/Cmd+click asks for a clip instead. */
  onPickImage: (label: string) => void;
  onPickVideo: (segment: string) => void;
  onClearSegment: (segment: string) => void;
  onClearSlot: (label: string) => void;
  onRetrySegment: (segment: string) => void;
}

interface TrashProps {
  label: string;
  onClick: () => void;
}

function TrashButton({ label, onClick }: TrashProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        // Without this the click reaches the slot behind and opens the file picker.
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'absolute right-1.5 top-1.5 z-10 inline-flex size-7 items-center justify-center rounded-full',
        'bg-surface text-text-muted opacity-0 shadow-neu-raised-sm transition-opacity',
        'group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      )}
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}

export function SegmentStrip({
  segments,
  slotImages,
  segmentVideos,
  segmentStates,
  onPickImage,
  onPickVideo,
  onClearSegment,
  onClearSlot,
  onRetrySegment,
}: SegmentStripProps) {
  const { t } = useLanguage();

  return (
    <Surface
      elevation="inset"
      radius="md"
      className="flex gap-3 overflow-x-auto p-3"
      aria-label={t('cinema.segments')}
    >
      {segments.map((segment) => {
        const state = segmentStates[segment] ?? 'empty';
        const videoUrl = segmentVideos[segment];

        return (
          <div
            key={segment}
            className="group relative flex flex-1 shrink-0 basis-0 flex-col"
            style={{ minWidth: 120, minHeight: 120 }}
          >
            {state === 'done' && videoUrl ? (
              <Surface
                elevation="raised-sm"
                radius="md"
                className="relative h-full overflow-hidden"
              >
                <TrashButton
                  label={t('cinema.clearSegment')}
                  onClick={() => onClearSegment(segment)}
                />
                <video
                  src={videoUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="absolute inset-0 size-full object-cover"
                />
                <span className="absolute bottom-1.5 left-2 text-[10px] font-semibold text-text-primary mix-blend-difference">
                  {segment}
                </span>
              </Surface>
            ) : state === 'generating' ? (
              <Surface
                elevation="raised-sm"
                radius="md"
                className="flex h-full flex-col items-center justify-center gap-2"
              >
                <TrashButton
                  label={t('cinema.clearSegment')}
                  onClick={() => onClearSegment(segment)}
                />
                <Spinner size="md" />
                <span className="text-[10px] font-semibold text-text-subtle">
                  {t('cinema.generating')}
                </span>
              </Surface>
            ) : state === 'failed' ? (
              <Surface
                elevation="raised-sm"
                radius="md"
                className="flex h-full flex-col items-center justify-center gap-1.5"
              >
                <TrashButton
                  label={t('cinema.clearSegment')}
                  onClick={() => onClearSegment(segment)}
                />
                <TriangleAlert className="size-5 text-danger" aria-hidden />
                <span className="text-[10px] font-semibold text-danger">
                  {t('cinema.segmentFailed')}
                </span>
                <button
                  type="button"
                  onClick={() => onRetrySegment(segment)}
                  className={cn(
                    'rounded-full bg-surface px-2.5 py-1 text-[10px] font-semibold text-text-muted',
                    'shadow-neu-raised-sm hover:text-text-primary',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  )}
                >
                  {t('cinema.segmentRetry')}
                </button>
              </Surface>
            ) : (
              <div className="flex h-full flex-1 gap-1.5">
                {([1, 2] as const).map((slot) => {
                  const label = slotLabel(segment, slot);
                  const image = slotImages[label];

                  return (
                    <div key={label} className="group/slot relative flex-1">
                      {image ? (
                        <TrashButton
                          label={t('cinema.clearSlot')}
                          onClick={() => onClearSlot(label)}
                        />
                      ) : null}
                      <button
                        type="button"
                        title={t('cinema.slotHint')}
                        aria-label={`${label} — ${
                          slot === 1 ? t('cinema.slotFirstFrame') : t('cinema.slotLastFrame')
                        }`}
                        onClick={(event) => {
                          // Ctrl/Cmd swaps the picker to video: a ready-made clip can stand
                          // in for a generated segment.
                          if (event.ctrlKey || event.metaKey) {
                            onPickVideo(segment);
                            return;
                          }
                          // Opens the media picker, which is where the file dialog now
                          // lives — one tile among the account's existing media.
                          onPickImage(label);
                        }}
                        className={cn(
                          'relative size-full overflow-hidden rounded-md bg-surface',
                          'shadow-neu-raised-sm transition-[box-shadow,transform] duration-[120ms]',
                          'hover:shadow-neu-raised active:scale-[0.985] active:shadow-neu-inset-sm',
                          'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent',
                        )}
                      >
                        {image ? (
                          <>
                            <img
                              src={image}
                              alt=""
                              className="absolute inset-0 size-full object-cover"
                            />
                            <span className="absolute inset-0 bg-backdrop/40" />
                            <span className="absolute left-2 top-1.5 text-[10px] font-semibold text-white">
                              {label}
                            </span>
                            <span className="absolute inset-x-1.5 bottom-1.5 rounded-full bg-surface/90 py-0.5 text-[10px] font-semibold text-text-primary">
                              {t('cinema.slotChange')}
                            </span>
                          </>
                        ) : (
                          <span className="flex size-full flex-col items-center justify-center gap-1">
                            <span className="text-[10px] font-semibold text-text-subtle">
                              {label}
                            </span>
                            <Images className="size-6 text-text-subtle" aria-hidden />
                            <Plus className="size-3 text-text-subtle" aria-hidden />
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </Surface>
  );
}

export default SegmentStrip;
