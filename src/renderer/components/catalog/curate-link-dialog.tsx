/**
 * Curate link dialog — assert a relationship without leaving the catalog.
 *
 * Before this, the only writer of `repo_links` was an MCP session, so the
 * map could only grow from outside the app. This asks for the same three
 * things the MCP's `link` tool asks for — which repo, how they relate, and
 * why — and writes the same row, stamped `source: "ui"`.
 *
 * `why` is required here for the same reason it is required there: a
 * curated link outranks every derived signal on the map (`services/
 * graph.ts` weights it highest), so an unexplained one is worse than no
 * link at all.
 */

import * as React from "react";
import { Check, Link2, Loader2 } from "lucide-react";

import type { RepoLinkKind } from "@shared/types";

import { cn } from "@renderer/lib/cn";
import { ipcErrorText } from "@renderer/lib/ipc-error";
import {
  LINK_KINDS,
  LINK_KIND_LABELS,
  linkSentence,
} from "@renderer/lib/repo-links";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { useAssertRepoLink } from "@renderer/hooks/use-graph";
import { useSearch } from "@renderer/hooks/use-search";

interface CurateLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The repo the assertion is made *from* — the one on screen. */
  fromSlug: string;
  fromName: string;
  /** Slugs this repo already links to, so the picker can say so. */
  linkedSlugs: readonly string[];
}

/**
 * The form is mounted only while the dialog is open, which is what keeps
 * a reopened dialog honest: every field, the chosen target and any error
 * from a previous attempt are discarded together, so nothing can be
 * asserted about a repository the user is no longer looking at.
 */
export function CurateLinkDialog({
  open,
  onOpenChange,
  fromSlug,
  fromName,
  linkedSlugs,
}: CurateLinkDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {open ? (
          <CurateLinkForm
            onClose={() => onOpenChange(false)}
            fromSlug={fromSlug}
            fromName={fromName}
            linkedSlugs={linkedSlugs}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CurateLinkForm({
  onClose,
  fromSlug,
  fromName,
  linkedSlugs,
}: {
  onClose: () => void;
  fromSlug: string;
  fromName: string;
  linkedSlugs: readonly string[];
}) {
  const [q, setQ] = React.useState("");
  const [target, setTarget] = React.useState<{
    slug: string;
    name: string;
  } | null>(null);
  const [kind, setKind] = React.useState<RepoLinkKind>("part-of");
  const [why, setWhy] = React.useState("");
  const assert = useAssertRepoLink();

  const linked = React.useMemo(() => new Set(linkedSlugs), [linkedSlugs]);
  const search = useSearch(q, { limit: 8 });
  const hits = (search.data ?? []).filter((hit) => hit.repo.slug !== fromSlug);
  const typed = q.trim().length > 0;

  const sentence = target
    ? linkSentence({
        kind,
        direction: "outgoing",
        selfName: fromName,
        otherName: target.name,
      })
    : null;

  const ready = Boolean(target) && why.trim().length > 0;

  const handleAssert = async () => {
    if (!target || !ready) return;
    try {
      await assert.mutateAsync({
        fromSlug,
        toSlug: target.slug,
        kind,
        why: why.trim(),
      });
      onClose();
    } catch {
      // Deliberately left open: `assert.error` renders below, and the
      // typed reason survives so it can be retried without retyping.
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Link2 className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span className="truncate">Relate {fromName} to another repo</span>
        </DialogTitle>
        <DialogDescription>
          Written to the same table the MCP writes, so it appears here and on
          the map.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="curate-link-search"
            className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            Which repository
          </label>
          <Input
            id="curate-link-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, path or description…"
            spellCheck={false}
            autoFocus
            className="h-8"
          />
          <div className="max-h-44 overflow-y-auto rounded-md border border-border/60">
            {!typed ? (
              <p className="p-3 text-[11px] text-muted-foreground">
                Type to search the catalog.
              </p>
            ) : search.isFetching && hits.length === 0 ? (
              <p className="flex items-center gap-2 p-3 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Searching…
              </p>
            ) : hits.length === 0 ? (
              <p className="p-3 text-[11px] text-muted-foreground">
                Nothing in the catalog matches that.
              </p>
            ) : (
              <ul>
                {hits.map((hit) => {
                  const isTarget = target?.slug === hit.repo.slug;
                  return (
                    <li key={hit.repo.slug}>
                      <button
                        type="button"
                        onClick={() =>
                          setTarget({
                            slug: hit.repo.slug,
                            name: hit.repo.name,
                          })
                        }
                        aria-pressed={isTarget}
                        className={cn(
                          "flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors duration-150",
                          isTarget ? "bg-secondary" : "hover:bg-muted/50",
                        )}
                      >
                        <Check
                          className={cn(
                            "h-3 w-3 shrink-0 text-accent",
                            !isTarget && "invisible",
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[11px] text-foreground">
                            {hit.repo.name}
                          </span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {hit.repo.fullPath}
                          </span>
                        </span>
                        {linked.has(hit.repo.slug) ? (
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            already linked
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            How they relate
          </span>
          <div className="flex flex-wrap gap-1.5">
            {LINK_KINDS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                aria-pressed={kind === option}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] transition-colors duration-150",
                  kind === option
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
                )}
              >
                {LINK_KIND_LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="curate-link-why"
            className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            Why
          </label>
          <Input
            id="curate-link-why"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAssert();
            }}
            placeholder="What makes these two related?"
            maxLength={500}
            spellCheck={false}
            className="h-8"
          />
          <p className="min-h-4 font-mono text-[10px] text-muted-foreground">
            {sentence
              ? `${sentence}${why.trim() ? ` — ${why.trim()}` : ""}`
              : "Pick a repository to see the assertion."}
          </p>
        </div>

        {assert.error ? (
          <p role="alert" className="text-[11px] text-destructive">
            {ipcErrorText(assert.error)}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleAssert} disabled={!ready || assert.isPending}>
          {assert.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : null}
          Assert link
        </Button>
      </div>
    </>
  );
}
