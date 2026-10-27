/**
 * Catalog toolbar — view mode, grouping, sort, and bulk actions.
 *
 * One row, always in the same place. The controls that change what you
 * SEE sit on the left; the count and the controls that act on a
 * SELECTION sit on the right, appearing only when there is a selection
 * to act on so the default state stays quiet.
 *
 * The left cluster is the handoff's: the three densities are text tabs with a
 * 2px ink rule under the active one, a hairline closes them, and Group/Sort are
 * inline selects whose *value* is the ink — not a row of segmented buttons and
 * two bordered dropdowns. That was the difference between a 44px bar and an
 * 89px two-row dashboard header, and it is why the index started a row lower
 * than the handoff's does.
 */

import * as React from "react";
import {
  Archive,
  ArrowDownUp,
  ChevronDown,
  ListChecks,
  Minus,
  X,
  DownloadCloud,
  Filter,
  FolderPlus,
  RefreshCw,
} from "lucide-react";

import type { Group } from "@shared/types";

import { CreateGroupDialog } from "@renderer/components/groups/group-dialogs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import {
  useAddGroupMembers,
  useRemoveGroupMembers,
} from "@renderer/hooks/use-groups";
import { useUiStore } from "@renderer/stores/ui";
import { cn } from "@renderer/lib/cn";
import { TagCleanupButton } from "./tag-cleanup-dialog";
import { HIDDEN_REASONS_ID } from "@renderer/lib/hidden-repos";
import {
  useCatalogView,
  type GroupBy,
  type SortKey,
  type ViewMode,
} from "@renderer/stores/catalog-view";

/**
 * The three densities, in the handoff's order and with its names.
 *
 * The store keys are still `grid` and `gallery` — they are persisted in
 * `atr:catalog-view:v1`, so renaming them would discard everyone's saved view —
 * but the labels are Index and Posters. Calling the index "Grid" was the one
 * label in the redesign that lied: clicking it opened a list.
 */
const VIEW_MODES: Array<{
  mode: ViewMode;
  label: string;
  hint: string;
}> = [
  {
    mode: "grid",
    label: "Index",
    hint: "One full-width line per repo — the default",
  },
  {
    mode: "gallery",
    label: "Posters",
    hint: "The name at display size — best for recognising a project you haven't opened in months",
  },
  {
    mode: "table",
    label: "Table",
    hint: "One line per repo with sortable columns — best for auditing and bulk reorganising",
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
      {/*
        A field label, not an eyebrow: sentence case at the 12px tier, so the
        uppercase in this app stays with the rail's section names.
      */}
      <label
        htmlFor={id}
        className="flex items-center gap-1 text-label text-muted-foreground"
      >
        {icon}
        {label}
      </label>
      {/*
        The native select, stripped to its text: `appearance-none` plus our own
        chevron keeps the platform control's keyboard behaviour while the value
        reads as part of the sentence rather than as a boxed form field.
      */}
      <div className="relative flex items-center">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value as T)}
          className="h-7 cursor-pointer appearance-none rounded bg-transparent pl-0 pr-5 text-label font-medium text-foreground transition-colors duration-150 hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-0 h-3 w-3 text-muted-foreground"
          aria-hidden
        />
      </div>
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
  /** Fast-forward the selection, or everything shown when none is picked. */
  onPull: () => void;
  /** Refresh ahead/behind for the same set. Never touches a working tree. */
  onFetch: () => void;
  syncing: boolean;
  /** Whether the count's "what is hidden" strip is open. */
  explainingHidden: boolean;
  /** Toggle that strip. */
  onToggleHidden: () => void;
  /** Manual groups a selection can be added to. */
  groups: Group[];
  /** The group the catalog is scoped to, when it is scoped to one. */
  activeGroup: Group | null;
  /** How many repos are on screen, i.e. what "select all" would select. */
  visibleCount: number;
  /** Whether every one of them is already selected. */
  allVisibleSelected: boolean;
  /** Select every repo currently shown. */
  onSelectAllVisible: () => void;
  /** Open the saved-filter dialog, seeded from the filters in force. */
  onSaveAsFilter: () => void;
}

export function CatalogToolbar({
  shownCount,
  totalCount,
  archivedCount,
  scopeLabel,
  onClearScope,
  onPull,
  onFetch,
  syncing,
  explainingHidden,
  onToggleHidden,
  groups,
  activeGroup,
  visibleCount,
  allVisibleSelected,
  onSelectAllVisible,
  onSaveAsFilter,
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
    /*
      `flex-wrap` rather than one unbreakable row. The controls need ~854px;
      the column they live in is 544px at the window's 800px minimum and
      644px at 1280 with the detail panel open, and an ancestor clips the
      overflow — so Fetch, Pull and the repo count sat outside the clip and
      could not be clicked at all.

      `min-h-11` keeps a single row exactly the 44px it has always been, and
      the vertical padding is a half step for the wrapped case only: the
      tallest control is 36px, so `py-1` would have pushed the unwrapped bar
      to 45 and moved every pixel below it. `py-0.5` leaves `36 + 4 + 1 = 41`
      under the 44px floor — measured, not assumed — and still separates the
      two rows when the controls genuinely do not fit.
    */
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-background px-4 py-0.5">
      <div
        role="group"
        aria-label="View mode"
        className="flex items-stretch gap-4"
      >
        {VIEW_MODES.map(({ mode: value, label, hint }) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            title={hint}
            onClick={() => setMode(value)}
            className="flex cursor-pointer items-center pb-1 text-label font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground aria-pressed:text-foreground aria-pressed:shadow-[inset_0_-2px_0_var(--color-foreground)]"
          >
            {label}
          </button>
        ))}
      </div>

      <span aria-hidden className="h-4 w-px self-center bg-border" />

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
        {/*
          The other way to make a saved filter: instead of describing a rule, keep
          the one you are looking at. The dialog opens with whatever this view's
          filters a saved filter can hold, and says which of them it cannot.
        */}
        <button
          type="button"
          onClick={onSaveAsFilter}
          className="atr-segment"
          title="Save these filters as a saved filter — a group that fills itself"
          aria-label="Save these filters as a saved filter"
        >
          <Filter className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden xl:inline">Save filter</span>
        </button>
        <TagCleanupButton />
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

        {/*
          The one-step version of ⌘-clicking every row, which is the difference
          between "work on these three" and "work on this whole filtered view".
          Hidden once everything shown is selected — the selection block then
          carries the useful control, which is the way out.
        */}
        {visibleCount > 0 && !allVisibleSelected ? (
          <button
            type="button"
            onClick={onSelectAllVisible}
            title={`Select all ${visibleCount} repos shown`}
            aria-label={`Select all ${visibleCount} repos shown`}
            className="atr-segment"
          >
            <ListChecks className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden xl:inline">Select all</span>
          </button>
        ) : null}

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
            <AddToGroupMenu groups={groups} slugs={selection} />
            {activeGroup && !activeGroup.isSmart ? (
              <RemoveFromGroupButton group={activeGroup} slugs={selection} />
            ) : null}
            <button
              type="button"
              onClick={clearSelection}
              aria-label="Clear selection"
              className="atr-segment"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ) : shownCount === totalCount ? (
          <span className={cn("atr-meta tabular-nums")}>
            {totalCount} repos
          </span>
        ) : (
          /*
            A count that is smaller than the catalog is a question, not a
            statement — so when they differ it becomes a control that names the
            filters responsible and offers to clear them (see
            `lib/hidden-repos.ts`). Clicking it opens the strip; the number and
            the glyph are the whole affordance.
          */
          <button
            type="button"
            onClick={onToggleHidden}
            aria-expanded={explainingHidden}
            aria-controls={HIDDEN_REASONS_ID}
            aria-label={`${shownCount} of ${totalCount} repos shown — see what is hidden and clear it`}
            title="Some repos are hidden by a filter — see which, and clear it"
            className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 transition-colors duration-150 hover:bg-surface-raised"
          >
            <span className={cn("atr-meta tabular-nums")}>
              {shownCount} of {totalCount}
            </span>
            <ChevronDown
              className={cn(
                "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150",
                explainingHidden && "rotate-180",
              )}
              aria-hidden
            />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * "Add to group" — a menu over the manual groups, plus a way to make one from
 * what is selected.
 *
 * This is the only place the selection turns into membership, and it lives
 * where the selection already is (the toolbar's "N selected" block) rather than
 * in a dialog you have to find first. Creating from here is one step, not two:
 * the new group is created and the selection is written into it in the same
 * action, so "collect these in a group" is never a group that then has to be
 * filled from a second screen.
 */
function AddToGroupMenu({ groups, slugs }: { groups: Group[]; slugs: string[] }) {
  const addMembers = useAddGroupMembers();
  const clearSelection = useCatalogView((s) => s.clearSelection);
  const pushNotice = useUiStore((s) => s.pushNotice);
  const [creating, setCreating] = React.useState(false);

  const manual = groups.filter((group) => !group.isSmart);

  const add = (groupId: number, name: string) => {
    addMembers.mutate(
      { groupId, slugs },
      {
        onSuccess: (result) => {
          if (result.added === 0) {
            // The write moved nothing, so the selection stays: the next click
            // is probably a different group.
            pushNotice(`Already in ${name}`);
            return;
          }
          pushNotice(
            `Added ${result.added} repo${result.added === 1 ? "" : "s"} to ${name}`,
          );
          clearSelection();
        },
        onError: (error) =>
          pushNotice(`Could not add to ${name} — ${error.message}`),
      },
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={addMembers.isPending}
            className="atr-segment disabled:cursor-wait disabled:opacity-60"
            title="Put the selected repos in a group"
          >
            <FolderPlus className="h-3.5 w-3.5" aria-hidden />
            <span className="whitespace-nowrap">Add to group</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Add {slugs.length} to</DropdownMenuLabel>
          {manual.length === 0 ? (
            <p className="px-2 pb-1.5 text-xs text-muted-foreground">
              No groups yet.
            </p>
          ) : (
            manual.map((group) => (
              <DropdownMenuItem
                key={group.id}
                onSelect={() => add(group.id, group.name)}
              >
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span className="font-mono atr-micro text-muted-foreground">
                  {group.repoCount}
                </span>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <FolderPlus className="h-3.5 w-3.5" aria-hidden />
            New group…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateGroupDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(group) => add(group.id, group.name)}
      />
    </>
  );
}

/**
 * "Remove from group" — offered only while a manual group is the active scope,
 * which is the one place where "these repos, out of this group" is a complete
 * instruction.
 */
function RemoveFromGroupButton({
  group,
  slugs,
}: {
  group: Group;
  slugs: string[];
}) {
  const removeMembers = useRemoveGroupMembers();
  const clearSelection = useCatalogView((s) => s.clearSelection);
  const pushNotice = useUiStore((s) => s.pushNotice);

  const remove = () => {
    removeMembers.mutate(
      { groupId: group.id, slugs },
      {
        onSuccess: (result) => {
          if (result.removed === 0) {
            pushNotice(`Nothing in ${group.name} to remove`);
            return;
          }
          pushNotice(
            `Removed ${result.removed} repo${result.removed === 1 ? "" : "s"} from ${group.name}`,
          );
          clearSelection();
        },
        onError: (error) =>
          pushNotice(`Could not remove from ${group.name} — ${error.message}`),
      },
    );
  };

  return (
    <button
      type="button"
      onClick={remove}
      disabled={removeMembers.isPending}
      aria-label={`Remove the selected repos from ${group.name}`}
      title={`Remove the selected repos from ${group.name}`}
      className="atr-segment disabled:cursor-wait disabled:opacity-60"
    >
      <Minus className="h-3.5 w-3.5" aria-hidden />
      <span className="whitespace-nowrap">Remove</span>
    </button>
  );
}
