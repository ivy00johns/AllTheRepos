/**
 * TanStack Query client singleton.
 *
 * Why a singleton: the renderer mounts <QueryClientProvider> exactly
 * once at app start (`src/renderer/main.tsx`). Tests that need a fresh
 * cache should construct their own `QueryClient` directly rather than
 * mutating this one.
 *
 * Defaults reflect the Phase 1 plan (NEW-PLAN.md §7):
 *   - `staleTime: 30s`  — repo list / detail rarely changes mid-session;
 *     30 s avoids hammering the main process while keeping UI responsive
 *     after a rescan.
 *   - `gcTime: 5min`    — cached entries are kept for 5 minutes after
 *     becoming unused so navigating back to a repo is instant.
 *   - `refetchOnWindowFocus: true` — desktop users alt-tab a lot; pull
 *     fresh data when the window regains focus.
 *   - `retry: 1`        — IPC failures usually indicate a real bug
 *     (the main process is in-process), so don't mask them with retries.
 */

import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

/**
 * Centralised query-key registry. Hooks should reference these factories
 * rather than inlining string arrays, so cache invalidation from a
 * mutation can target the correct keys without typos.
 */
export const queryKeys = {
  repos: {
    all: ["repos"] as const,
    list: (filters: Record<string, unknown>) =>
      ["repos", "list", filters] as const,
    detail: (slug: string) => ["repos", "detail", slug] as const,
  },
  search: {
    all: ["search"] as const,
    query: (q: string, mode?: string) =>
      ["search", "query", q, mode ?? "hybrid"] as const,
  },
  groups: {
    all: ["groups"] as const,
    list: () => ["groups", "list"] as const,
  },
  settings: {
    all: ["settings"] as const,
    current: () => ["settings", "current"] as const,
  },
  git: {
    all: ["git"] as const,
    status: (slug: string) => ["git", "status", slug] as const,
    branches: (slug: string) => ["git", "branches", slug] as const,
  },
  graph: {
    /** The whole map — `all` also prefix-matches the per-repo keys below. */
    all: ["graph"] as const,
    links: (slug: string) => ["graph", "links", slug] as const,
  },
  notes: {
    all: ["notes"] as const,
    detail: (slug: string) => ["notes", "detail", slug] as const,
  },
} as const;

/**
 * Invalidate every repo-list read.
 *
 * `useRepos({...})` stores its result under `["repos", "list", filters]`, so
 * `["repos"]` is the prefix that reaches all of them.
 *
 * Every call site used to spell this as the bare `catalog` key — a key no query
 * is ever registered under, and therefore an invalidation that matched nothing. The
 * symptom was quiet and specific: a scan finished (the status bar said so, and
 * the rows were in SQLite) while the grid still showed the count it had before,
 * because nothing told it to look again. The same dead key sat behind adding or
 * removing a scan root, a move, a folder rename, the git sync buttons, and the
 * live `catalog:on:changed` stream. One exported helper, so there is exactly one
 * place to get this right — and one place for a test to pin.
 */
export function invalidateRepoList(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
}
