import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getEnv } from '../env.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';
import { getStorage } from '../storage/index.js';

const run = promisify(execFile);

const PROBE_TIMEOUT_MS = 5_000;
const STITCH_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_BUFFER = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;

let availability: Promise<boolean> | null = null;

/**
 * Whether this deployment can stitch server-side. Probed once and cached: the answer only
 * changes when the image changes, and the browser has a working fallback either way.
 */
export function isStitchingAvailable(): Promise<boolean> {
  availability ??= run(getEnv().ffmpegPath, ['-version'], { timeout: PROBE_TIMEOUT_MS })
    .then(() => true)
    .catch(() => {
      logger.warn(
        { ffmpegPath: getEnv().ffmpegPath },
        'ffmpeg is not runnable — storyboard exports will fall back to the browser',
      );
      return false;
    });
  return availability;
}

export function resetStitchingProbe(): void {
  availability = null;
}

/**
 * Turns a media URL back into the storage key it was built from.
 *
 * Only URLs this deployment served can be mapped, which is the point: a key is what
 * unlocks the filesystem shortcut, and anything we did not serve has to be downloaded
 * like any other remote file.
 */
export function storageKeyFromUrl(url: string): string | null {
  const base = getEnv().mediaPublicBaseUrl.replace(/\/+$/, '');
  const withoutOrigin = url.replace(/^https?:\/\/[^/]+/, '');
  const prefix = `${base}/`;
  if (!withoutOrigin.startsWith(prefix)) return null;
  const key = withoutOrigin.slice(prefix.length).split('?')[0] ?? '';
  return key === '' ? null : decodeURIComponent(key);
}

async function materialise(url: string, directory: string, index: number): Promise<string> {
  const key = storageKeyFromUrl(url);
  if (key) {
    const local = getStorage().localPath?.(key);
    if (local) return local;
  }

  const target = join(directory, `input-${index}.mp4`);
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) }).catch(
    () => {
      throw new ApiError('invalid-argument', `Could not fetch segment ${index + 1} for export.`);
    },
  );
  if (!response.ok) {
    throw new ApiError(
      'invalid-argument',
      `Could not fetch segment ${index + 1} for export (HTTP ${response.status}).`,
    );
  }
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

/** ffmpeg's concat list format: one `file '<path>'` per line, single quotes escaped. */
function concatList(paths: readonly string[]): string {
  return `${paths.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join('\n')}\n`;
}

async function ffmpeg(args: readonly string[]): Promise<void> {
  await run(getEnv().ffmpegPath, [...args], {
    timeout: STITCH_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BUFFER,
  });
}

export interface StitchOutcome {
  url: string;
  path: string;
  bytes: number;
  /** True when the inputs had to be re-encoded rather than copied through untouched. */
  reEncoded: boolean;
}

/**
 * Concatenates finished segments into one MP4.
 *
 * The fast path copies the streams verbatim, which is instant and lossless — it works
 * because every segment of a storyboard comes from the same model at the same resolution.
 * A manually uploaded clip can break that assumption, so a failure falls back to a real
 * re-encode instead of surfacing ffmpeg's rather unhelpful diagnostics to the user.
 */
export async function stitchSegments(args: {
  userId: string;
  storyboardId: string;
  videoUrls: readonly string[];
}): Promise<StitchOutcome> {
  if (args.videoUrls.length === 0) {
    throw new ApiError('invalid-argument', 'There are no finished segments to export.');
  }
  if (!(await isStitchingAvailable())) {
    throw new ApiError('unavailable', 'Server-side stitching is not available on this deployment.');
  }

  const workspace = await mkdtemp(join(tmpdir(), 'vs-stitch-'));
  try {
    const inputs: string[] = [];
    for (const [index, url] of args.videoUrls.entries()) {
      inputs.push(await materialise(url, workspace, index));
    }

    const listPath = join(workspace, 'inputs.txt');
    await writeFile(listPath, concatList(inputs), 'utf8');

    const outputPath = join(workspace, 'output.mp4');
    const common = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath];
    // faststart moves the index to the front so the result streams rather than
    // downloading in full before the first frame appears.
    const tail = ['-movflags', '+faststart', outputPath];

    let reEncoded = false;
    try {
      await ffmpeg([...common, '-c', 'copy', ...tail]);
    } catch (error) {
      logger.info(
        { err: error, storyboardId: args.storyboardId },
        'stream copy failed, re-encoding the export',
      );
      reEncoded = true;
      await ffmpeg([
        ...common,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        ...tail,
      ]);
    }

    const data = await readFile(outputPath);
    const stored = await getStorage().save({
      // A fresh id per export so a cached URL never serves the previous cut.
      key: `exports/${args.userId}/${args.storyboardId}/${randomUUID()}.mp4`,
      data,
      contentType: 'video/mp4',
    });

    return { url: stored.url, path: stored.path, bytes: stored.bytes, reEncoded };
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}
