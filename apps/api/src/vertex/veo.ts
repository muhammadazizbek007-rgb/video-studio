import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { VeoModelSpec } from '@video-studio/shared';
import {
  assetReferenceCapacity,
  requireVeoModel,
  resolveAspectRatio,
  resolveDuration,
} from '@video-studio/shared';
import { getEnv } from '../env.js';
import { ApiError } from '../errors.js';
import { buildNegativePrompt, buildVeoPrompt } from '../prompt.js';
import { getStorage } from '../storage/index.js';
import { absoluteMediaUrl, storageKeyFromUrl } from '../storage/mediaUrl.js';
import { callVertex, getAccessToken } from './client.js';
import { checkFakeVeoOperation, startFakeVeoOperation } from './fake.js';

/**
 * Veo generation is a long-running operation, so it is split in two: the caller starts it
 * and then polls. The finished video is copied into our own storage because the Vertex
 * payload is either inline bytes or a short-lived GCS object, neither of which the
 * frontend can hold on to.
 */

export interface VeoStartInput {
  generationId: string;
  userId: string;
  prompt: string;
  modelId: string;
  aspectRatio: string;
  duration: number;
  stylePreset: string;
  cameraMotion: string;
  /** The opening frame Veo animates. One image, and the video literally starts on it. */
  firstFrameImageUrl?: string;
  /**
   * Photos of mentioned elements. These are not frames of the video: they tell Veo what a
   * character, location or prop looks like, and the model composes its own shot from them.
   */
  assetReferenceUrls?: string[];
  lastFrameImageUrl?: string;
}

export type VeoPollResult =
  | { status: 'processing' }
  | { status: 'completed'; videoUrl: string; storagePath: string }
  | { status: 'failed'; error: string };

interface InlineImage {
  bytesBase64Encoded: string;
  mimeType: string;
}

const DEFAULT_IMAGE_MIME_TYPE = 'image/jpeg';
const DATA_URL_PATTERN = /^data:([^;,]+)?(;base64)?,(.*)$/s;
const GCS_URI_PATTERN = /^gs:\/\/([^/]+)\/(.+)$/;

const DOWNLOAD_TIMEOUT_MS = 20_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function baseMimeType(contentType: string): string {
  return (contentType.split(';')[0] ?? '').trim().toLowerCase();
}

/**
 * Percent-encoded binary is not valid UTF-8, and decodeURIComponent throws a bare URIError
 * on it — which would surface as a 500 for malformed client input.
 */
function percentEncodedToBase64(payload: string): string {
  try {
    return Buffer.from(decodeURIComponent(payload), 'utf8').toString('base64');
  } catch {
    throw new ApiError('invalid-argument', 'Reference image data URL is malformed.');
  }
}

async function* streamOf(response: Response): AsyncGenerator<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * The URL comes from the client, so the fetch needs its own bounds: without a deadline a
 * trickling response never settles (undici's body timeout resets on every chunk), and
 * without a size cap an endless stream exhausts memory.
 */
async function downloadImage(url: string, what: string): Promise<InlineImage> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) }).catch(
    (err: unknown) => {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'failed';
      throw new ApiError('invalid-argument', `Downloading the ${what} ${reason}.`);
    },
  );

  if (!response.ok) {
    throw new ApiError(
      'invalid-argument',
      `Failed to download the ${what} (HTTP ${response.status}).`,
    );
  }

  const contentType = baseMimeType(response.headers.get('content-type') ?? '');
  if (!contentType.startsWith('image/')) {
    throw new ApiError(
      'invalid-argument',
      `The ${what} is not an image (content type: ${contentType || 'unknown'}).`,
    );
  }

  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw new ApiError(
      'invalid-argument',
      `The ${what} exceeds the ${MAX_IMAGE_BYTES} byte limit.`,
    );
  }

  // content-length is advisory, so the real cap is enforced while streaming.
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of streamOf(response)) {
    total += chunk.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      throw new ApiError(
        'invalid-argument',
        `The ${what} exceeds the ${MAX_IMAGE_BYTES} byte limit.`,
      );
    }
    chunks.push(chunk);
  }

  return { bytesBase64Encoded: Buffer.concat(chunks).toString('base64'), mimeType: contentType };
}

const EXTENSION_MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
});

/**
 * Reads an image this deployment stored, straight off the disk.
 *
 * `MEDIA_PUBLIC_BASE_URL` is `/media` — right for the browser, which shares an origin with
 * the API, and fatal here: `fetch('/media/...')` is a parse error in Node, not a relative
 * request. Every element photo and uploaded frame is one of ours, so the common case never
 * touches the network at all; anything we did not serve falls through to a real download.
 */
async function readStoredImage(url: string): Promise<InlineImage | null> {
  const key = storageKeyFromUrl(url);
  if (!key) return null;

  const path = getStorage().localPath?.(key);
  if (!path) return null;

  const data = await readFile(path).catch(() => null);
  if (!data) return null;

  if (data.byteLength > MAX_IMAGE_BYTES) {
    throw new ApiError(
      'invalid-argument',
      `A reference image exceeds the ${MAX_IMAGE_BYTES} byte limit.`,
    );
  }

  return {
    bytesBase64Encoded: data.toString('base64'),
    mimeType: EXTENSION_MIME_TYPES[extname(key).toLowerCase()] ?? DEFAULT_IMAGE_MIME_TYPE,
  };
}

/** Veo accepts reference images only as inline base64, never as a URL. */
async function toInlineImage(imageUrl: string, what: string): Promise<InlineImage> {
  const url = imageUrl.trim();

  if (url.startsWith('data:')) {
    const match = DATA_URL_PATTERN.exec(url);
    if (!match) throw new ApiError('invalid-argument', `The ${what} data URL is malformed.`);

    const [, declaredMime, isBase64, payload = ''] = match;
    const mimeType = baseMimeType(declaredMime ?? DEFAULT_IMAGE_MIME_TYPE);
    if (!mimeType.startsWith('image/')) {
      throw new ApiError('invalid-argument', `The ${what} data URL is not an image.`);
    }

    const bytesBase64Encoded = isBase64 ? payload : percentEncodedToBase64(payload);
    if (Buffer.byteLength(bytesBase64Encoded, 'base64') > MAX_IMAGE_BYTES) {
      throw new ApiError(
        'invalid-argument',
        `The ${what} exceeds the ${MAX_IMAGE_BYTES} byte limit.`,
      );
    }
    return { bytesBase64Encoded, mimeType };
  }

  const stored = await readStoredImage(url);
  if (stored) return stored;

  const absolute = absoluteMediaUrl(url);
  if (!absolute) {
    throw new ApiError('invalid-argument', `The ${what} has no usable location.`);
  }
  return downloadImage(absolute, what);
}

async function buildInstance(
  input: VeoStartInput,
  spec: VeoModelSpec,
): Promise<Record<string, unknown>> {
  const firstFrameUrl = input.firstFrameImageUrl?.trim() || undefined;

  const instance: Record<string, unknown> = {
    prompt: buildVeoPrompt({
      prompt: input.prompt,
      stylePreset: input.stylePreset,
      cameraMotion: input.cameraMotion,
      hasReferenceImage: Boolean(firstFrameUrl),
      supportsAudio: spec.supportsAudio,
    }),
  };

  if (firstFrameUrl) {
    if (!spec.supportsImageToVideo) {
      throw new ApiError('invalid-argument', `${spec.id} does not support image-to-video.`);
    }
    instance.image = await toInlineImage(firstFrameUrl, 'first frame image');
  }

  // Asset references are what makes "@Мухаммад" mean something: Veo is handed the saved
  // photo and told to keep that subject's appearance. The cap is the model's, not ours —
  // sending a fourth is rejected outright rather than ignored.
  const assetUrls = (input.assetReferenceUrls ?? [])
    .map((url) => url.trim())
    .filter((url) => url !== '')
    .slice(0, assetReferenceCapacity(spec));

  if (assetUrls.length > 0) {
    instance.referenceImages = await Promise.all(
      assetUrls.map(async (url, index) => ({
        image: await toInlineImage(url, `reference image ${index + 1}`),
        referenceType: 'asset',
      })),
    );
  }

  if (input.lastFrameImageUrl && spec.supportsLastFrame) {
    instance.lastFrame = await toInlineImage(input.lastFrameImageUrl, 'last frame image');
  }

  return instance;
}

/** The registry signals unusable input with a plain Error; the API answers with a 400. */
function rejectAsInvalidArgument(err: unknown): never {
  throw new ApiError('invalid-argument', err instanceof Error ? err.message : String(err));
}

/**
 * Model and aspect-ratio validation happens before the fake driver takes over so the
 * offline path rejects exactly what the live one would.
 */
export async function startVeoOperation(
  input: VeoStartInput,
): Promise<{ operationName: string; vertexModel: string }> {
  const spec = ((): VeoModelSpec => {
    try {
      return requireVeoModel(input.modelId);
    } catch (err) {
      return rejectAsInvalidArgument(err);
    }
  })();

  const aspectRatio = ((): string => {
    try {
      return resolveAspectRatio(spec, input.aspectRatio);
    } catch (err) {
      return rejectAsInvalidArgument(err);
    }
  })();

  const duration = resolveDuration(spec, input.duration);

  if (getEnv().fakeVertex) {
    return startFakeVeoOperation({
      generationId: input.generationId,
      userId: input.userId,
      prompt: input.prompt,
      vertexModel: spec.vertexModel,
      aspectRatio,
      duration,
    });
  }

  const parameters: Record<string, unknown> = {
    aspectRatio,
    durationSeconds: duration,
    sampleCount: 1,
    resolution: spec.maxResolution,
    personGeneration: 'allow_adult',
    negativePrompt: buildNegativePrompt(input.cameraMotion),
  };
  if (spec.supportsAudio) parameters.generateAudio = true;

  const payload = await callVertex<Record<string, unknown>>(
    spec.vertexModel,
    ':predictLongRunning',
    { instances: [await buildInstance(input, spec)], parameters },
  );

  const operationName = asNonEmptyString(payload.name);
  if (!operationName) {
    throw new ApiError('internal', 'Veo accepted the request but returned no operation name.');
  }

  return { operationName, vertexModel: spec.vertexModel };
}

interface VideoRef {
  base64: string | null;
  uri: string | null;
  mimeType: string;
}

/** The payload shape moved between Veo versions, so both spellings are accepted. */
function readVideoRef(sample: unknown): VideoRef | null {
  const record = asRecord(sample);
  if (!record) return null;

  const nested = asRecord(record.video);
  const source = nested ?? record;

  const base64 = asNonEmptyString(source.bytesBase64Encoded);
  const uri = asNonEmptyString(source.gcsUri) ?? asNonEmptyString(source.uri);
  if (!base64 && !uri) return null;

  return { base64, uri, mimeType: asNonEmptyString(source.mimeType) ?? 'video/mp4' };
}

async function downloadVideo(ref: VideoRef): Promise<Buffer> {
  if (ref.base64) return Buffer.from(ref.base64, 'base64');

  const uri = ref.uri ?? '';
  const gcs = GCS_URI_PATTERN.exec(uri);
  const downloadUrl = gcs
    ? `https://storage.googleapis.com/storage/v1/b/${gcs[1] ?? ''}/o/${encodeURIComponent(gcs[2] ?? '')}?alt=media`
    : uri;

  if (!downloadUrl.startsWith('https://')) {
    throw new ApiError('internal', `Veo returned an unreadable video location: ${uri}`);
  }

  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${await getAccessToken()}` },
  });
  if (!response.ok) {
    throw new ApiError(
      response.status >= 500 ? 'unavailable' : 'internal',
      `Failed to download the Veo output (HTTP ${response.status}).`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Explains an operation that finished with no video: safety filtering, or nothing at all. */
function describeEmptyResult(response: Record<string, unknown>): string {
  const filteredCount = Number(response.raiMediaFilteredCount ?? 0);
  if (!(filteredCount > 0)) return 'Veo finished without returning a video.';

  const raw = response.raiMediaFilteredReasons;
  const reasons = Array.isArray(raw) ? raw.filter((r): r is string => typeof r === 'string') : [];
  return `Veo blocked the generation: ${reasons.length > 0 ? reasons.join('; ') : 'safety filters'}`;
}

export async function checkVeoOperation(args: {
  vertexModel: string;
  operationName: string;
  userId: string;
  generationId: string;
}): Promise<VeoPollResult> {
  if (getEnv().fakeVertex) {
    return checkFakeVeoOperation({
      operationName: args.operationName,
      userId: args.userId,
      generationId: args.generationId,
    });
  }

  const payload = await callVertex<Record<string, unknown>>(
    args.vertexModel,
    ':fetchPredictOperation',
    { operationName: args.operationName },
  );

  const operationError = asRecord(payload.error);
  if (operationError) {
    return {
      status: 'failed',
      error: asNonEmptyString(operationError.message) ?? 'Veo generation failed.',
    };
  }

  if (payload.done !== true) return { status: 'processing' };

  const response = asRecord(payload.response) ?? {};
  const samples = response.videos ?? response.generatedSamples;
  const ref = Array.isArray(samples) ? readVideoRef(samples[0]) : null;
  if (!ref) return { status: 'failed', error: describeEmptyResult(response) };

  const stored = await getStorage().save({
    key: `generations/${args.userId}/${args.generationId}/video.mp4`,
    data: await downloadVideo(ref),
    contentType: ref.mimeType,
  });

  return { status: 'completed', videoUrl: stored.url, storagePath: stored.path };
}
