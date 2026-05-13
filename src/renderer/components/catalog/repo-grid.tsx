import type { Repo } from "@shared/types";

import { cn } from "@renderer/lib/cn";

import { RepoCard } from "./repo-card";

interface RepoGridProps {
  repos: Repo[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onOpenEditor: (slug: string) => void;
  loading?: boolean;
}

export function RepoGrid({
  repos,
  selectedSlug,
  onSelect,
  onOpenEditor,
  loading,
}: RepoGridProps) {
  if (loading) {
    return (
      <div
        className={cn(
          "grid gap-4",
          "grid-cols-1 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3",
        )}
        aria-busy="true"
        aria-live="polite"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-lg border border-border bg-card"
          />
        ))}
      </div>
    );
  }

  if (repos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card/50 p-12 text-center">
        <p className="font-mono text-sm text-foreground">No repos match</p>
        <p className="text-xs text-muted-foreground">
          Adjust your filters or clear the search to see everything.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid gap-4",
        "grid-cols-1 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3",
      )}
      role="list"
    >
      {repos.map((repo) => (
        <div key={repo.slug} role="listitem">
          <RepoCard
            repo={repo}
            selected={selectedSlug === repo.slug}
            onSelect={onSelect}
            onOpenEditor={onOpenEditor}
          />
        </div>
      ))}
    </div>
  );
}
