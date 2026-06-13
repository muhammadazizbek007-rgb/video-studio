'use strict';

const {
  getHfToken, isHfTokenConfigured, hfInferencePost,
  parseHfResponse, uploadToStorage,
} = require('./hfInferenceHelper');

// LTX-Video is optimised for fast, high-quality short-form vertical video
const LTX_MODEL = 'Lightricks/LTX-Video';

function isMockMode() {
  return false;
}

function isConfigured() {
  return isHfTokenConfigured();
}

function getDiagnostics() {
  return { configured: isConfigured(), mockMode: isMockMode(), model: LTX_MODEL };
}

function log(level, message, context) {
  console[level](`[LTXVideoProvider] ${message}`, context || {});
}

function buildInput(request) {
  // LTX-Video supports text-to-video and image-to-video
  const numFrames = request.duration <= 5 ? 97 : 161; // 25fps
  return {
    inputs: request.prompt,
    parameters: {
      num_frames: numFrames,
      num_inference_steps: 30,
      guidance_scale: 3.5,
      height: request.aspectRatio === '9:16' ? 704 : request.aspectRatio === '1:1' ? 512 : 480,
      width: request.aspectRatio === '9:16' ? 480 : request.aspectRatio === '1:1' ? 512 : 704,
      ...(request.referenceImageUrl ? { image: request.referenceImageUrl } : {}),
    },
  };
}

async function generateRealVideo({ bucket, request }) {
  const token = getHfToken();
  log('info', 'Calling LTX-Video inference', { model: LTX_MODEL, generationId: request.id });

  const body = buildInput(request);
  const response = await hfInferencePost(LTX_MODEL, body, token, 600000);
  const { buffer, contentType } = await parseHfResponse(response, LTX_MODEL);

  log('info', 'Video received', { bytes: buffer.length, generationId: request.id });

  return uploadToStorage({
    bucket,
    userId: request.userId,
    generationId: request.id,
    buffer,
    contentType,
    fileName: 'result-ltx.mp4',
  });
}

async function generateLtxVideo(options) {
  return generateRealVideo(options);
}

module.exports = { generateLtxVideo, isMockMode, isConfigured, getDiagnostics };
