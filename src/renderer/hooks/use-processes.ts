/**
 * useProcesses — Phase 3a process detection hook.
 *
 * Reads the snapshot from `atr.process.list()` and subscribes to push
 * updates from `atr.process.onUpdate(...)`. The query is the
 * heartbeat (5s `refetchInterval` keeps the lsof poller in main
 * alive); the push subscription provides instant updates between
 * polls.
 *
 * Companion helpers:
 *   - `useProcessesForRepo(slug)` — derived selector that filters the
 *     global snapshot to a single repo. We deliberately do NOT call
 *     `atr.process.listForRepo` separately so that every consumer
 *     reads from the same in-memory snapshot — keeps re-renders
 *     coherent across the Processes view and per-repo port chips.
 *   - `useProcessCount()` — count helper for the TopBar nav badge.
 *   - `useKillProcess()` — mutation wrapper for `atr.process.kill`.
 *
 * Bridge-missing fallback: the queries are disabled when `getAtr()`
 * returns null, so the renderer is still mountable in a vanilla
 * browser context. UI surfaces should render a "Process detection
 * unavailable" message when the bridge isn't present.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import * as React from "react";

import { getAtr } from "@renderer/lib/atr";
import type {
  KillProcessInput,
  KillProcessResult,
  ListProcessesResult,
  ProcessInfo,
} from "@shared/types";

const PROCESSES_KEY = ["processes"] as const;

const EMPTY_SNAPSHOT: ListProcessesResult = {
  processes: [],
  snapshotAt: 0,
};

/**
 * Subscribes to push-style process snapshot events from the main
 * process for the lifetime of the renderer. Mount this exactly ONCE
 * at the top of the app tree (App.tsx) so the subscription survives
 * route changes — otherwise every navigation would tear down and
 * re-create the subscription and miss events.
 */
export function useProcessEventBus(): void {
  const queryClient = useQueryClient();

  React.useEffect(() => {
    const atr = getAtr();
    if (!atr) return;
    const unsubscribe = atr.process.onUpdate((snapshot) => {
      queryClient.setQueryData<ListProcessesResult>(PROCESSES_KEY, snapshot);
    });
    return () => {
      unsubscribe();
    };
  }, [queryClient]);
}

/**
 * Returns the current process snapshot. Polls every 5s as a
 * heartbeat (keeps the main-side poller alive); push events update
 * the cache between polls via `useProcessEventBus`.
 */
export function useProcesses(): UseQueryResult<ListProcessesResult, Error> {
  return useQuery<ListProcessesResult, Error>({
    queryKey: PROCESSES_KEY,
    queryFn: async () => {
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot list processes.");
      }
      return atr.process.list();
    },
    enabled: typeof window !== "undefined" && Boolean(getAtr()),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    staleTime: 2_000,
  });
}

/**
 * Derived selector — filters the global snapshot to a single repo.
 * Cheap O(n) over the (typically <20) row snapshot; memoised so
 * stable references propagate to the chip / badge components.
 */
export function useProcessesForRepo(slug: string | null | undefined): {
  processes: ProcessInfo[];
  snapshotAt: number;
  isLoading: boolean;
} {
  const snapshot = useProcesses();
  const data = snapshot.data ?? EMPTY_SNAPSHOT;

  const processes = React.useMemo(() => {
    if (!slug) return [];
    return data.processes.filter((p) => p.repoSlug === slug);
  }, [data.processes, slug]);

  return {
    processes,
    snapshotAt: data.snapshotAt,
    isLoading: snapshot.isLoading,
  };
}

/**
 * Lightweight count helper for the TopBar badge. Returns 0 when the
 * bridge is unavailable.
 */
export function useProcessCount(): number {
  const snapshot = useProcesses();
  return snapshot.data?.processes.length ?? 0;
}

/**
 * On-demand sweep. The 5s query above is a heartbeat — it reads whatever the
 * main-side poller last produced, so a server started a moment ago stays
 * invisible until the next tick (3s focused, 15s blurred). This asks main to
 * scan now and writes the result straight into the cache, so the panel shows
 * the host as it is at the moment someone looks. Concurrent callers join the
 * same sweep on the main side.
 */
export function useRefreshProcesses(): UseMutationResult<
  ListProcessesResult,
  Error,
  void
> {
  const queryClient = useQueryClient();
  return useMutation<ListProcessesResult, Error, void>({
    mutationFn: async () => {
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot refresh processes.");
      }
      return atr.process.refresh();
    },
    onSuccess: (snapshot) => {
      queryClient.setQueryData<ListProcessesResult>(PROCESSES_KEY, snapshot);
    },
  });
}

/**
 * Kill mutation. Resolves with the main-side `KillProcessResult`.
 * On settle the snapshot is invalidated so the table reflects the
 * gap before the next poll/push event arrives.
 */
export function useKillProcess(): UseMutationResult<
  KillProcessResult,
  Error,
  KillProcessInput
> {
  const qc = useQueryClient();
  return useMutation<KillProcessResult, Error, KillProcessInput>({
    mutationFn: async (input) => {
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot kill process.");
      }
      return atr.process.kill(input);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: PROCESSES_KEY });
    },
  });
}
