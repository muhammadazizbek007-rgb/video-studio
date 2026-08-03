import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { isDbConnected } from '../db/connect.js';

/** Health checks are polled by nginx and the container runtime, so they opt out of rate limiting. */
const routeConfig = { config: { rateLimit: false } } as const;

export const healthRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get('/live', routeConfig, async () => ({ status: 'ok' as const }));

  fastify.get('/ready', routeConfig, async (_request, reply) => {
    if (!isDbConnected()) {
      return await reply.code(503).send({
        error: { code: 'unavailable', message: 'The database is not reachable.' },
      });
    }
    return { status: 'ok' as const, mongo: true };
  });
};
