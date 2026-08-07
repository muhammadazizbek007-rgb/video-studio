import { Check, Film, Heart, Trash2 } from 'lucide-react';
import { Badge, IconButton } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import { cn } from '@/lib/cn';
import type { MediaAsset } from './mediaAssets';

export interface MediaTileProps {
  asset: MediaAsset;
  selected: boolean;
  onSelect: (asset: MediaAsset) => void;
  onToggleSaved: (asset: MediaAsset) => void;
  onDelete: (asset: MediaAsset) => void;
}

/**
 * One card in the picker grid.
 *
 * The tile itself is the select button; like and delete sit on top of it as siblings
 * rather than nested buttons — a button inside a button is invalid HTML and the inner
 * click would select the asset on its way out.
 */
export function MediaTile({ asset, selected, onSelect, onToggleSaved, onDelete }: MediaTileProps) {
  const { t } = useLanguage();

  return (
    <div className="group relative">
      <button
        type="button"
        title={asset.title}
        aria-label={`${t('media.select')} — ${asset.title}`}
        onClick={() => onSelect(asset)}
        className={cn(
          'relative block aspect-square w-full overflow-hidden rounded-md bg-surface p-1.5',
          'transition-[box-shadow,transform] duration-[120ms]',
          'hover:shadow-neu-raised active:scale-[0.985]',
          'focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent',
          selected ? 'shadow-neu-inset-sm' : 'shadow-neu-raised-sm',
        )}
      >
        {asset.previewUrl ? (
          <img
            src={asset.previewUrl}
            alt={asset.title}
            loading="lazy"
            className="size-full rounded-sm object-cover"
          />
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-2 rounded-sm bg-surface text-text-subtle shadow-neu-inset-sm">
            <Film className="size-6" aria-hidden />
            <span className="line-clamp-2 px-3 text-center text-[11px] leading-tight">
              {asset.title}
            </span>
          </span>
        )}

        {selected ? (
          <span className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-full bg-accent text-accent-contrast">
            <Check className="size-3.5" aria-hidden />
          </span>
        ) : null}
      </button>

      {asset.badge ? (
        <Badge
          tone="neutral"
          size="sm"
          className="pointer-events-none absolute left-3 top-3 backdrop-blur-sm"
        >
          {asset.badge}
        </Badge>
      ) : null}

      <span
        className={cn(
          'absolute inset-x-3 bottom-3 flex items-center justify-end gap-1',
          'opacity-0 transition-opacity duration-[120ms]',
          'group-hover:opacity-100 group-focus-within:opacity-100',
          asset.saved && 'opacity-100',
        )}
      >
        {asset.likeable ? (
          <IconButton
            size="sm"
            label={asset.saved ? t('media.unlike') : t('media.like')}
            aria-pressed={asset.saved}
            icon={<Heart className={asset.saved ? 'fill-current' : undefined} />}
            variant={asset.saved ? 'primary' : 'ghost'}
            onClick={() => onToggleSaved(asset)}
          />
        ) : null}
        {asset.deletable ? (
          <IconButton
            size="sm"
            label={t('media.delete')}
            icon={<Trash2 />}
            onClick={() => onDelete(asset)}
          />
        ) : null}
      </span>
    </div>
  );
}

export default MediaTile;
