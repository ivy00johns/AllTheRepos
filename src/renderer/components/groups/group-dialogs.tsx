/**
 * The group dialogs — create a manual group, create or edit a saved filter,
 * rename, delete.
 *
 * Lifted out of the old `group-sidebar.tsx`, which was never mounted: it drew a
 * whole second navigation column that duplicated the rail, so the one thing it
 * owned (group CRUD) was the one thing the app could not do. These are
 * *controlled* dialogs with no trigger of their own, because the two callers
 * are a rail row's overflow menu and a toolbar dropdown, and a Radix
 * `DropdownMenuItem` cannot also be a `DialogTrigger`.
 *
 * Every dialog starts clean on open: the field is re-seeded from the group (or
 * blanked), and a previous attempt's error is dropped. A rename dialog that
 * reopened showing the last failure read as if the group had never been saved.
 *
 * Both kinds of group are created here, and the second one is why this file is
 * bigger than its IPC namespace: `groups:create` has accepted `isSmart` and a
 * nested `smartFilter` since Phase 1, but nothing ever sent them, so the only
 * groups the app could make were hand-picked lists. A smart group is a saved
 * filter, and saving one is now the same gesture as making a list: a row on the
 * rail, a name, and the conditions that decide membership.
 */

import * as React from "react";

import type { Group, Repo } from "@shared/types";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import {
  useCreateGroup,
  useDeleteGroup,
  useRenameGroup,
  useUpdateGroupFilter,
} from "@renderer/hooks/use-groups";
import {
  buildSmartFilter,
  draftFromSmartFilter,
  EMPTY_SAVED_FILTER_DRAFT,
  savedFilterDaysError,
  type SavedFilterDraft,
} from "@renderer/lib/saved-filter";
import { matchesSmartFilter } from "@renderer/lib/smart-filter";

interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The group that was created. The rail selects it (so an empty group is
   * visibly the place you just made) and the toolbar puts the current
   * selection in it.
   */
  onCreated?: (group: Group) => void;
}

export function CreateGroupDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateGroupDialogProps) {
  const [name, setName] = React.useState("");
  const createGroup = useCreateGroup();

  React.useEffect(() => {
    if (!open) return;
    setName("");
    createGroup.reset();
    // `createGroup` is a fresh object every render, so it is deliberately not
    // a dependency: re-running this on each render would clear the field as it
    // is being typed into.
  }, [open]);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed || createGroup.isPending) return;
    createGroup.mutate(
      { name: trimmed },
      {
        onSuccess: (group) => {
          onOpenChange(false);
          onCreated?.(group);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>
            A group collects repos you want to see together. Nothing on disk
            moves — it is only a view of the catalog.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 px-5 py-4">
          <Label
            htmlFor="new-group-name"
            className="text-label font-medium text-muted-foreground"
          >
            Name
          </Label>
          <Input
            id="new-group-name"
            className="h-8"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleCreate();
              }
            }}
            placeholder="e.g. Side projects"
            autoFocus
          />
          {createGroup.isError ? (
            <p role="alert" className="text-label text-destructive">
              {createGroup.error.message || "Could not create the group."}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="bordered"
            onClick={() => onOpenChange(false)}
            disabled={createGroup.isPending}
          >
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || createGroup.isPending}
            onClick={handleCreate}
          >
            {createGroup.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SavedFilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Languages present in the catalog — the only ones a filter can match. */
  languages: string[];
  /** The catalog, for the live match count under the fields. */
  repos: Repo[];
  /**
   * The saved filter to edit. Absent (or null) creates a new one; present
   * rewrites that group's conditions and leaves its name alone.
   */
  group?: Group | null;
  /**
   * Conditions to start a NEW filter with, instead of a blank form.
   *
   * The toolbar saves the view you are already looking at, and making somebody
   * re-tick the boxes it can carry would defeat the point. Ignored when editing:
   * there the stored rule is the seed.
   */
  initialDraft?: SavedFilterDraft;
  /**
   * Parts of the current view that a saved filter cannot hold — folder scope,
   * owner, the search box, an active group.
   *
   * Named in the dialog rather than silently dropped, because the filter is about
   * to be saved from a grid it will not reproduce. Saving a view without saying
   * which part of it did not come along is how somebody ends up with a group that
   * shows thirty repos where twelve were on screen.
   */
  notCarried?: string[];
  /** The group that was created or updated. */
  onSaved?: (group: Group) => void;
}

/**
 * Create or edit a smart group: a filter, with a name if it is new.
 *
 * The point of the live count is that a saved filter is invisible until you see
 * what it selects. Without it the first feedback is the grid after saving, and a
 * tag typo reads as "the feature does not work" rather than "nothing carries that
 * tag". It counts over the same `repos` the rail and the grid are holding, with
 * the same predicate the catalog filters by — so the number under the fields is
 * the number the row will show.
 *
 * One dialog for both jobs rather than a second one with the same conditions:
 * creating and editing differ in the title, the name field and which channel the
 * save goes to, and nothing else. A separate editor would be the copy that drifts
 * out of step with the creator.
 *
 * At least one condition is required. A filter with none matches every repo, and
 * saving one produces a group that looks like "All repos" under a name the user
 * expected to narrow something.
 */
export function SavedFilterDialog({
  open,
  onOpenChange,
  languages,
  repos,
  group = null,
  initialDraft,
  notCarried = [],
  onSaved,
}: SavedFilterDialogProps) {
  const editing = group !== null;
  const [name, setName] = React.useState("");
  const [draft, setDraft] = React.useState<SavedFilterDraft>(
    EMPTY_SAVED_FILTER_DRAFT,
  );
  const createGroup = useCreateGroup();
  const updateFilter = useUpdateGroupFilter();

  const groupId = group?.id ?? null;

  React.useEffect(() => {
    if (!open) return;
    setName(group?.name ?? "");
    setDraft(
      group
        ? draftFromSmartFilter(group.smartFilter)
        : (initialDraft ?? EMPTY_SAVED_FILTER_DRAFT),
    );
    createGroup.reset();
    updateFilter.reset();
    /*
     * Seeded on open, and when the dialog is pointed at a different group — not
     * on every refetch. `groups:list` hands back new `Group` objects after each
     * invalidation, and re-seeding on that would erase what is being typed.
     *
     * `initialDraft` is in the deps because it is what the fields look like on
     * open when saving a view; it is memoised by that caller and cannot change behind an
     * open modal, since every control it reads from is under the dialog.
     */
  }, [open, groupId, initialDraft]);

  const set = <K extends keyof SavedFilterDraft>(
    key: K,
    value: SavedFilterDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const daysError = savedFilterDaysError(draft);
  // Editing starts from the stored rule so conditions this dialog cannot draw
  // (`tagsExclude`, `hasRemote`) are not silently dropped by a tag fix.
  const filter =
    daysError === null
      ? buildSmartFilter(draft, group?.smartFilter ?? null)
      : null;
  const matches = filter
    ? repos.filter((repo) => matchesSmartFilter(repo, filter)).length
    : null;
  const pending = createGroup.isPending || updateFilter.isPending;
  const saveError = createGroup.error ?? updateFilter.error;
  const canSave =
    filter !== null && !pending && (editing || name.trim().length > 0);

  const handleSave = () => {
    if (!filter || !canSave) return;
    if (group) {
      updateFilter.mutate(
        { id: group.id, smartFilter: filter },
        {
          onSuccess: (saved) => {
            onOpenChange(false);
            onSaved?.(saved);
          },
        },
      );
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) return;
    createGroup.mutate(
      { name: trimmed, isSmart: true, smartFilter: filter },
      {
        onSuccess: (created) => {
          onOpenChange(false);
          onSaved?.(created);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit saved filter" : "New saved filter"}
          </DialogTitle>
          <DialogDescription>
            {editing ? (
              <>
                Change what “{group.name}” matches. The repos it shows update as
                soon as you save — nothing on disk moves.
              </>
            ) : (
              <>
                A saved filter is a group that fills itself: every repo matching
                the conditions below appears in it, now and as the catalog
                changes. Nothing on disk moves.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-5 py-4">
          {editing ? null : (
            <div className="flex flex-col gap-2">
              <Label
                htmlFor="saved-filter-name"
                className="text-label font-medium text-muted-foreground"
              >
                Name
              </Label>
              <Input
                id="saved-filter-name"
                className="h-8"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSave();
                  }
                }}
                placeholder="e.g. TypeScript work"
                autoFocus
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label
                htmlFor="saved-filter-language"
                className="text-label font-medium text-muted-foreground"
              >
                Language
              </Label>
              <select
                id="saved-filter-language"
                value={draft.language}
                onChange={(event) => set("language", event.target.value)}
                className="h-8 w-full cursor-pointer rounded border border-border bg-background px-2 text-body text-foreground transition-colors duration-150 focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Any language</option>
                {languages.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <Label
                htmlFor="saved-filter-days"
                className="text-label font-medium text-muted-foreground"
              >
                Touched in the last
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="saved-filter-days"
                  className="h-8"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  placeholder="Any time"
                  value={draft.sinceDays}
                  onChange={(event) => set("sinceDays", event.target.value)}
                  aria-invalid={daysError ? true : undefined}
                  aria-describedby={daysError ? "saved-filter-days-error" : undefined}
                />
                <span className="atr-meta shrink-0">days</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label
              htmlFor="saved-filter-tags"
              className="text-label font-medium text-muted-foreground"
            >
              Tagged with
            </Label>
            <Input
              id="saved-filter-tags"
              className="h-8"
              value={draft.tags}
              onChange={(event) => set("tags", event.target.value)}
              placeholder="cli, rust"
              aria-describedby="saved-filter-tags-hint"
            />
            <p id="saved-filter-tags-hint" className="atr-meta">
              Comma-separated. A repo must carry every tag listed.
            </p>
          </div>

          {/*
            The three view-shaped conditions, kept together: they are the ones a
            toolbar or rail toggle can already be showing, which is how saving a
            view from the toolbar arrives here with them pre-ticked.
          */}
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-body text-foreground">
              <input
                type="checkbox"
                checked={draft.dirtyOnly}
                onChange={(event) => set("dirtyOnly", event.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer rounded-sm accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              Only repos with uncommitted changes
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-body text-foreground">
              <input
                type="checkbox"
                checked={draft.favoritesOnly}
                onChange={(event) => set("favoritesOnly", event.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer rounded-sm accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              Only pinned repos
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-body text-foreground">
              <input
                type="checkbox"
                checked={draft.includeArchived}
                onChange={(event) => set("includeArchived", event.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer rounded-sm accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              Include archived folders
            </label>
          </div>

          {/*
            What did not come along. Only a create-from-the-view flow passes
            this; editing an existing filter has nothing outside the dialog to
            account for, and its leftover keys are preserved rather than named.
          */}
          {!editing && notCarried.length > 0 ? (
            <p data-filter-not-carried className="atr-meta">
              Not saved with it: {notCarried.join(", ")}. A saved filter covers
              every folder in the catalog.
            </p>
          ) : null}

          {daysError ? (
            <p
              id="saved-filter-days-error"
              role="alert"
              className="text-label text-destructive"
            >
              {daysError}
            </p>
          ) : null}

          <p className="atr-meta" aria-live="polite">
            {matches === null
              ? "Pick at least one condition to save."
              : matches === 0
                ? "No repos match yet — saving is still fine; it fills as the catalog changes."
                : matches === 1
                  ? "1 repo matches"
                  : `${matches} repos match`}
          </p>

          {saveError ? (
            <p role="alert" className="text-label text-destructive">
              {saveError.message || "Could not save the filter."}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="bordered"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={handleSave}>
            {pending
              ? "Saving…"
              : editing
                ? "Save changes"
                : "Save filter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RenameGroupDialogProps {
  group: Group;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameGroupDialog({
  group,
  open,
  onOpenChange,
}: RenameGroupDialogProps) {
  const [name, setName] = React.useState(group.name);
  const renameGroup = useRenameGroup();

  React.useEffect(() => {
    if (!open) return;
    setName(group.name);
    renameGroup.reset();
  }, [open, group.name]);

  const handleRename = () => {
    const trimmed = name.trim();
    if (!trimmed || renameGroup.isPending) return;
    renameGroup.mutate(
      { id: group.id, name: trimmed },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename group</DialogTitle>
          <DialogDescription>Give “{group.name}” a new name.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 px-5 py-4">
          <Label
            htmlFor={`rename-group-${group.id}`}
            className="text-label font-medium text-muted-foreground"
          >
            Name
          </Label>
          <Input
            id={`rename-group-${group.id}`}
            className="h-8"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleRename();
              }
            }}
            autoFocus
          />
          {renameGroup.isError ? (
            <p role="alert" className="text-label text-destructive">
              {renameGroup.error.message || "Could not rename the group."}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="bordered"
            onClick={() => onOpenChange(false)}
            disabled={renameGroup.isPending}
          >
            Cancel
          </Button>
          <Button
            disabled={
              !name.trim() ||
              name.trim() === group.name ||
              renameGroup.isPending
            }
            onClick={handleRename}
          >
            {renameGroup.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteGroupDialogProps {
  group: Group;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after the row is gone, so the caller can leave the deleted group. */
  onDeleted?: () => void;
}

export function DeleteGroupDialog({
  group,
  open,
  onOpenChange,
  onDeleted,
}: DeleteGroupDialogProps) {
  const deleteGroup = useDeleteGroup();

  React.useEffect(() => {
    if (!open) return;
    deleteGroup.reset();
  }, [open]);

  const handleDelete = () => {
    if (deleteGroup.isPending) return;
    deleteGroup.mutate(
      { id: group.id },
      {
        onSuccess: () => {
          onOpenChange(false);
          onDeleted?.();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="pb-5">
          <DialogTitle>Delete group</DialogTitle>
          <DialogDescription>
            {group.isSmart ? (
              <>
                Delete “{group.name}”? It is a saved filter, so no repo is
                touched — the view is what goes away.
              </>
            ) : (
              <>
                Delete “{group.name}”? The {group.repoCount} repo
                {group.repoCount === 1 ? "" : "s"} in it are not deleted — they
                just leave this group.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {deleteGroup.isError ? (
          <p role="alert" className="px-5 pb-4 text-label text-destructive">
            {deleteGroup.error.message || "Could not delete the group."}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            variant="bordered"
            onClick={() => onOpenChange(false)}
            disabled={deleteGroup.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={deleteGroup.isPending}
            onClick={handleDelete}
          >
            {deleteGroup.isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
