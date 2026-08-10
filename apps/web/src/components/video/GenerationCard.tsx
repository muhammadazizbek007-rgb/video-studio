import type { GenerationDto } from '@video-studio/shared';
import { getVeoModel } from '@video-studio/shared';
import { CircleQuestionMark, Film, Heart, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, IconButton, Modal } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import { GenerationFailureDialog } from './GenerationFailureDialog';
import { StatusPill } from './StatusPill';

interface GenerationCardProps {
  generation: GenerationDto;
  selected?: boolean;
  onOpen?: (generation: GenerationDto) => void;
  onToggleSave?: (generation: GenerationDto) => void;
  onDelete?: (generation: GenerationDto) => void;
  /** Runs the same prompt and settings again. Offered only on a generation that failed. */
  onRegenerate?: (generation: GenerationDto) => void;
  isDeleting?: boolean;
  isRegenerating?: boolean;
}

export function GenerationCard({
  generation,
  selected = false,
  onOpen,
  onToggleSave,
  onDelete,
  onRegenerate,
  isDeleting = false,
  isRegenerating = false,
}: GenerationCardProps) {
  const { language, t } = useLanguage();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [failureOpen, setFailureOpen] = useState(false);

  const poster = generation.referenceImageUrls[0];
  const modelName = getVeoModel(generation.modelId)?.name ?? generation.modelId;
  const createdAt = new Date(generation.createdAt);
  const createdLabel = Number.isNaN(createdAt.getTime())
    ? ''
    : new Intl.DateTimeFormat(language, { day: '2-digit', month: 'short' }).format(createdAt);

  return (
    <Card className={`flex flex-col gap-3 p-3 ${selected ? 'ring-2 ring-current/40' : ''}`}>
      <button
        type="button"
        onClick={() => onOpen?.(generation)}
        aria-current={selected ? 'true' : undefined}
        className="relative block aspect-video w-full overflow-hidden rounded-xl bg-current/10"
      >
        {generation.resultVideoUrl ? (
          <video
            src={generation.resultVideoUrl}
            poster={poster}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        ) : poster ? (
          <img src={poster} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <Film className="h-6 w-6 opacity-40" />
          </span>
        )}
        <span className="absolute left-2 top-2">
          <StatusPill status={generation.status} />
        </span>
      </button>

      <p className="line-clamp-2 text-sm leading-5">{generation.prompt}</p>

      {generation.status === 'failed' && generation.errorMessage ? (
        <p className="line-clamp-2 text-xs opacity-70">{generation.errorMessage}</p>
      ) : null}

      <div className="flex items-center gap-2 text-xs opacity-70">
        <span className="truncate">{modelName}</span>
        <span aria-hidden="true">·</span>
        <span>{generation.duration}s</span>
        {createdLabel ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{createdLabel}</span>
          </>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          {/* The clipped message above names the failure in the language of a log, so the
              card offers to explain it rather than leaving that as the last word. */}
          {generation.status === 'failed' ? (
            <IconButton
              type="button"
              label={t('generation.why')}
              icon={<CircleQuestionMark />}
              onClick={() => setFailureOpen(true)}
            />
          ) : null}
          {/* A clip that failed is worth another run more often than not — the reference
              image was briefly unreachable, the model was busy — and rebuilding the prompt
              and its settings by hand to find that out is the whole cost. */}
          {generation.status === 'failed' && onRegenerate ? (
            <IconButton
              type="button"
              label={t('generation.regenerate')}
              icon={<RotateCcw />}
              loading={isRegenerating}
              onClick={() => onRegenerate(generation)}
            />
          ) : null}
          <IconButton
            type="button"
            label={generation.saved ? t('generation.unsave') : t('generation.save')}
            aria-pressed={generation.saved}
            icon={<Heart className={generation.saved ? 'fill-current' : undefined} />}
            onClick={() => onToggleSave?.(generation)}
          />
          <IconButton
            type="button"
            label={t('generation.delete')}
            icon={<Trash2 />}
            onClick={() => setConfirmOpen(true)}
          />
        </span>
      </div>

      <GenerationFailureDialog
        open={failureOpen}
        onClose={() => setFailureOpen(false)}
        errorMessage={generation.errorMessage}
      />

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('generation.deleteTitle')}
      >
        <p className="text-sm">{t('generation.deleteConfirm')}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={isDeleting}
            onClick={() => {
              setConfirmOpen(false);
              onDelete?.(generation);
            }}
          >
            {t('common.delete')}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

export default GenerationCard;
