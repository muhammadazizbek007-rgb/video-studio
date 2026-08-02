import type {
  CameraMotion,
  ModelCapabilities,
  VideoAspectRatio,
  VideoDuration,
  VideoModel,
  VideoStylePreset,
} from '../types/video';

// ─── Capability presets ───────────────────────────────────────────────────────

const NO_REFS: ModelCapabilities = {
  maxReferenceImages: 0,
  supportsMultiReference: false,
  referenceMode: 'none',
  supportsCharacterReference: false,
  supportsLocationReference: false,
  supportsPropReference: false,
};

const SINGLE_IMAGE: ModelCapabilities = {
  maxReferenceImages: 1,
  supportsMultiReference: false,
  referenceMode: 'single_image',
  supportsCharacterReference: false,
  supportsLocationReference: false,
  supportsPropReference: false,
};

/** Veo takes one starting frame; Veo 3.1 also accepts a final frame. */
const VEO_SINGLE_FRAME: ModelCapabilities = {
  maxReferenceImages: 1,
  supportsMultiReference: false,
  referenceMode: 'single_image',
  supportsCharacterReference: true,
  supportsLocationReference: true,
  supportsPropReference: false,
};

// ─── Video model registry ─────────────────────────────────────────────────────
// Every AI model here is Google. Model ids match the backend registries in
// functions/src/providers/google/veoProvider.js and workers/src/providers.ts.

export const videoModels: VideoModel[] = [

  // ── Google Veo (Vertex AI) ──────────────────────────────────────────────────
  {
    id: 'veo-3.1',
    name: 'Google Veo 3.1',
    provider: 'veo',
    status: 'active',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsReferenceVideo: false,
    supportsAudio: true,
    maxDuration: 8,
    supportedDurations: [4, 6, 8],
    aspectRatios: ['16:9', '9:16'],
    capabilities: VEO_SINGLE_FRAME,
    description: 'Максимальное качество, звук и диалоги, 1080p, первый и последний кадр',
  },
  {
    id: 'veo-3.1-fast',
    name: 'Google Veo 3.1 Fast',
    provider: 'veo',
    status: 'active',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsReferenceVideo: false,
    supportsAudio: true,
    maxDuration: 8,
    supportedDurations: [4, 6, 8],
    aspectRatios: ['16:9', '9:16'],
    capabilities: VEO_SINGLE_FRAME,
    description: 'Veo 3.1 быстрее, звук на месте — оптимальный выбор',
  },
  {
    id: 'veo-3.0',
    name: 'Google Veo 3',
    provider: 'veo',
    status: 'active',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsReferenceVideo: false,
    supportsAudio: true,
    maxDuration: 8,
    supportedDurations: [4, 6, 8],
    aspectRatios: ['16:9', '9:16'],
    capabilities: SINGLE_IMAGE,
    description: 'Veo 3 со звуком, 1080p',
  },
  {
    id: 'veo-3.0-fast',
    name: 'Google Veo 3 Fast',
    provider: 'veo',
    status: 'active',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsReferenceVideo: false,
    supportsAudio: true,
    maxDuration: 8,
    supportedDurations: [4, 6, 8],
    aspectRatios: ['16:9', '9:16'],
    capabilities: SINGLE_IMAGE,
    description: 'Быстрый Veo 3 со звуком',
  },
  {
    id: 'veo-2.0',
    name: 'Google Veo 2',
    provider: 'veo',
    status: 'active',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsReferenceVideo: false,
    supportsAudio: false,
    maxDuration: 8,
    supportedDurations: [5, 6, 7, 8],
    aspectRatios: ['16:9', '9:16'],
    capabilities: SINGLE_IMAGE,
    description: 'Veo 2, 720p, без звуковой дорожки',
  },

  // ── JSON2Video (шаблонное слайд-шоу, не ИИ-генерация) ───────────────────────
  {
    id: 'json2video',
    name: 'JSON2Video (слайд-шоу)',
    provider: 'json2video',
    status: 'active',
    supportsTextToVideo: false,
    supportsImageToVideo: true,
    supportsReferenceVideo: false,
    supportsAudio: false,
    maxDuration: 15,
    supportedDurations: [5, 10, 15],
    aspectRatios: ['9:16', '16:9', '1:1'],
    capabilities: SINGLE_IMAGE,
    description: 'Шаблонное видео из фото + текст. Не ИИ-генерация.',
  },
];

/** Default selection — best balance of quality and speed among the active models. */
export const defaultVideoModelId = 'veo-3.1-fast';

export function getVideoModel(modelId: string): VideoModel | undefined {
  return videoModels.find((model) => model.id === modelId);
}

/** Durations the given model accepts; falls back to the global list. */
export function getDurationsForModel(modelId: string): VideoDuration[] {
  return getVideoModel(modelId)?.supportedDurations ?? durations;
}

/** Aspect ratios the given model accepts; falls back to the global list. */
export function getAspectRatiosForModel(modelId: string): VideoAspectRatio[] {
  return getVideoModel(modelId)?.aspectRatios ?? aspectRatios;
}

/** Snaps a duration to the nearest value the model supports. */
export function clampDurationToModel(modelId: string, duration: VideoDuration): VideoDuration {
  const allowed = getDurationsForModel(modelId);
  if (allowed.includes(duration)) return duration;
  return allowed.reduce(
    (closest, candidate) => (Math.abs(candidate - duration) < Math.abs(closest - duration) ? candidate : closest),
    allowed[0],
  );
}

/** Falls back to the model's first aspect ratio when the current one is unsupported. */
export function clampAspectRatioToModel(modelId: string, aspectRatio: VideoAspectRatio): VideoAspectRatio {
  const allowed = getAspectRatiosForModel(modelId);
  return allowed.includes(aspectRatio) ? aspectRatio : allowed[0];
}

// ─── Image model registry (Google only) ───────────────────────────────────────

export interface ImageModel {
  id: string;
  name: string;
  /** 'generate' creates from text, 'edit' transforms an existing image */
  kind: 'generate' | 'edit';
  aspectRatios: string[];
  description: string;
}

export const imageModels: ImageModel[] = [
  {
    id: 'imagen-4',
    name: 'Google Imagen 4',
    kind: 'generate',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    description: 'Фотореализм и корректный текст на изображении',
  },
  {
    id: 'imagen-4-fast',
    name: 'Google Imagen 4 Fast',
    kind: 'generate',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    description: 'Быстрее, качество чуть ниже',
  },
  {
    id: 'imagen-4-ultra',
    name: 'Google Imagen 4 Ultra',
    kind: 'generate',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    description: 'Максимальное качество Imagen 4',
  },
  {
    id: 'imagen-3',
    name: 'Google Imagen 3',
    kind: 'generate',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    description: 'Предыдущее поколение Imagen',
  },
  {
    id: 'gemini-image',
    name: 'Google Gemini Image',
    kind: 'edit',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    description: 'Редактирование готового фото текстом — фон, объекты, стиль',
  },
];

export const defaultImageModelId = 'imagen-4';

// ─── Shared option lists ──────────────────────────────────────────────────────

export const videoModes = [
  { id: 'text_to_video', label: 'Text to Video' },
  { id: 'image_to_video', label: 'Image to Video' },
  { id: 'reference_to_video', label: 'Reference to Video' },
] as const;

export const aspectRatios: VideoAspectRatio[] = ['9:16', '16:9', '1:1'];
export const durations: VideoDuration[] = [4, 6, 8];
export const stylePresets: VideoStylePreset[] = [
  'Cinematic', 'UGC', 'App Promo', 'AI Social Platform Ad',
  'School Viral Reel', 'Product Demo', 'Character Story',
];
export const cameraMotions: CameraMotion[] = ['Static', 'Zoom in', 'Dolly in', 'Handheld', 'Orbit', 'Pan'];
