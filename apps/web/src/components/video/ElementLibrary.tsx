import type { CreateElementInput, ElementDto, VideoElementCategory } from '@video-studio/shared';
import { buildHandle, ELEMENT_CATEGORY_LABELS } from '@video-studio/shared';
import { ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { MediaPicker } from '@/components/media/MediaPicker';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui';
import {
  useCreateElement,
  useDeleteElement,
  useElements,
  useUpdateElement,
} from '@/hooks/useElements';
import { useLanguage } from '@/i18n/LanguageContext';

const CATEGORIES: readonly VideoElementCategory[] = ['general', 'character', 'location', 'prop'];

function toCategory(value: string): VideoElementCategory | undefined {
  return CATEGORIES.find((category) => category === value);
}

interface DraftState {
  id: string | null;
  name: string;
  category: VideoElementCategory;
  description: string;
  imageUrl: string;
}

const EMPTY_DRAFT: DraftState = {
  id: null,
  name: '',
  category: 'general',
  description: '',
  imageUrl: '',
};

export function ElementLibrary() {
  const { t } = useLanguage();
  const { data: elements, isLoading, isError } = useElements();
  const createElement = useCreateElement();
  const updateElement = useUpdateElement();
  const deleteElement = useDeleteElement();

  const titleId = useId();
  const nameId = useId();
  const categoryId = useId();
  const descriptionId = useId();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ElementDto | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [formError, setFormError] = useState('');

  const items = elements ?? [];
  const saving = createElement.isPending || updateElement.isPending;

  function openCreate() {
    setFormError('');
    setDraft({ ...EMPTY_DRAFT });
  }

  function openEdit(element: ElementDto) {
    setFormError('');
    setDraft({
      id: element.id,
      name: element.name,
      category: element.category,
      description: element.description ?? '',
      imageUrl: element.imageUrl ?? '',
    });
  }

  function applyImage(url: string) {
    setFormError('');
    setDraft((current) => (current ? { ...current, imageUrl: url } : current));
    setPickerOpen(false);
  }

  async function save() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      setFormError(t('element.nameRequired'));
      return;
    }

    const payload: CreateElementInput = {
      name,
      category: draft.category,
      description: draft.description.trim() || undefined,
      imageUrl: draft.imageUrl || undefined,
    };

    try {
      if (draft.id) {
        await updateElement.mutateAsync({ id: draft.id, input: payload });
      } else {
        await createElement.mutateAsync(payload);
      }
      setDraft(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('element.saveFailed'));
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteElement.mutateAsync(target.id);
    } catch (error) {
      // The optimistic removal is rolled back by the mutation, so without this the row
      // simply reappears and the user is never told why.
      setFormError(error instanceof Error ? error.message : t('element.deleteFailed'));
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id={titleId} className="text-lg font-semibold">
            {t('element.title')}
          </h2>
          <p className="text-sm opacity-70">{t('element.subtitle')}</p>
        </div>
        <Button type="button" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          {t('element.new')}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <Card className="p-4 text-sm">{t('element.loadFailed')}</Card>
      ) : items.length === 0 ? (
        <EmptyState title={t('element.emptyTitle')} description={t('element.emptyBody')} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((element) => (
            <li key={element.id}>
              <Card className="flex items-center gap-3 p-3">
                {element.imageUrl ? (
                  <img
                    src={element.imageUrl}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-current/10">
                    <ImagePlus className="h-5 w-5 opacity-50" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{element.handle}</p>
                  <p className="truncate text-xs opacity-70">{element.name}</p>
                  <Badge tone="neutral">{ELEMENT_CATEGORY_LABELS[element.category]}</Badge>
                </div>
                <IconButton
                  type="button"
                  label={t('common.edit')}
                  icon={<Pencil />}
                  onClick={() => openEdit(element)}
                />
                <IconButton
                  type="button"
                  label={t('common.delete')}
                  icon={<Trash2 />}
                  onClick={() => setPendingDelete(element)}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t('element.editTitle') : t('element.newTitle')}
      >
        {draft ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={nameId}
                className="text-xs font-semibold uppercase tracking-wider opacity-60"
              >
                {t('element.name')}
              </label>
              <Input
                id={nameId}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value.slice(0, 80) })}
              />
            </div>

            {draft.name.trim() ? (
              <p className="text-xs opacity-70">
                {t('element.handlePreview')} <strong>{buildHandle(draft.name)}</strong>
              </p>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={categoryId}
                className="text-xs font-semibold uppercase tracking-wider opacity-60"
              >
                {t('element.category')}
              </label>
              <Select
                id={categoryId}
                value={draft.category}
                onChange={(event) => {
                  const next = toCategory(event.target.value);
                  if (next) setDraft({ ...draft, category: next });
                }}
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {ELEMENT_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={descriptionId}
                className="text-xs font-semibold uppercase tracking-wider opacity-60"
              >
                {t('element.description')}
              </label>
              <Textarea
                id={descriptionId}
                rows={3}
                value={draft.description}
                placeholder={t('element.descriptionPlaceholder')}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value.slice(0, 2000) })
                }
              />
            </div>

            <div className="flex items-center gap-3">
              {draft.imageUrl ? (
                <img src={draft.imageUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
              ) : null}
              <Button type="button" variant="secondary" onClick={() => setPickerOpen(true)}>
                <ImagePlus className="h-4 w-4" />
                {draft.imageUrl ? t('element.replaceImage') : t('element.addImage')}
              </Button>
            </div>

            {formError ? (
              <p role="alert" className="text-xs opacity-80">
                {formError}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="button" loading={saving} onClick={() => void save()}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        accept="image"
        selectedUrl={draft?.imageUrl || null}
        title={t('element.addImage')}
        onSelect={(asset) => applyImage(asset.url)}
      />

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={t('element.deleteTitle')}
      >
        <p className="text-sm">{t('element.deleteConfirm')}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setPendingDelete(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={deleteElement.isPending}
            onClick={() => void confirmDelete()}
          >
            {t('common.delete')}
          </Button>
        </div>
      </Modal>
    </section>
  );
}

export default ElementLibrary;
