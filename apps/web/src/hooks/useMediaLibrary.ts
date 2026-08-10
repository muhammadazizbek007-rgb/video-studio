import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateImageGenerationInput,
  ImageGenerationDto,
  MediaKind,
  UpdateImageGenerationInput,
  UpdateUploadInput,
  UploadDto,
} from '@video-studio/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

/**
 * The two libraries the media picker owns: files the account uploaded, and stills it
 * generated. Elements and videos already have hooks of their own, so this file adds only
 * what was missing rather than wrapping everything in a fourth abstraction.
 */

export function useUploads(kind?: MediaKind) {
  return useQuery({
    queryKey: [...qk.uploads, kind ?? 'all'],
    queryFn: () => api.media.list(kind ? { kind } : {}),
    select: (page) => page.items,
  });
}

export function useImageGenerations() {
  return useQuery({
    queryKey: qk.images,
    queryFn: () => api.images.list(),
    select: (page) => page.items,
  });
}

/**
 * Generating goes through the cache, not around it.
 *
 * The studio used to hold its stills in local state, so a picture made there never reached
 * the picker's Images tab until the page was reloaded — two lists of the same thing, only
 * one of them current. Both now read `qk.images`.
 */
export function useCreateImageGeneration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateImageGenerationInput) => api.images.create(input),
    onSuccess: (created) => {
      queryClient.setQueryData<{ items: ImageGenerationDto[] }>(qk.images, (current) =>
        current ? { ...current, items: [created, ...current.items] } : { items: [created] },
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.images });
    },
  });
}

/** Both mutations write through every cached variant, since the picker filters by kind. */
export function useUpdateUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUploadInput }) =>
      api.media.update(id, input),
    onSuccess: (updated) => {
      queryClient.setQueriesData<{ items: UploadDto[] }>({ queryKey: qk.uploads }, (current) =>
        current
          ? { ...current, items: current.items.map((i) => (i.id === updated.id ? updated : i)) }
          : current,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.uploads });
    },
  });
}

export function useDeleteUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.media.remove(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: qk.uploads });
      queryClient.setQueriesData<{ items: UploadDto[] }>({ queryKey: qk.uploads }, (current) =>
        current ? { ...current, items: current.items.filter((i) => i.id !== id) } : current,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.uploads });
    },
  });
}

export function useUpdateImageGeneration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateImageGenerationInput }) =>
      api.images.update(id, input),
    onSuccess: (updated) => {
      queryClient.setQueryData<{ items: ImageGenerationDto[] }>(qk.images, (current) =>
        current
          ? { ...current, items: current.items.map((i) => (i.id === updated.id ? updated : i)) }
          : current,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.images });
    },
  });
}

export function useDeleteImageGeneration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.images.remove(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: qk.images });
      queryClient.setQueryData<{ items: ImageGenerationDto[] }>(qk.images, (current) =>
        current ? { ...current, items: current.items.filter((i) => i.id !== id) } : current,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.images });
    },
  });
}
