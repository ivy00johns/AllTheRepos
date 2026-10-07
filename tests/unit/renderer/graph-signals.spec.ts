/**
 * Unit tests for the `/graph` signal tallies.
 *
 * `countEdgesBySignal` is pure, so it is imported directly. The property
 * worth pinning is that an edge is counted once per signal it carries:
 * the numbers feed filter toggles, and a toggle that promised fewer links
 * than it draws would be a lie in the UI rather than a crash.
 */

import { describe, expect, it } from "vitest";

import type { GraphEdge, GraphSignal } from "@shared/types";

import { countEdgesBySignal } from "@renderer/lib/graph-signals";

const ALL: GraphSignal[] = [
  "curated",
  "dependency",
  "reference",
  "submodule",
  "owner",
  "naming",
];

function edge(
  source: string,
  target: string,
  signals: GraphSignal[],
): GraphEdge {
  return { source, target, weight: 1, signals, why: [] };
}

describe("countEdgesBySignal", () => {
  it("starts every requested signal at zero", () => {
    expect(countEdgesBySignal([], ALL)).toEqual({
      curated: 0,
      dependency: 0,
      reference: 0,
      submodule: 0,
      owner: 0,
      naming: 0,
    });
  });

  it("counts one edge under every signal it carries", () => {
    const counts = countEdgesBySignal(
      [edge("a", "b", ["dependency", "naming"])],
      ALL,
    );
    expect(counts.dependency).toBe(1);
    expect(counts.naming).toBe(1);
    expect(counts.curated).toBe(0);
  });

  it("tallies the whole edge set rather than distinct signals", () => {
    const counts = countEdgesBySignal(
      [
        edge("a", "b", ["owner"]),
        edge("b", "c", ["owner"]),
        edge("c", "d", ["owner", "reference"]),
      ],
      ALL,
    );
    expect(counts.owner).toBe(3);
    expect(counts.reference).toBe(1);
  });

  it("leaves a signal outside the requested set out of the tally", () => {
    const counts = countEdgesBySignal([edge("a", "b", ["curated"])], [
      "dependency",
    ]);
    expect(counts).toEqual({ dependency: 0 });
  });
});
