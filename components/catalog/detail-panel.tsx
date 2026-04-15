"use client";

import * as React from "react";
import type { RepoDetail } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RepoDetailContent } from "./repo-detail-content";

interface DetailPanelProps {
  repo: RepoDetail | null;
  loading?: boolean;
  onClose: () => void;
  className?: string;
}

export function DetailPanel({
  repo,
  loading,
  onClose,
  className,
}: DetailPanelProps) {
  const open = !!repo || loading;

  return (
    <aside
      aria-hidden={!open}
      aria-label="Repo detail"
      className={cn(
        "fixed right-0 top-0 z-30 h-full w-full max-w-[420px] transform transition-transform duration-200 ease-out lg:static lg:h-auto lg:max-w-none lg:w-[360px] lg:shrink-0",
        open
          ? "translate-x-0"
          : "translate-x-full lg:translate-x-0 lg:pointer-events-none lg:opacity-0",
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
        <RepoDetailContent repo={repo} onClose={onClose} variant="panel" />
      ) : null}
    </aside>
  );
}
