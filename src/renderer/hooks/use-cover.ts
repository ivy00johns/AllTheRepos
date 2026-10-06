/**
 * Cover artwork hooks.
 *
 * Covers are resolved lazily and cached indefinitely: reading a PNG off
 * disk is cheap once and wasteful on every scroll. The generated
 * fallback needs no data at all, so a repo whose cover hasn't resolved
 * yet still renders something distinctive immediately — there is no
 * loading state, and no layout shift when the real image lands.
 */

import { useQueries, useQuery } from "@tanstack/react-query";
import * as React from "react";

import type { CoverResult, Repo } from "@shared/types";

import { getAtr } from "@renderer/lib/atr";

/** Cover data changes only when the repo's files change. */
const COVER_STALE_TIME = 1000 * 60 * 60;

function coverQueryOptions(slug: string) {
  return {
    queryKey: ["catalog", "cover", slug] as const,
    queryFn: async (): Promise<CoverResult> => {
      const atr = getAtr();
      if (!atr) return { src: null, source: null, relativePath: null };
      return atr.catalog.cover({ slug });
    },
    staleTime: COVER_STALE_TIME,
    gcTime: COVER_STALE_TIME,
    // A repo with no artwork is a permanent, uninteresting answer —
    // retrying it on every mount would hammer the filesystem for nothing.
    retry: false,
  };
}

/** Resolve one repo's cover. Used by the detail panel. */
export function useCover(slug: string | null) {
  return useQuery({
    ...coverQueryOptions(slug ?? ""),
    enabled: Boolean(slug),
  });
}

/**
 * Resolve covers for a list of repos and return a lookup function.
 *
 * The list is capped: at a few hundred repos the data URLs would add up
 * to more memory than the artwork is worth, and anything past the first
 * couple of screens isn't visible anyway. Repos beyond the cap simply
 * render their generated cover, which is a perfectly good outcome.
 */
const MAX_RESOLVED_COVERS = 150;

export function useCovers(repos: Repo[]): (repo: Repo) => string | null {
  const slugs = React.useMemo(
    () => repos.slice(0, MAX_RESOLVED_COVERS).map((r) => r.slug),
    [repos],
  );

  const results = useQueries({
    queries: slugs.map((slug) => coverQueryOptions(slug)),
  });

  const bySlug = React.useMemo(() => {
    const map = new Map<string, string | null>();
    slugs.forEach((slug, index) => {
      map.set(slug, results[index]?.data?.src ?? null);
    });
    return map;
  }, [slugs, results]);

  return React.useCallback(
    (repo: Repo) => bySlug.get(repo.slug) ?? null,
    [bySlug],
  );
}
