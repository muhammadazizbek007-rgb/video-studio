'use strict';

/**
 * Google Veo video generation via Vertex AI.
 *
 * Veo is a long-running operation: :predictLongRunning returns an operation name,
 * which is then polled with :fetchPredictOperation until done. The finished video
 * comes back as base64 and is uploaded to Firebase Storage, matching the behaviour
 * of the other providers in this project.
 */

const crypto = require('crypto');
const { callVertex, isConfigured, modelUrl, getAccessToken, readJson, wait } = require('./vertexClient');
const { buildVeoPrompt, buildNegativePrompt } = require('./promptBuilder');

const POLL_CONFIG = { maxAttempts: 90, intervalMs: 10000 };

/**
 * Model registry. `vertexModel` values are Vertex AI publisher model ids — bump
 * these when Google promotes a preview model to GA.
 */
const VEO_MODELS = Object.freeze({
  'veo-3.1': {
    vertexModel: 'veo-3.1-generate-preview',
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true,
    supportsAudio: true,
    maxResolution: '1080p',
  },
  'veo-3.1-fast': {
    vertexModel: 'veo-3.1-fast-generate-preview',
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true,
    supportsAudio: true,
    maxResolution: '1080p',
  },
  'veo-3.0': {
    vertexModel: 'veo-3.0-generate-001',
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true,
    supportsAudio: true,
    maxResolution: '1080p',
  },
  'veo-3.0-fast': {
    vertexModel: 'veo-3.0-fast-generate-001',
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true,
    supportsAudio: true,
    maxResolution: '1080p',
  },
  'veo-2.0': {
    vertexModel: 'veo-2.0-generate-001',
    supportedDurations: [5, 6, 7, 8],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true,
    supportsAudio: false,
    maxResolution: '720p',
  },
});

const VEO_MODEL_IDS = Object.keys(VEO_MODELS);

function log(level, message, context) {
  console[level](`[VeoProvider] ${message}`, context || {});
}

function getModelSpec(modelId) {
  const spec = VEO_MODELS[modelId];
  if (!spec) throw new Error(`Unknown Veo model: ${modelId}`);
  return spec;
}

function getStorageDownloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

/** Veo supports only landscape and portrait — 1:1 has no equivalent. */
function resolveAspectRatio(spec, aspectRatio) {
  const requested = String(aspectRatio || '16:9');
  if (spec.aspectRatios.includes(requested)) return requested;
  throw new Error(
    `Veo does not support the ${requested} aspect ratio. Available: ${spec.aspectRatios.join(', ')}.`,
  );
}

/** Snaps the requested duration to the closest value the model actually accepts. */
function resolveDuration(spec, duration) {
  const requested = Number(duration);
  if (!Number.isFinite(requested)) return spec.defaultDuration;
  if (spec.supportedDurations.includes(requested)) return requested;
  return spec.supportedDurations.reduce(
    (closest, candidate) => (Math.abs(candidate - requested) < Math.abs(closest - requested) ? candidate : closest),
    spec.supportedDurations[0],
  );
}

/** Veo takes reference images inline as base64, so remote URLs must be fetched first. */
async function toInlineImage(imageUrl) {
  const url = String(imageUrl || '').trim();
  if (!url) return null;

  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
    if (!match) throw new Error('Reference image data URL is malformed.');
    const [, mimeType, isBase64, payload] = match;
    const bytes = isBase64 ? payload : Buffer.from(decodeURIComponent(payload)).toString('base64');
    return { bytesBase64Encoded: bytes, mimeType: mimeType || 'image/jpeg' };
  }

  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`Failed to download reference image: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`Failed to download reference image: ${response.status} ${response.statusText}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    bytesBase64Encoded: buffer.toString('base64'),
    mimeType: response.headers.get('content-type') || 'image/jpeg',
  };
}

async function startOperation({ modelId, request }) {
  const spec = getModelSpec(modelId);

  const referenceImage = request.referenceImageUrl || (Array.isArray(request.referenceImageUrls) ? request.referenceImageUrls[0] : null);

  const instance = {
    prompt: buildVeoPrompt({
      prompt: request.prompt,
      enrichedPrompt: request.enrichedPrompt,
      stylePreset: request.stylePreset,
      cameraMotion: request.cameraMotion,
      hasReferenceImage: Boolean(referenceImage),
      supportsAudio: spec.supportsAudio,
    }),
  };

  if (referenceImage) {
    if (!spec.supportsImageToVideo) throw new Error(`${modelId} does not support image-to-video.`);
    instance.image = await toInlineImage(referenceImage);
  }

  // Veo 3.1 can also interpolate towards a final frame
  if (request.lastFrameImageUrl && modelId.startsWith('veo-3.1')) {
    instance.lastFrame = await toInlineImage(request.lastFrameImageUrl);
  }

  const parameters = {
    aspectRatio: resolveAspectRatio(spec, request.aspectRatio),
    durationSeconds: resolveDuration(spec, request.duration),
    sampleCount: 1,
    resolution: spec.maxResolution,
    personGeneration: 'allow_adult',
    negativePrompt: buildNegativePrompt(request.cameraMotion),
  };
  if (spec.supportsAudio) parameters.generateAudio = true;

  log('info', 'Starting Veo operation', {
    generationId: request.id, modelId, vertexModel: spec.vertexModel,
    aspectRatio: parameters.aspectRatio, durationSeconds: parameters.durationSeconds,
    hasImage: Boolean(instance.image),
  });

  const payload = await callVertex(spec.vertexModel, ':predictLongRunning', {
    instances: [instance],
    parameters,
  });

  const operationName = String(payload.name || '').trim();
  if (!operationName) throw new Error(`Veo did not return an operation name. Response: ${JSON.stringify(payload)}`);

  return { operationName, vertexModel: spec.vertexModel };
}

async function pollOperation({ vertexModel, operationName, request }) {
  const token = await getAccessToken();
  const url = `${modelUrl(vertexModel)}:fetchPredictOperation`;

  for (let attempt = 1; attempt <= POLL_CONFIG.maxAttempts; attempt += 1) {
    await wait(POLL_CONFIG.intervalMs);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ operationName }),
      });
    } catch (error) {
      throw new Error(`Veo poll request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(`Veo poll failed: ${response.status} ${payload?.error?.message || JSON.stringify(payload)}`);
    }

    if (payload.error) {
      throw new Error(`Veo generation failed: ${payload.error.message || JSON.stringify(payload.error)}`);
    }

    if (payload.done) {
      const result = payload.response || {};
      const videos = result.videos || result.generatedSamples || [];

      if (!videos.length) {
        const filtered = Number(result.raiMediaFilteredCount || 0);
        if (filtered > 0) {
          const reasons = (result.raiMediaFilteredReasons || []).join('; ') || 'safety filters';
          throw new Error(`Veo blocked the generation: ${reasons}`);
        }
        throw new Error(`Veo finished without returning a video. Response: ${JSON.stringify(result).slice(0, 500)}`);
      }

      log('info', 'Veo operation completed', { generationId: request.id, attempt });
      return videos[0];
    }

    if (attempt % 6 === 0) {
      log('info', 'Veo still processing', { generationId: request.id, attempt });
    }
  }

  throw new Error('Veo generation timed out.');
}

async function resolveVideoBuffer(video) {
  if (video.bytesBase64Encoded) {
    return { buffer: Buffer.from(video.bytesBase64Encoded, 'base64'), contentType: video.mimeType || 'video/mp4' };
  }

  const gcsUri = String(video.gcsUri || '').trim();
  if (gcsUri) {
    // Signed download through the Cloud Storage JSON API
    const match = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) throw new Error(`Veo returned an unreadable gcsUri: ${gcsUri}`);
    const [, gcsBucket, objectPath] = match;
    const token = await getAccessToken();
    const response = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${gcsBucket}/o/${encodeURIComponent(objectPath)}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw new Error(`Failed to download Veo output from ${gcsUri}: ${response.status}`);
    return { buffer: Buffer.from(await response.arrayBuffer()), contentType: video.mimeType || 'video/mp4' };
  }

  throw new Error('Veo response contained neither inline bytes nor a gcsUri.');
}

async function uploadToStorage({ bucket, request, buffer, contentType }) {
  const destinationPath = `video-generations/${request.userId}/${request.id}/result.mp4`;
  const downloadToken = crypto.randomUUID();
  const file = bucket.file(destinationPath);

  try {
    await file.save(buffer, {
      resumable: false,
      contentType,
      metadata: {
        cacheControl: 'private, max-age=3600',
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    });
  } catch (error) {
    throw new Error(`Firebase Storage upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    resultVideoUrl: getStorageDownloadUrl(bucket.name, destinationPath, downloadToken),
    storagePath: destinationPath,
  };
}

async function generateVeoVideo({ bucket, request }) {
  try {
    const { operationName, vertexModel } = await startOperation({ modelId: request.modelId, request });
    const video = await pollOperation({ vertexModel, operationName, request });
    const { buffer, contentType } = await resolveVideoBuffer(video);
    return uploadToStorage({ bucket, request, buffer, contentType });
  } catch (error) {
    log('error', 'Generation failed', {
      generationId: request.id,
      modelId: request.modelId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function isMockMode() {
  return false;
}

function getDiagnostics() {
  return { configured: isConfigured(), mockMode: false, models: VEO_MODEL_IDS };
}

module.exports = {
  VEO_MODELS,
  VEO_MODEL_IDS,
  generateVeoVideo,
  getDiagnostics,
  getModelSpec,
  isConfigured,
  isMockMode,
  resolveDuration,
};
