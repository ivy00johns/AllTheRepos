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

// ---------------------------------------------------------------------------
// Favourites
// ---------------------------------------------------------------------------

/**
 * Pin or unpin a repo.
 *
 * Optimistic: starring should feel instant, and the write is a single
 * boolean that essentially cannot fail. On error the previous list is
 * restored.
 */
export function useToggleFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { slug: string; favorite: boolean }) =>
      requireAtr().catalog.setFavorite(input),
    onMutate: async ({ slug, favorite }) => {
      await queryClient.cancelQueries({ queryKey: ["catalog"] });
      const snapshot = queryClient.getQueriesData({ queryKey: ["catalog"] });
      queryClient.setQueriesData(
        { queryKey: ["catalog"] },
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
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Git sync
// ---------------------------------------------------------------------------

/** Fetch remote refs. Safe on any repo — never touches a working tree. */
export function useFetchRepos() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (slugs: string[]): Promise<SyncResult> =>
      requireAtr().git.fetch({ slugs }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
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
      void queryClient.invalidateQueries({ queryKey: ["catalog"] });
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
