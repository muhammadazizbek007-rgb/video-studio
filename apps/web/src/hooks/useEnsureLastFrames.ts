import { useQueryClient } from '@tanstack/react-query';
import type { GenerationDto } from '@video-studio/shared';
import { useEffect, useRef } from 'react';
import { writeGenerationToCache } from '@/hooks/useGenerations';
import { api } from '@/lib/api';

/**
 * How many clips are asked for at once when the tab is opened.
 *
 * Each one costs an ffmpeg run on the server, so this is a screenful rather than a whole
 * history: the rest arrive the next time the tab is opened, and nothing generated from now
 * on needs this at all — its frame is cut the moment it completes.
 */
const BATCH = 12;

/**
 * Fills in the closing frames of clips that finished before the studio started keeping them.
 *
 * A new clip has its frame cut on completion, so this only ever has work to do for history.
 * Runs one request at a time on purpose: a dozen parallel ffmpeg calls on a single box is a
 * good way to make the whole studio stutter for everyone using it.
 */
export function useEnsureLastFrames(
  generations: readonly GenerationDto[],
  enabled: boolean,
  /** Cut first when present: it is the frame the slot was opened for. */
  priorityId?: string | null | undefined,
): void {
  const queryClient = useQueryClient();
  // Asked-for ids, so reopening the tab does not re-request what is already in flight or
  // what genuinely has no frame to give.
  const asked = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;

    const missing = generations
      .filter(
        (generation) =>
          generation.status === 'completed' &&
          Boolean(generation.resultVideoUrl) &&
          !generation.resultLastFrameUrl &&
          !asked.current.has(generation.id),
      )
      .slice(0, BATCH);

    // The preceding shot is what the slot is actually waiting for, so it must not sit
    // behind eleven clips nobody asked about — and it must be in the batch at all, even
    // when the history in front of it is longer than the batch.
    if (priorityId) {
      const wanted = generations.find(
        (generation) =>
          generation.id === priorityId &&
          generation.status === 'completed' &&
          Boolean(generation.resultVideoUrl) &&
          !generation.resultLastFrameUrl &&
          !asked.current.has(generation.id),
      );
      if (wanted) {
        missing.splice(
          missing.findIndex((item) => item.id === wanted.id),
          1,
        );
        missing.unshift(wanted);
      }
    }

    if (missing.length === 0) return;

    let cancelled = false;
    for (const generation of missing) asked.current.add(generation.id);

    void (async () => {
      for (const generation of missing) {
        if (cancelled) return;
        try {
          const fresh = await api.generations.lastFrame(generation.id);
          if (!cancelled) writeGenerationToCache(queryClient, fresh);
        } catch {
          // A clip whose frame cannot be cut simply stays out of the tab. It is already
          // marked as asked, so the picker will not keep retrying it every time it opens.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, generations, priorityId, queryClient]);
}
