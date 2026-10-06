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
import { createRoute } from "@tanstack/react-router";
import { FolderInput, Loader2, Network, RefreshCw } from "lucide-react";

import type { GraphCluster, GraphSignal } from "@shared/types";

import { GraphCanvas } from "@renderer/components/graph/graph-canvas";
import { MoveDialog } from "@renderer/components/catalog/move-dialog";
import { RelatedRepos } from "@renderer/components/catalog/related-repos";
import { useGraph } from "@renderer/hooks/use-graph";
import { useRepos } from "@renderer/hooks/use-repos";
import { useSettings } from "@renderer/hooks/use-settings";
import { cn } from "@renderer/lib/cn";
import { tildify } from "@renderer/lib/repo-tree";

import { Route as RootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/graph",
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

const ALL_SIGNALS = Object.keys(SIGNAL_LABELS) as GraphSignal[];

/** Strongest-N edges drawn in the all-repos overview. */
const OVERVIEW_EDGE_CAP = 320;

function GraphPage() {
  const graph = useGraph();
  const reposQuery = useRepos({ limit: 500 });
  const settingsQuery = useSettings();

  const [enabled, setEnabled] = React.useState<Set<GraphSignal>>(
    () => new Set(ALL_SIGNALS),
  );
  const [selectedSlug, setSelectedSlug] = React.useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = React.useState<number | null>(
    null,
  );
  const [moveSlugs, setMoveSlugs] = React.useState<string[]>([]);
  const [moveTarget, setMoveTarget] = React.useState<string | null>(null);
  const [moveOpen, setMoveOpen] = React.useState(false);

  const data = graph.data;

  /** Edges surviving the signal filter. */
  const edges = React.useMemo(() => {
    if (!data) return [];
    return data.edges.filter((edge) =>
      edge.signals.some((signal) => enabled.has(signal)),
    );
  }, [data, enabled]);

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

  const visibleNodes = React.useMemo(() => {
    if (!data) return [];
    if (selectedCluster === null) return data.nodes;
    return data.nodes.filter((n) => n.cluster === selectedCluster);
  }, [data, selectedCluster]);

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

  return (
    <div className="flex h-[calc(100dvh-3rem)] w-full overflow-hidden bg-background">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-4">
          <Network className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Relationships
          </span>

          <div className="flex items-center gap-1">
            {ALL_SIGNALS.map((signal) => (
              <button
                key={signal}
                type="button"
                className="atr-segment"
                data-active={enabled.has(signal) ? "true" : "false"}
                aria-pressed={enabled.has(signal)}
                onClick={() =>
                  setEnabled((prev) => {
                    const next = new Set(prev);
                    if (next.has(signal)) next.delete(signal);
                    else next.add(signal);
                    return next;
                  })
                }
              >
                {SIGNAL_LABELS[signal]}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {selectedCluster !== null ? (
              <button
                type="button"
                onClick={() => setSelectedCluster(null)}
                className="atr-segment"
              >
                Show everything
              </button>
            ) : null}
            <span className="atr-meta tabular-nums">
              {visibleNodes.length} repos ·{" "}
              {selectedCluster === null && edges.length > OVERVIEW_EDGE_CAP
                ? `strongest ${visibleEdges.length} of ${edges.length} links`
                : `${visibleEdges.length} links`}
            </span>
            <button
              type="button"
              onClick={() => void graph.refetch()}
              disabled={graph.isFetching}
              className="atr-segment disabled:cursor-wait"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5",
                  graph.isFetching && "animate-spin",
                )}
                aria-hidden
              />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {graph.isPending ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Reading every project&apos;s dependencies…
            </div>
          ) : graph.isError ? (
            <div className="flex h-full items-center justify-center text-sm text-destructive">
              {(graph.error as Error).message}
            </div>
          ) : (
            <GraphCanvas
              nodes={visibleNodes}
              edges={visibleEdges}
              selectedSlug={selectedSlug}
              highlightSlugs={highlight}
              onSelect={setSelectedSlug}
              onOpen={(slug) => setSelectedSlug(slug)}
            />
          )}
        </div>
      </div>

      <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-surface">
        {selectedNode ? (
          <section className="border-b border-border p-4">
            <h2 className="font-mono text-sm font-semibold text-foreground">
              {selectedNode.name}
            </h2>
            <p className="atr-meta mt-0.5">{tildify(selectedNode.folder)}</p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Strongest links
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {selectedEdges.length === 0 ? (
                <li className="text-[11px] text-muted-foreground">
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
                        <span className="atr-truncate block font-mono text-[11px] text-foreground">
                          {nameOf(other)}
                        </span>
                        {edge.curated?.length ? (
                          <span className="atr-truncate block text-[10px] text-accent">
                            {edge.curated
                              .map((c) =>
                                c.from === selectedSlug
                                  ? `${c.kind} → ${nameOf(c.to)}`
                                  : `${nameOf(c.from)} ${c.kind} → this`,
                              )
                              .join(", ")}
                          </span>
                        ) : null}
                        <span className="atr-truncate block text-[10px] text-muted-foreground">
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
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Scattered clusters
          </h2>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Groups whose members are related but live in different folders. The
            number is how many sit outside the group&apos;s main home.
          </p>

          <ul className="mt-3 flex flex-col gap-1">
            {scattered.length === 0 ? (
              <li className="text-[11px] text-muted-foreground">
                {graph.isPending ? "…" : "Nothing scattered — tidy machine."}
              </li>
            ) : (
              scattered.map((cluster) => (
                <li key={cluster.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedCluster(
                        selectedCluster === cluster.id ? null : cluster.id,
                      )
                    }
                    data-selected={
                      selectedCluster === cluster.id ? "true" : "false"
                    }
                    className="atr-rail-row flex-col items-start gap-0.5 px-2 py-1.5"
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <span className="atr-truncate font-mono text-[11px] text-foreground">
                        {cluster.label}
                      </span>
                      <span className="ml-auto shrink-0 rounded bg-warning/15 px-1 font-mono text-[10px] text-warning">
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
                            className="atr-truncate font-mono text-[10px] text-muted-foreground"
                          >
                            {nameOf(slug)}
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        onClick={() => {
                          setMoveSlugs(cluster.strays);
                          setMoveTarget(cluster.dominantFolder);
                          setMoveOpen(true);
                        }}
                        className="mt-1 flex cursor-pointer items-center justify-center gap-1.5 rounded bg-accent px-2 py-1 text-[11px] font-medium text-accent-foreground transition-opacity duration-150 hover:opacity-90"
                      >
                        <FolderInput className="h-3 w-3" aria-hidden />
                        Gather the {cluster.strays.length} strays
                      </button>
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
