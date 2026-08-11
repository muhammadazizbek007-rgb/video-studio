import { getVeoModel } from '@video-studio/shared';
import { getEnv } from '../env.js';
import { isApiError } from '../errors.js';
import { logger } from '../logger.js';

/**
 * Spacing Vertex submissions so a batch survives the quota.
 *
 * Vertex accepts one `predictLongRunning` per minute per base model and refuses the rest
 * with a 429 — it does not queue them. The studio used to hand every start straight to
 * Vertex and mark the record failed the moment one came back refused, so the second clip of
 * any batch died permanently with a quota message the user could do nothing about. A
 * twelve-segment storyboard could only ever produce its first segment.
 *
 * The gate is per base model because the quota is: `veo-3.1`, `veo-3.1-fast` and
 * `veo-3.1-lite` each get their own slot, so a campaign spread across the three models
 * moves three times faster without asking Google for anything.
 *
 * This lives in the API process, which is the same place the limit is spent — one container
 * today. A second replica would each keep their own clock and together exceed the quota;
 * the retry below still recovers, but the spacing would stop being exact.
 */

interface Slot {
  /** When the last submission for this base model actually left. */
  lastSubmittedAt: number;
  /** Tail of the queue: every waiter chains onto the one before it. */
  chain: Promise<unknown>;
}

const slots = new Map<string, Slot>();

function slotFor(baseModel: string): Slot {
  const existing = slots.get(baseModel);
  if (existing) return existing;
  const fresh: Slot = { lastSubmittedAt: 0, chain: Promise.resolve() };
  slots.set(baseModel, fresh);
  return fresh;
}

/**
 * The base model the quota is counted against.
 *
 * The registry id (`veo-3.1-fast`) and the Vertex id (`veo-3.1-fast-generate-001`) are
 * different strings for the same ceiling, and the quota is spent per Vertex id.
 */
export function baseModelOf(modelId: string): string {
  return getVeoModel(modelId)?.vertexModel ?? modelId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // A pending wait must not hold the process open through a shutdown.
    timer.unref?.();
  });
}

/** Vertex reports a spent quota as 429, which the client maps to `unavailable`. */
export function isQuotaRefusal(error: unknown): boolean {
  if (!isApiError(error) || error.code !== 'unavailable') return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('quota') || message.includes('429') || message.includes('resource exhausted')
  );
}

export interface SubmitOptions<T> {
  modelId: string;
  /** Called once per attempt; the queue owns when, never what. */
  submit: () => Promise<T>;
  /** Told before each wait, so the caller can record that the clip is still queued. */
  onAttempt?: (attempt: number) => Promise<void> | void;
}

/**
 * Runs `submit` in this base model's slot, waiting for the gap and retrying a refusal.
 *
 * Calls queue behind one another per model, so a burst of twelve keeps its order rather than
 * all waking at the same moment and racing. Errors that are not the quota — a malformed
 * prompt, an unsupported option — come straight back out: waiting a minute to be told the
 * same thing again helps nobody.
 */
export async function submitToVertex<T>(options: SubmitOptions<T>): Promise<T> {
  const { veoSubmitIntervalMs, veoSubmitMaxAttempts } = getEnv();
  const baseModel = baseModelOf(options.modelId);
  const slot = slotFor(baseModel);

  const run = async (): Promise<T> => {
    for (let attempt = 1; attempt <= veoSubmitMaxAttempts; attempt += 1) {
      const waitFor = Math.max(0, slot.lastSubmittedAt + veoSubmitIntervalMs - Date.now());
      if (waitFor > 0) {
        await options.onAttempt?.(attempt);
        logger.debug({ baseModel, waitFor, attempt }, 'waiting for a Vertex submission slot');
        await sleep(waitFor);
      }

      // Stamped before the call, not after: the quota counts the request going out, and a
      // slow round trip must not let the next one leave early.
      slot.lastSubmittedAt = Date.now();

      try {
        return await options.submit();
      } catch (error) {
        if (!isQuotaRefusal(error) || attempt === veoSubmitMaxAttempts) throw error;
        // Someone else spent this minute — most likely another replica or the console.
        // Push the slot a whole interval forward so the retry is not a second refusal.
        slot.lastSubmittedAt = Date.now();
        logger.warn(
          { baseModel, attempt, max: veoSubmitMaxAttempts },
          'Vertex refused a submission on quota; re-queueing',
        );
      }
    }

    // Unreachable: the final attempt either returns or rethrows above.
    throw new Error('submission queue exhausted its attempts without a result');
  };

  const queued = slot.chain.then(run, run);
  // The chain must survive a rejected link, or one failure would strand every clip behind it.
  slot.chain = queued.catch(() => undefined);
  return await queued;
}

/** Test seam: forgets every slot's clock so cases do not inherit each other's spacing. */
export function resetSubmissionSlots(): void {
  slots.clear();
}
