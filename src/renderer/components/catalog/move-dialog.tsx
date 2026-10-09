/**
 * Move dialog — relocate repos on disk.
 *
 * This is the only destructive surface in the app, so it is built to be
 * boring and legible:
 *
 *  - You pick a destination from the folders that already exist (or type
 *    a new one), never a free-form path into the void.
 *  - The preflight verdict is shown per repo BEFORE you confirm, with
 *    the reason spelled out for anything blocked.
 *  - The confirm button says exactly how many repos will move, and is
 *    disabled when that number is zero.
 *  - Results are reported honestly, including partial failures.
 */

import * as React from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  FolderInput,
  Loader2,
} from "lucide-react";

import type { MoveResult, Repo } from "@shared/types";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { cn } from "@renderer/lib/cn";
import { buildRepoForest, tildify, walkTree } from "@renderer/lib/repo-tree";
import { useMoveCheck, useMoveRepos } from "@renderer/hooks/use-move";

interface MoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Slugs queued for the move. */
  slugs: string[];
  /** Full catalog, used to enumerate destination folders. */
  repos: Repo[];
  /** Configured scan roots — valid move destinations even when empty. */
  scanPaths: string[];
  /** Pre-filled destination, e.g. the folder a drag landed on. */
  initialTarget?: string | null;
  onMoved?: (result: MoveResult) => void;
}

export function MoveDialog({
  open,
  onOpenChange,
  slugs,
  repos,
  scanPaths,
  initialTarget,
  onMoved,
}: MoveDialogProps) {
  const [target, setTarget] = React.useState<string>(initialTarget ?? "");
  const [result, setResult] = React.useState<MoveResult | null>(null);

  // Re-seed whenever the dialog is opened for a new drop target, and
  // clear any previous run's result so the user never sees a stale
  // "moved 3 repos" above a fresh selection.
  React.useEffect(() => {
    if (!open) return;
    setTarget(initialTarget ?? "");
    setResult(null);
  }, [open, initialTarget]);

  const folders = React.useMemo(() => {
    const forest = buildRepoForest(repos, scanPaths);
    const paths = forest.roots.flatMap((root) =>
      [...walkTree(root)].map((node) => node.path),
    );
    return [...new Set(paths)].filter(Boolean).sort();
  }, [repos, scanPaths]);

  const rootPath = folders[0] ?? "";
  const check = useMoveCheck(slugs, target || null);
  const move = useMoveRepos();

  const entries = check.data?.entries ?? [];
  const movable = check.data?.movableCount ?? 0;
  const blocked = check.data?.blockedCount ?? 0;

  const shortPath = (path: string) => tildify(path);

  const handleConfirm = async () => {
    if (!target || movable === 0) return;
    const outcome = await move.mutateAsync({ slugs, targetDir: target });
    setResult(outcome);
    onMoved?.(outcome);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderInput className="h-4 w-4 text-accent" aria-hidden />
            Move {slugs.length} {slugs.length === 1 ? "repo" : "repos"}
          </DialogTitle>
          <DialogDescription>
            Folders are moved on disk with <code>rename</code>, and the catalog
            is updated to match. Anything risky is blocked below rather than
            attempted.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <MoveOutcome result={result} shortPath={shortPath} />
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="move-target"
                className="font-mono atr-label uppercase tracking-wider text-muted-foreground"
              >
                Destination folder
              </label>
              <input
                id="move-target"
                list="move-target-options"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder={rootPath ? `${rootPath}/…` : "Absolute path"}
                spellCheck={false}
                className="h-9 w-full rounded-md border border-border bg-input px-3 font-mono text-xs text-foreground transition-colors duration-150 hover:border-border-strong focus:border-accent"
              />
              <datalist id="move-target-options">
                {folders.map((folder) => (
                  <option key={folder} value={folder} />
                ))}
              </datalist>
              <p className="atr-label text-muted-foreground">
                Pick an existing folder or type a new one inside your scan
                roots. It will be created if it doesn&apos;t exist.
              </p>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-md border border-border">
              {check.isFetching && entries.length === 0 ? (
                <p className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Checking…
                </p>
              ) : entries.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground">
                  Choose a destination to preview the move.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {entries.map((entry) => (
                    <li
                      key={entry.slug}
                      className={cn(
                        "flex items-start gap-2 px-3 py-2",
                        !entry.ok && "bg-destructive/5",
                      )}
                    >
                      {entry.ok ? (
                        <Check
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent"
                          aria-hidden
                        />
                      ) : (
                        <AlertTriangle
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
                          aria-hidden
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="atr-truncate font-mono text-xs text-foreground">
                          {entry.name}
                        </p>
                        {entry.ok ? (
                          <p className="flex min-w-0 items-center gap-1 font-mono atr-micro text-muted-foreground">
                            <span className="truncate">
                              {shortPath(entry.fromPath)}
                            </span>
                            <ArrowRight
                              className="h-2.5 w-2.5 shrink-0"
                              aria-hidden
                            />
                            <span className="truncate">
                              {shortPath(entry.toPath)}
                            </span>
                          </p>
                        ) : (
                          <p className="atr-label text-warning">
                            {describeBlockers(entry.blockers)}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {move.isError ? (
              <p role="alert" className="text-xs text-destructive">
                {(move.error as Error).message}
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <p className="atr-meta">
                {movable} ready
                {blocked > 0 ? ` · ${blocked} blocked` : ""}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={movable === 0 || move.isPending}
                >
                  {move.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : null}
                  Move {movable} {movable === 1 ? "repo" : "repos"}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Blocker copy lives here as well as in the main process because the
 * renderer shows per-blocker reasons on the preflight, where the main
 * process only joins them for the error string on a failed entry.
 */
const BLOCKER_COPY: Record<string, string> = {
  missing: "The folder is no longer on disk",
  dirty: "Uncommitted changes — commit or stash first",
  "running-process": "Something is running from this folder",
  "destination-exists": "A folder with that name is already there",
  "target-outside-roots": "Destination is outside your scan folders",
  "target-inside-source": "Can't move a folder inside itself",
  "same-location": "Already in that folder",
  "cross-device": "Destination is on a different volume",
  "unknown-repo": "Not in the catalog",
};

function describeBlockers(blockers: readonly string[]): string {
  return blockers.map((b) => BLOCKER_COPY[b] ?? b).join(" · ");
}

function MoveOutcome({
  result,
  shortPath,
}: {
  result: MoveResult;
  shortPath: (path: string) => string;
}) {
  const failures = result.entries.filter((entry) => !entry.moved);
  return (
    <div className="flex flex-col gap-3">
      <p
        className={cn(
          "flex items-center gap-2 text-sm",
          result.failedCount === 0 ? "text-accent" : "text-warning",
        )}
      >
        {result.failedCount === 0 ? (
          <Check className="h-4 w-4" aria-hidden />
        ) : (
          <AlertTriangle className="h-4 w-4" aria-hidden />
        )}
        Moved {result.movedCount} of {result.entries.length}
        {result.failedCount > 0 ? ` — ${result.failedCount} left in place` : ""}
      </p>

      {failures.length > 0 ? (
        <ul className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
          {failures.map((entry) => (
            <li key={entry.slug} className="px-3 py-2">
              <p className="font-mono text-xs text-foreground">{entry.slug}</p>
              <p className="atr-label text-warning">{entry.error}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="atr-meta">
        Destination: {shortPath(result.targetDir)}
        {result.batchId ? " · this batch can be undone from the toolbar" : ""}
      </p>
    </div>
  );
}
