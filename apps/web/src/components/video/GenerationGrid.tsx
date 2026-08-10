import type { GenerationDto } from '@video-studio/shared';
import type { ReactNode } from 'react';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import { GenerationCard } from './GenerationCard';

interface GenerationGridProps {
  generations: readonly GenerationDto[];
  isLoading?: boolean;
  isError?: boolean;
  /** Retries loading the list. Running one failed generation again is `onRegenerate`. */
  onRetry?: () => void;
  selectedId?: string | null;
  deletingId?: string | null;
  regeneratingId?: string | null;
  onOpen?: (generation: GenerationDto) => void;
  onToggleSave?: (generation: GenerationDto) => void;
  onDelete?: (generation: GenerationDto) => void;
  onRegenerate?: (generation: GenerationDto) => void;
  emptyAction?: ReactNode;
  skeletonCount?: number;
}

export function GenerationGrid({
  generations,
  isLoading = false,
  isError = false,
  onRetry,
  selectedId = null,
  deletingId = null,
  regeneratingId = null,
  onOpen,
  onToggleSave,
  onDelete,
  onRegenerate,
  emptyAction,
  skeletonCount = 6,
}: GenerationGridProps) {
  const { t } = useLanguage();

  if (isError) {
    return (
      <Card className="flex flex-col items-start gap-3 p-5">
        <p className="text-sm font-semibold">{t('generations.errorTitle')}</p>
        <p className="text-sm opacity-70">{t('generations.errorBody')}</p>
        {onRetry ? (
          <Button type="button" variant="secondary" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        ) : null}
      </Card>
    );
  }

  if (isLoading) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: an <output> cannot host a CSS grid of cards; this is a transient loading region, not a form result
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        role="status"
        aria-busy="true"
        aria-label={t('generations.loading')}
      >
        {Array.from({ length: skeletonCount }, (_, index) => index).map((index) => (
          <Card key={index} className="flex flex-col gap-3 p-3">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-2/3 rounded" />
          </Card>
        ))}
      </div>
    );
  }

  if (generations.length === 0) {
    return (
      <EmptyState
        title={t('generations.emptyTitle')}
        description={t('generations.emptyBody')}
        action={emptyAction}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {generations.map((generation) => (
        <GenerationCard
          key={generation.id}
          generation={generation}
          selected={generation.id === selectedId}
          isDeleting={generation.id === deletingId}
          isRegenerating={generation.id === regeneratingId}
          onOpen={onOpen}
          onToggleSave={onToggleSave}
          onDelete={onDelete}
          onRegenerate={onRegenerate}
        />
      ))}
    </div>
  );
}

export default GenerationGrid;
