/**
 * Running route ("/processes").
 *
 * The handoff opens every secondary route the same way: the page header (28
 * display title, its one fact in mono, controls on the right), then the
 * content full-bleed. Running's fact is how many servers are listening, taken
 * from the same `useProcesses` cache the table reads — a second subscription
 * to one TanStack key, not a second sweep.
 *
 * The table itself lives in `<ProcessList />`; this file owns the chrome and
 * the one-step sweep on arrival, because the snapshot the page opens on was
 * produced by an earlier tick and a server started since then would not be in
 * it. The Refresh action is the same sweep on demand.
 */

import { createRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@renderer/components/layout/page-header";
import { ProcessList } from "@renderer/components/process/process-list";
import {
  useProcesses,
  useRefreshProcesses,
} from "@renderer/hooks/use-processes";
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
  const listing = useProcesses();
  const count = listing.data?.processes.length ?? 0;

  // One sweep per visit: the snapshot the page opens on was produced by an
  // earlier tick, and a dev server started since then would not be in it.
  React.useEffect(() => {
    if (bridgeAvailable) refreshNow();
  }, [bridgeAvailable, refreshNow]);

  return (
    <>
      <PageHeader
        title="Running"
        meta={
          count > 0
            ? `${count} listening`
            : bridgeAvailable
              ? "Nothing listening"
              : "Process detection unavailable"
        }
        actions={
          bridgeAvailable ? (
            <button
              type="button"
              onClick={() => refreshNow()}
              disabled={refresh.isPending}
              aria-busy={refresh.isPending}
              title="Scan for listening servers now"
              className="flex h-7 cursor-pointer items-center gap-1.5 rounded px-2 text-label font-medium text-muted-foreground transition-colors duration-150 hover:bg-surface-raised hover:text-foreground disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", refresh.isPending && "animate-spin")}
                aria-hidden
              />
              Refresh
            </button>
          ) : null
        }
      />

      {bridgeAvailable ? (
        <ProcessList />
      ) : (
        <div className="px-6 py-8">
          <p className="text-body font-medium text-foreground">
            Process detection unavailable — preload bridge missing.
          </p>
          <p className="mt-1 max-w-[68ch] text-body text-muted-foreground">
            Run via <code className="font-mono">pnpm electron:dev</code> so the
            Electron preload script loads.
          </p>
        </div>
      )}
    </>
  );
}
