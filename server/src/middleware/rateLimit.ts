import { FieldValue } from 'firebase-admin/firestore';
import { HttpError } from '../errors.js';
import { db } from '../firebase.js';

const WINDOW_MS = 60 * 60 * 1000;
const MAX_GENERATIONS_PER_WINDOW = 10;

/**
 * Sliding one-hour window per user. This is the only abuse guard on generation,
 * so it must stay in front of every provider call. The read-filter-write runs in
 * a transaction because two concurrent starts would otherwise both see the same
 * pre-write count and both be admitted.
 */
export async function checkRateLimit(userId: string): Promise<void> {
  const firestore = db();
  const ref = firestore.collection('rateLimits').doc(userId);
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const stored: unknown = snap.get('timestamps');
    const timestamps = (Array.isArray(stored) ? stored : [])
      .filter((value): value is number => typeof value === 'number' && value > windowStart);

    if (timestamps.length >= MAX_GENERATIONS_PER_WINDOW) {
      const oldest = Math.min(...timestamps);
      const waitMinutes = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 60_000));
      throw new HttpError(
        'resource-exhausted',
        `Превышен лимит: ${MAX_GENERATIONS_PER_WINDOW} генераций в час. Попробуйте через ${waitMinutes} мин.`,
      );
    }

    timestamps.push(now);
    tx.set(ref, { timestamps, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
