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
}

export function DetailPanel({
  repo,
  loading,
  onClose,
  className,
  taskRuns,
  onClearRun,
}: DetailPanelProps) {
  const open = !!repo || loading;

  return (
    <aside
      aria-hidden={!open}
      aria-label="Repo detail"
      className={cn(
        "fixed right-0 top-0 z-30 h-full w-full max-w-[420px] transform transition-transform duration-200 ease-out lg:static lg:h-auto lg:max-w-none lg:shrink-0",
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
        />
      ) : null}
    </aside>
  );
}
