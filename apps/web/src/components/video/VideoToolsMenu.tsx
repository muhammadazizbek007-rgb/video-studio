import { ChevronRight, Crop, Eraser, Plus, Sparkles, StepForward, Wand2 } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { IconButton, Surface, Tooltip } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { cn } from '@/lib/cn';

export type VideoTool = 'extend' | 'removeObject' | 'insertObject' | 'outpaint' | 'upscale';

/** Breathing room kept between the panel and the edge of the window. */
const VIEWPORT_MARGIN = 12;
/** Below this a panel is not worth opening at all, so it scrolls rather than shrinking further. */
const MIN_PANEL_HEIGHT = 160;

interface ToolSpec {
  id: VideoTool;
  label: TranslationKey;
  hint: TranslationKey;
  Icon: typeof Sparkles;
}

/**
 * Continuation first: it is the one people come here for, and the only one that changes what
 * the clip *is* rather than how it looks.
 */
const TOOLS: readonly ToolSpec[] = [
  { id: 'extend', label: 'tools.extend', hint: 'tools.extendHint', Icon: StepForward },
  { id: 'removeObject', label: 'tools.removeObject', hint: 'tools.removeObjectHint', Icon: Eraser },
  { id: 'insertObject', label: 'tools.insertObject', hint: 'tools.insertObjectHint', Icon: Plus },
  { id: 'outpaint', label: 'tools.outpaint', hint: 'tools.outpaintHint', Icon: Crop },
  { id: 'upscale', label: 'tools.upscale', hint: 'tools.upscaleHint', Icon: Wand2 },
];

export interface VideoToolsMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (tool: VideoTool) => void;
  /** Tools the current clip or model cannot do. Shown, but dimmed and unclickable. */
  unavailable?: readonly VideoTool[];
  busyTool?: VideoTool | null;
}

/**
 * One button rather than five icons.
 *
 * The player's control row is already carrying play, time, volume, fullscreen and download,
 * and on a phone it wraps at that. Five more icons would push it to two lines and leave
 * every one of them unlabelled — which for "remove an object" and "extend the frame" is not
 * a guess anyone should have to make. A single labelled entry keeps the row intact and gives
 * each tool the sentence it needs.
 */
export function VideoToolsMenu({
  open,
  onOpenChange,
  onPick,
  unavailable = [],
  busyTool = null,
}: VideoToolsMenuProps) {
  const { t } = useLanguage();
  const menuId = useId();
  const anchorRef = useRef<HTMLDivElement | null>(null);

  // Opening upward is the right default — the button lives in a control row at the bottom of
  // the player — but it is only a default. With the player low on the page there is no room
  // above, and a panel anchored upward simply runs off the top: the heading disappears and
  // the first item is sliced in half, which is how this shipped.
  const [placement, setPlacement] = useState<'up' | 'down'>('up');
  const [maxHeight, setMaxHeight] = useState<number>();

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const above = rect.top - VIEWPORT_MARGIN;
    const below = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
    const goesUp = above >= below;

    setPlacement(goesUp ? 'up' : 'down');
    // Whichever way it opens, it stops at the edge of the window and scrolls inside itself.
    // A clipped item is unreachable; a scrolled one is merely further down.
    setMaxHeight(Math.max(MIN_PANEL_HEIGHT, Math.floor(goesUp ? above : below)));
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    // Anchored to a button that scrolls with the page, so staying open through a scroll
    // means drifting away from what opened it and over whatever is above.
    const onScroll = () => onOpenChange(false);

    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [open, onOpenChange]);

  return (
    <div ref={anchorRef} className="relative">
      <Tooltip content={t('tools.title')}>
        <IconButton
          size="sm"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          label={t('tools.title')}
          icon={<Sparkles />}
          onClick={() => onOpenChange(!open)}
        />
      </Tooltip>

      {open ? (
        <>
          {/* Sibling, not parent: an outside click must not fall through to the panel. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => onOpenChange(false)}
          />
          <Surface
            id={menuId}
            role="menu"
            aria-label={t('tools.title')}
            elevation="raised-lg"
            radius="md"
            style={maxHeight === undefined ? undefined : { maxHeight }}
            className={cn(
              'absolute right-0 z-50 w-72 animate-neu-pop-in overflow-y-auto py-1',
              placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2',
            )}
          >
            <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-text-subtle">
              {t('tools.title')}
            </p>

            {TOOLS.map((tool) => {
              const blocked = unavailable.includes(tool.id);
              return (
                <button
                  key={tool.id}
                  type="button"
                  role="menuitem"
                  disabled={blocked || busyTool !== null}
                  onClick={() => {
                    onPick(tool.id);
                    onOpenChange(false);
                  }}
                  className={cn(
                    'flex w-full items-start gap-2.5 px-3 py-2 text-left',
                    'transition-colors duration-[120ms]',
                    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                    blocked
                      ? 'cursor-not-allowed opacity-45'
                      : 'text-text-muted hover:text-text-primary',
                  )}
                >
                  <tool.Icon className="mt-0.5 size-4 shrink-0 opacity-70" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{t(tool.label)}</span>
                    <span className="block text-[11px] leading-tight text-text-subtle">
                      {t(tool.hint)}
                    </span>
                  </span>
                  {!blocked && busyTool === null ? (
                    <ChevronRight className="mt-0.5 size-4 shrink-0 opacity-40" aria-hidden />
                  ) : null}
                </button>
              );
            })}
          </Surface>
        </>
      ) : null}
    </div>
  );
}

export default VideoToolsMenu;
