import { HttpError } from '../errors.js';
import { uploadBuffer } from '../firebase.js';
import { buildNegativePrompt, buildVeoPrompt } from '../prompt.js';
import { callVertex, getAccessToken } from './client.js';
import { getVeoModel, resolveAspectRatio, resolveDuration, type VeoModelSpec } from './models.js';

/**
 * Veo generation is a long-running operation, so it is split in two: the caller
 * starts it and then polls. The finished video is copied into Firebase Storage
 * because the Vertex payload is either inline bytes or a short-lived GCS object,
 * neither of which the frontend can hold on to.
 */

export interface VideoRequest {
  generationId: string;
  userId: string;
  prompt: string;
  enrichedPrompt?: string;
  modelId: string;
  aspectRatio: string;
  duration: number;
  stylePreset?: string;
  cameraMotion?: string;
  referenceImageUrl?: string;
  lastFrameImageUrl?: string;
}

export type VeoStatus =
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

const DOWNLOAD_TIMEOUT_MS = 20_000;
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Percent-encoded binary is not valid UTF-8, and decodeURIComponent throws a
 * bare URIError on it — which would surface as a 500 for malformed client input.
 */
function percentEncodedToBase64(payload: string): string {
  try {
    return Buffer.from(decodeURIComponent(payload), 'utf8').toString('base64');
  } catch {
    throw new HttpError('invalid-argument', 'Reference image data URL is malformed.');
  }
}

/**
 * The URL comes from the client, so the fetch needs its own bounds: without a
 * deadline a trickling response never settles (undici's body timeout resets on
 * every chunk), and without a size cap an endless stream exhausts memory.
 */
async function downloadBounded(
  url: string,
  what: string,
): Promise<{ data: Buffer; contentType: string | null }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) }).catch(
    (err: unknown) => {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'failed';
      throw new HttpError('invalid-argument', `Downloading the ${what} ${reason}.`);
    },
  );

  if (!response.ok) {
    throw new HttpError('invalid-argument', `Failed to download the ${what} (HTTP ${response.status}).`);
  }

  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
    throw new HttpError('invalid-argument', `The ${what} exceeds the ${MAX_DOWNLOAD_BYTES} byte limit.`);
  }

  // content-length is advisory, so the real cap is enforced while streaming
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of streamOf(response)) {
    total += chunk.byteLength;
    if (total > MAX_DOWNLOAD_BYTES) {
      throw new HttpError('invalid-argument', `The ${what} exceeds the ${MAX_DOWNLOAD_BYTES} byte limit.`);
    }
    chunks.push(chunk);
  }

  return { data: Buffer.concat(chunks), contentType: response.headers.get('content-type') };
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

/** Veo accepts reference images only as inline base64, never as a URL. */
async function toInlineImage(imageUrl: string): Promise<InlineImage> {
  const url = imageUrl.trim();

  if (url.startsWith('data:')) {
    const match = DATA_URL_PATTERN.exec(url);
    if (!match) throw new HttpError('invalid-argument', 'Reference image data URL is malformed.');
    const [, mimeType, isBase64, payload = ''] = match;
    return {
      bytesBase64Encoded: isBase64 ? payload : percentEncodedToBase64(payload),
      mimeType: mimeType ?? DEFAULT_IMAGE_MIME_TYPE,
    };
  }

  const bytes = await downloadBounded(url, 'reference image');
  return {
    bytesBase64Encoded: bytes.data.toString('base64'),
    mimeType: bytes.contentType ?? DEFAULT_IMAGE_MIME_TYPE,
  };
}

async function buildInstance(req: VideoRequest, spec: VeoModelSpec): Promise<Record<string, unknown>> {
  const instance: Record<string, unknown> = {
    prompt: buildVeoPrompt({
      prompt: req.prompt,
      enrichedPrompt: req.enrichedPrompt,
      stylePreset: req.stylePreset,
      cameraMotion: req.cameraMotion,
      hasReferenceImage: Boolean(req.referenceImageUrl),
      supportsAudio: spec.supportsAudio,
    }),
  };

  if (req.referenceImageUrl) {
    if (!spec.supportsImageToVideo) {
      throw new HttpError('invalid-argument', `${req.modelId} does not support image-to-video.`);
    }
    instance.image = await toInlineImage(req.referenceImageUrl);
  }

  // Only the 3.1 family interpolates towards a supplied closing frame; older
  // models reject the field outright.
  if (req.lastFrameImageUrl && req.modelId.startsWith('veo-3.1')) {
    instance.lastFrame = await toInlineImage(req.lastFrameImageUrl);
  }

  return instance;
}

export async function startVeoOperation(
  req: VideoRequest,
): Promise<{ operationName: string; vertexModel: string }> {
  const spec = getVeoModel(req.modelId);

  const parameters: Record<string, unknown> = {
    aspectRatio: resolveAspectRatio(spec, req.aspectRatio),
    durationSeconds: resolveDuration(spec, req.duration),
    sampleCount: 1,
    resolution: spec.maxResolution,
    personGeneration: 'allow_adult',
    negativePrompt: buildNegativePrompt(req.cameraMotion),
  };
  if (spec.supportsAudio) parameters.generateAudio = true;

  const payload = await callVertex<Record<string, unknown>>(
    spec.vertexModel,
    ':predictLongRunning',
    { instances: [await buildInstance(req, spec)], parameters },
  );

  const operationName = asNonEmptyString(payload.name);
  if (!operationName) {
    throw new HttpError('internal', 'Veo accepted the request but returned no operation name.');
  }

  return { operationName, vertexModel: spec.vertexModel };
}

/** Reads the finished video out of the operation payload, whichever form it took. */
async function readVideoBytes(video: Record<string, unknown>): Promise<Buffer> {
  const inline = asNonEmptyString(video.bytesBase64Encoded);
  if (inline) return Buffer.from(inline, 'base64');

  const gcsUri = asNonEmptyString(video.gcsUri);
  if (!gcsUri) throw new HttpError('internal', 'Veo response contained no video payload.');

  const match = GCS_URI_PATTERN.exec(gcsUri);
  if (!match) throw new HttpError('internal', `Veo returned an unreadable gcsUri: ${gcsUri}`);

  const [, gcsBucket = '', objectPath = ''] = match;
  const download = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${gcsBucket}/o/${encodeURIComponent(objectPath)}?alt=media`,
    { headers: { Authorization: `Bearer ${await getAccessToken()}` } },
  );
  if (!download.ok) {
    throw new HttpError('internal', `Failed to download the Veo output (HTTP ${download.status}).`);
  }
  return Buffer.from(await download.arrayBuffer());
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
}): Promise<VeoStatus> {
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
  const video = Array.isArray(samples) ? asRecord(samples[0]) : null;
  if (!video) return { status: 'failed', error: describeEmptyResult(response) };

  const stored = await uploadBuffer({
    path: `video-generations/${args.userId}/${args.generationId}/result.mp4`,
    data: await readVideoBytes(video),
    contentType: asNonEmptyString(video.mimeType) ?? 'video/mp4',
  });

  return { status: 'completed', videoUrl: stored.downloadUrl, storagePath: stored.storagePath };
}
