import type {
  CameraMotion,
  CreateGenerationInput,
  GenerationDto,
  VideoAspectRatio,
  VideoDuration,
  VideoGenerationMode,
  VideoStylePreset,
} from '@video-studio/shared';
import {
  DEFAULT_VIDEO_MODEL_ID,
  getVeoModel,
  requireVeoModel,
  resolveDuration,
  retryGenerationInput,
} from '@video-studio/shared';
import { Wand2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Surface } from '@/components/ui';
import { AttachedElements } from '@/components/video/AttachedElements';
import { ExtendClipDialog } from '@/components/video/ExtendClipDialog';
import { GenerationGrid } from '@/components/video/GenerationGrid';
import { GenerationSettings } from '@/components/video/GenerationSettings';
import { ModelPicker } from '@/components/video/ModelPicker';
import { PromptComposer } from '@/components/video/PromptComposer';
import { ReferenceUploader } from '@/components/video/ReferenceUploader';
import { StatusPill } from '@/components/video/StatusPill';
import { VideoPlayer } from '@/components/video/VideoPlayer';
import type { VideoTool } from '@/components/video/VideoToolsMenu';
import { VideoToolsMenu } from '@/components/video/VideoToolsMenu';
import { useElements } from '@/hooks/useElements';
import { useGenerationStream } from '@/hooks/useGenerationStream';
import {
  useCreateGeneration,
  useDeleteGeneration,
  useExtendGeneration,
  useGenerations,
  useUpdateGeneration,
} from '@/hooks/useGenerations';
import { useLanguage } from '@/i18n/LanguageContext';
import { assetReferenceCapacity, previewReferences } from '@/lib/references';

const PROMPT_MAX_LENGTH = 8000;

/** Named so the menu stays honest: these are designed, not yet built. */
const UNBUILT_TOOLS: readonly VideoTool[] = ['removeObject', 'insertObject', 'outpaint', 'upscale'];

export function StudioPage() {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();

  const [modelId, setModelId] = useState<string>(DEFAULT_VIDEO_MODEL_ID);
  const model = getVeoModel(modelId) ?? requireVeoModel(DEFAULT_VIDEO_MODEL_ID);

  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>('16:9');
  const [duration, setDuration] = useState<VideoDuration>(model.defaultDuration);
  const [stylePreset, setStylePreset] = useState<VideoStylePreset>('Cinematic');
  const [cameraMotion, setCameraMotion] = useState<CameraMotion>('Dolly in');
  const [mode, setMode] = useState<VideoGenerationMode>('text_to_video');
  const [firstFrameUrl, setFirstFrameUrl] = useState<string | null>(null);
  const [lastFrameUrl, setLastFrameUrl] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendError, setExtendError] = useState('');

  const { data: elements } = useElements();
  const resultsHeadingId = useId();
  const { generations: listData, isLoading, isError, refetch } = useGenerations();
  const createGeneration = useCreateGeneration();
  const updateGeneration = useUpdateGeneration();
  const deleteGeneration = useDeleteGeneration();
  const extendGeneration = useExtendGeneration();
  const stream = useGenerationStream(activeId);

  // Every selection the previous model allowed has to be re-checked against the
  // new one, otherwise the API would reject the request as invalid.
  const previousModelId = useRef(modelId);
  useEffect(() => {
    if (previousModelId.current === modelId) return;
    previousModelId.current = modelId;
    setDuration((current) => resolveDuration(model, current));
    setAspectRatio((current) =>
      model.aspectRatios.includes(current) ? current : (model.aspectRatios[0] ?? '16:9'),
    );
    if (!model.supportsLastFrame) setLastFrameUrl(null);
    if (!model.supportsImageToVideo) setFirstFrameUrl(null);
  }, [model, modelId]);

  // A preview of what the server will do with this prompt: the same resolver runs there, so
  // what the panel shows is what Veo gets.
  const references = useMemo(
    () =>
      previewReferences({
        prompt,
        elements: elements ?? [],
        model,
        firstFrameImageUrl: firstFrameUrl,
      }),
    [prompt, elements, model, firstFrameUrl],
  );

  // The attached references decide what the request actually is; the picker only
  // matters while nothing is attached.
  useEffect(() => {
    setMode(references.mode);
  }, [references.mode]);

  const generations: GenerationDto[] = useMemo(() => {
    const items = listData;
    const live = stream.generation;
    if (!live) return items;
    return items.some((item) => item.id === live.id)
      ? items.map((item) => (item.id === live.id ? live : item))
      : [live, ...items];
  }, [listData, stream.generation]);

  useEffect(() => {
    const fromUrl = searchParams.get('generation');
    if (fromUrl) setSelectedId(fromUrl);
  }, [searchParams]);

  // Cinema Studio's Image mode hands its prompt over in the URL, so it is present on the
  // very first render here rather than arriving after a timer.
  const handedOverPrompt = searchParams.get('prompt');
  useEffect(() => {
    if (handedOverPrompt) setPrompt(handedOverPrompt);
  }, [handedOverPrompt]);

  const selected = generations.find((generation) => generation.id === selectedId) ?? null;
  const active = generations.find((generation) => generation.id === activeId) ?? null;
  const busy = createGeneration.isPending;

  async function generate() {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setError('');

    // Only what the user chose travels: the mentions stay in the prompt and the server
    // resolves them against the library, so the browser cannot attach an element the
    // account does not own — or forget one it does.
    const payload: CreateGenerationInput = {
      prompt: trimmed,
      modelId,
      mode,
      aspectRatio,
      duration,
      stylePreset,
      cameraMotion,
      firstFrameImageUrl: model.supportsImageToVideo && firstFrameUrl ? firstFrameUrl : undefined,
      lastFrameImageUrl: model.supportsLastFrame && lastFrameUrl ? lastFrameUrl : undefined,
    };

    try {
      const created = await createGeneration.mutateAsync(payload);
      setActiveId(created.id);
      setSelectedId(created.id);
    } catch (generationError) {
      setError(
        generationError instanceof Error ? generationError.message : t('studio.generateFailed'),
      );
    }
  }

  /**
   * Continues the clip on screen, then follows the continuation.
   *
   * Selecting the new clip is the point: it is what the user asked to see, and leaving the
   * player on the source would make a working continuation look like nothing happened.
   */
  async function extend(source: GenerationDto, prompt: string) {
    setExtendError('');
    try {
      const created = await extendGeneration.mutateAsync({
        id: source.id,
        input: prompt ? { prompt } : {},
      });
      setExtendOpen(false);
      setActiveId(created.id);
      setSelectedId(created.id);
    } catch (extendFailure) {
      setExtendError(
        extendFailure instanceof Error ? extendFailure.message : t('tools.extendFailed'),
      );
    }
  }

  /**
   * A failed clip, run again from what the record kept.
   *
   * The new run is a new generation rather than a revival of the old one: the failure stays
   * in the list with its message, which is the only way to see that the second attempt was
   * not the first. The form is left alone — someone retrying from the results column has not
   * asked for their current draft to be overwritten.
   */
  async function regenerate(generation: GenerationDto) {
    setError('');
    setRegeneratingId(generation.id);
    try {
      const created = await createGeneration.mutateAsync(retryGenerationInput(generation));
      setActiveId(created.id);
      setSelectedId(created.id);
    } catch (regenerateError) {
      setError(
        regenerateError instanceof Error
          ? regenerateError.message
          : t('generation.regenerateFailed'),
      );
    } finally {
      setRegeneratingId(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-5 p-4">
          <PromptComposer
            value={prompt}
            onChange={setPrompt}
            elements={elements ?? []}
            maxLength={PROMPT_MAX_LENGTH}
            disabled={busy}
            enrichContext={{
              stylePreset,
              cameraMotion,
              mode,
              elements: references.refs,
            }}
          />

          <AttachedElements resolved={references} capacity={assetReferenceCapacity(model)} />

          <ModelPicker value={modelId} onChange={setModelId} disabled={busy} />

          <GenerationSettings
            model={model}
            mode={mode}
            onModeChange={setMode}
            aspectRatio={aspectRatio}
            onAspectRatioChange={setAspectRatio}
            duration={duration}
            onDurationChange={setDuration}
            stylePreset={stylePreset}
            onStylePresetChange={setStylePreset}
            cameraMotion={cameraMotion}
            onCameraMotionChange={setCameraMotion}
            referenceCount={
              references.assetImageUrls.length + (references.firstFrameImageUrl ? 1 : 0)
            }
            disabled={busy}
          />

          <ReferenceUploader
            supportsLastFrame={model.supportsLastFrame}
            firstFrameUrl={firstFrameUrl}
            lastFrameUrl={lastFrameUrl}
            onFirstFrameChange={setFirstFrameUrl}
            onLastFrameChange={setLastFrameUrl}
            disabled={busy || !model.supportsImageToVideo}
          />

          <p data-testid="studio-summary" className="text-xs opacity-70">
            {model.name} · {aspectRatio} · {duration}s · {t(`mode.${mode}`)}
          </p>

          {error ? (
            <p role="alert" className="text-sm opacity-80">
              {error}
            </p>
          ) : null}

          <Button
            type="button"
            size="lg"
            loading={busy}
            disabled={prompt.trim().length === 0}
            onClick={() => void generate()}
          >
            <Wand2 className="h-4 w-4" />
            {t('studio.generate')}
          </Button>
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        {active && active.status !== 'completed' ? (
          <Surface className="flex items-center gap-3 p-4">
            <StatusPill status={active.status} />
            <p className="min-w-0 flex-1 truncate text-sm opacity-80">{active.prompt}</p>
          </Surface>
        ) : null}

        {selected?.resultVideoUrl ? (
          <div className="flex flex-col gap-2">
            <VideoPlayer
              src={selected.resultVideoUrl}
              poster={selected.referenceImageUrls[0]}
              downloadName={`${selected.id}.mp4`}
              tools={
                <VideoToolsMenu
                  open={toolsOpen}
                  onOpenChange={setToolsOpen}
                  busyTool={extendGeneration.isPending ? 'extend' : null}
                  // Everything but continuation is still server-side work; showing them
                  // dimmed says what is coming without pretending it is here.
                  unavailable={
                    getVeoModel(selected.modelId)?.supportsExtension
                      ? UNBUILT_TOOLS
                      : [...UNBUILT_TOOLS, 'extend']
                  }
                  onPick={(tool) => {
                    if (tool === 'extend') {
                      setExtendError('');
                      setExtendOpen(true);
                    }
                  }}
                />
              }
            />
            <p className="text-sm opacity-80">{selected.prompt}</p>
          </div>
        ) : null}

        {selected ? (
          <ExtendClipDialog
            open={extendOpen}
            sourcePrompt={selected.prompt}
            pending={extendGeneration.isPending}
            error={extendError}
            onClose={() => setExtendOpen(false)}
            onConfirm={(prompt) => void extend(selected, prompt)}
          />
        ) : null}

        <section className="flex flex-col gap-3" aria-labelledby={resultsHeadingId}>
          <h2 id={resultsHeadingId} className="text-lg font-semibold">
            {t('studio.results')}
          </h2>
          <GenerationGrid
            generations={generations}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => void refetch()}
            selectedId={selectedId}
            deletingId={deletingId}
            regeneratingId={regeneratingId}
            onOpen={(generation) => setSelectedId(generation.id)}
            onRegenerate={(generation) => void regenerate(generation)}
            onToggleSave={(generation) => {
              void updateGeneration.mutateAsync({
                id: generation.id,
                input: { saved: !generation.saved },
              });
            }}
            onDelete={(generation) => {
              setDeletingId(generation.id);
              void deleteGeneration
                .mutateAsync(generation.id)
                .then(() => {
                  if (selectedId === generation.id) setSelectedId(null);
                })
                .catch(() => undefined)
                .finally(() => setDeletingId(null));
            }}
          />
        </section>
      </div>
    </div>
  );
}

export default StudioPage;
