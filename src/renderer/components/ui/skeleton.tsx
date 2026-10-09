import * as React from "react";

import { cn } from "@renderer/lib/cn";

/**
 * Skeleton — one animated placeholder block.
 *
 * Five surfaces wait on the same class of read: the catalog grid, the detail
 * panel, and the three route-level states on `/repos/$slug`, `/settings` and
 * `/processes`. Each used to carry its own `animate-pulse` markup — the three
 * routes did not, and showed a bare sentence instead, so a cold start looked
 * like two different applications (ATR-064). The treatment lives here once;
 * callers pass size and radius.
 *
 * Hidden from assistive tech on purpose: the region around it carries
 * `aria-busy` and a visually-hidden sentence, so a screen reader hears
 * "Loading settings…" rather than the decorative blocks.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded bg-muted", className)}
      {...props}
    />
  );
}

/**
 * The labelled wrapper every skeleton state shares: an `aria-busy` region, a
 * sentence only a screen reader reads, and the pulse blocks inside it.
 */
export function SkeletonRegion({
  label,
  className,
  children,
}: {
  /** Announced instead of the placeholder blocks, e.g. "Loading settings…". */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={cn("flex flex-col gap-3", className)}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
