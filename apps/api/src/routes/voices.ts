import { createVoiceSchema, updateVoiceSchema } from '@video-studio/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAuthUser } from '../auth/plugin.js';
import { toVoiceDto } from '../db/mappers.js';
import { VoiceModel } from '../db/models/voice.js';
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
  if (!Types.ObjectId.isValid(value)) throw new ApiError('not-found', 'Voice not found.');
  return new Types.ObjectId(value);
}

export const voiceRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get('/', { preHandler: fastify.authenticate }, async (request) => {
    const user = requireAuthUser(request);
    // Alphabetical: a picker is read by name, and creation order means nothing to whoever
    // is scanning it for "the one we use for the ads".
    const docs = await VoiceModel.find({ userId: new Types.ObjectId(user.id) })
      .sort({ name: 1 })
      .exec();
    return { items: docs.map(toVoiceDto) };
  });

  fastify.post(
    '/',
    { preHandler: fastify.authenticate, schema: { body: createVoiceSchema } },
    async (request, reply) => {
      const user = requireAuthUser(request);
      try {
        const doc = await VoiceModel.create({
          userId: new Types.ObjectId(user.id),
          name: request.body.name.trim(),
          prompt: request.body.prompt.trim(),
        });
        return await reply.code(201).send(toVoiceDto(doc));
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new ApiError('invalid-argument', 'A voice with that name already exists.');
        }
        throw error;
      }
    },
  );

  fastify.patch(
    '/:id',
    {
      preHandler: fastify.authenticate,
      schema: { params: idParamsSchema, body: updateVoiceSchema },
    },
    async (request) => {
      const user = requireAuthUser(request);
      const doc = await VoiceModel.findById(toObjectId(request.params.id)).exec();
      if (!doc) throw new ApiError('not-found', 'Voice not found.');
      if (doc.userId.toString() !== user.id) {
        throw new ApiError('permission-denied', 'This voice belongs to another account.');
      }

      if (request.body.name !== undefined) doc.name = request.body.name.trim();
      if (request.body.prompt !== undefined) doc.prompt = request.body.prompt.trim();

      try {
        await doc.save();
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new ApiError('invalid-argument', 'A voice with that name already exists.');
        }
        throw error;
      }
      return toVoiceDto(doc);
    },
  );

  fastify.delete(
    '/:id',
    { preHandler: fastify.authenticate, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = requireAuthUser(request);
      const doc = await VoiceModel.findById(toObjectId(request.params.id)).exec();
      if (!doc) throw new ApiError('not-found', 'Voice not found.');
      if (doc.userId.toString() !== user.id) {
        throw new ApiError('permission-denied', 'This voice belongs to another account.');
      }

      // Generations keep their voiceId after the voice is gone. It is a record of what was
      // asked for, and rewriting history to tidy up a delete would be the worse trade.
      await doc.deleteOne();
      return await reply.code(204).send();
    },
  );
};

export default voiceRoutes;
