import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiClientError } from './api';

function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

function reportError(error: unknown): void {
  // RequireAuth already routes signed-out users to /login, so a 401 is not an app failure.
  if (isUnauthenticated(error)) return;
  console.error('[query]', error);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => !isUnauthenticated(error) && failureCount < 1,
    },
    mutations: {
      retry: 0,
    },
  },
  queryCache: new QueryCache({ onError: reportError }),
  mutationCache: new MutationCache({ onError: reportError }),
});
