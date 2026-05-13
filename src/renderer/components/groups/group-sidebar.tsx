import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  Folder,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";

import type { Group } from "@shared/types";

import { cn } from "@renderer/lib/cn";
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
        <Link
          to="/settings"
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed && "justify-center",
          )}
          aria-label="Settings"
        >
          <SettingsIcon className="h-4 w-4 shrink-0" aria-hidden />
          {!collapsed ? <span>Settings</span> : null}
        </Link>
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
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
}

function SidebarItem({
  icon,
  label,
  count,
  active,
  collapsed,
  onClick,
  smart,
}: SidebarItemProps) {
  return (
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
            {smart ? (
              <span className="sr-only"> (smart group)</span>
            ) : null}
          </span>
          <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {count}
          </span>
        </>
      ) : null}
    </button>
  );
}

function CreateGroupDialog({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");

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
            placeholder="e.g. Side projects"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() => {
              // TODO: wire to `useCreateGroup` hook (groups:create) — see Phase 1 report.
              setOpen(false);
              setName("");
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
