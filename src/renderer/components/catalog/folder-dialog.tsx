/**
 * Folder dialog — create, rename, or move a folder.
 *
 * One dialog for all three because they share the thing that matters:
 * a preflight showing exactly what a directory rename would drag along
 * with it, and a confirm button that refuses to run when anything is
 * unsafe.
 *
 * Renaming a folder that holds forty repos moves forty repos, so the
 * count is stated plainly and the offending repos are listed by name
 * when they're what's blocking you.
 */

import * as React from "react";
import { AlertTriangle, ArrowRight, Check, Loader2 } from "lucide-react";

import type { FolderOpResult } from "@shared/types";
import { checkFolderName } from "@shared/folder-name";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { cn } from "@renderer/lib/cn";
import { tildify } from "@renderer/lib/repo-tree";
import {
  useCreateFolder,
  useFolderCheck,
  useMoveFolder,
  useRenameFolder,
} from "@renderer/hooks/use-folder";

export type FolderDialogMode = "create" | "rename" | "move";

export interface FolderDialogRequest {
  mode: FolderDialogMode;
  /** The folder being renamed or moved; the parent when creating. */
  path: string;
  /** Destination parent, pre-filled when a drag landed on a folder. */
  targetParent?: string | null;
}

interface FolderDialogProps {
  request: FolderDialogRequest | null;
  onOpenChange: (open: boolean) => void;
  /** Every folder path in the catalog, for the move destination list. */
  folderOptions: string[];
  onDone?: (result: FolderOpResult) => void;
}

const BLOCKER_COPY: Record<string, string> = {
  missing: "That folder no longer exists on disk",
  "not-a-directory": "That path isn't a folder",
  "invalid-name": "That name can't be used for a folder",
  "destination-exists": "Something with that name is already there",
  "target-outside-roots": "The destination is outside your scan folders",
  "target-inside-source": "A folder can't be moved inside itself",
  "same-location": "That's where it already is",
  "is-scan-root":
    "This is a scan folder — change it in Settings rather than moving it",
  "dirty-repos": "Some repos inside have uncommitted changes",
  "running-processes": "Something is running from inside this folder",
};

const TITLES: Record<FolderDialogMode, string> = {
  create: "New folder",
  rename: "Rename folder",
  move: "Move folder",
};

export function FolderDialog({
  request,
  onOpenChange,
  folderOptions,
  onDone,
}: FolderDialogProps) {
  const mode = request?.mode ?? "create";
  const basename = request ? (request.path.split("/").pop() ?? "") : "";

  const [name, setName] = React.useState("");
  const [parent, setParent] = React.useState("");
  const [result, setResult] = React.useState<FolderOpResult | null>(null);

  // Re-seed on every open so the dialog never shows the previous run's
  // name, destination, or outcome.
  React.useEffect(() => {
    if (!request) return;
    setResult(null);
    setName(request.mode === "rename" ? basename : "");
    setParent(
      request.mode === "move" ? (request.targetParent ?? "") : request.path,
    );
  }, [request, basename]);

  const create = useCreateFolder();
  const rename = useRenameFolder();
  const move = useMoveFolder();
  const pending = create.isPending || rename.isPending || move.isPending;

  const nameCheck = checkFolderName(name);
  // The destination the operation would produce, used for the preflight.
  const projectedPath = React.useMemo(() => {
    if (!request) return null;
    if (mode === "rename") {
      if (!nameCheck.ok) return null;
      const parentDir = request.path.slice(0, request.path.lastIndexOf("/"));
      return `${parentDir}/${nameCheck.normalized}`;
    }
    if (mode === "move") {
      if (!parent) return null;
      return `${parent.replace(/\/+$/, "")}/${basename}`;
    }
    return null;
  }, [request, mode, nameCheck.ok, nameCheck.normalized, parent, basename]);

  // Creating a folder touches nothing that exists, so it has no preflight.
  const check = useFolderCheck(
    mode === "create" ? null : (request?.path ?? null),
    projectedPath,
  );

  const affected = check.data?.affected ?? [];
  const blockers = check.data?.blockers ?? [];
  const canRun =
    mode === "create"
      ? nameCheck.ok && Boolean(parent)
      : Boolean(projectedPath) && check.data?.ok === true;

  const handleConfirm = async () => {
    if (!request || !canRun) return;
    let outcome: FolderOpResult;
    if (mode === "create") {
      outcome = await create.mutateAsync({
        parentPath: parent,
        name: nameCheck.normalized,
      });
    } else if (mode === "rename") {
      outcome = await rename.mutateAsync({
        fromPath: request.path,
        newName: nameCheck.normalized,
      });
    } else {
      outcome = await move.mutateAsync({
        fromPath: request.path,
        parentPath: parent,
      });
    }
    setResult(outcome);
    onDone?.(outcome);
  };

  const blockingRepos = affected.filter((r) => r.isDirty || r.hasProcess);

  return (
    <Dialog open={Boolean(request)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{TITLES[mode]}</DialogTitle>
          <DialogDescription>
            {mode === "create" ? (
              <>
                Creates an empty folder in{" "}
                <span className="font-mono">{tildify(parent)}</span>.
              </>
            ) : (
              <>
                Renaming a folder moves everything inside it on disk. The
                catalog is updated to match, and the whole thing can be undone.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <FolderOutcome result={result} />
        ) : (
          <>
            {mode === "move" ? (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="folder-parent"
                  className="font-mono atr-label uppercase tracking-wider text-muted-foreground"
                >
                  Move into
                </label>
                <input
                  id="folder-parent"
                  list="folder-parent-options"
                  value={parent}
                  onChange={(e) => setParent(e.target.value)}
                  spellCheck={false}
                  autoFocus
                  className="h-9 w-full rounded-md border border-border bg-input px-3 font-mono text-xs text-foreground transition-colors duration-150 hover:border-border-strong focus:border-accent"
                />
                <datalist id="folder-parent-options">
                  {folderOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="folder-name"
                  className="font-mono atr-label uppercase tracking-wider text-muted-foreground"
                >
                  Folder name
                </label>
                <input
                  id="folder-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  spellCheck={false}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canRun) void handleConfirm();
                  }}
                  aria-invalid={name.length > 0 && !nameCheck.ok}
                  aria-describedby="folder-name-error"
                  className={cn(
                    "h-9 w-full rounded-md border bg-input px-3 font-mono text-sm text-foreground transition-colors duration-150",
                    name.length > 0 && !nameCheck.ok
                      ? "border-destructive"
                      : "border-border hover:border-border-strong focus:border-accent",
                  )}
                />
                <p
                  id="folder-name-error"
                  role={nameCheck.ok ? undefined : "alert"}
                  className="min-h-4 atr-label text-destructive"
                >
                  {name.length > 0 && !nameCheck.ok ? nameCheck.message : ""}
                </p>
              </div>
            )}

            {mode !== "create" && projectedPath ? (
              <p className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 font-mono atr-micro text-muted-foreground">
                <span className="truncate">{tildify(request!.path)}</span>
                <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate text-foreground">
                  {tildify(projectedPath)}
                </span>
              </p>
            ) : null}

            {mode !== "create" ? (
              <div className="rounded-md border border-border">
                {check.isFetching ? (
                  <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    Checking what would move…
                  </p>
                ) : !projectedPath ? (
                  <p className="p-3 text-xs text-muted-foreground">
                    {mode === "move"
                      ? "Choose a destination to preview the move."
                      : "Enter a new name to preview the rename."}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 p-3">
                    <p className="flex items-center gap-2 text-xs">
                      {check.data?.ok ? (
                        <Check
                          className="h-3.5 w-3.5 shrink-0 text-accent"
                          aria-hidden
                        />
                      ) : (
                        <AlertTriangle
                          className="h-3.5 w-3.5 shrink-0 text-warning"
                          aria-hidden
                        />
                      )}
                      <span className="text-foreground">
                        {affected.length === 0
                          ? "No repos inside this folder"
                          : `${affected.length} ${affected.length === 1 ? "repo moves" : "repos move"} with it`}
                      </span>
                    </p>

                    {blockers.length > 0 ? (
                      <ul className="flex flex-col gap-0.5">
                        {blockers.map((blocker) => (
                          <li
                            key={blocker}
                            className="atr-label text-warning"
                          >
                            {BLOCKER_COPY[blocker] ?? blocker}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {blockingRepos.length > 0 ? (
                      <ul className="max-h-40 overflow-y-auto rounded border border-border/60">
                        {blockingRepos.map((repo) => (
                          <li
                            key={repo.slug}
                            className="flex items-center justify-between gap-2 px-2 py-1"
                          >
                            <span className="atr-truncate font-mono atr-label text-foreground">
                              {repo.name}
                            </span>
                            <span className="shrink-0 atr-micro text-warning">
                              {repo.isDirty ? "uncommitted" : ""}
                              {repo.isDirty && repo.hasProcess ? " · " : ""}
                              {repo.hasProcess ? "running" : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleConfirm} disabled={!canRun || pending}>
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : null}
                {mode === "create"
                  ? "Create folder"
                  : mode === "rename"
                    ? "Rename"
                    : "Move folder"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FolderOutcome({ result }: { result: FolderOpResult }) {
  return (
    <div className="flex flex-col gap-2">
      <p
        className={cn(
          "flex items-center gap-2 text-sm",
          result.ok ? "text-accent" : "text-destructive",
        )}
      >
        {result.ok ? (
          <Check className="h-4 w-4" aria-hidden />
        ) : (
          <AlertTriangle className="h-4 w-4" aria-hidden />
        )}
        {result.ok
          ? `Done — ${tildify(result.toPath)}`
          : (result.error ?? "That didn't work")}
      </p>
      {result.ok && result.movedRepos > 0 ? (
        <p className="atr-meta">
          {result.movedRepos} {result.movedRepos === 1 ? "repo" : "repos"}{" "}
          re-pointed · undo from the toolbar
        </p>
      ) : null}
    </div>
  );
}
