import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserDto } from '@video-studio/shared';
import { useCallback } from 'react';
import { ApiClientError, api, googleSignInUrl } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export interface UseAuthResult {
  user: UserDto | null;
  isLoading: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
}

async function fetchMe(): Promise<UserDto | null> {
  try {
    return await api.auth.me();
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) return null;
    throw error;
  }
}

export function useAuth(): UseAuthResult {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: qk.me,
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
  });

  const signIn = useCallback(() => {
    window.location.assign(googleSignInUrl());
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      // Order matters. queryClient.clear() first would drop the query this hook's observer
      // is bound to, and the observer is never notified about the replacement — the UI goes
      // on rendering the signed-out user. Seeding `null` into the live query pushes the
      // update through, and only then is everything else for that account discarded.
      queryClient.setQueryData(qk.me, null);
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== qk.me[0] });
    }
  }, [queryClient]);

  return {
    user: query.data ?? null,
    isLoading: query.isPending,
    signIn,
    signOut,
  };
}
