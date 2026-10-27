/**
 * Index entry — the Repos route's default density.
 *
 * The handoff's thesis is that the repository name is the product and
 * everything else is a footnote, so an entry is set as a line in an index
 * rather than a card in a dashboard:
 *
 *   - a hairline above it, no box around it;
 *   - the name at `text-name` (15), wrapping to two lines before it clamps;
 *   - one line of description, then the meta line in mono with `·` between
 *     everything, so `yesterday · Go · 5.2 MB · 3 uncommitted` reads as four
 *     facts rather than one string;
 *   - a 2px language spine on the left edge, ink when selected;
 *   - a 128px gutter reserved on the right, so the controls that arrive on
 *     hover can never land on top of the description (the incumbent's worst
 *     bug, made structurally impossible rather than patched).
 *
 * The gutter carries every control an entry has, in two bands: select and pin
 * on top, the five launchers beneath. The first attempt reserved 64px and left
 * the launchers in the card's absolutely-positioned cluster, which put five
 * icons on top of the description and the meta line of every hovered row — the
 * overlap the gutter was supposed to prevent, one row lower. Five 24px buttons
 * need 128px of one line, so that is the gutter's width; the row's own height
 * (about 84px) holds both bands without growing.
 *
 * The launcher band appears on hover and focus only. A selected row keeps the
 * select box and the pin — the two states worth seeing at rest — rather than
 * turning into a seven-button toolbar.
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

export interface RepoIndexEntryProps {
  repo: Repo;
  ownership: OwnershipInfo;
  selected?: boolean;
  checked?: boolean;
  onSelect?: (slug: string) => void;
  onToggleChecked?: (slug: string, additive: boolean) => void;
  onOpenEditor?: (slug: string) => void;
}

/** The separator the handoff's meta line is built from. */
function Sep() {
  return (
    <span aria-hidden className="text-border-strong">
      ·
    </span>
  );
}

/**
 * One meta fact, separator included.
 *
 * The `·` belongs to the fact that follows it, not to the line: as separate
 * flex items the two could wrap apart, which is how a row ended in a dangling
 * `·` with `local only` on the next line. `whitespace-nowrap` keeps the pair
 * together and the line still wraps between facts.
 */
function Fact({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Sep />
      {children}
    </span>
  );
}

export function RepoIndexEntry({
  repo,
  ownership,
  selected,
  checked,
  onSelect,
  onToggleChecked,
  onOpenEditor,
}: RepoIndexEntryProps) {
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
        "group relative grid min-h-[76px] cursor-pointer grid-cols-[minmax(0,1fr)_128px] gap-3 border-t border-border py-3 pl-4 pr-2",
        "transition-colors duration-150",
        selected ? "bg-surface-raised" : "hover:bg-surface-raised/50",
        repo.missing && "opacity-60",
      )}
    >
      <span
        aria-hidden
        className="absolute bottom-[14px] left-0 top-3 w-0.5"
        style={{
          backgroundColor: selected
            ? "var(--color-foreground)"
            : repo.primaryLanguage
              ? colorForLanguage(repo.primaryLanguage)
              : "transparent",
        }}
      />

      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="min-w-0">
          <button
            type="button"
            aria-pressed={selected ? "true" : "false"}
            aria-label={cardLabel}
            onClick={handleNameClick}
            className="block max-w-full cursor-pointer overflow-hidden text-left text-name font-medium leading-[1.35] text-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [overflow-wrap:anywhere]"
          >
            {repo.name}
          </button>
        </h3>

        <p
          className={cn(
            "truncate text-body text-muted-foreground",
            !description && "italic opacity-60",
          )}
        >
          {description ?? "No description"}
        </p>

        <div className="atr-meta flex flex-wrap items-center gap-x-1 gap-y-1 pt-0.5">
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
          {/*
            The port stays a control, not a number: the same button the card
            had (open in browser, copy URL, kill) in the meta line's own type.
            Rendering it as text dropped all three actions from the default
            view and `nav-card-a11y` walks this control by name.
          */}
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
                {ownership.kind === "local" ? "local only" : `cloned from ${ownership.owner}`}
              </span>
            </Fact>
          ) : null}
        </div>
      </div>

      {/*
        The reserved gutter. Invisible and still 128px wide, so nothing moves
        when an entry is hovered or selected. Two bands: the entry's own state
        on top, the launchers beneath it.
      */}
      <div className="flex flex-col items-end justify-start gap-0.5">
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 group-data-[selected=true]:opacity-100">
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
        </div>
        <LauncherButtons
          slug={repo.slug}
          inline
          density="compact"
          className="rounded opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
        />
      </div>
    </article>
  );
}
