import * as React from "react";
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  Folder,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

import type { Group } from "@shared/types";

import { cn } from "@renderer/lib/cn";
import {
  useCreateGroup,
  useDeleteGroup,
  useRenameGroup,
} from "@renderer/hooks/use-groups";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";

interface GroupSidebarProps {
  groups: Group[];
  totalCount: number;
  selectedGroupId: number | null;
  onSelectGroup: (id: number | null) => void;
  className?: string;
}

export function GroupSidebar({
  groups,
  totalCount,
  selectedGroupId,
  onSelectGroup,
  className,
}: GroupSidebarProps) {
  const [collapsed, setCollapsed] = React.useState(false);

  const manual = groups.filter((g) => !g.isSmart);
  const smart = groups.filter((g) => g.isSmart);

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-border bg-card transition-[width] duration-200",
        collapsed ? "w-14" : "w-60",
        className,
      )}
      aria-label="Groups"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Boxes className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          {!collapsed ? (
            <span className="truncate font-mono text-sm font-semibold tracking-tight">
              AllTheRepos
            </span>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed((c) => !c)}
          className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        <SidebarItem
          icon={<Folder className="h-4 w-4" aria-hidden />}
          label="All repos"
          count={totalCount}
          active={selectedGroupId === null}
          collapsed={collapsed}
          onClick={() => onSelectGroup(null)}
        />

        {manual.length > 0 && !collapsed ? (
          <SectionLabel>Groups</SectionLabel>
        ) : null}
        {manual.map((g) => (
          <SidebarItem
            key={g.id}
            icon={<Folder className="h-4 w-4" aria-hidden />}
            label={g.name}
            count={g.repoCount}
            active={selectedGroupId === g.id}
            collapsed={collapsed}
            onClick={() => onSelectGroup(g.id)}
            group={g}
          />
        ))}

        {smart.length > 0 && !collapsed ? (
          <SectionLabel>Smart</SectionLabel>
        ) : null}
        {smart.map((g) => (
          <SidebarItem
            key={g.id}
            icon={<Sparkles className="h-4 w-4 text-accent" aria-hidden />}
            label={g.name}
            count={g.repoCount}
            active={selectedGroupId === g.id}
            collapsed={collapsed}
            onClick={() => onSelectGroup(g.id)}
            smart
          />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-1 border-t border-border p-2">
        <CreateGroupDialog collapsed={collapsed} />
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 px-3 pb-1 atr-label font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </div>
  );
}

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  smart?: boolean;
  /** When set (manual groups only), render rename/delete affordances. */
  group?: Group;
}

function SidebarItem({
  icon,
  label,
  count,
  active,
  collapsed,
  onClick,
  smart,
  group,
}: SidebarItemProps) {
  return (
    <div className="group/item relative">
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        title={collapsed ? `${label} (${count})` : undefined}
        className={cn(
          "relative mx-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "bg-accent/10 text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
          collapsed && "justify-center",
        )}
      >
        {active ? (
          <span
            aria-hidden
            className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-accent"
          />
        ) : null}
        {icon}
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1 truncate">
              {label}
              {smart ? <span className="sr-only"> (smart group)</span> : null}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-mono atr-micro text-muted-foreground",
                // When manage affordances are present, hide the count on
                // hover/focus so the action buttons can take its place.
                group
                  ? "group-hover/item:opacity-0 group-focus-within/item:opacity-0"
                  : "",
              )}
            >
              {count}
            </span>
          </>
        ) : null}
      </button>

      {group && !collapsed ? <GroupRowActions group={group} /> : null}
    </div>
  );
}

/**
 * Rename / delete affordances for a manual group. Rendered absolutely
 * over the trailing count badge; revealed on row hover or keyboard
 * focus. Each opens its own dialog so the destructive delete is gated
 * behind an explicit confirm.
 */
function GroupRowActions({ group }: { group: Group }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/item:pointer-events-auto group-hover/item:opacity-100 group-focus-within/item:pointer-events-auto group-focus-within/item:opacity-100">
      <RenameGroupDialog group={group} />
      <DeleteGroupDialog group={group} />
    </div>
  );
}

function CreateGroupDialog({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const createGroup = useCreateGroup();

  // Reset transient state whenever the dialog closes.
  React.useEffect(() => {
    if (!open) {
      setName("");
      createGroup.reset();
    }
  }, [open, createGroup]);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createGroup.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          setOpen(false);
          setName("");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Create group"
          className={cn(
            "justify-start gap-2 text-muted-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          <Plus className="h-4 w-4" aria-hidden />
          {!collapsed ? <span>New group</span> : null}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>
            Groups collect repos you want to see together. Smart groups auto-
            populate from filters.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="group-name">Name</Label>
          <Input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim() && !createGroup.isPending) {
                e.preventDefault();
                handleCreate();
              }
            }}
            placeholder="e.g. Side projects"
            autoFocus
          />
          {createGroup.isError ? (
            <p role="alert" className="text-xs text-destructive">
              {createGroup.error.message || "Failed to create group."}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
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

function RenameGroupDialog({ group }: { group: Group }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(group.name);
  const renameGroup = useRenameGroup();

  // Re-seed the field from the current group name each time we open, and
  // clear any prior error when we close.
  React.useEffect(() => {
    if (open) {
      setName(group.name);
    } else {
      renameGroup.reset();
    }
  }, [open, group.name, renameGroup]);

  const handleRename = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    renameGroup.mutate(
      { id: group.id, name: trimmed },
      {
        onSuccess: () => {
          setOpen(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Rename group ${group.name}`}
          className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename group</DialogTitle>
          <DialogDescription>Give “{group.name}” a new name.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`rename-group-${group.id}`}>Name</Label>
          <Input
            id={`rename-group-${group.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim() && !renameGroup.isPending) {
                e.preventDefault();
                handleRename();
              }
            }}
            autoFocus
          />
          {renameGroup.isError ? (
            <p role="alert" className="text-xs text-destructive">
              {renameGroup.error.message || "Failed to rename group."}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
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

function DeleteGroupDialog({ group }: { group: Group }) {
  const [open, setOpen] = React.useState(false);
  const deleteGroup = useDeleteGroup();

  React.useEffect(() => {
    if (!open) {
      deleteGroup.reset();
    }
  }, [open, deleteGroup]);

  const handleDelete = () => {
    deleteGroup.mutate(
      { id: group.id },
      {
        onSuccess: () => {
          setOpen(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Delete group ${group.name}`}
          className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete group</DialogTitle>
          <DialogDescription>
            Delete “{group.name}”? The repos in it are not deleted — they just
            leave this group.
          </DialogDescription>
        </DialogHeader>
        {deleteGroup.isError ? (
          <p role="alert" className="text-xs text-destructive">
            {deleteGroup.error.message || "Failed to delete group."}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
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
