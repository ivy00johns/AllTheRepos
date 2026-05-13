/**
 * useGroups — TanStack Query hook for `groups:list`.
 *
 * Phase 1 only exposes the read path here; group mutations (create /
 * rename / delete / setMembers) will be added as `useMutation`s in
 * later commits once the frontend-components agent wires the
 * affordances that need them.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { getAtr } from "@renderer/lib/atr";
import { queryKeys } from "@renderer/lib/query-client";
import type { ListGroupsResult } from "@shared/types";

export function useGroups(): UseQueryResult<ListGroupsResult, Error> {
  return useQuery<ListGroupsResult, Error>({
    queryKey: queryKeys.groups.list(),
    queryFn: async () => {
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot fetch groups.");
      }
      return atr.groups.list();
    },
    enabled: typeof window !== "undefined" && Boolean(getAtr()),
  });
}
