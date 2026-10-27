/**
 * Poster — the Repos route's largest density.
 *
 * The handoff's Posters is not a card with a bigger picture; it is the index
 * with the name promoted to display size and the cover art deleted:
 *
 *   - no box, only a 1px top hairline shared with the grid;
 *   - a 48×6 language bar, ink when the poster is selected;
 *   - the name at 28/1.15, clamped to two lines;
 *   - two lines of description at 13, measured to 52ch;
 *   - the same `·`-separated meta line as the index.
 *
 * The controls the old card carried are still here, in the 28px the handoff
 * leaves below the meta line. They are hidden at rest and still take their
 * space, so a hovered poster never reflows and actions never sit on the name.
 */

import * as React from "react";

import type { Repo } from "@shared/types";

import { LauncherButtons } from "@renderer/components/launcher/launcher-buttons";
import { PortChipsForRepo } from "@renderer/components/process/port-chip";
import { useProcessesForRepo } from "@renderer/hooks/use-processes";
import { cn } from "@renderer/lib/cn";
import { activityOf, lastTouched } from "@renderer/lib/activity";
import { formatSize } from "@renderer/lib/format-size";
import { cleanDescription } from "@renderer/lib/describe";
import type { OwnershipInfo } from "@renderer/lib/ownership";

import { colorForLanguage } from "./language-colors";
import { FavoriteStar } from "./favorite-star";
import { SelectionCheckbox } from "./selection-checkbox";

/**
 * The flex item's sizing, shared with the skeleton that stands in for it.
 *
 * A 340px basis and minimum reproduce the handoff's grid track; `flex-grow`
 * is what lets a poster that lands alone on the last line take the rest of
 * the row instead of leaving a dead column beside it.
 */
export const POSTER_ITEM =
  "min-w-[min(340px,100%)] grow shrink basis-[340px]";

export interface RepoPosterProps {
  repo: Repo;
  ownership: OwnershipInfo;
  selected?: boolean;
  checked?: boolean;
  onSelect?: (slug: string) => void;
  onToggleChecked?: (slug: string, additive: boolean) => void;
  onOpenEditor?: (slug: string) => void;
}

/** The separator every meta line in the catalog is built from. */
function Sep() {
  return (
    <span aria-hidden className="text-border-strong">
      ·
    </span>
  );
}

/** A meta fact with the separator that precedes it. */
function Fact({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Sep />
      {children}
    </span>
  );
}

export function RepoPoster({
  repo,
  ownership,
  selected,
  checked,
  onSelect,
  onToggleChecked,
  onOpenEditor,
}: RepoPosterProps) {
  const { processes } = useProcessesForRepo(repo.slug);
  const activity = React.useMemo(() => activityOf(lastTouched(repo)), [repo]);
  const description = React.useMemo(
    () => cleanDescription(repo.description, repo.readmePreview),
    [repo.description, repo.readmePreview],
  );
  const size = formatSize(repo.sizeBytes);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey) {
      onToggleChecked?.(repo.slug, true);
      return;
    }
    if (event.shiftKey) {
      onOpenEditor?.(repo.slug);
      return;
    }
    onSelect?.(repo.slug);
  };

  const handleNameClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    handleClick(event);
  };

  const cardLabel = `${repo.name}, ${ownership.label}, last touched ${activity.relative}${repo.isDirty ? ", uncommitted changes" : ""}`;

  return (
    <article
      data-repo-slug={repo.slug}
      data-selected={selected ? "true" : "false"}
      onClick={handleClick}
      className={cn(
        POSTER_ITEM,
        "group relative flex cursor-pointer flex-col gap-3 border-t border-border px-5 pb-7 pt-5",
        "transition-colors duration-150",
        selected ? "bg-surface-raised" : "hover:bg-surface-raised/40",
        repo.missing && "opacity-60",
      )}
    >
      <span
        aria-hidden
        className="block h-1.5 w-12 shrink-0"
        style={{
          backgroundColor: selected
            ? "var(--color-foreground)"
            : repo.primaryLanguage
              ? colorForLanguage(repo.primaryLanguage)
              : "var(--color-border-strong)",
        }}
      />

      <h3 className="min-w-0">
        <button
          type="button"
          aria-pressed={selected ? "true" : "false"}
          aria-label={cardLabel}
          onClick={handleNameClick}
          className="block max-w-full cursor-pointer overflow-hidden text-left text-display font-semibold text-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [overflow-wrap:anywhere]"
        >
          {repo.name}
        </button>
      </h3>

      <p
        className={cn(
          "line-clamp-2 min-h-[39px] max-w-[52ch] text-body text-muted-foreground",
          !description && "italic opacity-60",
        )}
      >
        {description ?? "No description"}
      </p>

      <div className="atr-meta flex flex-wrap items-center gap-x-1 gap-y-1">
        <span>{activity.relative}</span>
        {repo.primaryLanguage ? (
          <Fact>
            <span>{repo.primaryLanguage}</span>
          </Fact>
        ) : null}
        {size ? (
          <Fact>
            <span>{size}</span>
          </Fact>
        ) : null}
        {processes.length > 0 ? (
          <Fact>
            <PortChipsForRepo processes={processes} variant="inline" />
          </Fact>
        ) : null}
        {repo.isDirty ? (
          <Fact>
            <span className="text-warning">uncommitted</span>
          </Fact>
        ) : null}
        {ownership.kind !== "mine" ? (
          <Fact>
            <span className="text-own-local">
              {ownership.kind === "local"
                ? "local only"
                : `cloned from ${ownership.owner}`}
            </span>
          </Fact>
        ) : null}
      </div>

      {/*
        The bottom 28px of the poster is the actions' band: the same two state
        controls and five launchers the index keeps in its gutter, revealed on
        hover or focus. Reserving the space in the padding means the name and
        description never move and nothing overlays them; a selected poster
        keeps the handoff's quiet raised surface rather than turning into a
        toolbar.
      */}
      <div className="absolute bottom-0.5 right-5 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        <SelectionCheckbox
          name={repo.name}
          checked={checked ?? false}
          onCheckedChange={() => onToggleChecked?.(repo.slug, true)}
        />
        <FavoriteStar
          slug={repo.slug}
          name={repo.name}
          isFavorite={repo.isFavorite}
        />
        <LauncherButtons
          slug={repo.slug}
          inline
          density="compact"
          className="rounded"
        />
      </div>
    </article>
  );
}
