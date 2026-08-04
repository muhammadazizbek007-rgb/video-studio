/**
 * Concatenates finished segments into one downloadable file, in the browser.
 *
 * There is no server-side muxer, so the only way to join clips is to replay them into a
 * canvas and record that canvas. Two consequences follow and neither is avoidable here:
 * the export runs in real time (three 8-second segments take 24 seconds), and the output
 * is WebM rather than MP4.
 *
 * The audio graph is the part worth reading. `captureStream()` on a canvas yields a video
 * track and nothing else, so a naive implementation silently drops the soundtrack — which
 * matters, because Veo 3.x generates audio. Routing the shared <video> element through a
 * MediaElementAudioSourceNode into a MediaStreamAudioDestinationNode gives an audio track
 * to record alongside it. That node is also why the element must NOT be muted: muting
 * silences the graph, not just the speakers. Playback stays inaudible anyway because the
 * source is never connected to `ctx.destination`.
 */

const FRAME_RATE = 30;

const PREFERRED_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export interface StitchResult {
  blob: Blob;
  mimeType: string;
  /** False when the browser gave us no audio track — the caller may want to say so. */
  hasAudio: boolean;
}

export interface StitchOptions {
  /** Segment URLs, already in playback order. */
  urls: readonly string[];
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export class StitchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StitchError';
  }
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') {
    throw new StitchError('This browser cannot record video (MediaRecorder is unavailable).');
  }
  const supported = PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
  if (!supported) throw new StitchError('This browser supports no WebM recording format.');
  return supported;
}

function loadSegment(video: HTMLVideoElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new StitchError(`Could not load a segment for export: ${url}`));
    };
    function cleanup() {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    }
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
    video.src = url;
    video.load();
  });
}

/** Plays one segment to its end, painting every frame into the canvas as it goes. */
function playSegmentIntoCanvas(
  video: HTMLVideoElement,
  draw: () => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let frame = 0;

    function stop() {
      if (frame !== 0) cancelAnimationFrame(frame);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    }

    function tick() {
      if (video.ended || video.paused) return;
      draw();
      frame = requestAnimationFrame(tick);
    }

    function onEnded() {
      // One last paint so the final frame is not missing from the recording.
      draw();
      stop();
      resolve();
    }

    function onError() {
      stop();
      reject(new StitchError('A segment failed while it was being recorded.'));
    }

    function onAbort() {
      video.pause();
      stop();
      reject(new StitchError('The export was cancelled.'));
    }

    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort);

    video.currentTime = 0;
    video
      .play()
      .then(() => {
        frame = requestAnimationFrame(tick);
      })
      .catch((error: unknown) => {
        stop();
        reject(
          error instanceof Error
            ? new StitchError(`Playback was blocked during export: ${error.message}`)
            : new StitchError('Playback was blocked during export.'),
        );
      });
  });
}

export async function stitchSegments({
  urls,
  onProgress,
  signal,
}: StitchOptions): Promise<StitchResult> {
  if (urls.length === 0) throw new StitchError('There is nothing to export.');

  const mimeType = pickMimeType();

  const video = document.createElement('video');
  // Same-origin in both dev (Vite proxies /media) and production (nginx fronts both), but
  // declaring it keeps the canvas untainted if media ever moves to its own host.
  video.crossOrigin = 'anonymous';
  video.playsInline = true;
  video.preload = 'auto';
  video.muted = false;
  video.volume = 1;

  const first = urls[0];
  if (!first) throw new StitchError('There is nothing to export.');
  await loadSegment(video, first);

  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new StitchError('This browser refused a 2D canvas for the export.');

  const canvasStream = canvas.captureStream(FRAME_RATE);
  const tracks = [...canvasStream.getVideoTracks()];

  // Audio is best-effort: a browser without Web Audio still gets a silent export rather
  // than no export at all.
  let audioContext: AudioContext | undefined;
  try {
    audioContext = new AudioContext();
    const source = audioContext.createMediaElementSource(video);
    const destination = audioContext.createMediaStreamDestination();
    source.connect(destination);
    tracks.push(...destination.stream.getAudioTracks());
  } catch {
    audioContext = undefined;
  }

  const hasAudio = tracks.some((track) => track.kind === 'audio');
  const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const draw = () => context.drawImage(video, 0, 0, width, height);

  try {
    if (audioContext?.state === 'suspended') await audioContext.resume();

    recorder.start(100);
    onProgress?.(0);

    for (const [index, url] of urls.entries()) {
      signal?.throwIfAborted();
      // The first segment is already loaded from the sizing pass above.
      if (index > 0) await loadSegment(video, url);
      await playSegmentIntoCanvas(video, draw, signal);
      onProgress?.(Math.round(((index + 1) / urls.length) * 100));
    }

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await stopped;

    return { blob: new Blob(chunks, { type: mimeType }), mimeType, hasAudio };
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
    video.pause();
    video.removeAttribute('src');
    video.load();
    for (const track of tracks) track.stop();
    await audioContext?.close().catch(() => undefined);
  }
}

/** Hands a finished blob to the browser as a download, then releases the object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
