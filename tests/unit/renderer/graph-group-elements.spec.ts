/**
 * The contract between the group bubbles and the code that reacts to them.
 *
 * `GraphCanvas` reads three things off a bubble: the `group` class, which is how
 * a tap knows it hit a group rather than a repo; `clusterId`, which is what the
 * tap hands the route; and `label`, `members` and `strays`, which the hover
 * tooltip reports. None of that is checkable by rendering, because cytoscape
 * paints into a canvas no test can see into — the elements are the interface.
 *
 * The ids matter too. Group bubbles and repo nodes share one cytoscape
 * instance, swapping between them as the map opens and closes, so a group key
 * that could collide with a repo slug would let a stale element answer a lookup
 * meant for the other level.
 */

import { describe, expect, it } from "vitest";

import type { GraphCluster, GraphEdge } from "@shared/types";

import { buildGroupElements, type Palette } from "@renderer/components/graph/graph-canvas";
import { buildClusterOverview } from "@renderer/lib/graph-clusters";

const PALETTE: Palette = {
  foreground: "rgb(230,230,230)",
  muted: "rgb(130,130,130)",
  border: "rgb(70,70,70)",
  borderStrong: "rgb(105,105,105)",
  accent: "rgb(120,220,170)",
  warning: "rgb(230,190,90)",
  background: "rgb(12,16,20)",
};

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

const CLUSTERS = [cluster(0, "hub", ["a", "b", "c"], ["c"]), cluster(1, "pair", ["d", "e"])];
const EDGES: GraphEdge[] = [
  { source: "a", target: "d", weight: 1, signals: ["owner"], why: [] },
  { source: "a", target: "e", weight: 1, signals: ["owner"], why: [] },
];

function elements(ungrouped: string[] = ["loose-1"]): ReturnType<typeof buildGroupElements> {
  return buildGroupElements(
    buildClusterOverview(CLUSTERS, EDGES, ungrouped),
    PALETTE,
  );
}

function nodes(list: ReturnType<typeof buildGroupElements>) {
  return list.filter((element) => element.group === "nodes");
}

function edges(list: ReturnType<typeof buildGroupElements>) {
  return list.filter((element) => element.group === "edges");
}

describe("group bubble elements", () => {
  it("classes every bubble as a group, which is how a tap finds it", () => {
    for (const node of nodes(elements())) {
      expect(node.classes).toBe("group");
    }
  });

  it("carries the cluster id a tap hands back to the route", () => {
    const ids = nodes(elements()).map((node) => node.data?.clusterId);
    expect(ids).toEqual([0, 1, -1]);
    for (const id of ids) expect(Number.isFinite(id)).toBe(true);
  });

  it("carries the label and counts the hover tooltip reports", () => {
    const [first] = nodes(elements());
    expect(first.data?.label).toBe("hub");
    expect(first.data?.members).toBe(3);
    expect(first.data?.strays).toBe(1);
  });

  it("keeps group keys from colliding with repo slugs", () => {
    for (const node of nodes(elements())) {
      // Repo slugs are lowercased names; a `g`-prefixed key cannot be one.
      expect(String(node.data?.id)).toMatch(/^g-?\d+$/);
    }
  });

  it("sizes a bubble by its member count", () => {
    const list = nodes(elements());
    const hub = Number(list.find((n) => n.data?.clusterId === 0)?.data?.size);
    const pair = Number(list.find((n) => n.data?.clusterId === 1)?.data?.size);
    expect(hub).toBeGreaterThan(pair);
  });

  it("paints the leftovers bucket neutrally rather than as a family", () => {
    const loose = nodes(elements()).find((n) => n.data?.clusterId === -1);
    expect(loose?.data?.colour).toBe(PALETTE.muted);
  });

  it("leaves the leftovers bucket out when nothing is left over", () => {
    expect(nodes(elements([])).map((n) => n.data?.clusterId)).toEqual([0, 1]);
  });

  it("aggregates the links between groups into one edge carrying the count", () => {
    const list = edges(elements());
    expect(list).toHaveLength(1);
    expect(list[0].data?.links).toBe(2);
    expect(list[0].classes).toBe("group");
  });

  it("gives every edge an id unique within the map", () => {
    const ids = edges(elements()).map((edge) => edge.data?.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
