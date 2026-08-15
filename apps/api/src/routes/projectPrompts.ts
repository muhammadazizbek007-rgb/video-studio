import { createProjectPromptSchema, updateProjectPromptSchema } from '@video-studio/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAuthUser } from '../auth/plugin.js';
import { toProjectPromptDto } from '../db/mappers.js';
import { ProjectPromptModel } from '../db/models/projectPrompt.js';
import { ApiError } from '../errors.js';

const idParamsSchema = z.object({ id: z.string().min(1) });

const DUPLICATE_KEY_CODE = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_CODE
  );
}

function toObjectId(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw new ApiError('not-found', 'Project prompt not found.');
  return new Types.ObjectId(value);
}

export const projectPromptRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get('/', { preHandler: fastify.authenticate }, async (request) => {
    const user = requireAuthUser(request);
    // Alphabetical: the @ list is read by name, and creation order means nothing to whoever
    // is scanning it for "the one with the packaging description".
    const docs = await ProjectPromptModel.find({ userId: new Types.ObjectId(user.id) })
      .sort({ name: 1 })
      .exec();
    return { items: docs.map(toProjectPromptDto) };
  });

  fastify.post(
    '/',
    { preHandler: fastify.authenticate, schema: { body: createProjectPromptSchema } },
    async (request, reply) => {
      const user = requireAuthUser(request);
      try {
        const doc = await ProjectPromptModel.create({
          userId: new Types.ObjectId(user.id),
          name: request.body.name.trim(),
          prompt: request.body.prompt.trim(),
        });
        return await reply.code(201).send(toProjectPromptDto(doc));
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new ApiError('invalid-argument', 'A project prompt with that name already exists.');
        }
        throw error;
      }
    },
  );

  fastify.patch(
    '/:id',
    {
      preHandler: fastify.authenticate,
      schema: { params: idParamsSchema, body: updateProjectPromptSchema },
    },
    async (request) => {
      const user = requireAuthUser(request);
      const doc = await ProjectPromptModel.findById(toObjectId(request.params.id)).exec();
      if (!doc) throw new ApiError('not-found', 'Project prompt not found.');
      if (doc.userId.toString() !== user.id) {
        throw new ApiError('permission-denied', 'This project prompt belongs to another account.');
      }

      if (request.body.name !== undefined) doc.name = request.body.name.trim();
      if (request.body.prompt !== undefined) doc.prompt = request.body.prompt.trim();

      try {
        await doc.save();
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new ApiError('invalid-argument', 'A project prompt with that name already exists.');
        }
        throw error;
      }
      return toProjectPromptDto(doc);
    },
  );

  fastify.delete(
    '/:id',
    { preHandler: fastify.authenticate, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = requireAuthUser(request);
      const doc = await ProjectPromptModel.findById(toObjectId(request.params.id)).exec();
      if (!doc) throw new ApiError('not-found', 'Project prompt not found.');
      if (doc.userId.toString() !== user.id) {
        throw new ApiError('permission-denied', 'This project prompt belongs to another account.');
      }

      // Prompts that already used this text keep it: the words were pasted into them at the
      // time, so deleting the entry cannot and should not reach back into past clips.
      await doc.deleteOne();
      return await reply.code(204).send();
    },
  );
};

export default projectPromptRoutes;
