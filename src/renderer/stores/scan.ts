/**
 * Scan job state — Zustand store.
 *
 * Holds the renderer's view of the currently-active scan job. Events
 * arrive via `window.atr.scan.onProgress` (subscribed once in App.tsx);
 * `useScan()` reads this store + dispatches start / cancel through the
 * bridge.
 *
 * Why a store (vs. React state in App.tsx): scan progress must be
 * observable from multiple unrelated screens (status bar in the shell,
 * settings page button label, command palette in Phase 2). Hoisting to
 * a global store avoids prop drilling and prevents the subscription
 * from being torn down whenever a route unmounts.
 *
 * Not persisted — a scan can't survive an app reload.
 */

import { create } from "zustand";

import type { ScanEvent } from "@shared/types";

export type ScanPhase = "idle" | "running" | "done" | "error" | "cancelled";

export interface ScanState {
  phase: ScanPhase;
  jobId: string | null;
  processed: number;
  total: number;
  currentPath: string | null;
  lastError: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Repos discovered in this run — useful for "X new repos" toast. */
  reposFound: number;
  durationMs: number | null;
}

interface ScanActions {
  /** Apply a single push event from the main process. */
  applyEvent(event: ScanEvent): void;
  /** Mark scan as started (call after `scan:start` returns). */
  markStarted(jobId: string, startedAt: string): void;
  /** Mark scan as cancelled (call after `scan:cancel` returns true). */
  markCancelled(): void;
  /** Reset to idle (e.g. dismiss a completed-state toast). */
  reset(): void;
}

const INITIAL: ScanState = {
  phase: "idle",
  jobId: null,
  processed: 0,
  total: 0,
  currentPath: null,
  lastError: null,
  startedAt: null,
  endedAt: null,
  reposFound: 0,
  durationMs: null,
};

export const useScanStore = create<ScanState & ScanActions>((set) => ({
  ...INITIAL,

  applyEvent: (event) =>
    set((s) => {
      switch (event.kind) {
        case "progress":
          return {
            phase: "running" as const,
            processed: event.processed,
            total: event.total,
            currentPath: event.currentPath,
          };
        case "repo":
          return { reposFound: s.reposFound + 1 };
        case "done":
          return {
            phase: "done" as const,
            durationMs: event.durationMs,
            endedAt: new Date().toISOString(),
            // Use server-reported total to avoid off-by-one races.
            reposFound: event.totalRepos,
          };
        case "error":
          return {
            phase: "error" as const,
            lastError: event.message,
            endedAt: new Date().toISOString(),
          };
        default: {
          // exhaustiveness guard
          const _exhaustive: never = event;
          void _exhaustive;
          return {};
        }
      }
    }),

  markStarted: (jobId, startedAt) =>
    set(() => ({
      ...INITIAL,
      phase: "running",
      jobId,
      startedAt,
    })),

  markCancelled: () =>
    set(() => ({
      phase: "cancelled",
      endedAt: new Date().toISOString(),
    })),

  reset: () => set(INITIAL),
}));
