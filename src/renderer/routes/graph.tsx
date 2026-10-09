/**
 * `/graph` — the relationship map.
 *
 * Two panes: the map, and a list of clusters ranked by how scattered
 * they are. The list is the actionable half — "these eight repos belong
 * together and live in five different folders" is a to-do, where the map
 * alone is just a picture.
 *
 * Selecting a cluster highlights it on the map and offers to move its
 * strays into the folder where most of the cluster already lives, via
 * the same preflighted move machinery the catalog uses.
 */

import * as React from "react";
import { createRoute, useNavigate } from "@tanstack/react-router";
import {
  Eye,
  FolderInput,
  Loader2,
  Network,
  RefreshCw,
  RotateCcw,
} from "lucide-react";

import type { GraphCluster, GraphSignal } from "@shared/types";

import { GraphCanvas } from "@renderer/components/graph/graph-canvas";
import { MoveDialog } from "@renderer/components/catalog/move-dialog";
import { RelatedRepos } from "@renderer/components/catalog/related-repos";
import { Button } from "@renderer/components/ui/button";
import { useGraph } from "@renderer/hooks/use-graph";
import { useRepos } from "@renderer/hooks/use-repos";
import { useSettings } from "@renderer/hooks/use-settings";
import { cn } from "@renderer/lib/cn";
import { UNGROUPED_CLUSTER_ID } from "@renderer/lib/graph-clusters";
import { countEdgesBySignal } from "@renderer/lib/graph-signals";
import { tildify } from "@renderer/lib/repo-tree";

import { Route as RootRoute } from "./__root";

/**
 * What the map's address says.
 *
 * The map has three pieces of state worth surviving a reload — which group is
 * open, which repo is selected, and which signals are switched off — and they
 * live in the URL rather than in `useState` for one reason: a refresh dropped
 * all three and put you back on the whole catalog, which on a 271-repo machine
 * is a long way from where you were. `#/graph?cluster=3&repo=slug` is also the
 * thing you can send to somebody.
 *
 * Signals are stored switched *off*, not on, so a signal added later is on by
 * default and an untouched map has no query string at all.
 */
export interface GraphSearch {
  /** Open group: a cluster id, or `ungrouped`. Absent means group level. */
  cluster?: number | "ungrouped";
  /** Selected repo. */
  repo?: string;
  /** Signals switched off, comma-joined. Absent means every signal is on. */
  off?: string;
}

/**
 * One search value as a string, however it arrived.
 *
 * Both spellings of the same address have to mean the same thing. A hand-typed
 * `#/graph?cluster=0` is JSON-parsed out of the query string into the *number* 0
 * (see the router's `parseSearch`), where a string is left alone; accepting
 * only one of them is what made a pasted address open the group map instead of
 * the group it named.
 */
function readParam(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * The address's cluster param, as the only two things it can mean.
 *
 * Normalised to a *number* rather than left as the string the query carried,
 * because the router writes a string back through `JSON.stringify` when the
 * text happens to parse as JSON — `"0"` came out as `cluster=%220%22`, and
 * every subsequent link inherited the quoting. A number is written bare.
 * A param that names no group is dropped here rather than carried.
 */
function readClusterParam(value: unknown): number | "ungrouped" | undefined {
  if (value === "ungrouped") return "ungrouped";
  const text = readParam(value);
  if (text === undefined) return undefined;
  const id = Number(text);
  return Number.isInteger(id) && id >= 0 ? id : undefined;
}

/**
 * Read the address, keeping only what this route understands.
 *
 * The top bar's search field writes `q` onto whatever route you are on, so the
 * params arrive alongside keys the map knows nothing about — those are dropped
 * here rather than carried around, and re-added by the router on the way out.
 */
function validateGraphSearch(search: Record<string, unknown>): GraphSearch {
  return {
    cluster: readClusterParam(search.cluster),
    repo: readParam(search.repo),
    off: readParam(search.off),
  };
}

/** The validated cluster param as a selection: a group id, or group level. */
function parseClusterParam(value: GraphSearch["cluster"]): number | null {
  if (value === undefined) return null;
  if (value === "ungrouped") return UNGROUPED_CLUSTER_ID;
  return value;
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/graph",
  validateSearch: validateGraphSearch,
  component: GraphPage,
});

const SIGNAL_LABELS: Record<GraphSignal, string> = {
  curated: "Curated",
  dependency: "Shared libraries",
  reference: "Links to",
  submodule: "Submodule",
  owner: "Same owner",
  naming: "Name family",
};

/**
 * Full wording for the toggle tooltips.
 *
 * The labels stay short so six of them fit one row inside the map's
 * inspector-width frame; the tooltip is where the signal gets a sentence.
 */
const SIGNAL_HINTS: Record<GraphSignal, string> = {
  curated: "Links a person asserted",
  dependency: "Repositories sharing a library",
  reference: "Repositories that link to each other",
  submodule: "Git submodule relationship",
  owner: "Same git remote owner",
  naming: "Similar repository names",
};

const ALL_SIGNALS = Object.keys(SIGNAL_LABELS) as GraphSignal[];

/** Strongest-N edges drawn in the all-repos overview. */
const OVERVIEW_EDGE_CAP = 320;

function GraphPage() {
  const graph = useGraph();
  /*
   * The move dialog's repo list, at the contract's page ceiling (see
   * `ListReposInputSchema`). The 500 this used to ask for was rejected before the
   * query ran, so the dialog listed no repos to move.
   */
  const reposQuery = useRepos({ limit: 200 });
  const settingsQuery = useSettings();

  /*
   * The map's view state, read from the address rather than held here. See
   * `GraphSearch`: a reload used to reset the group, the selected repo and
   * the signal filter together, and "where was I" is the whole question on a
   * catalog this size.
   */
  const search = Route.useSearch();
  const navigate = useNavigate();

  const selectedCluster = React.useMemo(
    () => parseClusterParam(search.cluster),
    [search.cluster],
  );
  const selectedSlug = search.repo ?? null;

  const enabled = React.useMemo(() => {
    const off = new Set(
      (search.off ?? "")
        .split(",")
        .filter((signal): signal is GraphSignal =>
          (ALL_SIGNALS as string[]).includes(signal),
        ),
    );
    return new Set(ALL_SIGNALS.filter((signal) => !off.has(signal)));
  }, [search.off]);

  /**
   * Write the map's address. The updater form is deliberate: the top bar's
   * search field writes `q` onto whichever route you are on, so a navigation
   * built from a snapshot of the query string would drop it.
   *
   * Opening a group or choosing a repo pushes an entry, so Back undoes it the
   * way a person expects; flipping a signal filter replaces the current one,
   * because six toggles you would never undo one at a time do not deserve six
   * history entries.
   */
  const setSearch = React.useCallback(
    (patch: GraphSearch, replace: boolean) => {
      void navigate({
        to: "/graph",
        replace,
        search: ((prev: Record<string, unknown>) => ({
          ...prev,
          ...patch,
        })) as unknown as never,
      });
    },
    [navigate],
  );

  /** Switch signals on and off, writing the *off* set to the address. */
  const setEnabled = React.useCallback(
    (next: Set<GraphSignal>) => {
      const off = ALL_SIGNALS.filter((signal) => !next.has(signal));
      setSearch({ off: off.length > 0 ? off.join(",") : undefined }, true);
    },
    [setSearch],
  );

  /** Open a group, or `null` for the group map. */
  const openCluster = React.useCallback(
    (clusterId: number | null) => {
      setSearch(
        {
          cluster:
            clusterId === null
              ? undefined
              : clusterId === UNGROUPED_CLUSTER_ID
                ? "ungrouped"
                : clusterId,
          repo: undefined,
        },
        false,
      );
    },
    [setSearch],
  );

  const setSelectedSlug = React.useCallback(
    (slug: string | null) => setSearch({ repo: slug ?? undefined }, false),
    [setSearch],
  );
  const [moveSlugs, setMoveSlugs] = React.useState<string[]>([]);
  const [moveTarget, setMoveTarget] = React.useState<string | null>(null);
  const [moveOpen, setMoveOpen] = React.useState(false);
  /*
   * ATR-069: cytoscape paints the map into untitled `<canvas>` elements, so
   * none of the nodes can be focused and the inspector could only describe the
   * node that was already selected. These back the keyboard path over the same
   * selection — one tab stop, arrows inside it (`role="listbox"` over the
   * nodes currently drawn).
   */
  const nodeOptionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [rovingIndex, setRovingIndex] = React.useState(0);

  const data = graph.data;

  /** Edges surviving the signal filter. */
  const edges = React.useMemo(() => {
    if (!data) return [];
    return data.edges.filter((edge) =>
      edge.signals.some((signal) => enabled.has(signal)),
    );
  }, [data, enabled]);

  /**
   * Links each signal would draw on its own, shown on the toggle so the
   * filter says what it is offering before you press it. Read from the
   * unfiltered edge set, so switching a signal off never zeroes its own
   * number.
   */
  const signalCounts = React.useMemo(
    () => countEdgesBySignal(data?.edges ?? [], ALL_SIGNALS),
    [data],
  );

  /**
   * Clusters worth acting on: more than one member, living in more than
   * one folder. Most scattered first — that's the biggest mess.
   */
  const scattered = React.useMemo<GraphCluster[]>(() => {
    if (!data) return [];
    return data.clusters
      .filter((c) => c.size >= 2 && c.folderSpread > 1)
      .sort(
        (a, b) =>
          b.strays.length - a.strays.length ||
          b.folderSpread - a.folderSpread ||
          b.size - a.size,
      );
  }, [data]);

  const highlight = React.useMemo(() => {
    if (selectedCluster === null) return new Set<string>();
    const cluster = data?.clusters.find((c) => c.id === selectedCluster);
    return new Set(cluster?.strays ?? []);
  }, [selectedCluster, data]);

  /**
   * Whether the map is showing groups rather than repos.
   *
   * Group level needs groups. A catalog whose repos relate to nothing has no
   * clusters, and one bubble called "Ungrouped" holding the entire library
   * would be a worse picture than the repos themselves — so the overview is
   * offered only when there is something to group by, and an unrelated
   * catalog opens exactly as it always did.
   */
  const atGroupLevel =
    selectedCluster === null && (data?.clusters.length ?? 0) > 0;

  /** Every repo named by a group of two or more. */
  const groupedSlugs = React.useMemo(
    () => new Set(data?.clusters.flatMap((cluster) => cluster.slugs) ?? []),
    [data],
  );

  /**
   * Repos in no group at all — related to nothing.
   *
   * Collected rather than dropped, so a map that claims to describe the
   * catalog cannot quietly lose the repos it found nothing to say about.
   */
  const ungroupedSlugs = React.useMemo(
    () =>
      (data?.nodes ?? [])
        .filter((node) => !groupedSlugs.has(node.slug))
        .map((node) => node.slug),
    [data, groupedSlugs],
  );

  /**
   * Group-level map data, or null while repos are drawn.
   *
   * Memoised because the canvas re-runs its layout whenever this identity
   * changes, so an object rebuilt on every render would re-arrange the map
   * while you were still looking at it.
   */
  const overview = React.useMemo(
    () =>
      atGroupLevel && data
        ? {
            clusters: data.clusters,
            // The uncapped set: the strongest-N cap exists to keep the flat
            // map readable and is meaningless once links are aggregated.
            edges,
            ungroupedSlugs,
            onSelectCluster: openCluster,
          }
        : null,
    [atGroupLevel, data, edges, ungroupedSlugs, openCluster],
  );

  /**
   * Repos in each group, off the group's own member list.
   *
   * The same source the bubbles are drawn from — `buildClusterOverview`
   * reads `cluster.slugs` too — so the bubble you clicked and the repos you
   * get cannot disagree about who is in the group. Filtering on each node's
   * own `cluster` field instead is what said "271 repos" when you opened a
   * group of 27.
   */
  const membersOf = React.useMemo(() => {
    const members = new Map<number, Set<string>>();
    for (const cluster of data?.clusters ?? []) {
      members.set(cluster.id, new Set(cluster.slugs));
    }
    return members;
  }, [data]);

  const visibleNodes = React.useMemo(() => {
    if (!data) return [];
    if (selectedCluster === null) return data.nodes;
    const members =
      selectedCluster === UNGROUPED_CLUSTER_ID
        ? new Set(ungroupedSlugs)
        : membersOf.get(selectedCluster);
    // An address naming a group that does not exist is not a place. Draw the
    // map rather than an empty canvas nobody can explain.
    if (!members) return data.nodes;
    return data.nodes.filter((node) => members.has(node.slug));
  }, [data, selectedCluster, membersOf, ungroupedSlugs]);

  /**
   * The group the map is inside, named.
   *
   * Read off the clusters rather than trusted from the address: an id alone is
   * not an answer to "where am I", and the header used to say only
   * "Relationships · 27 repos" whichever group you had opened.
   */
  const openGroup = React.useMemo(() => {
    if (selectedCluster === null) return null;
    if (selectedCluster === UNGROUPED_CLUSTER_ID) {
      return ungroupedSlugs.length > 0
        ? { id: selectedCluster, label: "Ungrouped" }
        : null;
    }
    const cluster = data?.clusters.find((c) => c.id === selectedCluster);
    return cluster ? { id: cluster.id, label: cluster.label } : null;
  }, [selectedCluster, data, ungroupedSlugs]);

  /**
   * Edges to draw.
   *
   * The overview caps to the strongest links. Drawing all ~1000 across
   * 263 nodes produces a hairball where no structure is visible — and
   * the weakest edges are exactly the incidental ones (a single shared
   * library) that carry the least meaning. Inside a single cluster
   * everything is drawn, because there the detail is the point.
   */
  const visibleEdges = React.useMemo(() => {
    if (selectedCluster !== null) {
      const slugs = new Set(visibleNodes.map((n) => n.slug));
      return edges.filter((e) => slugs.has(e.source) && slugs.has(e.target));
    }
    return edges.slice(0, OVERVIEW_EDGE_CAP);
  }, [edges, selectedCluster, visibleNodes]);

  /**
   * The catalog has links, but the switched-on signals draw none. Kept
   * apart from "this catalog has no links at all", because only the
   * first case has a way back that means anything.
   */
  const filteredToNothing =
    (data?.edges.length ?? 0) > 0 && edges.length === 0;

  const selectedNode = data?.nodes.find((n) => n.slug === selectedSlug) ?? null;
  const selectedEdges = React.useMemo(() => {
    if (!selectedSlug) return [];
    return edges
      .filter((e) => e.source === selectedSlug || e.target === selectedSlug)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8);
  }, [edges, selectedSlug]);

  const nameOf = (slug: string) =>
    data?.nodes.find((n) => n.slug === slug)?.name ?? slug;

  /**
   * The keyboard path over whatever the map is currently drawing: the groups
   * at group level, the repos once one has been opened.
   *
   * It follows the map deliberately. The list is the only path onto the canvas
   * for a keyboard — cytoscape paints into untitled `<canvas>` elements and
   * nothing on it can take focus — so a list describing something other than
   * what is drawn would describe a picture that is not on screen.
   */
  const railItems = React.useMemo<
    Array<{
      key: string;
      label: string;
      meta: string;
      selected: boolean;
      pick: () => void;
    }>
  >(() => {
    if (!atGroupLevel) {
      return visibleNodes.map((node) => ({
        key: node.slug,
        label: node.name,
        meta: `${node.degree}`,
        selected: node.slug === selectedSlug,
        pick: () => setSelectedSlug(node.slug),
      }));
    }
    const items = (data?.clusters ?? []).map((cluster) => ({
      key: `c${cluster.id}`,
      label: cluster.label,
      meta: `${cluster.size}`,
      selected: false,
      pick: () => openCluster(cluster.id),
    }));
    if (ungroupedSlugs.length > 0) {
      items.push({
        key: "ungrouped",
        label: "Ungrouped",
        meta: `${ungroupedSlugs.length}`,
        selected: false,
        pick: () => openCluster(UNGROUPED_CLUSTER_ID),
      });
    }
    return items;
  }, [atGroupLevel, data, ungroupedSlugs, visibleNodes, selectedSlug, openCluster]);

  /**
   * Where the list's single tab stop sits. Clamped rather than trusted: the
   * list shrinks when a group is opened or the filter changes, and an index
   * past the end would leave it with nothing tabbable at all.
   */
  const rovingOption =
    railItems.length === 0 ? -1 : Math.min(rovingIndex, railItems.length - 1);

  /*
   * Follow the map: selecting a node on it (or in the link list below) moves
   * the tab stop to match. Focus is never taken — only which option is
   * tabbable — so this cannot fight the mouse.
   */
  React.useEffect(() => {
    const index = railItems.findIndex((item) => item.selected);
    if (index >= 0) setRovingIndex(index);
  }, [railItems]);

  /** Move the tab stop, focus it, and pick — the keyboard's tap. */
  const selectRailItem = (index: number) => {
    const item = railItems[index];
    if (!item) return;
    setRovingIndex(index);
    item.pick();
    /*
     * Focus now, and again after the commit only if focus was lost.
     *
     * Moving through the repo list keeps the option that was pressed on
     * screen — only which one is *selected* changes — so the cursor belongs on
     * it in this frame. Deferring the focus to the next one cost the keyboard
     * its cursor for that frame, which is long enough for a test to look and
     * find `document.activeElement` somewhere else.
     *
     * Opening a group does replace the list, so the element just focused is
     * removed from the document, focus falls back to `<body>`, and the tab
     * stop would be nowhere at all. That is the case the second attempt is
     * for — and it only fires when focus was actually dropped, so it can
     * never steal it back from wherever a person has since put it.
     */
    nodeOptionRefs.current[index]?.focus();
    window.requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      nodeOptionRefs.current[index]?.focus();
    });
  };

  const handleRailKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = railItems.length - 1;
    let target: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      target = index >= last ? 0 : index + 1;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      target = index <= 0 ? last : index - 1;
    } else if (event.key === "Home") {
      target = 0;
    } else if (event.key === "End") {
      target = last;
    }
    if (target === null || target < 0) return;
    event.preventDefault();
    selectRailItem(target);
  };

  /*
   * `h-full`, not a viewport sum: this route is in the shell's full-height
   * set (`__root.tsx`), so the parent already decided the height. It used to
   * size itself `calc(100dvh - 3rem)` — the top bar's 48px — which is exactly
   * the arithmetic that made it 64px taller than the window, because the
   * route was in fact rendering inside `SimpleShell`'s 32px of vertical
   * padding on top (ATR-062).
   *
   * Above the `return`, not inside it. JSX children are verbatim text, so a
   * comment written without braces is how code-looking prose ends up on screen
   * — and, as a text child of this flex column, it is also an anonymous flex
   * item that takes its own height out of the map's box. Two guards hold this:
   * `tests/unit/renderer/jsx-text.spec.ts` fails on the comment forms that
   * render, and `layout-overflow.spec.ts` asserts the shell holds only elements
   * before it measures a height.
   */
  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          Two rows, not one. The map lives in the max-w-5xl shell beside a
          320px inspector, so this header has roughly 640px to work with:
          six labelled filters plus the count and the actions do not fit on
          a single line, and the old one-row header clipped its own right
          edge. Row one is the map's identity and actions; row two is the
          filter strip, which gets the full width.
        */}
        <div className="shrink-0 border-b border-border">
          <div className="flex h-11 items-center gap-3 px-4">
            <Network className="h-4 w-4 shrink-0 text-accent" aria-hidden />
            <h1 className="atr-label font-mono uppercase tracking-wider text-muted-foreground">
              Relationships
            </h1>

            {/*
              Where am I. Opening a group used to leave the header reading
              "Relationships" and a repo count, which is how you end up on a
              screenful of dots with no idea which group you are inside or how
              to leave it. The trail names the group and offers the way back.
            */}
            {openGroup ? (
              <nav
                aria-label="Map location"
                className="flex min-w-0 items-center gap-1.5"
              >
                <button
                  type="button"
                  onClick={() => openCluster(null)}
                  className="atr-label cursor-pointer font-mono uppercase tracking-wider text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline"
                >
                  Groups
                </button>
                <span aria-hidden className="atr-label text-muted-foreground">
                  /
                </span>
                <span className="atr-truncate font-mono atr-label text-foreground">
                  {openGroup.label}
                </span>
                <span className="atr-meta shrink-0 tabular-nums">
                  {visibleNodes.length}{" "}
                  {visibleNodes.length === 1 ? "repo" : "repos"}
                </span>
              </nav>
            ) : null}

            <div className="ml-auto flex items-center gap-2">
              {selectedCluster !== null ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openCluster(null)}
                  title="Back to the group map"
                >
                  <Eye aria-hidden />
                  {(data?.clusters.length ?? 0) > 0
                    ? "All groups"
                    : "Show everything"}
                </Button>
              ) : null}
              <span className="atr-meta tabular-nums">
                {atGroupLevel
                  ? `${data?.clusters.length ?? 0} groups · ${
                      data?.nodes.length ?? 0
                    } repos · ${edges.length} links`
                  : `${visibleNodes.length} repos · ${
                      selectedCluster === null &&
                      edges.length > OVERVIEW_EDGE_CAP
                        ? `strongest ${visibleEdges.length} of ${edges.length} links`
                        : `${visibleEdges.length} links`
                    }`}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void graph.refetch()}
                disabled={graph.isFetching}
                aria-label="Recompute the graph"
                title="Recompute the graph"
                className="disabled:cursor-wait"
              >
                <RefreshCw
                  className={cn(graph.isFetching && "animate-spin")}
                  aria-hidden
                />
              </Button>
            </div>
          </div>

          <div className="flex min-w-0 items-center px-4 pb-2">
            <div
              role="group"
              aria-label="Relationship signals"
              className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-md bg-muted p-0.5"
            >
              {ALL_SIGNALS.map((signal) => {
                const active = enabled.has(signal);
                const count = signalCounts[signal];
                return (
                  <button
                    key={signal}
                    type="button"
                    className="atr-segment"
                    data-active={active ? "true" : "false"}
                    aria-pressed={active}
                    title={`${SIGNAL_HINTS[signal]} · ${count} ${
                      count === 1 ? "link" : "links"
                    }`}
                    onClick={() => {
                      const next = new Set(enabled);
                      if (next.has(signal)) next.delete(signal);
                      else next.add(signal);
                      setEnabled(next);
                    }}
                  >
                    <span>{SIGNAL_LABELS[signal]}</span>
                    <span className="atr-micro font-mono tabular-nums text-muted-foreground">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {graph.isPending ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Reading every project&apos;s dependencies…
            </div>
          ) : graph.isError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="max-w-md text-sm text-destructive">
                {(graph.error as Error).message}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void graph.refetch()}
                disabled={graph.isFetching}
              >
                <RotateCcw aria-hidden />
                Try again
              </Button>
            </div>
          ) : filteredToNothing ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="max-w-sm text-sm text-muted-foreground">
                No links carry the signals you have switched on.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEnabled(new Set(ALL_SIGNALS))}
              >
                <RotateCcw aria-hidden />
                Switch every signal back on
              </Button>
            </div>
          ) : (
            <GraphCanvas
              nodes={visibleNodes}
              edges={visibleEdges}
              selectedSlug={selectedSlug}
              highlightSlugs={highlight}
              onSelect={setSelectedSlug}
              onOpen={(slug) => setSelectedSlug(slug)}
              overview={overview}
            />
          )}
        </div>
      </div>

      <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-surface">
        {/*
          The keyboard equivalent of tapping a dot. Kept above the selection
          detail so it is there in the default state, when nothing is selected
          and there is otherwise no way to select anything.
        */}
        <section className="border-b border-border p-4">
          <h2 className="atr-label font-mono font-medium uppercase tracking-wider text-muted-foreground">
            {atGroupLevel ? "Groups" : "Repositories"}
          </h2>
          <p className="atr-label mt-1 leading-snug text-muted-foreground">
            {atGroupLevel
              ? "The map opens on groups — repos that belong together. It is painted on a canvas, so nothing on it can take focus: open a group from this list instead and the map follows. Arrow keys move, Enter or Space opens."
              : "The map is painted on a canvas, so no dot on it can take focus. Pick one here instead — arrow keys move through the list, and Enter or Space selects the same node."}
          </p>

          <div
            role="listbox"
            aria-label={
              atGroupLevel ? "Groups on the map" : "Repositories on the map"
            }
            className="mt-3 flex max-h-64 flex-col gap-0.5 overflow-y-auto"
          >
            {railItems.map((item, index) => (
              <button
                key={item.key}
                type="button"
                role="option"
                aria-selected={item.selected}
                tabIndex={index === rovingOption ? 0 : -1}
                ref={(element) => {
                  nodeOptionRefs.current[index] = element;
                }}
                onKeyDown={(event) => handleRailKeyDown(event, index)}
                onClick={() => selectRailItem(index)}
                className="atr-rail-row px-2 py-1"
              >
                <span className="atr-truncate font-mono atr-label text-foreground">
                  {item.label}
                </span>
                <span className="atr-meta ml-auto shrink-0 tabular-nums">
                  {item.meta}
                </span>
              </button>
            ))}
          </div>

          {railItems.length === 0 ? (
            <p className="atr-label mt-2 text-muted-foreground">
              {graph.isPending
                ? "Reading the catalog…"
                : atGroupLevel
                  ? "No groups to show."
                  : "No repositories to show."}
            </p>
          ) : null}
        </section>

        {selectedNode ? (
          <section className="border-b border-border p-4">
            <h2 className="font-mono text-sm font-semibold text-foreground">
              {selectedNode.name}
            </h2>
            <p className="atr-meta mt-0.5">{tildify(selectedNode.folder)}</p>
            <p className="atr-label mt-2 font-mono uppercase tracking-wider text-muted-foreground">
              Strongest links
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {selectedEdges.length === 0 ? (
                <li className="atr-label text-muted-foreground">
                  Nothing connects to this one.
                </li>
              ) : (
                selectedEdges.map((edge) => {
                  const other =
                    edge.source === selectedSlug ? edge.target : edge.source;
                  return (
                    <li key={`${edge.source}-${edge.target}`}>
                      <button
                        type="button"
                        onClick={() => setSelectedSlug(other)}
                        className="w-full cursor-pointer rounded px-1 py-0.5 text-left transition-colors duration-150 hover:bg-surface-raised"
                      >
                        <span className="atr-truncate block font-mono atr-label text-foreground">
                          {nameOf(other)}
                        </span>
                        {edge.curated?.length ? (
                          <span className="atr-truncate block atr-label text-accent">
                            {edge.curated
                              .map((c) =>
                                c.from === selectedSlug
                                  ? `${c.kind} → ${nameOf(c.to)}`
                                  : `${nameOf(c.from)} ${c.kind} → this`,
                              )
                              .join(", ")}
                          </span>
                        ) : null}
                        <span className="atr-truncate block atr-label text-muted-foreground">
                          {edge.why.join(", ") || edge.signals.join(", ")}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </section>
        ) : null}

        {selectedNode ? (
          <section className="border-b border-border p-4">
            <RelatedRepos
              slug={selectedNode.slug}
              repoName={selectedNode.name}
              onOpenRepo={setSelectedSlug}
              title="Curated links"
            />
          </section>
        ) : null}

        <section className="p-4">
          <h2 className="atr-label font-mono font-medium uppercase tracking-wider text-muted-foreground">
            Scattered clusters
          </h2>
          <p className="atr-label mt-1 leading-snug text-muted-foreground">
            Groups whose members are related but live in different folders. The
            number is how many sit outside the group&apos;s main home.
          </p>

          <ul className="mt-3 flex flex-col gap-1">
            {scattered.length === 0 ? (
              <li className="atr-label text-muted-foreground">
                {graph.isPending ? "…" : "Nothing scattered — tidy machine."}
              </li>
            ) : (
              scattered.map((cluster) => (
                <li key={cluster.id}>
                  <button
                    type="button"
                    onClick={() =>
                      openCluster(
                        selectedCluster === cluster.id ? null : cluster.id,
                      )
                    }
                    data-selected={
                      selectedCluster === cluster.id ? "true" : "false"
                    }
                    className="atr-rail-row flex-col items-start gap-0.5 px-2 py-1.5"
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <span className="atr-truncate font-mono atr-label text-foreground">
                        {cluster.label}
                      </span>
                      <span className="atr-micro ml-auto shrink-0 rounded bg-warning/15 px-1 font-mono text-warning">
                        {cluster.strays.length}
                      </span>
                    </span>
                    <span className="atr-meta">
                      {cluster.size} repos · {cluster.folderSpread} folders
                    </span>
                  </button>

                  {selectedCluster === cluster.id ? (
                    <div className="mb-2 mt-1 flex flex-col gap-1 rounded-md border border-border bg-card p-2">
                      <p className="atr-meta">
                        Mostly in {tildify(cluster.dominantFolder)}
                      </p>
                      <ul className="flex flex-col gap-0.5">
                        {cluster.strays.slice(0, 8).map((slug) => (
                          <li
                            key={slug}
                            className="atr-truncate font-mono atr-label text-muted-foreground"
                          >
                            {nameOf(slug)}
                          </li>
                        ))}
                      </ul>
                      <Button
                        size="sm"
                        className="mt-1 w-full"
                        onClick={() => {
                          setMoveSlugs(cluster.strays);
                          setMoveTarget(cluster.dominantFolder);
                          setMoveOpen(true);
                        }}
                      >
                        <FolderInput aria-hidden />
                        Gather the {cluster.strays.length} strays
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </section>
      </aside>

      <MoveDialog
        open={moveOpen}
        onOpenChange={(open) => {
          setMoveOpen(open);
          if (!open) setMoveSlugs([]);
        }}
        slugs={moveSlugs}
        repos={reposQuery.data?.items ?? []}
        scanPaths={settingsQuery.data?.scanPaths ?? []}
        initialTarget={moveTarget}
        onMoved={() => void graph.refetch()}
      />
    </div>
  );
}
