import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateProjectPromptInput,
  ProjectPromptDto,
  UpdateProjectPromptInput,
} from '@video-studio/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

/**
 * The account's saved blocks of project context.
 *
 * Read by the settings section that manages them and by the `@` popup in every prompt field,
 * so both come off one cache rather than each fetching its own and disagreeing.
 */
export function useProjectPrompts() {
  return useQuery({
    queryKey: qk.projectPrompts,
    queryFn: () => api.projectPrompts.list(),
    select: (page): ProjectPromptDto[] => page.items,
  });
}

export function useCreateProjectPrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectPromptInput) => api.projectPrompts.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.projectPrompts });
    },
  });
}

export function useUpdateProjectPrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProjectPromptInput }) =>
      api.projectPrompts.update(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.projectPrompts });
    },
  });
}

export function useDeleteProjectPrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.projectPrompts.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.projectPrompts });
    },
  });
}
