/**
 * Unit tests for the `/graph` cluster-level overview.
 *
 * `buildClusterOverview` is pure, so it is imported directly. The properties
 * worth pinning are the ones the map's readability rests on: a link inside
 * one group must not become a loop on the overview, the same two groups must
 * collapse to a single edge however many repos connect them, and the cap must
 * drop the weakest links rather than whichever happened to be last.
 */

import { describe, expect, it } from "vitest";

import type { GraphCluster, GraphEdge } from "@shared/types";

import {
  buildClusterOverview,
  CLUSTER_LINK_CAP,
  UNGROUPED_CLUSTER_ID,
} from "@renderer/lib/graph-clusters";

function cluster(
  id: number,
  label: string,
  slugs: string[],
  strays: string[] = [],
): GraphCluster {
  return {
    id,
    label,
    size: slugs.length,
    slugs,
    folders: [{ folder: "/repos", count: slugs.length }],
    folderSpread: 1,
    dominantFolder: "/repos",
    strays,
  };
}

function edge(source: string, target: string): GraphEdge {
  return { source, target, weight: 1, signals: ["owner"], why: [] };
}

describe("buildClusterOverview", () => {
  it("turns each cluster into one group, keeping its order and strays", () => {
    const overview = buildClusterOverview(
      [cluster(0, "hub", ["a", "b", "c"], ["c"]), cluster(1, "pair", ["d", "e"])],
      [],
      [],
    );

    expect(overview.groups).toEqual([
      { id: 0, label: "hub", size: 3, strays: 1 },
      { id: 1, label: "pair", size: 2, strays: 0 },
    ]);
    expect(overview.links).toEqual([]);
  });

  it("adds the leftovers as one group, last, under the sentinel id", () => {
    const overview = buildClusterOverview(
      [cluster(0, "hub", ["a", "b"])],
      [],
      ["x", "y", "z"],
    );

    expect(overview.groups).toEqual([
      { id: 0, label: "hub", size: 2, strays: 0 },
      { id: UNGROUPED_CLUSTER_ID, label: "Ungrouped", size: 3, strays: 0 },
    ]);
  });

  it("adds no leftovers group when every repo is accounted for", () => {
    const overview = buildClusterOverview([cluster(0, "hub", ["a", "b"])], [], []);
    expect(overview.groups.map((g) => g.id)).toEqual([0]);
  });

  it("collapses several repo links between two groups into one edge", () => {
    const overview = buildClusterOverview(
      [cluster(0, "hub", ["a", "b"]), cluster(1, "pair", ["d", "e"])],
      [edge("a", "d"), edge("a", "e"), edge("b", "d")],
      [],
    );

    expect(overview.links).toEqual([{ source: 0, target: 1, links: 3 }]);
  });

  it("counts a link once whichever direction it was discovered in", () => {
    const overview = buildClusterOverview(
      [cluster(0, "hub", ["a"]), cluster(1, "pair", ["b"])],
      [edge("a", "b"), edge("b", "a")],
      [],
    );

    expect(overview.links).toEqual([{ source: 0, target: 1, links: 2 }]);
  });

  it("drops a link whose two ends are in the same group", () => {
    const overview = buildClusterOverview(
      [cluster(0, "hub", ["a", "b"])],
      [edge("a", "b")],
      [],
    );

    expect(overview.links).toEqual([]);
  });

  it("drops a link with an end in no group at all", () => {
    const overview = buildClusterOverview(
      [cluster(0, "hub", ["a", "b"])],
      [edge("a", "ghost")],
      [],
    );

    expect(overview.links).toEqual([]);
  });

  it("links the leftovers group to a cluster like any other group", () => {
    const overview = buildClusterOverview(
      [cluster(0, "hub", ["a", "b"])],
      [edge("a", "x")],
      ["x"],
    );

    expect(overview.links).toEqual([
      { source: UNGROUPED_CLUSTER_ID, target: 0, links: 1 },
    ]);
  });

  it("orders edges strongest first so a cap drops the weakest", () => {
    const overview = buildClusterOverview(
      [
        cluster(0, "a", ["a1"]),
        cluster(1, "b", ["b1"]),
        cluster(2, "c", ["c1"]),
      ],
      [edge("a1", "b1"), edge("a1", "c1"), edge("a1", "c1")],
      [],
    );

    expect(overview.links.map((l) => [l.source, l.target, l.links])).toEqual([
      [0, 2, 2],
      [0, 1, 1],
    ]);
  });

  it("keeps the strongest links when the cap bites, and none at zero", () => {
    const clusters = [
      cluster(0, "a", ["a1"]),
      cluster(1, "b", ["b1"]),
      cluster(2, "c", ["c1"]),
    ];
    const edges = [
      edge("a1", "b1"),
      edge("a1", "c1"),
      edge("a1", "c1"),
      edge("b1", "c1"),
    ];

    const capped = buildClusterOverview(clusters, edges, [], 1);
    expect(capped.links).toEqual([{ source: 0, target: 2, links: 2 }]);

    expect(buildClusterOverview(clusters, edges, [], 0).links).toEqual([]);
  });

  it("defaults the cap to the shared constant", () => {
    expect(CLUSTER_LINK_CAP).toBeGreaterThan(0);
    expect(buildClusterOverview([], [], []).links).toEqual([]);
  });
});
