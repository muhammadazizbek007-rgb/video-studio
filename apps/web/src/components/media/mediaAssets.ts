import type {
  ElementDto,
  GenerationDto,
  ImageGenerationDto,
  UploadDto,
  VideoElementCategory,
} from '@video-studio/shared';

/**
 * One shape for five sources.
 *
 * Uploads, elements, stills and clips are unrelated records with unrelated fields; the
 * picker only ever needs "what does it look like, what is its URL, can it be liked". The
 * adapters below flatten each into that, so the grid stays one component instead of four.
 */

export type MediaAssetSource = 'upload' | 'element' | 'image' | 'video';

export interface MediaAsset {
  /** Unique across sources — the same row id could exist in two collections. */
  key: string;
  id: string;
  source: MediaAssetSource;
  kind: 'image' | 'video';
  /** What gets handed back on selection. */
  url: string;
  /** Storage key, when the source knows it; needed to delete the object later. */
  path?: string;
  /** Still shown in the grid: a clip uses its poster when it has one. */
  previewUrl?: string;
  title: string;
  subtitle?: string;
  badge?: string;
  /** Elements only — what the Elements tab filters by. */
  category?: VideoElementCategory;
  /** Elements only — the free text their search runs over. */
  description?: string;
  saved: boolean;
  /** False for sources with no like of their own — a video that is still rendering. */
  likeable: boolean;
  deletable: boolean;
  createdAt: string;
}

export function uploadToAsset(upload: UploadDto): MediaAsset {
  const asset: MediaAsset = {
    key: `upload:${upload.id}`,
    id: upload.id,
    source: 'upload',
    kind: upload.kind,
    url: upload.url,
    path: upload.path,
    title: upload.filename || upload.url.split('/').pop() || upload.id,
    saved: upload.saved,
    likeable: true,
    deletable: true,
    createdAt: upload.createdAt,
  };
  if (upload.kind === 'image') asset.previewUrl = upload.url;
  return asset;
}

export function elementToAsset(element: ElementDto): MediaAsset {
  const asset: MediaAsset = {
    key: `element:${element.id}`,
    id: element.id,
    source: 'element',
    kind: 'image',
    url: element.imageUrl ?? '',
    previewUrl: element.imageUrl ?? '',
    title: element.name,
    subtitle: element.handle,
    badge: element.category,
    category: element.category,
    // Elements carry `pinned`, which is the same idea under a different name.
    saved: element.pinned,
    likeable: true,
    deletable: false,
    createdAt: element.createdAt,
  };
  if (element.description) asset.description = element.description;
  return asset;
}

export function imageToAsset(image: ImageGenerationDto): MediaAsset {
  return {
    key: `image:${image.id}`,
    id: image.id,
    source: 'image',
    kind: 'image',
    url: image.imageUrl ?? '',
    previewUrl: image.imageUrl ?? '',
    title: image.prompt,
    badge: image.stylePreset,
    saved: image.saved,
    likeable: true,
    deletable: true,
    createdAt: image.createdAt,
  };
}

export function videoToAsset(generation: GenerationDto): MediaAsset {
  const asset: MediaAsset = {
    key: `video:${generation.id}`,
    id: generation.id,
    source: 'video',
    kind: 'video',
    url: generation.resultVideoUrl ?? '',
    title: generation.prompt,
    badge: generation.stylePreset,
    saved: generation.saved,
    likeable: true,
    deletable: false,
    createdAt: generation.createdAt,
  };
  // The reference frame doubles as a poster; without one the tile falls back to an icon.
  const poster = generation.referenceImageUrls[0];
  if (poster) asset.previewUrl = poster;
  return asset;
}

/**
 * The closing frame of a finished clip, offered as a picture.
 *
 * This is how shots are chained by hand: the frame a clip ended on becomes the frame the
 * next one starts from, so the second picks up exactly where the first stopped rather than
 * approximately where it was described to.
 *
 * Only clips whose frame has actually been cut appear — one that has not been extracted yet
 * would be a tile that selects nothing.
 */
export function lastFrameToAsset(generation: GenerationDto): MediaAsset | null {
  const url = generation.resultLastFrameUrl;
  if (!url) return null;

  return {
    key: `last-frame:${generation.id}`,
    id: generation.id,
    source: 'video',
    kind: 'image',
    url,
    previewUrl: url,
    title: generation.prompt,
    badge: generation.stylePreset,
    // Liking a frame would mean liking the clip, which is a different act with a different
    // undo — so the tile is a picture to take, nothing more.
    saved: false,
    likeable: false,
    deletable: false,
    createdAt: generation.createdAt,
  };
}

/** Newest first, the order every tab is expected to be in. */
export function byNewest(a: MediaAsset, b: MediaAsset): number {
  return b.createdAt.localeCompare(a.createdAt);
}
