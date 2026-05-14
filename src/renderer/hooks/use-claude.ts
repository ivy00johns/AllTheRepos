/**
 * useClaude — Phase 3b Claude Code integration hooks.
 *
 * Wraps the `atr.claude.*` bridge surface with TanStack Query and
 * the chokidar push-event subscriber. The push subscription
 * invalidates the in-memory cache when ClaudeService notices a
 * session JSONL file has changed.
 *
 * Hook taxonomy:
 *   - Queries: `useClaudeProjects`, `useClaudeRepoState`,
 *     `useClaudeGlobalUsage`, `useClaudeTranscript`.
 *   - Push bus: `useClaudeUpdateBus` (mount once in App.tsx).
 *   - Actions: `useReindexClaude`, `useLaunchClaude`,
 *     `useOpenClaudeMd`.
 *
 * Bridge-missing fallback: every hook short-circuits when
 * `getAtr()` returns null. Action callbacks resolve with a
 * `{ ok: false, reason }` `LauncherResult` instead of throwing,
 * matching the convention from `useLauncher`.
 *
 * Cache strategy — `useClaudeUpdateBus` invalidates
 * `['claude','projects']` and `['claude','globalUsage']` on every
 * push event. It deliberately does NOT invalidate every repoState
 * cache (that's O(repos) and noisy); instead, the matching
 * repoState is invalidated lazily via the hash→slug map cached
 * alongside the projects query.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import * as React from "react";

import { getAtr } from "@renderer/lib/atr";
import type {
  ClaudeGlobalUsageInput,
  ClaudeGlobalUsageResult,
  ClaudeIndexResult,
  ClaudeProjectsResult,
  ClaudeRepoStateResult,
  ClaudeSessionTranscriptResult,
  LauncherResult,
} from "@shared/types";

// ---------------------------------------------------------------------------
// Query key registry
// ---------------------------------------------------------------------------

export const claudeQueryKeys = {
  all: ["claude"] as const,
  projects: () => ["claude", "projects"] as const,
  repoState: (slug: string) => ["claude", "repoState", slug] as const,
  globalUsage: (range?: ClaudeGlobalUsageInput) =>
    ["claude", "globalUsage", range ?? {}] as const,
  transcript: (sessionId: string) =>
    ["claude", "transcript", sessionId] as const,
};

const BRIDGE_UNAVAILABLE_RESULT: LauncherResult = {
  ok: false,
  reason: "Preload bridge unavailable",
};

// ---------------------------------------------------------------------------
// Push-event bus
// ---------------------------------------------------------------------------

/**
 * Subscribes to `atr.claude.onUpdate` for the lifetime of the app and
 * invalidates the matching TanStack Query caches when ClaudeService
 * fires a debounced update event. Mount this exactly ONCE at the top
 * of the app tree (App.tsx) so navigation doesn't churn the
 * subscription.
 *
 * Invalidation strategy:
 *   - Always invalidate the `projects` list and `globalUsage` summary
 *     so the /claude route reflects the new session count / tokens.
 *   - Look up the project hash → slug in the cached projects payload
 *     and selectively invalidate that one `repoState` entry. If the
 *     slug isn't resolvable (the project hash maps to an unmatched
 *     repo path, or the projects query hasn't loaded yet) we skip
 *     the per-repo invalidation — the 30s server-side TTL covers it.
 */
export function useClaudeUpdateBus(): void {
  const queryClient = useQueryClient();

  React.useEffect(() => {
    const atr = getAtr();
    if (!atr) return;
    const unsubscribe = atr.claude.onUpdate(({ projectHash }) => {
      void queryClient.invalidateQueries({
        queryKey: claudeQueryKeys.projects(),
      });
      // globalUsage cache key includes the range filter, so target
      // every key under ['claude','globalUsage', *] by prefix.
      void queryClient.invalidateQueries({
        queryKey: ["claude", "globalUsage"],
      });

      // Look up the slug for this projectHash from the cached
      // projects payload, then invalidate just that repoState key.
      // Don't fetch projects if it isn't already cached — that would
      // race the next invalidation.
      const projects = queryClient.getQueryData<ClaudeProjectsResult>(
        claudeQueryKeys.projects(),
      );
      const match = projects?.projects.find((p) => p.hash === projectHash);
      if (match?.repoSlug) {
        void queryClient.invalidateQueries({
          queryKey: claudeQueryKeys.repoState(match.repoSlug),
        });
      }
    });
    return () => {
      unsubscribe();
    };
  }, [queryClient]);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List every Claude project (one entry per `~/.claude.json` entry).
 * Cheap — no I/O in the main process on the happy path. Push events
 * invalidate this key, so polling is not necessary.
 */
export function useClaudeProjects(): UseQueryResult<
  ClaudeProjectsResult,
  Error
> {
  return useQuery<ClaudeProjectsResult, Error>({
    queryKey: claudeQueryKeys.projects(),
    queryFn: async () => {
      const atr = getAtr();
      if (!atr) {
        throw new Error(
          "Preload bridge unavailable — cannot list Claude projects.",
        );
      }
      return atr.claude.projects();
    },
    enabled: typeof window !== "undefined" && Boolean(getAtr()),
    staleTime: 30_000,
  });
}

/**
 * Loads the full Claude state for one repo. Server-side cached with
 * a 30s TTL, invalidated when chokidar fires for the matching
 * project hash (via `useClaudeUpdateBus`).
 */
export function useClaudeRepoState(
  slug: string | null | undefined,
): UseQueryResult<ClaudeRepoStateResult, Error> {
  return useQuery<ClaudeRepoStateResult, Error>({
    queryKey: claudeQueryKeys.repoState(slug ?? ""),
    queryFn: async () => {
      const atr = getAtr();
      if (!atr) {
        throw new Error(
          "Preload bridge unavailable — cannot load Claude state.",
        );
      }
      if (!slug) {
        throw new Error("No repo slug provided.");
      }
      return atr.claude.repoState({ slug });
    },
    enabled:
      typeof window !== "undefined" && Boolean(getAtr()) && Boolean(slug),
    staleTime: 30_000,
  });
}

/**
 * Returns the global Claude usage aggregate, optionally filtered by
 * an ISO-date range. Re-keyed by range so changing the range filter
 * surfaces a separate cache entry.
 */
export function useClaudeGlobalUsage(
  range?: ClaudeGlobalUsageInput,
): UseQueryResult<ClaudeGlobalUsageResult, Error> {
  return useQuery<ClaudeGlobalUsageResult, Error>({
    queryKey: claudeQueryKeys.globalUsage(range),
    queryFn: async () => {
      const atr = getAtr();
      if (!atr) {
        throw new Error(
          "Preload bridge unavailable — cannot load Claude usage.",
        );
      }
      return atr.claude.globalUsage(range ?? {});
    },
    enabled: typeof window !== "undefined" && Boolean(getAtr()),
    staleTime: 30_000,
  });
}

/**
 * Lazy infinite-query for one session's transcript. Phase 3b only
 * surfaces the event count + last-3 in the sessions table; this
 * hook stays ready for a future "view transcript" affordance.
 */
export function useClaudeTranscript(
  sessionId: string | null | undefined,
): UseInfiniteQueryResult<
  { pages: ClaudeSessionTranscriptResult[]; pageParams: number[] },
  Error
> {
  return useInfiniteQuery<
    ClaudeSessionTranscriptResult,
    Error,
    { pages: ClaudeSessionTranscriptResult[]; pageParams: number[] },
    readonly unknown[],
    number
  >({
    queryKey: claudeQueryKeys.transcript(sessionId ?? ""),
    queryFn: async ({ pageParam }) => {
      const atr = getAtr();
      if (!atr) {
        throw new Error(
          "Preload bridge unavailable — cannot load Claude transcript.",
        );
      }
      if (!sessionId) {
        throw new Error("No session id provided.");
      }
      return atr.claude.sessionTranscript({
        sessionId,
        cursor: pageParam ?? 0,
      });
    },
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled:
      typeof window !== "undefined" && Boolean(getAtr()) && Boolean(sessionId),
  });
}

// ---------------------------------------------------------------------------
// Mutations / action callbacks
// ---------------------------------------------------------------------------

/**
 * Force a full re-walk of `~/.claude.json` and every project's
 * sessions directory. The renderer surfaces this via the settings
 * page or a "rescan" affordance on the /claude route.
 */
export function useReindexClaude(): UseMutationResult<
  ClaudeIndexResult,
  Error,
  void
> {
  const qc = useQueryClient();
  return useMutation<ClaudeIndexResult, Error, void>({
    mutationFn: async () => {
      const atr = getAtr();
      if (!atr) {
        throw new Error(
          "Preload bridge unavailable — cannot reindex Claude state.",
        );
      }
      return atr.claude.index();
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: claudeQueryKeys.all });
    },
  });
}

interface LaunchClaudeOpts {
  resumeSessionId?: string;
  starterPrompt?: string;
}

/**
 * Returns a stable callback that launches `claude` (or
 * `claude --resume <sessionId>`) for the given slug. Returns the
 * raw `LauncherResult` — call sites surface `ok: false` inline.
 */
export function useLaunchClaude(): (
  slug: string,
  opts?: LaunchClaudeOpts,
) => Promise<LauncherResult> {
  return React.useCallback(async (slug: string, opts?: LaunchClaudeOpts) => {
    const atr = getAtr();
    if (!atr) return BRIDGE_UNAVAILABLE_RESULT;
    const input: {
      slug: string;
      resumeSessionId?: string;
      starterPrompt?: string;
    } = { slug };
    if (opts?.resumeSessionId) input.resumeSessionId = opts.resumeSessionId;
    if (opts?.starterPrompt) input.starterPrompt = opts.starterPrompt;
    return atr.claude.launch(input);
  }, []);
}

/**
 * Returns a stable callback that opens the repo's CLAUDE.md in the
 * configured editor (file-level, not folder-level).
 */
export function useOpenClaudeMd(): (slug: string) => Promise<LauncherResult> {
  return React.useCallback(async (slug: string) => {
    const atr = getAtr();
    if (!atr) return BRIDGE_UNAVAILABLE_RESULT;
    return atr.claude.openClaudeMd({ slug });
  }, []);
}
