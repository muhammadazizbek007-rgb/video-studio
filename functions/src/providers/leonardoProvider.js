'use strict';

const crypto = require('crypto');

const LEONARDO_BASE_URL = 'https://cloud.leonardo.ai/api/rest/v1';

const DEFAULT_POLL_CONFIG = { maxAttempts: 60, intervalMs: 5000 };

function isMockMode() {
  return false;
}

function isConfigured() {
  return Boolean(String(process.env.LEONARDO_API_KEY || '').trim());
}

function getApiKey() {
  const key = String(process.env.LEONARDO_API_KEY || '').trim();
  if (!key) throw new Error('Leonardo AI API key is not configured. Set LEONARDO_API_KEY in Firebase Functions.');
  return key;
}

function getHeaders(apiKey) {
  return { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(level, message, context) {
  console[level](`[LeonardoProvider] ${message}`, context || {});
}

function getStorageDownloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function uploadImageToLeonardo({ apiKey, imageUrl, request }) {
  log('info', 'Uploading image to Leonardo', { generationId: request.id });

  // Step 1: get presigned upload URL from Leonardo
  let initResponse;
  try {
    initResponse = await fetch(`${LEONARDO_BASE_URL}/init-image`, {
      method: 'POST',
      headers: getHeaders(apiKey),
      body: JSON.stringify({ extension: 'jpg' }),
    });
  } catch (error) {
    throw new Error(`Leonardo init-image failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const initPayload = await readJson(initResponse);
  if (!initResponse.ok) {
    throw new Error(`Leonardo init-image error: ${initResponse.status} ${JSON.stringify(initPayload)}`);
  }

  const imageId = String(initPayload.uploadInitImage?.id || '').trim();
  const uploadUrl = String(initPayload.uploadInitImage?.url || '').trim();
  const fields = initPayload.uploadInitImage?.fields || {};
  if (!imageId || !uploadUrl) throw new Error('Leonardo init-image did not return upload URL.');

  // Step 2: download source image
  let imgResponse;
  try {
    imgResponse = await fetch(imageUrl);
  } catch (error) {
    throw new Error(`Failed to download reference image: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!imgResponse.ok) throw new Error(`Reference image download failed: ${imgResponse.status}`);
  const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());

  // Step 3: upload to Leonardo S3 presigned URL
  const formData = new FormData();
  Object.entries(fields).forEach(([k, v]) => formData.append(k, String(v)));
  formData.append('file', new Blob([imgBuffer], { type: 'image/jpeg' }), 'image.jpg');

  let uploadResponse;
  try {
    uploadResponse = await fetch(uploadUrl, { method: 'POST', body: formData });
  } catch (error) {
    throw new Error(`Leonardo S3 upload failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!uploadResponse.ok && uploadResponse.status !== 204) {
    throw new Error(`Leonardo S3 upload error: ${uploadResponse.status}`);
  }

  log('info', 'Image uploaded to Leonardo', { imageId, generationId: request.id });
  return { imageId };
}

async function createMotionGeneration({ apiKey, request }) {
  log('info', 'Creating Leonardo Motion generation', { generationId: request.id });

  if (!request.referenceImageUrl) {
    throw new Error('Leonardo Motion requires a reference image. Please upload a photo first.');
  }

  // Upload image to Leonardo and get internal imageId
  const { imageId } = await uploadImageToLeonardo({ apiKey, imageUrl: request.referenceImageUrl, request });

  let response;
  try {
    response = await fetch(`${LEONARDO_BASE_URL}/generations-motion-svd`, {
      method: 'POST',
      headers: getHeaders(apiKey),
      body: JSON.stringify({
        imageId,
        motionStrength: 5,
        isPublic: false,
      }),
    });
  } catch (error) {
    throw new Error(`Leonardo create request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const payload = await readJson(response);
  log('info', 'Motion create response', { status: response.status, payload: JSON.stringify(payload), generationId: request.id });
  if (!response.ok) {
    throw new Error(`Leonardo create generation failed: ${response.status} ${response.statusText} ${JSON.stringify(payload)}`);
  }

  const generationId = String(payload.motionSvdGenerationJob?.generationId || '').trim();
  if (!generationId) throw new Error(`Leonardo create response did not include a generation id. Response: ${JSON.stringify(payload)}`);

  log('info', 'Generation created', { leonardoGenerationId: generationId, generationId: request.id });
  return { leonardoGenerationId: generationId };
}

async function pollGeneration({ apiKey, leonardoGenerationId, request, pollConfig = DEFAULT_POLL_CONFIG }) {
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= pollConfig.maxAttempts; attempt += 1) {
    const endpoint = `${LEONARDO_BASE_URL}/generations/${leonardoGenerationId}`;
    let response;

    try {
      response = await fetch(endpoint, { method: 'GET', headers: getHeaders(apiKey) });
    } catch (error) {
      throw new Error(`Leonardo poll request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(`Leonardo poll failed: ${response.status} ${response.statusText} ${JSON.stringify(payload)}`);
    }

    const status = String(payload.generations_by_pk?.status || '').trim().toUpperCase();
    log('info', 'Poll status', { leonardoGenerationId, attempt, status, generationId: request.id });

    if (status === 'COMPLETE') {
      const images = payload.generations_by_pk?.generated_images || [];
      const videoUrl = String(images[0]?.url || '').trim();
      if (!videoUrl) throw new Error('Leonardo generation completed but video URL is missing.');
      return { finalVideoUrl: videoUrl };
    }

    if (['FAILED', 'CANCELLED'].includes(status)) {
      throw new Error(`Leonardo generation ${status.toLowerCase()}.`);
    }

    if (Date.now() - startedAt >= pollConfig.maxAttempts * pollConfig.intervalMs) {
      throw new Error('Leonardo generation timeout.');
    }

    if (attempt < pollConfig.maxAttempts) await wait(pollConfig.intervalMs);
  }

  throw new Error('Leonardo generation timeout.');
}

async function downloadVideo({ finalVideoUrl, request }) {
  log('info', 'Downloading video', { finalVideoUrl, generationId: request.id });
  let response;
  try {
    response = await fetch(finalVideoUrl);
  } catch (error) {
    throw new Error(`Leonardo video download failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`Leonardo video download failed: ${response.status} ${response.statusText}`);
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
    const created = await createMotionGeneration({ apiKey, request });
    const completed = await pollGeneration({ apiKey, leonardoGenerationId: created.leonardoGenerationId, request });
    const downloaded = await downloadVideo({ finalVideoUrl: completed.finalVideoUrl, request });
    return uploadToStorage({ bucket, request, videoBuffer: downloaded.buffer, contentType: downloaded.contentType, fileName: `result-${created.leonardoGenerationId}.mp4` });
  } catch (error) {
    log('error', 'Generation failed', { generationId: request.id, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function generateLeonardoVideo(options) {
  return generateRealVideo(options);
}

function getDiagnostics() {
  return { configured: isConfigured(), mockMode: isMockMode() };
}

module.exports = { generateLeonardoVideo, isMockMode, isConfigured, getDiagnostics };
