import { NotebookPen } from 'lucide-react';
import { PromptLibrary, type PromptLibraryCopy } from '@/components/library/PromptLibrary';
import {
  useCreateProjectPrompt,
  useDeleteProjectPrompt,
  useProjectPrompts,
  useUpdateProjectPrompt,
} from '@/hooks/useProjectPrompts';

const COPY: PromptLibraryCopy = {
  title: 'projectPrompts.title',
  subtitle: 'projectPrompts.subtitle',
  add: 'projectPrompts.add',
  empty: 'projectPrompts.empty',
  newTitle: 'projectPrompts.newTitle',
  editTitle: 'projectPrompts.editTitle',
  formHint: 'projectPrompts.formHint',
  nameLabel: 'projectPrompts.name',
  namePlaceholder: 'projectPrompts.namePlaceholder',
  promptLabel: 'projectPrompts.prompt',
  promptPlaceholder: 'projectPrompts.promptPlaceholder',
  promptHint: 'projectPrompts.promptHint',
  bothRequired: 'projectPrompts.bothRequired',
  saveFailed: 'projectPrompts.saveFailed',
};

/**
 * The facts every clip in a campaign shares.
 *
 * What the product is, how the packaging looks, the tone, what must never appear. Retyping
 * them into each prompt is how they drift apart; written once and mentioned by name, the
 * hundredth clip is told exactly what the first was.
 */
export function ProjectPromptManager() {
  const prompts = useProjectPrompts();
  const createPrompt = useCreateProjectPrompt();
  const updatePrompt = useUpdateProjectPrompt();
  const deletePrompt = useDeleteProjectPrompt();

  return (
    <PromptLibrary
      copy={COPY}
      icon={<NotebookPen className="size-4" aria-hidden />}
      items={prompts.data ?? []}
      isLoading={prompts.isPending}
      promptMax={4000}
      pending={createPrompt.isPending || updatePrompt.isPending}
      deletingId={deletePrompt.isPending ? (deletePrompt.variables ?? null) : null}
      onCreate={(input) => createPrompt.mutateAsync(input)}
      onUpdate={(id, input) => updatePrompt.mutateAsync({ id, input })}
      onDelete={(id) => deletePrompt.mutate(id)}
    />
  );
}

export default ProjectPromptManager;
