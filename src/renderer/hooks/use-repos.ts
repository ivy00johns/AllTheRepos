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
 *
 * `useSetRepoTags` (below) is the matching mutation for `catalog:setTags`.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { requireAtr, getAtr } from "@renderer/lib/atr";
import { queryKeys } from "@renderer/lib/query-client";
import type {
  ListReposInput,
  ListReposResult,
  SetRepoTagsInput,
  SetRepoTagsResult,
} from "@shared/types";

export function useRepos(
  filters: ListReposInput = {},
): UseQueryResult<ListReposResult, Error> {
  return useQuery<ListReposResult, Error>({
    queryKey: queryKeys.repos.list(filters as Record<string, unknown>),
    queryFn: async () => {
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot fetch repos.");
      }
      return atr.catalog.list(filters);
    },
    enabled: typeof window !== "undefined" && Boolean(getAtr()),
  });
}

/**
 * useSetRepoTags — mutation over `catalog:setTags`.
 *
 * Contract (see `contracts/ipc.v1.md` + `SetRepoTagsInputSchema`): the
 * `tags` array is the FULL desired set of USER tags. The main process
 * overwrites the repo's user tags wholesale and preserves heuristic /
 * smart tags, returning the updated `Repo` (with its merged tag list).
 * Callers therefore pass only the user-editable tag values — never the
 * heuristic/smart ones.
 *
 * On success we invalidate:
 *   - the repo-detail query for this slug (so the open panel/page
 *     re-renders with the server's canonical merged tags), and
 *   - every `catalog:list` query (tags surface on the grid cards, and
 *     the active filters may include a tag we just added/removed).
 */
export function useSetRepoTags(): UseMutationResult<
  SetRepoTagsResult,
  Error,
  SetRepoTagsInput
> {
  const queryClient = useQueryClient();

  return useMutation<SetRepoTagsResult, Error, SetRepoTagsInput>({
    mutationFn: async (input: SetRepoTagsInput) => {
      // Pure-bridge call: setTags is a deliberate user action, not a
      // background fetch, so dial straight through the typed bridge.
      return requireAtr().catalog.setTags(input);
    },
    onSuccess: (_updated, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.repos.detail(variables.slug),
      });
      // Tags appear on grid cards and can be active filters — refresh
      // every list query rather than guessing the active filter key.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.repos.all,
      });
    },
  });
}
