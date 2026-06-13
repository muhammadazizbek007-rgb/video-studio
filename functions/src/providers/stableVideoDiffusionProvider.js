'use strict';

const {
  getHfToken, isHfTokenConfigured, hfInferencePost,
  parseHfResponse, uploadToStorage,
} = require('./hfInferenceHelper');

// SVD XT — image-to-video, 25 frames
const SVD_MODEL = 'stabilityai/stable-video-diffusion-img2vid-xt';

function isMockMode() {
  return false;
}

function isConfigured() {
  return isHfTokenConfigured();
}

function getDiagnostics() {
  return { configured: isConfigured(), mockMode: isMockMode(), model: SVD_MODEL };
}

function log(level, message, context) {
  console[level](`[SVDProvider] ${message}`, context || {});
}

function buildInput(request) {
  // SVD takes an image as input (URL or base64)
  // If no reference image is provided, use a placeholder color frame
  const imageInput = request.referenceImageUrl || '';
  if (!imageInput) {
    throw new Error('Stable Video Diffusion requires a reference image. Please upload a photo first.');
  }
  return {
    inputs: imageInput,
    parameters: {
      num_frames: 25,
      num_inference_steps: 25,
      min_guidance_scale: 1.0,
      max_guidance_scale: 3.0,
      fps: 7,
      motion_bucket_id: 127,
      noise_aug_strength: 0.02,
    },
  };
}

async function generateRealVideo({ bucket, request }) {
  const token = getHfToken();
  log('info', 'Calling SVD inference', { model: SVD_MODEL, generationId: request.id });

  const body = buildInput(request);
  const response = await hfInferencePost(SVD_MODEL, body, token, 600000);
  const { buffer, contentType } = await parseHfResponse(response, SVD_MODEL);

  log('info', 'Video received', { bytes: buffer.length, generationId: request.id });

  return uploadToStorage({
    bucket,
    userId: request.userId,
    generationId: request.id,
    buffer,
    contentType,
    fileName: 'result-svd.mp4',
  });
}

async function generateSvdVideo(options) {
  return generateRealVideo(options);
}

module.exports = { generateSvdVideo, isMockMode, isConfigured, getDiagnostics };
