import { randomUUID } from 'node:crypto';
import type { ImageModelSpec } from '@video-studio/shared';
import { IMAGE_MODELS } from '@video-studio/shared';
import { getEnv } from '../env.js';
import { ApiError } from '../errors.js';
import { getStorage } from '../storage/index.js';
import { callVertex } from './client.js';
import { generateFakeImage } from './fake.js';

interface RenderedImage {
  data: Buffer;
  contentType: string;
}

interface ImagenPrediction {
  bytesBase64Encoded?: string;
  mimeType?: string;
  raiFilteredReason?: string;
}

interface ImagenResponse {
  predictions?: ImagenPrediction[];
}

interface GeminiInlineData {
  data?: string;
  mimeType?: string;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ inlineData?: GeminiInlineData }> } }>;
}

const SUPPORTED_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const DEFAULT_ASPECT_RATIO = '1:1';

async function renderWithGemini(spec: ImageModelSpec, prompt: string): Promise<RenderedImage> {
  const payload = await callVertex<GeminiResponse>(spec.vertexModel, ':generateContent', {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    // TEXT must stay alongside IMAGE: the model rejects an image-only modality list.
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });

  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const inlineData = parts.find((part) => part.inlineData?.data)?.inlineData;
  if (!inlineData?.data) {
    throw new ApiError('invalid-argument', 'The Gemini image model returned no image.');
  }

  return {
    data: Buffer.from(inlineData.data, 'base64'),
    contentType: inlineData.mimeType ?? 'image/png',
  };
}

async function renderWithImagen(
  spec: ImageModelSpec,
  prompt: string,
  requestedAspectRatio: string,
): Promise<RenderedImage> {
  const aspectRatio = SUPPORTED_ASPECT_RATIOS.includes(requestedAspectRatio)
    ? requestedAspectRatio
    : DEFAULT_ASPECT_RATIO;

  const payload = await callVertex<ImagenResponse>(spec.vertexModel, ':predict', {
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio, personGeneration: 'allow_adult' },
  });

  const prediction = payload.predictions?.[0];
  if (!prediction?.bytesBase64Encoded) {
    // Imagen answers 200 with a filter reason instead of an error when it blocks a prompt.
    if (prediction?.raiFilteredReason) {
      throw new ApiError(
        'invalid-argument',
        `Imagen blocked this prompt: ${prediction.raiFilteredReason}`,
      );
    }
    throw new ApiError('invalid-argument', 'Imagen returned no image.');
  }

  return {
    data: Buffer.from(prediction.bytesBase64Encoded, 'base64'),
    contentType: prediction.mimeType ?? 'image/png',
  };
}

export async function generateImage(args: {
  userId: string;
  prompt: string;
  modelId: string;
  aspectRatio?: string;
}): Promise<{ imageUrl: string; storagePath: string }> {
  const prompt = args.prompt.trim();
  if (!prompt) {
    throw new ApiError('invalid-argument', 'A prompt is required for image generation.');
  }

  const spec = IMAGE_MODELS[args.modelId];
  if (!spec) {
    throw new ApiError('invalid-argument', `Unknown image model: ${args.modelId}`);
  }

  const imageId = randomUUID();
  if (getEnv().fakeVertex) return generateFakeImage({ userId: args.userId, imageId });

  const rendered =
    spec.kind === 'gemini'
      ? await renderWithGemini(spec, prompt)
      : await renderWithImagen(spec, prompt, args.aspectRatio ?? DEFAULT_ASPECT_RATIO);

  const stored = await getStorage().save({
    key: `images/${args.userId}/${imageId}.png`,
    data: rendered.data,
    contentType: rendered.contentType,
  });

  return { imageUrl: stored.url, storagePath: stored.path };
}
