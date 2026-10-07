/**
 * Signal tallies for the `/graph` filter strip.
 *
 * A link can carry several signals at once (a shared library that is also
 * a name match, say), so the tallies are not a partition of the edge set:
 * each number answers "how many links would this signal draw on its own",
 * which is what a filter toggle is promising before you press it.
 *
 * Kept free of React and cytoscape so it can be unit-tested directly.
 */

import type { GraphEdge, GraphSignal } from "@shared/types";

export function countEdgesBySignal(
  edges: readonly GraphEdge[],
  signals: readonly GraphSignal[],
): Record<GraphSignal, number> {
  const counts = Object.fromEntries(
    signals.map((signal) => [signal, 0]),
  ) as Record<GraphSignal, number>;

  for (const edge of edges) {
    for (const signal of edge.signals) {
      if (signal in counts) counts[signal] += 1;
    }
  }

  return counts;
}
