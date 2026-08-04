import type {
  CreateStoryboardInput,
  GenerateSegmentInput,
  StoredFile,
  UpdateStoryboardInput,
  UpdateStoryboardSegmentInput,
  VeoModelSpec,
} from '@video-studio/shared';
import {
  DEFAULT_VIDEO_MODEL_ID,
  getVeoModel,
  MAX_STORYBOARD_SEGMENTS,
  requireVeoModel,
  resolveAspectRatio,
  resolveDuration,
} from '@video-studio/shared';
import type { FilterQuery, HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';
import type { AuthUser } from '../auth/plugin.js';
import type { SegmentGenerationSnapshot } from '../db/mappers.js';
import { GenerationModel } from '../db/models/generation.js';
import type { StoryboardDoc, StoryboardSegmentDoc } from '../db/models/storyboard.js';
import { StoryboardModel } from '../db/models/storyboard.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';
import { getStorage } from '../storage/index.js';
import { createGeneration, type GenerationDocument, syncGeneration } from './generations.js';
import { isStitchingAvailable, stitchSegments } from './stitch.js';

export type StoryboardDocument = HydratedDocument<StoryboardDoc>;

export interface StoryboardPage {
  items: StoryboardDocument[];
  nextCursor: string | null;
}

function toObjectId(value: string, what: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new ApiError('not-found', `${what} not found.`);
  }
  return new Types.ObjectId(value);
}

function resolveModel(modelId: string): VeoModelSpec {
  const spec = getVeoModel(modelId);
  if (!spec) throw new ApiError('invalid-argument', `Unknown video model: ${modelId}.`);
  return spec;
}

/**
 * Deletes a file this storyboard owned, but only inside the caller's own upload prefix.
 *
 * Storage keys reach us from the client, so an unguarded delete would take any key the
 * request cared to name — including another account's frames or a finished generation's
 * video. Failures are logged and swallowed: a stale file is a far smaller problem than a
 * segment edit that refuses to apply.
 */
async function removeOwnedUpload(userId: string, path: string | undefined): Promise<void> {
  if (!path) return;
  const prefix = `uploads/${userId}/`;
  if (!path.startsWith(prefix)) return;
  await getStorage()
    .remove(path)
    .catch((error: unknown) => {
      logger.warn({ err: error, path }, 'could not remove a storyboard upload');
    });
}

async function releaseSegment(userId: string, segment: StoryboardSegmentDoc): Promise<void> {
  await removeOwnedUpload(userId, segment.firstFrameStoragePath);
  await removeOwnedUpload(userId, segment.lastFrameStoragePath);
  await removeOwnedUpload(userId, segment.videoStoragePath);
}

function emptySegment(): StoryboardSegmentDoc {
  return {};
}

/** Reads the generations behind the segments so the DTO can mirror their live status. */
export async function loadSegmentGenerations(
  doc: StoryboardDocument,
): Promise<Map<string, SegmentGenerationSnapshot>> {
  const ids = doc.segments
    .map((segment) => segment.generationId)
    .filter((id): id is Types.ObjectId => Boolean(id));
  if (ids.length === 0) return new Map();

  const docs = await GenerationModel.find({ _id: { $in: ids } })
    .select('status errorMessage resultVideoUrl')
    .exec();

  return new Map(
    docs.map((generation) => [
      generation._id.toString(),
      {
        status: generation.status,
        errorMessage: generation.errorMessage,
        resultVideoUrl: generation.resultVideoUrl,
      },
    ]),
  );
}

export async function createStoryboard(
  user: AuthUser,
  input: CreateStoryboardInput,
): Promise<StoryboardDocument> {
  const spec = resolveModel(input.modelId ?? DEFAULT_VIDEO_MODEL_ID);
  const count = Math.min(Math.max(input.segmentCount ?? 1, 1), MAX_STORYBOARD_SEGMENTS);

  return await StoryboardModel.create({
    userId: toObjectId(user.id, 'Account'),
    title: input.title ?? '',
    prompt: input.prompt ?? '',
    modelId: spec.id,
    aspectRatio: resolveAspectRatio(spec, input.aspectRatio ?? spec.aspectRatios[0] ?? '16:9'),
    duration: resolveDuration(spec, input.duration ?? spec.defaultDuration),
    stylePreset: input.stylePreset ?? 'Cinematic',
    cameraMotion: input.cameraMotion ?? 'Static',
    segments: Array.from({ length: count }, emptySegment),
    exportStatus: 'idle',
  });
}

export async function requireOwnedStoryboard(
  id: string,
  userId: string,
): Promise<StoryboardDocument> {
  const doc = await StoryboardModel.findById(toObjectId(id, 'Storyboard')).exec();
  if (!doc) throw new ApiError('not-found', 'Storyboard not found.');
  if (doc.userId.toString() !== userId) {
    throw new ApiError('permission-denied', 'This storyboard belongs to another account.');
  }
  return doc;
}

function encodeCursor(doc: StoryboardDocument): string {
  return Buffer.from(`${doc.updatedAt.toISOString()}|${doc._id.toString()}`, 'utf8').toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): { updatedAt: Date; id: Types.ObjectId } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = raw.lastIndexOf('|');
  const updatedAt = new Date(separator === -1 ? '' : raw.slice(0, separator));
  const idPart = separator === -1 ? '' : raw.slice(separator + 1);

  if (Number.isNaN(updatedAt.getTime()) || !Types.ObjectId.isValid(idPart)) {
    throw new ApiError('invalid-argument', 'The pagination cursor is not valid.');
  }
  return { updatedAt, id: new Types.ObjectId(idPart) };
}

export async function listStoryboards(
  userId: string,
  options: { limit: number; cursor?: string },
): Promise<StoryboardPage> {
  const limit = Math.min(Math.max(Math.trunc(options.limit), 1), 100);

  const filter: FilterQuery<StoryboardDoc> = { userId: toObjectId(userId, 'Account') };
  if (options.cursor) {
    const { updatedAt, id } = decodeCursor(options.cursor);
    // Keyset on (updatedAt, _id): the tiebreak is what stops a row appearing on two pages.
    filter.$or = [{ updatedAt: { $lt: updatedAt } }, { updatedAt, _id: { $lt: id } }];
  }

  const docs = await StoryboardModel.find(filter)
    .sort({ updatedAt: -1, _id: -1 })
    .limit(limit + 1)
    .exec();

  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;
  const last = items.at(-1);

  return { items, nextCursor: hasMore && last ? encodeCursor(last) : null };
}

export async function updateStoryboard(
  doc: StoryboardDocument,
  input: UpdateStoryboardInput,
): Promise<StoryboardDocument> {
  if (input.title !== undefined) doc.title = input.title;
  if (input.prompt !== undefined) doc.prompt = input.prompt;
  if (input.stylePreset !== undefined) doc.stylePreset = input.stylePreset;
  if (input.cameraMotion !== undefined) doc.cameraMotion = input.cameraMotion;

  // Model, ratio and duration are resolved together: a new model can outlaw the ratio or
  // duration the old one allowed, and storing an invalid pair only defers the failure to
  // the next generation request.
  const spec = input.modelId ? resolveModel(input.modelId) : requireVeoModel(doc.modelId);
  if (input.modelId) doc.modelId = spec.id;

  const wantedRatio = input.aspectRatio ?? doc.aspectRatio;
  doc.aspectRatio = spec.aspectRatios.includes(wantedRatio)
    ? wantedRatio
    : (spec.aspectRatios[0] ?? '16:9');
  doc.duration = resolveDuration(spec, input.duration ?? doc.duration);

  if (input.segmentCount !== undefined && input.segmentCount !== doc.segments.length) {
    const next = Math.min(Math.max(input.segmentCount, 1), MAX_STORYBOARD_SEGMENTS);
    if (next < doc.segments.length) {
      const dropped = doc.segments.slice(next);
      doc.segments = doc.segments.slice(0, next);
      for (const segment of dropped) await releaseSegment(doc.userId.toString(), segment);
    } else {
      doc.segments.push(...Array.from({ length: next - doc.segments.length }, emptySegment));
    }
  }

  await doc.save();
  return doc;
}

function requireSegment(doc: StoryboardDocument, index: number): StoryboardSegmentDoc {
  const segment = doc.segments[index];
  if (!segment) {
    throw new ApiError('not-found', `This storyboard has no segment ${index}.`);
  }
  return segment;
}

/** Applies one absent / null / value slot patch, deleting whatever it replaced. */
async function applySlot(
  userId: string,
  patch: StoredFile | null | undefined,
  current: { url?: string; path?: string },
): Promise<{ url?: string; path?: string }> {
  if (patch === undefined) return current;
  await removeOwnedUpload(userId, current.path);
  if (patch === null) return {};
  return { url: patch.url, path: patch.path };
}

export async function updateSegment(
  doc: StoryboardDocument,
  index: number,
  input: UpdateStoryboardSegmentInput,
): Promise<StoryboardDocument> {
  const segment = requireSegment(doc, index);
  const userId = doc.userId.toString();

  const first = await applySlot(userId, input.firstFrame, {
    url: segment.firstFrameUrl,
    path: segment.firstFrameStoragePath,
  });
  segment.firstFrameUrl = first.url;
  segment.firstFrameStoragePath = first.path;

  const last = await applySlot(userId, input.lastFrame, {
    url: segment.lastFrameUrl,
    path: segment.lastFrameStoragePath,
  });
  segment.lastFrameUrl = last.url;
  segment.lastFrameStoragePath = last.path;

  if (input.video !== undefined) {
    const video = await applySlot(userId, input.video, {
      url: segment.videoUrl,
      path: segment.videoStoragePath,
    });
    segment.videoUrl = video.url;
    segment.videoStoragePath = video.path;
    // An uploaded clip replaces whatever was generated, and clearing the slot clears the
    // link too — otherwise the card would show an empty slot still tied to a generation.
    segment.generationId = undefined;
    if (input.video === null) segment.durationSeconds = undefined;
  }

  if (input.durationSeconds !== undefined) segment.durationSeconds = input.durationSeconds;

  doc.markModified('segments');
  await doc.save();
  return doc;
}

export async function generateSegment(
  user: AuthUser,
  doc: StoryboardDocument,
  index: number,
  input: GenerateSegmentInput,
): Promise<{ storyboard: StoryboardDocument; generation: GenerationDocument }> {
  const segment = requireSegment(doc, index);
  const spec = requireVeoModel(doc.modelId);

  const prompt = (input.prompt ?? doc.prompt).trim();
  if (prompt === '') {
    throw new ApiError('invalid-argument', 'A prompt is required to generate a segment.');
  }

  const firstFrame = segment.firstFrameUrl;
  const lastFrame = segment.lastFrameUrl;

  const generation = await createGeneration(user, {
    prompt,
    modelId: doc.modelId,
    mode: firstFrame ? 'image_to_video' : 'text_to_video',
    aspectRatio: doc.aspectRatio,
    duration: doc.duration,
    stylePreset: doc.stylePreset,
    cameraMotion: doc.cameraMotion,
    ...(firstFrame ? { referenceImageUrls: [firstFrame] } : {}),
    ...(spec.supportsLastFrame && lastFrame ? { lastFrameImageUrl: lastFrame } : {}),
  });

  generation.storyboardId = doc._id;
  generation.segmentIndex = index;
  await generation.save();

  // Re-generating replaces the previous clip; an uploaded one is dropped along with its file.
  await removeOwnedUpload(doc.userId.toString(), segment.videoStoragePath);
  segment.videoStoragePath = undefined;
  segment.videoUrl = undefined;
  segment.generationId = generation._id;
  segment.durationSeconds = doc.duration;

  doc.markModified('segments');
  await doc.save();

  return { storyboard: doc, generation };
}

export async function clearSegmentGeneration(
  doc: StoryboardDocument,
  index: number,
): Promise<StoryboardDocument> {
  const segment = requireSegment(doc, index);
  await removeOwnedUpload(doc.userId.toString(), segment.videoStoragePath);
  segment.generationId = undefined;
  segment.videoUrl = undefined;
  segment.videoStoragePath = undefined;
  segment.durationSeconds = undefined;
  doc.markModified('segments');
  await doc.save();
  return doc;
}

/**
 * Advances every segment still waiting on Veo. One storyboard read therefore drives one
 * poll per in-flight segment instead of one HTTP stream per segment, which is what keeps
 * a twelve-segment board inside the browser's connection budget.
 */
export async function syncStoryboard(doc: StoryboardDocument): Promise<StoryboardDocument> {
  const ids = doc.segments
    .map((segment) => segment.generationId)
    .filter((id): id is Types.ObjectId => Boolean(id));
  if (ids.length === 0) return doc;

  const pending = await GenerationModel.find({
    _id: { $in: ids },
    status: { $in: ['pending', 'processing'] },
  }).exec();

  // Sequential on purpose: a burst of parallel Vertex polls from a single storyboard is
  // exactly the quota spike the old one-stream-per-segment design produced.
  for (const generation of pending) {
    await syncGeneration(generation).catch((error: unknown) => {
      logger.warn(
        { err: error, generationId: generation._id.toString() },
        'storyboard segment sync failed',
      );
    });
  }

  const fresh = await StoryboardModel.findById(doc._id).exec();
  return fresh ?? doc;
}

export function hasPendingSegments(
  doc: StoryboardDocument,
  generations: ReadonlyMap<string, SegmentGenerationSnapshot>,
): boolean {
  return doc.segments.some((segment) => {
    const id = segment.generationId?.toString();
    if (!id) return false;
    const status = generations.get(id)?.status;
    return status === 'pending' || status === 'processing';
  });
}

/** An export that never reported back is treated as dead rather than pinning the board. */
const EXPORT_STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * Kicks off a server-side stitch and returns immediately.
 *
 * Concatenation is CPU work measured in seconds, which is too long to hold an HTTP request
 * open and too short to justify a job queue on a single-box deployment. The storyboard
 * document carries the state instead, so the existing event stream reports progress with
 * no extra plumbing.
 */
export async function startStoryboardExport(doc: StoryboardDocument): Promise<StoryboardDocument> {
  const running =
    doc.exportStatus === 'processing' &&
    doc.exportStartedAt !== undefined &&
    Date.now() - doc.exportStartedAt.getTime() < EXPORT_STALE_AFTER_MS;
  if (running) {
    throw new ApiError('invalid-argument', 'An export of this storyboard is already running.');
  }

  const videoUrls = doc.segments
    .map((segment) => segment.videoUrl)
    .filter((url): url is string => Boolean(url));
  if (videoUrls.length === 0) {
    throw new ApiError('invalid-argument', 'There are no finished segments to export.');
  }
  if (!(await isStitchingAvailable())) {
    throw new ApiError('unavailable', 'Server-side stitching is not available on this deployment.');
  }

  const previousPath = doc.exportStoragePath;
  doc.exportStatus = 'processing';
  doc.exportStartedAt = new Date();
  doc.exportError = undefined;
  doc.exportUrl = undefined;
  doc.exportStoragePath = undefined;
  await doc.save();

  const storyboardId = doc._id.toString();
  const userId = doc.userId.toString();

  // Deliberately not awaited: the caller gets its 202 while this runs on. Every failure
  // path writes the outcome back to the document, so nothing is lost by not awaiting.
  void (async () => {
    try {
      const outcome = await stitchSegments({ userId, storyboardId, videoUrls });
      await StoryboardModel.updateOne(
        { _id: doc._id },
        {
          $set: {
            exportStatus: 'completed',
            exportUrl: outcome.url,
            exportStoragePath: outcome.path,
          },
          $unset: { exportError: '' },
        },
      ).exec();
      logger.info(
        { storyboardId, bytes: outcome.bytes, reEncoded: outcome.reEncoded },
        'storyboard export finished',
      );
    } catch (error) {
      logger.error({ err: error, storyboardId }, 'storyboard export failed');
      await StoryboardModel.updateOne(
        { _id: doc._id },
        {
          $set: {
            exportStatus: 'failed',
            exportError: error instanceof Error ? error.message : 'The export failed.',
          },
        },
      )
        .exec()
        .catch(() => undefined);
    } finally {
      // The superseded cut goes only once the new one has an outcome, so a failed export
      // never leaves the storyboard with no downloadable file at all.
      if (previousPath) {
        await getStorage()
          .remove(previousPath)
          .catch(() => undefined);
      }
    }
  })();

  return doc;
}

export async function deleteStoryboard(doc: StoryboardDocument): Promise<void> {
  const userId = doc.userId.toString();
  for (const segment of doc.segments) await releaseSegment(userId, segment);

  if (doc.exportStoragePath) {
    await getStorage()
      .remove(doc.exportStoragePath)
      .catch((error: unknown) => {
        logger.warn({ err: error }, 'could not remove a storyboard export');
      });
  }

  // Generations are the account's history and outlive the board they were made for; only
  // the back-reference goes, so nothing later resolves a segment that no longer exists.
  await GenerationModel.updateMany(
    { storyboardId: doc._id },
    { $unset: { storyboardId: '', segmentIndex: '' } },
  ).exec();

  await doc.deleteOne();
}
