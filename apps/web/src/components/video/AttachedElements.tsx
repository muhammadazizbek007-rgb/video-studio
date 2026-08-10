import type { ElementRef, ResolvedMentions, VideoElementCategory } from '@video-studio/shared';
import { AlertTriangle, ImageIcon, Type } from 'lucide-react';
import { Surface } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';

/**
 * What the mentions in the prompt currently add up to.
 *
 * Attaching a photo is invisible otherwise: the user writes `@Мухаммад`, and whether that
 * became a reference image, a sentence of description or nothing at all is decided by rules
 * — slot limits, missing photos, model capability — that have to be shown rather than
 * guessed at. Every downgrade here is stated in words, because a silently dropped reference
 * only surfaces three minutes later as a video with the wrong face in it.
 */

const CATEGORY_KEYS: Record<VideoElementCategory, TranslationKey> = {
  character: 'mentions.category.character',
  location: 'mentions.category.location',
  prop: 'mentions.category.prop',
  general: 'mentions.category.general',
};

interface AttachedElementsProps {
  resolved: ResolvedMentions;
  /** Asset reference slots this model offers; 0 means photos cannot travel at all. */
  capacity: number;
}

// Named `element`, never `ref`: React claims that prop name for itself.
function Row({ element, reason }: { element: ElementRef; reason: string }) {
  const { t } = useLanguage();
  const isPhoto = element.role === 'visual';

  return (
    <li className="flex items-center gap-3">
      {element.imageUrl ? (
        <img src={element.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-current/10">
          <Type className="h-4 w-4 opacity-60" />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {isPhoto ? <ImageIcon className="h-3.5 w-3.5 opacity-60" /> : null}
          <span className="truncate">{element.name}</span>
          {isPhoto ? (
            <span className="shrink-0 rounded-md bg-current/10 px-1.5 text-xs tabular-nums">
              {element.imageIndex}
            </span>
          ) : null}
        </span>
        <span className="block truncate text-xs opacity-60">
          {t(CATEGORY_KEYS[element.category])} · {reason}
        </span>
      </span>
    </li>
  );
}

export function AttachedElements({ resolved, capacity }: AttachedElementsProps) {
  const { t } = useLanguage();

  const nothingToShow =
    resolved.refs.length === 0 &&
    resolved.unknownHandles.length === 0 &&
    !resolved.firstFrameDropped;
  if (nothingToShow) return null;

  const photoReason = t('mentions.rolePhoto');
  const textReason = (element: ElementRef): string =>
    `${t('mentions.roleText')} — ${element.imageUrl === undefined && capacity > 0 ? t('mentions.noPhoto') : capacity === 0 ? t('mentions.modelNoReferences') : t('mentions.noSlot')}`;

  return (
    <Surface className="flex flex-col gap-3 p-3" data-testid="attached-elements">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider opacity-60">
          {t('mentions.attachedTitle')}
        </span>
        {capacity > 0 ? (
          <span className="text-xs tabular-nums opacity-60">
            {t('mentions.slots', { used: resolved.assetRefs.length, total: capacity })}
          </span>
        ) : null}
      </div>

      {resolved.refs.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {resolved.assetRefs.map((element) => (
            <Row key={element.id} element={element} reason={photoReason} />
          ))}
          {resolved.textRefs.map((element) => (
            <Row key={element.id} element={element} reason={textReason(element)} />
          ))}
        </ul>
      ) : null}

      {resolved.firstFrameDropped ? (
        <p className="flex items-start gap-2 text-xs opacity-80">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t('mentions.frameDropped')}
        </p>
      ) : null}

      {resolved.unknownHandles.length > 0 ? (
        <p className="flex items-start gap-2 text-xs opacity-80">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t('mentions.unknown', { handles: resolved.unknownHandles.join(', ') })}
        </p>
      ) : null}
    </Surface>
  );
}

export default AttachedElements;
