import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GenerateSegmentInput,
  StoredFile,
  StoryboardDto,
  UpdateStoryboardInput,
  UpdateStoryboardSegmentInput,
} from '@video-studio/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

/** Which board this browser tab is working on; survives a reload, not a new tab. */
const STORAGE_KEY = 'cinemaStoryboardId';

const ACTIVE_KEY = qk.storyboard('active');

function rememberId(id: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private-mode storage failures are not worth breaking the tab over.
  }
}

/**
 * Finds the board this tab was last working on, falling back to the newest one and finally
 * to a fresh board. Reopening the tab therefore lands on the storyboard the user left,
 * rather than on an empty one with their work stranded in history.
 */
async function resolveStoryboard(): Promise<StoryboardDto> {
  const stored = window.sessionStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const found = await api.storyboards.get(stored);
      return found;
    } catch {
      // Deleted, or belongs to an account that is no longer signed in.
    }
  }

  const page = await api.storyboards.list(1);
  const newest = page.items[0];
  const storyboard = newest ?? (await api.storyboards.create({}));
  rememberId(storyboard.id);
  return storyboard;
}

export interface StoryboardActions {
  updateSettings: (input: UpdateStoryboardInput) => Promise<void>;
  setFirstFrame: (index: number, file: StoredFile | null) => Promise<void>;
  setLastFrame: (index: number, file: StoredFile | null) => Promise<void>;
  setSegmentVideo: (index: number, file: StoredFile | null) => Promise<void>;
  setSegmentDuration: (index: number, seconds: number) => Promise<void>;
  generateSegment: (index: number, input?: GenerateSegmentInput) => Promise<void>;
  clearSegmentGeneration: (index: number) => Promise<void>;
  startExport: () => Promise<StoryboardDto>;
}

export interface UseStoryboardResult {
  storyboard: StoryboardDto | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isGenerating: boolean;
  /** True once the event stream dropped and the hook fell back to interval refetching. */
  isPolling: boolean;
  actions: StoryboardActions;
  reload: () => void;
}

const POLL_INTERVAL_MS = 5_000;

function isBusy(storyboard: StoryboardDto | undefined): boolean {
  if (!storyboard) return false;
  if (storyboard.exportStatus === 'processing') return true;
  return storyboard.segments.some(
    (segment) => segment.status === 'pending' || segment.status === 'processing',
  );
}

export function useStoryboard(): UseStoryboardResult {
  const queryClient = useQueryClient();
  const [streamFailed, setStreamFailed] = useState(false);

  const query = useQuery({
    queryKey: ACTIVE_KEY,
    queryFn: resolveStoryboard,
    // The board is pushed over the event stream, so background refetching would only
    // duplicate work already arriving on the socket.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });

  const storyboard = query.data;
  const storyboardId = storyboard?.id;
  const busy = isBusy(storyboard);

  const write = useCallback(
    (next: StoryboardDto) => {
      queryClient.setQueryData(ACTIVE_KEY, next);
    },
    [queryClient],
  );

  useEffect(() => {
    if (storyboardId) rememberId(storyboardId);
  }, [storyboardId]);

  // One connection for the whole board rather than one per segment — the server
  // multiplexes every segment's progress onto this stream.
  useEffect(() => {
    if (!storyboardId || streamFailed) return;
    return api.storyboards.stream(
      storyboardId,
      (update) => write(update),
      () => setStreamFailed(true),
    );
  }, [storyboardId, streamFailed, write]);

  // The stream also closes itself once a board goes quiet, so a reconnect is attempted
  // whenever there is work to watch again.
  useEffect(() => {
    if (!streamFailed || !busy) return;
    const timer = window.setTimeout(() => setStreamFailed(false), POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [streamFailed, busy]);

  useEffect(() => {
    if (!streamFailed || !storyboardId || !busy) return;
    const timer = window.setInterval(() => {
      api.storyboards
        .get(storyboardId)
        .then(write)
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [streamFailed, storyboardId, busy, write]);

  // Every storyboard endpoint answers with the whole board, so one mutation shape covers
  // all of them and the cache is replaced rather than patched.
  const mutation = useMutation({
    mutationFn: (run: (id: string) => Promise<StoryboardDto>) => {
      if (!storyboardId) throw new Error('The storyboard is not loaded yet.');
      return run(storyboardId);
    },
    onSuccess: write,
  });

  const runOnBoard = mutation.mutateAsync;

  const patchSegment = useCallback(
    async (index: number, input: UpdateStoryboardSegmentInput) => {
      await runOnBoard((id) => api.storyboards.updateSegment(id, index, input));
    },
    [runOnBoard],
  );

  const actions: StoryboardActions = {
    updateSettings: async (input) => {
      await runOnBoard((id) => api.storyboards.update(id, input));
    },
    setFirstFrame: (index, file) => patchSegment(index, { firstFrame: file }),
    setLastFrame: (index, file) => patchSegment(index, { lastFrame: file }),
    setSegmentVideo: (index, file) => patchSegment(index, { video: file }),
    setSegmentDuration: (index, seconds) => patchSegment(index, { durationSeconds: seconds }),
    generateSegment: async (index, input = {}) => {
      await runOnBoard((id) => api.storyboards.generateSegment(id, index, input));
      // A fresh segment means new work to watch, so a stream that had closed reconnects.
      setStreamFailed(false);
    },
    clearSegmentGeneration: async (index) => {
      await runOnBoard((id) => api.storyboards.clearSegmentGeneration(id, index));
    },
    startExport: async () => await runOnBoard((id) => api.storyboards.export(id)),
  };

  return {
    storyboard,
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    isGenerating: mutation.isPending,
    isPolling: streamFailed && busy,
    actions,
    reload: () => {
      void query.refetch();
    },
  };
}

export function useStoryboardCapabilities(): { serverStitching: boolean } {
  const query = useQuery({
    queryKey: qk.storyboardCapabilities,
    queryFn: () => api.storyboards.capabilities(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  // Assumed off until proven on: the browser fallback always works, so guessing the
  // other way would show a server-export label on a deployment that cannot do it.
  return { serverStitching: query.data?.serverStitching ?? false };
}
