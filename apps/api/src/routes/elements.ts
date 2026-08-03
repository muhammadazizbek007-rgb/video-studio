import { buildHandle, createElementSchema, updateElementSchema } from '@video-studio/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAuthUser } from '../auth/plugin.js';
import { toElementDto } from '../db/mappers.js';
import { type ElementDoc, ElementModel } from '../db/models/element.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';
import { getStorage } from '../storage/index.js';

const idParamsSchema = z.object({ id: z.string().min(1) });

const DUPLICATE_KEY_CODE = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_CODE
  );
}

/**
 * buildHandle keeps only letters, digits and underscores, so a name made purely of
 * punctuation collapses to a bare '@' — useless as a mention and as a unique key.
 */
function deriveHandle(name: string): string {
  const handle = buildHandle(name);
  if (handle.length <= 1) {
    throw new ApiError('invalid-argument', 'The name must contain at least one letter or digit.');
  }
  return handle;
}

function duplicateHandleError(handle: string): ApiError {
  return new ApiError('invalid-argument', `The handle ${handle} is already taken.`);
}

async function requireOwnedElement(
  id: string,
  userId: string,
): Promise<HydratedDocument<ElementDoc>> {
  if (!Types.ObjectId.isValid(id)) {
    throw new ApiError('not-found', 'Element not found.');
  }
  const doc = await ElementModel.findById(id).exec();
  if (!doc) {
    throw new ApiError('not-found', 'Element not found.');
  }
  if (doc.userId.toString() !== userId) {
    throw new ApiError('permission-denied', 'This element belongs to another account.');
  }
  return doc;
}

export const elementRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get('/', { preHandler: fastify.authenticate }, async (request) => {
    const user = requireAuthUser(request);
    const docs = await ElementModel.find({ userId: new Types.ObjectId(user.id) })
      .sort({ pinned: -1, updatedAt: -1 })
      .exec();
    return docs.map(toElementDto);
  });

  fastify.post(
    '/',
    { preHandler: fastify.authenticate, schema: { body: createElementSchema } },
    async (request) => {
      const user = requireAuthUser(request);
      const handle = deriveHandle(request.body.name);

      try {
        const doc = await ElementModel.create({
          userId: new Types.ObjectId(user.id),
          name: request.body.name,
          handle,
          category: request.body.category,
          description: request.body.description,
          imageUrl: request.body.imageUrl,
          storagePath: request.body.storagePath,
          pinned: false,
        });
        return toElementDto(doc);
      } catch (error) {
        if (isDuplicateKeyError(error)) throw duplicateHandleError(handle);
        throw error;
      }
    },
  );

  fastify.patch(
    '/:id',
    {
      preHandler: fastify.authenticate,
      schema: { params: idParamsSchema, body: updateElementSchema },
    },
    async (request) => {
      const user = requireAuthUser(request);
      const doc = await requireOwnedElement(request.params.id, user.id);
      const patch = request.body;

      let handle = doc.handle;
      if (patch.name !== undefined) {
        handle = deriveHandle(patch.name);
        doc.name = patch.name;
        doc.handle = handle;
      }
      if (patch.category !== undefined) doc.category = patch.category;
      if (patch.description !== undefined) doc.description = patch.description;
      if (patch.imageUrl !== undefined) doc.imageUrl = patch.imageUrl;
      if (patch.storagePath !== undefined) doc.storagePath = patch.storagePath;
      if (patch.pinned !== undefined) doc.pinned = patch.pinned;

      try {
        await doc.save();
      } catch (error) {
        if (isDuplicateKeyError(error)) throw duplicateHandleError(handle);
        throw error;
      }
      return toElementDto(doc);
    },
  );

  fastify.delete(
    '/:id',
    { preHandler: fastify.authenticate, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = requireAuthUser(request);
      const doc = await requireOwnedElement(request.params.id, user.id);

      const storagePath = doc.storagePath;
      if (storagePath) {
        await getStorage()
          .remove(storagePath)
          .catch((error: unknown) => {
            logger.warn(
              { err: error, elementId: doc._id.toString() },
              'could not remove the stored element image, deleting the record anyway',
            );
          });
      }

      await doc.deleteOne();
      return await reply.code(204).send();
    },
  );
};
