/**
 * View dispatcher — renders the current density mode, with grouping.
 *
 * Grouping is applied here rather than inside each view so the three
 * modes can never disagree about which repos belong to which bucket, and
 * so a new grouping axis is one function rather than three.
 *
 * Section headers are sticky: when you're 400 rows into a folder-grouped
 * catalog, "which folder am I looking at" has to stay answerable.
 *
 * The index is one column, not a grid.
 *
 * The handoff's index lays entries out in `auto-fill` columns, and at 1440 a
 * group of one left two empty columns and a group of two left one — a page of
 * holes whose width depended on how many repos happened to be in a folder.
 * Worse, a 280px column truncated every description after about thirty
 * characters, so the one line that says what a project IS read as a fragment.
 * An index is a list: one full-width row per repo, grouped by section, so the
 * rows share a left edge and the width goes to the description instead of to
 * empty cells.
 */

import * as React from "react";
import { FolderSearch } from "lucide-react";

import type { Repo } from "@shared/types";

import { Skeleton } from "@renderer/components/ui/skeleton";
import { cn } from "@renderer/lib/cn";
import {
  ACTIVITY_LABELS,
  ACTIVITY_ORDER,
  activityOf,
  lastTouched,
  type ActivityLevel,
} from "@renderer/lib/activity";
import {
  OWNERSHIP_LABELS,
  OWNERSHIP_ORDER,
  type Ownership,
  type OwnershipInfo,
} from "@renderer/lib/ownership";
import { useCatalogView, type GroupBy } from "@renderer/stores/catalog-view";

import { RepoIndexEntry } from "./repo-index-entry";
import { POSTER_ITEM, RepoPoster } from "./repo-poster";
import { RepoTable } from "./repo-table";

export interface RepoGridProps {
  repos: Repo[];
  ownershipFor: (repo: Repo) => OwnershipInfo;
  folderLabelFor: (repo: Repo) => string;
  /** Stable, unambiguous grouping key (the absolute directory). */
  folderKeyFor?: (repo: Repo) => string;
  selectedSlug: string | null;
  checkedSlugs: ReadonlySet<string>;
  onSelect: (slug: string) => void;
  onToggleChecked: (slug: string, additive: boolean) => void;
  onOpenEditor: (slug: string) => void;
  loading?: boolean;
  /** Rendered when nothing matches — worded by the caller. */
  emptyTitle?: string;
  emptyHint?: string;
  /**
   * The repos closest to a search that matched nothing, above the recovery
   * controls. A slot for the same reason as {@link RepoGridProps.emptyAction}:
   * the words are the caller's, and this view stays ignorant of what a
   * suggestion is derived from or what picking one does.
   */
  emptySuggestion?: React.ReactNode;
  /**
   * Recovery controls under the hint. A slot rather than a prop per button,
   * so this view keeps knowing nothing about filters and the caller keeps
   * owning what clearing one means.
   */
  emptyAction?: React.ReactNode;
}

interface Section {
  key: string;
  label: string;
  repos: Repo[];
}

/**
 * Bucket repos for the current grouping axis.
 *
 * Ordering is by the axis's own natural order (recency buckets run
 * fresh→stale, ownership runs mine→cloned) rather than by bucket size,
 * so the section order is stable as the catalog changes.
 */
function groupRepos(
  repos: Repo[],
  groupBy: GroupBy,
  ownershipFor: (repo: Repo) => OwnershipInfo,
  folderLabelFor: (repo: Repo) => string,
  folderKeyFor: (repo: Repo) => string,
): Section[] {
  if (groupBy === "none") {
    return [{ key: "all", label: "", repos }];
  }

  const buckets = new Map<string, Section>();
  const push = (key: string, label: string, repo: Repo) => {
    const existing = buckets.get(key);
    if (existing) existing.repos.push(repo);
    else buckets.set(key, { key, label, repos: [repo] });
  };

  for (const repo of repos) {
    switch (groupBy) {
      case "folder": {
        push(folderKeyFor(repo), folderLabelFor(repo), repo);
        break;
      }
      case "ownership": {
        const kind = ownershipFor(repo).kind;
        push(kind, OWNERSHIP_LABELS[kind], repo);
        break;
      }
      case "activity": {
        const level = activityOf(lastTouched(repo)).level;
        push(level, ACTIVITY_LABELS[level], repo);
        break;
      }
      case "language": {
        const language = repo.primaryLanguage ?? "Unknown";
        push(language, language, repo);
        break;
      }
    }
  }

  const sections = [...buckets.values()];
  if (groupBy === "ownership") {
    return sections.sort(
      (a, b) =>
        OWNERSHIP_ORDER.indexOf(a.key as Ownership) -
        OWNERSHIP_ORDER.indexOf(b.key as Ownership),
    );
  }
  if (groupBy === "activity") {
    return sections.sort(
      (a, b) =>
        ACTIVITY_ORDER.indexOf(a.key as ActivityLevel) -
        ACTIVITY_ORDER.indexOf(b.key as ActivityLevel),
    );
  }
  // Folder and language: alphabetical, but the biggest bucket of an
  // unknown/uncategorised group sinks to the bottom where it belongs.
  return sections.sort((a, b) => {
    const aUnknown = a.label === "Unknown" || a.label === "(root)";
    const bUnknown = b.label === "Unknown" || b.label === "(root)";
    if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
}

/*
 * A group heading is a name, not an eyebrow.
 *
 * It used to be `atr-label … uppercase tracking-wider`: the same tracked mono
 * as `VIEWS` and `LANGUAGES`, which spent the handoff's uppercase budget on a
 * folder's own name (`design` read as `DESIGN`) and left the panel's real
 * section labels with nothing to distinguish them. Sentence case at 12/600 in
 * muted ink is a heading that stays quiet, and the count keeps the mono tier
 * because a count is data.
 */
function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-2 flex items-baseline gap-2 border-b border-border/60 bg-background px-4 pb-2 pt-7">
      <h2 className="text-label font-semibold text-muted-foreground">{label}</h2>
      <span className="atr-meta tabular-nums">{count}</span>
    </div>
  );
}

function GridSkeleton({ posters }: { posters: boolean }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={cn(
        posters ? "flex flex-wrap gap-x-6" : "flex flex-col",
      )}
    >
      {Array.from({ length: posters ? 8 : 9 }).map((_, index) => (
        <Skeleton
          key={index}
          className={cn(
            posters
              ? cn(
                  POSTER_ITEM,
                  "h-64 rounded-none border-t border-border bg-transparent",
                )
              : "h-[84px] rounded-none border-t border-border bg-transparent",
          )}
        />
      ))}
    </div>
  );
}

export function RepoGrid({
  repos,
  ownershipFor,
  folderLabelFor,
  folderKeyFor,
  selectedSlug,
  checkedSlugs,
  onSelect,
  onToggleChecked,
  onOpenEditor,
  loading,
  emptyTitle = "Nothing here",
  emptyHint = "Try a different folder, or clear the filters.",
  emptySuggestion,
  emptyAction,
}: RepoGridProps) {
  const mode = useCatalogView((s) => s.mode);
  const groupBy = useCatalogView((s) => s.groupBy);
  const posters = mode === "gallery";

  const keyFor = folderKeyFor ?? folderLabelFor;
  const sections = React.useMemo(
    () => groupRepos(repos, groupBy, ownershipFor, folderLabelFor, keyFor),
    [repos, groupBy, ownershipFor, folderLabelFor, keyFor],
  );

  if (loading) return <GridSkeleton posters={posters} />;

  if (repos.length === 0) {
    return (
      <div
        data-empty-state
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card/40 p-16 text-center"
      >
        <FolderSearch className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="font-mono text-sm text-foreground">{emptyTitle}</p>
        <p className="max-w-sm text-xs text-muted-foreground">{emptyHint}</p>
        {emptySuggestion}
        {emptyAction ? (
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            {emptyAction}
          </div>
        ) : null}
      </div>
    );
  }

  if (mode === "table") {
    return (
      <RepoTable
        sections={sections}
        selectedSlug={selectedSlug}
        onSelect={onSelect}
        onToggleChecked={onToggleChecked}
        onOpenEditor={onOpenEditor}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => (
        <section key={section.key} aria-label={section.label || undefined}>
          {section.label ? (
            <SectionHeader label={section.label} count={section.repos.length} />
          ) : null}

          <div
            role="list"
            className={cn(
              posters ? "flex flex-wrap gap-x-6" : "flex flex-col",
              /*
               * The section heading already draws the rule that opens the
               * group. Without this the first entry drew a second one 8px
               * below it, so every group began with a pair of hairlines a
               * pixel wide and a gap apart — true of both densities.
               */
              "[&>div:first-child>article]:border-t-0",
            )}
          >
            {section.repos.map((repo) => (
              <div key={repo.slug} role="listitem" className="contents">
                {posters ? (
                  <RepoPoster
                    repo={repo}
                    ownership={ownershipFor(repo)}
                    selected={selectedSlug === repo.slug}
                    checked={checkedSlugs.has(repo.slug)}
                    onSelect={onSelect}
                    onToggleChecked={onToggleChecked}
                    onOpenEditor={onOpenEditor}
                  />
                ) : (
                  <RepoIndexEntry
                    repo={repo}
                    ownership={ownershipFor(repo)}
                    selected={selectedSlug === repo.slug}
                    checked={checkedSlugs.has(repo.slug)}
                    onSelect={onSelect}
                    onToggleChecked={onToggleChecked}
                    onOpenEditor={onOpenEditor}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
