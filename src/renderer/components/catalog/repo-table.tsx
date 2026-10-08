/**
 * Table view — one line per repo.
 *
 * This is the mode for working ON the catalog rather than browsing it:
 * comparing a hundred repos at a glance, spotting the dormant ones,
 * multi-selecting a folder's worth of projects and moving them.
 *
 * Sorting is column-driven with `aria-sort` so the current order is
 * announced, and every row keeps the same marks as the card views so
 * the two modes stay legible against each other.
 *
 * One structural rule, the same one the grid card follows: the row is a
 * *container*, not a control. A `<tr>` is announced as a row — no name to
 * press and no role to press it with — while the favourite star inside it is a
 * real button, so the row's own click is a convenience for a pointer and the
 * named, keyboard-reachable control is the project name.
 */

import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import type { Repo } from "@shared/types";

import { cn } from "@renderer/lib/cn";
import { activityOf, lastTouched } from "@renderer/lib/activity";
import { cleanDescription } from "@renderer/lib/describe";
import type { OwnershipInfo } from "@renderer/lib/ownership";
import { useCatalogView, type SortKey } from "@renderer/stores/catalog-view";

import { colorForLanguage } from "./language-colors";
import { FavoriteStar } from "./favorite-star";
import { RepoCover } from "./repo-cover";
import {
  ActivityDot,
  DirtyMark,
  MissingMark,
  OwnershipMark,
} from "./repo-marks";

export interface RepoTableProps {
  repos: Repo[];
  ownershipFor: (repo: Repo) => OwnershipInfo;
  folderLabelFor: (repo: Repo) => string;
  coverFor?: (repo: Repo) => string | null | undefined;
  selectedSlug: string | null;
  checkedSlugs: ReadonlySet<string>;
  onSelect: (slug: string) => void;
  onToggleChecked: (slug: string, additive: boolean) => void;
  onOpenEditor: (slug: string) => void;
  onDragStart?: (slug: string, event: React.DragEvent) => void;
}

interface ColumnDef {
  key: SortKey | null;
  label: string;
  className: string;
  /** Numeric / date columns right-align so magnitudes line up. */
  numeric?: boolean;
}

/**
 * Columns depend on the grouping axis: when rows are already grouped BY
 * folder, a folder column repeats the section header on every single
 * row and truncates to the same useless prefix. Dropping it hands ~20%
 * of the width back to the project name and description, which are the
 * columns you actually read.
 */
function columnsFor(groupedByFolder: boolean): ColumnDef[] {
  if (groupedByFolder) {
    return [
      { key: "name", label: "Project", className: "w-[50%]" },
      { key: "owner", label: "Owner", className: "w-[16%]" },
      { key: "language", label: "Language", className: "w-[14%]" },
      { key: "size", label: "Size", className: "w-[8%]", numeric: true },
      { key: "touched", label: "Touched", className: "w-[16%]", numeric: true },
    ];
  }
  return [
    { key: "name", label: "Project", className: "w-[32%]" },
    { key: "owner", label: "Owner", className: "w-[14%]" },
    { key: "folder", label: "Folder", className: "w-[20%]" },
    { key: "language", label: "Language", className: "w-[12%]" },
    { key: "size", label: "Size", className: "w-[8%]", numeric: true },
    { key: "touched", label: "Touched", className: "w-[14%]", numeric: true },
  ];
}

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)}${units[unit]}`;
}

function HeaderCell({ column }: { column: ColumnDef }) {
  const sort = useCatalogView((s) => s.sort);
  const order = useCatalogView((s) => s.order);
  const setSort = useCatalogView((s) => s.setSort);
  const isActive = column.key !== null && sort === column.key;

  return (
    <th
      scope="col"
      aria-sort={
        isActive ? (order === "asc" ? "ascending" : "descending") : "none"
      }
      className={cn(
        "sticky top-0 z-10 border-b border-border bg-background px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground",
        column.numeric ? "text-right" : "text-left",
        column.className,
      )}
    >
      {column.key ? (
        <button
          type="button"
          onClick={() => setSort(column.key as SortKey)}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1 transition-colors duration-150 hover:text-foreground",
            isActive && "text-foreground",
          )}
        >
          {column.label}
          {isActive ? (
            order === "asc" ? (
              <ArrowUp className="h-3 w-3" aria-hidden />
            ) : (
              <ArrowDown className="h-3 w-3" aria-hidden />
            )
          ) : null}
        </button>
      ) : (
        column.label
      )}
    </th>
  );
}

export function RepoTable({
  repos,
  ownershipFor,
  folderLabelFor,
  coverFor,
  selectedSlug,
  checkedSlugs,
  onSelect,
  onToggleChecked,
  onOpenEditor,
  onDragStart,
}: RepoTableProps) {
  const groupedByFolder = useCatalogView((state) => state.groupBy) === "folder";
  const columns = React.useMemo(
    () => columnsFor(groupedByFolder),
    [groupedByFolder],
  );

  return (
    <table className="w-full table-fixed border-collapse">
      <caption className="sr-only">
        {repos.length} repositories. Use the column headers to sort.
      </caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <HeaderCell key={column.label} column={column} />
          ))}
        </tr>
      </thead>
      <tbody>
        {repos.map((repo) => {
          const ownership = ownershipFor(repo);
          const activity = activityOf(lastTouched(repo));
          const description = cleanDescription(
            repo.description,
            repo.readmePreview,
          );
          const isChecked = checkedSlugs.has(repo.slug);

          /** The row's click, for a pointer: anywhere on the row selects it. */
          const handleRowClick = (event: React.MouseEvent<HTMLElement>) => {
            if (event.metaKey || event.ctrlKey) {
              onToggleChecked(repo.slug, true);
              return;
            }
            if (event.shiftKey) {
              onOpenEditor(repo.slug);
              return;
            }
            onSelect(repo.slug);
          };

          /**
           * The name's click, answered exactly once.
           *
           * Without the stop the same event would also reach the row's handler
           * and run the action twice — which for a Cmd-click means selecting and
           * immediately un-selecting, a no-op that reads as a dead control.
           */
          const handleNameClick = (
            event: React.MouseEvent<HTMLButtonElement>,
          ) => {
            event.stopPropagation();
            handleRowClick(event);
          };

          return (
            <tr
              key={repo.slug}
              data-repo-slug={repo.slug}
              data-selected={selectedSlug === repo.slug ? "true" : "false"}
              draggable
              onDragStart={(event) => onDragStart?.(repo.slug, event)}
              onClick={handleRowClick}
              className={cn(
                "cursor-pointer border-b border-border/60 transition-colors duration-150",
                "hover:bg-surface-raised",
                selectedSlug === repo.slug && "bg-secondary",
                isChecked && "bg-accent/10",
                repo.missing && "opacity-60",
              )}
            >
              <td className="px-3 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <FavoriteStar
                    slug={repo.slug}
                    name={repo.name}
                    isFavorite={repo.isFavorite}
                  />
                  <RepoCover
                    slug={repo.slug}
                    name={repo.name}
                    imageSrc={coverFor?.(repo)}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleNameClick}
                        aria-pressed={
                          selectedSlug === repo.slug ? "true" : "false"
                        }
                        className="atr-truncate cursor-pointer text-left font-mono text-[13px] font-medium text-foreground"
                      >
                        {repo.name}
                      </button>
                      {repo.missing ? <MissingMark compact /> : null}
                      {repo.isDirty ? <DirtyMark compact /> : null}
                    </div>
                    <span className="atr-truncate block text-[11px] text-muted-foreground">
                      {description ?? "—"}
                    </span>
                  </div>
                </div>
              </td>

              <td className="px-3 py-1.5">
                <OwnershipMark ownership={ownership} />
              </td>

              {groupedByFolder ? null : (
                <td className="px-3 py-1.5">
                  <span
                    className="atr-truncate atr-meta block"
                    title={repo.fullPath}
                  >
                    {folderLabelFor(repo)}
                  </span>
                </td>
              )}

              <td className="px-3 py-1.5">
                {repo.primaryLanguage ? (
                  <span className="flex min-w-0 items-center gap-1.5">
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
                ) : (
                  <span className="atr-meta">—</span>
                )}
              </td>

              <td className="px-3 py-1.5 text-right">
                <span className="atr-meta tabular-nums">
                  {formatSize(repo.sizeBytes)}
                </span>
              </td>

              <td className="px-3 py-1.5">
                <span className="flex items-center justify-end gap-1.5">
                  <ActivityDot activity={activity} />
                  <span className="atr-meta tabular-nums">
                    {activity.relative}
                  </span>
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
