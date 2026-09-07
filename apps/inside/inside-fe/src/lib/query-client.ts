import { QueryClient } from '@tanstack/react-query';
import { isRetryable } from './http';

/**
 * Query defaults. REQ-NET-006.
 *
 * The previous `retry: 2` was blanket: a 404 was retried twice with backoff
 * before the app would admit the thing was not there. Retrying an answer is
 * not resilience, it is latency — so only a server fault or a transport
 * failure is worth trying again.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: (failureCount, error) => failureCount < 2 && isRetryable(error),
      /*
       * Off deliberately, rather than on by default and unconsidered. Alt-tab
       * is not a signal that a designer's profile changed, and the app already
       * refetches on reconnect, which is the case that actually means stale.
       */
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      // A mutation is not safely repeatable without knowing what it does, so
      // retrying one is the caller's decision, never a default.
      retry: false,
    },
  },
});

export { queryClient };
