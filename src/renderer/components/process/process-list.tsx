/**
 * ProcessList — table of currently-running dev servers across the
 * whole catalog. Rendered by the `/processes` route.
 *
 * Columns: Repo (linked) | Command | Port | PID | Age | Actions.
 *
 * Empty state: "No dev servers detected. Start one with `pnpm dev`
 * (or similar) and it will appear here."
 *
 * The list re-renders automatically whenever `useProcesses()` cache
 * is updated either by the 5s poll or a push event from the
 * `process:on:update` channel — both routes through the same
 * TanStack Query cache.
 *
 * Kill asks through the shared `ConfirmDialog` (ATR-067) — it used to call
 * `window.confirm`, which blocks the renderer and is announced differently
 * from every other confirmation in the app. The loading and failed states
 * are the catalog's own skeleton and the shared retry panel (ATR-063/064).
 */

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { Copy, Square } from "lucide-react";

import type { ProcessInfo } from "@shared/types";

import { Button } from "@renderer/components/ui/button";
import { ConfirmDialog } from "@renderer/components/ui/confirm-dialog";
import { ErrorState } from "@renderer/components/ui/error-state";
import { Skeleton, SkeletonRegion } from "@renderer/components/ui/skeleton";
import { useKillProcess, useProcesses } from "@renderer/hooks/use-processes";
import { cn } from "@renderer/lib/cn";

interface ProcessListProps {
  /** Optional className applied to the outer wrapper. */
  className?: string;
}

export function ProcessList({ className }: ProcessListProps) {
  const query = useProcesses();
  const kill = useKillProcess();
  // Which row is being confirmed, if any. The dialog is a sibling of the
  // table rather than a child of the row: the row unmounts the moment the
  // process goes away, and a dialog inside it would go with it.
  const [confirming, setConfirming] = React.useState<ProcessInfo | null>(null);

  const handleKill = React.useCallback(
    (p: ProcessInfo) => {
      setConfirming(p);
    },
    [],
  );

  const confirmKill = React.useCallback(() => {
    if (!confirming) return;
    kill.mutate({ pid: confirming.pid });
    setConfirming(null);
  }, [confirming, kill]);

  const handleCopy = React.useCallback(async (p: ProcessInfo) => {
    try {
      await navigator.clipboard.writeText(`http://localhost:${p.port}`);
    } catch {
      // ignore — clipboard can fail in non-secure contexts
    }
  }, []);

  if (query.isLoading) {
    return (
      <SkeletonRegion
        label="Loading processes…"
        className={cn(
          "rounded-lg border border-border bg-card p-4",
          className,
        )}
      >
        {Array.from({ length: 4 }, (_, row) => (
          <div key={row} className="flex items-center gap-3">
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="ml-auto h-3 w-10" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </SkeletonRegion>
    );
  }

  if (query.error) {
    return (
      <ErrorState
        title="Failed to read process snapshot"
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        className={className}
      />
    );
  }

  const rows = query.data?.processes ?? [];

  if (rows.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card/50 p-12 text-center",
          className,
        )}
      >
        <p className="font-mono text-sm text-foreground">
          No dev servers detected.
        </p>
        <p className="max-w-md text-xs text-muted-foreground">
          Start one with <code className="font-mono">pnpm dev</code> (or
          similar) and it will appear here within a few seconds.
        </p>
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "overflow-hidden rounded-lg border border-border bg-card",
          className,
        )}
      >
        <table role="table" className="w-full border-collapse text-left text-xs">
          <thead className="border-b border-border bg-muted/40 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Repo
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Command
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Port
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                PID
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Age
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <ProcessRow
                key={`${p.pid}-${p.port}`}
                process={p}
                onCopy={() => handleCopy(p)}
                onKill={() => handleKill(p)}
                killing={kill.isPending && kill.variables?.pid === p.pid}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/*
        Outside the table on purpose: killing a row makes it disappear on
        the next sweep, and a dialog nested inside it would disappear too.
      */}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={`Kill PID ${confirming?.pid ?? ""}?`}
        description={
          confirming ? (
            <>
              Sends <code className="font-mono">SIGINT</code> to{" "}
              <code className="font-mono">{confirming.command}</code> on port{" "}
              {confirming.port}, then escalates to SIGTERM and SIGKILL if it
              does not exit. Nothing on disk is touched.
            </>
          ) : null
        }
        confirmLabel="Kill process"
        destructive
        pending={kill.isPending}
        onConfirm={confirmKill}
      />
    </>
  );
}

interface ProcessRowProps {
  process: ProcessInfo;
  onCopy: () => void;
  onKill: () => void;
  killing: boolean;
}

function ProcessRow({ process, onCopy, onKill, killing }: ProcessRowProps) {
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-muted/20">
      <td className="px-3 py-2">
        {process.repoSlug ? (
          <Link
            to="/repos/$slug"
            params={{ slug: process.repoSlug }}
            className="font-mono text-foreground underline-offset-4 hover:underline"
          >
            {process.repoSlug}
          </Link>
        ) : (
          <span className="font-mono text-muted-foreground italic">
            (unmatched)
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <span
          className="block max-w-[28rem] truncate font-mono text-muted-foreground"
          title={process.commandLine}
        >
          {process.command}
        </span>
      </td>
      <td className="px-3 py-2 font-mono">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span>{process.port}</span>
        </span>
      </td>
      <td className="px-3 py-2 font-mono text-muted-foreground">
        {process.pid}
      </td>
      <td className="px-3 py-2 font-mono text-muted-foreground">
        {relativeAge(process.firstSeenAt)}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="inline-flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            aria-label={`Copy URL for port ${process.port}`}
            title="Copy URL"
            onClick={onCopy}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Kill PID ${process.pid}`}
            title="Kill process"
            onClick={onKill}
            disabled={killing}
          >
            <Square className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Cheap relative-age formatter using epoch-ms (the contract emits
 * `firstSeenAt` as ms-since-epoch, NOT ISO). We can't reuse
 * `relativeTime` from catalog/relative-time.ts because that one
 * accepts an ISO string.
 */
function relativeAge(epochMs: number, now = Date.now()): string {
  if (!epochMs || epochMs <= 0) return "—";
  const diffMs = now - epochMs;
  if (diffMs < 1_000) return "just now";
  const secs = Math.floor(diffMs / 1_000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
