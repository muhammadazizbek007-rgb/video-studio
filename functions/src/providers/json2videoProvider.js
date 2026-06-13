'use strict';

const crypto = require('crypto');

const JSON2VIDEO_BASE_URL = 'https://api.json2video.com/v2';

const DEFAULT_POLL_CONFIG = { maxAttempts: 60, intervalMs: 5000 };

function isMockMode() {
  return false;
}

function isConfigured() {
  return Boolean(String(process.env.JSON2VIDEO_API_KEY || '').trim());
}

function getApiKey() {
  const key = String(process.env.JSON2VIDEO_API_KEY || '').trim();
  if (!key) throw new Error('JSON2Video API key is not configured. Set JSON2VIDEO_API_KEY in Firebase Functions.');
  return key;
}

function getHeaders(apiKey) {
  return { 'x-api-key': apiKey, 'Content-Type': 'application/json' };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(level, message, context) {
  console[level](`[JSON2VideoProvider] ${message}`, context || {});
}

function getStorageDownloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function buildJson2videoProject(request) {
  const resolution = request.aspectRatio === '9:16' ? '1080x1920' : request.aspectRatio === '1:1' ? '1080x1080' : '1920x1080';
  const [width, height] = resolution.split('x').map(Number);

  const elements = [];

  if (request.referenceImageUrl) {
    elements.push({
      type: 'image',
      src: request.referenceImageUrl,
      duration: request.duration,
      animations: [{ type: 'kenburns' }],
    });
  }

  elements.push({
    type: 'text',
    text: request.prompt.slice(0, 200),
    duration: request.duration,
    'font-size': 40,
    'font-family': 'Roboto',
    color: '#ffffff',
    'background-color': 'rgba(0,0,0,0.5)',
    x: Math.round(width * 0.05),
    y: Math.round(height * 0.80),
    width: Math.round(width * 0.90),
    'text-align': 'center',
  });

  return {
    resolution: `${width}x${height}`,
    quality: 'high',
    fps: 24,
    scenes: [
      {
        comment: request.prompt.slice(0, 100),
        elements,
        duration: request.duration,
        'background-color': '#000000',
      },
    ],
  };
}

async function createProject({ apiKey, request }) {
  log('info', 'Creating JSON2Video project', { generationId: request.id });

  const project = buildJson2videoProject(request);

  let response;
  try {
    response = await fetch(`${JSON2VIDEO_BASE_URL}/movies`, {
      method: 'POST',
      headers: getHeaders(apiKey),
      body: JSON.stringify(project),
    });
  } catch (error) {
    throw new Error(`JSON2Video create request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const payload = await readJson(response);
  log('info', 'Create response', { status: response.status, payload: JSON.stringify(payload), generationId: request.id });

  if (!response.ok) {
    throw new Error(`JSON2Video create project failed: ${response.status} ${response.statusText} ${JSON.stringify(payload)}`);
  }

  if (payload.success === false) {
    throw new Error(`JSON2Video create project rejected: ${payload.message || JSON.stringify(payload)}`);
  }

  // API may return movie ID in different fields
  const movieId = String(payload.project || payload.movie || payload.id || payload.movieId || '').trim();
  if (!movieId) throw new Error(`JSON2Video create response did not include a movie id. Full response: ${JSON.stringify(payload)}`);

  log('info', 'Project created', { movieId, generationId: request.id });
  return { movieId };
}

async function pollProject({ apiKey, movieId, request, pollConfig = DEFAULT_POLL_CONFIG }) {
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= pollConfig.maxAttempts; attempt += 1) {
    const endpoint = `${JSON2VIDEO_BASE_URL}/movies?project=${encodeURIComponent(movieId)}`;
    let response;

    try {
      response = await fetch(endpoint, { method: 'GET', headers: getHeaders(apiKey) });
    } catch (error) {
      throw new Error(`JSON2Video poll request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(`JSON2Video poll failed: ${response.status} ${response.statusText} ${JSON.stringify(payload)}`);
    }

    const status = String(payload.status || payload.movie?.status || '').trim().toLowerCase();
    log('info', 'Poll status', { movieId, attempt, status, payload: JSON.stringify(payload), generationId: request.id });

    if (status === 'done') {
      const videoUrl = String(payload.url || payload.movie?.url || payload.movie || '').trim();
      if (!videoUrl) throw new Error(`JSON2Video done but video URL missing. Response: ${JSON.stringify(payload)}`);
      return { finalVideoUrl: videoUrl };
    }

    if (['error', 'failed'].includes(status)) {
      throw new Error(`JSON2Video project failed: ${payload.message || payload.movie?.message || 'Unknown error'}`);
    }

    if (Date.now() - startedAt >= pollConfig.maxAttempts * pollConfig.intervalMs) {
      throw new Error('JSON2Video project timeout.');
    }

    if (attempt < pollConfig.maxAttempts) await wait(pollConfig.intervalMs);
  }

  throw new Error('JSON2Video project timeout.');
}

async function downloadVideo({ finalVideoUrl, request }) {
  log('info', 'Downloading video', { finalVideoUrl, generationId: request.id });
  let response;
  try {
    response = await fetch(finalVideoUrl);
  } catch (error) {
    throw new Error(`JSON2Video video download failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`JSON2Video video download failed: ${response.status} ${response.statusText}`);
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
  try {
    const created = await createProject({ apiKey, request });
    const completed = await pollProject({ apiKey, movieId: created.movieId, request });
    const downloaded = await downloadVideo({ finalVideoUrl: completed.finalVideoUrl, request });
    return uploadToStorage({ bucket, request, videoBuffer: downloaded.buffer, contentType: downloaded.contentType, fileName: `result-${created.movieId}.mp4` });
  } catch (error) {
    log('error', 'Generation failed', { generationId: request.id, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function generateJson2videoVideo(options) {
  return generateRealVideo(options);
}

function getDiagnostics() {
  return { configured: isConfigured(), mockMode: isMockMode() };
}

module.exports = { generateJson2videoVideo, isMockMode, isConfigured, getDiagnostics };
