import { createImageGenerationSchema } from '@video-studio/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuthUser } from '../auth/plugin.js';
import { toImageGenerationDto } from '../db/mappers.js';
import { getEnv } from '../env.js';
import {
  createImageGeneration,
  deleteImageGeneration,
  listImageGenerations,
  requireOwnedImage,
} from '../services/images.js';

const idParamsSchema = z.object({ id: z.string().min(1) });
const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(24) });

function userRateLimitKey(request: FastifyRequest): string {
  return request.authUser?.id ?? request.ip;
}

export const imageRoutes: FastifyPluginAsyncZod = async (fastify) => {
  // Images cost real money per call, so they share the video budget rather than opening a
  // second, unlimited one next to it.
  const createLimiter = fastify.rateLimit({
    max: getEnv().generationRateLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: userRateLimitKey,
  });

  fastify.get(
    '/',
    { preHandler: fastify.authenticate, schema: { querystring: listQuerySchema } },
    async (request) => {
      const user = requireAuthUser(request);
      const docs = await listImageGenerations(user.id, { limit: request.query.limit });
      return { items: docs.map(toImageGenerationDto) };
    },
  );

  fastify.post(
    '/',
    {
      preHandler: [fastify.authenticate, createLimiter],
      schema: { body: createImageGenerationSchema },
    },
    async (request) => {
      const user = requireAuthUser(request);
      const doc = await createImageGeneration(user, request.body);
      return toImageGenerationDto(doc);
    },
  );

  fastify.delete(
    '/:id',
    { preHandler: fastify.authenticate, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = requireAuthUser(request);
      await deleteImageGeneration(await requireOwnedImage(request.params.id, user.id));
      return await reply.code(204).send();
    },
  );
};

export default imageRoutes;
