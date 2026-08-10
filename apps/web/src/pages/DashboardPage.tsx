import type { GenerationDto } from '@video-studio/shared';
import { retryGenerationInput } from '@video-studio/shared';
import { Plus } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Skeleton } from '@/components/ui';
import { GenerationGrid } from '@/components/video/GenerationGrid';
import {
  useCreateGeneration,
  useDeleteGeneration,
  useGenerations,
  useUpdateGeneration,
} from '@/hooks/useGenerations';
import { useLanguage } from '@/i18n/LanguageContext';

interface StatTileProps {
  label: string;
  value: number;
  isLoading: boolean;
}

function StatTile({ label, value, isLoading }: StatTileProps) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-xs font-semibold uppercase tracking-wider opacity-60">{label}</span>
      {isLoading ? (
        <Skeleton className="h-8 w-12 rounded" />
      ) : (
        <span className="text-3xl font-semibold tabular-nums">{value}</span>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const recentHeadingId = useId();
  const { generations, isLoading, isError, hasMore, isLoadingMore, loadMore, refetch } =
    useGenerations();
  const updateGeneration = useUpdateGeneration();
  const deleteGeneration = useDeleteGeneration();
  const createGeneration = useCreateGeneration();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  /**
   * Runs a failed clip again and follows it into the studio, the same place opening a card
   * leads — it is the only screen with the live status stream, so a retry started here would
   * otherwise sit on a card that does not visibly move.
   */
  async function regenerate(generation: GenerationDto) {
    setError('');
    setRegeneratingId(generation.id);
    try {
      const created = await createGeneration.mutateAsync(retryGenerationInput(generation));
      navigate(`/studio?generation=${created.id}`);
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

  const stats = useMemo(() => {
    let completed = 0;
    let processing = 0;
    let failed = 0;
    for (const generation of generations) {
      if (generation.status === 'completed') completed += 1;
      else if (generation.status === 'failed') failed += 1;
      else processing += 1;
    }
    return { total: generations.length, completed, processing, failed };
  }, [generations]);

  const goToStudio = () => navigate('/studio');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('dashboard.title')}</h1>
          <p className="text-sm opacity-70">{t('dashboard.subtitle')}</p>
        </div>
        <Button type="button" size="lg" onClick={goToStudio}>
          <Plus className="h-4 w-4" />
          {t('dashboard.newVideo')}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('dashboard.total')} value={stats.total} isLoading={isLoading} />
        <StatTile label={t('dashboard.completed')} value={stats.completed} isLoading={isLoading} />
        <StatTile
          label={t('dashboard.processing')}
          value={stats.processing}
          isLoading={isLoading}
        />
        <StatTile label={t('dashboard.failed')} value={stats.failed} isLoading={isLoading} />
      </div>

      <section className="flex flex-col gap-3" aria-labelledby={recentHeadingId}>
        <h2 id={recentHeadingId} className="text-lg font-semibold">
          {t('dashboard.recent')}
        </h2>

        {error ? (
          <p role="alert" className="text-sm opacity-80">
            {error}
          </p>
        ) : null}
        <GenerationGrid
          generations={generations}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
          deletingId={deletingId}
          regeneratingId={regeneratingId}
          onOpen={(generation) => navigate(`/studio?generation=${generation.id}`)}
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
              .catch(() => undefined)
              .finally(() => setDeletingId(null));
          }}
          emptyAction={
            <Button type="button" onClick={goToStudio}>
              {t('dashboard.newVideo')}
            </Button>
          }
        />
        {hasMore ? (
          <div className="flex justify-center">
            <Button type="button" variant="secondary" onClick={loadMore} disabled={isLoadingMore}>
              {isLoadingMore ? t('dashboard.loadingMore') : t('dashboard.loadMore')}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default DashboardPage;
