import { HttpError } from '../errors.js';
import { uploadBuffer } from '../firebase.js';
import { callVertex } from './client.js';
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS, type ImageModelSpec } from './models.js';

export interface ImageRequest {
  jobId: string;
  userId: string;
  prompt: string;
  model?: string;
  aspectRatio?: string;
  sourceImageUrl?: string;
}

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

const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png',
};

/** Vertex only accepts inline bytes, so http(s) sources are downloaded first. */
async function loadInlineImage(imageUrl: string): Promise<{ data: string; mimeType: string }> {
  const url = imageUrl.trim();

  if (url.startsWith('data:')) {
    const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
    if (!match) {
      throw new HttpError('invalid-argument', 'sourceImageUrl is a malformed data URL.');
    }
    const [, mimeType = 'image/jpeg', base64Marker, payload = ''] = match;
    const data = base64Marker
      ? payload
      : Buffer.from(decodeURIComponent(payload), 'utf8').toString('base64');
    return { data, mimeType };
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new HttpError('invalid-argument', `Failed to download sourceImageUrl: ${res.status}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  return {
    data: bytes.toString('base64'),
    mimeType: res.headers.get('content-type') ?? 'image/jpeg',
  };
}

async function renderWithGemini(spec: ImageModelSpec, req: ImageRequest, prompt: string): Promise<RenderedImage> {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (req.sourceImageUrl) {
    const inline = await loadInlineImage(req.sourceImageUrl);
    parts.push({ inlineData: { mimeType: inline.mimeType, data: inline.data } });
  }

  const payload = await callVertex<GeminiResponse>(spec.vertexModel, ':generateContent', {
    contents: [{ role: 'user', parts }],
    // TEXT must stay alongside IMAGE: the model rejects an image-only modality list.
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });

  const inlineData = payload.candidates
    ?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
  if (!inlineData?.data) {
    throw new HttpError('failed-precondition', 'The Gemini image model returned no image.');
  }

  return {
    data: Buffer.from(inlineData.data, 'base64'),
    contentType: inlineData.mimeType ?? 'image/png',
  };
}

async function renderWithImagen(spec: ImageModelSpec, req: ImageRequest, prompt: string): Promise<RenderedImage> {
  const requested = req.aspectRatio ?? '';
  const aspectRatio = SUPPORTED_ASPECT_RATIOS.includes(requested) ? requested : '1:1';

  const payload = await callVertex<ImagenResponse>(spec.vertexModel, ':predict', {
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio, personGeneration: 'allow_adult' },
  });

  const prediction = payload.predictions?.[0];
  if (!prediction?.bytesBase64Encoded) {
    // Imagen answers 200 with a filter reason instead of an error when it blocks a prompt.
    if (prediction?.raiFilteredReason) {
      throw new HttpError(
        'failed-precondition',
        `Imagen blocked this prompt: ${prediction.raiFilteredReason}`,
      );
    }
    throw new HttpError('failed-precondition', 'Imagen returned no image.');
  }

  return {
    data: Buffer.from(prediction.bytesBase64Encoded, 'base64'),
    contentType: prediction.mimeType ?? 'image/png',
  };
}

export async function generateImage(
  req: ImageRequest,
): Promise<{ imageUrl: string; storagePath: string; model: string }> {
  const prompt = req.prompt.trim();
  if (!prompt) {
    throw new HttpError('invalid-argument', 'prompt is required for image generation.');
  }

  // Editing an existing image is only supported by the Gemini model, so a source
  // image overrides whatever model the caller asked for.
  const modelId = req.sourceImageUrl ? 'gemini-image' : (req.model ?? DEFAULT_IMAGE_MODEL);
  const spec = IMAGE_MODELS[modelId];
  if (!spec) {
    throw new HttpError('invalid-argument', `Unknown image model: ${modelId}`);
  }

  const rendered = spec.kind === 'gemini'
    ? await renderWithGemini(spec, req, prompt)
    : await renderWithImagen(spec, req, prompt);

  const extension = EXTENSION_BY_CONTENT_TYPE[rendered.contentType.split(';')[0]!.trim().toLowerCase()] ?? 'png';
  const stored = await uploadBuffer({
    path: `image-generations/${req.userId}/${req.jobId}/result.${extension}`,
    data: rendered.data,
    contentType: rendered.contentType,
  });

  return { imageUrl: stored.downloadUrl, storagePath: stored.storagePath, model: modelId };
}
