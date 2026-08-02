import type { Env } from './types';
import { getAccessToken } from './google-auth';
import { buildVeoPrompt, buildNegativePrompt } from './prompt';

/**
 * Google Veo video generation via Vertex AI.
 *
 * Veo runs as a long-running operation, so the worker never blocks on it:
 * `startVeoOperation` kicks it off and the client polls `checkVeoOperation`
 * until the video is ready. The finished video is copied into Firebase Storage
 * so the frontend gets a stable URL instead of a short-lived Vertex payload.
 */

export interface VideoRequest {
  generationId: string; prompt: string; enrichedPrompt?: string;
  modelId: string; mode: string; aspectRatio: string; duration: number;
  stylePreset?: string; cameraMotion?: string;
  referenceImageUrl?: string; referenceVideoUrl?: string; referenceAudioUrl?: string;
  referenceImageUrls?: string[];
  lastFrameImageUrl?: string;
  userId?: string;
}

export interface VideoResult {
  resultVideoUrl: string;
  storagePath?: string;
}

interface VeoModelSpec {
  vertexModel: string;
  supportedDurations: number[];
  defaultDuration: number;
  aspectRatios: string[];
  supportsImageToVideo: boolean;
  supportsAudio: boolean;
  maxResolution: string;
}

/** Keep in sync with functions/src/providers/google/veoProvider.js */
export const VEO_MODELS: Record<string, VeoModelSpec> = {
  'veo-3.1': {
    vertexModel: 'veo-3.1-generate-preview',
    supportedDurations: [4, 6, 8], defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true, supportsAudio: true, maxResolution: '1080p',
  },
  'veo-3.1-fast': {
    vertexModel: 'veo-3.1-fast-generate-preview',
    supportedDurations: [4, 6, 8], defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true, supportsAudio: true, maxResolution: '1080p',
  },
  'veo-3.0': {
    vertexModel: 'veo-3.0-generate-001',
    supportedDurations: [4, 6, 8], defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true, supportsAudio: true, maxResolution: '1080p',
  },
  'veo-3.0-fast': {
    vertexModel: 'veo-3.0-fast-generate-001',
    supportedDurations: [4, 6, 8], defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true, supportsAudio: true, maxResolution: '1080p',
  },
  'veo-2.0': {
    vertexModel: 'veo-2.0-generate-001',
    supportedDurations: [5, 6, 7, 8], defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true, supportsAudio: false, maxResolution: '720p',
  },
};

export const VEO_MODEL_IDS = Object.keys(VEO_MODELS);

async function readJson(res: Response) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function getServiceAccount(env: Env) {
  const raw = String(env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON not configured');
  return JSON.parse(raw) as { project_id: string; client_email: string; private_key: string };
}

function getVertexConfig(env: Env) {
  const location = String(env.VERTEX_LOCATION || 'us-central1').trim();
  const project = String(env.VERTEX_PROJECT_ID || env.FIREBASE_PROJECT_ID || '').trim();
  if (!project) throw new Error('VERTEX_PROJECT_ID / FIREBASE_PROJECT_ID not configured');
  return { location, project };
}

function modelUrl(env: Env, vertexModel: string) {
  const { location, project } = getVertexConfig(env);
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${vertexModel}`;
}

export function getVeoModelSpec(modelId: string): VeoModelSpec {
  const spec = VEO_MODELS[modelId];
  if (!spec) throw new Error(`Unknown Veo model: ${modelId}`);
  return spec;
}

function resolveAspectRatio(spec: VeoModelSpec, aspectRatio: string): string {
  const requested = aspectRatio || '16:9';
  if (spec.aspectRatios.includes(requested)) return requested;
  throw new Error(`Veo does not support the ${requested} aspect ratio. Available: ${spec.aspectRatios.join(', ')}.`);
}

function resolveDuration(spec: VeoModelSpec, duration: number): number {
  const requested = Number(duration);
  if (!Number.isFinite(requested)) return spec.defaultDuration;
  if (spec.supportedDurations.includes(requested)) return requested;
  return spec.supportedDurations.reduce(
    (closest, candidate) => (Math.abs(candidate - requested) < Math.abs(closest - requested) ? candidate : closest),
    spec.supportedDurations[0],
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Veo takes reference images inline, so remote URLs are fetched and inlined. */
async function toInlineImage(imageUrl: string): Promise<{ bytesBase64Encoded: string; mimeType: string }> {
  const url = imageUrl.trim();

  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
    if (!match) throw new Error('Reference image data URL is malformed.');
    const [, mimeType, isBase64, payload] = match;
    return {
      bytesBase64Encoded: isBase64 ? payload : btoa(decodeURIComponent(payload)),
      mimeType: mimeType || 'image/jpeg',
    };
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download reference image: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return {
    bytesBase64Encoded: bytesToBase64(bytes),
    mimeType: res.headers.get('content-type') || 'image/jpeg',
  };
}


/** Starts a Veo generation and returns the operation name to poll. */
export async function startVeoOperation(env: Env, req: VideoRequest): Promise<{ operationName: string; vertexModel: string }> {
  const spec = getVeoModelSpec(req.modelId);
  const token = await getAccessToken(getServiceAccount(env));

  const referenceImage = req.referenceImageUrl || req.referenceImageUrls?.[0];

  const instance: Record<string, unknown> = {
    prompt: buildVeoPrompt({
      prompt: req.prompt,
      enrichedPrompt: req.enrichedPrompt,
      stylePreset: req.stylePreset,
      cameraMotion: req.cameraMotion,
      hasReferenceImage: Boolean(referenceImage),
      supportsAudio: spec.supportsAudio,
    }),
  };

  if (referenceImage) {
    if (!spec.supportsImageToVideo) throw new Error(`${req.modelId} does not support image-to-video.`);
    instance.image = await toInlineImage(referenceImage);
  }
  if (req.lastFrameImageUrl && req.modelId.startsWith('veo-3.1')) {
    instance.lastFrame = await toInlineImage(req.lastFrameImageUrl);
  }

  const parameters: Record<string, unknown> = {
    aspectRatio: resolveAspectRatio(spec, req.aspectRatio),
    durationSeconds: resolveDuration(spec, req.duration),
    sampleCount: 1,
    resolution: spec.maxResolution,
    personGeneration: 'allow_adult',
    negativePrompt: buildNegativePrompt(req.cameraMotion),
  };
  if (spec.supportsAudio) parameters.generateAudio = true;

  const res = await fetch(`${modelUrl(env, spec.vertexModel)}:predictLongRunning`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ instances: [instance], parameters }),
  });

  const payload = await readJson(res) as Record<string, unknown>;
  if (!res.ok) {
    const detail = (payload as { error?: { message?: string } }).error?.message || JSON.stringify(payload);
    throw new Error(`Veo create failed: ${res.status} ${detail}`);
  }

  const operationName = String(payload.name || '').trim();
  if (!operationName) throw new Error(`Veo did not return an operation name: ${JSON.stringify(payload)}`);

  return { operationName, vertexModel: spec.vertexModel };
}

/** Uploads generated media into Firebase Storage and returns a download URL. */
async function uploadToFirebaseStorage(
  env: Env,
  token: string,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<VideoResult> {
  const bucket = String(env.FIREBASE_STORAGE_BUCKET || `${getVertexConfig(env).project}.firebasestorage.app`).trim();
  const downloadToken = crypto.randomUUID();

  const boundary = `veo-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: path,
    contentType,
    cacheControl: 'private, max-age=3600',
    metadata: { firebaseStorageDownloadTokens: downloadToken },
  });

  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);

  const res = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=multipart`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );

  if (!res.ok) {
    throw new Error(`Firebase Storage upload failed: ${res.status} ${await res.text()}`);
  }

  return {
    resultVideoUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${downloadToken}`,
    storagePath: path,
  };
}

/**
 * Polls a Veo operation once.
 * Returns 'processing' while it runs, and stores the video on completion.
 */
export async function checkVeoOperation(
  env: Env,
  vertexModel: string,
  operationName: string,
  target: { userId: string; generationId: string },
): Promise<{ status: 'processing' | 'completed' | 'failed'; videoUrl: string | null; storagePath?: string; error: string | null }> {
  const token = await getAccessToken(getServiceAccount(env));

  const res = await fetch(`${modelUrl(env, vertexModel)}:fetchPredictOperation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ operationName }),
  });

  const payload = await readJson(res) as Record<string, unknown>;
  if (!res.ok) {
    const detail = (payload as { error?: { message?: string } }).error?.message || JSON.stringify(payload);
    return { status: 'failed', videoUrl: null, error: `Veo poll failed: ${res.status} ${detail}` };
  }

  if (payload.error) {
    const err = payload.error as { message?: string };
    return { status: 'failed', videoUrl: null, error: err.message || 'Veo generation failed' };
  }

  if (!payload.done) {
    return { status: 'processing', videoUrl: null, error: null };
  }

  const response = (payload.response || {}) as Record<string, unknown>;
  const videos = (response.videos || response.generatedSamples || []) as Array<Record<string, string>>;

  if (!videos.length) {
    const filteredCount = Number(response.raiMediaFilteredCount || 0);
    if (filteredCount > 0) {
      const reasons = ((response.raiMediaFilteredReasons || []) as string[]).join('; ') || 'safety filters';
      return { status: 'failed', videoUrl: null, error: `Veo blocked the generation: ${reasons}` };
    }
    return { status: 'failed', videoUrl: null, error: 'Veo finished without returning a video.' };
  }

  const video = videos[0];
  let bytes: Uint8Array;
  const contentType = video.mimeType || 'video/mp4';

  if (video.bytesBase64Encoded) {
    bytes = base64ToBytes(video.bytesBase64Encoded);
  } else if (video.gcsUri) {
    const match = video.gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) return { status: 'failed', videoUrl: null, error: `Unreadable gcsUri: ${video.gcsUri}` };
    const [, gcsBucket, objectPath] = match;
    const download = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${gcsBucket}/o/${encodeURIComponent(objectPath)}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!download.ok) return { status: 'failed', videoUrl: null, error: `Failed to download Veo output: ${download.status}` };
    bytes = new Uint8Array(await download.arrayBuffer());
  } else {
    return { status: 'failed', videoUrl: null, error: 'Veo response contained no video payload.' };
  }

  const path = `video-generations/${target.userId}/${target.generationId}/result.mp4`;
  const stored = await uploadToFirebaseStorage(env, token, path, bytes, contentType);

  return { status: 'completed', videoUrl: stored.resultVideoUrl, storagePath: stored.storagePath, error: null };
}

// ─── Google image generation (Imagen / Gemini Image) ──────────────────────────

interface ImageModelSpec {
  vertexModel: string;
  kind: 'imagen' | 'gemini';
  supportsEditing: boolean;
}

/** Keep in sync with functions/src/providers/google/imagenProvider.js */
export const IMAGE_MODELS: Record<string, ImageModelSpec> = {
  'imagen-4': { vertexModel: 'imagen-4.0-generate-001', kind: 'imagen', supportsEditing: false },
  'imagen-4-fast': { vertexModel: 'imagen-4.0-fast-generate-001', kind: 'imagen', supportsEditing: false },
  'imagen-4-ultra': { vertexModel: 'imagen-4.0-ultra-generate-001', kind: 'imagen', supportsEditing: false },
  'imagen-3': { vertexModel: 'imagen-3.0-generate-002', kind: 'imagen', supportsEditing: false },
  'gemini-image': { vertexModel: 'gemini-2.5-flash-image', kind: 'gemini', supportsEditing: true },
};

export const IMAGE_MODEL_IDS = Object.keys(IMAGE_MODELS);
export const DEFAULT_IMAGE_MODEL = 'imagen-4';
const IMAGE_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];

export interface ImageRequest {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  /** Present for editing / background removal / outpainting — forces the Gemini image model */
  sourceImageUrl?: string;
  userId: string;
  jobId: string;
}

export async function generateGoogleImage(env: Env, req: ImageRequest): Promise<{ imageUrl: string; storagePath?: string; model: string }> {
  const prompt = String(req.prompt || '').trim();
  if (!prompt) throw new Error('prompt is required for image generation.');

  const requestedModel = req.sourceImageUrl ? 'gemini-image' : (req.model || DEFAULT_IMAGE_MODEL);
  const spec = IMAGE_MODELS[requestedModel];
  if (!spec) throw new Error(`Unknown Google image model: ${requestedModel}`);

  const token = await getAccessToken(getServiceAccount(env));
  let bytes: Uint8Array;
  let contentType = 'image/png';

  if (spec.kind === 'gemini') {
    const parts: Array<Record<string, unknown>> = [{ text: prompt }];
    if (req.sourceImageUrl) {
      const inline = await toInlineImage(req.sourceImageUrl);
      parts.push({ inlineData: { mimeType: inline.mimeType, data: inline.bytesBase64Encoded } });
    }

    const res = await fetch(`${modelUrl(env, spec.vertexModel)}:generateContent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    });

    const payload = await readJson(res) as Record<string, unknown>;
    if (!res.ok) {
      const detail = (payload as { error?: { message?: string } }).error?.message || JSON.stringify(payload);
      throw new Error(`Gemini image failed: ${res.status} ${detail}`);
    }

    const candidate = ((payload.candidates || []) as Array<Record<string, unknown>>)[0];
    const content = candidate?.content as { parts?: Array<Record<string, { data?: string; mimeType?: string }>> } | undefined;
    const imagePart = (content?.parts || []).find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      throw new Error('Gemini image model returned no image.');
    }
    bytes = base64ToBytes(imagePart.inlineData.data);
    contentType = imagePart.inlineData.mimeType || 'image/png';
  } else {
    const aspectRatio = IMAGE_ASPECT_RATIOS.includes(String(req.aspectRatio)) ? String(req.aspectRatio) : '1:1';

    const res = await fetch(`${modelUrl(env, spec.vertexModel)}:predict`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio, personGeneration: 'allow_adult' },
      }),
    });

    const payload = await readJson(res) as Record<string, unknown>;
    if (!res.ok) {
      const detail = (payload as { error?: { message?: string } }).error?.message || JSON.stringify(payload);
      throw new Error(`Imagen failed: ${res.status} ${detail}`);
    }

    const prediction = ((payload.predictions || []) as Array<Record<string, string>>)[0];
    if (!prediction?.bytesBase64Encoded) {
      const blocked = prediction?.raiFilteredReason;
      throw new Error(blocked ? `Imagen blocked the request: ${blocked}` : 'Imagen returned no image.');
    }
    bytes = base64ToBytes(prediction.bytesBase64Encoded);
    contentType = prediction.mimeType || 'image/png';
  }

  const extension = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
  const path = `image-generations/${req.userId}/${req.jobId}/result.${extension}`;
  const stored = await uploadToFirebaseStorage(env, token, path, bytes, contentType);

  return { imageUrl: stored.resultVideoUrl, storagePath: stored.storagePath, model: requestedModel };
}
