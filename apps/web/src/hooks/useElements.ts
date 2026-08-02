import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateElementInput, ElementDto, UpdateElementInput } from '@video-studio/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export function useElements() {
  return useQuery({
    queryKey: qk.elements,
    queryFn: () => api.elements.list(),
  });
}

export function useCreateElement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateElementInput) => api.elements.create(input),
    onSuccess: (created) => {
      queryClient.setQueryData<ElementDto[]>(qk.elements, (current) =>
        current ? [created, ...current] : [created],
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.elements });
    },
  });
}

export function useUpdateElement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateElementInput }) =>
      api.elements.update(id, input),
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: qk.elements });
      const previous = queryClient.getQueryData<ElementDto[]>(qk.elements);
      queryClient.setQueryData<ElementDto[]>(qk.elements, (current) =>
        current?.map((item) => (item.id === id ? { ...item, ...input } : item)),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(qk.elements, context.previous);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<ElementDto[]>(qk.elements, (current) =>
        current?.map((item) => (item.id === updated.id ? updated : item)),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.elements });
    },
  });
}

export function useDeleteElement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.elements.remove(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: qk.elements });
      const previous = queryClient.getQueryData<ElementDto[]>(qk.elements);
      queryClient.setQueryData<ElementDto[]>(qk.elements, (current) =>
        current?.filter((item) => item.id !== id),
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context) queryClient.setQueryData(qk.elements, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.elements });
    },
  });
}
