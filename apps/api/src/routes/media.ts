import { randomUUID } from 'node:crypto';
import type { MediaKind } from '@video-studio/shared';
import { mediaKindSchema, updateUploadSchema } from '@video-studio/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAuthUser } from '../auth/plugin.js';
import { toUploadDto } from '../db/mappers.js';
import { UploadModel } from '../db/models/upload.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';
import { readLastFrameBytes } from '../services/lastFrame.js';
import { getStorage } from '../storage/index.js';
import { storageKeyFromUrl } from '../storage/mediaUrl.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Display only; a longer name is truncated rather than rejected. */
const MAX_FILENAME_CHARS = 120;

/**
 * The extension is derived from the validated mime type, never from the supplied
 * filename — a client-controlled name is how a path or a double extension gets in.
 */
const EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};

const idParamsSchema = z.object({ id: z.string().min(1) });

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(48),
  /** Narrows to what the caller can actually use — a frame slot never wants an MP4. */
  kind: mediaKindSchema.optional(),
});

function kindOf(mimeType: string): MediaKind {
  return mimeType.startsWith('video/') ? 'video' : 'image';
}

function objectId(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new ApiError('not-found', 'Upload not found.');
  }
  return new Types.ObjectId(value);
}

async function requireOwnedUpload(id: string, userId: string) {
  const doc = await UploadModel.findById(objectId(id)).exec();
  if (!doc) {
    throw new ApiError('not-found', 'Upload not found.');
  }
  if (doc.userId.toString() !== userId) {
    throw new ApiError('permission-denied', 'This upload belongs to another account.');
  }
  return doc;
}

export const mediaRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/uploads',
    { preHandler: fastify.authenticate, schema: { querystring: listQuerySchema } },
    async (request) => {
      const user = requireAuthUser(request);
      const filter: { userId: Types.ObjectId; kind?: MediaKind } = {
        userId: objectId(user.id),
      };
      if (request.query.kind) filter.kind = request.query.kind;

      const docs = await UploadModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(request.query.limit)
        .exec();

      return { items: docs.map(toUploadDto) };
    },
  );

  fastify.post('/upload', { preHandler: fastify.authenticate }, async (request) => {
    const user = requireAuthUser(request);

    const part = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
    if (!part) {
      throw new ApiError('invalid-argument', 'A multipart file part named "file" is required.');
    }
    if (part.fieldname !== 'file') {
      throw new ApiError(
        'invalid-argument',
        `Expected the upload field to be named "file", got "${part.fieldname}".`,
      );
    }

    const mimeType = part.mimetype.split(';')[0]?.trim().toLowerCase() ?? '';
    const extension = EXTENSION_BY_MIME_TYPE[mimeType];
    if (!extension) {
      throw new ApiError(
        'invalid-argument',
        `Unsupported upload type "${part.mimetype}". Allowed: PNG, JPEG, WebP and MP4.`,
      );
    }

    const data = await part.toBuffer();
    if (part.file.truncated || data.byteLength > MAX_UPLOAD_BYTES) {
      throw new ApiError('invalid-argument', 'The upload exceeds the 10 MB limit.');
    }

    const stored = await getStorage().save({
      key: `uploads/${user.id}/${randomUUID()}.${extension}`,
      data,
      contentType: mimeType,
    });

    const doc = await UploadModel.create({
      userId: objectId(user.id),
      url: stored.url,
      storagePath: stored.path,
      kind: kindOf(mimeType),
      contentType: mimeType,
      bytes: stored.bytes,
      filename: (part.filename ?? '').slice(0, MAX_FILENAME_CHARS),
      saved: false,
    });

    // `url` and `path` stay at the top level: every existing caller reads them, and the
    // record around them is additive.
    return toUploadDto(doc);
  });

  /**
   * Files the closing frame of any clip this account owns, generated or uploaded.
   *
   * A storyboard segment can hold a video that was simply uploaded, and those have no
   * generation record to hang a cached frame on — which is the whole reason this exists
   * beside the per-generation route rather than instead of it.
   *
   * Ownership is read off the storage key. Every object this studio writes is filed under
   * `<kind>/<userId>/…`, so the second segment of the key is the owner, and without this
   * check any account could name another's video and walk away with a frame of it.
   */
  fastify.post(
    '/last-frame',
    {
      preHandler: fastify.authenticate,
      schema: { body: z.object({ videoUrl: z.string().min(1) }) },
    },
    async (request) => {
      const user = requireAuthUser(request);

      const key = storageKeyFromUrl(request.body.videoUrl);
      if (!key) {
        throw new ApiError('invalid-argument', 'Only a clip stored by this studio has a frame.');
      }
      if (key.split('/')[1] !== user.id) {
        throw new ApiError('permission-denied', 'This clip belongs to another account.');
      }

      const data = await readLastFrameBytes(request.body.videoUrl);

      const stored = await getStorage().save({
        key: `uploads/${user.id}/${randomUUID()}.jpg`,
        data,
        contentType: 'image/jpeg',
      });

      const doc = await UploadModel.create({
        userId: objectId(user.id),
        url: stored.url,
        storagePath: stored.path,
        kind: 'image',
        contentType: 'image/jpeg',
        bytes: stored.bytes,
        filename: 'last-frame.jpg',
        saved: false,
      });

      return toUploadDto(doc);
    },
  );

  fastify.patch(
    '/uploads/:id',
    {
      preHandler: fastify.authenticate,
      schema: { params: idParamsSchema, body: updateUploadSchema },
    },
    async (request) => {
      const user = requireAuthUser(request);
      const doc = await requireOwnedUpload(request.params.id, user.id);
      if (request.body.saved !== undefined) doc.saved = request.body.saved;
      await doc.save();
      return toUploadDto(doc);
    },
  );

  fastify.delete(
    '/uploads/:id',
    { preHandler: fastify.authenticate, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = requireAuthUser(request);
      const doc = await requireOwnedUpload(request.params.id, user.id);

      await getStorage()
        .remove(doc.storagePath)
        .catch((error: unknown) => {
          logger.warn(
            { err: error, uploadId: doc._id.toString() },
            'could not remove the stored upload, deleting the record anyway',
          );
        });
      await doc.deleteOne();
      return await reply.code(204).send();
    },
  );
};
