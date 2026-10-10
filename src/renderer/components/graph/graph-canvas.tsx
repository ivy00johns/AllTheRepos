/**
 * The relationship map.
 *
 * ## Why Cytoscape and not the hand-rolled simulation
 *
 * The previous renderer was a bespoke force simulation on a 2D canvas.
 * It worked, in the sense that it produced pixels — but on the real
 * catalog (263 repos, ~860 links, 38 clusters) it drew a uniform blob:
 * every node the same distance from every other, labels stacked on top
 * of each other, no visible structure. The clustering data was never the
 * problem; the layout was.
 *
 * Cytoscape's **fcose** layout is a spectral + force hybrid built for
 * exactly this shape of graph. Two things it gives us that a naive
 * spring solver cannot:
 *
 * 1. `packComponents` — disconnected sub-graphs are laid out separately
 *    and then *tiled*, so the 38 clusters cannot overlap into one mass.
 * 2. Per-edge `idealEdgeLength` / `edgeElasticity`. This is the lever
 *    that actually separates the clusters: an edge *inside* a cluster is
 *    given a short, stiff spring, and an edge *between* clusters a long,
 *    slack one. Intra-cluster structure therefore contracts while
 *    inter-cluster structure stretches, and the families pull apart on
 *    their own instead of being forced apart by brute repulsion.
 *
 * ## Encoding
 *
 * | Channel     | Meaning                                        |
 * | ----------- | ---------------------------------------------- |
 * | fill colour | cluster                                         |
 * | size        | degree (cube-rooted, so hubs read without dwarfing) |
 * | star shape  | favourite                                      |
 * | warning ring| a highlighted "stray" (member of a scattered cluster) |
 * | outline     | current selection                              |
 * | accent arrow| a curated link — a *human assertion*, which outranks everything derived |
 *
 * Colour encodes CLUSTER, not folder — that's the whole point. When a
 * cluster's colour appears in four different places as you scan, that's
 * the disorganisation the view exists to reveal.
 *
 * The old `./force-layout` module is left on disk, unused.
 */

import * as React from "react";
import cytoscape from "cytoscape";
// cytoscape-fcose ships no type declarations and has no @types package.
// The default export is a cytoscape extension registrar.
// @ts-expect-error -- untyped extension, see above
import fcose from "cytoscape-fcose";
import { Maximize, Workflow, ZoomIn, ZoomOut } from "lucide-react";

import type { GraphCluster, GraphEdge, GraphNode } from "@shared/types";

import { Button } from "@renderer/components/ui/button";
import {
  buildClusterOverview,
  type ClusterGroup,
  type ClusterOverview,
} from "@renderer/lib/graph-clusters";
import { tildify } from "@renderer/lib/repo-tree";

/**
 * The cluster-level map, shown instead of the repos until a group is opened.
 *
 * Passing this is what puts the canvas at group level; `null` is repo level.
 * `edges` is deliberately the *uncapped* signal-filtered set: the strongest-N
 * cap exists to stop the flat map collapsing into a hairball, and aggregating
 * to groups is what makes the cap unnecessary.
 */
export interface GraphOverview {
  clusters: GraphCluster[];
  edges: GraphEdge[];
  /** Repos in no group of two or more. */
  ungroupedSlugs: string[];
  onSelectCluster: (clusterId: number) => void;
}

interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedSlug: string | null;
  highlightSlugs: ReadonlySet<string>;
  onSelect: (slug: string | null) => void;
  onOpen: (slug: string) => void;
  /** Group-level map. While set, `nodes` and `edges` above are not drawn. */
  overview?: GraphOverview | null;
}

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

/**
 * Cytoscape draws to a canvas, so it cannot resolve `var(--color-…)` —
 * it needs concrete colour values. Rather than duplicating the palette
 * as literals (which would silently drift from `globals.css`, and would
 * ignore the user-overridable `--accent`), we let the browser resolve
 * the tokens for us: set a probe element's `color` to the var and read
 * back the computed `rgb(…)`.
 *
 * If a token is missing the declaration is invalid and `color` falls
 * back to the inherited foreground — degraded, but never a broken paint.
 */
const TOKENS = {
  foreground: "--color-foreground",
  muted: "--color-muted-foreground",
  border: "--color-border",
  borderStrong: "--color-border-strong",
  accent: "--color-accent",
  warning: "--color-warning",
  background: "--color-background",
} as const;

export type Palette = Record<keyof typeof TOKENS, string>;

function readPalette(host: HTMLElement): Palette {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.width = "0";
  probe.style.height = "0";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  host.appendChild(probe);

  const inherited = window.getComputedStyle(probe).color;
  const read = (token: string): string => {
    probe.style.color = inherited;
    probe.style.color = `var(${token})`;
    return window.getComputedStyle(probe).color || inherited;
  };

  const palette = Object.fromEntries(
    Object.entries(TOKENS).map(([key, token]) => [key, read(token)]),
  ) as Palette;

  host.removeChild(probe);
  return palette;
}

/**
 * Cluster colours are *generated*, not listed.
 *
 * There are 38 clusters on the real catalog and no design token for
 * "cluster 27", so a hand-written palette would either run out or turn
 * into a wall of hex literals. Instead hues are walked with the golden
 * ratio (consecutive cluster ids land far apart on the wheel) inside a
 * band that deliberately excludes the app's status hues: green (accent /
 * "clean"), amber (`--color-warning`) and red (`--color-destructive`).
 * A node's colour can therefore never be misread as a status.
 */
const CLUSTER_HUE_START = 168; // cyan
const CLUSTER_HUE_SPAN = 170; // …through blue and violet to magenta
const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;

function clusterColour(cluster: number): string {
  const offset = (cluster * GOLDEN_RATIO_CONJUGATE) % 1;
  const hue = Math.round(CLUSTER_HUE_START + offset * CLUSTER_HUE_SPAN);
  // Alternating lightness keeps hue-adjacent clusters apart even when
  // the wheel wraps back around near an already-used hue.
  const lightness = cluster % 2 === 0 ? 66 : 52;
  return `hsl(${hue}, 62%, ${lightness}%)`;
}

// ---------------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------------

/** Edge weights run from `MIN_EDGE_WEIGHT` (0.25) up to roughly 5. */
const MAX_MEANINGFUL_WEIGHT = 5;

/**
 * Zoom past this and the map starts naming what is on screen.
 *
 * Raised from 1.15, which fired the moment you nudged the wheel and painted
 * every name on a 271-node drawing at once. A name belongs to a node you are
 * looking at, not to a node you happen to be near.
 */
const LABEL_ZOOM = 1.4;

/**
 * Most names drawn at once, chosen by how connected each node is.
 *
 * This number used to be a ceiling on the size of the whole *drawing* instead,
 * which is a different quantity and the wrong one: a 271-repo map drew no
 * names at any zoom — a dot could fill a third of the screen with nothing to
 * read beside it — while a 27-node group drew all of them. What has to be
 * limited is how many names share the *screen*, because that is what collides,
 * so the cap lives on the viewport and the choice within it is by degree: the
 * busiest node in a neighbourhood is the landmark worth naming.
 */
const LABEL_VIEW_CAP = 30;

/**
 * Name the most connected nodes in view, up to `LABEL_VIEW_CAP`.
 *
 * The viewport decides the answer rather than the drawing, so this is re-run on
 * every pan and zoom: panning changes which names are on screen just as
 * zooming does. Below `LABEL_ZOOM` it clears instead — at fit zoom the hubs
 * alone carry names (see `hubCount`), which is what keeps the opening picture
 * readable.
 */
function labelNodesInView(cy: cytoscape.Core): void {
  // Group bubbles label themselves; this rule is only about repos.
  const repos = cy.nodes().not(".group");
  if (cy.zoom() < LABEL_ZOOM) {
    cy.batch(() => repos.removeClass("zoomed"));
    return;
  }
  const extent = cy.extent();
  const degreeOf = (node: cytoscape.SingularElementArgument) =>
    Number((node as cytoscape.NodeSingular).data("degree") ?? 0);
  const chosen = repos
    .filter((node) => {
      const at = (node as cytoscape.NodeSingular).position();
      return (
        at.x >= extent.x1 &&
        at.x <= extent.x2 &&
        at.y >= extent.y1 &&
        at.y <= extent.y2
      );
    })
    .sort((a, b) => degreeOf(b) - degreeOf(a))
    .slice(0, LABEL_VIEW_CAP);
  cy.batch(() => {
    repos.removeClass("zoomed");
    chosen.addClass("zoomed");
  });
}

/**
 * Give every bubble its own patch of the drawing.
 *
 * The nodes are moved by the same delta their *footprint* needed, because a
 * name hangs off its bubble: separating the bubbles alone is exactly the state
 * the map shipped in, where a bubble sits on the name beside it.
 *
 * Deliberately *not* wrapped in `cy.batch()`. This runs from the layout's own
 * `layoutstop`, where cytoscape has already opened a batch — nesting one on top
 * of it leaves the private batch state null and the callback throws
 * (`Cannot read properties of null (reading 'notify')`), which took the whole
 * route down. Positions are set one at a time instead; thirty-odd of them cost
 * a frame's worth of style recalculation and nothing measurable.
 */
export function groupFootprints(cy: cytoscape.Core): GroupFootprint[] {
  return cy.nodes(".group").map((node) =>
    groupFootprint(
      node.id(),
      node.position(),
      Number(node.data("size")),
      String(node.data("label") ?? ""),
      Number(node.data("labelWidth")),
    ),
  );
}

function separateGroupBubbles(cy: cytoscape.Core): void {
  const groups = cy.nodes(".group");
  if (groups.length < 2) return;
  const footprints = groupFootprints(cy);
  const placed = separateFootprints(footprints);
  const before = new Map(footprints.map((box) => [box.id, box]));
  for (const node of groups) {
    const from = before.get(node.id());
    const to = placed.get(node.id());
    if (!from || !to) continue;
    const at = node.position();
    node.position({
      x: at.x + (to.x - from.x),
      y: at.y + (to.y - from.y),
    });
  }
}

/**
 * How far the drawing's shape may sit from the pane's before it is squashed.
 *
 * A share of the pane's aspect rather than a flat number of units, so the same
 * tolerance means the same thing on any pane.
 */
const ARRANGE_ASPECT_SLACK = 0.02;

/** How many times the squash-and-pack pair is repeated before the map is framed. */
const ARRANGE_SQUASH_PASSES = 3;

/**
 * Shape the settled arrangement to the pane it has to open in, then pack it.
 *
 * The forces do not know the pane's shape, and they cannot: a force layout
 * settles into whatever aspect its own equilibrium has — measured over eight
 * random starts on the real catalog, between 0.7 (tall) and 1.8 (wide) — while
 * the panes the product has are 1.6 and 1.9 wide. A drawing that settles tall
 * can never open fitted in a wide pane at a legible size: framed on its own
 * boxes it fits at 0.54 of the legibility floor's scale, so the clamp magnifies
 * it and the map opens with a pan. That is not a packing problem and no packing
 * closes it, because the drawing is the wrong *shape* for the pane rather than
 * the wrong size.
 *
 * So the boxes are compressed along whichever axis the pane is short of, about
 * the drawing's own centre, and the packing then separates what the compression
 * brought together. Angles from the centre are kept, and so is which group is
 * beside which; only the spacing between them is squashed, and only on one axis.
 * Measured on the real catalog over eight starts, it is the difference between
 * three of eight settling arrangements opening fitted and all eight — the worst
 * starting arrangement goes from a fit of 0.54 to 0.78, against a floor of 0.75.
 *
 * Compression only, never stretching: stretching would pull the arrangement
 * apart and grow a drawing that is already too large for its pane. Which is why
 * the pair of axes is worked out from the *boxes* rather than from the bubbles —
 * a name hangs below its bubble, and it is the name that decides the room the
 * drawing takes, exactly as in the packing pass below.
 *
 * One pass is not enough, and the packing is why. Compressing the arrangement
 * brings boxes together and the packing then pushes them apart again — that is
 * what it is for — and its pushes are not symmetric, because a name hangs below
 * its bubble and the room names need is vertical, so what comes out of one pass
 * is not quite the pane's shape. The second pass measures what the first one
 * produced and corrects it. Measured on the real catalog over twelve random
 * starts and both panes, one pass leaves the worst start at a fit of 0.76 — a
 * per cent above the floor — and two bring it to 0.79 with every start above it.
 * A third is allowed for the start that lands badly and is worth nothing
 * measurable on any of these. The loop stops as soon as the fit clears the floor,
 * once past the first pass, so a map pays for two passes and at most three.
 *
 * Order matters: the shape of the drawing decides how much room it needs, and the
 * fit is what decides the scale of everything inside it — so the map is squashed
 * and packed first, and fitted second.
 */
export function arrangeGroupMap(
  cy: cytoscape.Core,
  width: number,
  height: number,
): void {
  for (let pass = 0; pass < ARRANGE_SQUASH_PASSES; pass += 1) {
    squashGroupArrangement(cy, width, height);
    separateGroupBubbles(cy);
    // Fitted already, and past the first pass: further passes would only trade
    // the arrangement for scale the map does not need.
    if (pass > 0 && opensFitted(cy, width, height)) return;
  }
}

/**
 * Whether the packed drawing would already open at the scale its type needs.
 *
 * The same arithmetic `frameInPane` will run a moment later, asked the one
 * question this loop is about: is the fit at or above the legibility floor, so
 * the clamp has nothing to magnify?
 */
function opensFitted(
  cy: cytoscape.Core,
  width: number,
  height: number,
): boolean {
  const bounds = footprintBounds(groupFootprints(cy));
  if (!bounds) return true;
  const framed = frameInPane(bounds, width, height);
  return !framed || framed.zoom >= GROUP_MIN_FIT_ZOOM;
}

/**
 * The compression itself: the boxes resolved onto the pane's usable shape.
 *
 * Positions move by the delta their *box* needs, the same rule the packing pass
 * follows and for the same reason: a node's own position is its bubble's centre,
 * and the box around it is not centred on the bubble.
 */
function squashGroupArrangement(
  cy: cytoscape.Core,
  width: number,
  height: number,
): void {
  const usableWidth = width - GROUP_FIT_PADDING * 2;
  const usableHeight = height - GROUP_FIT_PADDING * 2;
  if (!(usableWidth > 0) || !(usableHeight > 0)) return;
  const footprints = groupFootprints(cy);
  const bounds = footprintBounds(footprints);
  if (!bounds) return;
  const spanX = bounds.x2 - bounds.x1;
  const spanY = bounds.y2 - bounds.y1;
  if (!(spanX > 0) || !(spanY > 0)) return;

  const paneAspect = usableWidth / usableHeight;
  const drawingAspect = spanX / spanY;
  if (Math.abs(drawingAspect - paneAspect) <= ARRANGE_ASPECT_SLACK * paneAspect) {
    return;
  }
  const alongX = drawingAspect > paneAspect ? paneAspect / drawingAspect : 1;
  const alongY = drawingAspect < paneAspect ? drawingAspect / paneAspect : 1;
  const midX = (bounds.x1 + bounds.x2) / 2;
  const midY = (bounds.y1 + bounds.y2) / 2;
  for (const box of footprints) {
    const node = cy.getElementById(box.id);
    if (node.empty()) continue;
    const at = node.position();
    node.position({
      x: at.x + (midX + (box.x - midX) * alongX - box.x),
      y: at.y + (midY + (box.y - midY) * alongY - box.y),
    });
  }
}

/**
 * Finish a layout: pack it, frame it, name what is on screen — one frame later.
 *
 * The deferral is not tidiness. `layoutstop` fires *inside* a batch cytoscape
 * opened, and every API this work needs opens one of its own — `cy.fit`, and
 * any `cy.batch` written by hand — which lands a second batch on top of the
 * first and leaves cytoscape's private state null, so the next read of it
 * throws and takes the whole route with it (seen as `Cannot read properties of
 * null (reading 'notify')`, and then `... 'isHeadless'` once the first was
 * removed). A frame later there is no batch to nest inside.
 *
 * It is also what keeps the labels honest: a re-layout moves every node under an
 * unchanged zoom and fires no event, so nothing else would tell the label pass
 * to look again.
 */
function settle(cy: cytoscape.Core, groupData: ClusterOverview | null): void {
  window.requestAnimationFrame(() => {
    if (cy.destroyed()) return;
    if (groupData) {
      // Shaped to the pane and packed — the fit below is measured on the boxes
      // that produces. See `arrangeGroupMap` for why the shape matters.
      arrangeGroupMap(cy, cy.width(), cy.height());
      frameGroupMapAtOpening(cy, cy.width(), cy.height(), groupFootprints(cy));
    } else {
      // The layout fitted the drawing; only the fit itself can be unreadable.
      openAt(cy, Math.max(cy.zoom(), REPO_MIN_FIT_ZOOM));
    }
    labelNodesInView(cy);
  });
}

/**
 * Slack on the model's box sizes when framing.
 *
 * A hair, because the model is no longer a guess: `MONO_ADVANCE`,
 * `GROUP_LABEL_BOX_PADDING` and `GROUP_BUBBLE_BORDER` are calibrated against
 * cytoscape's own boxes read out of the running app on the real catalog, and the
 * two agree to within a per cent. It used to be 1.12, which was the honest
 * allowance while the model was an estimate of the glyphs rather than a reading
 * of them — and which cost the fit a tenth of its scale for a bias that is no
 * longer there. What is left covers the last few units of the renderer's own box
 * arithmetic. A map that opens a hair inside the pane beats one that opens on
 * its edge.
 */
const FRAME_SLACK = 1.02;

/** Extent of the packed drawing, in model coordinates. */
export interface FrameBounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Bounds of every footprint in the drawing, or null if there is nothing to draw. */
export function footprintBounds(
  footprints: readonly GroupFootprint[],
): FrameBounds | null {
  if (footprints.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const box of footprints) {
    x1 = Math.min(x1, box.x - box.width / 2);
    x2 = Math.max(x2, box.x + box.width / 2);
    y1 = Math.min(y1, box.y - box.height / 2);
    y2 = Math.max(y2, box.y + box.height / 2);
  }
  return { x1, y1, x2, y2 };
}

/**
 * Where a drawing sits in a pane: the scale, and the pan that centres it.
 *
 * `level` forces the scale — this is the legibility clamp, which magnifies a
 * drawing the pane cannot hold at its own size. The pan is computed from the
 * *boxes* in both cases, and that matters most exactly when `level` is forced:
 * the clamped drawing overflows, so it has to overflow evenly. `cy.center()`
 * cannot do this job — it places cytoscape's cached element bounds, which are
 * the bubbles, and a name hangs below its bubble — measured on the real catalog
 * that opened the map with the topmost bubble trimmed by 13px while the bottom
 * kept 63px of margin.
 */
export function frameInPane(
  bounds: FrameBounds,
  width: number,
  height: number,
  level?: number,
): { zoom: number; pan: { x: number; y: number } } | null {
  if (!(width > 0 && height > 0)) return null;
  const zoom =
    level ??
    Math.min(
      (width - GROUP_FIT_PADDING * 2) / ((bounds.x2 - bounds.x1) * FRAME_SLACK),
      (height - GROUP_FIT_PADDING * 2) / ((bounds.y2 - bounds.y1) * FRAME_SLACK),
    );
  return {
    zoom,
    pan: {
      x: width / 2 - zoom * ((bounds.x1 + bounds.x2) / 2),
      y: height / 2 - zoom * ((bounds.y1 + bounds.y2) / 2),
    },
  };
}

/**
 * Frame the packed drawing at the level the map opens at: the fit its pane
 * allows, clamped to the legibility floor.
 *
 * Not `cy.fit`. That reads cytoscape's cached element bounds, and a name's text
 * is measured lazily, so at this moment the cache still describes bubbles whose
 * names have not been accounted for — measured on the real catalog, fitting
 * through it opened the map about a sixth too large, with the outermost bubbles
 * past the edge of the pane, and waiting a frame did not change that. The
 * packing already knows every box exactly, so the frame is computed from those,
 * and the boxes are the conservative ones, which leaves the drawing inside the
 * pane rather than on its edge.
 *
 * A pane too small for the whole drawing keeps its type and pans, rather than
 * fitting everything and reading nothing — and that level is applied here rather
 * than through `openAt`, whose recentring would drop the labels out of the
 * calculation and trim one edge of the overflow (see `frameInPane`).
 */
function frameGroupMapAtOpening(
  cy: cytoscape.Core,
  width: number,
  height: number,
  footprints: readonly GroupFootprint[],
): void {
  const bounds = footprintBounds(footprints);
  if (!bounds) return;
  const framed = frameInPane(bounds, width, height);
  if (!framed) return;
  const level = groupOpenZoom(framed.zoom);
  const settled =
    Math.abs(level - framed.zoom) < 0.001
      ? framed
      : frameInPane(bounds, width, height, level);
  if (settled) cy.viewport({ zoom: settled.zoom, pan: settled.pan });
}

/**
 * Frame the map for a pane that has just changed size.
 *
 * A pane changes under the map for reasons that have nothing to do with the
 * data: the window is resized, or the relationships sidebar is toggled, and the
 * framing then describes a pane that is no longer there. Measured in the running
 * app before this existed, the map kept a fit computed for a 960-wide pane while
 * the pane was 880 and the drawing sat off-centre in what was left of it.
 *
 * The arrangement is what decides how much room the drawing needs, so it is only
 * touched when the pane has become too small to open it at a readable size: the
 * map re-frames on every change, and rearranges itself only when re-framing
 * alone would leave the clamp magnifying the drawing. Rearranging on every step
 * of a dragged window edge would be a different map on every step.
 *
 * Returns nothing; the pane it frames is the one it is given, so a caller that
 * has just re-read the container's size can hand that size straight to it.
 */
export function refitGroupMap(
  cy: cytoscape.Core,
  width: number,
  height: number,
): void {
  const boxes = groupFootprints(cy);
  const bounds = footprintBounds(boxes);
  if (!bounds) return;
  const framed = frameInPane(bounds, width, height);
  if (framed && framed.zoom >= GROUP_MIN_FIT_ZOOM) {
    // Still opens at the size its names need, in this pane as in the last one.
    frameGroupMapAtOpening(cy, width, height, boxes);
    return;
  }
  arrangeGroupMap(cy, width, height);
  frameGroupMapAtOpening(cy, width, height, groupFootprints(cy));
}

/** One press of the zoom controls scales the view by this factor. */
const ZOOM_STEP = 1.3;

/** Two taps inside this window count as a double-tap ("open"). */
const DOUBLE_TAP_MS = 350;

function clampWeight(weight: number): number {
  return Math.max(0.25, Math.min(MAX_MEANINGFUL_WEIGHT, weight));
}

/** Cube-rooted so a 40-edge hub is prominent without dwarfing the rest. */
function nodeSize(degree: number): number {
  return 9 + Math.cbrt(degree) * 5.2;
}

/**
 * How many nodes keep a permanent label.
 *
 * 263 labels at once is the soup the old renderer produced. The busiest
 * few are the landmarks you navigate by, so those stay lit; everything
 * else earns a label by being hovered, selected, flagged, or zoomed to.
 */
function hubCount(total: number): number {
  return Math.max(3, Math.min(14, Math.round(total * 0.05)));
}

/**
 * Group bubble size: repos in the group, cube-rooted like `nodeSize`.
 *
 * Deliberately far larger than a repo dot. A bubble is a target you aim at
 * rather than a point you scan, and the name that identifies it sits in the
 * space below it, so it needs a floor wide enough that the name reads as
 * belonging to the bubble rather than to the gap beside it.
 */
function groupSize(members: number): number {
  return 24 + Math.cbrt(members) * 10;
}

/** Element id for a group bubble. Real cluster ids are non-negative. */
function groupKey(clusterId: number): string {
  return `g${clusterId}`;
}

/**
 * Advance width of the canvas' monospace stack, in em.
 *
 * JetBrains Mono is 0.6em per glyph. The room a name needs has to be known
 * before cytoscape has drawn it, and measuring text needs a DOM, so this is a
 * model of the type rather than a reading of it. Erring wide makes the spacing
 * generous, which is the safe direction for the failure it prevents.
 */
const MONO_ADVANCE = 0.6;

/**
 * Geometry of the name under a bubble. Mirrors the `node.group` rules in
 * `buildStylesheet` — `text-margin-y` and `text-background-padding` — and is
 * kept beside the model that has to agree with them.
 */
const GROUP_LABEL_GAP = 6;
const GROUP_LABEL_PADDING = 3;

/**
 * The bubble's border, in model units — a ring in the page colour, drawn so two
 * touching bubbles read as two.
 *
 * Part of what the element occupies, so it counts as part of its footprint: left
 * out, the model promised each group two units of clearance per side that the
 * drawn ring was already using, and cytoscape's own boxes came out four units
 * outside the box the packing had cleared. It is invisible — background on
 * background — which is exactly why a model has to count it rather than trust
 * the eye.
 */
const GROUP_BUBBLE_BORDER = 2;

/**
 * Room the name's own box adds around its glyphs, in model units.
 *
 * `text-background-padding` is 3px a side, so 6 units of it are accounted for
 * below — but not all of it. Measured against cytoscape's own boxes in the
 * running app, on the real catalog, the drawn label is 7.16 units per glyph
 * plus 13.4: the extra few units are the round-rectangle background and the
 * font's side bearings, and leaving them out is what made this model claim a
 * bubble had clearance where the drawing had none. Fourteen rather than thirteen
 * because a model that errs narrow errs towards drawing over a name.
 */
const GROUP_LABEL_BOX_PADDING = 14;

/**
 * Where the renderer will break a name, and how wide its widest line comes out.
 *
 * `text-wrap: wrap` at `text-max-width: data(labelWidth)` breaks on *spaces*, not
 * at a character count — so a name with no spaces in it does not wrap at all, it
 * overflows its own maximum, and the box it occupies is wider than the cap. Repo
 * names are full of underscores and hyphens, so on the real catalog that is the
 * common case, not the corner: `Random_Toolbox_Project` is drawn 171 units wide
 * against a 136-unit cap. Modelling the cap as the width is what left up to
 * forty units of a name outside the box the packing had promised was clear.
 *
 * Greedy, one word at a time, which is what a canvas `fillText` loop does.
 */
function wrapLabel(
  label: string,
  maxWidth: number,
  advance: number,
): { lines: number; longest: number } {
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lines: 1, longest: 0 };
  let lines = 1;
  let longest = 0;
  let line = 0;
  for (const word of words) {
    const width = word.length * advance;
    if (line === 0) {
      line = width;
    } else if (line + advance + width <= maxWidth) {
      line += advance + width;
    } else {
      longest = Math.max(longest, line);
      lines += 1;
      line = width;
    }
  }
  return { lines, longest: Math.max(longest, line) };
}

/** Line height of a wrapped group name, as a multiple of its font step. */
const GROUP_LABEL_LINE = 1.25;

/**
 * A rectangle a group actually paints, relative to its footprint's centre.
 *
 * Two of these make a footprint — the bubble and the name under it — and they
 * are what the packing separates. Packing the footprint's *bounding box*
 * instead is what kept the map too large to fit: that box is as wide as the
 * name, so each group claimed a rectangle whose top corners are empty air, and
 * on the real catalog the boxes came to 1.3 times the area of the pane they had
 * to open in. Measured, that box is 45% empty, and the drawing was 8% boxes. So
 * the shapes are packed, and the corners they leave are free for the neighbours
 * whose names are elsewhere.
 */
export interface GroupPart {
  dx: number;
  dy: number;
  width: number;
  height: number;
}

/**
 * The room one group needs: its bubble, plus the name drawn under it.
 *
 * This is the unit the map is packed in. A bubble and its name are one element
 * in cytoscape, painted in one pass, so they also have to be one rigid body —
 * separating the bubbles alone is what let a bubble be drawn over the name
 * beside it, and no amount of styling brings a covered name back.
 */
export interface GroupFootprint {
  id: string;
  /** Centre of the whole box, which is below the bubble's own centre. */
  x: number;
  y: number;
  /** Bounding box, for framing: the union of `parts`. */
  width: number;
  height: number;
  /** What is drawn, for separation: the bubble and the name. */
  parts: readonly GroupPart[];
}

/** Build the footprint for one group from what its element already carries. */
export function groupFootprint(
  id: string,
  position: { x: number; y: number },
  size: number,
  label: string,
  labelWidth: number,
): GroupFootprint {
  const advance = MONO_ADVANCE * CANVAS_TYPE.group;
  const { lines, longest } = wrapLabel(label, labelWidth, advance);
  // The bubble as drawn, border included.
  const bubble = size + GROUP_BUBBLE_BORDER * 2;
  // As wide as the widest line drawn, plus the box the renderer puts around it —
  // which can be wider than the wrap width, because a word longer than the wrap
  // width is not broken up.
  const width = Math.max(bubble, longest + GROUP_LABEL_BOX_PADDING);
  const labelHeight =
    lines * CANVAS_TYPE.group * GROUP_LABEL_LINE + GROUP_LABEL_PADDING * 2;
  const height = bubble + GROUP_LABEL_GAP + labelHeight;
  /*
   * The bubble sits at the top of the box and the name at the bottom, both
   * centred on the box's own axis. The box's centre is half its lower half below
   * the bubble's, and the name's centre is half of the drop plus half its own
   * height below the bubble's — not half a bubble, which is what it says if the
   * box's centre is mistaken for the bubble's, and which put this rectangle
   * three units too high.
   */
  const parts: GroupPart[] = [
    {
      dx: 0,
      dy: -(GROUP_LABEL_GAP + labelHeight) / 2,
      width: bubble,
      height: bubble,
    },
    {
      dx: 0,
      dy: size / 2 + GROUP_LABEL_GAP / 2,
      width,
      height: labelHeight,
    },
  ];
  return {
    id,
    x: position.x,
    y: position.y + (GROUP_LABEL_GAP + labelHeight) / 2,
    width,
    height,
    parts,
  };
}

/**
 * Breathing room left between two packed footprints.
 *
 * Small on purpose. It is charged against every neighbouring pair, and a group
 * has *eight* neighbours around it in a tight arrangement, so at 10 units this
 * one number was most of the height of the drawing — the difference between a
 * map that opens fitted and one that has to be magnified and panned. Six is
 * still visibly separate at the sizes involved, because the name already carries
 * its own padding and background.
 */
const FOOTPRINT_GAP = 4;

/**
 * Place every group so that nothing it draws lands on anything else, and as
 * close to where the layout put it as that allows.
 *
 * The layout cannot do this on its own: fcose spaces *nodes*, and a node here is
 * a bubble whose name hangs outside it, so two bubbles that satisfy the force
 * layout can still have one sitting on the other's name. This is the missing
 * half, run after the layout and before the fit that decides the scale.
 *
 * What is separated is the *shapes*, not their bounding boxes. A group paints a
 * bubble with a wider name under it, so its box has two empty corners; packing
 * the boxes charged every group for those corners, and on the real catalog the
 * boxes came to 1.3 times the area of the pane they had to open in. Placing the
 * shapes lets a group come to rest in its neighbour's corner — and since the
 * fit is what decides how large the drawing opens, that is most of the
 * difference between a map that opens fitted and one that opens magnified with
 * a pan.
 *
 * ## Why placement and not a relaxation
 *
 * Two relaxation schemes were tried here first, and both fail in the same way:
 * they have no measure that only improves. Pushing both boxes half of every
 * overlap can rock between two arrangements for ever, and moving each box to the
 * nearest escape from what it is overlapping can cycle — box A steps clear, box
 * B steps onto A, box A steps clear of B, and round again. Both shipped a drawing
 * with up to fifty overlapping name pairs after their pass budgets ran out,
 * because a loop that never settles looks exactly like a loop that has.
 *
 * Placement cannot do that. Boxes are placed one at a time, from the middle of
 * the drawing outward, and a placed box is never moved again; each one goes to
 * the nearest position that is clear of everything already placed, which always
 * exists, further out. When the last box is placed the drawing is disjoint by
 * construction — not by convergence — and the boxes the layout put in the middle
 * are still where the forces left them.
 *
 * Returns the new centres, keyed by id, and leaves the input untouched.
 */
export function separateFootprints(
  footprints: readonly GroupFootprint[],
): Map<string, { x: number; y: number }> {
  const boxes = footprints.map((footprint) => ({ ...footprint }));
  if (boxes.length < 2) return centresOf(boxes);

  let centreX = 0;
  let centreY = 0;
  for (const box of boxes) {
    centreX += box.x;
    centreY += box.y;
  }
  centreX /= boxes.length;
  centreY /= boxes.length;

  // Middle outward: the drawing's core keeps the layout's own arrangement, and
  // the fringe — where the free space is — takes the displacements.
  const order = [...boxes].sort((a, b) => {
    const da = Math.hypot(a.x - centreX, a.y - centreY);
    const db = Math.hypot(b.x - centreX, b.y - centreY);
    return da - db || (a.id < b.id ? -1 : 1);
  });

  const placed: GroupFootprint[] = [];
  for (const box of order) {
    const spot = nearestClearSpot(placed, box);
    box.x = spot.x;
    box.y = spot.y;
    placed.push(box);
  }
  return centresOf(boxes);
}

/** Map centres by id, for handing positions back to the caller. */
function centresOf(
  boxes: readonly GroupFootprint[],
): Map<string, { x: number; y: number }> {
  return new Map(boxes.map((box) => [box.id, { x: box.x, y: box.y }]));
}

/** How far out the search for a clear position steps, in model units. */
const PLACE_STEP = 6;

/** Directions tried at each distance — a dozen, so no ring reads as a grid. */
const PLACE_DIRECTIONS = 12;

/**
 * The nearest position to where the layout put `box` that clears everything
 * already placed.
 *
 * Rings outward from the box's own position, and within a ring in a fixed order,
 * so the answer is the smallest displacement the search can express and the same
 * catalog always produces the same drawing. There is no failure case: past the
 * arrangement's own extent every position is clear, so the search ends.
 */
function nearestClearSpot(
  placed: readonly GroupFootprint[],
  box: GroupFootprint,
): { x: number; y: number } {
  if (clearAt(placed, box, box.x, box.y)) return { x: box.x, y: box.y };
  for (let radius = PLACE_STEP; ; radius += PLACE_STEP) {
    for (let step = 0; step < PLACE_DIRECTIONS; step += 1) {
      // Offset by half a division so the first ring is not axis-aligned with the
      // one after it, which is what makes a spiral look like a lattice.
      const angle = ((step + 0.5) / PLACE_DIRECTIONS) * Math.PI * 2;
      const x = box.x + Math.cos(angle) * radius;
      const y = box.y + Math.sin(angle) * radius;
      if (clearAt(placed, box, x, y)) return { x, y };
    }
  }
}

/**
 * Whether every rectangle `box` paints is clear of everything in `placed` at
 * (x, y), with `FOOTPRINT_GAP` of air between them.
 *
 * Rectangle against rectangle, on both axes: the bubble on the bubble, the
 * bubble on the name, the name on the name. Two groups may therefore be side by
 * side with their bubbles nearly touching while their names sweep past each
 * other, as long as nothing is drawn over anything — which is the arrangement a
 * bounding box cannot express and the reason the map was too big to fit.
 */
function clearAt(
  placed: readonly GroupFootprint[],
  box: GroupFootprint,
  x: number,
  y: number,
): boolean {
  for (const other of placed) {
    for (const pa of box.parts) {
      for (const pb of other.parts) {
        const dx =
          (pa.width + pb.width) / 2 +
          FOOTPRINT_GAP -
          Math.abs(x + pa.dx - (other.x + pb.dx));
        const dy =
          (pa.height + pb.height) / 2 +
          FOOTPRINT_GAP -
          Math.abs(y + pa.dy - (other.y + pb.dy));
        if (dx > 0 && dy > 0) return false;
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Extension registration
// ---------------------------------------------------------------------------

let fcoseRegistered = false;
function ensureFcose(): void {
  if (fcoseRegistered) return;
  fcoseRegistered = true;
  cytoscape.use(fcose);
}

/**
 * fcose options, tuned for "make the clusters visible".
 *
 * The two that do the real work are `idealEdgeLength` and
 * `edgeElasticity`, both keyed on whether an edge crosses a cluster
 * boundary. Everything else is support: `packComponents` stops the
 * disconnected pieces overlapping, `nodeSeparation` and `nodeRepulsion`
 * open up the interior of each cluster so labels have somewhere to go,
 * and the low `gravity` with a wide `gravityRange` stops the whole
 * drawing being sucked back into one central ball.
 */
function fcoseOptions(
  fixed: Array<{ nodeId: string; position: { x: number; y: number } }>,
): Record<string, unknown> {
  const crossesCluster = (edge: cytoscape.EdgeSingular): boolean =>
    edge.source().data("cluster") !== edge.target().data("cluster");

  return {
    name: "fcose",
    // "proof" runs the full spectral pass instead of sampling. At this
    // size it costs well under a second and is the difference between
    // "clusters" and "smudges".
    quality: "proof",
    randomize: true,
    animate: false,
    fit: true,
    padding: 60,
    nodeDimensionsIncludeLabels: false,
    uniformNodeDimensions: false,
    // Lay disconnected components out separately and tile them, so they
    // can never overlap into one mass.
    packComponents: true,
    step: "all",
    // Pinned nodes (dragged by the user) hold their position.
    ...(fixed.length > 0 ? { fixedNodeConstraint: fixed } : {}),

    // --- the levers that actually separate the clusters ---------------
    // These numbers are not guesses: they were swept against a synthetic
    // graph matching the measured catalog (263 nodes / 860 edges / 38
    // clusters), scoring the fraction of cluster bounding boxes that
    // overlap. fcose's own defaults overlap 67% of cluster pairs; these
    // values bring it to ~1%.
    idealEdgeLength: (edge: cytoscape.EdgeSingular) => {
      const weight = clampWeight(Number(edge.data("weight")) || 1);
      // Stronger link ⇒ shorter spring ⇒ drawn closer together.
      const strength = 1 / (0.55 + (weight / MAX_MEANINGFUL_WEIGHT) * 0.9);
      return (crossesCluster(edge) ? 420 : 30) * strength;
    },
    edgeElasticity: (edge: cytoscape.EdgeSingular) =>
      // Slack springs between clusters: an incidental shared library
      // should not be able to drag two families into each other.
      crossesCluster(edge) ? 0.03 : 0.7,

    // --- interior breathing room --------------------------------------
    nodeRepulsion: () => 9000, // default 4500
    nodeSeparation: 140, // default 75
    numIter: 3500,
    tile: true,
    tilingPaddingVertical: 24,
    tilingPaddingHorizontal: 24,

    // --- keep it from collapsing back to a ball -------------------------
    gravity: 0.12, // default 0.25
    gravityRange: 5, // default 3.8 — pull starts later, so more spread
    gravityCompound: 1,
    gravityRangeCompound: 1.5,
    initialEnergyOnIncremental: 0.3,
  };
}

/**
 * fcose options for the cluster-level map.
 *
 * The repo layout's job is to prise thirty-eight families apart inside a graph
 * that wants to collapse. This one's job is the opposite: thirty-odd bubbles
 * that must fit one frame at a zoom a name is still legible at. So the edges
 * are short — there is no interior structure to open up — the repulsion is
 * high, because a label sits outside its bubble and both need elbow room, and
 * the gravity is stronger, because a drawing that only fits at 0.4 is a
 * drawing nobody reads.
 *
 * What the forces do not decide is the drawing's *shape*: a force equilibrium
 * comes out however it comes out, tall for some starts and wide for others,
 * while a pane is one shape. So the arrangement is squashed to the pane's own
 * aspect after the layout and before the fit — see `arrangeGroupMap`.
 */
/**
 * Padding the group map is framed with — by the layout, and by the re-fit that
 * follows the packing pass.
 *
 * The margin the drawing keeps from the pane's edge. It is a margin, and it is
 * as expensive as the map makes any other kind of room: at 50 it took 100px off
 * each axis of a 960x594 pane — 18% of the height the fit had to work with —
 * for nothing a reader would miss, and at 20 it still took 7% of the tight
 * pane's height, which the fit needs more than the drawing does. 12 keeps the
 * outermost name clear of the pane's edge and puts the rest back into scale.
 */
const GROUP_FIT_PADDING = 12;

export function groupLayoutOptions(): Record<string, unknown> {
  return {
    name: "fcose",
    quality: "proof",
    randomize: true,
    animate: false,
    fit: true,
    padding: GROUP_FIT_PADDING,
    nodeDimensionsIncludeLabels: false,
    // Isolated groups are tiled rather than left to overlap, as at repo level.
    packComponents: true,
    step: "all",
    idealEdgeLength: (edge: cytoscape.EdgeSingular) => {
      const links = Math.min(Number(edge.data("links")) || 1, 12);
      // Better-connected groups sit nearer each other, as in the repo view.
      return Math.max(80, 170 - links * 7);
    },
    edgeElasticity: () => 0.2,
    nodeRepulsion: () => 14000,
    nodeSeparation: 120,
    numIter: 2500,
    tile: true,
    tilingPaddingVertical: 24,
    tilingPaddingHorizontal: 24,
    gravity: 0.32,
    gravityRange: 4,
    gravityCompound: 1,
    gravityRangeCompound: 1.5,
  };
}

// ---------------------------------------------------------------------------
// Stylesheet
// ---------------------------------------------------------------------------

const MONO_STACK = "JetBrains Mono, ui-monospace, SFMono-Regular, monospace";

/**
 * The map's type steps — the canvas-half of the type scale.
 *
 * Labels on this screen are painted into a canvas by cytoscape, which takes a
 * number and knows nothing about classes, so the CSS tiers cannot reach them.
 * They are named here for the same reason the tiers exist: a size that a reader
 * has to see should be a decision with a name rather than a number inside a
 * style object, and this is the only place in the renderer where a font size
 * may be stated as a number — `tests/unit/renderer/type-scale.spec.ts` fails on
 * a bare numeric one in a component, and on a raw class-list size anywhere.
 *
 * These steps are smaller than the CSS tiers on purpose — canvas type scales
 * with zoom, so at the default framing it is texture rather than reading. The
 * one exception is the group step, which explains itself below.
 *
 * The `min` pair is cytoscape's own density answer, the rendered size below
 * which a label is dropped entirely rather than smeared. It is now also what
 * the map's opening zoom is clamped to: a map that opens below its own drop
 * size opens with no names on it at all, which is the failure this screen was
 * rebuilt to fix.
 */
/**
 * Exported for `tests/unit/renderer/graph-map-framing.spec.ts`, which measures
 * the cluster-level layout headlessly and fails if the default framing drops
 * group names below `groupMin`.
 */
export const CANVAS_TYPE = {
  /** Node names, and the size below which they are dropped. */
  node: 10,
  nodeMin: 7,
  /** Edge labels, one step down: they annotate a link, not a repo. */
  edge: 9,
  edgeMin: 8,
  /** The selected node, which is read rather than scanned. */
  focus: 12,
  /**
   * Group names on the cluster-level map.
   *
   * The one canvas step that is not smaller than the CSS tiers, because at
   * group level a name is the content rather than texture: there are only
   * thirty-odd bubbles, each is identified by nothing else, and the view is
   * framed so they are read rather than scanned. Its floor is the size a
   * name is dropped below, which is a legibility floor here rather than a
   * density one.
   */
  group: 12,
  groupMin: 8,
} as const;

/**
 * The lowest zoom each level may open at.
 *
 * Derived from the canvas step a name is dropped below, so a map cannot open
 * with its names already gone. That sounds like a small thing and is not: the
 * 271-node map fitted a wide drawing into the pane by shrinking until every
 * label sat below its floor, which is why it read as a grey smear rather than
 * a graph. A pane too small for the whole drawing now keeps its type and lets
 * you pan, instead of fitting everything and reading nothing.
 *
 * A step of margin on top of the drop size, because opening exactly at it
 * leaves every name hovering on the value it is dropped at, where a rounding
 * difference decides whether it is drawn at all.
 */
const REPO_MIN_FIT_ZOOM = (CANVAS_TYPE.nodeMin + 1) / CANVAS_TYPE.node;
/**
 * The floor, as a scale rather than as a type size: the level a group name
 * renders at `groupMin + 1`, the step of margin the drop size is given.
 *
 * Exported for `tests/unit/renderer/graph-map-framing.spec.ts`, whose whole
 * subject is that the map opens at the fit its pane allows rather than at this.
 */
export const GROUP_MIN_FIT_ZOOM = (CANVAS_TYPE.groupMin + 1) / CANVAS_TYPE.group;

/**
 * Above this, fitting a small drawing only magnifies it.
 *
 * Six groups in a large pane fit at nearly 2:1, which draws each bubble wider
 * than its own label. Group level is the overview, so it opens at a scale that
 * shows the shape of the catalog rather than a close-up of six things.
 *
 * Exported for `tests/unit/renderer/graph-map-framing.spec.ts`, which asserts
 * both ends of the opening range: the floor is the legibility rule, and this is
 * the "no bubble magnified into a stamp" rule.
 */
export const GROUP_MAX_FIT_ZOOM = 1.4;

/**
 * The zoom the cluster map opens at, from the raw fit its layout produced.
 *
 * Exported for `tests/unit/renderer/graph-map-framing.spec.ts`, which models
 * the framing headlessly and fails if a catalog shape would open unreadable.
 */
export function groupOpenZoom(rawFit: number): number {
  return Math.min(Math.max(rawFit, GROUP_MIN_FIT_ZOOM), GROUP_MAX_FIT_ZOOM);
}

/**
 * Settle the viewport on a level the layout did not choose.
 *
 * `cy.zoom(level)` keeps the current pan, so a drawing magnified from its fit
 * would sit off-centre; centring it is what makes the clamp look deliberate.
 */
function openAt(cy: cytoscape.Core, level: number): void {
  if (Math.abs(level - cy.zoom()) < 0.001) return;
  cy.zoom(level);
  cy.center();
}

/**
 * Later blocks win, so this reads top-to-bottom as a priority list:
 * base → signal → focus → dim. `.dim` is last precisely so a dimmed
 * element can never claw back a label.
 */
export function buildStylesheet(
  p: Palette,
): cytoscape.StylesheetJsonBlock[] {
  return [
    {
      selector: "node",
      style: {
        "background-color": "data(colour)",
        width: "data(size)",
        height: "data(size)",
        "border-width": 0,
        "border-color": p.warning,
        "outline-width": 0,
        "outline-color": p.foreground,
        "outline-offset": 2,
        label: "",
        color: p.foreground,
        "font-family": MONO_STACK,
        "font-size": CANVAS_TYPE.node,
        "text-valign": "bottom",
        "text-halign": "center",
        "text-margin-y": 4,
        "text-background-color": p.background,
        "text-background-opacity": 0.75,
        "text-background-padding": "2px",
        "text-background-shape": "roundrectangle",
        // Cytoscape's own answer to label density: below this rendered
        // size the text is dropped entirely rather than smeared.
        "min-zoomed-font-size": CANVAS_TYPE.nodeMin,
        "text-events": "no",
        "overlay-opacity": 0,
        "z-index": 10,
      },
    },
    // --- group bubbles (the cluster-level map) ---------------------------
    //
    // Only ever drawn at group level. A bubble is a target rather than a
    // point, and it names itself in the space below rather than inside,
    // because a name like "crewAI-examples" does not fit in a 40px box.
    {
      selector: "node.group",
      style: {
        shape: "round-rectangle",
        width: "data(size)",
        height: "data(size)",
        // Always on: at group level the name is the content rather than
        // texture that only appears once you are close enough.
        label: "data(label)",
        "font-size": CANVAS_TYPE.group,
        "min-zoomed-font-size": CANVAS_TYPE.groupMin,
        color: p.foreground,
        "text-valign": "bottom",
        "text-halign": "center",
        "text-margin-y": 6,
        "text-wrap": "wrap",
        "text-max-width": "data(labelWidth)",
        "text-background-color": p.background,
        "text-background-opacity": 0.85,
        "text-background-padding": "3px",
        "text-background-shape": "roundrectangle",
        // A ring in the page colour, so two touching bubbles read as two.
        "border-width": 2,
        "border-color": p.background,
      },
    },
    {
      selector: "edge.group",
      style: { "curve-style": "straight", "line-color": p.muted },
    },

    {
      // Favourites get the app's favourite metaphor, not another colour —
      // colour is already spoken for by cluster.
      selector: "node.favourite",
      style: {
        shape: "star",
        width: "data(favSize)",
        height: "data(favSize)",
        "z-index": 12,
      },
    },
    {
      selector: "edge",
      style: {
        "curve-style": "straight",
        "line-color": p.borderStrong,
        width: "data(width)",
        // `opacity` is typed number-only, so the data mapping is written
        // out longhand rather than as a `data(…)` string.
        opacity: (edge: cytoscape.EdgeSingular) =>
          Number(edge.data("opacity")) || 0.2,
        "target-arrow-shape": "none",
        "source-arrow-shape": "none",
        label: "",
        color: p.muted,
        "font-family": MONO_STACK,
        "font-size": CANVAS_TYPE.edge,
        "text-background-color": p.background,
        "text-background-opacity": 0.8,
        "text-background-padding": "2px",
        "min-zoomed-font-size": CANVAS_TYPE.edgeMin,
        "text-events": "no",
        "overlay-opacity": 0,
        "z-index": 1,
      },
    },
    {
      // Curated links are human assertions. They outrank every derived
      // signal, so they get the accent, real weight, and a direction.
      selector: "edge.curated",
      style: {
        "curve-style": "bezier",
        "control-point-step-size": 30,
        "line-color": p.accent,
        width: "data(curatedWidth)",
        opacity: 0.95,
        "arrow-scale": 0.75,
        "z-index": 30,
      },
    },
    {
      selector: "edge.curated.arrow-target",
      style: {
        "target-arrow-shape": "triangle",
        "target-arrow-color": p.accent,
      },
    },
    {
      selector: "edge.curated.arrow-source",
      style: {
        "source-arrow-shape": "triangle",
        "source-arrow-color": p.accent,
      },
    },

    // --- labels ---------------------------------------------------------
    {
      selector: "node.hub, node.zoomed, node.stray, node.near, node.focus",
      style: { label: "data(label)" },
    },
    {
      selector: "node.focus",
      style: {
        "font-size": CANVAS_TYPE.focus,
        "z-index": 40,
        color: p.foreground,
      },
    },
    {
      // A hovered group keeps its own step: the focus step is a repo's size.
      selector: "node.group.focus",
      style: { "font-size": CANVAS_TYPE.group },
    },

    // --- flags ----------------------------------------------------------
    {
      // A cluster's "strays" — members living outside the folder where
      // most of the cluster lives. The actionable state on this screen.
      selector: "node.stray",
      style: {
        "border-width": 3,
        "border-color": p.warning,
        "z-index": 20,
      },
    },
    {
      selector: "node.selected",
      style: {
        "outline-width": 3,
        "outline-color": p.foreground,
        "z-index": 45,
      },
    },
    {
      selector: "node.pinned",
      style: {
        "underlay-color": p.foreground,
        "underlay-opacity": 0.18,
        "underlay-padding": 5,
        "underlay-shape": "ellipse",
      },
    },

    // --- focus / neighbourhood -------------------------------------------
    {
      selector: "edge.hot",
      style: { "line-color": p.foreground, opacity: 0.55, "z-index": 25 },
    },
    {
      selector: "edge.hot.curated",
      style: {
        "line-color": p.accent,
        opacity: 1,
        label: "data(curatedLabel)",
      },
    },

    // --- dimming (last: nothing dimmed keeps a label) ---------------------
    { selector: "node.dim", style: { opacity: 0.12, label: "" } },
    { selector: "edge.dim", style: { opacity: 0.04, label: "" } },
  ];
}

// ---------------------------------------------------------------------------
// Element building
// ---------------------------------------------------------------------------

function buildElements(
  nodes: GraphNode[],
  edges: GraphEdge[],
  nameOf: (slug: string) => string,
): cytoscape.ElementDefinition[] {
  const known = new Set(nodes.map((n) => n.slug));
  const hubThreshold = [...nodes]
    .sort((a, b) => b.degree - a.degree)
    .slice(0, hubCount(nodes.length))
    .at(-1)?.degree;

  const elements: cytoscape.ElementDefinition[] = nodes.map((node) => {
    const size = nodeSize(node.degree);
    const classes: string[] = [];
    if (node.isFavorite) classes.push("favourite");
    if (hubThreshold !== undefined && node.degree >= hubThreshold) {
      classes.push("hub");
    }
    return {
      group: "nodes" as const,
      data: {
        id: node.slug,
        label: node.name,
        cluster: node.cluster,
        degree: node.degree,
        folder: node.folder,
        colour: clusterColour(node.cluster),
        size,
        // Stars read visually smaller than a circle of the same box.
        favSize: size * 1.4,
      },
      classes: classes.join(" "),
    };
  });

  const seen = new Set<string>();
  for (const edge of edges) {
    if (!known.has(edge.source) || !known.has(edge.target)) continue;
    const id = `${edge.source}\u0000${edge.target}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const weight = clampWeight(edge.weight);
    const curated = edge.curated ?? [];
    const classes: string[] = [];
    if (curated.length > 0) {
      classes.push("curated");
      if (curated.some((link) => link.from === edge.source)) {
        classes.push("arrow-target");
      }
      if (curated.some((link) => link.from === edge.target)) {
        classes.push("arrow-source");
      }
    }

    elements.push({
      group: "edges" as const,
      data: {
        id,
        source: edge.source,
        target: edge.target,
        weight: edge.weight,
        width: 0.5 + (weight / MAX_MEANINGFUL_WEIGHT) * 2.6,
        curatedWidth: 1.6 + (weight / MAX_MEANINGFUL_WEIGHT) * 2,
        opacity: 0.1 + (weight / MAX_MEANINGFUL_WEIGHT) * 0.38,
        curatedLabel: curated
          .map((link) => `${nameOf(link.from)} ${link.kind} ${nameOf(link.to)}`)
          .join(" · "),
      },
      classes: classes.join(" "),
    });
  }

  return elements;
}

/**
 * Turn the collapsed overview into cytoscape elements.
 *
 * One bubble per group and one edge per pair of groups, however many repo
 * links are behind it — the count travels on the edge as `links` so width can
 * say how much the two groups share without drawing 1915 lines to say it.
 */
export function buildGroupElements(
  overview: ClusterOverview,
  palette: Palette,
): cytoscape.ElementDefinition[] {
  const elements: cytoscape.ElementDefinition[] = overview.groups.map(
    (group) => {
      const size = groupSize(group.size);
      return {
        group: "nodes" as const,
        data: {
          id: groupKey(group.id),
          clusterId: group.id,
          label: group.label,
          members: group.size,
          strays: group.strays,
          // Real clusters walk the generated hue wheel; the leftovers bucket
          // has no cluster to colour by, so it is neutral rather than a hue
          // that would claim it is a family.
          colour: group.id < 0 ? palette.muted : clusterColour(group.id),
          size,
          // Wrapping width for the name below the bubble.
          labelWidth: size + 96,
        },
        classes: "group",
      };
    },
  );

  for (const link of overview.links) {
    // Capped so one enormous pair cannot become the only link on screen.
    const strength = Math.min(link.links, 12);
    const source = groupKey(link.source);
    const target = groupKey(link.target);
    elements.push({
      group: "edges" as const,
      data: {
        id: `${source}|${target}`,
        source,
        target,
        links: link.links,
        width: 0.6 + strength * 0.35,
        opacity: 0.12 + strength * 0.05,
      },
      classes: "group",
    });
  }

  return elements;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GraphCanvas({
  nodes,
  edges,
  selectedSlug,
  highlightSlugs,
  onSelect,
  onOpen,
  overview = null,
}: GraphCanvasProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const cyRef = React.useRef<cytoscape.Core | null>(null);
  const pinnedRef = React.useRef(new Map<string, cytoscape.Position>());
  const lastTapRef = React.useRef({ slug: "", at: 0 });

  const [hovered, setHovered] = React.useState<string | null>(null);
  const [layingOut, setLayingOut] = React.useState(false);

  // Handlers change identity every render; the cytoscape listeners are
  // bound once, so they read through refs instead of being rebound.
  const onSelectRef = React.useRef(onSelect);
  const onOpenRef = React.useRef(onOpen);
  const selectedRef = React.useRef(selectedSlug);
  onSelectRef.current = onSelect;
  onOpenRef.current = onOpen;
  selectedRef.current = selectedSlug;

  const nodeBySlug = React.useMemo(
    () => new Map(nodes.map((n) => [n.slug, n])),
    [nodes],
  );

  /** Read by the listeners, which are bound once and never rebound. */
  const overviewRef = React.useRef(overview);
  overviewRef.current = overview;

  /**
   * The collapsed map, memoised.
   *
   * Both the element builder and the hover tooltip read it, and it also
   * decides which mode the canvas is in, so it must keep one identity for as
   * long as the overview does — otherwise every render would re-run the
   * layout.
   */
  const groupData = React.useMemo(
    () =>
      overview
        ? buildClusterOverview(
            overview.clusters,
            overview.edges,
            overview.ungroupedSlugs,
          )
        : null,
    [overview],
  );

  /** Which level the pane observer should re-frame, read without re-binding it. */
  const groupDataRef = React.useRef(groupData);
  groupDataRef.current = groupData;

  // --- instance -----------------------------------------------------------
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    ensureFcose();

    const cy = cytoscape({
      container,
      elements: [],
      minZoom: 0.12,
      maxZoom: 4,
      wheelSensitivity: 0.25,
      boxSelectionEnabled: false,
      // Selection is owned by the route (`selectedSlug`), so cytoscape's
      // own selection state is switched off rather than fought with.
      autounselectify: true,
      // Render the graph to a texture while panning — at ~1100 elements
      // this is the difference between smooth and stuttering.
      textureOnViewport: true,
      motionBlur: false,
    });
    cyRef.current = cy;

    cy.on("tap", (event) => {
      if (event.target === cy) onSelectRef.current(null);
    });

    cy.on("tap", "node", (event) => {
      const node = event.target;
      // At group level a tap opens the group. There is no repo behind a
      // bubble to select, so the double-tap-to-open rule does not apply.
      if (node.hasClass("group")) {
        const clusterId = Number(node.data("clusterId"));
        if (Number.isFinite(clusterId)) {
          overviewRef.current?.onSelectCluster(clusterId);
        }
        return;
      }
      const slug = node.id();
      const now = Date.now();
      const last = lastTapRef.current;
      if (last.slug === slug && now - last.at < DOUBLE_TAP_MS) {
        lastTapRef.current = { slug: "", at: 0 };
        onOpenRef.current(slug);
        return;
      }
      lastTapRef.current = { slug, at: now };
      onSelectRef.current(slug === selectedRef.current ? null : slug);
    });

    cy.on("mouseover", "node", (event) => {
      setHovered(event.target.id());
      container.style.cursor = "pointer";
    });
    cy.on("mouseout", "node", () => {
      setHovered(null);
      container.style.cursor = "";
    });

    // Dragging pins: the node keeps where you put it, and the position is
    // fed back into fcose as a fixed-node constraint on the next layout.
    cy.on("dragfree", "node", (event) => {
      const node = event.target;
      pinnedRef.current.set(node.id(), { ...node.position() });
      node.addClass("pinned");
    });
    cy.on("cxttap", "node", (event) => {
      pinnedRef.current.delete(event.target.id());
      event.target.removeClass("pinned");
    });

    // Label density, part two: which names are on screen, and how many.
    //
    // Answered on every pan and zoom rather than only when a threshold is
    // crossed — panning changes what is in view as much as zooming does — and
    // coalesced into one class flip per frame, so a wheel gesture costs a
    // single batch instead of one per element.
    let labelFrame = 0;
    const relabel = () => {
      if (labelFrame) return;
      labelFrame = window.requestAnimationFrame(() => {
        labelFrame = 0;
        labelNodesInView(cy);
      });
    };
    cy.on("zoom pan", relabel);

    return () => {
      window.cancelAnimationFrame(labelFrame);
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // --- pane size ----------------------------------------------------------
  /*
   * Cytoscape caches the size of its container, so a pane that changes under the
   * map leaves both the canvas and the framing describing a window that is no
   * longer there: measured in the running app, shrinking the window left
   * `cy.width()` at its old 960 while the pane was 880, and nothing re-framed.
   * The observer re-reads the size and re-frames on it — the same framing the map
   * would have opened with, which for the group map is another chance to arrange
   * itself to the pane's new shape before the clamp magnifies the drawing.
   *
   * Coalesced to one re-frame per frame, because a dragged window edge delivers a
   * stream of them and each one costs a measurement of every group's box.
   */
  React.useEffect(() => {
    const container = containerRef.current;
    const cy = cyRef.current;
    if (!container || !cy) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        cy.resize();
        if (cy.nodes().length > 0) {
          if (groupDataRef.current) refitGroupMap(cy, cy.width(), cy.height());
          else openAt(cy, Math.max(cy.zoom(), REPO_MIN_FIT_ZOOM));
        }
        labelNodesInView(cy);
      });
    });
    observer.observe(container);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // --- data + layout ------------------------------------------------------
  React.useEffect(() => {
    const cy = cyRef.current;
    const container = containerRef.current;
    if (!cy || !container) return;

    const nameOf = (slug: string) => nodeBySlug.get(slug)?.name ?? slug;
    const palette = readPalette(container);

    cy.style(buildStylesheet(palette));
    cy.batch(() => {
      cy.elements().remove();
      cy.add(
        groupData
          ? buildGroupElements(groupData, palette)
          : buildElements(nodes, edges, nameOf),
      );
    });

    pinnedRef.current.clear();

    if (cy.nodes().length === 0) {
      setLayingOut(false);
      return;
    }

    const layout = cy.layout(
      (groupData ? groupLayoutOptions() : fcoseOptions([])) as unknown as
        cytoscape.LayoutOptions,
    );
    setLayingOut(true);
    cy.one("layoutstop", () => {
      setLayingOut(false);
      settle(cy, groupData);
    });

    // Deferred so the "arranging" overlay actually paints — a "proof"
    // quality run is synchronous and would otherwise block the frame.
    const timer = window.setTimeout(() => layout.run(), 0);

    return () => {
      window.clearTimeout(timer);
      layout.stop();
    };
  }, [nodes, edges, nodeBySlug, groupData]);

  // --- selection ----------------------------------------------------------
  React.useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.nodes(".selected").removeClass("selected");
      if (selectedSlug) cy.getElementById(selectedSlug).addClass("selected");
    });
  }, [selectedSlug, nodes]);

  // --- strays -------------------------------------------------------------
  React.useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.nodes(".stray").removeClass("stray");
      for (const slug of highlightSlugs) {
        cy.getElementById(slug).addClass("stray");
      }
    });
  }, [highlightSlugs, nodes]);

  // --- focus: highlight a node and its neighbours, dim the rest ------------
  const focus = selectedSlug ?? hovered;
  React.useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass("dim near focus hot");
      if (!focus) return;
      const node = cy.getElementById(focus);
      if (node.empty()) return;
      const hood = node.closedNeighborhood();
      cy.elements().difference(hood).addClass("dim");
      hood.nodes().addClass("near");
      node.removeClass("near").addClass("focus");
      node.connectedEdges().addClass("hot");
    });
  }, [focus, nodes, edges]);

  const runLayout = React.useCallback((keepPins: boolean) => {
    const cy = cyRef.current;
    if (!cy || cy.nodes().length === 0) return;
    if (!keepPins) {
      pinnedRef.current.clear();
      cy.nodes(".pinned").removeClass("pinned");
    }
    const fixed = [...pinnedRef.current]
      .filter(([id]) => cy.getElementById(id).nonempty())
      .map(([nodeId, position]) => ({ nodeId, position }));
    const layout = cy.layout(
      (groupData ? groupLayoutOptions() : fcoseOptions(fixed)) as unknown as
        cytoscape.LayoutOptions,
    );
    setLayingOut(true);
    cy.one("layoutstop", () => {
      setLayingOut(false);
      settle(cy, groupData);
    });
    window.setTimeout(() => layout.run(), 0);
  }, [groupData]);

  /** Zoom around the middle of the viewport, not the top-left corner. */
  const zoomBy = React.useCallback((factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: cy.zoom() * factor,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  }, []);

  const fitToView = React.useCallback(() => {
    cyRef.current?.fit(undefined, 60);
  }, []);

  const hoveredNode = hovered ? nodeBySlug.get(hovered) : undefined;
  const hoveredGroup: ClusterGroup | undefined = React.useMemo(
    () => groupData?.groups.find((group) => groupKey(group.id) === hovered),
    [groupData, hovered],
  );
  const groupedRepoCount = React.useMemo(
    () => groupData?.groups.reduce((total, group) => total + group.size, 0) ?? 0,
    [groupData],
  );

  /**
   * The map is a picture to assistive tech: cytoscape paints into untitled
   * <canvas> elements, so there is no text to read. Name it for the counts
   * it shows, and leave the inspector beside it as the readable path to the
   * same links.
   */
  const mapSummary =
    groupData === null
      ? `Relationship map of ${nodes.length} ${
          nodes.length === 1 ? "repository" : "repositories"
        } linked by ${edges.length} ${edges.length === 1 ? "link" : "links"}.`
      : `Group map of ${groupedRepoCount} ${
          groupedRepoCount === 1 ? "repository" : "repositories"
        } in ${groupData.groups.length} ${
          groupData.groups.length === 1 ? "group" : "groups"
        }, linked by ${groupData.links.length} ${
          groupData.links.length === 1 ? "link" : "links"
        }. Open a group to see the repositories in it.`;

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <div
        ref={containerRef}
        className="h-full w-full"
        role="img"
        aria-label={mapSummary}
      />

      {layingOut ? (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <span className="rounded-md border border-border bg-popover px-2 py-1 font-mono atr-label text-muted-foreground shadow-overlay">
            {groupData
              ? `Arranging ${groupData.groups.length} groups…`
              : `Arranging ${nodes.length} repos…`}
          </span>
        </div>
      ) : null}

      <div
        role="group"
        aria-label="Graph view"
        className="absolute bottom-3 right-3 flex items-center divide-x divide-border overflow-hidden rounded-md border border-border bg-surface shadow-overlay"
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          aria-label="Zoom out"
          title="Zoom out"
          className="rounded-none hover:bg-surface-raised"
        >
          <ZoomOut aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => zoomBy(ZOOM_STEP)}
          aria-label="Zoom in"
          title="Zoom in"
          className="rounded-none hover:bg-surface-raised"
        >
          <ZoomIn aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={fitToView}
          aria-label="Fit the map to the window"
          title="Fit to view"
          className="rounded-none hover:bg-surface-raised"
        >
          <Maximize aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => runLayout(true)}
          aria-label={
            groupData
              ? "Re-arrange the layout, keeping pinned groups where you put them"
              : "Re-arrange the layout, keeping pinned repositories where you put them"
          }
          title={
            groupData
              ? "Re-arrange, keeping pinned groups"
              : "Re-arrange, keeping pinned repositories"
          }
          className="rounded-none hover:bg-surface-raised"
        >
          <Workflow aria-hidden />
        </Button>
      </div>

      {/*
        Each glyph is drawn as the swatch it stands for - the warning ring
        is an actual ring, not the letter O - and the wording stays muted, so
        a mark is never explained by colour alone.
      */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1">
        {groupData ? (
          <>
            <p className="atr-meta flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-sm border border-muted-foreground"
              />
              group · size = repos
            </p>
            <p className="atr-meta flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-0.5 w-4 shrink-0 rounded-full bg-muted-foreground"
              />
              link · width = shared links
            </p>
            <p className="atr-meta flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-warning"
              />
              a group whose members live apart
            </p>
          </>
        ) : (
          <>
            <p className="atr-meta flex items-center gap-1.5">
              <span aria-hidden className="text-body leading-none text-accent">
                →
              </span>
              curated link (asserted)
            </p>
            <p className="atr-meta flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-warning"
              />
              outside its cluster&apos;s home
            </p>
            <p className="atr-meta flex items-center gap-1.5">
              <span
                aria-hidden
                className="text-body leading-none text-foreground"
              >
                ★
              </span>
              favourite · size = connections
            </p>
          </>
        )}
      </div>

      {hoveredGroup ? (
        <div className="pointer-events-none absolute left-3 top-3 max-w-xs rounded-md border border-border bg-popover px-2 py-1 shadow-overlay">
          <p className="font-mono text-xs text-foreground">
            {hoveredGroup.label}
          </p>
          <p className="atr-meta mt-0.5">
            {hoveredGroup.size} repos
            {hoveredGroup.strays > 0
              ? ` · ${hoveredGroup.strays} outside the group's home folder`
              : ""}
          </p>
          <p className="atr-meta mt-0.5 text-muted-foreground">
            Click to open the group
          </p>
        </div>
      ) : hoveredNode && hovered !== selectedSlug ? (
        <div className="pointer-events-none absolute left-3 top-3 max-w-xs rounded-md border border-border bg-popover px-2 py-1 shadow-overlay">
          <p className="font-mono text-xs text-foreground">
            {hoveredNode.name}
          </p>
          <p className="atr-meta atr-truncate mt-0.5">
            {tildify(hoveredNode.folder)}
          </p>
          <p className="atr-meta mt-0.5">
            {hoveredNode.degree} connection{hoveredNode.degree === 1 ? "" : "s"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
