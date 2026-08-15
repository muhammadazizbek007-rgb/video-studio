import type { ImageAspectRatio, StoryboardDto, VeoModelSpec } from '@video-studio/shared';
import {
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  getImageModel,
  getVeoModel,
  requireVeoModel,
} from '@video-studio/shared';
import { X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CinemaBottomBar, type CinemaInputMode } from '@/components/cinema/CinemaBottomBar';
import { CinemaPlayer } from '@/components/cinema/CinemaPlayer';
import { ImageResults } from '@/components/cinema/ImageResults';
import { type SegmentState, SegmentStrip } from '@/components/cinema/SegmentStrip';
import { MediaPicker } from '@/components/media/MediaPicker';
import { IconButton, Spinner, Surface } from '@/components/ui';
import { ExtendClipDialog } from '@/components/video/ExtendClipDialog';
import type { VideoTool } from '@/components/video/VideoToolsMenu';
import { VideoToolsMenu } from '@/components/video/VideoToolsMenu';
import { useElements } from '@/hooks/useElements';
import { useExtendGeneration } from '@/hooks/useGenerations';
import {
  useCreateImageGeneration,
  useDeleteImageGeneration,
  useImageGenerations,
} from '@/hooks/useMediaLibrary';
import { useStoryboard, useStoryboardCapabilities } from '@/hooks/useStoryboard';
import { useLanguage } from '@/i18n/LanguageContext';
import { ApiClientError } from '@/lib/api';
import { downloadBlob, stitchSegments } from '@/lib/stitchSegments';

const MODE_STORAGE_KEY = 'cinemaInputMode';

/** Designed, not yet built. Listed in the menu so the gap is visible rather than silent. */
const UNBUILT_TOOLS: readonly VideoTool[] = ['removeObject', 'insertObject', 'outpaint', 'upscale'];
/** The board stores only the Veo model, so the image pick lives next to the mode. */
const IMAGE_MODEL_STORAGE_KEY = 'cinemaImageModel';
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

function readStoredImageModel(): string {
  if (typeof window === 'undefined') return DEFAULT_IMAGE_MODEL_ID;
  const stored = window.sessionStorage.getItem(IMAGE_MODEL_STORAGE_KEY);
  return stored && getImageModel(stored) ? stored : DEFAULT_IMAGE_MODEL_ID;
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

  const { storyboard, isLoading, isError, isGenerating, actions, reload } = useStoryboard();
  const { serverStitching } = useStoryboardCapabilities();
  const extendGeneration = useExtendGeneration();

  // The same query the media picker reads, so a still generated here is on its Images tab
  // immediately instead of after a reload.
  const imageLibrary = useImageGenerations();
  const createImage = useCreateImageGeneration();
  const deleteImage = useDeleteImageGeneration();
  const images = useMemo(() => imageLibrary.data ?? [], [imageLibrary.data]);
  const isImaging = createImage.isPending;

  // Feeds the `@` popup in the prompt bar; the server resolves the mentions again when the
  // segment is generated, so this list only decides what can be picked, never what attaches.
  const { data: elements } = useElements();

  const [mode, setMode] = useState<CinemaInputMode>(readStoredMode);
  const [imageModelId, setImageModelId] = useState<string>(readStoredImageModel);
  const [prompt, setPrompt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [extendSegment, setExtendSegment] = useState<string | null>(null);
  const [extendError, setExtendError] = useState('');
  /** Which slot (or which segment) the media picker is currently filling. */
  const [picking, setPicking] = useState<
    { kind: 'frame'; index: number; slot: 1 | 2 } | { kind: 'video'; index: number } | null
  >(null);

  /** Set while a server export we started is still running, so only we download the result. */
  const awaitingExportRef = useRef(false);

  useEffect(() => {
    window.sessionStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    window.sessionStorage.setItem(IMAGE_MODEL_STORAGE_KEY, imageModelId);
  }, [imageModelId]);

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

  const {
    slotImages,
    segmentVideos,
    segmentDurations,
    segmentStates,
    segmentGenerationIds,
    segmentIds,
  } = useMemo(() => {
    const images: Record<string, string> = {};
    const videos: Record<string, string> = {};
    const durations: Record<string, number> = {};
    const states: Record<string, SegmentState> = {};
    const generations: Record<string, string> = {};
    const ids: string[] = [];

    for (const [index, segment] of segments.entries()) {
      const id = segmentId(index);
      ids.push(id);
      if (segment.firstFrameUrl) images[slotKey(index, 1)] = segment.firstFrameUrl;
      if (segment.lastFrameUrl) images[slotKey(index, 2)] = segment.lastFrameUrl;
      if (segment.videoUrl) videos[id] = segment.videoUrl;
      if (segment.durationSeconds) durations[id] = segment.durationSeconds;
      if (segment.generationId) generations[id] = segment.generationId;
      states[id] = stateOf(segment);
    }

    return {
      slotImages: images,
      segmentVideos: videos,
      segmentDurations: durations,
      segmentStates: states,
      segmentGenerationIds: generations,
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

  /**
   * Image mode generates here rather than handing the prompt to the video studio: the
   * style preset is a real parameter of the request, and a redirect would drop it.
   */
  async function generateImage() {
    if (!storyboard || prompt.trim() === '' || isImaging) return;

    setError('');
    setNotice('');
    try {
      await createImage.mutateAsync({
        prompt: prompt.trim(),
        modelId: imageModelId,
        aspectRatio: storyboard.aspectRatio as ImageAspectRatio,
        stylePreset: storyboard.stylePreset,
      });
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : t('cinema.imageFailed'));
    }
  }

  /**
   * Only the URL travels into the slot, never the storage key.
   *
   * The key is what authorises a delete, and every source in the picker — an upload, a
   * still, an element — is a library item in its own right. Clearing a slot must not erase
   * the picture out from under the library that still lists it.
   */
  function handlePicked(url: string) {
    const target = picking;
    setPicking(null);
    if (!target || !url) return;

    if (target.kind === 'video') {
      void actions.setSegmentVideo(target.index, { url }).catch(() => {
        setError(t('cinema.libraryPickFailed'));
      });
      return;
    }

    const apply = target.slot === 2 ? actions.setLastFrame : actions.setFirstFrame;
    void apply(target.index, { url }).catch(() => {
      setError(t('cinema.libraryPickFailed'));
    });
  }

  function handleDeleteImage(id: string) {
    // The mutation removes it from the cache first and refetches when it settles, so a
    // failed delete puts the picture back on its own.
    deleteImage.mutate(id, { onError: () => setError(t('cinema.imageDeleteFailed')) });
  }

  function handleGenerate() {
    if (mode !== 'Video') {
      void generateImage();
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

  // What the picker should show as already chosen, and what it is filling.
  const pickerSelection =
    picking === null
      ? null
      : picking.kind === 'video'
        ? (segmentVideos[segmentId(picking.index)] ?? null)
        : (slotImages[slotKey(picking.index, picking.slot)] ?? null);

  /**
   * What the last-frame tab is allowed to offer this slot.
   *
   * An opening frame continues the shot before it and nothing else, so the tab is narrowed
   * to that one clip: slot 2.1 gets what clip 1 ended on, 3.1 gets clip 2. The first slot
   * on the board has nothing in front of it and is narrowed to nothing at all.
   *
   * A closing-frame slot is not chaining forward, and neither is the studio, so both are
   * left unrestricted — hence `undefined` rather than `null`, which would empty the tab.
   */
  const restrictLastFramesTo: string | null | undefined =
    picking === null || picking.kind !== 'frame' || picking.slot !== 1
      ? undefined
      : picking.index === 0
        ? null
        : (segmentGenerationIds[segmentId(picking.index - 1)] ?? null);

  const pickerTitle =
    picking === null
      ? undefined
      : picking.kind === 'video'
        ? `${segmentId(picking.index)} — ${t('cinema.modeVideo')}`
        : `${slotKey(picking.index, picking.slot)} — ${
            picking.slot === 2 ? t('cinema.slotLastFrame') : t('cinema.slotFirstFrame')
          }`;

  /**
   * Continues one segment of the board.
   *
   * The result is a standalone clip, not a new segment: the board is a fixed set of shots
   * and appending to it is a different feature. Rather than let a working continuation seem
   * to vanish, the dialog says up front where it will land.
   */
  async function runSegmentExtension(segment: string, continuation: string) {
    const generationId = segmentGenerationIds[segment];
    if (!generationId) return;

    setExtendError('');
    try {
      await extendGeneration.mutateAsync({
        id: generationId,
        input: continuation ? { prompt: continuation } : {},
      });
      setExtendSegment(null);
      setNotice(t('tools.extendLandedInStudio'));
    } catch (failure) {
      setExtendError(failure instanceof Error ? failure.message : t('tools.extendFailed'));
    }
  }

  return (
    <section className="relative min-h-[620px] overflow-hidden rounded-lg bg-surface shadow-neu-raised lg:min-h-[720px]">
      <ExtendClipDialog
        open={extendSegment !== null}
        sourcePrompt={savedPrompt}
        note={t('tools.extendLandsInStudio')}
        pending={extendGeneration.isPending}
        error={extendError}
        onClose={() => setExtendSegment(null)}
        onConfirm={(continuation) => {
          if (extendSegment) void runSegmentExtension(extendSegment, continuation);
        }}
      />

      {mode === 'Video' ? (
        <>
          <div
            className="absolute inset-x-4 top-4"
            style={{ bottom: PLAYER_BOTTOM }}
            data-testid="cinema-player"
          >
            <CinemaPlayer
              renderTools={(segment) => (
                <VideoToolsMenu
                  open={toolsOpen}
                  onOpenChange={setToolsOpen}
                  busyTool={extendGeneration.isPending ? 'extend' : null}
                  // Every other control in this row stays put and greys out on an empty
                  // board; a button that disappears instead reads as a missing feature.
                  disabled={!segment}
                  // A segment with no generation behind it — an imported clip — has
                  // nothing for Veo to continue from.
                  unavailable={
                    segment && segmentGenerationIds[segment]
                      ? UNBUILT_TOOLS
                      : [...UNBUILT_TOOLS, 'extend']
                  }
                  onPick={(tool) => {
                    if (tool === 'extend' && segment) {
                      setExtendError('');
                      setExtendSegment(segment);
                    }
                  }}
                />
              )}
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
              onPickImage={(label) => {
                const { index, slot } = parseSlotLabel(label);
                setError('');
                setPicking({ kind: 'frame', index, slot });
              }}
              onPickVideo={(id) => {
                setError('');
                setPicking({ kind: 'video', index: Number(id) - 1 });
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
      ) : images.length > 0 || isImaging ? (
        // Once there is something to show, the gallery replaces the hero rather than
        // pushing it down: the stills are what the tab is about from then on.
        <div className="absolute inset-x-4 top-4 overflow-y-auto" style={{ bottom: STRIP_BOTTOM }}>
          <ImageResults images={images} generating={isImaging} onDelete={handleDeleteImage} />
        </div>
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
          <p className="relative max-w-md text-sm text-text-muted">{t('cinema.imageHint')}</p>
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
        elements={elements ?? []}
        model={model}
        modelId={storyboard.modelId}
        onModelChange={(modelId) => void updateSettings({ modelId }).catch(() => undefined)}
        imageModelId={imageModelId}
        onImageModelChange={setImageModelId}
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
        busy={mode === 'Video' ? isGenerating : isImaging}
        onGenerate={handleGenerate}
      />

      <MediaPicker
        open={picking !== null}
        onClose={() => setPicking(null)}
        accept={picking?.kind === 'video' ? 'video' : 'image'}
        selectedUrl={pickerSelection}
        restrictLastFramesTo={restrictLastFramesTo}
        title={pickerTitle}
        onSelect={(asset) => handlePicked(asset.url)}
      />
    </section>
  );
}

export default CinemaStudioPage;
