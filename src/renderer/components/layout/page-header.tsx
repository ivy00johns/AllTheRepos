/**
 * Page header — the chrome every secondary route opens with.
 *
 * The handoff's secondary routes are places, not panels: a 56px bar with the
 * route's name at the display tier (28), its one fact beside it in mono, and
 * its controls on the right, closed by a hairline. Fifteen routes inventing
 * their own version of that is the drift this component exists to stop — the
 * old headings were `font-mono text-2xl` in five different arrangements, each
 * with a subtitle sentence underneath.
 *
 * The title is the route's only `h1`; anything the route places after `meta`
 * (the map's signal toggles, the palette's range control) belongs to the same
 * line and wraps with it at 1024 rather than being pushed off.
 */

import * as React from "react";

import { cn } from "@renderer/lib/cn";

export interface PageHeaderProps {
  /** The route's name, at the display tier. Rendered as the route's `h1`. */
  title: string;
  /** One fact about the page, e.g. `4 listening` or `v0.14.2`. */
  meta?: React.ReactNode;
  /** Controls that belong to the header line, right of the title. */
  children?: React.ReactNode;
  /** Controls pinned to the far right of the line. */
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  meta,
  children,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-6 py-3",
        className,
      )}
    >
      <h1 className="m-0 text-display font-semibold text-foreground">
        {title}
      </h1>
      {meta ? <span className="atr-meta">{meta}</span> : null}
      {children}
      {actions ? (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
