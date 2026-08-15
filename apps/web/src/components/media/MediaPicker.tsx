import type { MediaKind } from '@video-studio/shared';
import {
  AtSign,
  Film,
  Heart,
  type Images,
  Plus,
  RefreshCw,
  SkipForward,
  Sparkles,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, Spinner, Surface } from '@/components/ui';
import { useElements, useUpdateElement } from '@/hooks/useElements';
import { useEnsureLastFrames } from '@/hooks/useEnsureLastFrames';
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
import type { ElementUsage } from '@/lib/elementUsage';
import { markElementUsed, readElementUsage } from '@/lib/elementUsage';
import { ElementCreateForm } from './ElementCreateForm';
import type { ElementCategoryFilter, ElementSort } from './ElementFilterBar';
import { ElementFilterBar } from './ElementFilterBar';
import { MediaTile } from './MediaTile';
import type { MediaAsset } from './mediaAssets';
import {
  byNewest,
  elementToAsset,
  imageToAsset,
  lastFrameToAsset,
  uploadToAsset,
  videoToAsset,
} from './mediaAssets';

type TabId = 'uploads' | 'elements' | 'images' | 'lastFrames' | 'videos' | 'liked';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_TYPES = ['video/mp4'];

/** The grid's non-asset tiles — "Upload a file" and "Create element" — share this shape. */
const ACTION_TILE = cn(
  'flex aspect-square flex-col items-center justify-center gap-2 rounded-md bg-surface p-4',
  'text-center shadow-neu-raised-sm transition-[box-shadow,transform] duration-[120ms]',
  'hover:shadow-neu-raised active:scale-[0.985] disabled:opacity-60',
  'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent',
);

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
    id: 'lastFrames',
    label: 'media.tabLastFrames',
    emptyTitle: 'media.lastFramesEmpty',
    emptyBody: 'media.lastFramesEmptyBody',
    Icon: SkipForward,
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
  const [creatingElement, setCreatingElement] = useState(false);
  const [error, setError] = useState('');

  const [elementQuery, setElementQuery] = useState('');
  const [elementSort, setElementSort] = useState<ElementSort>('created');
  const [elementCategory, setElementCategory] = useState<ElementCategoryFilter>('all');
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [usage, setUsage] = useState<ElementUsage>(readElementUsage);

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

  // Held in a ref so opening the picker can refresh every list without the effect
  // re-running on each render as the query objects are recreated.
  const refreshRef = useRef<() => void>(() => undefined);
  refreshRef.current = () => {
    void uploads.refetch();
    void elements.refetch();
    void images.refetch();
    videos.refetch();
  };

  // A picker reopened after an error should not still be showing it, nor a half-filled
  // element form from the last time it was open.
  useEffect(() => {
    if (open) {
      setError('');
      setCreatingElement(false);
      setFilterMenuOpen(false);
      // Another tab of the app may have used an element since this picker last rendered.
      setUsage(readElementUsage());
      // The library is only interesting at the moment it is opened, and by then something
      // generated elsewhere in the app may be missing from it.
      refreshRef.current();
    }
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

  // What the Elements tab actually shows: the search and the filter menu narrow the list,
  // the sort reorders it. Liked keeps using the unfiltered `elementAssets`.
  const visibleElementAssets = useMemo(() => {
    const needle = elementQuery.trim().toLowerCase();
    const filtered = elementAssets.filter((asset) => {
      if (elementCategory !== 'all' && asset.category !== elementCategory) return false;
      if (!needle) return true;
      return [asset.title, asset.subtitle, asset.description].some((field) =>
        field?.toLowerCase().includes(needle),
      );
    });

    if (elementSort === 'name') {
      return filtered.sort((a, b) => a.title.localeCompare(b.title));
    }
    if (elementSort === 'used') {
      // Never-used elements sort below the used ones, newest first among themselves.
      return filtered.sort(
        (a, b) => (usage[b.id] ?? '').localeCompare(usage[a.id] ?? '') || byNewest(a, b),
      );
    }
    return filtered.sort(byNewest);
  }, [elementAssets, elementQuery, elementCategory, elementSort, usage]);

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

  const lastFrameAssets = useMemo(
    () =>
      videos.generations
        .map(lastFrameToAsset)
        .filter((asset): asset is MediaAsset => asset !== null)
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
        // A frame slot takes a picture, so the last-frame tab belongs beside the other
        // image sources and has nothing to offer a slot asking for a clip.
        if (spec.id === 'elements' || spec.id === 'images' || spec.id === 'lastFrames') {
          return !wantsVideo;
        }
        if (spec.id === 'videos') return wantsVideo;
        return true;
      }),
    [wantsVideo],
  );

  // Guards against landing on a tab the current `accept` hides — Video mode has no
  // Elements tab, and the state survives between openings.
  useEffect(() => {
    if (!visibleTabs.some((spec) => spec.id === tab)) {
      setTab('uploads');
      setCreatingElement(false);
    }
  }, [visibleTabs, tab]);

  const assetsByTab: Record<TabId, MediaAsset[]> = {
    uploads: uploadAssets,
    elements: visibleElementAssets,
    images: imageAssets,
    lastFrames: lastFrameAssets,
    videos: videoAssets,
    liked: likedAssets,
  };

  const loadingByTab: Record<TabId, boolean> = {
    uploads: uploads.isPending,
    elements: elements.isPending,
    images: images.isPending,
    lastFrames: videos.isLoading,
    videos: videos.isLoading,
    liked: uploads.isPending || images.isPending || videos.isLoading || elements.isPending,
  };

  // A library that could not be fetched must not read as a library with nothing in it —
  // that sent people off to regenerate pictures they already had.
  const failedByTab: Record<TabId, boolean> = {
    uploads: uploads.isError,
    elements: elements.isError,
    images: images.isError,
    lastFrames: videos.isError,
    videos: videos.isError,
    liked: uploads.isError || images.isError || videos.isError || elements.isError,
  };

  const active: TabSpec = visibleTabs.find((spec) => spec.id === tab) ?? UPLOADS_TAB;

  // Only while the tab is actually open: cutting a frame costs an ffmpeg run, and doing it
  // for a history nobody is looking at would be paying for nothing.
  useEnsureLastFrames(videos.generations, open && active.id === 'lastFrames');
  const assets = assetsByTab[active.id];
  const loading = loadingByTab[active.id];
  const failed = failedByTab[active.id];
  const acceptedTypes = wantsVideo ? VIDEO_TYPES : IMAGE_TYPES;
  const showElementControls = active.id === 'elements' && !creatingElement;
  const narrowedElements =
    active.id === 'elements' && (elementQuery.trim() !== '' || elementCategory !== 'all');

  /** Selection is also what feeds the "Last used" sort — nothing else records a use. */
  function handleSelect(asset: MediaAsset) {
    if (asset.source === 'element') setUsage(markElementUsed(asset.id));
    onSelect(asset);
  }

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
  if (creatingElement) {
    body = (
      <ElementCreateForm
        onCancel={() => setCreatingElement(false)}
        onCreated={() => setCreatingElement(false)}
      />
    );
  }
  // Uploads never waits behind a spinner: its "Upload a file" tile is the one control
  // someone with an empty library actually needs.
  else if (loading && assets.length === 0 && active.id !== 'uploads') {
    body = (
      <div className="flex min-h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  } else if (failed && assets.length === 0) {
    body = (
      <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
        <Surface
          elevation="inset-sm"
          radius="full"
          className="flex size-14 items-center justify-center text-danger"
        >
          <TriangleAlert className="size-6" aria-hidden />
        </Surface>
        <p className="text-sm font-semibold">{t('media.loadFailed')}</p>
        <p className="max-w-sm text-xs text-text-muted">{t('media.loadFailedBody')}</p>
        <Button
          type="button"
          variant="secondary"
          icon={<RefreshCw className="size-4" />}
          onClick={() => refreshRef.current()}
        >
          {t('common.retry')}
        </Button>
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
        {/* An empty library and an empty result set need different words — "no elements yet"
            under an active search would read as if the ones just created were gone. */}
        <p className="text-sm font-semibold">
          {narrowedElements ? t('elementFilter.noMatches') : t(active.emptyTitle)}
        </p>
        <p className="max-w-sm text-xs text-text-muted">
          {narrowedElements ? t('elementFilter.noMatchesBody') : t(active.emptyBody)}
        </p>
        {active.id === 'elements' && !narrowedElements ? (
          <Button
            type="button"
            variant="secondary"
            icon={<Plus className="size-4" />}
            onClick={() => setCreatingElement(true)}
          >
            {t('element.createCta')}
          </Button>
        ) : null}
      </div>
    );
  } else {
    body = (
      <div
        className="grid max-h-[52vh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4"
        data-testid="media-grid"
      >
        {active.id === 'elements' ? (
          <button type="button" onClick={() => setCreatingElement(true)} className={ACTION_TILE}>
            <Surface
              elevation="inset-sm"
              radius="full"
              className="flex size-10 items-center justify-center text-accent"
            >
              <Plus className="size-4" aria-hidden />
            </Surface>
            <span className="text-sm font-semibold">{t('element.createCta')}</span>
            <span className="text-[11px] leading-tight text-text-subtle">
              {t('element.subtitle')}
            </span>
          </button>
        ) : null}

        {active.id === 'uploads' ? (
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className={ACTION_TILE}
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
            onSelect={handleSelect}
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
      title={creatingElement ? t('element.newTitle') : (title ?? t('media.title'))}
      description={
        creatingElement ? t('element.subtitle') : (description ?? t('media.description'))
      }
      closeLabel={t('common.close')}
    >
      <div className="flex flex-col gap-4">
        <div
          role="tablist"
          aria-label={t('media.title')}
          // Hidden while the element form is up: the tabs would switch out from under a
          // half-filled form and drop what was typed.
          className={cn('flex flex-wrap gap-2', creatingElement && 'hidden')}
        >
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

        {showElementControls ? (
          <ElementFilterBar
            query={elementQuery}
            onQueryChange={setElementQuery}
            sort={elementSort}
            onSortChange={setElementSort}
            category={elementCategory}
            onCategoryChange={setElementCategory}
            menuOpen={filterMenuOpen}
            onMenuOpenChange={setFilterMenuOpen}
          />
        ) : null}

        {error && !creatingElement ? (
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
