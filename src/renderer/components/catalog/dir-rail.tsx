/**
 * The left rail: saved views on top, the real directory tree below.
 *
 * The tree is the point. Folders like `ai-tools-and-frameworks/agent-
 * frameworks` or `work-tricentis` are a taxonomy the user already built
 * by hand; showing it is worth more than any tag system the app could
 * invent, and it was previously discarded in favour of a single "All
 * repos" row.
 *
 * Folders are also drop targets — dragging repos onto one stages a real
 * move on disk (see `move-dialog.tsx`), which is what makes this a place
 * you can reorganise from rather than just look at.
 */

import * as React from "react";
import {
  ChevronRight,
  Cloud,
  CloudOff,
  Folder,
  FolderOpen,
  HardDrive,
  Archive,
  CircleDot,
  Layers,
  Sparkles,
  FolderSearch,
  FolderPlus,
  FolderInput,
  MoreHorizontal,
  PenLine,
  RefreshCw,
  FolderMinus,
  Plus,
  Star,
} from "lucide-react";

import type { Group, Repo } from "@shared/types";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { cn } from "@renderer/lib/cn";

import type { FolderDialogRequest } from "./folder-dialog";
import {
  ancestorsOf,
  buildRepoForest,
  isArchivedPath,
  isUnder,
  tildify,
  type TreeNode,
} from "@renderer/lib/repo-tree";
import { OWNERSHIP_HINTS, type Ownership } from "@renderer/lib/ownership";
import { useCatalogView } from "@renderer/stores/catalog-view";

interface DirRailProps {
  repos: Repo[];
  groups: Group[];
  /** Ownership classification per slug, computed once by the shell. */
  ownershipBySlug: Map<string, Ownership>;
  /** Configured scan roots — the tree is anchored on these. */
  scanPaths: string[];
  activeGroupId: number | null;
  onSelectGroup: (id: number | null) => void;
  /** Slug of the repo currently open in the detail panel, for auto-reveal. */
  revealSlug?: string | null;
  /** Called when repos are dropped onto a folder. */
  onDropRepos?: (slugs: string[], targetDir: string) => void;
  /** Called when a folder is dropped onto another folder. */
  onDropFolder?: (fromPath: string, targetParent: string) => void;
  /** Called to open the create/rename/move folder dialog. */
  onRequestFolderOp?: (request: FolderDialogRequest) => void;
  /** Rescan a single root on demand. */
  onRescan?: (path: string) => void;
  /** Begin removing a root from the watch list. */
  onStopScanning?: (path: string) => void;
  /** Pick a new folder to watch. */
  onAddScanPath?: () => void;
  /** True while a folder picker or scan kickoff is in flight. */
  addingScanPath?: boolean;
}

/** A count badge; dimmed until the row is hovered or selected. */
function CountBadge({ count, tone }: { count: number; tone?: "warning" }) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "ml-auto shrink-0 rounded px-1 font-mono atr-micro leading-[18px]",
        tone === "warning"
          ? "bg-warning/15 text-warning"
          : "text-muted-foreground",
      )}
    >
      {count}
    </span>
  );
}

const OWNERSHIP_VIEW_ICONS = {
  mine: Cloud,
  local: HardDrive,
  external: CloudOff,
} as const;


/**
 * Per-folder actions.
 *
 * Opened by the hover-revealed "⋯" button AND by right-click, because on
 * a desktop app right-click is the reflex — but a menu that ONLY appears
 * on right-click is undiscoverable, so the button has to exist too.
 */
function FolderMenu({
  path,
  canRestructure,
  onRequest,
  open,
  onOpenChange,
}: {
  path: string;
  canRestructure: boolean;
  onRequest: (request: FolderDialogRequest) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setOpen = onOpenChange;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${path.split("/").pop()}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 transition-opacity duration-150",
            "hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100",
            open && "opacity-100",
          )}
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem
          onSelect={() => onRequest({ mode: "create", path })}
        >
          <FolderPlus className="h-3.5 w-3.5" aria-hidden />
          New folder inside
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!canRestructure}
          onSelect={() => onRequest({ mode: "rename", path })}
        >
          <PenLine className="h-3.5 w-3.5" aria-hidden />
          Rename…
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canRestructure}
          onSelect={() => onRequest({ mode: "move", path })}
        >
          <FolderInput className="h-3.5 w-3.5" aria-hidden />
          Move to…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


/**
 * Scan-root actions.
 *
 * Deliberately different verbs from a normal folder: a root can't be
 * renamed or moved (that would desync it from settings), but it CAN be
 * rescanned on demand or dropped from the watch list.
 */
function ScanRootMenu({
  path,
  onRequest,
  onRescan,
  onStopScanning,
  open,
  onOpenChange,
}: {
  path: string;
  onRequest: (request: FolderDialogRequest) => void;
  onRescan: (path: string) => void;
  onStopScanning: (path: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for scan folder ${path}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 transition-opacity duration-150",
            "hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100",
            open && "opacity-100",
          )}
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem onSelect={() => onRescan(path)}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Scan now
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onRequest({ mode: "create", path })}>
          <FolderPlus className="h-3.5 w-3.5" aria-hidden />
          New folder inside
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onStopScanning(path)}
          className="text-destructive focus:text-destructive"
        >
          <FolderMinus className="h-3.5 w-3.5" aria-hidden />
          Stop scanning…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One folder row plus, when expanded, its children. */
function DirRow({
  node,
  selectedDir,
  expanded,
  onToggle,
  onSelect,
  onDropRepos,
  onDropFolder,
  onRequestFolderOp,
}: {
  node: TreeNode;
  selectedDir: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onDropRepos?: (slugs: string[], targetDir: string) => void;
  onDropFolder?: (fromPath: string, targetParent: string) => void;
  onRequestFolderOp?: (request: FolderDialogRequest) => void;
}) {
  const [dropActive, setDropActive] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const isOpen = expanded.has(node.path);
  const isSelected = selectedDir === node.path;
  const hasChildren = node.children.length > 0;
  const archived = isArchivedPath(node.path);

  /**
   * A row accepts two payloads: a set of repos, or another folder. The
   * folder case has to reject drops onto itself or its own descendants —
   * the service blocks those too, but letting the row light up as a valid
   * target first would be a lie.
   */
  const acceptsFolder = (fromPath: string) =>
    Boolean(onDropFolder) &&
    fromPath !== node.path &&
    !isUnder(node.path, fromPath) &&
    node.path !== fromPath.slice(0, fromPath.lastIndexOf("/"));

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDropActive(false);

    const folderPath = event.dataTransfer.getData("application/x-atr-folder");
    if (folderPath) {
      if (acceptsFolder(folderPath)) onDropFolder?.(folderPath, node.path);
      return;
    }

    const raw = event.dataTransfer.getData("application/x-atr-repos");
    if (!raw || !onDropRepos) return;
    try {
      const slugs = JSON.parse(raw) as string[];
      if (Array.isArray(slugs) && slugs.length > 0) {
        onDropRepos(slugs, node.path);
      }
    } catch {
      // Malformed payload — a drag from outside the app. Ignore rather
      // than surfacing a parse error the user can do nothing about.
    }
  };

  const FolderIcon = archived ? Archive : isOpen ? FolderOpen : Folder;

  return (
    <li>
      <div
        className={cn(
          "atr-rail-row group/row",
          dropActive && "bg-accent/15 ring-1 ring-inset ring-accent",
        )}
        data-selected={isSelected ? "true" : "false"}
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData("application/x-atr-folder", node.path);
          e.dataTransfer.effectAllowed = "move";
        }}
        onContextMenu={(e) => {
          if (!onRequestFolderOp) return;
          e.preventDefault();
          setMenuOpen(true);
        }}
        style={{ paddingLeft: `${4 + node.depth * 12}px` }}
        onDragOver={(e) => {
          const types = e.dataTransfer.types;
          // `getData` is unreadable during dragover, so a folder drag is
          // accepted optimistically here and re-validated on drop.
          const isFolder = types.includes("application/x-atr-folder");
          const isRepos = types.includes("application/x-atr-repos");
          if (!isFolder && !isRepos) return;
          if (isRepos && !onDropRepos) return;
          if (isFolder && !onDropFolder) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropActive(true);
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={handleDrop}
      >
        <button
          type="button"
          aria-label={
            hasChildren
              ? `${isOpen ? "Collapse" : "Expand"} ${node.name}`
              : undefined
          }
          aria-expanded={hasChildren ? isOpen : undefined}
          /*
            A leaf folder's chevron is only a layout spacer — the button is
            `disabled` and `opacity-0`, so it can never be operated. Without
            this it still entered the accessibility tree as an unnamed, disabled
            button, which is what an a11y sweep reports as a defect.
          */
          aria-hidden={!hasChildren}
          disabled={!hasChildren}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.path);
          }}
          className={cn(
            "-m-1 flex h-6 w-6 shrink-0 items-center justify-center rounded p-1",
            hasChildren
              ? "cursor-pointer text-muted-foreground hover:bg-secondary hover:text-foreground"
              : "cursor-default opacity-0",
          )}
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-150",
              isOpen && "rotate-90",
            )}
            aria-hidden
          />
        </button>

        <button
          type="button"
          onClick={() => onSelect(node.path)}
          title={node.path}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
        >
          <FolderIcon
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              archived ? "text-muted-foreground/60" : "text-muted-foreground",
            )}
            aria-hidden
          />
          <span className={cn("atr-truncate", archived && "opacity-70")}>
            {node.name}
          </span>
          {node.dirtyCount > 0 ? (
            <CircleDot
              className="h-2.5 w-2.5 shrink-0 text-warning"
              aria-label={`${node.dirtyCount} with uncommitted changes`}
            />
          ) : null}
          <CountBadge count={node.totalRepos} />
        </button>

        {onRequestFolderOp ? (
          <FolderMenu
            path={node.path}
            canRestructure
            onRequest={onRequestFolderOp}
            open={menuOpen}
            onOpenChange={setMenuOpen}
          />
        ) : null}
      </div>

      {isOpen && hasChildren ? (
        <ul>
          {node.children.map((child) => (
            <DirRow
              key={child.path}
              node={child}
              selectedDir={selectedDir}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              onDropRepos={onDropRepos}
              onDropFolder={onDropFolder}
              onRequestFolderOp={onRequestFolderOp}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="atr-label px-2 pb-1 pt-3 font-mono font-medium uppercase tracking-wider text-muted-foreground/70">
      {children}
    </p>
  );
}

/**
 * A configured scan root.
 *
 * Rendered with more weight than an ordinary folder and always present —
 * a root you told the app to watch must be visible even when it holds no
 * repos yet, otherwise there's no way to tell "empty" from "not
 * configured".
 */
function ScanRootRow({
  node,
  selectedDir,
  selectedDirExact,
  expanded,
  onToggle,
  onSelect,
  onSelectExact,
  onDropRepos,
  onDropFolder,
  onRequestFolderOp,
  onRescan,
  onStopScanning,
}: {
  node: TreeNode;
  selectedDir: string | null;
  selectedDirExact: boolean;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onSelectExact: (path: string) => void;
  onDropRepos?: (slugs: string[], targetDir: string) => void;
  onDropFolder?: (fromPath: string, targetParent: string) => void;
  onRequestFolderOp?: (request: FolderDialogRequest) => void;
  onRescan?: (path: string) => void;
  onStopScanning?: (path: string) => void;
}) {
  const [dropActive, setDropActive] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const isOpen = expanded.has(node.path);
  const isSelected = selectedDir === node.path;
  const isEmpty = node.totalRepos === 0;

  return (
    <li>
      <div
        className={cn(
          "atr-rail-row group/row mt-0.5",
          dropActive && "bg-accent/15 ring-1 ring-inset ring-accent",
        )}
        data-selected={isSelected ? "true" : "false"}
        onDragOver={(e) => {
          const types = e.dataTransfer.types;
          const isFolder = types.includes("application/x-atr-folder");
          const isRepos = types.includes("application/x-atr-repos");
          if (node.isOutsideScanRoots) return;
          if (!isFolder && !isRepos) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropActive(true);
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropActive(false);
          if (node.isOutsideScanRoots) return;
          const folderPath = e.dataTransfer.getData(
            "application/x-atr-folder",
          );
          if (folderPath) {
            // Dropping onto the root means "move to the top level"; a
            // folder already there has nowhere to go.
            const currentParent = folderPath.slice(
              0,
              folderPath.lastIndexOf("/"),
            );
            if (currentParent !== node.path && folderPath !== node.path) {
              onDropFolder?.(folderPath, node.path);
            }
            return;
          }
          const raw = e.dataTransfer.getData("application/x-atr-repos");
          if (!raw || !onDropRepos) return;
          try {
            const slugs = JSON.parse(raw) as string[];
            if (Array.isArray(slugs) && slugs.length > 0) {
              onDropRepos(slugs, node.path);
            }
          } catch {
            // Drag from outside the app — nothing sensible to do.
          }
        }}
      >
        <button
          type="button"
          aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.name}`}
          aria-expanded={isOpen}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.path);
          }}
          className="-m-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-150",
              isOpen && "rotate-90",
            )}
            aria-hidden
          />
        </button>
        <button
          type="button"
          onClick={() => onSelect(node.path)}
          title={node.path}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
        >
          {node.isOutsideScanRoots ? (
            <FolderSearch
              className="h-3.5 w-3.5 shrink-0 text-warning"
              aria-hidden
            />
          ) : (
            <HardDrive
              className="h-3.5 w-3.5 shrink-0 text-accent"
              aria-hidden
            />
          )}
          <span className="atr-truncate font-medium">
            {node.isOutsideScanRoots ? "Outside scan folders" : tildify(node.path)}
          </span>
          {node.dirtyCount > 0 ? (
            <CircleDot
              className="h-2.5 w-2.5 shrink-0 text-warning"
              aria-label={`${node.dirtyCount} with uncommitted changes`}
            />
          ) : null}
          <CountBadge count={node.totalRepos} />
        </button>

        {onRequestFolderOp && onRescan && onStopScanning &&
        !node.isOutsideScanRoots ? (
          <ScanRootMenu
            path={node.path}
            onRequest={onRequestFolderOp}
            onRescan={onRescan}
            onStopScanning={onStopScanning}
            open={menuOpen}
            onOpenChange={setMenuOpen}
          />
        ) : null}
      </div>

      {isOpen ? (
        isEmpty ? (
          <div className="py-1 pl-8 pr-2">
            <p className="text-xs leading-snug text-muted-foreground/80">
              {node.isOutsideScanRoots
                ? "These repos won't be picked up by future scans."
                : "No repos found here yet."}
            </p>
            {!node.isOutsideScanRoots && onRescan ? (
              <button
                type="button"
                onClick={() => onRescan(node.path)}
                className="atr-label mt-1 flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 font-mono text-accent transition-colors duration-150 hover:bg-surface-raised"
              >
                <RefreshCw className="h-3 w-3" aria-hidden />
                Scan it now
              </button>
            ) : null}
          </div>
        ) : (
          <ul>
            {node.children.map((child) => (
              <DirRow
                key={child.path}
                node={child}
                selectedDir={selectedDir}
                expanded={expanded}
                onToggle={onToggle}
                onSelect={onSelect}
                onDropRepos={onDropRepos}
                onDropFolder={onDropFolder}
                onRequestFolderOp={onRequestFolderOp}
              />
            ))}
            {node.repos.length > 0 ? (
              <li>
                {/*
                  Selecting the root shows its whole subtree, which buries
                  the repos sitting at its top level among everything below
                  them. This row narrows the catalog to exactly those — the
                  repos whose parent IS this folder — so the count in the
                  badge is a set you can open rather than a number you have
                  to find by hand.
                */}
                <button
                  type="button"
                  onClick={() => onSelectExact(node.path)}
                  title={`Show the ${node.repos.length} repos directly in ${tildify(node.path)}`}
                  className="atr-rail-row pl-4"
                  data-selected={
                    selectedDir === node.path && selectedDirExact
                      ? "true"
                      : "false"
                  }
                >
                  <Folder
                    className="ml-6 h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                    aria-hidden
                  />
                  <span className="atr-truncate italic text-muted-foreground">
                    directly in this folder
                  </span>
                  <CountBadge count={node.repos.length} />
                </button>
              </li>
            ) : null}
          </ul>
        )
      ) : null}
    </li>
  );
}

export function DirRail({
  repos,
  groups,
  ownershipBySlug,
  scanPaths,
  activeGroupId,
  onSelectGroup,
  revealSlug,
  onDropRepos,
  onDropFolder,
  onRequestFolderOp,
  onRescan,
  onStopScanning,
  onAddScanPath,
  addingScanPath,
}: DirRailProps) {
  const selectedDir = useCatalogView((s) => s.selectedDir);
  const selectedDirExact = useCatalogView((s) => s.selectedDirExact);
  const setSelectedDir = useCatalogView((s) => s.setSelectedDir);
  const expandedDirs = useCatalogView((s) => s.expandedDirs);
  const toggleDir = useCatalogView((s) => s.toggleDir);
  const expandDirs = useCatalogView((s) => s.expandDirs);
  const ownershipFilter = useCatalogView((s) => s.ownershipFilter);
  const favoritesOnly = useCatalogView((s) => s.favoritesOnly);
  const setFavoritesOnly = useCatalogView((s) => s.setFavoritesOnly);
  const toggleOwnership = useCatalogView((s) => s.toggleOwnership);
  const clearOwnership = useCatalogView((s) => s.clearOwnership);

  const forest = React.useMemo(
    () => buildRepoForest(repos, scanPaths),
    [repos, scanPaths],
  );
  const expanded = React.useMemo(() => new Set(expandedDirs), [expandedDirs]);

  // First run has nothing expanded, which makes the rail look empty even
  // though it's full. Open every scan root and its top level once so the
  // taxonomy is visible immediately; after that the user's own
  // expand/collapse state wins.
  const didSeedRef = React.useRef(false);
  React.useEffect(() => {
    if (didSeedRef.current) return;
    if (forest.roots.length === 0) return;
    didSeedRef.current = true;
    if (expandedDirs.length === 0) {
      expandDirs([
        ...forest.roots.map((r) => r.path),
        ...forest.roots.flatMap((r) => r.children.map((c) => c.path)),
      ]);
    }
  }, [forest, expandedDirs.length, expandDirs]);

  // Reveal the selected repo's folder so the rail always agrees with
  // what's open in the detail panel.
  React.useEffect(() => {
    if (!revealSlug) return;
    const repo = repos.find((r) => r.slug === revealSlug);
    if (!repo) return;
    const dir = repo.fullPath.slice(0, repo.fullPath.lastIndexOf("/"));
    const owner =
      forest.roots.find((root) => isUnder(repo.fullPath, root.path))?.path ??
      "";
    expandDirs([owner, dir, ...ancestorsOf(dir, owner)].filter(Boolean));
  }, [revealSlug, repos, forest, expandDirs]);

  const ownershipCounts = React.useMemo(() => {
    const counts: Record<Ownership, number> = {
      mine: 0,
      external: 0,
      local: 0,
    };
    for (const kind of ownershipBySlug.values()) counts[kind]++;
    return counts;
  }, [ownershipBySlug]);

  const dirtyTotal = React.useMemo(
    () => repos.filter((r) => r.isDirty).length,
    [repos],
  );

  const favoriteCount = React.useMemo(
    () => repos.filter((r) => r.isFavorite).length,
    [repos],
  );

  const allSelected =
    selectedDir === null && ownershipFilter.length === 0 && !favoritesOnly;

  return (
    <nav
      aria-label="Catalog filters and folders"
      className="flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface px-2 pb-4"
    >
      <SectionLabel>Views</SectionLabel>
      <ul>
        <li>
          <button
            type="button"
            className="atr-rail-row"
            data-selected={allSelected ? "true" : "false"}
            onClick={() => {
              setSelectedDir(null);
              clearOwnership();
              setFavoritesOnly(false);
              onSelectGroup(null);
            }}
          >
            <Layers
              className="ml-6 h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="atr-truncate">All repos</span>
            <CountBadge count={repos.length} />
          </button>
        </li>

        <li>
          <button
            type="button"
            className="atr-rail-row"
            data-selected={favoritesOnly ? "true" : "false"}
            onClick={() => setFavoritesOnly(!favoritesOnly)}
            title="Repos you've pinned"
          >
            <Star
              className="ml-6 h-3.5 w-3.5 shrink-0 text-warning"
              fill={favoritesOnly ? "currentColor" : "none"}
              aria-hidden
            />
            <span className="atr-truncate">Favourites</span>
            <CountBadge count={favoriteCount} />
          </button>
        </li>

        {(["mine", "local", "external"] as const).map((kind) => {
          const Icon = OWNERSHIP_VIEW_ICONS[kind];
          const label =
            kind === "mine"
              ? "Mine"
              : kind === "local"
                ? "Local only"
                : "Cloned";
          return (
            <li key={kind}>
              <button
                type="button"
                className="atr-rail-row"
                data-selected={
                  ownershipFilter.includes(kind) ? "true" : "false"
                }
                title={OWNERSHIP_HINTS[kind]}
                onClick={() => toggleOwnership(kind)}
              >
                <Icon
                  className="ml-6 h-3.5 w-3.5 shrink-0"
                  style={{ color: `var(--color-own-${kind})` }}
                  aria-hidden
                />
                <span className="atr-truncate">{label}</span>
                <CountBadge count={ownershipCounts[kind]} />
              </button>
            </li>
          );
        })}

        {dirtyTotal > 0 ? (
          <li>
            <button
              type="button"
              className="atr-rail-row"
              data-selected="false"
              onClick={() => {
                setSelectedDir(null);
                clearOwnership();
              }}
              title={`${dirtyTotal} repos have uncommitted changes`}
            >
              <CircleDot
                className="ml-6 h-3.5 w-3.5 shrink-0 text-warning"
                aria-hidden
              />
              <span className="atr-truncate">Uncommitted</span>
              <CountBadge count={dirtyTotal} tone="warning" />
            </button>
          </li>
        ) : null}
      </ul>

      <SectionLabel>
        {scanPaths.length > 1 ? "Scanned folders" : "Folders"}
      </SectionLabel>
      {forest.roots.length === 0 ? (
        <p className="px-2 py-1.5 text-xs leading-snug text-muted-foreground">
          No scan folders configured yet. Add one in Settings and run a scan.
        </p>
      ) : null}
      <ul>
        {forest.roots.map((root) => (
          <ScanRootRow
            key={root.path}
            node={root}
            selectedDir={selectedDir}
            selectedDirExact={selectedDirExact}
            expanded={expanded}
            onToggle={toggleDir}
            onSelect={(path) =>
              setSelectedDir(selectedDir === path ? null : path)
            }
            onSelectExact={(path) => {
              const already = selectedDir === path && selectedDirExact;
              setSelectedDir(already ? null : path, true);
            }}
            onDropRepos={onDropRepos}
            onDropFolder={onDropFolder}
            onRequestFolderOp={onRequestFolderOp}
            onRescan={onRescan}
            onStopScanning={onStopScanning}
          />
        ))}
      </ul>

      {onAddScanPath ? (
        <button
          type="button"
          onClick={onAddScanPath}
          disabled={addingScanPath}
          className="atr-rail-row mt-1 text-muted-foreground disabled:cursor-wait disabled:opacity-60"
        >
          <Plus className="ml-6 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="atr-truncate">
            {addingScanPath ? "Adding…" : "Add folder to scan"}
          </span>
        </button>
      ) : null}

      {groups.length > 0 ? (
        <>
          <SectionLabel>Groups</SectionLabel>
          <ul>
            {groups.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  className="atr-rail-row"
                  data-selected={activeGroupId === group.id ? "true" : "false"}
                  onClick={() =>
                    onSelectGroup(activeGroupId === group.id ? null : group.id)
                  }
                >
                  <Sparkles
                    className={cn(
                      "ml-6 h-3.5 w-3.5 shrink-0",
                      group.isSmart ? "text-accent" : "text-muted-foreground",
                    )}
                    aria-hidden
                  />
                  <span className="atr-truncate">{group.name}</span>
                  <CountBadge count={group.repoCount} />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </nav>
  );
}

/** Helper used by the shell to decide whether a repo passes the dir filter. */
export function matchesDir(repo: Repo, selectedDir: string | null): boolean {
  if (!selectedDir) return true;
  return isUnder(repo.fullPath, selectedDir);
}
