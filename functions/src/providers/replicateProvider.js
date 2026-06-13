'use strict';

const crypto = require('crypto');

const REPLICATE_BASE_URL = 'https://api.replicate.com/v1';

const DEFAULT_POLL_CONFIG = { maxAttempts: 120, intervalMs: 5000 };

// Maps modelId → Replicate model slug and input builder
const MODEL_CONFIGS = {
  'replicate-wan-t2v': {
    model: 'wavespeedai/wan-2.1-t2v-480p',
    buildInput: (request) => ({
      prompt: request.prompt,
      num_frames: request.duration <= 5 ? 81 : 161,
    }),
  },
  'replicate-wan-i2v': {
    model: 'wavespeedai/wan-2.1-i2v-480p',
    buildInput: (request) => ({
      prompt: request.prompt,
      image: request.referenceImageUrl,
      num_frames: request.duration <= 5 ? 81 : 161,
    }),
  },
  'replicate-kling': {
    model: 'kwaivgi/kling-v1.5-standard',
    buildInput: (request) => ({
      prompt: request.prompt,
      ...(request.referenceImageUrl ? { start_image: request.referenceImageUrl } : {}),
      aspect_ratio: request.aspectRatio === '9:16' ? '9:16' : request.aspectRatio === '1:1' ? '1:1' : '16:9',
      duration: request.duration <= 5 ? '5' : '10',
    }),
  },
  'replicate-luma': {
    model: 'luma/ray',
    buildInput: (request) => ({
      prompt: request.prompt,
      ...(request.referenceImageUrl
        ? { keyframes: { frame0: { type: 'image', url: request.referenceImageUrl } } }
        : {}),
      aspect_ratio: request.aspectRatio === '9:16' ? '9:16' : request.aspectRatio === '1:1' ? '1:1' : '16:9',
      duration: `${Math.min(request.duration, 9)}s`,
    }),
  },
};

function isMockMode() {
  return false;
}

function isConfigured() {
  return Boolean(String(process.env.REPLICATE_API_TOKEN || '').trim());
}

function getApiToken() {
  const token = String(process.env.REPLICATE_API_TOKEN || '').trim();
  if (!token) throw new Error('Replicate API token is not configured. Set REPLICATE_API_TOKEN in Firebase Functions.');
  return token;
}

function getHeaders(token) {
  return { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(level, message, context) {
  console[level](`[ReplicateProvider] ${message}`, context || {});
}

function getStorageDownloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function createPrediction({ token, modelConfig, request }) {
  const [owner, name] = modelConfig.model.split('/');
  const endpoint = `${REPLICATE_BASE_URL}/models/${owner}/${name}/predictions`;
  const input = modelConfig.buildInput(request);

  log('info', 'Creating prediction', { model: modelConfig.model, generationId: request.id });

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: getHeaders(token),
      body: JSON.stringify({ input }),
    });
  } catch (error) {
    throw new Error(`Replicate create request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(`Replicate create prediction failed: ${response.status} ${response.statusText} ${JSON.stringify(payload)}`);
  }

  const predictionId = String(payload.id || '').trim();
  if (!predictionId) throw new Error('Replicate create response did not include a prediction id.');

  log('info', 'Prediction created', { predictionId, generationId: request.id });
  return { predictionId };
}

async function pollPrediction({ token, predictionId, request, pollConfig = DEFAULT_POLL_CONFIG }) {
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= pollConfig.maxAttempts; attempt += 1) {
    const endpoint = `${REPLICATE_BASE_URL}/predictions/${predictionId}`;
    let response;

    try {
      response = await fetch(endpoint, { method: 'GET', headers: getHeaders(token) });
    } catch (error) {
      throw new Error(`Replicate poll request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(`Replicate poll failed: ${response.status} ${response.statusText} ${JSON.stringify(payload)}`);
    }

    const status = String(payload.status || '').trim().toLowerCase();
    log('info', 'Poll status', { predictionId, attempt, status, generationId: request.id });

    if (status === 'succeeded') {
      const output = payload.output;
      const videoUrl = Array.isArray(output) ? output[0] : (typeof output === 'string' ? output : '');
      if (!videoUrl) throw new Error('Replicate prediction succeeded but output video URL is missing.');
      return { finalVideoUrl: videoUrl };
    }

    if (['failed', 'canceled', 'cancelled'].includes(status)) {
      throw new Error(`Replicate prediction failed: ${payload.error || 'Unknown error'}`);
    }

    if (Date.now() - startedAt >= pollConfig.maxAttempts * pollConfig.intervalMs) {
      throw new Error('Replicate prediction timeout.');
    }

    if (attempt < pollConfig.maxAttempts) await wait(pollConfig.intervalMs);
  }

  throw new Error('Replicate prediction timeout.');
}

async function downloadVideo({ finalVideoUrl, request }) {
  log('info', 'Downloading video', { finalVideoUrl, generationId: request.id });

  let response;
  try {
    response = await fetch(finalVideoUrl);
  } catch (error) {
    throw new Error(`Replicate video download failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    throw new Error(`Replicate video download failed: ${response.status} ${response.statusText}`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'video/mp4',
  };
}

async function uploadToStorage({ bucket, request, videoBuffer, contentType, fileName = 'result.mp4' }) {
  const destinationPath = `video-generations/${request.userId}/${request.id}/${fileName}`;
  const downloadToken = crypto.randomUUID();
  const file = bucket.file(destinationPath);

  log('info', 'Uploading to storage', { destinationPath, generationId: request.id });

  try {
    await file.save(videoBuffer, {
      resumable: false,
      contentType,
      metadata: { cacheControl: 'private, max-age=3600', metadata: { firebaseStorageDownloadTokens: downloadToken } },
    });
  } catch (error) {
    throw new Error(`Firebase Storage upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    resultVideoUrl: getStorageDownloadUrl(bucket.name, destinationPath, downloadToken),
    storagePath: destinationPath,
  };
}

async function generateRealVideo({ bucket, request }) {
  const token = getApiToken();
  const modelConfig = MODEL_CONFIGS[request.modelId];

  if (!modelConfig) {
    throw new Error(`No Replicate model config for modelId: ${request.modelId}`);
  }

  try {
    const created = await createPrediction({ token, modelConfig, request });
    const completed = await pollPrediction({ token, predictionId: created.predictionId, request });
    const downloaded = await downloadVideo({ finalVideoUrl: completed.finalVideoUrl, request });
    return uploadToStorage({
      bucket, request,
      videoBuffer: downloaded.buffer,
      contentType: downloaded.contentType,
      fileName: `result-${created.predictionId}.mp4`,
    });
  } catch (error) {
    log('error', 'Generation failed', { generationId: request.id, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function generateReplicateVideo(options) {
  return generateRealVideo(options);
}

function getDiagnostics() {
  return { configured: isConfigured(), mockMode: isMockMode() };
}

module.exports = { generateReplicateVideo, isMockMode, isConfigured, getDiagnostics };
