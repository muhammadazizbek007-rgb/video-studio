import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  CameraMotion,
  CreateGenerationInput,
  VideoAspectRatio,
  VideoGenerationMode,
  VideoStylePreset,
} from '@video-studio/shared';
import {
  ASPECT_RATIOS,
  CAMERA_MOTIONS,
  cameraMotionSchema,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  getVeoModel,
  IMAGE_MODEL_LIST,
  resolveDuration,
  STYLE_PRESETS,
  VIDEO_DURATIONS,
  VIDEO_MODEL_IDS,
  VIDEO_MODEL_LIST,
  videoAspectRatioSchema,
  videoGenerationStatusSchema,
  videoStylePresetSchema,
} from '@video-studio/shared';
import type { Collection } from 'mongoose';
import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import type { AuthUser } from '../auth/plugin.js';
import { toElementDto } from '../db/mappers.js';
import { ElementModel } from '../db/models/element.js';
import { GenerationModel } from '../db/models/generation.js';
import { getEnv } from '../env.js';
import { ApiError, isApiError } from '../errors.js';
import { logger } from '../logger.js';
import { buildImagePrompt } from '../prompt.js';
import type { GenerationDocument } from '../services/generations.js';
import {
  createGeneration,
  listGenerations,
  requireOwned,
  syncGeneration,
} from '../services/generations.js';
import { generateImage } from '../vertex/imagen.js';

/**
 * Image generation is synchronous here, but `get_image_status` still has to be able to
 * look a past job up, so the MCP layer keeps its own small ledger. It owns this raw
 * collection outright — no Mongoose model elsewhere reads or writes it.
 */
const IMAGE_JOB_COLLECTION = 'mcpimagejobs';
const IMAGE_JOB_TTL_SECONDS = 60 * 60 * 24 * 30;

const ELEMENT_FETCH_LIMIT = 200;
const HISTORY_SCAN_LIMIT = 100;
const PROMPT_PREVIEW_CHARS = 200;

const DEFAULT_REFERENCE_SUBJECT =
  'a human hand holding a modern smartphone with a relaxed natural grip, a mobile social video feed UI visible on the screen';
const DEFAULT_REFERENCE_LOCATION =
  'busy urban street, warm sunlight, people walking in the background, modern city';

type McpImageJobRecord = {
  jobId: string;
  userId: Types.ObjectId;
  prompt: string;
  modelId: string;
  aspectRatio: string;
  status: 'completed' | 'failed';
  imageUrl: string | null;
  errorMessage: string | null;
  createdAt: Date;
};

const STYLE_PRESET_NOTES: Record<VideoStylePreset, string> = {
  Cinematic: 'Film-like framing, dramatic lighting and shallow depth of field.',
  UGC: 'Authentic phone-shot look, imperfect framing, relatable energy.',
  'App Promo': 'Clean product-launch styling with crisp UI moments.',
  'Product Demo': 'Feature-first showcase with clear, well-lit close-ups.',
  'Character Story': 'Character-driven narrative beats and expressive acting.',
  'Social Ad': 'Punchy, scroll-stopping ad styling built for short feeds.',
};

const CAMERA_MOTION_NOTES: Record<CameraMotion, string> = {
  Static: 'Locked-off camera, no movement.',
  'Zoom in': 'Lens slowly zooms toward the subject.',
  'Dolly in': 'Camera physically travels forward.',
  Handheld: 'Slight natural shake, documentary feel.',
  Orbit: 'Camera arcs around the subject.',
  Pan: 'Camera pivots horizontally across the scene.',
};

let imageJobIndexes: Promise<void> | null = null;

function imageJobs(): Collection<McpImageJobRecord> {
  return mongoose.connection.collection<McpImageJobRecord>(IMAGE_JOB_COLLECTION);
}

async function ensureImageJobIndexes(): Promise<void> {
  imageJobIndexes ??= (async () => {
    const collection = imageJobs();
    await collection.createIndex({ jobId: 1 }, { unique: true });
    await collection.createIndex({ userId: 1, createdAt: -1 });
    await collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: IMAGE_JOB_TTL_SECONDS });
  })();

  try {
    await imageJobIndexes;
  } catch (error) {
    imageJobIndexes = null;
    throw error;
  }
}

function ownerId(user: AuthUser): Types.ObjectId {
  if (!Types.ObjectId.isValid(user.id)) {
    throw new ApiError('unauthenticated', 'The authenticated account id is not valid.');
  }
  return new Types.ObjectId(user.id);
}

function jsonResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

/**
 * Turns a stored media path into something an off-site caller can actually fetch.
 *
 * `MEDIA_PUBLIC_BASE_URL` defaults to `/media`, which is right for the web app — it shares
 * an origin with the API — and useless for Claude, which is not on this host. A relative
 * `video_url` cannot be opened by the user, and a relative `image_url` handed back as a
 * reference frame fails inside Veo, where it is fetched rather than resolved.
 */
function publicMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const base = getEnv().apiPublicUrl.replace(/\/+$/, '');
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}

/**
 * Tool faults come back as MCP tool errors carrying the REST error envelope, so an MCP
 * client and a browser client read the exact same code and message for the same fault.
 */
async function run(work: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonResult(await work());
  } catch (error) {
    if (isApiError(error)) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: { code: error.code, message: error.message } }),
          },
        ],
        isError: true,
      };
    }

    logger.error({ err: error }, 'mcp tool failed');
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: { code: 'internal', message: 'Something went wrong. Please try again.' },
          }),
        },
      ],
      isError: true,
    };
  }
}

function summariseGeneration(doc: GenerationDocument): Record<string, unknown> {
  return {
    generation_id: doc._id.toString(),
    status: doc.status,
    model: doc.modelId,
    prompt: doc.prompt.slice(0, PROMPT_PREVIEW_CHARS),
    aspect_ratio: doc.aspectRatio,
    duration_seconds: doc.duration,
    video_url: publicMediaUrl(doc.resultVideoUrl),
    error_message: doc.errorMessage ?? null,
    created_at: doc.createdAt.toISOString(),
  };
}

interface StartVideoParams {
  prompt: string;
  enrichedPrompt?: string;
  model?: string;
  aspectRatio?: VideoAspectRatio;
  duration?: number;
  stylePreset?: VideoStylePreset;
  cameraMotion?: CameraMotion;
  referenceImageUrls: string[];
}

/**
 * Applies the same per-minute generation budget the REST route enforces.
 *
 * REST gets it from a Fastify rate limiter on `POST /api/generations`; MCP calls the
 * service directly, so without this a leaked connector key could start Veo jobs — and
 * spend — without any ceiling at all. Counting rows is cheap here: `{userId, createdAt}`
 * is already indexed for the history list.
 */
async function assertGenerationBudget(user: AuthUser): Promise<void> {
  const max = getEnv().generationRateLimitPerMinute;
  const since = new Date(Date.now() - 60_000);
  const started = await GenerationModel.countDocuments({
    userId: ownerId(user),
    createdAt: { $gte: since },
  }).exec();

  if (started >= max) {
    throw new ApiError(
      'rate-limited',
      `Too many generations started in the last minute (limit ${max}). Wait a moment and try again.`,
    );
  }
}

/** The single door into video generation for every MCP tool — REST uses the same one. */
async function startVideo(user: AuthUser, params: StartVideoParams): Promise<GenerationDocument> {
  const modelId = params.model ?? DEFAULT_VIDEO_MODEL_ID;
  const spec = getVeoModel(modelId);
  if (!spec) {
    throw new ApiError(
      'invalid-argument',
      `Unknown video model "${modelId}". Available: ${VIDEO_MODEL_IDS.join(', ')}.`,
    );
  }

  // Veo *fetches* a reference frame rather than resolving it against this host, so a
  // relative `/media/...` path — which is exactly what our own image tools hand back —
  // would fail inside the provider. Absolutising at the single door means every caller,
  // including a Claude that pasted a URL from an earlier tool result, is safe.
  const referenceImageUrls = params.referenceImageUrls
    .map((url) => publicMediaUrl(url))
    .filter((url): url is string => url !== null);

  const mode: VideoGenerationMode =
    referenceImageUrls.length > 0 ? 'image_to_video' : 'text_to_video';

  const input: CreateGenerationInput = {
    prompt: params.prompt,
    enrichedPrompt: params.enrichedPrompt,
    modelId: spec.id,
    mode,
    aspectRatio: params.aspectRatio ?? spec.aspectRatios[0] ?? '16:9',
    // Snapped rather than rejected: an MCP client picking 5s for an 4/6/8s model should
    // get a video, not a schema lecture.
    duration: resolveDuration(spec, params.duration ?? spec.defaultDuration),
    stylePreset: params.stylePreset ?? 'Cinematic',
    cameraMotion: params.cameraMotion ?? 'Static',
    referenceImageUrls,
  };

  await assertGenerationBudget(user);
  return await createGeneration(user, input);
}

/** Element images are handed to Claude as reference URLs, so they must be fetchable too. */
function toMcpElement(doc: Parameters<typeof toElementDto>[0]): Record<string, unknown> {
  const dto = toElementDto(doc);
  const imageUrl = publicMediaUrl(dto.imageUrl);
  return imageUrl ? { ...dto, imageUrl } : dto;
}

function videoModelCatalogue(): Record<string, unknown>[] {
  return VIDEO_MODEL_LIST.map((spec) => ({
    id: spec.id,
    name: spec.name,
    type: 'video',
    description: spec.description,
    aspect_ratios: [...spec.aspectRatios],
    durations_seconds: [...spec.supportedDurations],
    default_duration_seconds: spec.defaultDuration,
    supports_image_to_video: spec.supportsImageToVideo,
    supports_last_frame: spec.supportsLastFrame,
    supports_audio: spec.supportsAudio,
    max_resolution: spec.maxResolution,
  }));
}

function imageModelCatalogue(): Record<string, unknown>[] {
  return IMAGE_MODEL_LIST.map((spec) => ({
    id: spec.id,
    name: spec.name,
    type: 'image',
    description: spec.description,
    supports_editing: spec.supportsEditing,
  }));
}

function presetCatalogue(): Record<string, unknown> {
  return {
    style_presets: STYLE_PRESETS.map((id) => ({ id, description: STYLE_PRESET_NOTES[id] })),
    camera_motions: CAMERA_MOTIONS.map((id) => ({ id, description: CAMERA_MOTION_NOTES[id] })),
  };
}

function registerVideoTools(server: McpServer, user: AuthUser): void {
  server.registerTool(
    'generate_video',
    {
      description:
        'Generate a video from a text prompt, optionally starting from a reference image, using Google Veo.',
      inputSchema: {
        prompt: z.string().min(1).max(8000).describe('What should happen in the video'),
        model: z
          .string()
          .optional()
          .describe(`Veo model id. Available: ${VIDEO_MODEL_IDS.join(', ')}.`),
        aspect_ratio: videoAspectRatioSchema.optional().describe('Frame shape, defaults to 16:9'),
        duration: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe('Length in seconds, snapped to the nearest length the model supports'),
        style: videoStylePresetSchema.optional(),
        camera_motion: cameraMotionSchema.optional(),
        reference_image_url: z
          .string()
          .min(1)
          .optional()
          .describe('First-frame image URL, turns the job into image-to-video'),
      },
    },
    async (args) =>
      await run(async () => {
        const doc = await startVideo(user, {
          prompt: args.prompt,
          model: args.model,
          aspectRatio: args.aspect_ratio,
          duration: args.duration,
          stylePreset: args.style,
          cameraMotion: args.camera_motion,
          referenceImageUrls: args.reference_image_url ? [args.reference_image_url] : [],
        });

        return {
          ...summariseGeneration(doc),
          message: `Video generation started. Poll get_video_status("${doc._id.toString()}") — usually 1-3 minutes.`,
        };
      }),
  );

  server.registerTool(
    'get_video_status',
    {
      description:
        'Check a video generation job, refreshing it against Vertex AI when it is still running.',
      inputSchema: {
        generation_id: z.string().min(1).describe('Id returned by generate_video'),
      },
    },
    async (args) =>
      await run(async () => {
        const owned = await requireOwned(args.generation_id, user.id);
        return summariseGeneration(await syncGeneration(owned));
      }),
  );

  server.registerTool(
    'show_generations',
    {
      description: 'List the most recent video generations belonging to the authenticated account.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional().describe('How many to return, max 50'),
        status: videoGenerationStatusSchema.optional().describe('Only show this status'),
      },
    },
    async (args) =>
      await run(async () => {
        const limit = args.limit ?? 10;
        // A status filter is applied after the read, so widen the read to keep a
        // filtered page from coming back nearly empty.
        const page = await listGenerations(user.id, {
          limit: args.status ? HISTORY_SCAN_LIMIT : limit,
        });
        const matched = args.status
          ? page.items.filter((doc) => doc.status === args.status)
          : page.items;

        return {
          generations: matched.slice(0, limit).map(summariseGeneration),
          count: Math.min(matched.length, limit),
        };
      }),
  );

  server.registerTool(
    'generate_video_with_references',
    {
      description:
        'Compose a reference frame with Google Imagen first, then animate that frame with Google Veo. Use when the shot needs a specific subject and setting locked in before motion.',
      inputSchema: {
        prompt: z.string().min(1).max(8000).describe('What happens in the video'),
        subject_description: z
          .string()
          .min(1)
          .max(2000)
          .optional()
          .describe('Subject of the reference frame'),
        location_description: z
          .string()
          .min(1)
          .max(2000)
          .optional()
          .describe('Background of the reference frame'),
        aspect_ratio: videoAspectRatioSchema.optional().describe('Defaults to 9:16'),
        duration: z.number().int().min(1).max(60).optional(),
        model: z.string().optional().describe('Veo model used for the animation step'),
      },
    },
    async (args) =>
      await run(async () => {
        const aspectRatio = args.aspect_ratio ?? '9:16';
        const subject = args.subject_description ?? DEFAULT_REFERENCE_SUBJECT;
        const location = args.location_description ?? DEFAULT_REFERENCE_LOCATION;

        // Veo starts from a single image, so subject and setting are composed into one
        // Imagen prompt instead of being generated separately and stitched.
        const referencePrompt = [
          `Photorealistic reference frame. Subject: ${subject}.`,
          `Background: ${location}.`,
          'Warm soft lighting, shallow depth of field, no text overlays.',
        ].join(' ');

        const reference = await generateImage({
          userId: user.id,
          prompt: referencePrompt,
          modelId: DEFAULT_IMAGE_MODEL_ID,
          aspectRatio,
        });

        const doc = await startVideo(user, {
          prompt: args.prompt,
          enrichedPrompt: `${args.prompt}. The subject stays consistent with the opening frame and the background stays stable.`,
          model: args.model,
          aspectRatio,
          duration: args.duration,
          referenceImageUrls: [reference.imageUrl],
        });

        return {
          ...summariseGeneration(doc),
          reference_images: [publicMediaUrl(reference.imageUrl)],
          message: `Video generation started from an Imagen reference frame. Poll get_video_status("${doc._id.toString()}").`,
        };
      }),
  );
}

function registerImageTools(server: McpServer, user: AuthUser): void {
  server.registerTool(
    'generate_image',
    {
      description: 'Generate an image from a text prompt using Google Imagen or Gemini Image.',
      inputSchema: {
        prompt: z.string().min(1).max(8000).describe('What the image should show'),
        aspect_ratio: z
          .enum(['1:1', '16:9', '9:16', '4:3', '3:4'])
          .optional()
          .describe('Defaults to 1:1'),
        model: z
          .string()
          .optional()
          .describe(`Image model id. Available: ${IMAGE_MODEL_LIST.map((s) => s.id).join(', ')}.`),
        style: videoStylePresetSchema
          .optional()
          .describe('Visual style preset, expanded into the prompt before it reaches the model'),
      },
    },
    async (args) =>
      await run(async () => {
        const modelId = args.model ?? DEFAULT_IMAGE_MODEL_ID;
        const aspectRatio = args.aspect_ratio ?? '1:1';
        const jobId = randomUUID();
        await ensureImageJobIndexes();

        // Same expansion the REST route uses, so a preset means one thing across the product.
        const finalPrompt = buildImagePrompt({
          prompt: args.prompt,
          stylePreset: args.style,
        });

        const base = {
          jobId,
          userId: ownerId(user),
          prompt: args.prompt,
          finalPrompt,
          modelId,
          aspectRatio,
          createdAt: new Date(),
        };

        try {
          const image = await generateImage({
            userId: user.id,
            prompt: finalPrompt,
            modelId,
            aspectRatio,
          });

          await imageJobs().insertOne({
            ...base,
            status: 'completed',
            imageUrl: image.imageUrl,
            errorMessage: null,
          });

          return {
            job_id: jobId,
            status: 'completed',
            model: modelId,
            aspect_ratio: aspectRatio,
            image_url: publicMediaUrl(image.imageUrl),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Image generation failed.';
          await imageJobs().insertOne({
            ...base,
            status: 'failed',
            imageUrl: null,
            errorMessage: message,
          });
          throw error;
        }
      }),
  );

  server.registerTool(
    'get_image_status',
    {
      description: 'Look up an image generation job started by generate_image.',
      inputSchema: {
        job_id: z.string().min(1).describe('Id returned by generate_image'),
      },
    },
    async (args) =>
      await run(async () => {
        await ensureImageJobIndexes();
        const job = await imageJobs().findOne({ jobId: args.job_id, userId: ownerId(user) });
        if (!job) {
          throw new ApiError('not-found', 'Image job not found.');
        }

        return {
          job_id: job.jobId,
          status: job.status,
          model: job.modelId,
          aspect_ratio: job.aspectRatio,
          prompt: job.prompt.slice(0, PROMPT_PREVIEW_CHARS),
          image_url: publicMediaUrl(job.imageUrl),
          error_message: job.errorMessage,
          created_at: job.createdAt.toISOString(),
        };
      }),
  );
}

function registerCatalogueTools(server: McpServer, user: AuthUser): void {
  server.registerTool(
    'models_explore',
    {
      description: 'List the Google video and image models this studio can run, with capabilities.',
      inputSchema: {
        type: z.enum(['video', 'image']).optional().describe('Restrict to one kind of model'),
      },
    },
    async (args) =>
      await run(async () => {
        const models =
          args.type === 'video'
            ? videoModelCatalogue()
            : args.type === 'image'
              ? imageModelCatalogue()
              : [...videoModelCatalogue(), ...imageModelCatalogue()];

        return {
          models,
          total: models.length,
          default_video_model: DEFAULT_VIDEO_MODEL_ID,
          default_image_model: DEFAULT_IMAGE_MODEL_ID,
        };
      }),
  );

  server.registerTool(
    'presets_show',
    {
      description: 'Show the style presets and camera motions accepted by generate_video.',
      inputSchema: {},
    },
    async () => await run(async () => presetCatalogue()),
  );

  server.registerTool(
    'show_reference_elements',
    {
      description:
        'Show the saved reference elements of the authenticated account together with the styles, aspect ratios, durations and models available to generation.',
      inputSchema: {},
    },
    async () =>
      await run(async () => {
        const elements = await ElementModel.find({ userId: ownerId(user) })
          .sort({ pinned: -1, createdAt: -1 })
          .limit(ELEMENT_FETCH_LIMIT)
          .exec();

        return {
          elements: elements.map(toMcpElement),
          ...presetCatalogue(),
          aspect_ratios: [...ASPECT_RATIOS],
          durations_seconds: [...VIDEO_DURATIONS],
          modes: ['text_to_video', 'image_to_video', 'reference_to_video'],
          video_models: videoModelCatalogue(),
          image_models: imageModelCatalogue(),
        };
      }),
  );

  server.registerTool(
    'show_characters',
    {
      description:
        'Show the saved character elements of the authenticated account and how to keep a character consistent across videos.',
      inputSchema: {},
    },
    async () =>
      await run(async () => {
        const characters = await ElementModel.find({ userId: ownerId(user), category: 'character' })
          .sort({ pinned: -1, createdAt: -1 })
          .limit(ELEMENT_FETCH_LIMIT)
          .exec();

        return {
          characters: characters.map(toMcpElement),
          how_to_use: [
            'Generate a character portrait with generate_image.',
            'Pass the returned URL as reference_image_url to generate_video so the video opens on that face.',
            'Keep the wording of the character description stable between prompts.',
            'Reuse the same style preset and camera motion for a consistent look.',
          ],
          example: {
            prompt: 'A young woman with red hair walking through a forest',
            reference_image_url: 'https://example.com/character-portrait.png',
            model: DEFAULT_VIDEO_MODEL_ID,
            camera_motion: 'Dolly in',
          },
        };
      }),
  );
}

export function registerMcpTools(server: McpServer, user: AuthUser): void {
  registerVideoTools(server, user);
  registerImageTools(server, user);
  registerCatalogueTools(server, user);
}
