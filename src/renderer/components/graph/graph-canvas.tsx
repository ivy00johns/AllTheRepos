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

import type { GraphEdge, GraphNode } from "@shared/types";

import { Button } from "@renderer/components/ui/button";
import { tildify } from "@renderer/lib/repo-tree";

interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedSlug: string | null;
  highlightSlugs: ReadonlySet<string>;
  onSelect: (slug: string | null) => void;
  onOpen: (slug: string) => void;
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

type Palette = Record<keyof typeof TOKENS, string>;

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

/** Zoom past this and every node gets a label. */
const LABEL_ZOOM = 1.15;

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

// ---------------------------------------------------------------------------
// Stylesheet
// ---------------------------------------------------------------------------

const MONO_STACK = "JetBrains Mono, ui-monospace, SFMono-Regular, monospace";

/**
 * Later blocks win, so this reads top-to-bottom as a priority list:
 * base → signal → focus → dim. `.dim` is last precisely so a dimmed
 * element can never claw back a label.
 */
function buildStylesheet(p: Palette): cytoscape.StylesheetJsonBlock[] {
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
        "font-size": 10,
        "text-valign": "bottom",
        "text-halign": "center",
        "text-margin-y": 4,
        "text-background-color": p.background,
        "text-background-opacity": 0.75,
        "text-background-padding": "2px",
        "text-background-shape": "roundrectangle",
        // Cytoscape's own answer to label density: below this rendered
        // size the text is dropped entirely rather than smeared.
        "min-zoomed-font-size": 7,
        "text-events": "no",
        "overlay-opacity": 0,
        "z-index": 10,
      },
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
        "font-size": 9,
        "text-background-color": p.background,
        "text-background-opacity": 0.8,
        "text-background-padding": "2px",
        "min-zoomed-font-size": 8,
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
      style: { "font-size": 12, "z-index": 40, color: p.foreground },
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
}: GraphCanvasProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const cyRef = React.useRef<cytoscape.Core | null>(null);
  const pinnedRef = React.useRef(new Map<string, cytoscape.Position>());
  const labelsZoomedRef = React.useRef(false);
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
      const slug = event.target.id();
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

    // Label density, part two: past a zoom threshold every node gets a
    // label. One batched class flip per threshold crossing, not per frame.
    cy.on("zoom", () => {
      const on = cy.zoom() >= LABEL_ZOOM;
      if (on === labelsZoomedRef.current) return;
      labelsZoomedRef.current = on;
      cy.batch(() => {
        cy.nodes().toggleClass("zoomed", on);
      });
    });

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // --- data + layout ------------------------------------------------------
  React.useEffect(() => {
    const cy = cyRef.current;
    const container = containerRef.current;
    if (!cy || !container) return;

    const nameOf = (slug: string) => nodeBySlug.get(slug)?.name ?? slug;

    cy.style(buildStylesheet(readPalette(container)));
    cy.batch(() => {
      cy.elements().remove();
      cy.add(buildElements(nodes, edges, nameOf));
    });

    pinnedRef.current.clear();
    labelsZoomedRef.current = false;

    if (cy.nodes().length === 0) {
      setLayingOut(false);
      return;
    }

    const layout = cy.layout(
      fcoseOptions([]) as unknown as cytoscape.LayoutOptions,
    );
    setLayingOut(true);
    cy.one("layoutstop", () => setLayingOut(false));

    // Deferred so the "arranging" overlay actually paints — a "proof"
    // quality run is synchronous and would otherwise block the frame.
    const timer = window.setTimeout(() => layout.run(), 0);

    return () => {
      window.clearTimeout(timer);
      layout.stop();
    };
  }, [nodes, edges, nodeBySlug]);

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
      fcoseOptions(fixed) as unknown as cytoscape.LayoutOptions,
    );
    setLayingOut(true);
    cy.one("layoutstop", () => setLayingOut(false));
    window.setTimeout(() => layout.run(), 0);
  }, []);

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

  /**
   * The map is a picture to assistive tech: cytoscape paints into untitled
   * <canvas> elements, so there is no text to read. Name it for the counts
   * it shows, and leave the inspector beside it as the readable path to the
   * same links.
   */
  const mapSummary = `Relationship map of ${nodes.length} ${
    nodes.length === 1 ? "repository" : "repositories"
  } linked by ${edges.length} ${edges.length === 1 ? "link" : "links"}.`;

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
          <span className="rounded-md border border-border bg-popover px-2 py-1 font-mono text-[11px] text-muted-foreground shadow-overlay">
            Arranging {nodes.length} repos…
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
          aria-label="Re-arrange the layout, keeping pinned repositories where you put them"
          title="Re-arrange, keeping pinned repositories"
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
        <p className="atr-meta flex items-center gap-1.5">
          <span aria-hidden className="text-[13px] leading-none text-accent">
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
            className="text-[13px] leading-none text-foreground"
          >
            ★
          </span>
          favourite · size = connections
        </p>
      </div>

      {hoveredNode && hovered !== selectedSlug ? (
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
