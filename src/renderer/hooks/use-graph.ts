/**
 * Relationship graph hook.
 *
 * Building the graph reads every repo's `package.json` and `.gitmodules`
 * from disk, so it's cached for the session rather than refetched on
 * every mount. The refresh button forces a rebuild when the catalog has
 * moved on.
 */

import { useQuery } from "@tanstack/react-query";

import type { GraphResult } from "@shared/types";

import { requireAtr } from "@renderer/lib/atr";

const EMPTY: GraphResult = {
  nodes: [],
  edges: [],
  clusters: [],
  builtAt: "",
};

export function useGraph() {
  return useQuery({
    queryKey: ["graph"] as const,
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
