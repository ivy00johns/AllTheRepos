/**
 * Repo card — gallery and grid variants.
 *
 * Both variants render the same information in the same order so
 * switching density never makes you re-learn the layout; only the size
 * of the cover and the amount of description change.
 *
 * Design decisions worth keeping:
 *
 *  - Fixed heights per variant. The previous card grew with its content,
 *    which left ragged rows and made the grid read as broken.
 *  - The folder is shown, the ubiquitous tags are not. `node` / `docker`
 *    / `ci` appear on most repos and so carry no information, while
 *    `markets-and-finance` tells you what the project IS. The shell
 *    passes down which tags are too common to be worth the space.
 *  - Cover first. It's the fastest path to recognising a project you
 *    haven't opened in months.
 */

import * as React from "react";

import type { Repo } from "@shared/types";

import { LauncherButtons } from "@renderer/components/launcher/launcher-buttons";
import { PortChipsForRepo } from "@renderer/components/process/port-chip";
import { useProcessesForRepo } from "@renderer/hooks/use-processes";
import { cn } from "@renderer/lib/cn";
import { activityOf, lastTouched } from "@renderer/lib/activity";
import { cleanDescription } from "@renderer/lib/describe";
import type { OwnershipInfo } from "@renderer/lib/ownership";

import { colorForLanguage } from "./language-colors";
import { FavoriteStar } from "./favorite-star";
import { RepoCover } from "./repo-cover";
import {
  ActivityBar,
  BranchMark,
  DirtyMark,
  MissingMark,
  OwnershipMark,
} from "./repo-marks";

export interface RepoCardProps {
  repo: Repo;
  ownership: OwnershipInfo;
  /** Folder name shown under the title — the user's own taxonomy. */
  folderLabel: string;
  /** Resolved cover image, when the project ships one. */
  coverSrc?: string | null;
  /** Tags common enough across the catalog to be worth hiding. */
  commonTags?: ReadonlySet<string>;
  variant?: "grid" | "gallery";
  selected?: boolean;
  checked?: boolean;
  onSelect?: (slug: string) => void;
  onToggleChecked?: (slug: string, additive: boolean) => void;
  onOpenEditor?: (slug: string) => void;
  onDragStart?: (slug: string, event: React.DragEvent) => void;
}

/** Tags worth showing: distinctive ones first, ubiquitous ones dropped. */
function distinctiveTags(
  repo: Repo,
  commonTags: ReadonlySet<string> | undefined,
  limit: number,
): string[] {
  const values = repo.tags.map((t) => t.value);
  const rare = values.filter((v) => !commonTags?.has(v));
  // Fall back to whatever exists when every tag is common, rather than
  // rendering an empty row that makes the card look truncated.
  return (rare.length > 0 ? rare : values).slice(0, limit);
}

export function RepoCard({
  repo,
  ownership,
  folderLabel,
  coverSrc,
  commonTags,
  variant = "grid",
  selected,
  checked,
  onSelect,
  onToggleChecked,
  onOpenEditor,
  onDragStart,
}: RepoCardProps) {
  const { processes } = useProcessesForRepo(repo.slug);
  const gallery = variant === "gallery";

  const activity = React.useMemo(() => activityOf(lastTouched(repo)), [repo]);
  // `readmePreview` is on every list row already; without it most cards
  // would read "No description", because the stored description is
  // frequently README chrome with no prose in it.
  const description = React.useMemo(
    () => cleanDescription(repo.description, repo.readmePreview),
    [repo.description, repo.readmePreview],
  );
  const tags = distinctiveTags(repo, commonTags, gallery ? 3 : 2);
  const offDefaultBranch =
    repo.currentBranch !== null &&
    repo.defaultBranch !== null &&
    repo.currentBranch !== repo.defaultBranch;

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey) {
      // Cmd-click builds a multi-select for bulk moves rather than
      // launching an editor — bulk reorg is the more common two-handed
      // operation, and single-click-to-open is still one keystroke away.
      onToggleChecked?.(repo.slug, true);
      return;
    }
    if (event.shiftKey) {
      onOpenEditor?.(repo.slug);
      return;
    }
    onSelect?.(repo.slug);
  };

  /**
   * The name is the control, and the card around it is a container.
   *
   * It used to be the other way round: `role="button"` on the `<article>`, with
   * the port chips, the favourite star and five launcher buttons rendered inside
   * it. Interactive descendants of a button role are invalid — assistive tech
   * flattens or skips them, so the nested controls became unreachable or
   * ambiguous (ATR-060, and axe's `nested-interactive`).
   *
   * So the selection affordance moved to where it can have a name and a
   * keyboard home of its own, and the card stopped being a tab stop. The mouse
   * behaviour is unchanged: the card still selects on click, and the name
   * forwards the same modifiers (cmd for multi-select, shift to open the
   * editor) before stopping propagation so the click is not handled twice.
   */
  const handleNameClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    handleClick(event);
  };

  const cardLabel = `${repo.name}, ${ownership.label}, in ${folderLabel}, last touched ${activity.relative}${repo.isDirty ? ", uncommitted changes" : ""}`;

  return (
    <article
      data-repo-slug={repo.slug}
      data-selected={selected ? "true" : "false"}
      draggable
      onDragStart={(event) => onDragStart?.(repo.slug, event)}
      onClick={handleClick}
      className={cn(
        "atr-surface group relative flex overflow-hidden rounded-lg shadow-card",
        gallery ? "h-[268px] flex-col" : "h-[128px] flex-row gap-3 p-3",
        checked && "ring-2 ring-inset ring-accent",
        repo.missing && "opacity-60",
      )}
    >
      {gallery ? (
        <div className="relative h-32 w-full shrink-0 overflow-hidden border-b border-border">
          <RepoCover
            slug={repo.slug}
            name={repo.name}
            imageSrc={coverSrc}
            size="lg"
          />
        </div>
      ) : (
        <RepoCover
          slug={repo.slug}
          name={repo.name}
          imageSrc={coverSrc}
          size="md"
        />
      )}

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          gallery ? "gap-1.5 p-3" : "gap-1",
        )}
      >
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <h3 className="atr-truncate font-mono text-sm font-semibold text-foreground">
            <button
              type="button"
              aria-pressed={selected ? "true" : "false"}
              aria-label={cardLabel}
              onClick={handleNameClick}
              className="block max-w-full cursor-pointer truncate text-left"
            >
              {repo.name}
            </button>
          </h3>
          <PortChipsForRepo processes={processes} />
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {repo.missing ? <MissingMark compact /> : null}
            {repo.isDirty ? <DirtyMark compact /> : null}
            <FavoriteStar
              slug={repo.slug}
              name={repo.name}
              isFavorite={repo.isFavorite}
            />
          </div>
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <OwnershipMark ownership={ownership} />
          <span aria-hidden className="text-muted-foreground/40">
            ·
          </span>
          <span className="atr-truncate atr-meta" title={repo.fullPath}>
            {folderLabel}
          </span>
        </div>

        {/*
          The description is the only elastic row on the card. Bounding
          it here (rather than trusting line-clamp inside a flex column)
          is what keeps long text from spilling over the metadata row.
        */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <p
            className={cn(
              "line-clamp-2 text-xs leading-snug text-muted-foreground",
              !description && "italic opacity-60",
            )}
          >
            {description ?? "No description"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 overflow-hidden">
          <ActivityBar activity={activity} />
          {repo.primaryLanguage ? (
            <span className="flex min-w-0 items-center gap-1">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: colorForLanguage(repo.primaryLanguage),
                }}
              />
              <span className="atr-truncate atr-meta">
                {repo.primaryLanguage}
              </span>
            </span>
          ) : null}
          {offDefaultBranch && repo.currentBranch ? (
            <BranchMark branch={repo.currentBranch} />
          ) : null}
        </div>

        {gallery && tags.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <LauncherButtons
        slug={repo.slug}
        inline
        className={cn(
          "absolute bottom-2 right-2 rounded-md bg-surface-raised/95 p-0.5 opacity-0 shadow-raised backdrop-blur-sm transition-opacity duration-150",
          "group-hover:opacity-100 focus-within:opacity-100",
        )}
      />
    </article>
  );
}
