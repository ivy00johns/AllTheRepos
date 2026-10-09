/**
 * Cluster-level overview of the relationship map.
 *
 * The `/graph` map opens at group level rather than repo level: one bubble
 * per cluster, with the repo-to-repo links between groups collapsed into a
 * single weighted edge. 271 dots at once is a picture you can only look at;
 * thirty-odd groups is one you can navigate, and each group is then a place
 * you can open.
 *
 * Kept free of React and cytoscape so it can be unit-tested directly — the
 * same reason `graph-signals.ts` sits beside it.
 */

import type { GraphCluster, GraphEdge } from "@shared/types";

/**
 * Cluster id for repos that belong to no group of two or more.
 *
 * `GraphClusterSchema` pins real ids to non-negative integers, so a negative
 * one can mean "everything left over" without ever colliding with a real
 * cluster. It travels through the same selection state as a real id, which is
 * what lets the route open the leftovers with no special case.
 */
export const UNGROUPED_CLUSTER_ID = -1;

/** One bubble on the overview. */
export interface ClusterGroup {
  id: number;
  label: string;
  /** Repos in the group. */
  size: number;
  /** Members living outside the group's dominant folder. */
  strays: number;
}

/** One aggregated link between two bubbles. */
export interface ClusterLink {
  source: number;
  target: number;
  /** Underlying repo-to-repo links the two groups share. */
  links: number;
}

export interface ClusterOverview {
  groups: ClusterGroup[];
  links: ClusterLink[];
}

/**
 * Strongest-N links kept at group level.
 *
 * Collapsing already removes most of the hairball — 1915 repo links become
 * tens of group links — but a catalog where every group shares a library
 * with every other group can still produce a dense clique, and the weakest
 * of those say nothing.
 */
export const CLUSTER_LINK_CAP = 160;

/**
 * Collapse a repo graph into groups and the links between them.
 *
 * `edges` should be the full signal-filtered set, not the strongest-N cap the
 * repo view draws: the cap is what makes the flat map unreadable, and the
 * aggregation is exactly what makes it unnecessary.
 */
export function buildClusterOverview(
  clusters: readonly GraphCluster[],
  edges: readonly GraphEdge[],
  ungroupedSlugs: readonly string[],
  cap: number = CLUSTER_LINK_CAP,
): ClusterOverview {
  const groupOf = new Map<string, number>();
  for (const cluster of clusters) {
    for (const slug of cluster.slugs) groupOf.set(slug, cluster.id);
  }
  for (const slug of ungroupedSlugs) groupOf.set(slug, UNGROUPED_CLUSTER_ID);

  const groups: ClusterGroup[] = clusters.map((cluster) => ({
    id: cluster.id,
    label: cluster.label,
    size: cluster.size,
    strays: cluster.strays.length,
  }));
  if (ungroupedSlugs.length > 0) {
    groups.push({
      id: UNGROUPED_CLUSTER_ID,
      label: "Ungrouped",
      size: ungroupedSlugs.length,
      strays: 0,
    });
  }

  const links = new Map<string, ClusterLink>();
  for (const edge of edges) {
    const source = groupOf.get(edge.source);
    const target = groupOf.get(edge.target);
    // A link with an endpoint in no group cannot be drawn on a group-level
    // map, and a link inside one group is that group's interior rather than
    // a relationship between two of them.
    if (source === undefined || target === undefined) continue;
    if (source === target) continue;
    // Undirected pair key, order-independent — the same convention the
    // service uses, so a link is counted once however it was discovered.
    const key = source < target ? `${source}|${target}` : `${target}|${source}`;
    const existing = links.get(key);
    if (existing) {
      existing.links += 1;
      continue;
    }
    links.set(key, {
      source: Math.min(source, target),
      target: Math.max(source, target),
      links: 1,
    });
  }

  return {
    groups,
    links: [...links.values()]
      // Strongest first, then by id, so the same catalog always draws the
      // same map and the cap always drops the least meaningful links.
      .sort(
        (a, b) => b.links - a.links || a.source - b.source || a.target - b.target,
      )
      .slice(0, cap),
  };
}
