/**
 * Catalog toolbar — view mode, grouping, sort, and bulk actions.
 *
 * One row, always in the same place. The controls that change what you
 * SEE sit on the left; the count and the controls that act on a
 * SELECTION sit on the right, appearing only when there is a selection
 * to act on so the default state stays quiet.
 */

import * as React from "react";
import {
  Archive,
  ArrowDownUp,
  FolderInput,
  LayoutGrid,
  Rows3,
  Image as ImageIcon,
  X,
  DownloadCloud,
  RefreshCw,
} from "lucide-react";

import { cn } from "@renderer/lib/cn";
import {
  useCatalogView,
  type GroupBy,
  type SortKey,
  type ViewMode,
} from "@renderer/stores/catalog-view";

const VIEW_MODES: Array<{
  mode: ViewMode;
  label: string;
  hint: string;
  Icon: typeof LayoutGrid;
}> = [
  {
    mode: "gallery",
    label: "Gallery",
    hint: "Large covers — best for recognising a project you haven't opened in months",
    Icon: ImageIcon,
  },
  {
    mode: "grid",
    label: "Grid",
    hint: "Cover plus details — the balanced default",
    Icon: LayoutGrid,
  },
  {
    mode: "table",
    label: "Table",
    hint: "One line per repo — best for auditing and bulk reorganising",
    Icon: Rows3,
  },
];

const GROUP_OPTIONS: Array<{ value: GroupBy; label: string }> = [
  { value: "folder", label: "Folder" },
  { value: "ownership", label: "Owner" },
  { value: "activity", label: "Last touched" },
  { value: "language", label: "Language" },
  { value: "none", label: "Nothing" },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "touched", label: "Last touched" },
  { value: "name", label: "Name" },
  { value: "size", label: "Size" },
  { value: "language", label: "Language" },
  { value: "folder", label: "Folder" },
  { value: "owner", label: "Owner" },
];

/**
 * A labelled `<select>`. Native rather than a custom popover: it's
 * keyboard-accessible for free, and the toolbar shouldn't cost three
 * Radix portals on every catalog render.
 */
function ToolbarSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  icon?: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div className="flex items-center gap-1.5">
      <label
        htmlFor={id}
        className="flex items-center gap-1 font-mono atr-label uppercase tracking-wider text-muted-foreground"
      >
        {icon}
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-8 cursor-pointer rounded border border-border bg-input px-1.5 text-xs text-foreground transition-colors duration-150 hover:border-border-strong"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface CatalogToolbarProps {
  /** Repos currently shown, after every filter. */
  shownCount: number;
  /** Repos in the catalog before filtering. */
  totalCount: number;
  /** How many are hidden purely because archived folders are excluded. */
  archivedCount: number;
  /** Label describing the active scope, e.g. a folder name. */
  scopeLabel: string | null;
  onClearScope: () => void;
  onMoveSelection: () => void;
  /** Fast-forward the selection, or everything shown when none is picked. */
  onPull: () => void;
  /** Refresh ahead/behind for the same set. Never touches a working tree. */
  onFetch: () => void;
  syncing: boolean;
}

export function CatalogToolbar({
  shownCount,
  totalCount,
  archivedCount,
  scopeLabel,
  onClearScope,
  onMoveSelection,
  onPull,
  onFetch,
  syncing,
}: CatalogToolbarProps) {
  const mode = useCatalogView((s) => s.mode);
  const setMode = useCatalogView((s) => s.setMode);
  const groupBy = useCatalogView((s) => s.groupBy);
  const setGroupBy = useCatalogView((s) => s.setGroupBy);
  const sort = useCatalogView((s) => s.sort);
  const order = useCatalogView((s) => s.order);
  const setSort = useCatalogView((s) => s.setSort);
  const includeArchived = useCatalogView((s) => s.includeArchived);
  const setIncludeArchived = useCatalogView((s) => s.setIncludeArchived);
  const selection = useCatalogView((s) => s.selection);
  const clearSelection = useCatalogView((s) => s.clearSelection);

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
      <div
        role="group"
        aria-label="View mode"
        className="flex items-center gap-0.5 rounded-md bg-muted p-0.5"
      >
        {VIEW_MODES.map(({ mode: value, label, hint, Icon }) => (
          <button
            key={value}
            type="button"
            className="atr-segment"
            data-active={mode === value ? "true" : "false"}
            aria-pressed={mode === value}
            title={hint}
            onClick={() => setMode(value)}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <ToolbarSelect
        label="Group"
        value={groupBy}
        options={GROUP_OPTIONS}
        onChange={setGroupBy}
      />

      <div className="flex items-center gap-1">
        <ToolbarSelect
          label="Sort"
          value={sort}
          options={SORT_OPTIONS}
          onChange={(value) => setSort(value, order)}
          icon={<ArrowDownUp className="h-3 w-3" aria-hidden />}
        />
        <button
          type="button"
          onClick={() => setSort(sort)}
          aria-label={`Sort ${order === "asc" ? "ascending" : "descending"} — click to reverse`}
          className="atr-segment"
        >
          {order === "asc" ? "↑" : "↓"}
        </button>
      </div>

      {archivedCount > 0 || includeArchived ? (
        <button
          type="button"
          className="atr-segment"
          data-active={includeArchived ? "true" : "false"}
          aria-pressed={includeArchived}
          title="Folders named _archive, old, duplicates and similar are hidden by default"
          onClick={() => setIncludeArchived(!includeArchived)}
        >
          <Archive className="h-3.5 w-3.5" aria-hidden />
          <span className="whitespace-nowrap">
            Archived{archivedCount > 0 ? ` (${archivedCount})` : ""}
          </span>
        </button>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/*
          Sync acts on the selection when there is one, and on everything
          currently shown when there isn't — so "pull my work repos" is
          filter-then-click rather than select-all-then-click.

          Labels collapse to icons below `xl`: with the detail panel open
          the toolbar has ~700px, and the view/group/sort controls have a
          better claim on it than two words.
        */}
        <button
          type="button"
          onClick={onFetch}
          disabled={syncing}
          className="atr-segment disabled:cursor-wait disabled:opacity-60"
          title="Fetch remote refs for these repos — never changes your files"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", syncing && "animate-spin")}
            aria-hidden
          />
          <span className="hidden xl:inline">Fetch</span>
        </button>
        <button
          type="button"
          onClick={onPull}
          disabled={syncing}
          className="atr-segment disabled:cursor-wait disabled:opacity-60"
          title="Fast-forward these repos where it's safe to do so"
        >
          <DownloadCloud className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden xl:inline">Pull</span>
        </button>

        <span aria-hidden className="h-4 w-px bg-border" />
        {scopeLabel ? (
          <button
            type="button"
            onClick={onClearScope}
            className="flex cursor-pointer items-center gap-1 rounded bg-secondary px-2 py-1 font-mono atr-label text-foreground transition-colors duration-150 hover:bg-surface-raised"
            aria-label={`Clear scope ${scopeLabel}`}
          >
            <span className="max-w-[220px] truncate">{scopeLabel}</span>
            <X className="h-3 w-3 shrink-0" aria-hidden />
          </button>
        ) : null}

        {selection.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <span className="atr-meta">{selection.length} selected</span>
            <button
              type="button"
              onClick={onMoveSelection}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded bg-accent px-2 text-xs font-medium text-accent-foreground transition-opacity duration-150 hover:opacity-90"
            >
              <FolderInput className="h-3.5 w-3.5" aria-hidden />
              Move…
            </button>
            <button
              type="button"
              onClick={clearSelection}
              aria-label="Clear selection"
              className="atr-segment"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ) : (
          <span className={cn("atr-meta tabular-nums")}>
            {shownCount === totalCount
              ? `${totalCount} repos`
              : `${shownCount} of ${totalCount}`}
          </span>
        )}
      </div>
    </div>
  );
}
