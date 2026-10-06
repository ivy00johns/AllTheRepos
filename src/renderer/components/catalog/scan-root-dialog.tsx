/**
 * Stop-scanning confirmation.
 *
 * Removing a scan root is not destructive on disk, but it CAN be
 * destructive to catalog metadata — the tags, groups and notes attached
 * to the repos found there. So the dialog states both facts plainly:
 * how many repos are involved, and that their files are never touched.
 *
 * The choice between forgetting and keeping is offered explicitly rather
 * than assumed, because both are reasonable: forgetting tidies up, and
 * keeping preserves work you did on repos you still own.
 */

import * as React from "react";
import { AlertTriangle, FolderMinus } from "lucide-react";

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
  useCountUnder,
  useRemoveScanPath,
} from "@renderer/hooks/use-scan-roots";

interface ScanRootDialogProps {
  /** Path being removed, or `null` when the dialog is closed. */
  path: string | null;
  onOpenChange: (open: boolean) => void;
  onRemoved?: () => void;
}

export function ScanRootDialog({
  path,
  onOpenChange,
  onRemoved,
}: ScanRootDialogProps) {
  const [forget, setForget] = React.useState(true);
  const countQuery = useCountUnder(path);
  const remove = useRemoveScanPath();
  const count = countQuery.data ?? 0;

  // Default back to "forget" each time — it's the common intent, and a
  // sticky choice from a previous removal would be a trap.
  React.useEffect(() => {
    if (path) setForget(true);
  }, [path]);

  const handleConfirm = async () => {
    if (!path) return;
    await remove.mutateAsync({ path, forgetRepos: forget });
    onRemoved?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={Boolean(path)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderMinus className="h-4 w-4 text-warning" aria-hidden />
            Stop scanning this folder
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{path ? tildify(path) : ""}</span> will
            no longer be searched for repos. Nothing on disk is deleted,
            whichever option you pick.
          </DialogDescription>
        </DialogHeader>

        {count > 0 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">
              What to do with the {count} repos already found here
            </legend>
            {[
              {
                value: true,
                label: `Also forget the ${count} ${count === 1 ? "repo" : "repos"} found here`,
                hint: "Removes them from the catalog, along with their tags and group memberships. The folders stay on disk.",
              },
              {
                value: false,
                label: "Keep them in the catalog",
                hint: "They'll appear under \"Outside scan folders\" and won't be refreshed by future scans.",
              },
            ].map((option) => (
              <label
                key={String(option.value)}
                className={cn(
                  "flex cursor-pointer gap-2 rounded-md border p-3 transition-colors duration-150",
                  forget === option.value
                    ? "border-accent bg-surface-raised"
                    : "border-border hover:border-border-strong",
                )}
              >
                <input
                  type="radio"
                  name="forget-repos"
                  className="mt-0.5 cursor-pointer accent-[var(--color-accent)]"
                  checked={forget === option.value}
                  onChange={() => setForget(option.value)}
                />
                <span className="min-w-0">
                  <span className="block text-xs text-foreground">
                    {option.label}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {option.hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="atr-meta">No repos have been catalogued here.</p>
        )}

        {remove.isError ? (
          <p
            role="alert"
            className="flex items-center gap-2 text-xs text-destructive"
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {(remove.error as Error).message}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={remove.isPending}
          >
            Stop scanning
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
