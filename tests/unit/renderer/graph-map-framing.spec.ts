/**
 * The cluster-level map has to stay readable at the framing it opens in.
 *
 * The complaint this answers was not that the map drew the wrong thing, it was
 * that the map was unreadable: hundreds of dots tiled across a canvas, names
 * stacked on top of each other, the whole drawing scaled down until the type
 * was texture. Group level fixes the count; the layout constants fix the
 * spacing, and those are easily broken by a nudge to `nodeRepulsion` or
 * `gravity` that nobody re-measures.
 *
 * So the property is measured rather than eyeballed. cytoscape runs headless,
 * the layout is the real `groupLayoutOptions()`, the stylesheet is the real
 * `buildStylesheet()`, and the elements are the real `buildGroupElements()`
 * output — only the catalog is synthetic, because the shape that breaks a force
 * layout is the density, not whose repos they are.
 *
 * ## Four failures, one measurement each
 *
 * A readable map has to clear all of these, and the first two pull against
 * each other:
 *
 *   - **Scale.** No bubble may be magnified into a stamp. The fit arithmetic
 *     cytoscape uses is reproduced here, and the resulting name size must clear
 *     `CANVAS_TYPE.groupMin` — the size a group name is dropped below
 *     entirely.
 *   - **Room.** The names must not land on each other. Every name is boxed
 *     where it is actually drawn (under its bubble, wrapped at
 *     `data(labelWidth)`) and every pair is checked for overlap.
 *   - **Nothing over a name.** A bubble must not be drawn across a neighbour's
 *     name. This is the one the map shipped broken: name-over-name was the
 *     only collision measured, and it was the one that did *not* match what the
 *     screen looked like, because a covered name is not a collision you can see
 *     — it is simply absent. On the shape matching the real catalog it was 37
 *     pairs, against 6 of the kind being watched.
 *   - **Whole.** Nothing is trimmed and nothing is magnified. At the panes the
 *     product has, the fit has to clear the legibility floor on its own, so the
 *     map opens fitted rather than at a scale the clamp had to impose, and every
 *     edge of the drawing sits inside the pane. This is the one the sampled
 *     arrangements exist for: the layout is randomized, so it is a property of
 *     every arrangement or of none.
 *
 * Spreading the layout fixes the second and worsens the first, which is why
 * both are asserted together: tuning one alone is how the map got unreadable.
 * The third is answered outside the layout, by the pass the app runs after it:
 * `arrangeGroupMap`, which squashes the settled arrangement to the pane's own
 * aspect and then packs its boxes. That pass is applied here too, so what is
 * measured is the drawing the app actually opens rather than the layout's raw
 * output.
 *
 * ## Framing
 *
 * The scale is measured from the app's own `frameInPane`, not from cytoscape's
 * fit arithmetic, because the layout's `fit: true` is overwritten before the
 * first paint and a name hanging outside its bubble is invisible to element
 * bounds. Two things then have to hold: the drawing is centred by those same
 * boxes, and no part of it is off the pane. A pane too small to hold the
 * drawing magnifies it to the legibility floor and pans, and the clamp is
 * supposed to cost a pan, not a row of bubbles. It cost one edge — the topmost
 * bubble trimmed by 13px while the bottom kept 63px — because the clamp
 * recentred with `cy.center()`, which places bubbles. At the panes the product
 * has, the fit now clears the floor on its own, so the map opens fitted: a
 * sampled arrangement that cannot is a failure, not a known gap.
 *
 * ## What this does and does not prove
 *
 * cytoscape cannot measure text without a DOM, so names are measured as
 * `length × 0.6em` in the canvas' monospace stack. That is a model of the
 * framing, not a pixel proof of it, and it cannot catch a styling regression —
 * only a layout one, which is exactly the kind that made the map unreadable and
 * exactly the kind nothing else here would notice.
 *
 * The layout runs from fixed starting positions (`randomize: false`), so the
 * measurement is the layout's equilibrium for these forces rather than one
 * random sample of it. `randomize` only picks the starting configuration; the
 * forces being tuned here decide where it settles.
 */

import { describe, expect, it } from "vitest";
import cytoscape from "cytoscape";
// cytoscape-fcose ships no type declarations and has no @types package.
// @ts-expect-error -- untyped extension, see graph-canvas.tsx
import fcose from "cytoscape-fcose";

import type { GraphCluster, GraphEdge } from "@shared/types";

import {
  arrangeGroupMap,
  buildGroupElements,
  buildStylesheet,
  CANVAS_TYPE,
  footprintBounds,
  frameInPane,
  GROUP_MAX_FIT_ZOOM,
  GROUP_MIN_FIT_ZOOM,
  groupFootprint,
  groupLayoutOptions,
  groupOpenZoom,
  refitGroupMap,
  type Palette,
} from "@renderer/components/graph/graph-canvas";
import {
  buildClusterOverview,
  type ClusterOverview,
} from "@renderer/lib/graph-clusters";

// Registered here because the canvas registers it lazily, inside an effect a
// headless test never runs.
cytoscape.use(fcose);

/** Any valid colours will do: nothing here resolves design tokens. */
const PALETTE: Palette = {
  foreground: "rgb(230,230,230)",
  muted: "rgb(130,130,130)",
  border: "rgb(70,70,70)",
  borderStrong: "rgb(105,105,105)",
  accent: "rgb(120,220,170)",
  warning: "rgb(230,190,90)",
  background: "rgb(12,16,20)",
};

/**
 * Advance width of the canvas' monospace stack, in em.
 *
 * JetBrains Mono is 0.6em per glyph. Approximate on purpose: erring high makes
 * the collision check stricter, not laxer.
 */
const MONO_ADVANCE = 0.6;

/**
 * Map pane at the windows the product really has.
 *
 * Derived rather than guessed, because guessing is what left the map opening on
 * a pane it never gets: the main window is 1280x800 with an 800x600 minimum
 * (`src/main/window/main-window.ts`), the repo sidebar is `w-80` (320px), and
 * the chrome above the map — title bar, notice banner, relationships header and
 * filter chips — is 206px, measured in the running app on the 1360x760 window
 * the complaint came from. So the pane the app actually paints is 960x594 at
 * the default window, and the old 1400x830 here was a pane that exists nowhere.
 *
 * Two panes rather than one, because they squeeze different axes: the default
 * window is the narrow one (960 wide) and a wider, shorter window is the tight
 * one vertically (554 tall at 1360x760).
 */
const VIEWPORTS = [
  { name: "default window", width: 960, height: 594 },
  { name: "wide window", width: 1040, height: 554 },
] as const;

/** The panes the map is required to open *fitted* on, not merely readable. */
const DESIGN_PANES = VIEWPORTS;

/**
 * The pane the smallest window the app allows gives the map: 800x600 minus the
 * same sidebar and chrome, per `src/main/window/main-window.ts`.
 *
 * No pane is required to fit a catalog this size at a legible scale — the boxes
 * alone come to more than the room — so this is where "re-frame it" has to
 * become "keep the type and pan evenly" rather than shrinking a name below the
 * size it is dropped at.
 */
const MIN_WINDOW_PANE = { name: "minimum window", width: 480, height: 394 } as const;

/**
 * The app's own randomness, sampled.
 *
 * `groupLayoutOptions().randomize` is true, so the real map starts from a
 * random configuration on every visit and settles somewhere slightly different
 * each time. A property that holds for one start is therefore not a property of
 * the product: the framing defect that trimmed the top of the map appeared on
 * some arrangements and not others, which is exactly why it survived being
 * looked at. These seeds are the samples, fixed so a failure reproduces.
 */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/**
 * A shorter sweep for the shapes no longer concerned about fitting.
 *
 * A sixty-group catalog is three times the size the group map is designed to
 * show at once, and every seed of it is a full layout: the fitting rule is not
 * asked of it, so it is sampled four times rather than twelve.
 */
const PAST_TARGET_SEEDS = SEEDS.slice(0, 4);

/**
 * Where the layout starts from before the forces shape it.
 *
 * `"spiral"` is the tidy, stable start the per-shape measurement uses; a number
 * scatters the nodes across the pane the way `randomize: true` does in the app.
 */
type Start = "spiral" | number;

/** Deterministic pseudo-random in [0,1), so a failure reproduces exactly. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

interface Shape {
  name: string;
  /** Repos per group — a real catalog's cluster sizes are very uneven. */
  groups: number[];
  ungrouped: number;
  /** Repo links drawn between groups, before aggregation. */
  crossLinks: number;
  seed: number;
  /**
   * More groups than the map is designed to hold in one readable pane.
   *
   * Such a shape is still measured for collisions and for the overflow being
   * split evenly — that is where a packing bug shows up — but not for the "fits
   * the pane at a readable size" claim, which is a claim about the catalog the
   * product has (thirty-odd groups). The floor still applies: it opens at the
   * legibility minimum and pans.
   */
  beyondDesignTarget?: boolean;
}

/** Catalogs chosen to bracket the shapes the layout has to survive. */
const SHAPES: Shape[] = [
  {
    name: "a small tidy library",
    groups: [4, 3, 3, 2, 2],
    ungrouped: 3,
    crossLinks: 6,
    seed: 1,
  },
  {
    name: "twenty families",
    groups: [12, 9, 8, 7, 6, 6, 5, 5, 4, 4, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2],
    ungrouped: 12,
    crossLinks: 140,
    seed: 2,
  },
  {
    name: "the measured catalog (38 clusters / 1915 links)",
    groups: [
      30, 24, 20, 18, 16, 15, 14, 12, 11, 10, 9, 9, 8, 8, 7, 7, 6, 6, 6, 5, 5,
      5, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2,
    ],
    ungrouped: 34,
    crossLinks: 1915,
    seed: 3,
  },
  {
    name: "a dense sixty-group library",
    groups: Array.from({ length: 60 }, (_, i) => 2 + (i % 9)),
    ungrouped: 40,
    crossLinks: 2600,
    seed: 4,
    beyondDesignTarget: true,
  },
  {
    name: "one huge family and a scattering",
    groups: [120, 6, 5, 4, 3, 2, 2, 2],
    ungrouped: 30,
    crossLinks: 900,
    seed: 5,
  },
];

/**
 * A plausible project name.
 *
 * Lengths matter more than the words: the label box is the thing under test,
 * and `group-0` would flatter it. The sampled lengths bracket real repo names
 * from `warp` to `crewAI-examples` to `30daysofPrompts`.
 */
const NAME_LENGTHS = [4, 6, 9, 11, 13, 15, 18, 21, 26];

function shapeToOverview(shape: Shape): ClusterOverview {
  const clusters: GraphCluster[] = [];
  const members: string[][] = [];
  const random = rng(shape.seed);
  let id = 0;
  for (const size of shape.groups) {
    const slugs = Array.from({ length: size }, (_, i) => `g${id}p${i}`);
    members.push(slugs);
    const length =
      NAME_LENGTHS[Math.floor(random() * NAME_LENGTHS.length)] ?? 12;
    clusters.push({
      id,
      label: nameOfLength(length, id),
      size,
      slugs,
      folders: [{ folder: "/repos", count: size }],
      folderSpread: 1,
      dominantFolder: "/repos",
      strays: [],
    });
    id += 1;
  }

  const edges: GraphEdge[] = [];
  for (let i = 0; i < shape.crossLinks; i += 1) {
    const a = Math.floor(random() * members.length);
    let b = Math.floor(random() * members.length);
    if (a === b) b = (b + 1) % members.length;
    const from = members[a][Math.floor(random() * members[a].length)];
    const to = members[b][Math.floor(random() * members[b].length)];
    edges.push({
      source: from,
      target: to,
      weight: 1,
      signals: ["owner"],
      why: [],
    });
  }

  const ungrouped = Array.from(
    { length: shape.ungrouped },
    (_, i) => `loose-${i}`,
  );
  return buildClusterOverview(clusters, edges, ungrouped);
}

/** A name of exactly `length` characters, unique per group. */
function nameOfLength(length: number, id: number): string {
  const suffix = `-${id}`;
  const stem = "abcdefghijklmnopqrstuvwxyz".repeat(2);
  return `${stem.slice(0, Math.max(1, length - suffix.length))}${suffix}`;
}

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Where a bubble's name is drawn: below it, centred, wrapped at its width. */
function labelBox(node: cytoscape.NodeSingular): Box {
  const size = Number(node.data("size"));
  const wrap = Number(node.data("labelWidth"));
  const text = String(node.data("label"));
  const width = Math.min(wrap, text.length * MONO_ADVANCE * CANVAS_TYPE.group);
  const height = CANVAS_TYPE.group * 1.2;
  const position = node.position();
  const top = position.y + size / 2 + 6;
  return {
    x1: position.x - width / 2,
    y1: top,
    x2: position.x + width / 2,
    y2: top + height,
  };
}

/**
 * The bubble itself, as a square.
 *
 * `round-rectangle` at `data(size)` on both axes, so the corner radius takes a
 * little off each corner — modelled as the full square, which errs on the
 * strict side.
 */
function bubbleBox(node: cytoscape.NodeSingular): Box {
  const size = Number(node.data("size"));
  const position = node.position();
  return {
    x1: position.x - size / 2,
    y1: position.y - size / 2,
    x2: position.x + size / 2,
    y2: position.y + size / 2,
  };
}

function overlaps(a: Box, b: Box): boolean {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
}

/**
 * How the drawing's own geometry collides, in the three ways it can.
 *
 * `labelOverLabel` was the only one measured here, and it is the one that does
 * *not* match what the map actually looks like: a name sitting under a
 * neighbouring bubble is drawn perfectly well and simply is not there when you
 * look, because cytoscape paints a node and its label in one pass and the
 * bubble drawn later wins. Two names overlapping are at least both visible, in
 * a wrapped box over a background. So the share that matters is the first one,
 * and it went unmeasured until the map was put in front of somebody.
 */
interface Collisions {
  labelOverLabel: number;
  bubbleOverLabel: number;
  bubbleOverBubble: number;
  totalPairs: number;
}interface Framing {
  nodes: number;
  links: number;
  /** The fit the app's own framing produces for this pane. */
  rawZoom: number;
  /** The level the map actually opens at, after `groupOpenZoom`. */
  openZoom: number;
  /** Rendered size of a group name as the map opens. */
  labelPx: number;

  /** Rendered size of a group name at the raw fit, before opening at all. */
  rawLabelPx: number;
  /**
   * Room between the drawn boxes and each edge of the pane, at the opening
   * level. Negative means the drawing is larger than the pane on that axis.
   */
  openMargins: { left: number; right: number; top: number; bottom: number };
  collisions: Collisions;
}

/**
 * Lay the group map out from a fixed start, in a pane, and hand back the map.
 *
 * The instance is handed back rather than measured here because one pane is not
 * the only pane a map is drawn in: the re-framing test at the end of this file
 * changes the size under the same map, which is what the app's pane observer
 * does to the running one.
 */
function buildMap(
  overview: ClusterOverview,
  width: number,
  height: number,
  start: Start = "spiral",
): cytoscape.Core {
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    elements: buildGroupElements(overview, PALETTE),
  });
  cy.style(buildStylesheet(PALETTE));

  const all = cy.nodes();
  if (start === "spiral") {
    // A golden-angle spiral, so the start is spread rather than all at the
    // origin; `randomize: false` then keeps it and the forces shape it.
    all.forEach((node, index) => {
      const angle = index * 2.399963;
      const radius =
        Math.sqrt((index + 0.5) / all.length) * Math.min(width, height) * 0.45;
      node.position({
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
      });
    });
  } else {
    // Scattered across the pane, as `randomize: true` scatters it in the app.
    const random = rng(start * 7919 + 13);
    all.forEach((node) => {
      node.position({ x: random() * width, y: random() * height });
    });
  }

  cy.layout({
    ...groupLayoutOptions(),
    randomize: false,
  } as unknown as cytoscape.LayoutOptions).run();

  /*
   * The app's own arranging pass, in the app's own order: after the layout, and
   * before the fit that decides the scale. It squashes the arrangement to the
   * pane's aspect and packs the boxes, both in the app's own footprint model, so
   * this measures the drawing that ships rather than one this file invented.
   */
  arrangeGroupMap(cy, width, height);
  return cy;
}

/**
 * Lay the group map out from a fixed start and report how it frames.
 */
function frame(
  overview: ClusterOverview,
  width: number,
  height: number,
  start: Start = "spiral",
): Framing {
  const cy = buildMap(overview, width, height, start);
  const framing = measureMap(cy, width, height);
  cy.destroy();
  return framing;
}

/**
 * How a laid-out map frames in a pane: the fit its boxes allow, the scale it
 * opens at, the room left at each edge, and every way it collides.
 *
 * Split out from `frame` so the same measurement can be taken again after the
 * pane has changed size, which is the only difference between the two callers.
 */
function measureMap(
  cy: cytoscape.Core,
  width: number,
  height: number,
): Framing {
  const all = cy.nodes();
  /*
   * The fit is the app's own framing, from the boxes the app packs in — one
   * footprint per group, bubble and name together. Modelling it from
   * cytoscape's fit arithmetic here would measure a map that no longer ships:
   * the layout's `fit: true` is overwritten by `frameGroupMap` before the first
   * paint, and a name hanging outside its bubble is invisible to element
   * bounds.
   */
  const footprints = all.map((node) =>
    groupFootprint(
      node.id(),
      node.position(),
      Number(node.data("size")),
      String(node.data("label") ?? ""),
      Number(node.data("labelWidth")),
    ),
  );
  const bounds = footprintBounds(footprints);
  const fitted = bounds ? frameInPane(bounds, width, height) : null;
  if (!bounds || !fitted) throw new Error("nothing to frame");
  const rawZoom = fitted.zoom;

  const boxes = all.map((node) => labelBox(node));
  const bubbles = all.map((node) => bubbleBox(node));
  const collisions: Collisions = {
    labelOverLabel: 0,
    bubbleOverLabel: 0,
    bubbleOverBubble: 0,
    totalPairs: (boxes.length * (boxes.length - 1)) / 2,
  };
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (overlaps(boxes[i], boxes[j])) collisions.labelOverLabel += 1;
      if (overlaps(bubbles[i], bubbles[j])) collisions.bubbleOverBubble += 1;
      // Either direction: a bubble over a neighbour's name, or a name over a
      // neighbour's bubble. Both mean the same thing on screen — one of the two
      // is not readable — and which way round it falls is draw order, which is
      // collection order, which is cluster size.
      if (
        overlaps(bubbles[i], boxes[j]) ||
        overlaps(bubbles[j], boxes[i]) ||
        overlaps(boxes[i], bubbles[j]) ||
        overlaps(boxes[j], bubbles[i])
      ) {
        collisions.bubbleOverLabel += 1;
      }
    }
  }

  // The level the product opens at, from the fit this layout produced.
  const openZoom = groupOpenZoom(rawZoom);
  const placed = frameInPane(bounds, width, height, openZoom);
  if (!placed) throw new Error("nothing to frame");
  const openMargins = {
    left: bounds.x1 * placed.zoom + placed.pan.x,
    right: width - (bounds.x2 * placed.zoom + placed.pan.x),
    top: bounds.y1 * placed.zoom + placed.pan.y,
    bottom: height - (bounds.y2 * placed.zoom + placed.pan.y),
  };
  const framing: Framing = {
    nodes: all.length,
    links: cy.edges().length,
    rawZoom,
    openZoom,
    labelPx: CANVAS_TYPE.group * openZoom,
    rawLabelPx: CANVAS_TYPE.group * rawZoom,
    openMargins,
    collisions,
  };
  return framing;
}

function report(shape: Shape, viewport: string, framing: Framing): void {
  const { collisions } = framing;
  console.log(
    `${shape.name} @ ${viewport}: ${framing.nodes} groups, ${framing.links} links, ` +
      `fit ${framing.rawZoom.toFixed(3)} (names ${framing.rawLabelPx.toFixed(1)}px), ` +
      `opens ${framing.openZoom.toFixed(3)} (names ${framing.labelPx.toFixed(1)}px), ` +
      `name-over-name ${collisions.labelOverLabel}/${collisions.totalPairs}, ` +
      `bubble-over-name ${collisions.bubbleOverLabel}, ` +
      `bubble-over-bubble ${collisions.bubbleOverBubble}, ` +
      `margins ${[
        framing.openMargins.left,
        framing.openMargins.top,
        framing.openMargins.right,
        framing.openMargins.bottom,
      ]
        .map((margin) => margin.toFixed(0))
        .join("/")}`,
  );
}

describe("cluster-level map framing", () => {
  for (const shape of SHAPES) {
    for (const viewport of VIEWPORTS) {
      it(`frames legibly — ${shape.name}, ${viewport.name}`, () => {
        const framing = frame(
          shapeToOverview(shape),
          viewport.width,
          viewport.height,
        );
        report(shape, viewport.name, framing);

        /*
         * The fit at the pane the product actually has, held to the legibility
         * floor itself: the map has to open *fitted*, which is what a fit at or
         * above that floor means. Below it the clamp magnifies the drawing and
         * the map opens with a pan.
         *
         * This used to be pinned at 0.718, the level the framing happened to
         * reach, with a comment saying the fifth it was short was a known gap
         * and that the shape of the map would close it rather than the packing.
         * It did close it: the arrangement is now squashed to the pane's own
         * aspect before it is packed (`arrangeGroupMap`), which is the one thing
         * a force equilibrium cannot do for itself. So the claim is the real one
         * again — the assertion fails on a magnified map rather than on a
         * remembered number.
         */
        if (!shape.beyondDesignTarget) {
          expect(
            framing.rawZoom,
            `the drawing fits at ${framing.rawZoom.toFixed(3)} where the ` +
              `legibility floor is ${GROUP_MIN_FIT_ZOOM} (names ` +
              `${framing.rawLabelPx.toFixed(1)}px at that fit), so the map ` +
              `would open magnified and panned`,
          ).toBeGreaterThanOrEqual(GROUP_MIN_FIT_ZOOM);
        }

        // Whatever the pane, the map never opens with its names already gone.
        // This is the constant contract — a ceiling below the legibility floor
        // would open the map with nothing readable on it.
        expect(
          framing.labelPx,
          `the map opens at ${framing.openZoom.toFixed(2)} (fit ` +
            `${framing.rawZoom.toFixed(2)}), where a group name renders at ` +
            `${framing.labelPx.toFixed(1)}px — below the ` +
            `${CANVAS_TYPE.groupMin}px floor the name is dropped entirely`,
        ).toBeGreaterThanOrEqual(CANVAS_TYPE.groupMin);

        /*
         * The packing pass is supposed to make the drawn boxes disjoint, so all
         * three counts are zero — and they are asserted as zero rather than as
         * a share, because "a few names are covered" is not a tolerable state
         * for a map whose whole content is thirty names. The share the tests
         * used to allow (4%) was the old layout's excuse, not a target.
         */
        expect(
          framing.collisions.labelOverLabel,
          `${framing.collisions.labelOverLabel} of ` +
            `${framing.collisions.totalPairs} name pairs overlap. The packing ` +
            `pass is not clearing the names`,
        ).toBe(0);
        expect(
          framing.collisions.bubbleOverLabel,
          `${framing.collisions.bubbleOverLabel} pairs have a bubble drawn ` +
            `across a neighbour's name, which hides the name rather than ` +
            `colliding with it — the failure this measurement was added for`,
        ).toBe(0);

        /*
         * And the frame is centred on the drawing it frames, names included.
         * `cy.center()` cannot do this — it places element bounds, which are
         * the bubbles — so a drawing magnified past the pane lost one edge
         * instead of overflowing evenly.
         */
        const { left, right, top, bottom } = framing.openMargins;
        expect(
          Math.abs(left - right),
          `the map opens with ${left.toFixed(0)}px to the left of the drawing ` +
            `and ${right.toFixed(0)}px to its right: the framing is not ` +
            `centred on the boxes it framed`,
        ).toBeLessThan(0.5);
        expect(
          Math.abs(top - bottom),
          `the map opens with ${top.toFixed(0)}px above the drawing and ` +
            `${bottom.toFixed(0)}px below it: the framing is not centred on ` +
            `the boxes it framed`,
        ).toBeLessThan(0.5);

        /*
         * The other end of the same rule: a family of nine groups must not be
         * magnified into a wall of stamps either. The clamp's ceiling is what
         * holds that, and it is the half of the range nothing asserted — the
         * floor was checked while the dense shape passed a fit that could not
         * see its own names.
         */
        expect(
          framing.openZoom,
          `the map opens at ${framing.openZoom.toFixed(2)}, magnifying the ` +
            `layout from ${framing.rawZoom.toFixed(2)} — past the ` +
            `${GROUP_MAX_FIT_ZOOM} at which a drawing is a close-up rather ` +
            `than an overview`,
        ).toBeLessThanOrEqual(GROUP_MAX_FIT_ZOOM);
      });
    }
  }
});

/**
 * Whatever arrangement the layout settles into, the map opens fitted and whole.
 *
 * This is the property the per-shape measurement above could not see. The layout
 * is randomized, so the drawing differs every visit — the map is a fresh
 * arrangement each time it is opened — and a guarantee that holds for one start
 * is not a guarantee about the product. The framing defect that trimmed the top
 * of the map appeared on some arrangements and not others, which is exactly why
 * it survived being looked at.
 *
 * So every seed below is its own drawing, and each of them has to clear four
 * rules: nothing drawn over anything, every name above the size it is dropped
 * at, a fit that clears the legibility floor on its own — the map opens fitted
 * rather than magnified and panned — and no edge of the drawing outside the
 * pane. The scale is reported for every sample, so a failure names the
 * arrangement it came from and the seed that reproduces it.
 */
describe("opens fitted and whole, whatever arrangement it settles into", () => {
  const catalog = SHAPES.find((shape) =>
    shape.name.startsWith("the measured catalog"),
  );
  if (!catalog) throw new Error("the measured catalog shape is gone");

  /** Everything a sampled arrangement has to be, none of it optional. */
  const opensWell = (shape: Shape, framing: Framing, arrangement: string) => {
    report(shape, arrangement, framing);

    expect(
      framing.collisions.bubbleOverLabel,
      `arrangement ${arrangement}: ${framing.collisions.bubbleOverLabel} ` +
        `pairs have a bubble drawn across a neighbour's name`,
    ).toBe(0);
    expect(
      framing.collisions.labelOverLabel,
      `arrangement ${arrangement}: ${framing.collisions.labelOverLabel} name ` +
        `pairs overlap`,
    ).toBe(0);
    expect(
      framing.collisions.bubbleOverBubble,
      `arrangement ${arrangement}: ${framing.collisions.bubbleOverBubble} ` +
        `bubble pairs overlap, which the packing pass is what prevents`,
    ).toBe(0);

    // Whatever the fit, the map never opens with its names already gone: a
    // ceiling below the legibility floor would open it with nothing readable on
    // it, which no arrangement may do.
    expect(
      framing.labelPx,
      `arrangement ${arrangement} opens at ${framing.openZoom.toFixed(3)} where ` +
        `a group name renders at ${framing.labelPx.toFixed(1)}px, below the ` +
        `${CANVAS_TYPE.groupMin}px floor the name is dropped at`,
    ).toBeGreaterThanOrEqual(CANVAS_TYPE.groupMin);

    /*
     * The map opens fitted on this arrangement: the fit clears the legibility
     * floor, so the clamp has nothing to magnify. This is the assertion the
     * arrangement matters for — it is the one the layout's randomness moves,
     * and the one that failed on some starts before the arrangement was squashed
     * to the pane's aspect.
     */
    expect(
      framing.rawZoom,
      `arrangement ${arrangement} fits at ${framing.rawZoom.toFixed(3)} where ` +
        `the legibility floor is ${GROUP_MIN_FIT_ZOOM}, so the map would open ` +
        `magnified and panned`,
    ).toBeGreaterThanOrEqual(GROUP_MIN_FIT_ZOOM);

    /*
     * And nothing is trimmed: every edge of the drawing is inside the pane at
     * the scale it opens at. Fitted and untrimmed are not the same rule — a
     * drawing can clear the floor and still be framed off its own centre, and a
     * magnified one can overflow *evenly* and still lose a row of names, which
     * is the failure this whole file exists for.
     */
    const { left, right, top, bottom } = framing.openMargins;
    for (const [edge, margin] of Object.entries({ left, right, top, bottom })) {
      expect(
        margin,
        `arrangement ${arrangement}: the ${edge} edge of the drawing is ` +
          `${(-margin).toFixed(0)}px outside the pane at the scale it opens at ` +
          `(fit ${framing.rawZoom.toFixed(3)}, opens ` +
          `${framing.openZoom.toFixed(3)})`,
      ).toBeGreaterThanOrEqual(0);
    }

    /*
     * Centred on the boxes it framed, whatever those are. Whenever the drawing
     * does not fill the pane on an axis, the room left over has to be the same
     * on both sides of it — that is what makes the map look framed rather than
     * shoved, and what keeps a failure on one edge from hiding behind a margin
     * on the other.
     */
    expect(Math.abs(left - right)).toBeLessThan(0.5);
    expect(Math.abs(top - bottom)).toBeLessThan(0.5);
  };

  for (const viewport of DESIGN_PANES) {
    it(`opens fitted — the measured catalog, ${viewport.name}`, () => {
      for (const seed of SEEDS) {
        opensWell(
          catalog,
          frame(shapeToOverview(catalog), viewport.width, viewport.height, seed),
          `${viewport.name}, arrangement ${seed}`,
        );
      }
    });
  }

  // The other catalogs the product could meet, held to the same bar.
  for (const shape of SHAPES.filter(
    (candidate) => candidate !== catalog && !candidate.beyondDesignTarget,
  )) {
    it(`opens fitted — ${shape.name}`, () => {
      const viewport = VIEWPORTS[0];
      for (const seed of SEEDS) {
        opensWell(
          shape,
          frame(shapeToOverview(shape), viewport.width, viewport.height, seed),
          `${viewport.name}, arrangement ${seed}`,
        );
      }
    });
  }

  /*
   * Catalogs past the design target are not asked to fit — no arrangement of
   * sixty groups fits a 960px pane at a readable size, and pretending otherwise
   * by shrinking the type is the failure the floor exists to prevent. They are
   * still held to the collision rule on every arrangement, because that one
   * *is* a property of any catalog size: the packing pass either separates the
   * boxes or it does not.
   */
  for (const shape of SHAPES.filter((candidate) => candidate.beyondDesignTarget)) {
    it(`never collides even past the design target — ${shape.name}`, () => {
      const viewport = VIEWPORTS[0];
      for (const seed of PAST_TARGET_SEEDS) {
        const framing = frame(
          shapeToOverview(shape),
          viewport.width,
          viewport.height,
          seed,
        );
        report(shape, `${viewport.name}, arrangement ${seed}`, framing);
        expect(framing.collisions.bubbleOverLabel).toBe(0);
        expect(framing.collisions.labelOverLabel).toBe(0);
        expect(framing.collisions.bubbleOverBubble).toBe(0);
        const { left, right, top, bottom } = framing.openMargins;
        expect(Math.abs(left - right)).toBeLessThan(0.5);
        expect(Math.abs(top - bottom)).toBeLessThan(0.5);
      }
    });
  }
});

/**
 * The pane changes under the map.
 *
 * A window resize or a toggled sidebar is not a new catalog, so nothing is
 * re-laid-out — but the canvas and the framing both describe the pane they were
 * made for, and measuring the running app showed the canvas keeping its old size
 * while the pane had shrunk, with the drawing left off-centre in what remained.
 *
 * So one map is walked through the panes the product has, the way resizing the
 * window does to the running one, and held to the same rules at every step. The
 * viewport has to move to the pane it now has rather than keep describing the
 * pane it was laid out for; the drawing has to open fitted wherever the pane can
 * hold it; and at the 800x600 minimum, where no pane holds a catalog this size at
 * a legible scale, the type is kept and the overflow stays even instead of a name
 * being shrunk below the size it is dropped at.
 */
describe("follows the pane it is drawn in", () => {
  const catalog = SHAPES.find((shape) =>
    shape.name.startsWith("the measured catalog"),
  );
  if (!catalog) throw new Error("the measured catalog shape is gone");

  it("re-frames to a pane that changed size, and rearranges only when it must", () => {
    const cy = buildMap(
      shapeToOverview(catalog),
      VIEWPORTS[0].width,
      VIEWPORTS[0].height,
      1,
    );
    try {
      for (const pane of [
        ...VIEWPORTS,
        MIN_WINDOW_PANE,
        VIEWPORTS[0],
        VIEWPORTS[1],
      ]) {
        refitGroupMap(cy, pane.width, pane.height);
        const framing = measureMap(cy, pane.width, pane.height);
        report(catalog, `${pane.name}, after a resize`, framing);

        expect(
          cy.zoom(),
          `the map still draws at ${cy.zoom().toFixed(3)} after the pane became ` +
            `${pane.width}x${pane.height}, where the fit for that pane would ` +
            `open it at ${framing.openZoom.toFixed(3)}: the change did not ` +
            `re-frame it`,
        ).toBeCloseTo(framing.openZoom, 3);

        expect(
          framing.collisions.bubbleOverLabel,
          `${pane.name}: ${framing.collisions.bubbleOverLabel} pairs have a ` +
            `bubble drawn across a neighbour's name after the resize`,
        ).toBe(0);
        expect(framing.collisions.labelOverLabel).toBe(0);
        expect(framing.collisions.bubbleOverBubble).toBe(0);

        expect(
          framing.labelPx,
          `${pane.name}: a group name renders at ${framing.labelPx.toFixed(1)}px ` +
            `after the resize, below the ${CANVAS_TYPE.groupMin}px floor it is ` +
            `dropped at`,
        ).toBeGreaterThanOrEqual(CANVAS_TYPE.groupMin);

        const { left, right, top, bottom } = framing.openMargins;
        if (pane === MIN_WINDOW_PANE) {
          // The pane that cannot hold this catalog: the clamp keeps the type and
          // pans, so what has to hold is that it pans evenly.
          expect(Math.abs(left - right)).toBeLessThan(0.5);
          expect(Math.abs(top - bottom)).toBeLessThan(0.5);
          continue;
        }

        expect(
          framing.rawZoom,
          `${pane.name}: the drawing fits at ${framing.rawZoom.toFixed(3)} after ` +
            `the resize, below the ${GROUP_MIN_FIT_ZOOM} floor, so the map opens ` +
            `magnified and panned`,
        ).toBeGreaterThanOrEqual(GROUP_MIN_FIT_ZOOM);
        for (const [edge, margin] of Object.entries({ left, right, top, bottom })) {
          expect(
            margin,
            `${pane.name}: the ${edge} edge of the drawing is ` +
              `${(-margin).toFixed(0)}px outside the pane after the resize`,
          ).toBeGreaterThanOrEqual(0);
        }
      }
    } finally {
      cy.destroy();
    }
  });
});
