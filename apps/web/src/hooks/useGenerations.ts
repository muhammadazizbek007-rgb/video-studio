import {
  type InfiniteData,
  type QueryClient,
  type UseMutationResult,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CreateGenerationInput,
  GenerationDto,
  UpdateGenerationInput,
} from '@video-studio/shared';
import { useMemo } from 'react';
import { api, type GenerationPage } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export const OPTIMISTIC_ID_PREFIX = 'optimistic-';

type GenerationsData = InfiniteData<GenerationPage, string | undefined>;

export function isOptimisticGeneration(generation: GenerationDto): boolean {
  return generation.id.startsWith(OPTIMISTIC_ID_PREFIX);
}

let optimisticCounter = 0;

function buildOptimisticGeneration(input: CreateGenerationInput): GenerationDto {
  optimisticCounter += 1;
  const now = new Date().toISOString();
  return {
    id: `${OPTIMISTIC_ID_PREFIX}${now}-${optimisticCounter}`,
    userId: '',
    prompt: input.prompt,
    modelId: input.modelId,
    mode: input.mode,
    aspectRatio: input.aspectRatio,
    duration: input.duration,
    stylePreset: input.stylePreset,
    cameraMotion: input.cameraMotion,
    status: 'pending',
    saved: false,
    referenceImageUrls: input.referenceImageUrls ?? [],
    elements: input.elements ?? [],
    referenceCount: input.referenceImageUrls?.length ?? 0,
    createdAt: now,
    updatedAt: now,
  };
}

function prependGeneration(
  current: GenerationsData | undefined,
  item: GenerationDto,
): GenerationsData {
  const firstPage = current?.pages[0];
  if (!current || !firstPage) {
    return { pages: [{ items: [item], nextCursor: null }], pageParams: [undefined] };
  }
  const [, ...rest] = current.pages;
  return {
    ...current,
    pages: [{ ...firstPage, items: [item, ...firstPage.items] }, ...rest],
  };
}

function mapGenerations(
  current: GenerationsData | undefined,
  map: (item: GenerationDto) => GenerationDto | null,
): GenerationsData | undefined {
  if (!current) return current;
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      items: page.items.reduce<GenerationDto[]>((acc, item) => {
        const next = map(item);
        if (next) acc.push(next);
        return acc;
      }, []),
    })),
  };
}

/** Shared by the SSE stream hook so a pushed update lands in the list and the detail cache alike. */
export function writeGenerationToCache(client: QueryClient, generation: GenerationDto): void {
  client.setQueryData(qk.generation(generation.id), generation);
  client.setQueryData<GenerationsData>(qk.generations, (current) =>
    mapGenerations(current, (item) => (item.id === generation.id ? generation : item)),
  );
}

export interface UseGenerationsResult {
  generations: GenerationDto[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

export function useGenerations(limit = 24): UseGenerationsResult {
  const query = useInfiniteQuery({
    queryKey: qk.generations,
    queryFn: ({ pageParam }) => api.generations.list({ limit, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const generations = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  return {
    generations,
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    refetch: () => {
      void query.refetch();
    },
  };
}

export function useGeneration(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.generation(id ?? ''),
    queryFn: () => api.generations.get(id ?? ''),
    enabled: Boolean(id),
  });
}

export function useCreateGeneration(): UseMutationResult<
  GenerationDto,
  Error,
  CreateGenerationInput,
  { previous: GenerationsData | undefined; optimisticId: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateGenerationInput) => api.generations.create(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: qk.generations });
      const previous = queryClient.getQueryData<GenerationsData>(qk.generations);
      const optimistic = buildOptimisticGeneration(input);
      queryClient.setQueryData<GenerationsData>(qk.generations, (current) =>
        prependGeneration(current, optimistic),
      );
      return { previous, optimisticId: optimistic.id };
    },
    onError: (_error, _input, context) => {
      if (context) queryClient.setQueryData(qk.generations, context.previous);
    },
    onSuccess: (created, _input, context) => {
      queryClient.setQueryData<GenerationsData>(qk.generations, (current) =>
        mapGenerations(current, (item) => (item.id === context?.optimisticId ? created : item)),
      );
      queryClient.setQueryData(qk.generation(created.id), created);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.generations });
    },
  });
}

export function useUpdateGeneration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateGenerationInput }) =>
      api.generations.update(id, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.generation(updated.id), updated);
      queryClient.setQueryData<GenerationsData>(qk.generations, (current) =>
        mapGenerations(current, (item) => (item.id === updated.id ? updated : item)),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.generations });
    },
  });
}

export function useDeleteGeneration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.generations.remove(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: qk.generations });
      const previous = queryClient.getQueryData<GenerationsData>(qk.generations);
      queryClient.setQueryData<GenerationsData>(qk.generations, (current) =>
        mapGenerations(current, (item) => (item.id === id ? null : item)),
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context) queryClient.setQueryData(qk.generations, context.previous);
    },
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: qk.generation(id) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.generations });
    },
  });
}

export function useRefreshGeneration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.generations.refresh(id),
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.generation(updated.id), updated);
      queryClient.setQueryData<GenerationsData>(qk.generations, (current) =>
        mapGenerations(current, (item) => (item.id === updated.id ? updated : item)),
      );
    },
  });
}
