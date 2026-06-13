'use strict';

const {
  getHfToken, isHfTokenConfigured, hfInferencePost,
  parseHfResponse, uploadToStorage,
} = require('./hfInferenceHelper');

// zai-org/CogVideoX-5b is the recommended open-source variant
const COGVIDEOX_MODEL = 'zai-org/CogVideoX-5b';

function isMockMode() {
  return false;
}

function isConfigured() {
  return isHfTokenConfigured();
}

function getDiagnostics() {
  return { configured: isConfigured(), mockMode: isMockMode(), model: COGVIDEOX_MODEL };
}

function log(level, message, context) {
  console[level](`[CogVideoXProvider] ${message}`, context || {});
}

function buildInput(request) {
  const numFrames = request.duration <= 5 ? 49 : 97;
  return {
    inputs: request.prompt,
    parameters: {
      num_frames: numFrames,
      num_inference_steps: 25,
      guidance_scale: 7.0,
      ...(request.referenceImageUrl ? { image: request.referenceImageUrl } : {}),
    },
  };
}

async function generateRealVideo({ bucket, request }) {
  const token = getHfToken();
  log('info', 'Calling CogVideoX inference', { model: COGVIDEOX_MODEL, generationId: request.id });

  const body = buildInput(request);
  const response = await hfInferencePost(COGVIDEOX_MODEL, body, token, 600000);
  const { buffer, contentType } = await parseHfResponse(response, COGVIDEOX_MODEL);

  log('info', 'Video received', { bytes: buffer.length, generationId: request.id });

  return uploadToStorage({
    bucket,
    userId: request.userId,
    generationId: request.id,
    buffer,
    contentType,
    fileName: 'result-cogvideox.mp4',
  });
}

async function generateCogVideoXVideo(options) {
  return generateRealVideo(options);
}

module.exports = { generateCogVideoXVideo, isMockMode, isConfigured, getDiagnostics };
