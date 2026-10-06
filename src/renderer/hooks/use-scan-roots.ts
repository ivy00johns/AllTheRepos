/**
 * Scan-root hooks — add and remove watched folders from the rail.
 *
 * Adding a folder is two steps that should feel like one: the settings
 * array gains an entry, and a scan of just that path starts immediately.
 * Without the second half you'd add a folder and stare at an empty row
 * wondering whether it worked.
 *
 * Both mutations invalidate settings AND the catalog, because the scan
 * roots determine the whole shape of the rail.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AddScanPathResult, RemoveScanPathResult } from "@shared/types";

import { getAtr, requireAtr } from "@renderer/lib/atr";

function useRootInvalidator() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["settings"] });
    void queryClient.invalidateQueries({ queryKey: ["catalog"] });
  };
}

/** Open the native folder picker. Resolves to `null` when cancelled. */
export function usePickScanPath() {
  return useMutation({
    mutationFn: async (): Promise<string | null> => {
      const result = await requireAtr().settings.pickScanPath({});
      return result.path;
    },
  });
}

/**
 * Add a scan root and immediately scan it.
 *
 * The scan is fire-and-forget: it streams progress through the existing
 * `scan:on:progress` channel that the status bar already listens to, so
 * there's nothing for this mutation to await. A scan that's already
 * running rejects, which is fine — the folder is still added, and the
 * next scan will pick it up.
 */
export function useAddScanPath() {
  const invalidate = useRootInvalidator();
  return useMutation({
    mutationFn: async (path: string): Promise<AddScanPathResult> => {
      const atr = requireAtr();
      const result = await atr.settings.addScanPath({ path });
      if (result.added) {
        try {
          await atr.scan.start({ paths: [path] });
        } catch {
          // Another scan is in flight; the folder is added either way.
        }
      }
      return result;
    },
    onSuccess: invalidate,
  });
}

export function useRemoveScanPath() {
  const invalidate = useRootInvalidator();
  return useMutation({
    mutationFn: async (input: {
      path: string;
      forgetRepos: boolean;
    }): Promise<RemoveScanPathResult> =>
      requireAtr().settings.removeScanPath(input),
    onSuccess: invalidate,
  });
}

/** Rescan one existing root on demand. */
export function useRescanPath() {
  const invalidate = useRootInvalidator();
  return useMutation({
    mutationFn: async (path: string): Promise<void> => {
      await requireAtr().scan.start({ paths: [path] });
    },
    onSuccess: invalidate,
  });
}

/**
 * How many catalog rows live under a path. Drives the removal confirm,
 * which has to say what's about to be forgotten before you agree to it.
 */
export function useCountUnder(path: string | null) {
  return useQuery({
    queryKey: ["settings", "countUnder", path] as const,
    queryFn: async (): Promise<number> => {
      const atr = getAtr();
      if (!atr || !path) return 0;
      return (await atr.settings.countUnder({ path })).count;
    },
    enabled: Boolean(path),
    staleTime: 0,
  });
}
