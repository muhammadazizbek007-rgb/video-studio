import type { CameraMotion, VideoAspectRatio, VideoDuration, VideoStylePreset } from './types.js';

export interface VeoModelSpec {
  id: string;
  name: string;
  vertexModel: string;
  description: string;
  supportedDurations: VideoDuration[];
  defaultDuration: VideoDuration;
  aspectRatios: VideoAspectRatio[];
  supportsImageToVideo: boolean;
  supportsAudio: boolean;
  supportsLastFrame: boolean;
  maxResolution: string;
}

export const VEO_MODELS: Readonly<Record<string, VeoModelSpec>> = {
  'veo-3.1': {
    id: 'veo-3.1',
    name: 'Google Veo 3.1',
    vertexModel: 'veo-3.1-generate-001',
    description: 'Максимальное качество, звук и диалоги, 1080p, первый и последний кадр',
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true,
    supportsAudio: true,
    supportsLastFrame: true,
    maxResolution: '1080p',
  },
  'veo-3.1-fast': {
    id: 'veo-3.1-fast',
    name: 'Google Veo 3.1 Fast',
    vertexModel: 'veo-3.1-fast-generate-001',
    description: 'Veo 3.1 быстрее, звук на месте — оптимальный выбор',
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true,
    supportsAudio: true,
    supportsLastFrame: true,
    maxResolution: '1080p',
  },
  'veo-3.0': {
    id: 'veo-3.0',
    name: 'Google Veo 3',
    vertexModel: 'veo-3.0-generate-001',
    description: 'Veo 3 со звуком, 1080p',
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true,
    supportsAudio: true,
    supportsLastFrame: false,
    maxResolution: '1080p',
  },
  'veo-3.0-fast': {
    id: 'veo-3.0-fast',
    name: 'Google Veo 3 Fast',
    vertexModel: 'veo-3.0-fast-generate-001',
    description: 'Быстрый Veo 3 со звуком',
    supportedDurations: [4, 6, 8],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true,
    supportsAudio: true,
    supportsLastFrame: false,
    maxResolution: '1080p',
  },
  'veo-2.0': {
    id: 'veo-2.0',
    name: 'Google Veo 2',
    vertexModel: 'veo-2.0-generate-001',
    description: 'Veo 2, 720p, без звуковой дорожки',
    supportedDurations: [5, 6, 7, 8],
    defaultDuration: 8,
    aspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true,
    supportsAudio: false,
    supportsLastFrame: false,
    maxResolution: '720p',
  },
};

export const VIDEO_MODEL_LIST: readonly VeoModelSpec[] = Object.values(VEO_MODELS);

export const VIDEO_MODEL_IDS: readonly string[] = Object.keys(VEO_MODELS);

export const DEFAULT_VIDEO_MODEL_ID = 'veo-3.1-fast';

export interface ImageModelSpec {
  id: string;
  name: string;
  vertexModel: string;
  kind: 'imagen' | 'gemini';
  supportsEditing: boolean;
  description: string;
}

export const IMAGE_MODELS: Readonly<Record<string, ImageModelSpec>> = {
  'imagen-4': {
    id: 'imagen-4',
    name: 'Google Imagen 4',
    vertexModel: 'imagen-4.0-generate-001',
    kind: 'imagen',
    supportsEditing: false,
    description: 'Фотореализм и корректный текст на изображении',
  },
  'imagen-4-fast': {
    id: 'imagen-4-fast',
    name: 'Google Imagen 4 Fast',
    vertexModel: 'imagen-4.0-fast-generate-001',
    kind: 'imagen',
    supportsEditing: false,
    description: 'Быстрее, качество чуть ниже',
  },
  'imagen-4-ultra': {
    id: 'imagen-4-ultra',
    name: 'Google Imagen 4 Ultra',
    vertexModel: 'imagen-4.0-ultra-generate-001',
    kind: 'imagen',
    supportsEditing: false,
    description: 'Максимальное качество Imagen 4',
  },
  'imagen-3': {
    id: 'imagen-3',
    name: 'Google Imagen 3',
    vertexModel: 'imagen-3.0-generate-002',
    kind: 'imagen',
    supportsEditing: false,
    description: 'Предыдущее поколение Imagen',
  },
  'gemini-image': {
    id: 'gemini-image',
    name: 'Google Gemini Image',
    vertexModel: 'gemini-2.5-flash-image',
    kind: 'gemini',
    supportsEditing: true,
    description: 'Редактирование готового фото текстом — фон, объекты, стиль',
  },
};

export const IMAGE_MODEL_LIST: readonly ImageModelSpec[] = Object.values(IMAGE_MODELS);

export const DEFAULT_IMAGE_MODEL_ID = 'imagen-4';

export const STYLE_PRESETS = [
  'Cinematic',
  'UGC',
  'App Promo',
  'Product Demo',
  'Character Story',
  'Social Ad',
] as const satisfies readonly VideoStylePreset[];

export const CAMERA_MOTIONS = [
  'Static',
  'Zoom in',
  'Dolly in',
  'Handheld',
  'Orbit',
  'Pan',
] as const satisfies readonly CameraMotion[];

export const VIDEO_DURATIONS = [4, 5, 6, 7, 8] as const satisfies readonly VideoDuration[];

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const satisfies readonly VideoAspectRatio[];

export function getVeoModel(id: string): VeoModelSpec | undefined {
  return VEO_MODELS[id];
}

export function requireVeoModel(id: string): VeoModelSpec {
  const spec = VEO_MODELS[id];
  if (!spec) {
    throw new Error(`Unknown Veo model: ${id}. Available: ${VIDEO_MODEL_IDS.join(', ')}.`);
  }
  return spec;
}

const DEFAULT_ASPECT_RATIO: VideoAspectRatio = '16:9';

export function resolveAspectRatio(spec: VeoModelSpec, requested: string): VideoAspectRatio {
  const wanted = requested.trim() || DEFAULT_ASPECT_RATIO;
  const match = spec.aspectRatios.find((ratio) => ratio === wanted);
  if (match) return match;
  const available = spec.aspectRatios.join(', ');
  throw new Error(
    `Model ${spec.id} does not support the ${wanted} aspect ratio. Available: ${available}.`,
  );
}

/**
 * Snaps instead of rejecting: the UI offers a near-continuous duration control and a
 * one-second mismatch is not worth failing a generation over.
 */
export function resolveDuration(spec: VeoModelSpec, requested: number): VideoDuration {
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
