import type { StoryboardDto, VeoModelSpec } from '@video-studio/shared';
import { DEFAULT_VIDEO_MODEL_ID, getVeoModel, requireVeoModel } from '@video-studio/shared';
import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CinemaBottomBar, type CinemaInputMode } from '@/components/cinema/CinemaBottomBar';
import { CinemaPlayer } from '@/components/cinema/CinemaPlayer';
import { type SegmentState, SegmentStrip } from '@/components/cinema/SegmentStrip';
import { IconButton, Spinner, Surface } from '@/components/ui';
import { useStoryboard, useStoryboardCapabilities } from '@/hooks/useStoryboard';
import { useLanguage } from '@/i18n/LanguageContext';
import { ApiClientError, api } from '@/lib/api';
import { downloadBlob, stitchSegments } from '@/lib/stitchSegments';

const MODE_STORAGE_KEY = 'cinemaInputMode';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const BROWSER_EXPORT_FILENAME = 'cinema-studio.webm';
const SERVER_EXPORT_FILENAME = 'cinema-studio.mp4';
const PROMPT_SAVE_DELAY_MS = 700;

/** Layout offsets from the spec: the player clears the strip, the strip clears the bar. */
const PLAYER_BOTTOM = 310;
const STRIP_BOTTOM = 148;

function readStoredMode(): CinemaInputMode {
  if (typeof window === 'undefined') return 'Image';
  return window.sessionStorage.getItem(MODE_STORAGE_KEY) === 'Video' ? 'Video' : 'Image';
}

/** Segments are 1-based in the UI and 0-based on the wire. */
function segmentId(index: number): string {
  return String(index + 1);
}

function slotKey(index: number, slot: 1 | 2): string {
  return `${segmentId(index)}.${slot}`;
}

function parseSlotLabel(label: string): { index: number; slot: 1 | 2 } {
  const [id = '1', slot = '1'] = label.split('.');
  return { index: Number(id) - 1, slot: slot === '2' ? 2 : 1 };
}

function stateOf(segment: StoryboardDto['segments'][number]): SegmentState {
  if (segment.videoUrl) return 'done';
  if (segment.status === 'failed') return 'failed';
  if (segment.status === 'pending' || segment.status === 'processing') return 'generating';
  return 'empty';
}

function isPending(segment: StoryboardDto['segments'][number]): boolean {
  return segment.status === 'pending' || segment.status === 'processing';
}

function download(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function CinemaStudioPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const { storyboard, isLoading, isError, isGenerating, actions, reload } = useStoryboard();
  const { serverStitching } = useStoryboardCapabilities();

  const [mode, setMode] = useState<CinemaInputMode>(readStoredMode);
  const [prompt, setPrompt] = useState('');
  const [uploading, setUploading] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const activeSlotRef = useRef<{ index: number; slot: 1 | 2 } | null>(null);
  const activeSegmentRef = useRef<number | null>(null);
  /** Set while a server export we started is still running, so only we download the result. */
  const awaitingExportRef = useRef(false);

  useEffect(() => {
    window.sessionStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);

  // The stored prompt seeds the field once. After that the field is the source of truth,
  // so a save round-trip can never overwrite what is being typed.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !storyboard) return;
    seededRef.current = true;
    setPrompt(storyboard.prompt);
  }, [storyboard]);

  const updateSettings = actions.updateSettings;
  const savedPrompt = storyboard?.prompt;
  useEffect(() => {
    if (savedPrompt === undefined || prompt === savedPrompt) return;
    const timer = window.setTimeout(() => {
      void updateSettings({ prompt }).catch(() => undefined);
    }, PROMPT_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [prompt, savedPrompt, updateSettings]);

  const model: VeoModelSpec = storyboard
    ? (getVeoModel(storyboard.modelId) ?? requireVeoModel(DEFAULT_VIDEO_MODEL_ID))
    : requireVeoModel(DEFAULT_VIDEO_MODEL_ID);

  const segments = useMemo(() => storyboard?.segments ?? [], [storyboard]);

  const { slotImages, segmentVideos, segmentDurations, segmentStates, segmentIds } = useMemo(() => {
    const images: Record<string, string> = {};
    const videos: Record<string, string> = {};
    const durations: Record<string, number> = {};
    const states: Record<string, SegmentState> = {};
    const ids: string[] = [];

    for (const [index, segment] of segments.entries()) {
      const id = segmentId(index);
      ids.push(id);
      if (segment.firstFrameUrl) images[slotKey(index, 1)] = segment.firstFrameUrl;
      if (segment.lastFrameUrl) images[slotKey(index, 2)] = segment.lastFrameUrl;
      if (segment.videoUrl) videos[id] = segment.videoUrl;
      if (segment.durationSeconds) durations[id] = segment.durationSeconds;
      states[id] = stateOf(segment);
    }

    return {
      slotImages: images,
      segmentVideos: videos,
      segmentDurations: durations,
      segmentStates: states,
      segmentIds: ids,
    };
  }, [segments]);

  const completedSegs = useMemo(
    () => segmentIds.filter((id) => segmentVideos[id]),
    [segmentIds, segmentVideos],
  );

  const setSegmentDuration = actions.setSegmentDuration;
  const recordDuration = useCallback(
    (segment: string, measured: number) => {
      const index = Number(segment) - 1;
      const known = segments[index]?.durationSeconds;
      // Only worth a round-trip when the measured length disagrees with what the server
      // assumed from the requested duration.
      if (known !== undefined && Math.abs(known - measured) < 0.25) return;
      void setSegmentDuration(index, measured).catch(() => undefined);
    },
    [setSegmentDuration, segments],
  );

  async function uploadFile(label: string, file: File, accept: readonly string[]) {
    setError('');
    if (!accept.includes(file.type)) {
      setError(accept === IMAGE_TYPES ? t('upload.badType') : t('cinema.uploadBadVideo'));
      return null;
    }
    setUploading((current) => [...current, label]);
    try {
      // The storage key travels back with the URL: it is what lets the server delete this
      // file when the slot is replaced or cleared, instead of leaking it on disk.
      return await api.media.upload(file);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t('cinema.uploadFailed'));
      return null;
    } finally {
      setUploading((current) => current.filter((item) => item !== label));
    }
  }

  function handleGenerate() {
    if (mode !== 'Video') {
      navigate(`/studio?prompt=${encodeURIComponent(prompt.trim())}`);
      return;
    }
    if (!storyboard || prompt.trim() === '') return;

    // The first segment holding a frame, with nothing finished and nothing already running.
    const withFrame = segments.findIndex(
      (segment) =>
        (segment.firstFrameUrl || segment.lastFrameUrl) && !segment.videoUrl && !isPending(segment),
    );
    const free = segments.findIndex((segment) => !segment.videoUrl && !isPending(segment));
    const index = withFrame >= 0 ? withFrame : free >= 0 ? free : 0;

    setError('');
    setNotice('');
    void actions.generateSegment(index, { prompt: prompt.trim() }).catch((generationError) => {
      setError(
        generationError instanceof Error ? generationError.message : t('studio.generateFailed'),
      );
    });
  }

  async function stitchInBrowser() {
    const urls = completedSegs
      .map((id) => segmentVideos[id])
      .filter((url): url is string => Boolean(url));
    const result = await stitchSegments({ urls, onProgress: setSaveProgress });
    downloadBlob(result.blob, BROWSER_EXPORT_FILENAME);
    if (!result.hasAudio) setNotice(t('cinema.exportSilent'));
  }

  async function handleExport() {
    if (completedSegs.length === 0 || isSaving) return;
    setError('');
    setNotice('');
    setIsSaving(true);
    setSaveProgress(0);

    try {
      if (serverStitching) {
        await actions.startExport();
        // The board reports the outcome on its event stream; the effect below downloads
        // the file and clears the saving state when it lands.
        awaitingExportRef.current = true;
        return;
      }
      await stitchInBrowser();
    } catch (exportError) {
      // A deployment without ffmpeg says so explicitly, and the browser can still do it.
      if (exportError instanceof ApiClientError && exportError.code === 'unavailable') {
        try {
          await stitchInBrowser();
          return;
        } catch (fallbackError) {
          setError(
            fallbackError instanceof Error ? fallbackError.message : t('cinema.exportFailed'),
          );
          return;
        }
      }
      setError(exportError instanceof Error ? exportError.message : t('cinema.exportFailed'));
    } finally {
      if (!awaitingExportRef.current) {
        setIsSaving(false);
        setSaveProgress(0);
      }
    }
  }

  useEffect(() => {
    if (!awaitingExportRef.current || !storyboard) return;

    if (storyboard.exportStatus === 'completed' && storyboard.exportUrl) {
      awaitingExportRef.current = false;
      setIsSaving(false);
      download(storyboard.exportUrl, SERVER_EXPORT_FILENAME);
      return;
    }

    if (storyboard.exportStatus === 'failed') {
      awaitingExportRef.current = false;
      setIsSaving(false);
      setError(storyboard.exportError ?? t('cinema.exportFailed'));
    }
  }, [storyboard, t]);

  if (isLoading) {
    return (
      <section className="flex min-h-[620px] items-center justify-center rounded-lg bg-surface shadow-neu-raised lg:min-h-[720px]">
        <Spinner size="lg" />
      </section>
    );
  }

  if (isError || !storyboard) {
    return (
      <section className="flex min-h-[620px] flex-col items-center justify-center gap-3 rounded-lg bg-surface shadow-neu-raised lg:min-h-[720px]">
        <p className="text-sm text-danger">{t('cinema.loadFailed')}</p>
        <button
          type="button"
          onClick={reload}
          className="rounded-sm bg-surface px-4 py-2 text-sm font-semibold shadow-neu-raised-sm hover:shadow-neu-raised focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent"
        >
          {t('common.retry')}
        </button>
      </section>
    );
  }

  const banner = error || notice;
  const exporting = isSaving || storyboard.exportStatus === 'processing';

  return (
    <section className="relative min-h-[620px] overflow-hidden rounded-lg bg-surface shadow-neu-raised lg:min-h-[720px]">
      {mode === 'Video' ? (
        <>
          <div
            className="absolute inset-x-4 top-4"
            style={{ bottom: PLAYER_BOTTOM }}
            data-testid="cinema-player"
          >
            <CinemaPlayer
              completedSegs={completedSegs}
              segmentVideos={segmentVideos}
              segmentDurations={segmentDurations}
              onDurationMeasured={recordDuration}
              onExport={() => void handleExport()}
              isSaving={exporting}
              saveProgress={saveProgress}
            />
          </div>

          <div className="absolute inset-x-4" style={{ bottom: STRIP_BOTTOM }}>
            <SegmentStrip
              segments={segmentIds}
              slotImages={slotImages}
              segmentVideos={segmentVideos}
              segmentStates={segmentStates}
              uploading={uploading}
              onPickImage={(label) => {
                activeSlotRef.current = parseSlotLabel(label);
                imageInputRef.current?.click();
              }}
              onPickVideo={(id) => {
                activeSegmentRef.current = Number(id) - 1;
                videoInputRef.current?.click();
              }}
              onClearSegment={(id) => {
                void actions.clearSegmentGeneration(Number(id) - 1).catch(() => undefined);
              }}
              onClearSlot={(label) => {
                const { index, slot } = parseSlotLabel(label);
                const clear = slot === 2 ? actions.setLastFrame : actions.setFirstFrame;
                void clear(index, null).catch(() => undefined);
              }}
              onRetrySegment={(id) => {
                void actions.clearSegmentGeneration(Number(id) - 1).catch(() => undefined);
              }}
            />
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-8 px-6 pb-52 pt-16 text-center lg:pt-24">
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <span className="absolute left-1/2 top-1/3 size-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/[0.06] blur-[120px]" />
          </div>

          <div className="relative h-48 w-72 sm:h-52 sm:w-80">
            <Surface
              elevation="raised-sm"
              radius="md"
              className="absolute inset-0 -rotate-6 scale-90 opacity-60"
            />
            <Surface
              elevation="raised"
              radius="md"
              className="absolute inset-0 rotate-3 scale-95 opacity-75"
            />
            <Surface elevation="raised-lg" radius="md" className="absolute inset-0" />
          </div>

          <h1 className="relative max-w-2xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            {t('cinema.heroLead')} <span className="text-accent">{t('cinema.heroAccent')}</span>
          </h1>
          <p className="relative max-w-md text-sm text-text-muted">{t('cinema.heroHandoff')}</p>
        </div>
      )}

      {banner ? (
        <Surface
          role={error ? 'alert' : 'status'}
          elevation="raised"
          radius="md"
          className="absolute inset-x-4 z-50 flex items-center gap-2 px-4 py-2.5"
          style={{ bottom: STRIP_BOTTOM }}
        >
          <p className={`min-w-0 flex-1 text-sm ${error ? 'text-danger' : 'text-text-muted'}`}>
            {banner}
          </p>
          <IconButton
            size="sm"
            label={t('common.close')}
            icon={<X />}
            onClick={() => {
              setError('');
              setNotice('');
            }}
          />
        </Surface>
      ) : null}

      <CinemaBottomBar
        mode={mode}
        onModeChange={setMode}
        prompt={prompt}
        onPromptChange={setPrompt}
        model={model}
        modelId={storyboard.modelId}
        onModelChange={(modelId) => void updateSettings({ modelId }).catch(() => undefined)}
        aspect={storyboard.aspectRatio}
        onAspectChange={(aspectRatio) =>
          void updateSettings({ aspectRatio }).catch(() => undefined)
        }
        duration={storyboard.duration}
        onDurationChange={(duration) => void updateSettings({ duration }).catch(() => undefined)}
        stylePreset={storyboard.stylePreset}
        onStylePresetChange={(stylePreset) =>
          void updateSettings({ stylePreset }).catch(() => undefined)
        }
        cameraMotion={storyboard.cameraMotion}
        onCameraMotionChange={(cameraMotion) =>
          void updateSettings({ cameraMotion }).catch(() => undefined)
        }
        samples={segments.length}
        onSamplesChange={(segmentCount) =>
          void updateSettings({ segmentCount }).catch(() => undefined)
        }
        busy={isGenerating}
        onGenerate={handleGenerate}
      />

      <input
        ref={imageInputRef}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        className="sr-only"
        aria-label={t('upload.firstFrame')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          const target = activeSlotRef.current;
          if (!file || !target) return;
          void uploadFile(slotKey(target.index, target.slot), file, IMAGE_TYPES).then(
            (uploaded) => {
              if (!uploaded) return;
              const apply = target.slot === 2 ? actions.setLastFrame : actions.setFirstFrame;
              void apply(target.index, uploaded).catch(() => undefined);
            },
          );
        }}
      />

      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4"
        className="sr-only"
        aria-label={t('cinema.modeVideo')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          const index = activeSegmentRef.current;
          if (!file || index === null) return;
          void uploadFile(segmentId(index), file, ['video/mp4']).then((uploaded) => {
            if (!uploaded) return;
            void actions.setSegmentVideo(index, uploaded).catch(() => undefined);
          });
        }}
      />
    </section>
  );
}

export default CinemaStudioPage;
