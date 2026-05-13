/**
 * Scan status bar — thin progress indicator just below the top bar.
 *
 * Renders only when a scan is running, just finished, or errored.
 * Reads from `useScanStore` and exposes a cancel button that calls
 * `useScan().cancelScan()`. The actual subscription to scan events is
 * mounted by `useScanEventBus()` in App.tsx; this component only
 * reads.
 */

import { Button } from "@renderer/components/ui/button";
import { useScan } from "@renderer/hooks/use-scan";

export function ScanStatusBar() {
  const { state, cancelScan, reset } = useScan();

  if (state.phase === "idle") return null;

  const pct =
    state.total > 0
      ? Math.min(100, Math.round((state.processed / state.total) * 100))
      : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-muted px-3 text-xs"
    >
      <span className="font-mono font-medium uppercase tracking-wider text-muted-foreground">
        scan
      </span>

      {state.phase === "running" ? (
        <>
          <div className="h-1.5 w-48 overflow-hidden rounded-full bg-background">
            <div
              className="h-full bg-foreground transition-[width] duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-mono text-muted-foreground">
            {state.processed}/{state.total || "?"}
          </span>
          {state.currentPath ? (
            <span className="truncate font-mono text-muted-foreground">
              {state.currentPath}
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void cancelScan()}
          >
            Cancel
          </Button>
        </>
      ) : state.phase === "done" ? (
        <>
          <span className="font-mono text-muted-foreground">
            done · {state.reposFound} repos
            {state.durationMs !== null
              ? ` · ${(state.durationMs / 1000).toFixed(1)}s`
              : ""}
          </span>
          <Button variant="ghost" size="sm" onClick={reset}>
            Dismiss
          </Button>
        </>
      ) : state.phase === "error" ? (
        <>
          <span className="font-mono text-destructive">
            error · {state.lastError ?? "unknown"}
          </span>
          <Button variant="ghost" size="sm" onClick={reset}>
            Dismiss
          </Button>
        </>
      ) : state.phase === "cancelled" ? (
        <>
          <span className="font-mono text-muted-foreground">cancelled</span>
          <Button variant="ghost" size="sm" onClick={reset}>
            Dismiss
          </Button>
        </>
      ) : null}
    </div>
  );
}
