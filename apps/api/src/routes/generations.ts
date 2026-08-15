import type { GenerationDto } from '@video-studio/shared';
import {
  createGenerationSchema,
  extendGenerationSchema,
  paginationSchema,
  updateGenerationSchema,
} from '@video-studio/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuthUser } from '../auth/plugin.js';
import { toGenerationDto } from '../db/mappers.js';
import { getEnv } from '../env.js';
import { isApiError } from '../errors.js';
import { logger } from '../logger.js';
import {
  createGeneration,
  deleteGeneration,
  ensureLastFrame,
  extendGeneration,
  isTerminalStatus,
  listGenerations,
  requireOwned,
  syncGeneration,
} from '../services/generations.js';

const idParamsSchema = z.object({ id: z.string().min(1) });

const POLL_INTERVAL_MS = 3_000;
const PING_INTERVAL_MS = 20_000;

/** Runs after `authenticate`, so the per-user bucket is always available. */
function userRateLimitKey(request: FastifyRequest): string {
  return request.authUser?.id ?? request.ip;
}

export const generationRoutes: FastifyPluginAsyncZod = async (fastify) => {
  // Shared with the storyboard route so one account cannot get two independent budgets,
  // and configurable because a storyboard legitimately starts a dozen in a row.
  const createLimiter = fastify.rateLimit({
    max: getEnv().generationRateLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: userRateLimitKey,
  });

  fastify.get(
    '/',
    { preHandler: fastify.authenticate, schema: { querystring: paginationSchema } },
    async (request) => {
      const user = requireAuthUser(request);
      const page = await listGenerations(user.id, {
        limit: request.query.limit,
        cursor: request.query.cursor,
      });
      return { items: page.items.map(toGenerationDto), nextCursor: page.nextCursor };
    },
  );

  fastify.post(
    '/',
    {
      preHandler: [fastify.authenticate, createLimiter],
      schema: { body: createGenerationSchema },
    },
    async (request) => {
      const user = requireAuthUser(request);
      const doc = await createGeneration(user, request.body);
      return toGenerationDto(doc);
    },
  );

  fastify.get(
    '/:id',
    { preHandler: fastify.authenticate, schema: { params: idParamsSchema } },
    async (request) => {
      const user = requireAuthUser(request);
      return toGenerationDto(await requireOwned(request.params.id, user.id));
    },
  );

  // Behind the same limiter as a fresh generation: a continuation costs Vertex exactly what
  // a generation costs, and is the obvious way to run up a bill in a loop.
  fastify.post(
    '/:id/extend',
    {
      preHandler: [fastify.authenticate, createLimiter],
      schema: { params: idParamsSchema, body: extendGenerationSchema },
    },
    async (request, reply) => {
      const user = requireAuthUser(request);
      const doc = await extendGeneration(user, request.params.id, request.body);
      return await reply.code(201).send(toGenerationDto(doc));
    },
  );

  /**
   * The clip's own closing frame, cut on first request and kept.
   *
   * A GET rather than a POST despite doing work once: from the caller's side it reads a
   * property of a finished clip, the answer never changes, and the picker asks for a
   * screenful of them at a time. Everything generated before this existed has no frame yet,
   * and walking the whole history at deploy time would spend ffmpeg on clips nobody opens.
   */
  fastify.get(
    '/:id/last-frame',
    { preHandler: fastify.authenticate, schema: { params: idParamsSchema } },
    async (request) => {
      const user = requireAuthUser(request);
      const doc = await requireOwned(request.params.id, user.id);
      return toGenerationDto(await ensureLastFrame(doc));
    },
  );

  fastify.patch(
    '/:id',
    {
      preHandler: fastify.authenticate,
      schema: { params: idParamsSchema, body: updateGenerationSchema },
    },
    async (request) => {
      const user = requireAuthUser(request);
      const doc = await requireOwned(request.params.id, user.id);
      if (request.body.saved !== undefined) {
        doc.saved = request.body.saved;
      }
      await doc.save();
      return toGenerationDto(doc);
    },
  );

  fastify.delete(
    '/:id',
    { preHandler: fastify.authenticate, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = requireAuthUser(request);
      await deleteGeneration(await requireOwned(request.params.id, user.id));
      return await reply.code(204).send();
    },
  );

  fastify.post(
    '/:id/refresh',
    { preHandler: fastify.authenticate, schema: { params: idParamsSchema } },
    async (request) => {
      const user = requireAuthUser(request);
      const doc = await requireOwned(request.params.id, user.id);
      return toGenerationDto(await syncGeneration(doc));
    },
  );

  fastify.get(
    '/:id/events',
    { preHandler: fastify.authenticate, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = requireAuthUser(request);
      const generationId = request.params.id;
      const initial = await requireOwned(generationId, user.id);

      // Keep whatever CORS/security headers the plugins already staged: hijacking
      // the socket skips Fastify's own header flush.
      const staged: Record<string, number | string | string[]> = {};
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) staged[name] = value;
      }

      const headers = {
        ...staged,
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // nginx buffers proxied responses by default, which would hold every frame back.
        'x-accel-buffering': 'no',
      };

      reply.hijack();
      const stream = reply.raw;
      stream.writeHead(200, headers);

      let closed = false;
      let lastFrame = '';
      const timers: NodeJS.Timeout[] = [];

      const stop = (): void => {
        if (closed) return;
        closed = true;
        for (const timer of timers) clearInterval(timer);
      };

      const finish = (): void => {
        stop();
        stream.end();
      };

      const write = (chunk: string): void => {
        if (closed || !stream.writable) return;
        stream.write(chunk);
      };

      const emit = (dto: GenerationDto): void => {
        const frame = JSON.stringify(dto);
        if (frame === lastFrame) return;
        lastFrame = frame;
        write(`event: generation\ndata: ${frame}\n\n`);
      };

      // A leaked interval per aborted request would slowly starve the process.
      // The response is what to watch, not the request: since Node 16 an
      // IncomingMessage emits 'close' as soon as the (empty) request body ends.
      stream.on('close', stop);
      stream.on('error', stop);

      emit(toGenerationDto(initial));
      if (isTerminalStatus(initial.status)) {
        finish();
        return;
      }

      const poll = async (): Promise<void> => {
        if (closed) return;
        try {
          const fresh = await requireOwned(generationId, user.id);
          const synced = await syncGeneration(fresh);
          emit(toGenerationDto(synced));
          if (isTerminalStatus(synced.status)) finish();
        } catch (error) {
          if (isApiError(error) && error.code === 'unavailable') {
            // Vertex hiccup: stay connected and try again on the next tick.
            return;
          }
          logger.warn({ err: error, generationId }, 'generation event stream poll failed');
          finish();
        }
      };

      timers.push(
        setInterval(() => {
          void poll();
        }, POLL_INTERVAL_MS),
      );
      timers.push(
        setInterval(() => {
          write(': ping\n\n');
        }, PING_INTERVAL_MS),
      );
    },
  );
};
