/**
 * useScan — scan job orchestration hook.
 *
 * Reads scan state from the global `useScanStore` and exposes two
 * actions:
 *   - `startScan(opts?)` — call `scan:start`, then update the store
 *     with the returned jobId/startedAt.
 *   - `cancelScan()`   — call `scan:cancel` with the active jobId; if
 *     the server confirms, transition the store to `"cancelled"`.
 *
 * The push-event subscription itself is mounted ONCE in App.tsx via
 * `useScanEventBus()` (below). Keeping the subscription out of this
 * hook avoids the subscription being torn down whenever a consumer
 * unmounts — events would be missed during a scan.
 *
 * On the off chance the user starts another scan while one is running,
 * the contract says the main process MAY reject with a 409-shaped
 * error; we just bubble that error up.
 */

import { useCallback, useEffect } from "react";

import { getAtr } from "@renderer/lib/atr";
import { useScanStore, type ScanState } from "@renderer/stores/scan";
import type { StartScanInput } from "@shared/types";

interface UseScanReturn {
  state: ScanState;
  startScan(opts?: StartScanInput): Promise<void>;
  cancelScan(): Promise<void>;
  reset(): void;
}

export function useScan(): UseScanReturn {
  const state = useScanStore();
  const { markStarted, markCancelled, reset } = useScanStore();

  const startScan = useCallback(
    async (opts: StartScanInput = {}) => {
      const atr = getAtr();
      if (!atr) {
        throw new Error("Preload bridge unavailable — cannot start scan.");
      }
      const result = await atr.scan.start(opts);
      markStarted(result.jobId, result.startedAt);
    },
    [markStarted],
  );

  const cancelScan = useCallback(async () => {
    const atr = getAtr();
    if (!atr) {
      throw new Error("Preload bridge unavailable — cannot cancel scan.");
    }
    const jobId = useScanStore.getState().jobId;
    if (!jobId) return;
    const result = await atr.scan.cancel({ jobId });
    if (result.cancelled) {
      markCancelled();
    }
  }, [markCancelled]);

  return { state, startScan, cancelScan, reset };
}

/**
 * Wires `window.atr.scan.onProgress` → `useScanStore.applyEvent` for
 * the lifetime of the renderer. Call this exactly once at the top of
 * the app tree (App.tsx). It is a no-op when the bridge is missing.
 */
export function useScanEventBus(): void {
  const applyEvent = useScanStore((s) => s.applyEvent);

  useEffect(() => {
    const atr = getAtr();
    if (!atr) return;
    const unsubscribe = atr.scan.onProgress(applyEvent);
    return () => {
      unsubscribe();
    };
  }, [applyEvent]);
}
