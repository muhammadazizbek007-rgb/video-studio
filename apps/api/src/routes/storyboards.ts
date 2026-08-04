import type { StoryboardDto } from '@video-studio/shared';
import {
  createStoryboardSchema,
  generateSegmentSchema,
  paginationSchema,
  updateStoryboardSchema,
  updateStoryboardSegmentSchema,
} from '@video-studio/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAuthUser } from '../auth/plugin.js';
import { toStoryboardDto } from '../db/mappers.js';
import { getEnv } from '../env.js';
import { isApiError } from '../errors.js';
import { logger } from '../logger.js';
import { isStitchingAvailable } from '../services/stitch.js';
import {
  clearSegmentGeneration,
  createStoryboard,
  deleteStoryboard,
  generateSegment,
  hasPendingSegments,
  listStoryboards,
  loadSegmentGenerations,
  requireOwnedStoryboard,
  type StoryboardDocument,
  startStoryboardExport,
  syncStoryboard,
  updateSegment,
  updateStoryboard,
} from '../services/storyboards.js';

const idParamsSchema = z.object({ id: z.string().min(1) });

const segmentParamsSchema = z.object({
  id: z.string().min(1),
  index: z.coerce.number().int().min(0),
});

const POLL_INTERVAL_MS = 3_000;
const PING_INTERVAL_MS = 20_000;
/** A board that is neither generating nor exporting has nothing left to push. */
const IDLE_CLOSE_AFTER_MS = 60_000;

function userRateLimitKey(request: FastifyRequest): string {
  return request.authUser?.id ?? request.ip;
}

async function present(doc: StoryboardDocument): Promise<StoryboardDto> {
  return toStoryboardDto(doc, await loadSegmentGenerations(doc));
}

export const storyboardRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const generateLimiter = fastify.rateLimit({
    max: getEnv().generationRateLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: userRateLimitKey,
  });

  // Stitching is CPU-bound and shared by every tenant on the box, so it gets its own,
  // much tighter bucket than generation does.
  const exportLimiter = fastify.rateLimit({
    max: 6,
    timeWindow: '1 minute',
    keyGenerator: userRateLimitKey,
  });

  fastify.get(
    '/',
    { preHandler: fastify.authenticate, schema: { querystring: paginationSchema } },
    async (request) => {
      const user = requireAuthUser(request);
      const page = await listStoryboards(user.id, {
        limit: request.query.limit,
        cursor: request.query.cursor,
      });
      const items = await Promise.all(page.items.map(present));
      return { items, nextCursor: page.nextCursor };
    },
  );

  fastify.post(
    '/',
    { preHandler: fastify.authenticate, schema: { body: createStoryboardSchema } },
    async (request, reply) => {
      const user = requireAuthUser(request);
      const doc = await createStoryboard(user, request.body);
      return await reply.code(201).send(await present(doc));
    },
  );

  fastify.get(
    '/:id',
    { preHandler: fastify.authenticate, schema: { params: idParamsSchema } },
    async (request) => {
      const user = requireAuthUser(request);
      return await present(await requireOwnedStoryboard(request.params.id, user.id));
    },
  );

  fastify.patch(
    '/:id',
    {
      preHandler: fastify.authenticate,
      schema: { params: idParamsSchema, body: updateStoryboardSchema },
    },
    async (request) => {
      const user = requireAuthUser(request);
      const doc = await requireOwnedStoryboard(request.params.id, user.id);
      return await present(await updateStoryboard(doc, request.body));
    },
  );

  fastify.delete(
    '/:id',
    { preHandler: fastify.authenticate, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = requireAuthUser(request);
      await deleteStoryboard(await requireOwnedStoryboard(request.params.id, user.id));
      return await reply.code(204).send();
    },
  );

  fastify.patch(
    '/:id/segments/:index',
    {
      preHandler: fastify.authenticate,
      schema: { params: segmentParamsSchema, body: updateStoryboardSegmentSchema },
    },
    async (request) => {
      const user = requireAuthUser(request);
      const doc = await requireOwnedStoryboard(request.params.id, user.id);
      return await present(await updateSegment(doc, request.params.index, request.body));
    },
  );

  fastify.post(
    '/:id/segments/:index/generate',
    {
      preHandler: [fastify.authenticate, generateLimiter],
      schema: { params: segmentParamsSchema, body: generateSegmentSchema },
    },
    async (request, reply) => {
      const user = requireAuthUser(request);
      const doc = await requireOwnedStoryboard(request.params.id, user.id);
      const { storyboard } = await generateSegment(user, doc, request.params.index, request.body);
      return await reply.code(202).send(await present(storyboard));
    },
  );

  /** Detaches a failed or unwanted generation, returning the segment to its upload slots. */
  fastify.delete(
    '/:id/segments/:index/generation',
    { preHandler: fastify.authenticate, schema: { params: segmentParamsSchema } },
    async (request) => {
      const user = requireAuthUser(request);
      const doc = await requireOwnedStoryboard(request.params.id, user.id);
      return await present(await clearSegmentGeneration(doc, request.params.index));
    },
  );

  fastify.post(
    '/:id/export',
    { preHandler: [fastify.authenticate, exportLimiter], schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = requireAuthUser(request);
      const doc = await requireOwnedStoryboard(request.params.id, user.id);
      return await reply.code(202).send(await present(await startStoryboardExport(doc)));
    },
  );

  /** Lets the client label the export button before it has anything to export. */
  fastify.get('/capabilities', { preHandler: fastify.authenticate }, async () => {
    return { serverStitching: await isStitchingAvailable() };
  });

  /**
   * One stream for the whole storyboard.
   *
   * The obvious design — an event stream per segment — puts a twelve-segment board over
   * the browser's six-connection-per-origin budget and multiplies Vertex polling by the
   * number of segments in flight. Multiplexing here means one connection and one poll
   * cycle regardless of how many segments are rendering.
   */
  fastify.get(
    '/:id/events',
    { preHandler: fastify.authenticate, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = requireAuthUser(request);
      const storyboardId = request.params.id;
      const initial = await requireOwnedStoryboard(storyboardId, user.id);

      // Hijacking skips Fastify's header flush, so whatever CORS and security headers the
      // plugins already staged have to be carried over by hand.
      const staged: Record<string, number | string | string[]> = {};
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) staged[name] = value;
      }

      reply.hijack();
      const stream = reply.raw;
      stream.writeHead(200, {
        ...staged,
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });

      let closed = false;
      let lastFrame = '';
      let idleSince = Date.now();
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

      const emit = (dto: StoryboardDto): void => {
        const frame = JSON.stringify(dto);
        if (frame === lastFrame) return;
        lastFrame = frame;
        write(`event: storyboard\ndata: ${frame}\n\n`);
      };

      stream.on('close', stop);
      stream.on('error', stop);

      emit(await present(initial));

      const poll = async (): Promise<void> => {
        if (closed) return;
        try {
          const fresh = await requireOwnedStoryboard(storyboardId, user.id);
          const synced = await syncStoryboard(fresh);
          const generations = await loadSegmentGenerations(synced);
          emit(toStoryboardDto(synced, generations));

          const busy =
            hasPendingSegments(synced, generations) || synced.exportStatus === 'processing';
          if (busy) {
            idleSince = Date.now();
            return;
          }
          // Held open briefly after the last segment lands so a user who immediately
          // starts another one is not waiting on a reconnect.
          if (Date.now() - idleSince > IDLE_CLOSE_AFTER_MS) finish();
        } catch (error) {
          if (isApiError(error) && error.code === 'unavailable') return;
          logger.warn({ err: error, storyboardId }, 'storyboard event stream poll failed');
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
