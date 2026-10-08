/**
 * Skeleton — the placeholder shape for content that is still arriving.
 *
 * The catalog grid has had one since it was built (`GridSkeleton` in
 * `catalog/repo-grid.tsx`), and the detail panel has had its own bars, while
 * three routes rendered a bare sentence for the same class of wait — which is
 * the worst place to put a sentence, because with a cold start the first paint
 * is exactly where it shows (ATR-064).
 *
 * One primitive rather than a component per screen: a skeleton is a box of the
 * right size that pulses, and every caller knows the right size. `aria-hidden`
 * is deliberate — the *container* announces the wait with `aria-busy` and a
 * live region, so a screen reader hears "loading" once instead of hearing a
 * dozen empty boxes.
 */

import { cn } from "@renderer/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} />
  );
}
