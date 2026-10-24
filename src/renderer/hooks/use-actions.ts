/**
 * Repo action hooks — favourites, git sync, and task execution.
 *
 * These are the verbs the catalog exists to make cheap. They're grouped
 * in one module because they share a shape: act on a slug (or a set of
 * them), then invalidate the catalog so every surface reflects it.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  Repo,
  SyncResult,
  TaskListResult,
  TaskOutputEvent,
  TaskStartResult,
} from "@shared/types";

import { getAtr, requireAtr } from "@renderer/lib/atr";
import { queryKeys } from "@renderer/lib/query-client";

// ---------------------------------------------------------------------------
// Favourites
// ---------------------------------------------------------------------------

/**
 * Pin or unpin a repo.
 *
 * Optimistic: starring should feel instant, and the write is a single
 * boolean that essentially cannot fail. On error the previous list is
 * restored.
 *
 * Keyed off `queryKeys.repos.all` (`["repos"]`), not the `["catalog"]` these
 * hooks used before the key registry existed. Nothing is stored under that
 * root any more, so both the optimistic write and the invalidation missed —
 * pinning a repo left the card, the rail's Favourites count and the `Favourites`
 * view showing the old value until the window was reloaded.
 */
export function useToggleFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { slug: string; favorite: boolean }) =>
      requireAtr().catalog.setFavorite(input),
    onMutate: async ({ slug, favorite }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.repos.all });
      const snapshot = queryClient.getQueriesData({
        queryKey: queryKeys.repos.all,
      });
      queryClient.setQueriesData(
        { queryKey: queryKeys.repos.all },
        (old: unknown): unknown => {
          if (!old || typeof old !== "object" || !("items" in old)) return old;
          const list = old as { items: Repo[] };
          return {
            ...list,
            items: list.items.map((repo) =>
              repo.slug === slug ? { ...repo, isFavorite: favorite } : repo,
            ),
          };
        },
      );
      return { snapshot };
    },
    onError: (_error, _input, context) => {
      for (const [key, data] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Git sync
// ---------------------------------------------------------------------------

/**
 * Both sync mutations refresh the catalog under `queryKeys.repos.all`.
 *
 * They were still invalidating `["catalog"]`, the root these hooks used before
 * the key registry above existed and which holds nothing now — so the strip said
 * "3 updated" over cards still showing the old branch, the old commit line and
 * the old dirty marker until the window reloaded. A fetch or a pull rewrites
 * exactly the columns a `Repo` row draws, which is what the prefix covers (it
 * also matches the per-repo detail query, whose header carries the same data).
 */

/** Fetch remote refs. Safe on any repo — never touches a working tree. */
export function useFetchRepos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (slugs: string[]): Promise<SyncResult> =>
      requireAtr().git.fetch({ slugs }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
    },
  });
}

/** Fast-forward pull. Refuses anything that isn't unambiguously safe. */
export function usePullRepos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (slugs: string[]): Promise<SyncResult> =>
      requireAtr().git.pull({ slugs }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/**
 * The tasks a repo declares.
 *
 * Cached briefly rather than not at all: selecting between two repos
 * repeatedly shouldn't re-read `package.json` every time, but the list
 * must notice a script you just added.
 */
export function useRepoTasks(slug: string | null) {
  return useQuery({
    queryKey: ["catalog", "tasks", slug] as const,
    queryFn: async (): Promise<TaskListResult> => {
      const atr = getAtr();
      if (!atr || !slug) return { tasks: [] };
      return atr.tasks.list({ slug });
    },
    enabled: Boolean(slug),
    staleTime: 15_000,
  });
}

export function useStartTask() {
  return useMutation({
    mutationFn: async (input: {
      slug: string;
      taskId: string;
    }): Promise<TaskStartResult> => requireAtr().tasks.start(input),
  });
}

export function useStopTask() {
  return useMutation({
    mutationFn: async (runId: string) => requireAtr().tasks.stop({ runId }),
  });
}

/** Maximum lines of output kept per run — enough to debug, bounded. */
const MAX_LINES = 2000;

export interface TaskRunState {
  runId: string;
  slug: string;
  lines: string[];
  running: boolean;
  exitCode: number | null;
}

/**
 * Live task output, keyed by run.
 *
 * Subscribes once at the app level and accumulates into React state.
 * Output is capped so a chatty dev server left running for an hour can't
 * grow the renderer's memory without bound.
 */
export function useTaskOutput(): {
  runs: Record<string, TaskRunState>;
  clear: (runId: string) => void;
} {
  const [runs, setRuns] = React.useState<Record<string, TaskRunState>>({});

  React.useEffect(() => {
    const atr = getAtr();
    if (!atr) return;
    const unsubscribe = atr.tasks.onOutput((event: TaskOutputEvent) => {
      setRuns((prev) => {
        const existing = prev[event.runId] ?? {
          runId: event.runId,
          slug: event.slug,
          lines: [],
          running: true,
          exitCode: null,
        };
        const next: TaskRunState = { ...existing };

        if (event.kind === "started") {
          next.running = true;
          next.exitCode = null;
        } else if (event.kind === "exited") {
          next.running = false;
          next.exitCode = event.exitCode;
          next.lines = [
            ...next.lines,
            event.exitCode === 0
              ? "\n— finished —"
              : `\n— exited with code ${event.exitCode} —`,
          ];
        } else if (event.chunk) {
          const incoming = event.chunk.split("\n");
          const merged = [...next.lines, ...incoming];
          next.lines =
            merged.length > MAX_LINES ? merged.slice(-MAX_LINES) : merged;
        }

        return { ...prev, [event.runId]: next };
      });
    });
    return unsubscribe;
  }, []);

  const clear = React.useCallback((runId: string) => {
    setRuns((prev) => {
      const next = { ...prev };
      delete next[runId];
      return next;
    });
  }, []);

  return { runs, clear };
}
