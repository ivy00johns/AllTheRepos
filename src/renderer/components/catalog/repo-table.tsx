/**
 * Table — one line per repo, for working ON the catalog.
 *
 * The handoff's table is one table, not one per group: a single sticky header
 * over the surface, then group rows inside the same body. The old version
 * repeated the column header above every group (three headers for three
 * folders) and spent columns on Owner and Folder that the group heading and
 * the ownership filter already answer. This one reads Name · Description ·
 * Language · Last touched · Size, exactly as specified.
 *
 * The row is still furniture and the name is still the control (ATR-066). The
 * star stays — it is the one control the accessibility suite finds the row by
 * — but it sits at the end of the name cell and only appears on hover, focus
 * or selection, so the resting table has one clean left edge.
 *
 * The selected row is the handoff's: raised background and a 2px ink rule on
 * the left edge. The rule is a real element rather than a border because a
 * `border-collapse` table cannot hang one on a single row.
 */

import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import type { Repo } from "@shared/types";

import { cn } from "@renderer/lib/cn";
import { activityOf, lastTouched } from "@renderer/lib/activity";
import { formatSize } from "@renderer/lib/format-size";
import { cleanDescription } from "@renderer/lib/describe";
import { useProcessesForRepo } from "@renderer/hooks/use-processes";
import { useCatalogView, type SortKey } from "@renderer/stores/catalog-view";

import { colorForLanguage } from "./language-colors";
import { FavoriteStar } from "./favorite-star";
import { DirtyMark, MissingMark } from "./repo-marks";

export interface RepoTableSection {
  key: string;
  label: string;
  repos: Repo[];
}

export interface RepoTableProps {
  sections: RepoTableSection[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onToggleChecked: (slug: string, additive: boolean) => void;
  onOpenEditor: (slug: string) => void;
}

interface ColumnDef {
  key: SortKey | null;
  label: string;
  /** Numeric / date columns right-align so magnitudes line up. */
  align?: "right";
}

const COLUMNS: ColumnDef[] = [
  { key: "name", label: "Name" },
  { key: null, label: "Description" },
  { key: "language", label: "Language" },
  { key: "touched", label: "Last touched" },
  { key: "size", label: "Size", align: "right" },
];

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
        "sticky top-0 z-20 h-9 border-b border-border bg-surface px-2 text-label font-medium text-muted-foreground first:pl-6 last:pr-6",
        column.align === "right" ? "text-right" : "text-left",
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

function TableRow({
  repo,
  selected,
  onSelect,
  onToggleChecked,
  onOpenEditor,
}: {
  repo: Repo;
  selected: boolean;
  onSelect: (slug: string) => void;
  onToggleChecked: (slug: string, additive: boolean) => void;
  onOpenEditor: (slug: string) => void;
}) {
  const { processes } = useProcessesForRepo(repo.slug);
  const activity = activityOf(lastTouched(repo));
  const description = cleanDescription(repo.description, repo.readmePreview);

  /** One behaviour, two callers — the row (mouse) and the name (keyboard). */
  const activate = (
    event: React.MouseEvent<HTMLElement> | React.KeyboardEvent,
  ) => {
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

  return (
    <tr
      data-repo-slug={repo.slug}
      data-selected={selected ? "true" : "false"}
      onClick={activate}
      className={cn(
        "group cursor-pointer transition-colors duration-150",
        "hover:bg-surface",
        selected && "bg-surface-raised",
        repo.missing && "opacity-60",
      )}
    >
      <td className="relative h-9 border-b border-surface-raised px-2 py-1.5 first:pl-6 last:pr-6">
        {selected ? (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-0.5 bg-foreground"
          />
        ) : null}
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-pressed={selected ? "true" : "false"}
            onClick={(event) => {
              event.stopPropagation();
              activate(event);
            }}
            className="min-w-0 cursor-pointer truncate text-left text-body font-medium text-foreground"
          >
            {repo.name}
          </button>
          {processes.length > 0 ? (
            <span
              title="Listening"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-live"
            >
              <span className="sr-only">Listening. </span>
            </span>
          ) : null}
          {repo.missing ? <MissingMark compact /> : null}
          {repo.isDirty ? <DirtyMark compact /> : null}
          <span className="ml-auto shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
            <FavoriteStar
              slug={repo.slug}
              name={repo.name}
              isFavorite={repo.isFavorite}
            />
          </span>
        </div>
      </td>

      <td className="h-9 overflow-hidden border-b border-surface-raised px-2 py-1.5 first:pl-6 last:pr-6">
        <span className="block truncate text-body text-muted-foreground">
          {description ?? "—"}
        </span>
      </td>

      <td className="h-9 border-b border-surface-raised px-2 py-1.5 first:pl-6 last:pr-6">
        {repo.primaryLanguage ? (
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="h-3 w-0.5 shrink-0"
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

      <td className="h-9 border-b border-surface-raised px-2 py-1.5 first:pl-6 last:pr-6">
        <span className="atr-meta tabular-nums">{activity.relative}</span>
      </td>

      <td className="h-9 border-b border-surface-raised px-2 py-1.5 text-right first:pl-6 last:pr-6">
        <span className="atr-meta tabular-nums">
          {formatSize(repo.sizeBytes) || "—"}
        </span>
      </td>
    </tr>
  );
}

export function RepoTable({
  sections,
  selectedSlug,
  onSelect,
  onToggleChecked,
  onOpenEditor,
}: RepoTableProps) {
  return (
    /*
      The pane's own gutter is 16px; the table bleeds through it so the
      specified 24px cell padding is measured from the pane's edge. The table's
      720px minimum is what makes the pane scroll horizontally below that size
      — the same scroller the rows already live in.
    */
    <div className="-mx-4">
      <table className="w-full min-w-[720px] table-fixed border-separate border-spacing-0">
        <caption className="sr-only">
          {sections.reduce((sum, section) => sum + section.repos.length, 0)}{" "}
          repositories. Use the column headers to sort.
        </caption>
        <colgroup>
          <col style={{ width: "25%" }} />
          <col />
          <col style={{ width: "126px" }} />
          <col style={{ width: "126px" }} />
          <col style={{ width: "88px" }} />
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <HeaderCell key={column.label} column={column} />
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <React.Fragment key={section.key}>
              {section.label ? (
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={COLUMNS.length}
                    className="border-b border-border pb-2 pl-6 pr-6 pt-5 text-left"
                  >
                    <span className="text-label font-semibold text-muted-foreground">
                      {section.label}
                    </span>
                    <span className="ml-2 atr-meta tabular-nums">
                      {section.repos.length}
                    </span>
                  </th>
                </tr>
              ) : null}
              {section.repos.map((repo) => (
                <TableRow
                  key={repo.slug}
                  repo={repo}
                  selected={selectedSlug === repo.slug}
                  onSelect={onSelect}
                  onToggleChecked={onToggleChecked}
                  onOpenEditor={onOpenEditor}
                />
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
