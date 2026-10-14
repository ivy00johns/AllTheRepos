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
  DeleteRepoInput,
  DeleteRepoResult,
  TagCleanupApplyInput,
  TagCleanupApplyResult,
  TagCleanupPreviewResult,
  ListReposInput,
  ListReposResult,
  SetRepoTagsInput,
  SetRepoTagsResult,
} from "@shared/types";

/** Page the catalog contract rather than silently truncating at 200 rows. */
export async function readAllRepos(
  filters: ListReposInput = {},
): Promise<ListReposResult> {
  const atr = requireAtr();
  const first = await atr.catalog.list({ ...filters, limit: 200, offset: 0 });
  const items = [...first.items];
  let offset = first.items.length;
  while (offset < first.total) {
    const page = await atr.catalog.list({ ...filters, limit: 200, offset });
    if (page.items.length === 0)
      throw new Error(
        "Catalog pagination stopped before all repositories were read. Retry the catalog.",
      );
    items.push(...page.items);
    offset += page.items.length;
  }
  return { ...first, items, limit: items.length, offset: 0 };
}

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
      return readAllRepos(filters);
    },
    enabled: typeof window !== "undefined" && Boolean(getAtr()),
  });
}

/**
 * useAllRepos — every repo in the catalog, not the first page of it.
 *
 * `catalog:list` caps one request at 200 rows, so a consumer that wants the
 * whole catalog has to page (see `readAllRepos` above). The catalog screen is
 * exactly that consumer: it groups, sorts and counts client-side, and reads
 * `initialRepos.length` off this array to label the rail. Asking for a single
 * `{ limit: 200 }` page made every repo past row 200 unreachable and left the
 * rail counting a page while the toolbar counted the catalog (ATR-042).
 *
 * Keyed under the `repos` prefix, so the existing `queryKeys.repos.all`
 * invalidation after a mutation still drops and refetches it.
 */
export function useAllRepos(): UseQueryResult<ListReposResult, Error> {
  return useQuery<ListReposResult, Error>({
    queryKey: queryKeys.repos.list({ all: true }),
    queryFn: async () => {
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot fetch repos.");
      }
      return readAllRepos();
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

/**
 * useTagCleanupPreview — read-only `catalog:tagCleanup:preview`.
 *
 * Runs only while the review dialog is open, and re-reads each time it opens
 * so a proposal is never shown from an earlier scan.
 */
export function useTagCleanupPreview(
  enabled: boolean,
): UseQueryResult<TagCleanupPreviewResult, Error> {
  return useQuery<TagCleanupPreviewResult, Error>({
    queryKey: ["catalog", "tagCleanup", "preview"],
    queryFn: () => requireAtr().catalog.tagCleanupPreview(),
    enabled: enabled && Boolean(getAtr()),
    staleTime: 0,
  });
}

/**
 * useApplyTagCleanup — mutation over `catalog:tagCleanup:apply`. Rewrites
 * heuristic tags for accepted repos and remembers rejected ones. Every catalog
 * list is refreshed, since tags surface on cards and can be active filters.
 */
export function useApplyTagCleanup(): UseMutationResult<
  TagCleanupApplyResult,
  Error,
  TagCleanupApplyInput
> {
  const queryClient = useQueryClient();
  return useMutation<TagCleanupApplyResult, Error, TagCleanupApplyInput>({
    mutationFn: (input) => requireAtr().catalog.tagCleanupApply(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
    },
  });
}

/**
 * useDeleteRepo — mutation over `catalog:delete` (ATR-028).
 *
 * Removes ONE catalog row (plus its FTS entry, group memberships, and
 * best-effort vector embedding). The repo on disk is never touched — this
 * exists to clear ghost entries whose folder was deleted or moved away.
 *
 * On success we invalidate the repo-detail query for the slug and every
 * `catalog:list` query so the grid and any open panel drop the row.
 */
export function useDeleteRepo(): UseMutationResult<
  DeleteRepoResult,
  Error,
  DeleteRepoInput
> {
  const queryClient = useQueryClient();

  return useMutation<DeleteRepoResult, Error, DeleteRepoInput>({
    mutationFn: async (input: DeleteRepoInput) => {
      return requireAtr().catalog.delete(input);
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.repos.detail(variables.slug),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.repos.all,
      });
    },
  });
}
