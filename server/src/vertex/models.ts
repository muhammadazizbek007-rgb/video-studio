import { HttpError } from '../errors.js';

export interface VeoModelSpec {
  vertexModel: string;
  supportedDurations: number[];
  defaultDuration: number;
  aspectRatios: string[];
  supportsImageToVideo: boolean;
  supportsAudio: boolean;
  maxResolution: string;
}

export const VEO_MODELS: Readonly<Record<string, VeoModelSpec>> = {
  'veo-3.1': {
    vertexModel: 'veo-3.1-generate-preview',
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true,
    supportsAudio: true,
    maxResolution: '1080p',
  },
  'veo-3.1-fast': {
    vertexModel: 'veo-3.1-fast-generate-preview',
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true,
    supportsAudio: true,
    maxResolution: '1080p',
  },
  'veo-3.0': {
    vertexModel: 'veo-3.0-generate-001',
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true,
    supportsAudio: true,
    maxResolution: '1080p',
  },
  'veo-3.0-fast': {
    vertexModel: 'veo-3.0-fast-generate-001',
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true,
    supportsAudio: true,
    maxResolution: '1080p',
  },
  'veo-2.0': {
    vertexModel: 'veo-2.0-generate-001',
    supportedDurations: [5, 6, 7, 8],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true,
    supportsAudio: false,
    maxResolution: '720p',
  },
};

export const VEO_MODEL_IDS: readonly string[] = Object.keys(VEO_MODELS);

export interface ImageModelSpec {
  vertexModel: string;
  kind: 'imagen' | 'gemini';
  supportsEditing: boolean;
}

export const IMAGE_MODELS: Readonly<Record<string, ImageModelSpec>> = {
  'imagen-4': { vertexModel: 'imagen-4.0-generate-001', kind: 'imagen', supportsEditing: false },
  'imagen-4-fast': { vertexModel: 'imagen-4.0-fast-generate-001', kind: 'imagen', supportsEditing: false },
  'imagen-4-ultra': { vertexModel: 'imagen-4.0-ultra-generate-001', kind: 'imagen', supportsEditing: false },
  'imagen-3': { vertexModel: 'imagen-3.0-generate-002', kind: 'imagen', supportsEditing: false },
  'gemini-image': { vertexModel: 'gemini-2.5-flash-image', kind: 'gemini', supportsEditing: true },
};

export const IMAGE_MODEL_IDS: readonly string[] = Object.keys(IMAGE_MODELS);

export const DEFAULT_IMAGE_MODEL = 'imagen-4';

export function getVeoModel(id: string): VeoModelSpec {
  const spec = VEO_MODELS[id];
  if (!spec) {
    throw new HttpError(
      'invalid-argument',
      `Unknown Veo model: ${id}. Available: ${VEO_MODEL_IDS.join(', ')}.`,
    );
  }
  return spec;
}

const DEFAULT_ASPECT_RATIO = '16:9';

export function resolveAspectRatio(spec: VeoModelSpec, requested: string): string {
  const wanted = requested.trim() || DEFAULT_ASPECT_RATIO;
  if (spec.aspectRatios.includes(wanted)) return wanted;
  throw new HttpError(
    'invalid-argument',
    `Veo does not support the ${wanted} aspect ratio. Available: ${spec.aspectRatios.join(', ')}.`,
  );
}

/**
 * Snaps instead of rejecting: the UI offers a continuous duration slider, and a
 * one-second mismatch is not worth failing a generation the user already paid for.
 */
export function resolveDuration(spec: VeoModelSpec, requested: number): number {
  if (!Number.isFinite(requested)) return spec.defaultDuration;

  let closest = spec.defaultDuration;
  let smallestGap = Number.POSITIVE_INFINITY;
  for (const candidate of spec.supportedDurations) {
    const gap = Math.abs(candidate - requested);
    if (gap < smallestGap) {
      smallestGap = gap;
      closest = candidate;
    }
  }
  return closest;
}
