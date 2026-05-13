/**
 * useSearch — debounced TanStack Query hook over `catalog:search`.
 *
 * Why debounce here instead of pushing it to the caller: search inputs
 * fire keystroke-by-keystroke from the SearchBar, but every IPC round
 * trip executes the full hybrid FTS + vector pipeline in the main
 * process (heavy). The hook waits `debounceMs` (default 200 ms) after
 * the last `q` change before firing the query — the result is that
 * cache keys settle to the user's final typed term, not every prefix.
 *
 * Empty / whitespace-only queries short-circuit to an empty array
 * without invoking the bridge (otherwise the main process would FTS
 * for the empty string, returning everything).
 */

import { useEffect, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { getAtr } from "@renderer/lib/atr";
import { queryKeys } from "@renderer/lib/query-client";
import type {
  SearchHit,
  SearchReposInput,
  SearchReposResult,
} from "@shared/types";

export interface UseSearchOptions {
  /** Filters forwarded to the IPC. */
  filters?: SearchReposInput["filters"];
  /** Search mode. Defaults to "hybrid". */
  mode?: SearchReposInput["mode"];
  /** Result cap. Defaults to backend default (50). */
  limit?: number;
  /** Debounce ms before firing the query. Defaults to 200. */
  debounceMs?: number;
}

export function useSearch(
  q: string,
  opts: UseSearchOptions = {},
): UseQueryResult<SearchHit[], Error> {
  const { filters, mode = "hybrid", limit, debounceMs = 200 } = opts;
  const [debouncedQ, setDebouncedQ] = useState(q);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQ(q), debounceMs);
    return () => window.clearTimeout(handle);
  }, [q, debounceMs]);

  const trimmed = debouncedQ.trim();

  return useQuery<SearchReposResult, Error>({
    queryKey: queryKeys.search.query(trimmed, mode),
    queryFn: async () => {
      if (trimmed.length === 0) return [];
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot search.");
      }
      return atr.catalog.search({ q: trimmed, mode, filters, limit });
    },
    enabled:
      typeof window !== "undefined" &&
      Boolean(getAtr()) &&
      trimmed.length > 0,
    // Search responses are short-lived; pull again sooner than the
    // catalog defaults if the user retypes the same term.
    staleTime: 10_000,
  });
}
