import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateVoiceInput, UpdateVoiceInput, VoiceDto } from '@video-studio/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

/**
 * The account's saved narrators.
 *
 * Read in two places that must never disagree — the settings tab that manages them and the
 * picker in the studio — so both come off the same cache rather than each fetching its own.
 */
export function useVoices() {
  return useQuery({
    queryKey: qk.voices,
    queryFn: () => api.voices.list(),
    select: (page): VoiceDto[] => page.items,
  });
}

export function useCreateVoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVoiceInput) => api.voices.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.voices });
    },
  });
}

export function useUpdateVoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateVoiceInput }) =>
      api.voices.update(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.voices });
    },
  });
}

export function useDeleteVoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.voices.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.voices });
    },
  });
}
