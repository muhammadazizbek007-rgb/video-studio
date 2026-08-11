import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconButton, Spinner, Surface } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import { cn } from '@/lib/cn';
import { segmentColor, segmentTrackColor } from './palette';

type VolumeState = 'max' | 'medium' | 'mute';

const VOLUME_ORDER: Record<VolumeState, VolumeState> = {
  max: 'medium',
  medium: 'mute',
  mute: 'max',
};

const VOLUME_LEVEL: Record<VolumeState, number> = { max: 1, medium: 0.5, mute: 0 };

const VOLUME_ICON = { max: Volume2, medium: Volume1, mute: VolumeX } as const;

const VOLUME_TONE: Record<VolumeState, string> = {
  max: 'text-success',
  medium: 'text-warning',
  mute: 'text-danger',
};

/** Whole seconds with an `s` suffix, as the storyboard timeline reads them. */
function fmt(seconds: number): string {
  return `${Math.floor(Number.isFinite(seconds) && seconds > 0 ? seconds : 0)}s`;
}

export interface CinemaPlayerProps {
  /** Segment numbers that have a finished video, in playback order. */
  completedSegs: readonly string[];
  segmentVideos: Readonly<Record<string, string>>;
  segmentDurations: Readonly<Record<string, number>>;
  onDurationMeasured: (segment: string, duration: number) => void;
  onExport: () => void;
  isSaving: boolean;
  saveProgress: number;
  /**
   * The tools entry for whichever segment is on screen.
   *
   * A render prop rather than a node: only the player knows which segment is playing, and
   * only the page knows what can be done to the clip behind it. Called with undefined while
   * there is nothing to act on.
   */
  renderTools?: (segment: string | undefined) => ReactNode;
}

export function CinemaPlayer({
  completedSegs,
  segmentVideos,
  segmentDurations,
  onDurationMeasured,
  onExport,
  isSaving,
  saveProgress,
  renderTools,
}: CinemaPlayerProps) {
  const { t } = useLanguage();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  /** Set just before advancing a segment, consumed by the next element's `canplay`. */
  const pendingPlayRef = useRef(false);

  const [segIdx, setSegIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [volumeState, setVolumeState] = useState<VolumeState>('max');
  /** Mirrors `volumeState` so the remount path can read it without becoming a dependency. */
  const volumeStateRef = useRef<VolumeState>('max');
  const [barHover, setBarHover] = useState<{ pct: number; time: number } | null>(null);

  const hasVideo = completedSegs.length > 0;

  // A segment removed from under the playhead must not leave the index dangling.
  useEffect(() => {
    setSegIdx((current) => (current < completedSegs.length ? current : 0));
  }, [completedSegs.length]);

  const { totalDur, elapsedBefore, curSeg } = useMemo(() => {
    const total = completedSegs.reduce((sum, seg) => sum + (segmentDurations[seg] ?? 0), 0);
    const before = completedSegs
      .slice(0, segIdx)
      .reduce((sum, seg) => sum + (segmentDurations[seg] ?? 0), 0);
    return {
      totalDur: total,
      elapsedBefore: before,
      curSeg: completedSegs[segIdx] ?? completedSegs[0],
    };
  }, [completedSegs, segmentDurations, segIdx]);

  const totalElapsed = elapsedBefore + currentTime;

  /**
   * Applied in two places on purpose. Each segment change remounts the <video> through its
   * key, and a fresh element starts unmuted at full volume — so re-applying only when
   * `volumeState` changes would un-mute the player every time the storyboard advances.
   */
  const applyVolume = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return;
    video.muted = volumeStateRef.current === 'mute';
    video.volume = VOLUME_LEVEL[volumeStateRef.current];
  }, []);

  useEffect(() => {
    volumeStateRef.current = volumeState;
    applyVolume(videoRef.current);
  }, [volumeState, applyVolume]);

  // Escape leaves fullscreen without touching our button, so the icon follows the document.
  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const goTo = useCallback((index: number, time: number) => {
    setSegIdx(index);
    setCurrentTime(time);
    const video = videoRef.current;
    if (video) video.currentTime = time;
  }, []);

  function handleEnded() {
    if (segIdx < completedSegs.length - 1) {
      // The next <video> remounts because its key changes; `canplay` picks this up and
      // resumes playback, which is what makes the storyboard play through untouched.
      pendingPlayRef.current = true;
      setSegIdx(segIdx + 1);
      setCurrentTime(0);
      return;
    }
    setPlaying(false);
  }

  function handleCanPlay() {
    if (!pendingPlayRef.current) return;
    pendingPlayRef.current = false;
    void videoRef.current?.play().catch(() => setPlaying(false));
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => setPlaying(false));
    else video.pause();
  }

  function stepBack() {
    // Past two seconds the intent is almost always "restart this shot", not "go back one".
    if (currentTime > 2) {
      goTo(segIdx, 0);
      return;
    }
    if (segIdx > 0) {
      pendingPlayRef.current = playing;
      goTo(segIdx - 1, 0);
    }
  }

  function stepForward() {
    if (segIdx >= completedSegs.length - 1) return;
    pendingPlayRef.current = playing;
    goTo(segIdx + 1, 0);
  }

  function toggleFullscreen() {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void container.requestFullscreen().catch(() => undefined);
  }

  /** Ratio along the whole timeline → the segment that owns it, plus the offset inside it. */
  const seekToRatio = useCallback(
    (ratio: number) => {
      if (!hasVideo) return;

      if (totalDur > 0) {
        const target = ratio * totalDur;
        let elapsed = 0;
        for (const [index, seg] of completedSegs.entries()) {
          const duration = segmentDurations[seg] ?? 0;
          if (target <= elapsed + duration || index === completedSegs.length - 1) {
            pendingPlayRef.current = playing && index !== segIdx;
            goTo(index, Math.max(0, target - elapsed));
            return;
          }
          elapsed += duration;
        }
        return;
      }

      // Durations are not measured yet, so the best available granularity is the segment.
      const index = Math.min(Math.floor(ratio * completedSegs.length), completedSegs.length - 1);
      pendingPlayRef.current = playing && index !== segIdx;
      goTo(index, 0);
    },
    [completedSegs, segmentDurations, totalDur, hasVideo, goTo, playing, segIdx],
  );

  function ratioFromPointer(event: MouseEvent<HTMLDivElement>): number | null {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
  }

  function handleBarMove(event: MouseEvent<HTMLDivElement>) {
    const ratio = ratioFromPointer(event);
    if (ratio === null) return;
    setBarHover({ pct: ratio * 100, time: ratio * totalDur });
  }

  function handleBarClick(event: MouseEvent<HTMLDivElement>) {
    const ratio = ratioFromPointer(event);
    if (ratio !== null) seekToRatio(ratio);
  }

  function handleBarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!hasVideo) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      stepForward();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      stepBack();
    }
  }

  const VolumeIcon = VOLUME_ICON[volumeState];
  const volumeLabel = t(
    volumeState === 'max'
      ? 'cinema.volumeMax'
      : volumeState === 'medium'
        ? 'cinema.volumeMedium'
        : 'cinema.volumeMute',
  );

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden rounded-lg bg-surface">
      {/* A sunken well rather than a black box: depth is shadow in this system, and
          `object-contain` letterboxes against the surface exactly as it does in the studio. */}
      <Surface
        elevation="inset"
        radius="md"
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      >
        {hasVideo && curSeg ? (
          // biome-ignore lint/a11y/useMediaCaption: generated clips carry no caption track
          <video
            // Remounting on segment change is what makes swapping `src` reliable.
            key={curSeg}
            ref={(element) => {
              videoRef.current = element;
              applyVolume(element);
            }}
            src={segmentVideos[curSeg]}
            playsInline
            preload="metadata"
            aria-label={t('cinema.player')}
            className="min-h-0 w-full flex-1 self-stretch object-contain"
            onClick={togglePlay}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => {
              const measured = event.currentTarget.duration;
              if (Number.isFinite(measured)) onDurationMeasured(curSeg, measured);
            }}
            onCanPlay={handleCanPlay}
            onEnded={handleEnded}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        ) : (
          <p className="px-6 py-10 text-center text-sm text-text-subtle">{t('cinema.empty')}</p>
        )}
      </Surface>

      <div className="flex flex-col gap-3 px-4 pb-3 pt-3">
        {/* One pill per segment, so a native range input cannot express it. */}
        <div
          ref={barRef}
          role="slider"
          tabIndex={hasVideo ? 0 : -1}
          aria-label={t('cinema.timeline')}
          aria-valuemin={0}
          aria-valuemax={Math.round(totalDur)}
          aria-valuenow={Math.round(totalElapsed)}
          aria-valuetext={`${fmt(totalElapsed)} / ${fmt(totalDur)}`}
          aria-disabled={!hasVideo}
          onMouseMove={handleBarMove}
          onMouseLeave={() => setBarHover(null)}
          onClick={handleBarClick}
          onKeyDown={handleBarKeyDown}
          className={cn(
            'relative flex h-4 gap-1.5 select-none',
            hasVideo ? 'cursor-pointer' : 'cursor-default',
            'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent',
          )}
        >
          {hasVideo ? (
            completedSegs.map((seg, index) => {
              const duration = segmentDurations[seg] ?? 0;
              const width = totalDur > 0 ? (duration / totalDur) * 100 : 100 / completedSegs.length;
              const fill =
                index < segIdx
                  ? 100
                  : index > segIdx
                    ? 0
                    : duration > 0
                      ? Math.min((currentTime / duration) * 100, 100)
                      : 0;
              return (
                <div
                  key={seg}
                  className="h-full shrink-0 overflow-hidden rounded-full"
                  style={{
                    width: `${width}%`,
                    minWidth: 8,
                    backgroundColor: segmentTrackColor(index),
                  }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${fill}%`,
                      backgroundColor: segmentColor(index),
                      transition: 'width 0.25s linear',
                    }}
                  />
                </div>
              );
            })
          ) : (
            <div className="h-full w-full rounded-full bg-surface shadow-neu-inset-sm" />
          )}

          {barHover && hasVideo ? (
            <>
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-0.5 rounded-full bg-text-primary/70"
                style={{ left: `${barHover.pct}%` }}
              />
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-full mb-1.5 -translate-x-1/2 rounded-sm bg-surface px-2 py-0.5 text-xs font-medium text-text-primary shadow-neu-raised-sm"
                style={{ left: `${barHover.pct}%` }}
              >
                {fmt(barHover.time)}
              </span>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs tabular-nums text-text-subtle">
            {fmt(totalElapsed)}
          </span>

          <div className="flex flex-1 items-center justify-center gap-4">
            <IconButton
              size="sm"
              round
              label={t('cinema.back')}
              icon={<ChevronLeft />}
              disabled={!hasVideo}
              onClick={stepBack}
            />
            <IconButton
              size="md"
              round
              variant="primary"
              label={playing ? t('player.pause') : t('player.play')}
              icon={playing ? <Pause /> : <Play className="translate-x-px" />}
              disabled={!hasVideo}
              onClick={togglePlay}
            />
            <IconButton
              size="sm"
              round
              label={t('cinema.forward')}
              icon={<ChevronRight />}
              disabled={!hasVideo || segIdx >= completedSegs.length - 1}
              onClick={stepForward}
            />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <IconButton
              size="sm"
              label={volumeLabel}
              icon={<VolumeIcon className={VOLUME_TONE[volumeState]} />}
              disabled={!hasVideo}
              onClick={() => setVolumeState(VOLUME_ORDER[volumeState])}
            />
            <IconButton
              size="sm"
              label={fullscreen ? t('player.exitFullscreen') : t('player.fullscreen')}
              icon={fullscreen ? <Minimize2 /> : <Maximize2 />}
              disabled={!hasVideo}
              onClick={toggleFullscreen}
            />
            {renderTools?.(hasVideo ? curSeg : undefined)}
            <Button
              size="sm"
              variant="secondary"
              disabled={!hasVideo || isSaving}
              onClick={onExport}
              icon={isSaving ? <Spinner size="sm" /> : <Download className="size-4" />}
            >
              {isSaving ? `${t('cinema.exporting')} ${saveProgress}%` : t('cinema.export')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CinemaPlayer;
