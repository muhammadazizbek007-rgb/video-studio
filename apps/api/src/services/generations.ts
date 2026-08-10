import type {
  CreateGenerationInput,
  ElementDto,
  FramePolicy,
  VeoModelSpec,
  VideoAspectRatio,
  VideoGenerationStatus,
} from '@video-studio/shared';
import {
  getVeoModel,
  resolveAspectRatio,
  resolveDuration,
  resolveMentions,
} from '@video-studio/shared';
import type { FilterQuery, HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';
import type { AuthUser } from '../auth/plugin.js';
import { toElementDto } from '../db/mappers.js';
import { ElementModel } from '../db/models/element.js';
import { type GenerationDoc, GenerationModel } from '../db/models/generation.js';
import { StoryboardModel } from '../db/models/storyboard.js';
import { ApiError, isApiError } from '../errors.js';
import { logger } from '../logger.js';
import { getStorage } from '../storage/index.js';
import { checkVeoOperation, startVeoOperation } from '../vertex/veo.js';

export type GenerationDocument = HydratedDocument<GenerationDoc>;

export interface GenerationPage {
  items: GenerationDocument[];
  nextCursor: string | null;
}

export function isTerminalStatus(status: VideoGenerationStatus): boolean {
  return status === 'completed' || status === 'failed';
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return 'Video generation failed.';
}

function resolveModel(modelId: string): VeoModelSpec {
  const spec = getVeoModel(modelId);
  if (!spec) {
    throw new ApiError('invalid-argument', `Unknown video model: ${modelId}.`);
  }
  return spec;
}

function toObjectId(value: string, what: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new ApiError('not-found', `${what} not found.`);
  }
  return new Types.ObjectId(value);
}

/** Nobody curates hundreds of elements, and a mention can only match one that was read. */
const ELEMENT_LOOKUP_LIMIT = 500;

async function loadElements(userId: string): Promise<ElementDto[]> {
  const docs = await ElementModel.find({ userId: toObjectId(userId, 'Account') })
    .limit(ELEMENT_LOOKUP_LIMIT)
    .exec();
  return docs.map(toElementDto);
}

export interface CreateGenerationOptions {
  /**
   * Storyboard segments pass `frame-wins`: their opening frame is the previous segment's
   * closing frame, so dropping it in favour of an element photo would break the cut.
   */
  framePolicy?: FramePolicy;
}

export async function createGeneration(
  user: AuthUser,
  input: CreateGenerationInput,
  options: CreateGenerationOptions = {},
): Promise<GenerationDocument> {
  const spec = resolveModel(input.modelId);

  let aspectRatio: VideoAspectRatio;
  try {
    aspectRatio = resolveAspectRatio(spec, input.aspectRatio);
  } catch (error) {
    throw new ApiError('invalid-argument', messageOf(error));
  }
  const duration = resolveDuration(spec, input.duration);

  // `@Мухаммад` becomes an attached photo here, not in the browser: the studio, a storyboard
  // segment and an MCP client all reach this line, and only the server can tell which
  // elements this account actually owns.
  const resolved = resolveMentions({
    prompt: input.prompt,
    elements: await loadElements(user.id),
    model: spec,
    firstFrameImageUrl: input.firstFrameImageUrl ?? input.referenceImageUrls?.[0],
    framePolicy: options.framePolicy,
  });

  if (resolved.firstFrameImageUrl && !spec.supportsImageToVideo) {
    throw new ApiError('invalid-argument', `${spec.name} does not support image-to-video.`);
  }
  if (input.lastFrameImageUrl && !spec.supportsLastFrame) {
    throw new ApiError('invalid-argument', `${spec.name} does not support a closing frame.`);
  }

  // History shows what the clip was made from, opening frame first — which is also what the
  // card uses as its poster.
  const referenceImageUrls = [
    ...(resolved.firstFrameImageUrl ? [resolved.firstFrameImageUrl] : []),
    ...resolved.assetImageUrls,
  ];

  const doc = await GenerationModel.create({
    userId: toObjectId(user.id, 'Account'),
    prompt: input.prompt,
    // Stored even when it equals the prompt: it is the only record of what Veo was asked.
    enrichedPrompt: resolved.promptForModel,
    modelId: spec.id,
    mode: resolved.mode,
    aspectRatio,
    duration,
    stylePreset: input.stylePreset,
    cameraMotion: input.cameraMotion,
    status: 'pending',
    saved: false,
    referenceImageUrls,
    lastFrameImageUrl: input.lastFrameImageUrl,
    elements: resolved.refs,
    referenceCount: referenceImageUrls.length,
  });

  try {
    const started = await startVeoOperation({
      generationId: doc._id.toString(),
      userId: user.id,
      prompt: resolved.promptForModel,
      modelId: spec.id,
      aspectRatio,
      duration,
      stylePreset: input.stylePreset,
      cameraMotion: input.cameraMotion,
      firstFrameImageUrl: resolved.firstFrameImageUrl ?? undefined,
      assetReferenceUrls: resolved.assetImageUrls,
      lastFrameImageUrl: input.lastFrameImageUrl,
    });

    doc.status = 'processing';
    doc.vertexOperationName = started.operationName;
    doc.vertexModel = started.vertexModel;
    await doc.save();
    return doc;
  } catch (error) {
    // The client watches the record, not this HTTP response — a start failure that
    // only ever surfaced here would leave the row stuck on 'pending' forever.
    doc.status = 'failed';
    doc.errorMessage = messageOf(error);
    await doc.save().catch((saveError: unknown) => {
      logger.error(
        { err: saveError, generationId: doc._id.toString() },
        'could not persist the generation start failure',
      );
    });
    throw error;
  }
}

/**
 * Copies a finished clip into the storyboard segment that asked for it.
 *
 * Every route that can advance a generation — the event stream, the explicit refresh, the
 * background reconciler — ends up here, so a storyboard is never left holding a segment
 * whose generation quietly completed somewhere else. It only ever writes to the segment
 * still pointing at this generation: a re-generated segment has moved on, and overwriting
 * it would resurrect a clip the user already replaced.
 */
async function publishToStoryboard(doc: GenerationDocument): Promise<void> {
  const { storyboardId, segmentIndex } = doc;
  if (!storyboardId || segmentIndex === undefined || doc.status !== 'completed') return;
  if (!doc.resultVideoUrl) return;

  await StoryboardModel.updateOne(
    { _id: storyboardId, [`segments.${segmentIndex}.generationId`]: doc._id },
    {
      $set: {
        [`segments.${segmentIndex}.videoUrl`]: doc.resultVideoUrl,
        [`segments.${segmentIndex}.durationSeconds`]: doc.duration,
      },
    },
  )
    .exec()
    .catch((error: unknown) => {
      logger.warn(
        { err: error, generationId: doc._id.toString() },
        'could not publish the finished clip to its storyboard segment',
      );
    });
}

export async function syncGeneration(doc: GenerationDocument): Promise<GenerationDocument> {
  if (isTerminalStatus(doc.status)) return doc;

  const { vertexModel, vertexOperationName } = doc;
  if (!vertexModel || !vertexOperationName) {
    doc.status = 'failed';
    doc.errorMessage = doc.errorMessage ?? 'The generation was never handed to Vertex AI.';
    await doc.save();
    return doc;
  }

  try {
    const result = await checkVeoOperation({
      vertexModel,
      operationName: vertexOperationName,
      userId: doc.userId.toString(),
      generationId: doc._id.toString(),
    });

    if (result.status === 'processing') {
      if (doc.status !== 'processing') {
        doc.status = 'processing';
        await doc.save();
      }
      return doc;
    }

    if (result.status === 'completed') {
      doc.status = 'completed';
      doc.resultVideoUrl = result.videoUrl;
      doc.resultStoragePath = result.storagePath;
      doc.errorMessage = undefined;
    } else {
      doc.status = 'failed';
      doc.errorMessage = result.error;
    }

    await doc.save();
    await publishToStoryboard(doc);
    return doc;
  } catch (error) {
    // 'unavailable' means Vertex was briefly unreachable, so the record stays on
    // 'processing' and the next poll retries. Every other fault is terminal —
    // the browser poller only ever stops on a terminal status.
    if (isApiError(error) && error.code === 'unavailable') throw error;

    logger.error(
      { err: error, generationId: doc._id.toString() },
      'veo poll failed, marking the generation as failed',
    );
    doc.status = 'failed';
    doc.errorMessage = messageOf(error);
    await doc.save();
    return doc;
  }
}

function encodeCursor(doc: GenerationDocument): string {
  const raw = `${doc.createdAt.toISOString()}|${doc._id.toString()}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: Types.ObjectId } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = raw.lastIndexOf('|');
  const isoPart = separator === -1 ? '' : raw.slice(0, separator);
  const idPart = separator === -1 ? '' : raw.slice(separator + 1);
  const createdAt = new Date(isoPart);

  if (Number.isNaN(createdAt.getTime()) || !Types.ObjectId.isValid(idPart)) {
    throw new ApiError('invalid-argument', 'The pagination cursor is not valid.');
  }
  return { createdAt, id: new Types.ObjectId(idPart) };
}

export async function listGenerations(
  userId: string,
  options: { limit: number; cursor?: string },
): Promise<GenerationPage> {
  const limit = Math.min(Math.max(Math.trunc(options.limit), 1), 100);

  const filter: FilterQuery<GenerationDoc> = { userId: toObjectId(userId, 'Account') };
  if (options.cursor) {
    const { createdAt, id } = decodeCursor(options.cursor);
    // Keyset, not skip: _id breaks the tie so two rows sharing a millisecond
    // can never be shown twice or skipped between pages.
    filter.$or = [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: id } }];
  }

  const docs = await GenerationModel.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .exec();

  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;
  const last = items.at(-1);

  return { items, nextCursor: hasMore && last ? encodeCursor(last) : null };
}

export async function requireOwned(id: string, userId: string): Promise<GenerationDocument> {
  const doc = await GenerationModel.findById(toObjectId(id, 'Generation')).exec();
  if (!doc) {
    throw new ApiError('not-found', 'Generation not found.');
  }
  if (doc.userId.toString() !== userId) {
    throw new ApiError('permission-denied', 'This generation belongs to another account.');
  }
  return doc;
}

export async function deleteGeneration(doc: GenerationDocument): Promise<void> {
  const storagePath = doc.resultStoragePath;
  if (storagePath) {
    await getStorage()
      .remove(storagePath)
      .catch((error: unknown) => {
        logger.warn(
          { err: error, generationId: doc._id.toString() },
          'could not remove the stored video, deleting the record anyway',
        );
      });
  }
  await doc.deleteOne();
}
