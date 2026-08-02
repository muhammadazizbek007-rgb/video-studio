import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GenerationDto, VideoGenerationStatus } from '@video-studio/shared';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { writeGenerationToCache } from './useGenerations';

const POLL_INTERVAL_MS = 5_000;

function isTerminal(status: VideoGenerationStatus | undefined): boolean {
  return status === 'completed' || status === 'failed';
}

export interface UseGenerationStreamResult {
  generation: GenerationDto | undefined;
  isLoading: boolean;
  isDone: boolean;
  /** True once the EventSource failed and the hook switched to interval polling. */
  isPolling: boolean;
}

export function useGenerationStream(id: string | null | undefined): UseGenerationStreamResult {
  const queryClient = useQueryClient();
  const [streamFailed, setStreamFailed] = useState(false);

  const query = useQuery({
    queryKey: qk.generation(id ?? ''),
    queryFn: () => api.generations.get(id ?? ''),
    enabled: Boolean(id),
  });

  const generation = query.data;
  const done = isTerminal(generation?.status);
  const shouldPoll = Boolean(id) && streamFailed && !done;

  useEffect(() => {
    if (!id) return;
    setStreamFailed(false);
  }, [id]);

  useEffect(() => {
    if (!id || done || streamFailed) return;
    return api.generations.stream(
      id,
      (update) => writeGenerationToCache(queryClient, update),
      () => setStreamFailed(true),
    );
  }, [id, done, streamFailed, queryClient]);

  // The SSE route is what drives Vertex polling server-side, so the fallback has to hit the
  // explicit refresh endpoint — a plain re-read would just return the same stale row forever.
  useEffect(() => {
    if (!shouldPoll || !id) return;
    const timer = window.setInterval(() => {
      api.generations
        .refresh(id)
        .then((update) => writeGenerationToCache(queryClient, update))
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [shouldPoll, id, queryClient]);

  return {
    generation,
    isLoading: query.isPending && Boolean(id),
    isDone: done,
    isPolling: shouldPoll,
  };
}
