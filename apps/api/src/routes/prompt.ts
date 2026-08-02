import { enrichPromptSchema } from '@video-studio/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { enrichPrompt } from '../prompt.js';

/** Runs after `authenticate`, so the per-user bucket is always available. */
function userRateLimitKey(request: FastifyRequest): string {
  return request.authUser?.id ?? request.ip;
}

export const promptRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const enrichLimiter = fastify.rateLimit({
    max: 20,
    timeWindow: '1 minute',
    keyGenerator: userRateLimitKey,
  });

  fastify.post(
    '/enrich',
    {
      preHandler: [fastify.authenticate, enrichLimiter],
      schema: { body: enrichPromptSchema },
    },
    async (request) => ({ enrichedPrompt: await enrichPrompt(request.body) }),
  );
};
