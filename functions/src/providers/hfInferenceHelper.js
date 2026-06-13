'use strict';

/**
 * Shared HuggingFace Inference API helper.
 * Handles 503 "model loading" retries, binary/JSON response detection,
 * and Firebase Storage upload.
 */

const crypto = require('crypto');

const HF_BASE_URL = 'https://api-inference.huggingface.co/models';

function getHfToken() {
  const token = String(process.env.HUGGINGFACE_API_TOKEN || '').trim();
  if (!token) throw new Error('HUGGINGFACE_API_TOKEN is not configured in Firebase Functions env.');
  return token;
}

function isHfTokenConfigured() {
  return Boolean(String(process.env.HUGGINGFACE_API_TOKEN || '').trim());
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchWithTimeout(url, options, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

function getStorageDownloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

/**
 * POST to HuggingFace Inference API with automatic retry on 503 (model cold-start).
 * @param {string} modelId - HuggingFace model id, e.g. "Lightricks/LTX-Video"
 * @param {object} body - request body
 * @param {string} hfToken
 * @param {number} maxWaitMs - total wait budget for retries (default 10 min)
 * @returns {Response}
 */
async function hfInferencePost(modelId, body, hfToken, maxWaitMs = 600000) {
  const url = `${HF_BASE_URL}/${modelId}`;
  const headers = {
    'Authorization': `Bearer ${hfToken}`,
    'Content-Type': 'application/json',
    'x-wait-for-model': 'true',
  };

  const startedAt = Date.now();
  let attempt = 0;

  while (Date.now() - startedAt < maxWaitMs) {
    attempt += 1;
    let response;
    try {
      response = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(body) }, 120000);
    } catch (err) {
      throw new Error(`HuggingFace fetch failed (attempt ${attempt}): ${err instanceof Error ? err.message : String(err)}`);
    }

    if (response.status === 503) {
      // Model is cold-starting — read estimated_time and wait
      let estimatedSec = 20;
      try {
        const text = await response.text();
        const parsed = JSON.parse(text);
        if (typeof parsed.estimated_time === 'number') {
          estimatedSec = Math.min(Math.max(parsed.estimated_time, 5), 60);
        }
      } catch { /* ignore parse errors */ }
      console.info(`[HFInference] Model ${modelId} loading, waiting ${estimatedSec}s (attempt ${attempt})`);
      await wait(estimatedSec * 1000);
      continue;
    }

    return response;
  }

  throw new Error(`HuggingFace model ${modelId} did not become ready within ${maxWaitMs / 1000}s.`);
}

/**
 * Parse HuggingFace response — returns { buffer, contentType }.
 * Handles binary video/image responses and JSON error responses.
 */
async function parseHfResponse(response, modelId) {
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HuggingFace API error ${response.status} for ${modelId}: ${text.slice(0, 400)}`);
  }

  if (contentType.startsWith('video/') || contentType.startsWith('image/') || contentType === 'application/octet-stream') {
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, contentType: contentType.startsWith('video/') ? contentType : 'video/mp4' };
  }

  // JSON response — might contain a URL or an error
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(`HuggingFace unexpected response from ${modelId}: ${text.slice(0, 400)}`); }

  if (parsed.error) throw new Error(`HuggingFace model error (${modelId}): ${parsed.error}`);

  // Some models return { generated_video: "url" } or similar
  const videoUrl = String(parsed.generated_video || parsed.video || parsed.url || parsed[0]?.url || '').trim();
  if (!videoUrl) throw new Error(`HuggingFace ${modelId} returned unexpected JSON (no video URL): ${text.slice(0, 300)}`);

  // Download from URL
  const dlResponse = await fetchWithTimeout(videoUrl, {}, 120000);
  if (!dlResponse.ok) throw new Error(`HuggingFace video download failed: ${dlResponse.status}`);
  const buffer = Buffer.from(await dlResponse.arrayBuffer());
  return { buffer, contentType: 'video/mp4' };
}

/**
 * Upload video buffer to Firebase Storage and return public download URL.
 */
async function uploadToStorage({ bucket, userId, generationId, buffer, contentType, fileName }) {
  const destinationPath = `video-generations/${userId}/${generationId}/${fileName}`;
  const downloadToken = crypto.randomUUID();
  const file = bucket.file(destinationPath);
  await file.save(buffer, {
    resumable: false,
    contentType,
    metadata: { cacheControl: 'private, max-age=3600', metadata: { firebaseStorageDownloadTokens: downloadToken } },
  });
  return {
    resultVideoUrl: getStorageDownloadUrl(bucket.name, destinationPath, downloadToken),
    storagePath: destinationPath,
  };
}

module.exports = {
  getHfToken,
  isHfTokenConfigured,
  hfInferencePost,
  parseHfResponse,
  uploadToStorage,
};
