import { IMAGE_MODEL_LIST, VIDEO_MODEL_LIST } from '@video-studio/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export const modelsRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get('/models', { preHandler: fastify.authenticate }, async () => ({
    video: [...VIDEO_MODEL_LIST],
    image: [...IMAGE_MODEL_LIST],
  }));
};
