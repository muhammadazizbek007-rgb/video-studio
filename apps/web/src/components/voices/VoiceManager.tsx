import { Mic } from 'lucide-react';
import { PromptLibrary, type PromptLibraryCopy } from '@/components/library/PromptLibrary';
import { useCreateVoice, useDeleteVoice, useUpdateVoice, useVoices } from '@/hooks/useVoices';

const COPY: PromptLibraryCopy = {
  title: 'voices.title',
  subtitle: 'voices.subtitle',
  add: 'voices.add',
  empty: 'voices.empty',
  newTitle: 'voices.newTitle',
  editTitle: 'voices.editTitle',
  formHint: 'voices.formHint',
  nameLabel: 'voices.name',
  namePlaceholder: 'voices.namePlaceholder',
  promptLabel: 'voices.prompt',
  promptPlaceholder: 'voices.promptPlaceholder',
  promptHint: 'voices.promptHint',
  bothRequired: 'voices.bothRequired',
  saveFailed: 'voices.saveFailed',
};

/**
 * The account's cast of narrators.
 *
 * Veo invents a new speaker for every clip and its API has no voice parameter, so the only
 * lever is the prompt. A voice here is a description written once — age, timbre, pace,
 * language — and reused, so a campaign asks for the same person every time.
 */
export function VoiceManager() {
  const voices = useVoices();
  const createVoice = useCreateVoice();
  const updateVoice = useUpdateVoice();
  const deleteVoice = useDeleteVoice();

  return (
    <PromptLibrary
      copy={COPY}
      icon={<Mic className="size-4" aria-hidden />}
      items={voices.data ?? []}
      isLoading={voices.isPending}
      pending={createVoice.isPending || updateVoice.isPending}
      deletingId={deleteVoice.isPending ? (deleteVoice.variables ?? null) : null}
      onCreate={(input) => createVoice.mutateAsync(input)}
      onUpdate={(id, input) => updateVoice.mutateAsync({ id, input })}
      onDelete={(id) => deleteVoice.mutate(id)}
    />
  );
}

export default VoiceManager;
