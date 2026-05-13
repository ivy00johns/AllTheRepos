/**
 * useRepo — TanStack Query hook for `catalog:get` (single repo by slug).
 *
 * `null` results map to NOT_FOUND per the contract; route components
 * should render a "no such repo" empty state rather than treating
 * `null` as a transient loading value.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { getAtr } from "@renderer/lib/atr";
import { queryKeys } from "@renderer/lib/query-client";
import type { GetRepoResult } from "@shared/types";

export function useRepo(
  slug: string | null | undefined,
): UseQueryResult<GetRepoResult, Error> {
  return useQuery<GetRepoResult, Error>({
    queryKey: queryKeys.repos.detail(slug ?? ""),
    queryFn: async () => {
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot fetch repo.");
      }
      if (!slug) {
        return null;
      }
      return atr.catalog.get({ slug });
    },
    enabled:
      typeof window !== "undefined" &&
      Boolean(getAtr()) &&
      Boolean(slug),
  });
}
