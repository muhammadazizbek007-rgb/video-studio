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

/**
 * Image generation — the Cinema Studio tab's Image mode.
 *
 * Imagen answers in seconds rather than minutes, so unlike a video generation this is a
 * request/response: the record is written already finished. `finalPrompt` is kept because
 * the style preset is folded into the prompt server-side, and without it there is no way
 * to tell what the model was actually asked for.
 */

export const imageAspectRatioSchema = z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']);
export type ImageAspectRatio = z.infer<typeof imageAspectRatioSchema>;

export const imageGenerationStatusSchema = z.enum(['completed', 'failed']);

export const imageGenerationDtoSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  prompt: z.string(),
  finalPrompt: z.string(),
  modelId: z.string().min(1),
  aspectRatio: imageAspectRatioSchema,
  stylePreset: videoStylePresetSchema,
  status: imageGenerationStatusSchema,
  imageUrl: z.string().optional(),
  errorMessage: z.string().optional(),
  createdAt: z.iso.datetime(),
});
export type ImageGenerationDto = z.infer<typeof imageGenerationDtoSchema>;

export const createImageGenerationSchema = z.object({
  prompt: z.string().min(1).max(8000),
  modelId: z.string().min(1),
  aspectRatio: imageAspectRatioSchema,
  stylePreset: videoStylePresetSchema,
});
export type CreateImageGenerationInput = z.infer<typeof createImageGenerationSchema>;

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

/**
 * Storyboards — the Cinema Studio tab's unit of work.
 *
 * A storyboard owns an ordered list of segments; each segment carries the frames it was
 * built from and, once generated, the clip itself. Generations stay the single record of
 * "something was sent to Veo" and are linked back by id, so history and storyboards never
 * disagree about what was produced.
 */

export const MAX_STORYBOARD_SEGMENTS = 12;

/**
 * A file in our own storage. `path` is the storage key: the server needs it to delete the
 * object later, and without it every replaced frame would leak a file on disk forever.
 */
export const storedFileSchema = z.object({
  url: z.string().min(1),
  path: z.string().min(1).optional(),
});
export type StoredFile = z.infer<typeof storedFileSchema>;

export const storyboardExportStatusSchema = z.enum(['idle', 'processing', 'completed', 'failed']);
export type StoryboardExportStatus = z.infer<typeof storyboardExportStatusSchema>;

export const storyboardSegmentDtoSchema = z.object({
  index: z.number().int().min(0),
  firstFrameUrl: z.string().optional(),
  lastFrameUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  durationSeconds: z.number().positive().optional(),
  generationId: z.string().optional(),
  /** Mirrored from the linked generation so one storyboard read tells the client everything. */
  status: videoGenerationStatusSchema.optional(),
  errorMessage: z.string().optional(),
});
export type StoryboardSegmentDto = z.infer<typeof storyboardSegmentDtoSchema>;

export const storyboardDtoSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  title: z.string(),
  prompt: z.string(),
  modelId: z.string().min(1),
  aspectRatio: videoAspectRatioSchema,
  duration: videoDurationSchema,
  stylePreset: videoStylePresetSchema,
  cameraMotion: cameraMotionSchema,
  segments: z.array(storyboardSegmentDtoSchema),
  exportStatus: storyboardExportStatusSchema,
  exportUrl: z.string().optional(),
  exportError: z.string().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StoryboardDto = z.infer<typeof storyboardDtoSchema>;

const storyboardSettingsShape = {
  title: z.string().max(200).optional(),
  prompt: z.string().max(8000).optional(),
  modelId: z.string().min(1).optional(),
  aspectRatio: videoAspectRatioSchema.optional(),
  duration: videoDurationSchema.optional(),
  stylePreset: videoStylePresetSchema.optional(),
  cameraMotion: cameraMotionSchema.optional(),
};

export const createStoryboardSchema = z.object({
  ...storyboardSettingsShape,
  segmentCount: z.number().int().min(1).max(MAX_STORYBOARD_SEGMENTS).optional(),
});
export type CreateStoryboardInput = z.infer<typeof createStoryboardSchema>;

export const updateStoryboardSchema = z.object({
  ...storyboardSettingsShape,
  /** Growing appends empty segments; shrinking drops the trailing ones and their uploads. */
  segmentCount: z.number().int().min(1).max(MAX_STORYBOARD_SEGMENTS).optional(),
});
export type UpdateStoryboardInput = z.infer<typeof updateStoryboardSchema>;

/**
 * Absent means "leave as it is", `null` means "clear it", an object means "set it" — the
 * three states a slot can be moved between, distinguishable in one request shape.
 */
const slotPatchSchema = z.union([storedFileSchema, z.null()]).optional();

export const updateStoryboardSegmentSchema = z.object({
  firstFrame: slotPatchSchema,
  lastFrame: slotPatchSchema,
  video: slotPatchSchema,
  durationSeconds: z.number().positive().max(600).optional(),
});
export type UpdateStoryboardSegmentInput = z.infer<typeof updateStoryboardSegmentSchema>;

/**
 * MCP connector keys.
 *
 * Claude's custom-connector dialog accepts a URL and nothing else — there is no field for
 * an `Authorization` header — so the key travels inside the connector URL itself. That
 * makes the URL a bearer secret: it is returned exactly once, at issue time, and every
 * later read gives only a hint and timestamps.
 */

export const mcpKeyStatusDtoSchema = z.object({
  /** Whether this deployment serves MCP at all; a key is useless when it does not. */
  enabled: z.boolean(),
  hasKey: z.boolean(),
  /** Last few characters of the key — enough to tell which one a device is using. */
  hint: z.string().optional(),
  createdAt: z.iso.datetime().optional(),
  lastUsedAt: z.iso.datetime().optional(),
});
export type McpKeyStatusDto = z.infer<typeof mcpKeyStatusDtoSchema>;

export const mcpKeyIssuedDtoSchema = z.object({
  /** The full connector URL. The only time the secret is ever sent to a client. */
  url: z.string().min(1),
  hint: z.string(),
  createdAt: z.iso.datetime(),
});
export type McpKeyIssuedDto = z.infer<typeof mcpKeyIssuedDtoSchema>;

export const generateSegmentSchema = z.object({
  /** Overrides the storyboard prompt for this one segment; the storyboard's is the default. */
  prompt: z.string().min(1).max(8000).optional(),
});
export type GenerateSegmentInput = z.infer<typeof generateSegmentSchema>;
