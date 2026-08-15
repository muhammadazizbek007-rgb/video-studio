import type { VoiceDto } from '@video-studio/shared';
import { Mic, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button, Card, IconButton, Input, Modal, Spinner, Textarea } from '@/components/ui';
import { useCreateVoice, useDeleteVoice, useUpdateVoice, useVoices } from '@/hooks/useVoices';
import { useLanguage } from '@/i18n/LanguageContext';

const NAME_MAX = 80;
const PROMPT_MAX = 2000;

/**
 * The account's cast of narrators.
 *
 * Veo invents a new speaker for every clip and its API has no voice parameter, so the only
 * lever is the prompt. A voice here is a description written once — age, timbre, pace,
 * language — and attached to any generation, so a campaign can ask for the same person every
 * time instead of meeting a stranger in each clip.
 */
export function VoiceManager() {
  const { t } = useLanguage();
  const voices = useVoices();
  const createVoice = useCreateVoice();
  const updateVoice = useUpdateVoice();
  const deleteVoice = useDeleteVoice();

  const [editing, setEditing] = useState<VoiceDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const nameId = useId();
  const promptId = useId();

  // Reopening the form must not show the last narrator's words in a new one's fields.
  useEffect(() => {
    if (!formOpen) return;
    setError('');
    setName(editing?.name ?? '');
    setPrompt(editing?.prompt ?? '');
  }, [formOpen, editing]);

  const pending = createVoice.isPending || updateVoice.isPending;

  function open(voice: VoiceDto | null) {
    setEditing(voice);
    setFormOpen(true);
  }

  async function submit() {
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedName || !trimmedPrompt) {
      setError(t('voices.bothRequired'));
      return;
    }

    try {
      if (editing) {
        await updateVoice.mutateAsync({
          id: editing.id,
          input: { name: trimmedName, prompt: trimmedPrompt },
        });
      } else {
        await createVoice.mutateAsync({ name: trimmedName, prompt: trimmedPrompt });
      }
      setFormOpen(false);
      setEditing(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('voices.saveFailed'));
    }
  }

  const items = voices.data ?? [];

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('voices.title')}</h2>
          <p className="max-w-xl text-sm text-text-muted">{t('voices.subtitle')}</p>
        </div>
        <Button type="button" icon={<Plus className="size-4" />} onClick={() => open(null)}>
          {t('voices.add')}
        </Button>
      </div>

      {voices.isPending ? (
        <div className="flex justify-center py-6">
          <Spinner size="lg" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-4 text-sm text-text-subtle">{t('voices.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((voice) => (
            <li
              key={voice.id}
              className="flex items-start gap-3 rounded-md bg-surface p-3 shadow-neu-raised-sm"
            >
              <Mic className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{voice.name}</p>
                <p className="line-clamp-2 text-xs text-text-muted">{voice.prompt}</p>
              </div>
              <span className="flex shrink-0 items-center gap-1">
                <IconButton
                  size="sm"
                  label={t('common.edit')}
                  icon={<Pencil />}
                  onClick={() => open(voice)}
                />
                <IconButton
                  size="sm"
                  label={t('common.delete')}
                  icon={<Trash2 />}
                  loading={deleteVoice.isPending && deleteVoice.variables === voice.id}
                  onClick={() => deleteVoice.mutate(voice.id)}
                />
              </span>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('voices.editTitle') : t('voices.newTitle')}
        description={t('voices.formHint')}
        closeLabel={t('common.close')}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={nameId}
              className="text-xs font-semibold uppercase tracking-wider opacity-60"
            >
              {t('voices.name')}
            </label>
            <Input
              id={nameId}
              value={name}
              placeholder={t('voices.namePlaceholder')}
              disabled={pending}
              onChange={(event) => setName(event.target.value.slice(0, NAME_MAX))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={promptId}
              className="text-xs font-semibold uppercase tracking-wider opacity-60"
            >
              {t('voices.prompt')}
            </label>
            <Textarea
              id={promptId}
              rows={5}
              value={prompt}
              placeholder={t('voices.promptPlaceholder')}
              disabled={pending}
              onChange={(event) => setPrompt(event.target.value.slice(0, PROMPT_MAX))}
            />
            <p className="text-xs text-text-subtle">{t('voices.promptHint')}</p>
          </div>

          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setFormOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="primary" loading={pending} onClick={() => void submit()}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

export default VoiceManager;
