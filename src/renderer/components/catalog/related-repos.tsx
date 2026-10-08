/**
 * Curated links touching one repo, every row a hop to the other end.
 *
 * One implementation, two hosts: the catalog's detail panel and the
 * `/graph` map's inspector. Both ask the same question — what is this
 * repo linked to, and how do I change it — and both read and write the
 * same `repo_links` rows, so they share the widget rather than each
 * growing a copy of the sentence builder and the removal call.
 *
 * This is the app's window onto `repo_links`: the table the MCP and the
 * UI both write. The whole point of asserting a relationship is to act on
 * it, and the only action either surface offers is "open that one
 * instead", hence buttons rather than a read-only list. Empty is the
 * common case, so the empty state says how to fill it rather than
 * disappearing.
 */

import * as React from "react";
import { AlertTriangle, Link2, X } from "lucide-react";

import type { RemoveRepoLinkInput, RepoRelation } from "@shared/types";

import { getAtr } from "@renderer/lib/atr";
import { ipcErrorText } from "@renderer/lib/ipc-error";
import { LINK_KIND_LABELS, linkSentence } from "@renderer/lib/repo-links";
import { Button } from "@renderer/components/ui/button";
import {
  useRemoveRepoLink,
  useRepoRelations,
} from "@renderer/hooks/use-graph";

import { CurateLinkDialog } from "./curate-link-dialog";

interface RelatedReposProps {
  slug: string;
  repoName: string;
  /** Hop to the other end. Omitted by surfaces that cannot open a repo. */
  onOpenRepo?: (slug: string) => void;
  /**
   * Section heading. The map calls the same list "Curated links", because
   * there it sits next to derived ones and the distinction matters.
   */
  title?: string;
}

/**
 * Which end of a link this repo is on, restated as (from, to).
 *
 * `direction` *is* that fact, so removal never has to guess: an incoming
 * row is one the other repository asserted about this one.
 */
function linkEnds(rel: RepoRelation, selfSlug: string): RemoveRepoLinkInput {
  return rel.direction === "outgoing"
    ? { fromSlug: selfSlug, toSlug: rel.slug, kind: rel.kind }
    : { fromSlug: rel.slug, toSlug: selfSlug, kind: rel.kind };
}

export function RelatedRepos({
  slug,
  repoName,
  onOpenRepo,
  title = "Related",
}: RelatedReposProps) {
  const relations = useRepoRelations(slug);
  const items = relations.data?.relations ?? [];
  const remove = useRemoveRepoLink();
  const [curating, setCurating] = React.useState(false);
  // Curating needs the bridge. In a browser-only QE run the list stays
  // readable and the controls simply are not offered.
  const canWrite = React.useMemo(() => Boolean(getAtr()), []);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="atr-label font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </p>
        {canWrite ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCurating(true)}
            className="h-6 px-1.5 atr-label uppercase tracking-widest"
            aria-label={`Assert a relationship for ${repoName}`}
          >
            <Link2 className="h-3 w-3" aria-hidden />
            Add
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="atr-label leading-snug text-muted-foreground">
          {relations.isPending
            ? "Loading…"
            : "No curated links yet. Add one here, or from a Claude Code session with the alltherepos MCP."}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {items.map((rel) => {
            const sentence = linkSentence({
              kind: rel.kind,
              direction: rel.direction,
              selfName: repoName,
              otherName: rel.name,
            });
            return (
              <li
                key={`${rel.direction}-${rel.kind}-${rel.slug}`}
                className="group flex items-start gap-1 rounded-sm px-1 py-0.5 transition-colors duration-150 hover:bg-muted/50"
              >
                <button
                  type="button"
                  disabled={!onOpenRepo}
                  onClick={() => onOpenRepo?.(rel.slug)}
                  aria-label={`Open ${rel.name} — ${sentence}`}
                  title={rel.why ? `${sentence} — ${rel.why}` : sentence}
                  className="flex min-w-0 flex-1 items-start gap-1.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                >
                  <span
                    aria-hidden
                    className="font-mono atr-micro text-accent"
                  >
                    {rel.direction === "outgoing" ? "→" : "←"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono atr-label text-foreground group-hover:text-accent">
                      {rel.name}
                    </span>
                    <span className="block truncate atr-label text-muted-foreground">
                      {LINK_KIND_LABELS[rel.kind]}
                      {rel.why ? ` — ${rel.why}` : ""}
                    </span>
                  </span>
                </button>

                {canWrite ? (
                  <button
                    type="button"
                    onClick={() => remove.mutate(linkEnds(rel, slug))}
                    disabled={remove.isPending}
                    aria-label={`Remove link — ${sentence}`}
                    title={`Remove link — ${sentence}`}
                    className="mt-0.5 shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 disabled:opacity-40"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {remove.error ? (
        <p
          role="alert"
          className="mt-1.5 flex items-start gap-1 atr-label text-destructive"
        >
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
          {ipcErrorText(remove.error)}
        </p>
      ) : null}

      {canWrite ? (
        <CurateLinkDialog
          open={curating}
          onOpenChange={setCurating}
          fromSlug={slug}
          fromName={repoName}
          linkedSlugs={items.map((rel) => rel.slug)}
        />
      ) : null}
    </div>
  );
}
