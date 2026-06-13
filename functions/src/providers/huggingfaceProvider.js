'use strict';

const crypto = require('crypto');

// HuggingFace Inference API — serverless or dedicated endpoints
const MODEL_CONFIGS = {
  'huggingface-cogvideox': {
    model: 'THUDM/CogVideoX-5b',
    buildInput: (request) => ({
      inputs: request.prompt,
      parameters: {
        num_frames: request.duration <= 5 ? 49 : 97,
        guidance_scale: 7.5,
      },
    }),
  },
  'huggingface-opensora': {
    model: 'hpcai-tech/Open-Sora',
    buildInput: (request) => ({
      inputs: request.prompt,
      parameters: {
        num_frames: request.duration <= 5 ? 51 : 102,
        resolution: '480p',
        aspect_ratio: request.aspectRatio,
      },
    }),
  },
};

function isMockMode() {
  return false;
}

function isConfigured() {
  return Boolean(String(process.env.HUGGINGFACE_API_TOKEN || '').trim());
}

function getApiToken() {
  const token = String(process.env.HUGGINGFACE_API_TOKEN || '').trim();
  if (!token) throw new Error('HuggingFace API token is not configured. Set HUGGINGFACE_API_TOKEN in Firebase Functions.');
  return token;
}

function log(level, message, context) {
  console[level](`[HuggingFaceProvider] ${message}`, context || {});
}

function getStorageDownloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

async function downloadVideo({ finalVideoUrl, request }) {
  log('info', 'Downloading video', { finalVideoUrl, generationId: request.id });
  let response;
  try {
    response = await fetch(finalVideoUrl);
  } catch (error) {
    throw new Error(`HuggingFace video download failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`HuggingFace video download failed: ${response.status} ${response.statusText}`);
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
  const token = getApiToken();
  const modelConfig = MODEL_CONFIGS[request.modelId];
  if (!modelConfig) throw new Error(`No HuggingFace model config for modelId: ${request.modelId}`);

  const endpoint = `https://api-inference.huggingface.co/models/${modelConfig.model}`;
  const body = modelConfig.buildInput(request);

  log('info', 'Calling HuggingFace Inference API', { model: modelConfig.model, generationId: request.id });

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`HuggingFace API request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HuggingFace API failed: ${response.status} ${response.statusText} ${text}`);
  }

  // HF Inference returns the video binary directly for some models
  const contentType = response.headers.get('content-type') || 'video/mp4';
  if (!contentType.startsWith('video/')) {
    const text = await response.text();
    throw new Error(`HuggingFace API returned unexpected content type: ${contentType}. Response: ${text.slice(0, 200)}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  log('info', 'Video received from HuggingFace', { bytes: buffer.length, generationId: request.id });

  return uploadToStorage({ bucket, request, videoBuffer: buffer, contentType, fileName: 'result-hf.mp4' });
}

async function generateHuggingfaceVideo(options) {
  return generateRealVideo(options);
}

function getDiagnostics() {
  return { configured: isConfigured(), mockMode: isMockMode() };
}

module.exports = { generateHuggingfaceVideo, isMockMode, isConfigured, getDiagnostics };
