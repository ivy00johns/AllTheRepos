/**
 * Processes route ("/processes").
 *
 * Flat-table view of every listening dev server detected by the
 * main-side ProcessService. Uses the simple-shell wrapper from
 * `__root.tsx` (single-column layout, no detail panel).
 *
 * The actual table lives in `<ProcessList />` — this route file
 * owns only page chrome (title, breadcrumb back-button, bridge
 * fallback message).
 */

import { Link, createRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { ProcessList } from "@renderer/components/process/process-list";
import { Button } from "@renderer/components/ui/button";
import { getAtr } from "@renderer/lib/atr";

import { Route as RootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/processes",
  component: ProcessesPage,
});

function ProcessesPage() {
  const bridgeAvailable = typeof window !== "undefined" && Boolean(getAtr());

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
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </Link>
        </Button>
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
