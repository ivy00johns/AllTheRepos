/**
 * ErrorState — what a screen shows when a read failed, and the way out of it.
 *
 * Three routes rendered a headline plus the raw message and stopped there, so a
 * transient failure left a dead screen: the only recovery was to quit and
 * relaunch (ATR-063). `/graph` had already grown a "Try again" that refetches,
 * and this is that shape with a name, so the next error screen gets the exit
 * without anyone having to remember it.
 *
 * The message is printed rather than swallowed. A retry that fails again and
 * says nothing new is worse than one that shows the reason it failed, and the
 * ones this replaces already showed it.
 */

import { RotateCcw } from "lucide-react";

import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/cn";

interface ErrorStateProps {
  /** What failed, in the app's voice — "Failed to load settings". */
  title: string;
  /** The underlying error, shown under the title. */
  message?: string | null;
  /** Refetch the query that failed. */
  onRetry: () => void;
  /** Set while the retry is in flight, so the button cannot be double-fired. */
  retrying?: boolean;
  className?: string;
}

export function ErrorState({
  title,
  message,
  onRetry,
  retrying = false,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-destructive/30 bg-destructive/5 p-6",
        className,
      )}
    >
      <p className="font-medium text-destructive">{title}</p>
      {message ? (
        <pre className="mt-2 overflow-x-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">
          {message}
        </pre>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={onRetry}
        disabled={retrying}
      >
        <RotateCcw aria-hidden />
        Try again
      </Button>
    </div>
  );
}
