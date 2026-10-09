/**
 * Small status marks shared by every density mode.
 *
 * Each mark follows the same two rules:
 *   1. Colour is never the only channel — every mark carries a text
 *      label, an accessible name, or both.
 *   2. The same signal renders identically in gallery, grid and table,
 *      so switching density never changes what a symbol means.
 */

import * as React from "react";
import { CircleDot, GitBranch, Cloud, CloudOff, HardDrive } from "lucide-react";

import { cn } from "@renderer/lib/cn";
import type { ActivityInfo } from "@renderer/lib/activity";
import type { OwnershipInfo } from "@renderer/lib/ownership";

/**
 * Recency mark: a filled bar whose length AND colour both encode how
 * recently the repo was touched, so the signal survives greyscale and
 * colour-vision differences. The exact phrase sits next to it in text.
 */
export function ActivityBar({
  activity,
  className,
}: {
  activity: ActivityInfo;
  className?: string;
}) {
  return (
    <span
      className={cn("flex items-center gap-1.5", className)}
      title={`Last touched ${activity.relative}`}
    >
      <span
        aria-hidden
        className="relative h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${Math.max(12, activity.heat * 100)}%`,
            backgroundColor: activity.color,
          }}
        />
      </span>
      <span className="atr-meta whitespace-nowrap">{activity.relative}</span>
    </span>
  );
}

/** Compact recency dot for table rows, where a bar would be too wide. */
export function ActivityDot({ activity }: { activity: ActivityInfo }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`Last touched ${activity.relative}`}
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: activity.color }}
      />
      <span className="sr-only">{activity.label}. </span>
    </span>
  );
}

const OWNERSHIP_ICONS = {
  mine: Cloud,
  external: CloudOff,
  local: HardDrive,
} as const;

const OWNERSHIP_COLOR_VARS = {
  mine: "var(--color-own-mine)",
  external: "var(--color-own-external)",
  local: "var(--color-own-local)",
} as const;

/**
 * Ownership mark.
 *
 * `compact` renders just the icon (table rows) with the label moved to
 * the accessible name; otherwise the handle is shown inline, because
 * "who does this belong to" is usually the follow-up question after
 * "is it mine".
 */
export function OwnershipMark({
  ownership,
  compact,
  className,
}: {
  ownership: OwnershipInfo;
  compact?: boolean;
  className?: string;
}) {
  const Icon = OWNERSHIP_ICONS[ownership.kind];
  const color = OWNERSHIP_COLOR_VARS[ownership.kind];
  const description =
    ownership.kind === "mine"
      ? "Yours"
      : ownership.kind === "local"
        ? "Local only, no remote"
        : `Cloned from ${ownership.owner}`;

  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      title={description}
    >
      <Icon className="h-3 w-3 shrink-0" style={{ color }} aria-hidden />
      {compact ? (
        <span className="sr-only">{description}</span>
      ) : (
        <span
          className="atr-truncate atr-label font-mono leading-none"
          style={{ color }}
        >
          {ownership.label}
        </span>
      )}
    </span>
  );
}

/**
 * Working-tree state. Only rendered when there is something to say —
 * a badge on every clean repo would be pure noise.
 */
export function DirtyMark({ compact }: { compact?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-warning"
      title="Uncommitted changes in the working tree"
    >
      <CircleDot className="h-3 w-3 shrink-0" aria-hidden />
      {compact ? (
        <span className="sr-only">Uncommitted changes</span>
      ) : (
        <span className="atr-micro font-mono leading-none">uncommitted</span>
      )}
    </span>
  );
}

/** Branch chip — shown only when the repo is off its default branch. */
export function BranchMark({ branch }: { branch: string }) {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1 text-muted-foreground"
      title={`On branch ${branch}`}
    >
      <GitBranch className="h-3 w-3 shrink-0" aria-hidden />
      <span className="atr-truncate atr-micro font-mono leading-none">
        {branch}
      </span>
    </span>
  );
}

/**
 * Missing-on-disk mark. The strongest warning in the catalog: the row
 * describes something that is no longer there.
 */
export function MissingMark({ compact }: { compact?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 text-destructive"
      title="This path no longer exists on disk"
    >
      <span className="atr-micro font-mono font-semibold uppercase leading-none">
        {compact ? "!" : "missing"}
      </span>
      {compact ? <span className="sr-only">Missing from disk</span> : null}
    </span>
  );
}
