/**
 * PortChip — inline chip rendered on a repo card when the repo has a
 * bound listening process. Click opens a tiny dropdown menu with
 * "Copy URL", "Open in browser", "Kill".
 *
 * Visual: small green pulsing dot + `:<port>` label. Multiple ports
 * for the same repo render multiple chips side-by-side.
 *
 * Kill confirmation uses `window.confirm()` for Phase 3a — simple,
 * accessible, and avoids the cost of authoring a confirm Dialog right
 * now. Promote to a Dialog in Phase 5 polish.
 */

import * as React from "react";

import type { ProcessInfo } from "@shared/types";

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
    const ok = window.confirm(
      `Kill PID ${process.pid} (${process.command}) on port ${process.port}?`,
    );
    if (!ok) return;
    kill.mutate({ pid: process.pid });
  }, [kill, process.pid, process.command, process.port]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Port ${process.port} actions (PID ${process.pid})`}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent transition-colors hover:bg-accent/20 focus:outline-none focus:ring-2 focus:ring-ring",
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
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
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
 * Visual: the existing theme's `--color-accent` token is already a
 * vivid green (#22c55e), which doubles as our "running process"
 * indicator. The pulsing dot uses `bg-accent` + `animate-ping` for
 * the halo so the chip lights up the card without needing a new
 * design token.
 */
