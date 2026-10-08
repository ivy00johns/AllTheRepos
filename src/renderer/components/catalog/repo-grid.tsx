/**
 * View dispatcher — renders the current density mode, with grouping.
 *
 * Grouping is applied here rather than inside each view so the three
 * modes can never disagree about which repos belong to which bucket, and
 * so a new grouping axis is one function rather than three.
 *
 * Section headers are sticky: when you're 400 rows into a folder-grouped
 * catalog, "which folder am I looking at" has to stay answerable.
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

import { RepoCard } from "./repo-card";
import { RepoTable } from "./repo-table";

/**
 * Column tracks per density.
 *
 * Grid mode's minimum has to leave room for two columns *after* the
 * fixed-width rail (256px) and the open detail panel (380px) have taken
 * their share. At the default 1280px window that is 644px of content, so
 * a 320px minimum left `auto-fill` with exactly one full-width column —
 * the view read as a list of expanded rows rather than a grid. 240px
 * keeps two (and often three) real columns at that width while still
 * fitting a 44px cover plus a readable metadata column.
 */
const GRID_COLUMNS = "grid-cols-[repeat(auto-fill,minmax(240px,1fr))]";
const GALLERY_COLUMNS = "grid-cols-[repeat(auto-fill,minmax(248px,1fr))]";

export interface RepoGridProps {
  repos: Repo[];
  ownershipFor: (repo: Repo) => OwnershipInfo;
  folderLabelFor: (repo: Repo) => string;
  /** Stable, unambiguous grouping key (the absolute directory). */
  folderKeyFor?: (repo: Repo) => string;
  coverFor?: (repo: Repo) => string | null | undefined;
  commonTags?: ReadonlySet<string>;
  selectedSlug: string | null;
  checkedSlugs: ReadonlySet<string>;
  onSelect: (slug: string) => void;
  onToggleChecked: (slug: string, additive: boolean) => void;
  onOpenEditor: (slug: string) => void;
  onDragStart?: (slug: string, event: React.DragEvent) => void;
  loading?: boolean;
  /** Rendered when nothing matches — worded by the caller. */
  emptyTitle?: string;
  emptyHint?: string;
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

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-2 flex items-baseline gap-2 border-b border-border/60 bg-background/95 px-4 py-1.5 backdrop-blur-sm">
      <h2 className="atr-label font-mono font-semibold uppercase tracking-wider text-foreground">
        {label}
      </h2>
      <span className="atr-meta tabular-nums">{count}</span>
    </div>
  );
}

function GridSkeleton({ gallery }: { gallery: boolean }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={cn("grid gap-3", gallery ? GALLERY_COLUMNS : GRID_COLUMNS)}
    >
      {Array.from({ length: gallery ? 8 : 9 }).map((_, index) => (
        <Skeleton
          key={index}
          className={cn(
            "rounded-lg border border-border bg-card",
            gallery ? "h-64" : "h-[124px]",
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
  coverFor,
  commonTags,
  selectedSlug,
  checkedSlugs,
  onSelect,
  onToggleChecked,
  onOpenEditor,
  onDragStart,
  loading,
  emptyTitle = "Nothing here",
  emptyHint = "Try a different folder, or clear the filters.",
}: RepoGridProps) {
  const mode = useCatalogView((s) => s.mode);
  const groupBy = useCatalogView((s) => s.groupBy);
  const gallery = mode === "gallery";

  const keyFor = folderKeyFor ?? folderLabelFor;
  const sections = React.useMemo(
    () => groupRepos(repos, groupBy, ownershipFor, folderLabelFor, keyFor),
    [repos, groupBy, ownershipFor, folderLabelFor, keyFor],
  );

  if (loading) return <GridSkeleton gallery={gallery} />;

  if (repos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card/40 p-16 text-center">
        <FolderSearch className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="font-mono text-sm text-foreground">{emptyTitle}</p>
        <p className="max-w-sm text-xs text-muted-foreground">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => (
        <section key={section.key} aria-label={section.label || undefined}>
          {section.label ? (
            <SectionHeader label={section.label} count={section.repos.length} />
          ) : null}

          {mode === "table" ? (
            <RepoTable
              repos={section.repos}
              ownershipFor={ownershipFor}
              folderLabelFor={folderLabelFor}
              coverFor={coverFor}
              selectedSlug={selectedSlug}
              checkedSlugs={checkedSlugs}
              onSelect={onSelect}
              onToggleChecked={onToggleChecked}
              onOpenEditor={onOpenEditor}
              onDragStart={onDragStart}
            />
          ) : (
            <div
              role="list"
              className={cn("grid gap-3", gallery ? GALLERY_COLUMNS : GRID_COLUMNS)}
            >
              {section.repos.map((repo) => (
                <div key={repo.slug} role="listitem" className="contents">
                  <RepoCard
                    repo={repo}
                    ownership={ownershipFor(repo)}
                    folderLabel={folderLabelFor(repo)}
                    coverSrc={coverFor?.(repo)}
                    commonTags={commonTags}
                    variant={gallery ? "gallery" : "grid"}
                    selected={selectedSlug === repo.slug}
                    checked={checkedSlugs.has(repo.slug)}
                    onSelect={onSelect}
                    onToggleChecked={onToggleChecked}
                    onOpenEditor={onOpenEditor}
                    onDragStart={onDragStart}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
