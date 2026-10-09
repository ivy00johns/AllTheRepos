import * as React from "react";

import type { RepoDetail } from "@shared/types";

import type { TaskRunState } from "@renderer/hooks/use-actions";

import { cn } from "@renderer/lib/cn";

import { RepoDetailContent } from "./repo-detail-content";

interface DetailPanelProps {
  repo: RepoDetail | null;
  loading?: boolean;
  onClose: () => void;
  className?: string;
  /** Live task output, keyed by run id. */
  taskRuns?: Record<string, TaskRunState>;
  onClearRun?: (runId: string) => void;
  /** Open another repo (the Related list hops the panel). */
  onOpenRepo?: (slug: string) => void;
}

export function DetailPanel({
  repo,
  loading,
  onClose,
  className,
  taskRuns,
  onClearRun,
  onOpenRepo,
}: DetailPanelProps) {
  const open = !!repo || loading;

  return (
    <aside
      aria-hidden={!open}
      aria-label="Repo detail"
      className={cn(
        // Below `lg` this is a fixed drawer. It starts BELOW the top bar
        // (`top-12` / `h-[calc(100%-3rem)]`, matching the bar's `h-12`) rather
        // than at `top-0`: covering the bar put the drawer over the app title,
        // the search field and every nav destination, so at the window's
        // minimum width the whole global header was unclickable while a repo
        // was selected. At `lg` and up the `static`/`h-auto` overrides win and
        // the panel is part of the layout, exactly as before.
        "fixed right-0 top-12 z-30 h-[calc(100%-3rem)] w-full max-w-[420px] transform transition-transform duration-200 ease-out lg:static lg:h-auto lg:max-w-none lg:shrink-0",
        // On wide screens the panel is part of the layout, so when it's
        // closed it must give its width BACK to the grid. Previously it
        // only faded out, permanently costing the catalog 360px — a
        // quarter of the window showing nothing.
        open
          ? "translate-x-0 lg:w-[380px]"
          : "translate-x-full lg:translate-x-0 lg:w-0 lg:overflow-hidden lg:pointer-events-none lg:opacity-0",
        className,
      )}
    >
      {loading ? (
        <div className="flex h-full flex-col gap-4 border-l border-border bg-card p-4">
          <div className="h-6 w-40 animate-pulse rounded bg-muted" />
          <div className="h-4 w-64 animate-pulse rounded bg-muted" />
          <div className="h-24 w-full animate-pulse rounded bg-muted" />
          <div className="h-24 w-full animate-pulse rounded bg-muted" />
        </div>
      ) : repo ? (
        <RepoDetailContent
          repo={repo}
          onClose={onClose}
          variant="panel"
          taskRuns={taskRuns}
          onClearRun={onClearRun}
          onOpenRepo={onOpenRepo}
        />
      ) : null}
    </aside>
  );
}
