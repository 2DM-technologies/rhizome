import { QueryClient } from "@tanstack/react-query";

import { isStoreError } from "../api/client.ts";

/**
 * Whether retrying could plausibly change the answer.
 *
 * Every problem the store raises below 500 is a statement about the request or the caller's
 * grants — `grant_missing`, `not_found`, `schema_violation`. Retrying
 * those produces the same problem, more slowly, and hides the real error behind a spinner.
 */
function isRetryable(error: unknown): boolean {
  if (isStoreError(error)) return error.status >= 500;
  return true;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => isRetryable(error) && failureCount < 2,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
