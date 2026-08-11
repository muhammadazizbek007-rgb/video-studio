import { ChevronRight, Crop, Eraser, Plus, Sparkles, StepForward, Wand2 } from 'lucide-react';
import { useId } from 'react';
import { IconButton, Surface, Tooltip } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { cn } from '@/lib/cn';

export type VideoTool = 'extend' | 'removeObject' | 'insertObject' | 'outpaint' | 'upscale';

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

  return (
    <div className="relative">
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
            className="absolute bottom-full right-0 z-50 mb-2 w-72 animate-neu-pop-in overflow-hidden py-1"
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
