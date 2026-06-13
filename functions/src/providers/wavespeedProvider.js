'use strict';

const crypto = require('crypto');

const WAVESPEED_BASE_URL = 'https://api.wavespeed.ai/api/v3';

const DEFAULT_POLL_CONFIG = { maxAttempts: 60, intervalMs: 5000 }; // 5 minutes max

// WaveSpeed v3 endpoint format: /api/v3/{owner}/{model}/{variant}
const MODEL_CONFIGS = {
  // Text-to-video: no image input, duration fixed to 5s (ultra-fast constraint)
  'wavespeed-wan': {
    endpoint: `${WAVESPEED_BASE_URL}/wavespeed-ai/wan-2.1/t2v-480p-ultra-fast`,
    buildInput: (request) => ({
      prompt: request.prompt,
      size: request.aspectRatio === '9:16' ? '480*832' : request.aspectRatio === '1:1' ? '480*480' : '832*480',
      duration: 5,
      num_inference_steps: 30,
      guidance_scale: 5.0,
      flow_shift: 5.0,
      seed: -1,
      enable_safety_checker: true,
    }),
  },
  // Image-to-video: separate i2v endpoint
  'wavespeed-wan-i2v': {
    endpoint: `${WAVESPEED_BASE_URL}/wavespeed-ai/wan-2.1/i2v-480p-ultra-fast`,
    buildInput: (request) => ({
      prompt: request.prompt,
      image: request.referenceImageUrl,
      size: request.aspectRatio === '9:16' ? '480*832' : request.aspectRatio === '1:1' ? '480*480' : '832*480',
      duration: 5,
      num_inference_steps: 30,
      guidance_scale: 5.0,
      flow_shift: 5.0,
      seed: -1,
      enable_safety_checker: true,
    }),
  },
};

function isMockMode() {
  return false;
}

function isConfigured() {
  return Boolean(String(process.env.WAVESPEED_API_KEY || '').trim());
}

function getApiKey() {
  const key = String(process.env.WAVESPEED_API_KEY || '').trim();
  if (!key) throw new Error('WaveSpeed API key is not configured. Set WAVESPEED_API_KEY in Firebase Functions.');
  return key;
}

function getHeaders(apiKey) {
  return { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchWithTimeout(url, options, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function log(level, message, context) {
  console[level](`[WaveSpeedProvider] ${message}`, context || {});
}

function getStorageDownloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function createPrediction({ apiKey, modelConfig, request }) {
  log('info', 'Creating prediction', { endpoint: modelConfig.endpoint, generationId: request.id });

  let response;
  try {
    response = await fetchWithTimeout(modelConfig.endpoint, {
      method: 'POST',
      headers: getHeaders(apiKey),
      body: JSON.stringify(modelConfig.buildInput(request)),
    }, 30000);
  } catch (error) {
    throw new Error(`WaveSpeed create request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(`WaveSpeed create prediction failed: ${response.status} ${response.statusText} ${JSON.stringify(payload)}`);
  }

  log('info', 'Create response', { payload: JSON.stringify(payload), generationId: request.id });

  // v3 response may be: { data: { id, urls: { get: "..." } } } or { id, ... }
  const data = payload.data || payload;
  const taskId = String(data.id || '').trim();
  // Use pre-built poll URL from response if available, otherwise construct it
  const pollUrl = String(data.urls?.get || data.url || '').trim() ||
    `${WAVESPEED_BASE_URL}/predictions/${taskId}`;

  if (!taskId) throw new Error(`WaveSpeed create response did not include a task id. Response: ${JSON.stringify(payload)}`);

  log('info', 'Prediction created', { taskId, pollUrl, generationId: request.id });
  return { taskId, pollUrl };
}

async function pollPrediction({ apiKey, taskId, pollUrl, request, pollConfig = DEFAULT_POLL_CONFIG }) {
  const pollEndpoint = pollUrl || `${WAVESPEED_BASE_URL}/predictions/${taskId}`;
  log('info', 'Polling', { pollEndpoint, taskId, generationId: request.id });
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= pollConfig.maxAttempts; attempt += 1) {
    let response;

    try {
      response = await fetchWithTimeout(pollEndpoint, { method: 'GET', headers: getHeaders(apiKey) }, 20000);
    } catch (error) {
      throw new Error(`WaveSpeed poll request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(`WaveSpeed poll failed: ${response.status} ${response.statusText} ${JSON.stringify(payload)}`);
    }

    // v3 response: { status: "...", outputs: [...] } or { data: { status: "..." } }
    const data = payload.data || payload;
    const status = String(data.status || '').trim().toLowerCase();
    log('info', 'Poll status', { taskId, attempt, status, fullPayload: JSON.stringify(payload).slice(0, 500), generationId: request.id });

    if (['completed', 'succeeded', 'success'].includes(status)) {
      const outputs = data.outputs;
      const videoUrl = String(
        (Array.isArray(outputs) && outputs.length > 0 ? outputs[0] : null) ||
        data.output?.video_url ||
        data.video_url ||
        '',
      ).trim();
      if (!videoUrl) throw new Error(`WaveSpeed succeeded but video URL is missing. Response: ${JSON.stringify(payload)}`);
      return { finalVideoUrl: videoUrl };
    }

    if (['failed', 'canceled', 'error'].includes(status)) {
      const errMsg = data.error || payload.message || 'Unknown error';
      throw new Error(`WaveSpeed prediction failed: ${errMsg}`);
    }

    // Unknown status — log and continue polling
    if (status && !['processing', 'queued', 'pending', 'starting', 'running'].includes(status)) {
      log('warn', 'Unknown poll status', { status, taskId, generationId: request.id });
    }

    if (Date.now() - startedAt >= pollConfig.maxAttempts * pollConfig.intervalMs) {
      throw new Error('WaveSpeed prediction timeout.');
    }

    if (attempt < pollConfig.maxAttempts) await wait(pollConfig.intervalMs);
  }

  throw new Error('WaveSpeed prediction timeout.');
}

async function downloadVideo({ finalVideoUrl, request }) {
  log('info', 'Downloading video', { finalVideoUrl, generationId: request.id });
  let response;
  try {
    response = await fetchWithTimeout(finalVideoUrl, {}, 60000);
  } catch (error) {
    throw new Error(`WaveSpeed video download failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`WaveSpeed video download failed: ${response.status} ${response.statusText}`);
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || 'video/mp4',
  };
}

async function uploadToStorage({ bucket, request, videoBuffer, contentType, fileName = 'result.mp4' }) {
  const destinationPath = `video-generations/${request.userId}/${request.id}/${fileName}`;
  const downloadToken = crypto.randomUUID();
  const file = bucket.file(destinationPath);
  try {
    await file.save(videoBuffer, {
      resumable: false, contentType,
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
  const apiKey = getApiKey();
  // Auto-select i2v when a reference image is provided
  const configKey = (request.referenceImageUrl && MODEL_CONFIGS['wavespeed-wan-i2v'])
    ? 'wavespeed-wan-i2v'
    : request.modelId;
  const modelConfig = MODEL_CONFIGS[configKey];
  if (!modelConfig) throw new Error(`No WaveSpeed model config for modelId: ${request.modelId}`);

  try {
    const created = await createPrediction({ apiKey, modelConfig, request });
    const completed = await pollPrediction({ apiKey, taskId: created.taskId, pollUrl: created.pollUrl, request });
    const downloaded = await downloadVideo({ finalVideoUrl: completed.finalVideoUrl, request });
    return uploadToStorage({ bucket, request, videoBuffer: downloaded.buffer, contentType: downloaded.contentType, fileName: `result-${created.taskId}.mp4` });
  } catch (error) {
    log('error', 'Generation failed', { generationId: request.id, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function generateWavespeedVideo(options) {
  return generateRealVideo(options);
}

function getDiagnostics() {
  return { configured: isConfigured(), mockMode: isMockMode() };
}

module.exports = { generateWavespeedVideo, isMockMode, isConfigured, getDiagnostics };
