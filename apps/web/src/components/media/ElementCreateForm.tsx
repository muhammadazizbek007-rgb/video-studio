import type { ElementDto, VideoElementCategory } from '@video-studio/shared';
import { buildHandle } from '@video-studio/shared';
import { ImagePlus, Plus, X } from 'lucide-react';
import type { DragEvent } from 'react';
import { useId, useRef, useState } from 'react';
import { Button, IconButton, Input, Select, Spinner, Surface, Textarea } from '@/components/ui';
import { useCreateElement } from '@/hooks/useElements';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 2000;

const CATEGORY_KEYS: Record<VideoElementCategory, TranslationKey> = {
  general: 'elementCategory.general',
  character: 'elementCategory.character',
  location: 'elementCategory.location',
  prop: 'elementCategory.prop',
};

const CATEGORIES: readonly VideoElementCategory[] = ['general', 'character', 'location', 'prop'];

function toCategory(value: string): VideoElementCategory | undefined {
  return CATEGORIES.find((category) => category === value);
}

export interface ElementCreateFormProps {
  onCancel: () => void;
  onCreated: (element: ElementDto) => void;
}

/**
 * Creating an element without leaving the picker.
 *
 * The library screen has its own editor, but someone who opened the picker to fill a frame
 * slot and found the Elements tab empty had nowhere to go — the element had to be created on
 * another page and the slot filled again afterwards.
 */
export function ElementCreateForm({ onCancel, onCreated }: ElementCreateFormProps) {
  const { t } = useLanguage();
  const createElement = useCreateElement();

  const nameId = useId();
  const descriptionId = useId();
  const categoryId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<VideoElementCategory>('general');
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  const trimmedName = name.trim();

  async function upload(file: File) {
    setError('');
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(t('upload.badType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('upload.tooLarge'));
      return;
    }

    setUploading(true);
    try {
      const uploaded = await api.media.upload(file);
      setImageUrl(uploaded.url);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t('upload.failed'));
    } finally {
      setUploading(false);
    }
  }

  function pickFile() {
    fileInputRef.current?.click();
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files.item(0);
    if (file) void upload(file);
  }

  async function submit() {
    if (!trimmedName) {
      setError(t('element.nameRequired'));
      return;
    }
    // The picker only lists elements that have an image — one created without it would be
    // saved and then vanish from the grid the user is looking at.
    if (!imageUrl) {
      setError(t('element.imageRequired'));
      return;
    }

    try {
      const created = await createElement.mutateAsync({
        name: trimmedName,
        category,
        description: description.trim() || undefined,
        imageUrl,
      });
      onCreated(created);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('element.saveFailed'));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-5 sm:grid-cols-2">
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
              value={name}
              placeholder={t('element.namePlaceholder')}
              onChange={(event) => setName(event.target.value.slice(0, NAME_MAX))}
            />
            {trimmedName ? (
              <p className="text-xs text-text-muted">
                {t('element.handlePreview')} <strong>{buildHandle(trimmedName)}</strong>
              </p>
            ) : null}
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
              rows={4}
              value={description}
              placeholder={t('element.descriptionPlaceholder')}
              onChange={(event) => setDescription(event.target.value.slice(0, DESCRIPTION_MAX))}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={categoryId}
              className="text-xs font-semibold uppercase tracking-wider opacity-60"
            >
              {t('element.category')}
            </label>
            <Select
              id={categoryId}
              value={category}
              onChange={(event) => {
                const next = toCategory(event.target.value);
                if (next) setCategory(next);
              }}
            >
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(CATEGORY_KEYS[value])}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target has no ARIA role, and the
            keyboard path is the button inside it — not this wrapper */}
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <Surface
            elevation="inset-sm"
            radius="md"
            className={cn(
              'relative h-full min-h-56 overflow-hidden p-0',
              dragging && 'ring-2 ring-accent/40',
            )}
          >
            {imageUrl ? (
              <div className="relative h-full">
                <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                <span className="absolute right-2 top-2 flex gap-1">
                  <IconButton
                    label={t('media.change')}
                    icon={<ImagePlus />}
                    size="sm"
                    onClick={pickFile}
                  />
                  <IconButton
                    label={t('upload.remove')}
                    icon={<X />}
                    size="sm"
                    onClick={() => setImageUrl('')}
                  />
                </span>
              </div>
            ) : (
              <button
                type="button"
                disabled={uploading}
                onClick={pickFile}
                className={cn(
                  'flex h-full min-h-56 w-full flex-col items-center justify-center gap-2 p-6 text-center',
                  'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent',
                  'disabled:opacity-60',
                )}
              >
                {uploading ? (
                  <Spinner size="lg" />
                ) : (
                  <Surface
                    elevation="raised-sm"
                    radius="full"
                    className="flex size-12 items-center justify-center text-text-subtle"
                  >
                    <Plus className="size-5" aria-hidden />
                  </Surface>
                )}
                <span className="text-sm font-semibold">{t('element.uploadTitle')}</span>
                <span className="text-xs text-text-muted">{t('element.uploadHint')}</span>
                <span className="text-[11px] text-text-subtle">{t('media.uploadHintImage')}</span>
              </button>
            )}
          </Surface>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          loading={createElement.isPending}
          disabled={uploading}
          onClick={() => void submit()}
        >
          {t('element.create')}
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        className="sr-only"
        aria-label={t('element.uploadTitle')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />
    </div>
  );
}

export default ElementCreateForm;
