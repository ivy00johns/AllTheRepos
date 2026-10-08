/**
 * PortChip — inline chip rendered on a repo card when the repo has a
 * bound listening process. Click opens a tiny dropdown menu with
 * "Copy URL", "Open in browser", "Kill".
 *
 * Visual: small pulsing dot in the live-status hue + `:<port>` label.
 * Multiple ports for the same repo render multiple chips side-by-side.
 *
 * Kill asks through the shared `ConfirmDialog` (ATR-067), the same one the
 * process table uses. It used to call `window.confirm()`, which blocks the
 * whole renderer and is announced differently from every other confirmation
 * in the app.
 */

import * as React from "react";

import type { ProcessInfo } from "@shared/types";

import { ConfirmDialog } from "@renderer/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { useKillProcess } from "@renderer/hooks/use-processes";
import { cn } from "@renderer/lib/cn";

interface PortChipProps {
  process: ProcessInfo;
  className?: string;
}

export function PortChip({ process, className }: PortChipProps) {
  const url = `http://localhost:${process.port}`;
  const kill = useKillProcess();
  const [confirming, setConfirming] = React.useState(false);

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API can fail in non-secure contexts; we silently
      // swallow rather than surface a toast for 3a.
    }
  }, [url]);

  const handleOpen = React.useCallback(() => {
    // The renderer's CSP forbids opening external URLs from the
    // window context — defer to the main-side allowlist via the
    // global `<a target="_blank">` shim that Electron handles. For
    // 3a, simplest path is to use `window.open` which Electron's
    // setWindowOpenHandler routes through `openExternalAllowlisted`.
    window.open(url, "_blank", "noopener,noreferrer");
  }, [url]);

  const handleKill = React.useCallback(() => {
    setConfirming(true);
  }, []);

  const confirmKill = React.useCallback(() => {
    kill.mutate({ pid: process.pid });
    setConfirming(false);
  }, [kill, process.pid]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Port ${process.port} actions (PID ${process.pid})`}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-status-live/40 bg-status-live/10 px-2 py-0.5 font-mono atr-micro text-status-live transition-colors hover:bg-status-live/20 focus:outline-none focus:ring-2 focus:ring-ring",
              kill.isPending && "opacity-50",
              className,
            )}
            onClick={(e) => {
              // Prevent click bubbling into parent repo-card (which
              // would otherwise call `onSelect` / open the editor).
              e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <span aria-hidden className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-live/60 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-status-live" />
            </span>
            <span>:{process.port}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuLabel className="font-mono text-xs">
            PID {process.pid} · {process.command}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleOpen}>
            Open in browser
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleCopy}>
            Copy URL ({url})
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={handleKill}
            className="text-destructive focus:text-destructive"
          >
            Kill process
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Kill PID ${process.pid}?`}
        description={
          <>
            Sends <code className="font-mono">SIGINT</code> to{" "}
            <code className="font-mono">{process.command}</code> on port{" "}
            {process.port}, then escalates to SIGTERM and SIGKILL if it does not
            exit. Nothing on disk is touched.
          </>
        }
        confirmLabel="Kill process"
        destructive
        pending={kill.isPending}
        onConfirm={confirmKill}
      />
    </>
  );
}

interface PortChipsForRepoProps {
  processes: ProcessInfo[];
  className?: string;
}

/**
 * Convenience component that maps an array of ProcessInfo rows into
 * a row of PortChips. Renders nothing when the list is empty so
 * callers can drop it inline without conditionals.
 */
export function PortChipsForRepo({
  processes,
  className,
}: PortChipsForRepoProps) {
  if (processes.length === 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {processes.map((p) => (
        <PortChip key={`${p.pid}-${p.port}`} process={p} />
      ))}
    </span>
  );
}

/**
 * Visual: the dot's hue is `--color-status-live`, a token of its own (ATR-073),
 * not `--accent`.
 *
 * It used to be painted with the accent — the brand and primary-action colour —
 * so a status read as an affordance, and a re-brand would have repainted every
 * "is this up right now" mark along with the buttons. The pulsing halo is the
 * same token at 60% via `animate-ping`, so the chip lights up the card without
 * needing a second token.
 */
