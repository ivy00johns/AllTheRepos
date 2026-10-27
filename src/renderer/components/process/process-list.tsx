/**
 * ProcessList — the Running route's table of listening dev servers.
 *
 * The handoff's Running screen is a table with no box around it: a 36px
 * sentence-case header, a hairline under each row, the repo's own name at 13
 * (never the slug's hash), a green port chip, the command at 11 mono, then the
 * numbers in tabular type and two quiet text actions. The card, the uppercase
 * mono header row and the icon-only buttons were the old dashboard reading of
 * the same data.
 *
 * Columns: Repository · Port · Command · PID · Age · actions.
 *
 * Empty state is one sentence on a padded line — no dashed box.
 *
 * The list re-renders automatically whenever `useProcesses()` cache is updated
 * either by the poll or a push event from the `process:on:update` channel.
 *
 * Kill asks through the shared `ConfirmDialog` (ATR-067) — it used to call
 * `window.confirm`, which blocks the renderer and is announced differently
 * from every other confirmation in the app. The loading and failed states
 * are the catalog's own skeleton and the shared retry panel (ATR-063/064).
 */

import * as React from "react";
import { Link } from "@tanstack/react-router";

import type { ProcessInfo } from "@shared/types";

import { ConfirmDialog } from "@renderer/components/ui/confirm-dialog";
import { ErrorState } from "@renderer/components/ui/error-state";
import { Skeleton, SkeletonRegion } from "@renderer/components/ui/skeleton";
import { useKillProcess, useProcesses } from "@renderer/hooks/use-processes";
import { cn } from "@renderer/lib/cn";

interface ProcessListProps {
  /** Optional className applied to the outer wrapper. */
  className?: string;
}

/**
 * A repo slug is `<kebab-name>-<6 hex>`; the hash is a path fingerprint, not a
 * word, and it was being drawn as part of the repo's name. The process row
 * carries no `name` field, so the name is the slug minus that suffix.
 */
function repoLabel(slug: string): string {
  // Six hex characters in production, eight in the design packet's demo
  // library; both are the path fingerprint and neither is part of the name.
  return slug.replace(/-[0-9a-f]{6,8}$/, "");
}

export function ProcessList({ className }: ProcessListProps) {
  const query = useProcesses();
  const kill = useKillProcess();
  // Which row is being confirmed, if any. The dialog is a sibling of the
  // table rather than a child of the row: the row unmounts the moment the
  // process goes away, and a dialog inside it would go with it.
  const [confirming, setConfirming] = React.useState<ProcessInfo | null>(null);

  const handleKill = React.useCallback((p: ProcessInfo) => {
    setConfirming(p);
  }, []);

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
        className={cn("flex flex-col gap-3 px-6 py-6", className)}
      >
        {Array.from({ length: 4 }, (_, row) => (
          <div key={row} className="flex items-center gap-6">
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
        className={cn("m-6", className)}
      />
    );
  }

  const rows = query.data?.processes ?? [];

  if (rows.length === 0) {
    return (
      <div className={cn("px-6 py-8", className)}>
        <p className="max-w-[68ch] text-body text-muted-foreground">
          Nothing is listening. Start a dev server in any indexed repo and it
          appears here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className={cn("w-full overflow-x-auto", className)}>
        <table
          role="table"
          className="w-full min-w-[680px] border-collapse text-left"
        >
          <thead>
            <tr className="border-b border-border text-label font-medium text-muted-foreground">
              <th scope="col" className="px-6 py-0 font-medium">
                <span className="flex h-9 items-center">Repository</span>
              </th>
              <th scope="col" className="w-[88px] px-3 py-0 font-medium">
                <span className="flex h-9 items-center">Port</span>
              </th>
              <th scope="col" className="px-3 py-0 font-medium">
                <span className="flex h-9 items-center">Command</span>
              </th>
              <th
                scope="col"
                className="w-[72px] px-3 py-0 text-right font-medium"
              >
                <span className="flex h-9 items-center justify-end">PID</span>
              </th>
              <th scope="col" className="w-[80px] px-3 py-0 font-medium">
                <span className="flex h-9 items-center">Age</span>
              </th>
              <th scope="col" className="w-[168px] px-6 py-0 text-right">
                <span className="sr-only">Actions</span>
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
    <tr className="border-b border-surface-raised last:border-b-0 hover:bg-surface">
      <td className="min-w-0 px-6 py-1.5">
        {process.repoSlug ? (
          <Link
            to="/repos/$slug"
            params={{ slug: process.repoSlug }}
            className="text-body font-medium text-foreground underline-offset-4 hover:underline"
          >
            {repoLabel(process.repoSlug)}
          </Link>
        ) : (
          <span className="text-body italic text-muted-foreground">
            Unmatched
          </span>
        )}
      </td>
      <td className="px-3 py-1.5">
        <span className="inline-flex items-center gap-1.5 rounded border border-status-live/35 px-1.5 py-1 font-mono atr-meta text-status-live">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-status-live"
          />
          <span>:{process.port}</span>
        </span>
      </td>
      <td className="min-w-0 px-3 py-1.5">
        <span
          className="block truncate font-mono atr-meta"
          title={process.commandLine}
        >
          {process.command}
        </span>
      </td>
      <td className="px-3 py-1.5 text-right font-mono atr-meta tabular-nums">
        {process.pid}
      </td>
      <td className="px-3 py-1.5 font-mono atr-meta">
        {relativeAge(process.firstSeenAt)}
      </td>
      <td className="px-6 py-1.5">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            className="h-6 whitespace-nowrap rounded px-2 text-label font-medium text-muted-foreground transition-colors duration-150 hover:bg-surface-raised hover:text-foreground disabled:cursor-wait disabled:opacity-50"
            aria-label={`Copy URL for port ${process.port}`}
            title="Copy URL"
            onClick={onCopy}
          >
            Copy URL
          </button>
          <button
            type="button"
            aria-label={`Kill PID ${process.pid}`}
            className="h-6 whitespace-nowrap rounded px-2 text-label font-medium text-muted-foreground transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive disabled:cursor-wait disabled:opacity-50"
            title="Stop process"
            onClick={onKill}
            disabled={killing}
          >
            Stop
          </button>
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
