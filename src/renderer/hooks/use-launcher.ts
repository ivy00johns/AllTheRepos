/**
 * useLauncher — Phase 3a launcher hook.
 *
 * Wraps `atr.launcher.detect()` plus the five launch actions
 * (open in editor / terminal / Finder / remote / copy path). The
 * detection query is `staleTime: Infinity` because the main service
 * caches detection for the entire app session — re-running it would
 * just return the same result.
 *
 * Action handlers return the raw `LauncherResult` so call sites can
 * inspect `ok` / `reason` and surface inline errors. None of the
 * actions throw — they always resolve.
 *
 * Bridge-missing fallback: the detection query is disabled when the
 * bridge isn't present; the action functions reject with a clear
 * error message rather than no-op silently, so call sites can branch
 * on `try / catch` if needed.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import * as React from "react";

import { getAtr } from "@renderer/lib/atr";
import type {
  DetectLauncherResult,
  EditorId,
  LauncherResult,
  TerminalId,
} from "@shared/types";

const LAUNCHER_DETECT_KEY = ["launcher", "detect"] as const;

export function useLauncherDetect(): UseQueryResult<
  DetectLauncherResult,
  Error
> {
  return useQuery<DetectLauncherResult, Error>({
    queryKey: LAUNCHER_DETECT_KEY,
    queryFn: async () => {
      const atr = getAtr();
      if (!atr) {
        throw new Error(
          "Preload bridge unavailable — cannot detect launchers.",
        );
      }
      return atr.launcher.detect();
    },
    enabled: typeof window !== "undefined" && Boolean(getAtr()),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

interface UseLauncherActions {
  detection: DetectLauncherResult | undefined;
  isLoading: boolean;
  isAvailable: boolean;
  openInEditor(slug: string, editorId?: EditorId): Promise<LauncherResult>;
  openInTerminal(
    slug: string,
    opts?: { terminalId?: TerminalId; command?: string },
  ): Promise<LauncherResult>;
  openInFinder(slug: string): Promise<LauncherResult>;
  openRemote(slug: string): Promise<LauncherResult>;
  copyPath(slug: string): Promise<LauncherResult>;
}

const BRIDGE_UNAVAILABLE_RESULT: LauncherResult = {
  ok: false,
  reason: "Preload bridge unavailable",
};

/**
 * Composite hook returning the detection result + action functions.
 *
 * The action functions return a `LauncherResult` directly — no
 * throwing — so call sites can surface `{ ok: false, reason }` as an
 * inline error without `try/catch` plumbing.
 */
export function useLauncher(): UseLauncherActions {
  const detectQuery = useLauncherDetect();

  const isAvailable = React.useMemo(
    () => typeof window !== "undefined" && Boolean(getAtr()),
    [],
  );

  const openInEditor = React.useCallback(
    async (slug: string, editorId?: EditorId): Promise<LauncherResult> => {
      const atr = getAtr();
      if (!atr) return BRIDGE_UNAVAILABLE_RESULT;
      return atr.launcher.openInEditor(
        editorId ? { slug, editorId } : { slug },
      );
    },
    [],
  );

  const openInTerminal = React.useCallback(
    async (
      slug: string,
      opts?: { terminalId?: TerminalId; command?: string },
    ): Promise<LauncherResult> => {
      const atr = getAtr();
      if (!atr) return BRIDGE_UNAVAILABLE_RESULT;
      const input: {
        slug: string;
        terminalId?: TerminalId;
        command?: string;
      } = { slug };
      if (opts?.terminalId) input.terminalId = opts.terminalId;
      if (opts?.command) input.command = opts.command;
      return atr.launcher.openInTerminal(input);
    },
    [],
  );

  const openInFinder = React.useCallback(
    async (slug: string): Promise<LauncherResult> => {
      const atr = getAtr();
      if (!atr) return BRIDGE_UNAVAILABLE_RESULT;
      return atr.launcher.openInFinder({ slug });
    },
    [],
  );

  const openRemote = React.useCallback(
    async (slug: string): Promise<LauncherResult> => {
      const atr = getAtr();
      if (!atr) return BRIDGE_UNAVAILABLE_RESULT;
      return atr.launcher.openRemote({ slug });
    },
    [],
  );

  const copyPath = React.useCallback(
    async (slug: string): Promise<LauncherResult> => {
      const atr = getAtr();
      if (!atr) return BRIDGE_UNAVAILABLE_RESULT;
      return atr.launcher.copyPath({ slug });
    },
    [],
  );

  return {
    detection: detectQuery.data,
    isLoading: detectQuery.isLoading,
    isAvailable,
    openInEditor,
    openInTerminal,
    openInFinder,
    openRemote,
    copyPath,
  };
}
