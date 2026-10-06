/**
 * Force-directed layout.
 *
 * Hand-rolled rather than pulled from d3-force: the whole simulation is
 * three forces and about eighty lines, and the app already ships two
 * megabytes of renderer bundle. It also lets the layout know about
 * clusters, which is the thing that makes this graph readable — generic
 * force layout on 263 nodes produces a hairball no matter how long it
 * runs.
 *
 * PURE module: no DOM, no React. The canvas just draws whatever
 * positions this produces.
 */

export interface LayoutNode {
  slug: string;
  cluster: number;
  /** Node radius, derived from degree — bigger hubs push harder. */
  radius: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pinned by dragging; the simulation stops moving it. */
  fixed?: boolean;
}

export interface LayoutEdge {
  source: string;
  target: string;
  weight: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
}

/**
 * Deterministic pseudo-random in [0,1).
 *
 * Seeded from the slug so a repo starts in the same place every time the
 * view opens. `Math.random` would reshuffle the map on every visit and
 * destroy any spatial memory you'd built up.
 */
function seeded(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Fixed home position for each cluster.
 *
 * Computed once and reused as the gravity target. Pulling members toward
 * their cluster's *centre of mass* instead — the obvious approach — lets
 * every centroid drift to the middle of the canvas, because the only
 * thing separating them is repulsion. The result was one dense ball with
 * overlapping labels. A fixed anchor per cluster keeps the groups apart,
 * which is the entire readability of the view.
 *
 * Clusters are laid out on a spiral rather than a circle so a machine
 * with thirty clusters doesn't push them all to the rim.
 */
export function clusterAnchors(
  nodes: LayoutNode[],
  options: LayoutOptions,
): Map<number, { x: number; y: number }> {
  const clusters = [...new Set(nodes.map((n) => n.cluster))].sort(
    (a, b) => a - b,
  );
  const sizes = new Map<number, number>();
  for (const node of nodes) {
    sizes.set(node.cluster, (sizes.get(node.cluster) ?? 0) + 1);
  }

  const anchors = new Map<number, { x: number; y: number }>();
  const cx = options.width / 2;
  const cy = options.height / 2;
  const maxRadius = Math.min(options.width, options.height) * 0.46;

  clusters.forEach((cluster, index) => {
    if (clusters.length === 1) {
      anchors.set(cluster, { x: cx, y: cy });
      return;
    }
    // Golden-angle spiral: even coverage, no rings, deterministic.
    const t = index / (clusters.length - 1 || 1);
    const angle = index * 2.399963;
    const radius = maxRadius * Math.sqrt(t) * 1.05;
    anchors.set(cluster, {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  });
  return anchors;
}

/** Place nodes in a ring per cluster, so the simulation starts sorted. */
export function seedPositions(
  nodes: LayoutNode[],
  options: LayoutOptions,
): void {
  const centres = clusterAnchors(nodes, options);

  for (const node of nodes) {
    const centre = centres.get(node.cluster) ?? {
      x: options.width / 2,
      y: options.height / 2,
    };
    const angle = seeded(node.slug) * Math.PI * 2;
    const radius = 20 + seeded(`${node.slug}r`) * 90;
    node.x = centre.x + Math.cos(angle) * radius;
    node.y = centre.y + Math.sin(angle) * radius;
    node.vx = 0;
    node.vy = 0;
  }
}

/**
 * Advance the simulation one step.
 *
 * Three forces, in the order they matter:
 *
 *  1. **Repulsion** between every pair, so labels don't stack. This is
 *     the O(n²) part; at a few hundred nodes that's ~35k operations a
 *     frame, which is nothing, so it isn't worth a quadtree.
 *  2. **Springs** along edges, pulling related repos together with a
 *     rest length that shortens as the relationship strengthens.
 *  3. **Cluster gravity**, pulling members toward their group's centre
 *     of mass. Without it, weakly-linked members drift into other
 *     clusters and the picture stops meaning anything.
 *
 * `alpha` decays outside this function; passing it in keeps the step
 * pure and lets the caller stop when motion is negligible.
 */
export function step(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions,
  alpha: number,
  anchors?: Map<number, { x: number; y: number }>,
): void {
  const byId = new Map(nodes.map((n) => [n.slug, n]));

  // 1. Repulsion.
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distSq = dx * dx + dy * dy;
      if (distSq === 0) {
        // Exactly coincident nodes have no direction to separate along;
        // nudge them deterministically rather than dividing by zero.
        dx = (seeded(a.slug) - 0.5) * 0.01;
        dy = (seeded(b.slug) - 0.5) * 0.01;
        distSq = dx * dx + dy * dy || 1e-6;
      }
      const dist = Math.sqrt(distSq);
      const minGap = a.radius + b.radius + 14;
      // Stronger, shorter-range push when nodes actually overlap. The
      // ambient term is generous because labels need room, not just the
      // circles.
      const force = (dist < minGap ? 2600 : 620) / distSq;
      const fx = (dx / dist) * force * alpha;
      const fy = (dy / dist) * force * alpha;
      if (!a.fixed) {
        a.vx -= fx;
        a.vy -= fy;
      }
      if (!b.fixed) {
        b.vx += fx;
        b.vy += fy;
      }
    }
  }

  // 2. Springs.
  for (const edge of edges) {
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    // Strong relationships sit closer, but never on top of each other.
    const rest = Math.max(52, 150 - edge.weight * 24);
    const strength = Math.min(0.12, 0.02 + edge.weight * 0.02);
    const force = (dist - rest) * strength * alpha;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    if (!a.fixed) {
      a.vx += fx;
      a.vy += fy;
    }
    if (!b.fixed) {
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  // 3. Cluster gravity toward a FIXED anchor (see `clusterAnchors`).
  const centres = anchors ?? clusterAnchors(nodes, options);
  for (const node of nodes) {
    if (node.fixed) continue;
    const centre = centres.get(node.cluster);
    if (!centre) continue;
    node.vx += (centre.x - node.x) * 0.03 * alpha;
    node.vy += (centre.y - node.y) * 0.03 * alpha;
  }

  // Integrate with heavy damping — this should settle, not oscillate.
  for (const node of nodes) {
    if (node.fixed) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.vx *= 0.82;
    node.vy *= 0.82;
    // Clamp so a stray large force can't fling a node off-screen.
    node.vx = Math.max(-30, Math.min(30, node.vx));
    node.vy = Math.max(-30, Math.min(30, node.vy));
    node.x += node.vx;
    node.y += node.vy;
  }
}

/** Bounding box of the laid-out graph, for fit-to-view. */
export function bounds(nodes: LayoutNode[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.radius);
    minY = Math.min(minY, node.y - node.radius);
    maxX = Math.max(maxX, node.x + node.radius);
    maxY = Math.max(maxY, node.y + node.radius);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}
