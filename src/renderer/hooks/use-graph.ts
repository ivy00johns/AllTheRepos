/**
 * Relationship graph hooks.
 *
 * Two reads and two writes. Building the graph reads every repo's
 * `package.json` and `.gitmodules` from disk, so it's cached for the
 * session rather than refetched on every mount. Reading one repo's curated
 * links is a single indexed query, so the catalog asks for those per
 * selection. The writes edit `repo_links` — the same table the MCP's
 * `link`/`unlink` tools edit — and they invalidate every read that could
 * otherwise keep drawing the state before the edit.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import type {
  AssertRepoLinkInput,
  AssertRepoLinkResult,
  GraphResult,
  RemoveRepoLinkInput,
  RemoveRepoLinkResult,
  RepoRelationsResult,
} from "@shared/types";

import { requireAtr } from "@renderer/lib/atr";
import { queryKeys } from "@renderer/lib/query-client";

const EMPTY: GraphResult = {
  nodes: [],
  edges: [],
  clusters: [],
  builtAt: "",
};

/**
 * Curated links touching one repo.
 *
 * Deliberately not built on `useGraph`: the full graph reads every repo's
 * `package.json` and `.gitmodules` from disk, while this is one indexed
 * row read — so the catalog can afford to ask per selection.
 *
 * The short staleTime stops a re-selection from refetching on every click.
 * The panel's own writes do not lean on it: `invalidateLinks` names both
 * ends explicitly, so an assertion appears immediately on the side the
 * user is looking at *and* on the other repo's panel.
 */
export function useRepoRelations(slug: string | null) {
  return useQuery({
    queryKey: queryKeys.graph.links(slug ?? ""),
    enabled: !!slug,
    queryFn: async (): Promise<RepoRelationsResult> => {
      try {
        return await requireAtr().graph.links({ slug: slug as string });
      } catch {
        // Bridge missing (browser-only QE run) — no relations, no error.
        return { relations: [] };
      }
    },
    staleTime: 30_000,
  });
}

/**
 * Invalidate every read a `repo_links` change can invalidate.
 *
 * Both ends, because a link is visible from either side of it, and the
 * map, because `services/graph.ts` folds curated rows in as the `curated`
 * signal — without it the graph page would keep showing a five-minute-old
 * picture of relationships the user just edited.
 */
function invalidateLinks(
  queryClient: QueryClient,
  fromSlug: string,
  toSlug: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: queryKeys.graph.links(fromSlug),
  });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.graph.links(toSlug),
  });
  void queryClient.invalidateQueries({ queryKey: queryKeys.graph.all });
}

/**
 * Assert a curated link from the catalog panel.
 *
 * The main process stamps these rows `source: "ui"`, so the map can still
 * tell a person's assertion from an agent session's.
 */
export function useAssertRepoLink(): UseMutationResult<
  AssertRepoLinkResult,
  Error,
  AssertRepoLinkInput
> {
  const queryClient = useQueryClient();

  return useMutation<AssertRepoLinkResult, Error, AssertRepoLinkInput>({
    mutationFn: async (input: AssertRepoLinkInput) =>
      requireAtr().graph.link(input),
    onSuccess: (_result, variables) => {
      invalidateLinks(queryClient, variables.fromSlug, variables.toSlug);
    },
  });
}

/** Remove a curated link, from whichever end the panel is showing. */
export function useRemoveRepoLink(): UseMutationResult<
  RemoveRepoLinkResult,
  Error,
  RemoveRepoLinkInput
> {
  const queryClient = useQueryClient();

  return useMutation<RemoveRepoLinkResult, Error, RemoveRepoLinkInput>({
    mutationFn: async (input: RemoveRepoLinkInput) =>
      requireAtr().graph.unlink(input),
    onSuccess: (_result, variables) => {
      invalidateLinks(queryClient, variables.fromSlug, variables.toSlug);
    },
  });
}

export function useGraph() {
  return useQuery({
    queryKey: queryKeys.graph.all,
    queryFn: async (): Promise<GraphResult> => {
      try {
        return await requireAtr().graph.build({});
      } catch {
        // Bridge missing (browser-only QE run) — render an empty map
        // rather than an error page.
        return EMPTY;
      }
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}
