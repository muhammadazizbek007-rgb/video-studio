'use strict';

/**
 * Google image generation via Vertex AI.
 *
 *  - Imagen        (:predict)        — text-to-image from scratch
 *  - Gemini Image  (:generateContent) — conversational editing of an existing image
 *                                       (the model publicly known as "Nano Banana")
 *
 * Both return raw bytes; the result is uploaded to Firebase Storage when a bucket
 * is supplied, otherwise a data URL is returned so callers without storage still work.
 */

const crypto = require('crypto');
const { callVertex, isConfigured } = require('./vertexClient');

const IMAGE_MODELS = Object.freeze({
  'imagen-4': {
    vertexModel: 'imagen-4.0-generate-001',
    kind: 'imagen',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    supportsEditing: false,
  },
  'imagen-4-fast': {
    vertexModel: 'imagen-4.0-fast-generate-001',
    kind: 'imagen',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    supportsEditing: false,
  },
  'imagen-4-ultra': {
    vertexModel: 'imagen-4.0-ultra-generate-001',
    kind: 'imagen',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    supportsEditing: false,
  },
  'imagen-3': {
    vertexModel: 'imagen-3.0-generate-002',
    kind: 'imagen',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    supportsEditing: false,
  },
  'gemini-image': {
    vertexModel: 'gemini-2.5-flash-image',
    kind: 'gemini',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    supportsEditing: true,
  },
});

const IMAGE_MODEL_IDS = Object.keys(IMAGE_MODELS);
const DEFAULT_IMAGE_MODEL = 'imagen-4';

function log(level, message, context) {
  console[level](`[ImagenProvider] ${message}`, context || {});
}

function getModelSpec(modelId) {
  const spec = IMAGE_MODELS[modelId || DEFAULT_IMAGE_MODEL];
  if (!spec) throw new Error(`Unknown Google image model: ${modelId}`);
  return spec;
}

function getStorageDownloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

async function toInlineImage(imageUrl) {
  const url = String(imageUrl || '').trim();
  if (!url) return null;

  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
    if (!match) throw new Error('Source image data URL is malformed.');
    const [, mimeType, isBase64, payload] = match;
    const data = isBase64 ? payload : Buffer.from(decodeURIComponent(payload)).toString('base64');
    return { mimeType: mimeType || 'image/png', data };
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download source image: ${response.status} ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { mimeType: response.headers.get('content-type') || 'image/png', data: buffer.toString('base64') };
}

async function generateWithImagen({ spec, prompt, aspectRatio, sampleCount, negativePrompt }) {
  const parameters = {
    sampleCount: Math.min(Math.max(Number(sampleCount) || 1, 1), 4),
    aspectRatio: spec.aspectRatios.includes(aspectRatio) ? aspectRatio : '1:1',
    personGeneration: 'allow_adult',
  };
  if (negativePrompt) parameters.negativePrompt = String(negativePrompt);

  const payload = await callVertex(spec.vertexModel, ':predict', {
    instances: [{ prompt }],
    parameters,
  });

  const prediction = (payload.predictions || [])[0];
  if (!prediction?.bytesBase64Encoded) {
    const blocked = prediction?.raiFilteredReason || payload.raiFilteredReason;
    if (blocked) throw new Error(`Imagen blocked the request: ${blocked}`);
    throw new Error(`Imagen returned no image. Response: ${JSON.stringify(payload).slice(0, 400)}`);
  }

  return {
    buffer: Buffer.from(prediction.bytesBase64Encoded, 'base64'),
    contentType: prediction.mimeType || 'image/png',
  };
}

async function generateWithGemini({ spec, prompt, sourceImageUrl }) {
  const parts = [{ text: prompt }];
  if (sourceImageUrl) {
    const inline = await toInlineImage(sourceImageUrl);
    if (inline) parts.push({ inlineData: inline });
  }

  const payload = await callVertex(spec.vertexModel, ':generateContent', {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });

  const candidate = (payload.candidates || [])[0];
  const imagePart = (candidate?.content?.parts || []).find((part) => part.inlineData?.data);

  if (!imagePart) {
    const reason = candidate?.finishReason || payload.promptFeedback?.blockReason;
    throw new Error(`Gemini image model returned no image${reason ? ` (${reason})` : ''}.`);
  }

  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    contentType: imagePart.inlineData.mimeType || 'image/png',
  };
}

async function uploadToStorage({ bucket, userId, generationId, buffer, contentType }) {
  const extension = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
  const destinationPath = `image-generations/${userId || 'anonymous'}/${generationId}/result.${extension}`;
  const downloadToken = crypto.randomUUID();

  await bucket.file(destinationPath).save(buffer, {
    resumable: false,
    contentType,
    metadata: {
      cacheControl: 'private, max-age=3600',
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
  });

  return {
    imageUrl: getStorageDownloadUrl(bucket.name, destinationPath, downloadToken),
    storagePath: destinationPath,
  };
}

/**
 * @param {object} params
 * @param {string} params.prompt
 * @param {string} [params.model]           key of IMAGE_MODELS
 * @param {string} [params.aspect_ratio]
 * @param {string} [params.sourceImageUrl]  triggers Gemini editing mode
 * @param {object} [params.bucket]          Firebase Storage bucket; omit to get a data URL
 */
async function generateImage(params = {}) {
  const prompt = String(params.prompt || '').trim();
  if (!prompt) throw new Error('prompt is required for image generation.');

  // Editing an existing image only works with the Gemini image model
  const requestedModel = params.sourceImageUrl && !getModelSpec(params.model).supportsEditing
    ? 'gemini-image'
    : (params.model || DEFAULT_IMAGE_MODEL);

  const spec = getModelSpec(requestedModel);
  const generationId = String(params.generationId || crypto.randomUUID());

  log('info', 'Generating image', { model: requestedModel, vertexModel: spec.vertexModel, editing: Boolean(params.sourceImageUrl) });

  const result = spec.kind === 'gemini'
    ? await generateWithGemini({ spec, prompt, sourceImageUrl: params.sourceImageUrl })
    : await generateWithImagen({
        spec,
        prompt,
        aspectRatio: params.aspect_ratio || '1:1',
        sampleCount: params.sampleCount,
        negativePrompt: params.negativePrompt,
      });

  if (params.bucket) {
    const uploaded = await uploadToStorage({
      bucket: params.bucket,
      userId: params.userId,
      generationId,
      buffer: result.buffer,
      contentType: result.contentType,
    });
    return { ...uploaded, model: requestedModel, generationId };
  }

  return {
    imageUrl: `data:${result.contentType};base64,${result.buffer.toString('base64')}`,
    model: requestedModel,
    generationId,
  };
}

function getDiagnostics() {
  return { configured: isConfigured(), mockMode: false, models: IMAGE_MODEL_IDS };
}

module.exports = {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  IMAGE_MODEL_IDS,
  generateImage,
  getDiagnostics,
  getModelSpec,
  isConfigured,
};
