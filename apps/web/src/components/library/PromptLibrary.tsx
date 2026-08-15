import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useId, useState } from 'react';
import { Button, Card, IconButton, Input, Modal, Spinner, Textarea } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';

/** Anything this list can hold: a name to recognise it by, and the words it stands for. */
export interface PromptLibraryItem {
  id: string;
  name: string;
  prompt: string;
}

export interface PromptLibraryCopy {
  title: TranslationKey;
  subtitle: TranslationKey;
  add: TranslationKey;
  empty: TranslationKey;
  newTitle: TranslationKey;
  editTitle: TranslationKey;
  formHint: TranslationKey;
  nameLabel: TranslationKey;
  namePlaceholder: TranslationKey;
  promptLabel: TranslationKey;
  promptPlaceholder: TranslationKey;
  promptHint: TranslationKey;
  bothRequired: TranslationKey;
  saveFailed: TranslationKey;
}

export interface PromptLibraryProps {
  copy: PromptLibraryCopy;
  items: readonly PromptLibraryItem[];
  isLoading?: boolean;
  /** Drawn beside each entry's name — the one thing that differs visually between lists. */
  icon: ReactNode;
  nameMax?: number;
  promptMax?: number;
  pending?: boolean;
  deletingId?: string | null;
  onCreate: (input: { name: string; prompt: string }) => Promise<unknown>;
  onUpdate: (id: string, input: { name: string; prompt: string }) => Promise<unknown>;
  onDelete: (id: string) => void;
}

/**
 * A named block of text the account writes once and reuses.
 *
 * Voices and project context are the same object from the interface's point of view — a name
 * and a paragraph, listed, edited and deleted the same way — and only differ in what the
 * words are for. Writing the screen twice would have meant fixing every future bug twice.
 */
export function PromptLibrary({
  copy,
  items,
  isLoading = false,
  icon,
  nameMax = 80,
  promptMax = 2000,
  pending = false,
  deletingId = null,
  onCreate,
  onUpdate,
  onDelete,
}: PromptLibraryProps) {
  const { t } = useLanguage();
  const nameId = useId();
  const promptId = useId();

  const [editing, setEditing] = useState<PromptLibraryItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');

  // Reopening the form must not show the last entry's words in a new one's fields.
  useEffect(() => {
    if (!formOpen) return;
    setError('');
    setName(editing?.name ?? '');
    setPrompt(editing?.prompt ?? '');
  }, [formOpen, editing]);

  function open(item: PromptLibraryItem | null) {
    setEditing(item);
    setFormOpen(true);
  }

  async function submit() {
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedName || !trimmedPrompt) {
      setError(t(copy.bothRequired));
      return;
    }

    try {
      if (editing) await onUpdate(editing.id, { name: trimmedName, prompt: trimmedPrompt });
      else await onCreate({ name: trimmedName, prompt: trimmedPrompt });
      setFormOpen(false);
      setEditing(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t(copy.saveFailed));
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t(copy.title)}</h2>
          <p className="max-w-xl text-sm text-text-muted">{t(copy.subtitle)}</p>
        </div>
        <Button type="button" icon={<Plus className="size-4" />} onClick={() => open(null)}>
          {t(copy.add)}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner size="lg" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-4 text-sm text-text-subtle">{t(copy.empty)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-3 rounded-md bg-surface p-3 shadow-neu-raised-sm"
            >
              <span className="mt-0.5 shrink-0 text-accent">{icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{item.name}</p>
                <p className="line-clamp-2 text-xs text-text-muted">{item.prompt}</p>
              </div>
              <span className="flex shrink-0 items-center gap-1">
                <IconButton
                  size="sm"
                  label={t('common.edit')}
                  icon={<Pencil />}
                  onClick={() => open(item)}
                />
                <IconButton
                  size="sm"
                  label={t('common.delete')}
                  icon={<Trash2 />}
                  loading={deletingId === item.id}
                  onClick={() => onDelete(item.id)}
                />
              </span>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t(copy.editTitle) : t(copy.newTitle)}
        description={t(copy.formHint)}
        closeLabel={t('common.close')}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={nameId}
              className="text-xs font-semibold uppercase tracking-wider opacity-60"
            >
              {t(copy.nameLabel)}
            </label>
            <Input
              id={nameId}
              value={name}
              placeholder={t(copy.namePlaceholder)}
              disabled={pending}
              onChange={(event) => setName(event.target.value.slice(0, nameMax))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={promptId}
              className="text-xs font-semibold uppercase tracking-wider opacity-60"
            >
              {t(copy.promptLabel)}
            </label>
            <Textarea
              id={promptId}
              rows={5}
              value={prompt}
              placeholder={t(copy.promptPlaceholder)}
              disabled={pending}
              onChange={(event) => setPrompt(event.target.value.slice(0, promptMax))}
            />
            <p className="text-xs text-text-subtle">{t(copy.promptHint)}</p>
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

export default PromptLibrary;
