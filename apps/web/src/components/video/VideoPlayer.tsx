import {
  Download,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ChangeEvent, KeyboardEvent, PointerEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton, Slider, Tooltip } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import type { Language } from '@/i18n/translations';

const SEEK_STEP_SECONDS = 5;
const VOLUME_STEP = 0.1;

type ControlKey = 'play' | 'pause' | 'seek' | 'volume' | 'mute' | 'unmute' | 'full' | 'exitFull';

/**
 * Media-control copy the shared dictionary does not carry yet; it lives here so the player still
 * speaks the user's language, and it should move into i18n/translations.ts once keys exist.
 */
const CONTROL_LABELS: Record<Language, Record<ControlKey, string>> = {
  ru: {
    play: 'Воспроизвести',
    pause: 'Пауза',
    seek: 'Перемотка',
    volume: 'Громкость',
    mute: 'Выключить звук',
    unmute: 'Включить звук',
    full: 'Во весь экран',
    exitFull: 'Выйти из полноэкранного режима',
  },
  uz: {
    play: 'Ijro etish',
    pause: 'Pauza',
    seek: 'Oldinga o‘tkazish',
    volume: 'Ovoz balandligi',
    mute: 'Ovozni o‘chirish',
    unmute: 'Ovozni yoqish',
    full: 'To‘liq ekran',
    exitFull: 'To‘liq ekrandan chiqish',
  },
  en: {
    play: 'Play',
    pause: 'Pause',
    seek: 'Seek',
    volume: 'Volume',
    mute: 'Mute',
    unmute: 'Unmute',
    full: 'Fullscreen',
    exitFull: 'Exit fullscreen',
  },
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

interface VideoPlayerProps {
  src: string;
  poster?: string;
  downloadName?: string;
}

export function VideoPlayer({ src, poster, downloadName }: VideoPlayerProps) {
  const { language, t } = useLanguage();
  const labels = CONTROL_LABELS[language];

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const limit = Number.isFinite(video.duration) ? video.duration : 0;
    const next = Math.min(Math.max(seconds, 0), limit);
    video.currentTime = next;
    setCurrentTime(next);
  }, []);

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      const video = videoRef.current;
      if (!bar || !video || !Number.isFinite(video.duration)) return;
      const rect = bar.getBoundingClientRect();
      if (rect.width === 0) return;
      const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      seekTo(ratio * video.duration);
    },
    [seekTo],
  );

  function handleBarPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setScrubbing(true);
    seekFromPointer(event.clientX);
  }

  function handleBarPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!scrubbing) return;
    seekFromPointer(event.clientX);
  }

  function handleBarPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setScrubbing(false);
  }

  const toggleMute = useCallback(() => setMuted((value) => !value), []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void container.requestFullscreen().catch(() => undefined);
    }
  }, []);

  const changeVolume = useCallback((next: number) => {
    const clamped = Math.min(Math.max(next, 0), 1);
    setVolume(clamped);
    setMuted(clamped === 0);
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const video = videoRef.current;
    if (!video) return;
    switch (event.key) {
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        togglePlay();
        break;
      case 'ArrowRight':
        event.preventDefault();
        seekTo(video.currentTime + SEEK_STEP_SECONDS);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        seekTo(video.currentTime - SEEK_STEP_SECONDS);
        break;
      case 'ArrowUp':
        event.preventDefault();
        changeVolume(volume + VOLUME_STEP);
        break;
      case 'ArrowDown':
        event.preventDefault();
        changeVolume(volume - VOLUME_STEP);
        break;
      case 'm':
      case 'M':
      case 'ь':
      case 'Ь':
        event.preventDefault();
        toggleMute();
        break;
      case 'f':
      case 'F':
      case 'а':
      case 'А':
        event.preventDefault();
        toggleFullscreen();
        break;
      default:
        break;
    }
  }

  function syncBuffered() {
    const video = videoRef.current;
    if (!video || video.buffered.length === 0 || !Number.isFinite(video.duration)) return;
    setBuffered(video.buffered.end(video.buffered.length - 1) / video.duration);
  }

  const progress = duration > 0 ? currentTime / duration : 0;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a media player is a composite widget, not a fieldset; the group role is what gives its controls a shared accessible name
    <div
      ref={containerRef}
      role="group"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the player owns keyboard shortcuts (space, arrows, M, F), so the container must be focusable
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={t('studio.result')}
      className="overflow-hidden rounded-lg bg-surface shadow-neu-raised"
    >
      {/* biome-ignore lint/a11y/useMediaCaption: generated clips carry no caption track */}
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        preload="metadata"
        className="aspect-video w-full bg-surface object-contain"
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onProgress={syncBuffered}
        onEnded={() => setPlaying(false)}
      />

      <div className="flex flex-col gap-2 p-field">
        <div
          ref={barRef}
          role="slider"
          tabIndex={-1}
          aria-label={labels.seek}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
          onPointerDown={handleBarPointerDown}
          onPointerMove={handleBarPointerMove}
          onPointerUp={handleBarPointerUp}
          onPointerCancel={handleBarPointerUp}
          className="relative h-5 cursor-pointer touch-none select-none py-2"
        >
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface shadow-neu-inset-sm">
            <div
              className="h-full rounded-full bg-text-subtle/40"
              style={{ width: `${Math.min(buffered, 1) * 100}%` }}
            />
          </div>
          <div
            className="pointer-events-none absolute inset-y-2 left-0 h-1.5 rounded-full bg-accent"
            style={{ width: `${progress * 100}%` }}
          />
          <div
            className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface shadow-neu-raised-sm"
            style={{ left: `${progress * 100}%` }}
          />
        </div>

        <div className="flex items-center gap-2">
          <IconButton
            size="sm"
            label={playing ? labels.pause : labels.play}
            icon={playing ? <Pause /> : <Play />}
            onClick={togglePlay}
          />

          <span className="text-xs tabular-nums text-text-muted">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <IconButton
              size="sm"
              label={muted ? labels.unmute : labels.mute}
              icon={<VolumeIcon />}
              onClick={toggleMute}
            />
            <div className="hidden w-24 sm:block">
              <Slider
                aria-label={labels.volume}
                min={0}
                max={100}
                step={5}
                value={Math.round((muted ? 0 : volume) * 100)}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  changeVolume(Number(event.target.value) / 100)
                }
              />
            </div>
            <IconButton
              size="sm"
              label={fullscreen ? labels.exitFull : labels.full}
              icon={fullscreen ? <Minimize2 /> : <Maximize2 />}
              onClick={toggleFullscreen}
            />
            <Tooltip content={t('common.download')}>
              <a
                href={src}
                download={downloadName ?? ''}
                aria-label={t('common.download')}
                className="inline-flex size-9 items-center justify-center rounded-sm bg-surface text-text-muted shadow-neu-raised-sm hover:text-text-primary [&_svg]:size-4"
              >
                <Download />
              </a>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VideoPlayer;
