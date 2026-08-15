import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getEnv } from '../env.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';
import { getStorage } from '../storage/index.js';
import { storageKeyFromUrl } from '../storage/mediaUrl.js';

const run = promisify(execFile);

/** Long enough for a cold ffmpeg on a busy box, short enough that a stuck one is noticed. */
const EXTRACT_TIMEOUT_MS = 30_000;

/**
 * The closing frame of a finished clip, as a picture.
 *
 * This is what chaining shots by hand is made of: the last frame of one clip becomes the
 * opening frame of the next, so the second picks up exactly where the first stopped. Veo
 * hands back an MP4 and nothing else, so the frame has to be cut out of it.
 *
 * Extracted once and kept. A clip never changes after it completes, so its last frame is
 * the same forever — re-running ffmpeg on every glance at the picker would be paying again
 * for an answer we already had.
 */

/**
 * Seeks from the end rather than to a timestamp.
 *
 * `-sseof -0.1` asks for a tenth of a second before the end, which lands on a real frame
 * even when the container's duration is slightly off — asking for the exact final timestamp
 * often lands past the last frame and produces nothing at all.
 */
const FFMPEG_ARGS = (input: string, output: string): string[] => [
  '-hide_banner',
  '-loglevel',
  'error',
  '-sseof',
  '-0.1',
  '-i',
  input,
  '-frames:v',
  '1',
  '-q:v',
  '2',
  '-y',
  output,
];

export interface ExtractedFrame {
  url: string;
  storagePath: string;
}

/**
 * Cuts the last frame out of a stored clip and keeps it beside the video.
 *
 * Works from a local path when the storage driver offers one, and falls back to writing the
 * bytes to a temporary file otherwise — ffmpeg reads files, not URLs.
 */
export async function extractLastFrame(args: {
  videoUrl: string;
  userId: string;
  generationId: string;
}): Promise<ExtractedFrame> {
  const key = storageKeyFromUrl(args.videoUrl);
  if (!key) {
    throw new ApiError('invalid-argument', 'Only a clip stored by this studio has a last frame.');
  }

  const storage = getStorage();
  const workspace = await mkdtemp(join(tmpdir(), 'vs-frame-'));
  const output = join(workspace, 'last.jpg');

  try {
    let input = storage.localPath?.(key) ?? null;

    if (!input) {
      // A remote driver keeps no local copy, so the bytes have to land somewhere ffmpeg
      // can open before it can read them.
      const response = await fetch(storage.resolveUrl(key));
      if (!response.ok) {
        throw new ApiError('unavailable', 'The clip could not be read to take its last frame.');
      }
      input = join(workspace, 'clip.mp4');
      await writeFile(input, Buffer.from(await response.arrayBuffer()));
    }

    await run(getEnv().ffmpegPath, FFMPEG_ARGS(input, output), { timeout: EXTRACT_TIMEOUT_MS });

    const stored = await storage.save({
      key: `generations/${args.userId}/${args.generationId}/last-frame.jpg`,
      data: await readFile(output),
      contentType: 'image/jpeg',
    });

    return { url: stored.url, storagePath: stored.path };
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Whether this deployment can cut frames at all. Probed once; the answer only changes on deploy. */
let availability: Promise<boolean> | null = null;

export function canExtractFrames(): Promise<boolean> {
  availability ??= run(getEnv().ffmpegPath, ['-version'], { timeout: EXTRACT_TIMEOUT_MS })
    .then(() => true)
    .catch(() => {
      logger.warn(
        { ffmpegPath: getEnv().ffmpegPath },
        'ffmpeg is not runnable — last frames cannot be extracted',
      );
      return false;
    });
  return availability;
}

/** Test seam: forgets the probe so a case can decide the answer for itself. */
export function resetFrameAvailability(): void {
  availability = null;
}
