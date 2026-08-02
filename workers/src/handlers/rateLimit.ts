import { HttpsError, type HandlerContext } from '../types';

const MAX_GENERATIONS_PER_HOUR = 10;

/**
 * Sliding one-hour window per user. This is the only abuse guard on generation,
 * so it must stay in front of every provider call.
 */
export async function checkRateLimit(ctx: HandlerContext, userId: string): Promise<void> {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  await ctx.db.runTransaction(async (tx) => {
    const snap = await tx.get('rateLimits', userId);
    const timestamps = ((snap?.timestamps as number[]) || []).filter((ts) => ts > oneHourAgo);
    if (timestamps.length >= MAX_GENERATIONS_PER_HOUR) {
      const waitMin = Math.ceil((Math.min(...timestamps) + 60 * 60 * 1000 - now) / 60000);
      throw new HttpsError('resource-exhausted', `Превышен лимит: ${MAX_GENERATIONS_PER_HOUR} генераций в час. Попробуйте через ${waitMin} мин.`);
    }
    timestamps.push(now);
    tx.setWithTransforms('rateLimits', userId, { timestamps }, [{ field: 'updatedAt', type: 'serverTimestamp' }]);
  });
}
