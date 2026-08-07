import type { MediaKind } from '@video-studio/shared';
import { AtSign, Film, Heart, type Images, Sparkles, Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Spinner, Surface } from '@/components/ui';
import { useElements, useUpdateElement } from '@/hooks/useElements';
import { useGenerations, useUpdateGeneration } from '@/hooks/useGenerations';
import {
  useDeleteImageGeneration,
  useDeleteUpload,
  useImageGenerations,
  useUpdateImageGeneration,
  useUpdateUpload,
  useUploads,
} from '@/hooks/useMediaLibrary';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { MediaTile } from './MediaTile';
import type { MediaAsset } from './mediaAssets';
import { byNewest, elementToAsset, imageToAsset, uploadToAsset, videoToAsset } from './mediaAssets';

type TabId = 'uploads' | 'elements' | 'images' | 'videos' | 'liked';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_TYPES = ['video/mp4'];

export interface MediaPickerProps {
  open: boolean;
  onClose: () => void;
  /** What the caller can use. A frame slot takes an image; a segment takes a clip. */
  accept: MediaKind;
  onSelect: (asset: MediaAsset) => void;
  /** Highlighted in the grid, so reopening the picker shows what is already in the slot. */
  selectedUrl?: string | null;
  title?: string;
  description?: string;
}

interface TabSpec {
  id: TabId;
  label: TranslationKey;
  emptyTitle: TranslationKey;
  emptyBody: TranslationKey;
  Icon: typeof Images;
}

/** Always present, and the fallback whenever the requested tab is hidden by `accept`. */
const UPLOADS_TAB: TabSpec = {
  id: 'uploads',
  label: 'media.tabUploads',
  emptyTitle: 'media.uploadsEmpty',
  emptyBody: 'media.uploadsEmptyBody',
  Icon: Upload,
};

const TABS: readonly TabSpec[] = [
  UPLOADS_TAB,
  {
    id: 'elements',
    label: 'media.tabElements',
    emptyTitle: 'media.elementsEmpty',
    emptyBody: 'media.elementsEmptyBody',
    Icon: AtSign,
  },
  {
    id: 'images',
    label: 'media.tabImages',
    emptyTitle: 'media.imagesEmpty',
    emptyBody: 'media.imagesEmptyBody',
    Icon: Sparkles,
  },
  {
    id: 'videos',
    label: 'media.tabVideos',
    emptyTitle: 'media.videosEmpty',
    emptyBody: 'media.videosEmptyBody',
    Icon: Film,
  },
  {
    id: 'liked',
    label: 'media.tabLiked',
    emptyTitle: 'media.likedEmpty',
    emptyBody: 'media.likedEmptyBody',
    Icon: Heart,
  },
];

/**
 * The one place a picture or a clip is chosen.
 *
 * Every slot in the product used to open the OS file dialog directly, which made
 * everything the account already had — uploads, elements, generated stills, finished
 * clips — unreachable without generating or uploading it again. This opens on the library
 * instead, and the file dialog is one tile inside it.
 */
export function MediaPicker({
  open,
  onClose,
  accept,
  onSelect,
  selectedUrl,
  title,
  description,
}: MediaPickerProps) {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [tab, setTab] = useState<TabId>('uploads');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const uploads = useUploads(accept);
  const elements = useElements();
  const images = useImageGenerations();
  const videos = useGenerations();

  const updateUpload = useUpdateUpload();
  const deleteUpload = useDeleteUpload();
  const updateElement = useUpdateElement();
  const updateImage = useUpdateImageGeneration();
  const deleteImage = useDeleteImageGeneration();
  const updateVideo = useUpdateGeneration();

  // A picker reopened after an error should not still be showing it.
  useEffect(() => {
    if (open) setError('');
  }, [open]);

  const uploadAssets = useMemo(
    () => (uploads.data ?? []).map(uploadToAsset).sort(byNewest),
    [uploads.data],
  );

  const elementAssets = useMemo(
    () =>
      (elements.data ?? [])
        .filter((element) => Boolean(element.imageUrl))
        .map(elementToAsset)
        .sort(byNewest),
    [elements.data],
  );

  const imageAssets = useMemo(
    () =>
      (images.data ?? [])
        .filter((image) => Boolean(image.imageUrl))
        .map(imageToAsset)
        .sort(byNewest),
    [images.data],
  );

  const videoAssets = useMemo(
    () =>
      videos.generations
        .filter((generation) => Boolean(generation.resultVideoUrl))
        .map(videoToAsset)
        .sort(byNewest),
    [videos.generations],
  );

  // Liked is a view over the other four, not a collection of its own — nothing can be
  // liked here that is not already listed under its own tab.
  const likedAssets = useMemo(
    () =>
      [...uploadAssets, ...elementAssets, ...imageAssets, ...videoAssets]
        .filter((asset) => asset.saved && asset.kind === accept)
        .sort(byNewest),
    [uploadAssets, elementAssets, imageAssets, videoAssets, accept],
  );

  const wantsVideo = accept === 'video';
  const visibleTabs = useMemo(
    () =>
      TABS.filter((spec) => {
        if (spec.id === 'elements' || spec.id === 'images') return !wantsVideo;
        if (spec.id === 'videos') return wantsVideo;
        return true;
      }),
    [wantsVideo],
  );

  // Guards against landing on a tab the current `accept` hides — Video mode has no
  // Elements tab, and the state survives between openings.
  useEffect(() => {
    if (!visibleTabs.some((spec) => spec.id === tab)) setTab('uploads');
  }, [visibleTabs, tab]);

  const assetsByTab: Record<TabId, MediaAsset[]> = {
    uploads: uploadAssets,
    elements: elementAssets,
    images: imageAssets,
    videos: videoAssets,
    liked: likedAssets,
  };

  const loadingByTab: Record<TabId, boolean> = {
    uploads: uploads.isPending,
    elements: elements.isPending,
    images: images.isPending,
    videos: videos.isLoading,
    liked: uploads.isPending || images.isPending || videos.isLoading || elements.isPending,
  };

  const active: TabSpec = visibleTabs.find((spec) => spec.id === tab) ?? UPLOADS_TAB;
  const assets = assetsByTab[active.id];
  const loading = loadingByTab[active.id];
  const acceptedTypes = wantsVideo ? VIDEO_TYPES : IMAGE_TYPES;

  function toggleSaved(asset: MediaAsset) {
    setError('');
    const next = !asset.saved;
    const failed = () => setError(t('media.likeFailed'));

    if (asset.source === 'upload') {
      updateUpload.mutate({ id: asset.id, input: { saved: next } }, { onError: failed });
      return;
    }
    if (asset.source === 'image') {
      updateImage.mutate({ id: asset.id, input: { saved: next } }, { onError: failed });
      return;
    }
    if (asset.source === 'video') {
      updateVideo.mutate({ id: asset.id, input: { saved: next } }, { onError: failed });
      return;
    }
    updateElement.mutate({ id: asset.id, input: { pinned: next } }, { onError: failed });
  }

  function remove(asset: MediaAsset) {
    setError('');
    const failed = () => setError(t('media.deleteFailed'));
    if (asset.source === 'upload') deleteUpload.mutate(asset.id, { onError: failed });
    else if (asset.source === 'image') deleteImage.mutate(asset.id, { onError: failed });
  }

  async function uploadFile(file: File) {
    setError('');
    if (!acceptedTypes.includes(file.type)) {
      setError(wantsVideo ? t('media.badVideoType') : t('upload.badType'));
      return;
    }

    setUploading(true);
    try {
      // Straight through to the caller: someone who just picked a file off their disk
      // means to use it, not to admire it in the grid.
      const uploaded = await api.media.upload(file);
      await uploads.refetch();
      onSelect(uploadToAsset(uploaded));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t('upload.failed'));
    } finally {
      setUploading(false);
    }
  }

  let body: ReactNode;
  // Uploads never waits behind a spinner: its "Upload a file" tile is the one control
  // someone with an empty library actually needs.
  if (loading && assets.length === 0 && active.id !== 'uploads') {
    body = (
      <div className="flex min-h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  } else if (assets.length === 0 && active.id !== 'uploads') {
    body = (
      <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
        <Surface
          elevation="inset-sm"
          radius="full"
          className="flex size-14 items-center justify-center text-text-subtle"
        >
          <active.Icon className="size-6" aria-hidden />
        </Surface>
        <p className="text-sm font-semibold">{t(active.emptyTitle)}</p>
        <p className="max-w-sm text-xs text-text-muted">{t(active.emptyBody)}</p>
      </div>
    );
  } else {
    body = (
      <div
        className="grid max-h-[52vh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4"
        data-testid="media-grid"
      >
        {active.id === 'uploads' ? (
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'flex aspect-square flex-col items-center justify-center gap-2 rounded-md bg-surface p-4',
              'text-center shadow-neu-raised-sm transition-[box-shadow,transform] duration-[120ms]',
              'hover:shadow-neu-raised active:scale-[0.985] disabled:opacity-60',
              'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent',
            )}
          >
            {uploading ? (
              <Spinner size="md" />
            ) : (
              <Surface
                elevation="inset-sm"
                radius="full"
                className="flex size-10 items-center justify-center text-accent"
              >
                <Upload className="size-4" aria-hidden />
              </Surface>
            )}
            <span className="text-sm font-semibold">{t('media.uploadFile')}</span>
            <span className="text-[11px] leading-tight text-text-subtle">
              {wantsVideo ? t('media.uploadHintVideo') : t('media.uploadHintImage')}
            </span>
          </button>
        ) : null}

        {assets.map((asset) => (
          <MediaTile
            key={asset.key}
            asset={asset}
            selected={Boolean(selectedUrl) && asset.url === selectedUrl}
            onSelect={onSelect}
            onToggleSaved={toggleSaved}
            onDelete={remove}
          />
        ))}
      </div>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={title ?? t('media.title')}
      description={description ?? t('media.description')}
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-4">
        <div role="tablist" aria-label={t('media.title')} className="flex flex-wrap gap-2">
          {visibleTabs.map((spec) => {
            const isActive = spec.id === active.id;
            return (
              <button
                key={spec.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setTab(spec.id)}
                className={cn(
                  'flex items-center gap-2 rounded-full bg-surface px-3.5 py-2 text-xs font-semibold',
                  'transition-[box-shadow,color] duration-[120ms]',
                  'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent',
                  isActive
                    ? 'text-accent shadow-neu-inset-sm'
                    : 'text-text-subtle shadow-neu-raised-sm hover:text-text-primary',
                )}
              >
                <spec.Icon className="size-3.5" aria-hidden />
                {t(spec.label)}
              </button>
            );
          })}
        </div>

        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}

        {body}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedTypes.join(',')}
        className="sr-only"
        aria-label={t('media.uploadFile')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void uploadFile(file);
        }}
      />
    </Modal>
  );
}

export default MediaPicker;
