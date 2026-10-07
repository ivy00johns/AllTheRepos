/**
 * Processes route ("/processes").
 *
 * Flat-table view of every listening dev server detected by the
 * main-side ProcessService. Uses the simple-shell wrapper from
 * `__root.tsx` (single-column layout, no detail panel).
 *
 * The actual table lives in `<ProcessList />` — this route file
 * owns only page chrome (title, breadcrumb back-button, Refresh action,
 * bridge fallback message).
 *
 * Opening the page runs one sweep (`useRefreshProcesses`), because reading
 * the cached snapshot cannot show a server that started after the last tick.
 * The Refresh button is the same sweep on demand.
 */

import { Link, createRoute } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";
import * as React from "react";

import { ProcessList } from "@renderer/components/process/process-list";
import { Button } from "@renderer/components/ui/button";
import { useRefreshProcesses } from "@renderer/hooks/use-processes";
import { cn } from "@renderer/lib/cn";
import { getAtr } from "@renderer/lib/atr";

import { Route as RootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/processes",
  component: ProcessesPage,
});

function ProcessesPage() {
  const bridgeAvailable = typeof window !== "undefined" && Boolean(getAtr());
  const refresh = useRefreshProcesses();
  const { mutate: refreshNow } = refresh;

  // One sweep per visit: the snapshot the panel opens on was produced by an
  // earlier tick, and a dev server started since then would not be in it.
  React.useEffect(() => {
    if (bridgeAvailable) refreshNow();
  }, [bridgeAvailable, refreshNow]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">
            Processes
          </h1>
          <p className="text-sm text-muted-foreground">
            Listening dev servers detected across all configured repos.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {bridgeAvailable ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refreshNow()}
              disabled={refresh.isPending}
              aria-busy={refresh.isPending}
              title="Scan for listening servers now"
            >
              <RefreshCw
                className={cn("h-4 w-4", refresh.isPending && "animate-spin")}
                aria-hidden
              />
              Refresh
            </Button>
          ) : null}
          <Button asChild variant="ghost" size="sm">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </Link>
          </Button>
        </div>
      </div>

      {bridgeAvailable ? (
        <ProcessList />
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-6">
          <p className="font-mono text-sm text-foreground">
            Process detection unavailable — preload bridge missing.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Run via <code className="font-mono">pnpm electron:dev</code> so the
            Electron preload script loads.
          </p>
        </div>
      )}
    </div>
  );
}
