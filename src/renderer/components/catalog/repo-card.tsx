import * as React from "react";
import { Circle } from "lucide-react";

import type { Repo } from "@shared/types";

import { cn } from "@renderer/lib/cn";
import { Badge } from "@renderer/components/ui/badge";

import { LanguageBar } from "./language-bar";
import { colorForLanguage } from "./language-colors";
import { relativeTime } from "./relative-time";

interface RepoCardProps {
  repo: Repo;
  selected?: boolean;
  onSelect?: (slug: string) => void;
  onOpenEditor?: (slug: string) => void;
  tabIndex?: number;
}

export function RepoCard({
  repo,
  selected,
  onSelect,
  onOpenEditor,
  tabIndex = 0,
}: RepoCardProps) {
  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (e.metaKey || e.ctrlKey) {
      onOpenEditor?.(repo.slug);
      return;
    }
    onSelect?.(repo.slug);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button === 1) {
      e.preventDefault();
      onOpenEditor?.(repo.slug);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(repo.slug);
    }
  };

  const tagsVisible = repo.tags.slice(0, 3);
  const tagsOverflow = repo.tags.length - tagsVisible.length;

  return (
    <article
      role="button"
      tabIndex={tabIndex}
      aria-pressed={selected ? "true" : "false"}
      aria-label={`Repo ${repo.name}${repo.isDirty ? ", has uncommitted changes" : ""}`}
      data-repo-slug={repo.slug}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      className={cn(
        "group relative flex cursor-pointer flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-colors duration-150",
        "hover:border-accent/60",
        selected ? "border-accent" : "border-border",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: colorForLanguage(repo.primaryLanguage) }}
            title={repo.primaryLanguage ?? "Unknown language"}
          />
          <h3 className="truncate font-mono text-sm font-semibold text-foreground">
            {repo.name}
          </h3>
        </div>
        {repo.isDirty ? (
          <Badge variant="warning" className="shrink-0 gap-1 font-mono">
            <Circle className="h-2 w-2 fill-current" aria-hidden />
            dirty
          </Badge>
        ) : null}
      </header>

      <p className="line-clamp-1 text-xs text-muted-foreground">
        {repo.description ?? <span className="italic">No description</span>}
      </p>

      <LanguageBar languages={repo.languages} />

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
        <span>last commit {relativeTime(repo.lastCommitDate)}</span>
        <span aria-hidden>·</span>
        <span>
          {repo.tags.length} tag{repo.tags.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {tagsVisible.map((t) => (
          <Badge key={t.value} variant="tag">
            {t.value}
          </Badge>
        ))}
        {tagsOverflow > 0 ? (
          <Badge variant="secondary" className="font-mono">
            +{tagsOverflow}
          </Badge>
        ) : null}
      </div>
    </article>
  );
}
