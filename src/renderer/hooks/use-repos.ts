/**
 * useRepos — TanStack Query hook for `catalog:list`.
 *
 * Returns a typed `UseQueryResult` so call sites get `data`, `isLoading`,
 * `error`, etc. via React Query's standard interface. The hook is a
 * thin wrapper over `window.atr.catalog.list(filters)`; all caching
 * lives in the query client (see `lib/query-client.ts`).
 *
 * Disabled-when-no-bridge: if the preload bridge is absent (e.g. the
 * renderer is open in a plain browser during QE), the query stays in
 * `pending` state instead of throwing. The shell's "preload bridge
 * unavailable" banner is the user-visible affordance.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { getAtr } from "@renderer/lib/atr";
import { queryKeys } from "@renderer/lib/query-client";
import type { ListReposInput, ListReposResult } from "@shared/types";

export function useRepos(
  filters: ListReposInput = {},
): UseQueryResult<ListReposResult, Error> {
  return useQuery<ListReposResult, Error>({
    queryKey: queryKeys.repos.list(filters as Record<string, unknown>),
    queryFn: async () => {
      const atr = getAtr();
      if (!atr) {
        throw new Error(
          "Preload bridge unavailable — cannot fetch repos.",
        );
      }
      return atr.catalog.list(filters);
    },
    enabled: typeof window !== "undefined" && Boolean(getAtr()),
  });
}
