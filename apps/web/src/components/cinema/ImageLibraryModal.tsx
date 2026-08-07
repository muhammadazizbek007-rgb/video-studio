import type { ImageGenerationDto } from '@video-studio/shared';
import { Images } from 'lucide-react';
import { Badge, Modal, Spinner } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import { cn } from '@/lib/cn';

export interface ImageLibraryModalProps {
  open: boolean;
  /** The account's own generations — a failed one has no picture to offer. */
  images: readonly ImageGenerationDto[];
  loading: boolean;
  onSelect: (image: ImageGenerationDto) => void;
  onClose: () => void;
}

export function ImageLibraryModal({
  open,
  images,
  loading,
  onSelect,
  onClose,
}: ImageLibraryModalProps) {
  const { t } = useLanguage();
  const usable = images.filter((image) => Boolean(image.imageUrl));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={t('cinema.libraryTitle')}
      description={t('cinema.libraryDescription')}
      closeLabel={t('common.close')}
    >
      {loading && usable.length === 0 ? (
        <div className="flex min-h-48 items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : usable.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
          <Images className="size-8 text-text-subtle" aria-hidden />
          <p className="max-w-sm text-sm text-text-muted">{t('cinema.libraryEmpty')}</p>
        </div>
      ) : (
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
          data-testid="cinema-library"
        >
          {usable.map((image) => (
            <button
              key={image.id}
              type="button"
              title={image.prompt}
              aria-label={`${t('cinema.librarySelect')} — ${image.prompt}`}
              onClick={() => onSelect(image)}
              className={cn(
                'group relative aspect-square overflow-hidden rounded-md bg-surface p-1.5',
                'shadow-neu-raised-sm transition-[box-shadow,transform] duration-[120ms]',
                'hover:shadow-neu-raised active:scale-[0.985] active:shadow-neu-inset-sm',
                'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent',
              )}
            >
              <img
                src={image.imageUrl}
                alt={image.prompt}
                loading="lazy"
                className="size-full rounded-sm object-cover"
              />
              <Badge tone="neutral" size="sm" className="absolute left-3 top-3 backdrop-blur-sm">
                {image.stylePreset}
              </Badge>
              <span
                className={cn(
                  'absolute inset-x-3 bottom-3 rounded-full bg-surface/90 py-1 text-[10px]',
                  'font-semibold text-text-primary opacity-0 transition-opacity duration-[120ms]',
                  'group-hover:opacity-100 group-focus-visible:opacity-100',
                )}
              >
                {t('cinema.librarySelect')}
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default ImageLibraryModal;
