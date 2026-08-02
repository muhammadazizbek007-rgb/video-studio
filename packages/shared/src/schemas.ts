import { z } from 'zod';
import { CAMERA_MOTIONS, STYLE_PRESETS } from './models.js';

export const videoGenerationStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);

export const videoGenerationModeSchema = z.enum([
  'text_to_video',
  'image_to_video',
  'reference_to_video',
]);

export const videoAspectRatioSchema = z.enum(['16:9', '9:16', '1:1']);

export const videoDurationSchema = z.union([
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
]);

export const videoStylePresetSchema = z.enum(STYLE_PRESETS);

export const cameraMotionSchema = z.enum(CAMERA_MOTIONS);

export const videoElementCategorySchema = z.enum(['general', 'character', 'location', 'prop']);

export const userDtoSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  name: z.string(),
  picture: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type UserDto = z.infer<typeof userDtoSchema>;

export const elementRefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  handle: z.string().min(1),
  category: videoElementCategorySchema,
  imageUrl: z.string().optional(),
  description: z.string().optional(),
  role: z.enum(['visual', 'text']),
  imageIndex: z.number().int().min(1).optional(),
});
export type ElementRef = z.infer<typeof elementRefSchema>;

export const generationDtoSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  prompt: z.string(),
  enrichedPrompt: z.string().optional(),
  modelId: z.string().min(1),
  mode: videoGenerationModeSchema,
  aspectRatio: videoAspectRatioSchema,
  duration: videoDurationSchema,
  stylePreset: videoStylePresetSchema,
  cameraMotion: cameraMotionSchema,
  status: videoGenerationStatusSchema,
  resultVideoUrl: z.string().optional(),
  errorMessage: z.string().optional(),
  saved: z.boolean(),
  referenceImageUrls: z.array(z.string()),
  lastFrameImageUrl: z.string().optional(),
  elements: z.array(elementRefSchema),
  referenceCount: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type GenerationDto = z.infer<typeof generationDtoSchema>;

export const createGenerationSchema = z.object({
  prompt: z.string().min(1).max(8000),
  modelId: z.string().min(1),
  mode: videoGenerationModeSchema,
  aspectRatio: videoAspectRatioSchema,
  duration: videoDurationSchema,
  stylePreset: videoStylePresetSchema,
  cameraMotion: cameraMotionSchema,
  enrichedPrompt: z.string().max(16000).optional(),
  referenceImageUrls: z.array(z.string().min(1)).max(3).optional(),
  lastFrameImageUrl: z.string().min(1).optional(),
  elements: z.array(elementRefSchema).optional(),
});
export type CreateGenerationInput = z.infer<typeof createGenerationSchema>;

export const updateGenerationSchema = z.object({
  saved: z.boolean().optional(),
});
export type UpdateGenerationInput = z.infer<typeof updateGenerationSchema>;

export const elementDtoSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1),
  handle: z.string().min(1),
  category: videoElementCategorySchema,
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  storagePath: z.string().optional(),
  pinned: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ElementDto = z.infer<typeof elementDtoSchema>;

export const createElementSchema = z.object({
  name: z.string().min(1).max(80),
  category: videoElementCategorySchema,
  description: z.string().max(2000).optional(),
  imageUrl: z.string().optional(),
  storagePath: z.string().optional(),
});
export type CreateElementInput = z.infer<typeof createElementSchema>;

export const updateElementSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  category: videoElementCategorySchema.optional(),
  description: z.string().max(2000).optional(),
  imageUrl: z.string().optional(),
  storagePath: z.string().optional(),
  pinned: z.boolean().optional(),
});
export type UpdateElementInput = z.infer<typeof updateElementSchema>;

export const enrichPromptSchema = z.object({
  prompt: z.string().min(1).max(8000),
  stylePreset: videoStylePresetSchema,
  cameraMotion: cameraMotionSchema,
  mode: videoGenerationModeSchema,
  elements: z.array(elementRefSchema).optional(),
});
export type EnrichPromptInput = z.infer<typeof enrichPromptSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: z.string().min(1).optional(),
});
export type PaginationInput = z.infer<typeof paginationSchema>;
