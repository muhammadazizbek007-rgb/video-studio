import type { ImageGenerationDto } from '@video-studio/shared';
import { Download, Trash2 } from 'lucide-react';
import { Badge, IconButton, Spinner, Surface } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';

export interface ImageResultsProps {
  images: readonly ImageGenerationDto[];
  /** A generation in flight gets its own placeholder tile ahead of the finished ones. */
  generating: boolean;
  onDelete: (id: string) => void;
}

/** Ratios are the ones the image models accept, so a tile never letterboxes its picture. */
const ASPECT_CLASS: Readonly<Record<string, string>> = {
  '1:1': 'aspect-square',
  '16:9': 'aspect-video',
  '9:16': 'aspect-[9/16]',
  '4:3': 'aspect-[4/3]',
  '3:4': 'aspect-[3/4]',
};

export function ImageResults({ images, generating, onDelete }: ImageResultsProps) {
  const { t } = useLanguage();

  return (
    <section
      className="grid grid-cols-2 gap-3 sm:grid-cols-3"
      aria-label={t('cinema.imageResults')}
      data-testid="cinema-images"
    >
      {generating ? (
        <Surface
          elevation="inset"
          radius="md"
          className="flex aspect-square items-center justify-center"
        >
          <Spinner size="md" />
        </Surface>
      ) : null}

      {images.map((image) => (
        <Surface key={image.id} elevation="raised" radius="md" className="group relative p-1.5">
          {image.imageUrl ? (
            <img
              src={image.imageUrl}
              alt={image.prompt}
              loading="lazy"
              className={`w-full rounded-sm object-cover ${ASPECT_CLASS[image.aspectRatio] ?? 'aspect-square'}`}
            />
          ) : (
            <div
              className={`flex w-full items-center justify-center rounded-sm bg-surface p-3 text-center text-xs text-danger ${
                ASPECT_CLASS[image.aspectRatio] ?? 'aspect-square'
              }`}
            >
              {image.errorMessage ?? t('cinema.imageFailed')}
            </div>
          )}

          <div className="absolute inset-x-1.5 top-1.5 flex items-start justify-between gap-2 p-1.5">
            <Badge tone="neutral" size="sm" className="backdrop-blur-sm">
              {image.stylePreset}
            </Badge>
            <span className="flex gap-1 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100">
              {image.imageUrl ? (
                <IconButton
                  size="sm"
                  label={t('cinema.imageDownload')}
                  icon={<Download />}
                  onClick={() => window.open(image.imageUrl, '_blank', 'noopener,noreferrer')}
                />
              ) : null}
              <IconButton
                size="sm"
                label={t('cinema.imageDelete')}
                icon={<Trash2 />}
                onClick={() => onDelete(image.id)}
              />
            </span>
          </div>
        </Surface>
      ))}
    </section>
  );
}

export default ImageResults;
