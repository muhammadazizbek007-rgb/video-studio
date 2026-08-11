import { GenerationModel } from '../db/models/generation.js';
import { getEnv } from '../env.js';
import { isApiError } from '../errors.js';
import { logger } from '../logger.js';
import { resumeSubmission, syncGeneration } from './generations.js';

/**
 * Advances generations nobody is watching.
 *
 * Until this existed a generation only moved while a browser held its event stream open.
 * Close the tab and Veo would finish, but the record stayed on 'processing' forever and
 * the finished clip was never copied into our storage — the operation eventually expires
 * on Vertex and the work is simply lost. Cinema Studio makes that the normal case rather
 * than an edge case: a twelve-segment board is a long session someone will walk away from.
 */

/** Long enough that a live event stream, polling every 3s, always gets there first. */
const STALE_AFTER_MS = 30_000;
const BATCH_SIZE = 20;

let timer: NodeJS.Timeout | null = null;
let running = false;

export async function reconcileOnce(now: number = Date.now()): Promise<number> {
  const stale = await GenerationModel.find({
    status: { $in: ['pending', 'processing'] },
    updatedAt: { $lt: new Date(now - STALE_AFTER_MS) },
  })
    // Oldest first, so a backlog drains in the order it built up.
    .sort({ updatedAt: 1 })
    .limit(BATCH_SIZE)
    .exec();

  let advanced = 0;
  for (const doc of stale) {
    try {
      // The submission queue lives in memory, so a row still marked as waiting for a slot
      // after a restart is standing in a queue that no longer exists. Put it back in line
      // rather than polling an operation it never got.
      if (doc.awaitingSubmission) {
        const resumed = await resumeSubmission(doc);
        if (resumed.status === 'failed') advanced += 1;
        continue;
      }

      const synced = await syncGeneration(doc);
      if (synced.status === 'completed' || synced.status === 'failed') advanced += 1;
    } catch (error) {
      // 'unavailable' is Vertex being briefly unreachable; the row stays stale and the
      // next sweep retries it. Anything else syncGeneration has already recorded.
      if (!isApiError(error) || error.code !== 'unavailable') {
        logger.warn(
          { err: error, generationId: doc._id.toString() },
          'reconciler could not advance a generation',
        );
      }
    }
  }

  if (stale.length > 0) {
    logger.debug({ examined: stale.length, advanced }, 'reconciler sweep finished');
  }
  return advanced;
}

export function startReconciler(): void {
  const env = getEnv();
  if (!env.reconcilerEnabled || timer) return;

  timer = setInterval(() => {
    // Sweeps never overlap: a slow Vertex round-trip must not stack up workers that
    // would each re-poll the same rows.
    if (running) return;
    running = true;
    void reconcileOnce()
      .catch((error: unknown) => {
        logger.error({ err: error }, 'reconciler sweep failed');
      })
      .finally(() => {
        running = false;
      });
  }, env.reconcilerIntervalMs);

  // Unref'd so the sweep timer alone never keeps the process alive during shutdown.
  timer.unref();
  logger.info({ intervalMs: env.reconcilerIntervalMs }, 'generation reconciler started');
}

export function stopReconciler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
