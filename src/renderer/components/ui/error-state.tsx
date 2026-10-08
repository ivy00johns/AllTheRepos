import * as React from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/cn";

interface ErrorStateProps {
  /** What failed, in the user's words: "Failed to load settings". */
  title: string;
  /** The thrown value — usually an `Error` carrying the IPC message. */
  error: unknown;
  /**
   * Refetch the query that failed. Every renderer read here goes over IPC to
   * the process that owns the same database the app just wrote to, so almost
   * every failure is transient and a retry is the whole recovery path
   * (ATR-063).
   */
  onRetry?: () => void;
  /** The retry is in flight — keeps the button from queueing a second read. */
  retrying?: boolean;
  className?: string;
}

/** `Error` when we have one, else the raw value — never "[object Object]". */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * ErrorState — the shared "this read failed, here is what to do" panel.
 *
 * `/graph` gained a `Try again` action in the 2026-10-07 rework; the repo
 * detail page, settings and the process list kept rendering a headline plus
 * the raw message and stopping, which left a transient IPC failure as a dead
 * screen with no way out (ATR-063). They share this panel so the retry cannot
 * go missing on one route and not the others.
 */
export function ErrorState({
  title,
  error,
  onRetry,
  retrying = false,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4",
        className,
      )}
    >
      <p className="text-base font-medium text-destructive">{title}</p>
      <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs text-muted-foreground">
        {messageOf(error)}
      </pre>
      {onRetry ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            disabled={retrying}
            aria-busy={retrying}
          >
            <RotateCcw className={cn(retrying && "animate-spin")} aria-hidden />
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
