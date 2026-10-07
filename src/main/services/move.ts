/**
 * Repo relocation — move repositories on disk, safely.
 *
 * This is the only part of the app that mutates the user's filesystem,
 * so it is built around one rule: never lose work, and never surprise
 * the user.
 *
 * How that rule is enforced:
 *
 *  - **Preflight.** `check()` returns a per-repo verdict BEFORE anything
 *    moves. The UI shows it, so a blocked repo is visible up front
 *    rather than as a failure halfway through a batch.
 *  - **Refuse on risk.** Uncommitted changes, a running dev server, a
 *    destination that already exists, a source that's already gone, or a
 *    target outside the configured scan roots all block the move.
 *  - **Rename only.** `fs.rename` is atomic within a volume. A
 *    cross-device move would mean copy-then-delete, which has a window
 *    where the data exists twice and a failure mode where it exists
 *    zero times — so it is refused instead of attempted.
 *  - **Undo log.** Every completed move is journaled to disk with its
 *    original path, so the last batch can be reversed even after a
 *    restart.
 *  - **Partial success is reported honestly.** A batch where three of
 *    five moved returns exactly that; it never reports success for the
 *    whole batch.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { getSqlite } from "@main/db/client";
import { catalogService } from "@main/services/catalog";
import { invalidateCover } from "@main/services/cover";
import { processService } from "@main/services/process";
import { getSettings } from "@main/services/settings";
import {
  appendBatch,
  findEntry,
  lastEntry,
  removeBatch,
  type RepoMoveRecord,
} from "./relocation-journal";

/** Why a repo cannot be moved. Ordered most- to least- severe. */
export type MoveBlocker =
  | "missing"
  | "dirty"
  | "running-process"
  | "destination-exists"
  | "target-outside-roots"
  | "target-inside-source"
  | "same-location"
  | "cross-device"
  | "unknown-repo";

export interface MoveCheckEntry {
  slug: string;
  name: string;
  fromPath: string;
  toPath: string;
  ok: boolean;
  blockers: MoveBlocker[];
}

export interface MoveCheckResult {
  targetDir: string;
  entries: MoveCheckEntry[];
  movableCount: number;
  blockedCount: number;
}

export interface MoveEntryResult {
  slug: string;
  moved: boolean;
  fromPath: string;
  toPath: string;
  error: string | null;
}

export interface MoveResult {
  targetDir: string;
  entries: MoveEntryResult[];
  movedCount: number;
  failedCount: number;
  /** Identifier for the journaled batch, usable with `undo()`. */
  batchId: string | null;
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.stat(candidate);
    return true;
  } catch {
    return false;
  }
}

function isInside(child: string, parent: string): boolean {
  const withSep = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child === parent || child.startsWith(withSep);
}

/**
 * Update the stored path for a repo.
 *
 * Written as raw SQL rather than through Drizzle because the catalog
 * service has no path-mutation method and adding one would widen its
 * public surface for a single caller. The slug is unchanged — it's the
 * stable identity that groups, tags and the vector index all key on.
 */
function updateStoredPath(slug: string, toPath: string): void {
  const sqlite = getSqlite();
  sqlite
    .prepare("UPDATE repos SET full_path = ?, updated_at = ? WHERE slug = ?")
    .run(toPath, new Date().toISOString(), slug);
}

class MoveService {
  /**
   * Directories a repo is allowed to be moved into: the configured scan
   * roots, plus anywhere beneath them.
   *
   * Without this, a mistyped target could scatter repos into directories
   * the scanner never looks at, and they'd vanish from the catalog on
   * the next scan.
   */
  private async allowedRoots(): Promise<string[]> {
    const settings = getSettings();
    const roots = settings.scanPaths
      .filter(Boolean)
      .map((root: string) => path.resolve(root));
    if (roots.length > 0) return roots;
    // No configured roots yet: fall back to the common ancestor of the
    // catalog so the feature still works on a fresh install.
    const listed = await catalogService.list({ limit: 200 });
    const dirs = listed.items.map((r) => path.dirname(r.fullPath));
    if (dirs.length === 0) return [];
    let common = dirs[0];
    for (const dir of dirs) {
      while (!isInside(dir, common)) {
        const parent = path.dirname(common);
        if (parent === common) return [];
        common = parent;
      }
    }
    return [common];
  }

  async check(slugs: string[], targetDir: string): Promise<MoveCheckResult> {
    const resolvedTarget = path.resolve(targetDir);
    const roots = await this.allowedRoots();
    const targetAllowed =
      roots.length > 0 && roots.some((root) => isInside(resolvedTarget, root));

    const entries: MoveCheckEntry[] = [];

    // One snapshot for the batch rather than one lookup per repo — the
    // per-repo call re-filters the same list every time, so a 50-repo
    // selection did fifty passes over it for no extra information.
    const snapshot = await processService.list();
    const busySlugs = new Set(
      snapshot.processes
        .map((p) => p.repoSlug)
        .filter((slug): slug is string => Boolean(slug)),
    );

    for (const slug of slugs) {
      const repo = await catalogService.getRepoLite(slug);
      if (!repo) {
        entries.push({
          slug,
          name: slug,
          fromPath: "",
          toPath: "",
          ok: false,
          blockers: ["unknown-repo"],
        });
        continue;
      }

      const fromPath = path.resolve(repo.fullPath);
      const toPath = path.join(resolvedTarget, path.basename(fromPath));
      const blockers: MoveBlocker[] = [];

      if (!(await pathExists(fromPath))) blockers.push("missing");
      if (repo.isDirty) blockers.push("dirty");

      if (busySlugs.has(slug)) blockers.push("running-process");

      if (fromPath === toPath) blockers.push("same-location");
      if (!targetAllowed) blockers.push("target-outside-roots");
      if (isInside(resolvedTarget, fromPath)) {
        blockers.push("target-inside-source");
      }
      if (fromPath !== toPath && (await pathExists(toPath))) {
        blockers.push("destination-exists");
      }

      entries.push({
        slug,
        name: repo.name,
        fromPath,
        toPath,
        ok: blockers.length === 0,
        blockers,
      });
    }

    return {
      targetDir: resolvedTarget,
      entries,
      movableCount: entries.filter((e) => e.ok).length,
      blockedCount: entries.filter((e) => !e.ok).length,
    };
  }

  /**
   * Execute a move batch.
   *
   * Re-runs `check()` internally: the preflight the user saw may be
   * seconds old, and a dev server started in the meantime must still
   * block the move.
   */
  async move(slugs: string[], targetDir: string): Promise<MoveResult> {
    const preflight = await this.check(slugs, targetDir);
    const results: MoveEntryResult[] = [];
    const journaled: RepoMoveRecord[] = [];

    // Create the destination only once we know something can go into it.
    if (preflight.movableCount > 0) {
      await fs.mkdir(preflight.targetDir, { recursive: true });
    }

    for (const entry of preflight.entries) {
      if (!entry.ok) {
        results.push({
          slug: entry.slug,
          moved: false,
          fromPath: entry.fromPath,
          toPath: entry.toPath,
          error: describeBlockers(entry.blockers),
        });
        continue;
      }

      try {
        await fs.rename(entry.fromPath, entry.toPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        results.push({
          slug: entry.slug,
          moved: false,
          fromPath: entry.fromPath,
          toPath: entry.toPath,
          error:
            code === "EXDEV"
              ? "Source and destination are on different volumes — move it in Finder instead."
              : `Move failed: ${(error as Error).message}`,
        });
        continue;
      }

      updateStoredPath(entry.slug, entry.toPath);
      invalidateCover(entry.slug);
      journaled.push({
        slug: entry.slug,
        fromPath: entry.fromPath,
        toPath: entry.toPath,
      });
      results.push({
        slug: entry.slug,
        moved: true,
        fromPath: entry.fromPath,
        toPath: entry.toPath,
        error: null,
      });
    }

    let batchId: string | null = null;
    if (journaled.length > 0) {
      batchId = await appendBatch({ kind: "repos", moves: journaled });
    }

    return {
      targetDir: preflight.targetDir,
      entries: results,
      movedCount: results.filter((r) => r.moved).length,
      failedCount: results.filter((r) => !r.moved).length,
      batchId,
    };
  }

  /**
   * Reverse a journaled batch.
   *
   * Reversal is itself guarded: a repo that has been moved again since,
   * or whose original location is now occupied, is left alone and
   * reported rather than overwritten.
   */
  async undo(batchId?: string): Promise<MoveResult> {
    const batch = await findEntry(batchId);

    if (!batch) {
      return {
        targetDir: "",
        entries: [],
        movedCount: 0,
        failedCount: 0,
        batchId: null,
      };
    }

    // A folder batch is ONE directory rename plus bookkeeping, and a
    // create is a single mkdir — neither can be reversed by walking the
    // per-repo records, so they get their own paths.
    if (batch.kind === "folder" && batch.folder) {
      return this.undoFolderBatch(batch.batchId, batch.folder, batch.moves);
    }
    if (batch.kind === "create" && batch.folder) {
      return this.undoCreateBatch(batch.batchId, batch.folder);
    }

    const results: MoveEntryResult[] = [];
    for (const move of batch.moves) {
      const reverted: MoveEntryResult = {
        slug: move.slug,
        moved: false,
        fromPath: move.toPath,
        toPath: move.fromPath,
        error: null,
      };

      if (!(await pathExists(move.toPath))) {
        reverted.error = "No longer at the moved-to path — skipped.";
        results.push(reverted);
        continue;
      }
      if (await pathExists(move.fromPath)) {
        reverted.error = "Something else now occupies the original path.";
        results.push(reverted);
        continue;
      }

      try {
        await fs.mkdir(path.dirname(move.fromPath), { recursive: true });
        await fs.rename(move.toPath, move.fromPath);
        updateStoredPath(move.slug, move.fromPath);
        invalidateCover(move.slug);
        reverted.moved = true;
      } catch (error) {
        reverted.error = `Undo failed: ${(error as Error).message}`;
      }
      results.push(reverted);
    }

    // Drop the batch only if it fully reverted; a partial undo stays in
    // the journal so the remainder can be retried.
    if (results.every((r) => r.moved)) {
      await removeBatch(batch.batchId);
    }

    return {
      targetDir: "",
      entries: results,
      movedCount: results.filter((r) => r.moved).length,
      failedCount: results.filter((r) => !r.moved).length,
      batchId: batch.batchId,
    };
  }

  /**
   * Reverse a folder rename or move: rename the directory back, then
   * re-point every catalog row that travelled with it.
   *
   * Guarded the same way a repo undo is — if the folder isn't where we
   * left it, or something now occupies its old location, we report
   * rather than overwrite.
   */
  private async undoFolderBatch(
    batchId: string,
    folder: { fromPath: string; toPath: string },
    moves: RepoMoveRecord[],
  ): Promise<MoveResult> {
    const entry: MoveEntryResult = {
      slug: path.basename(folder.toPath),
      moved: false,
      fromPath: folder.toPath,
      toPath: folder.fromPath,
      error: null,
    };

    if (!(await pathExists(folder.toPath))) {
      entry.error = "That folder is no longer where it was moved to.";
    } else if (await pathExists(folder.fromPath)) {
      entry.error = "Something else now occupies the original location.";
    } else {
      try {
        await fs.mkdir(path.dirname(folder.fromPath), { recursive: true });
        await fs.rename(folder.toPath, folder.fromPath);
        for (const move of moves) {
          updateStoredPath(move.slug, move.fromPath);
          invalidateCover(move.slug);
        }
        entry.moved = true;
      } catch (error) {
        entry.error = `Undo failed: ${(error as Error).message}`;
      }
    }

    if (entry.moved) await removeBatch(batchId);
    return {
      targetDir: path.dirname(folder.fromPath),
      entries: [entry],
      movedCount: entry.moved ? 1 : 0,
      failedCount: entry.moved ? 0 : 1,
      batchId,
    };
  }

  /**
   * Reverse a folder creation.
   *
   * Deliberately conservative: `rmdir` without `recursive`, so a folder
   * you have since put something into is left alone. Undo must never be
   * a way to lose work you did after the thing being undone.
   */
  private async undoCreateBatch(
    batchId: string,
    folder: { fromPath: string; toPath: string },
  ): Promise<MoveResult> {
    const entry: MoveEntryResult = {
      slug: path.basename(folder.toPath),
      moved: false,
      fromPath: folder.toPath,
      toPath: folder.toPath,
      error: null,
    };

    if (!(await pathExists(folder.toPath))) {
      // Already gone — the outcome the user wanted, so treat it as done.
      entry.moved = true;
    } else {
      try {
        await fs.rmdir(folder.toPath);
        entry.moved = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        entry.error =
          code === "ENOTEMPTY"
            ? "That folder isn't empty any more, so it was left in place."
            : `Couldn't remove the folder: ${(error as Error).message}`;
      }
    }

    if (entry.moved) await removeBatch(batchId);
    return {
      targetDir: folder.fromPath,
      entries: [entry],
      movedCount: entry.moved ? 1 : 0,
      failedCount: entry.moved ? 0 : 1,
      batchId,
    };
  }

  /**
   * The most recent journaled batch, for the undo affordance.
   *
   * `count` is what the UI shows, so a folder batch reports 1 (one
   * folder) rather than the number of repos that rode along with it.
   */
  async lastBatch(): Promise<{
    batchId: string;
    at: string;
    count: number;
    kind: "repos" | "folder" | "create";
    label: string;
  } | null> {
    const last = await lastEntry();
    if (!last) return null;
    const kind = last.kind ?? "repos";
    if (kind === "folder" && last.folder) {
      return {
        batchId: last.batchId,
        at: last.at,
        count: 1,
        kind,
        label: `moved ${path.basename(last.folder.toPath)}`,
      };
    }
    if (kind === "create" && last.folder) {
      return {
        batchId: last.batchId,
        at: last.at,
        count: 1,
        kind,
        label: `created ${path.basename(last.folder.toPath)}`,
      };
    }
    return {
      batchId: last.batchId,
      at: last.at,
      count: last.moves.length,
      kind: "repos",
      label: `moved ${last.moves.length} ${last.moves.length === 1 ? "repo" : "repos"}`,
    };
  }
}

const BLOCKER_MESSAGES: Record<MoveBlocker, string> = {
  missing: "The folder is no longer on disk",
  dirty: "Uncommitted changes — commit or stash first",
  "running-process": "A process is running from this folder",
  "destination-exists": "A folder with that name is already there",
  "target-outside-roots": "Target is outside your scan folders",
  "target-inside-source": "Can't move a folder inside itself",
  "same-location": "Already in that folder",
  "cross-device": "Destination is on a different volume",
  "unknown-repo": "Not in the catalog",
};

export function describeBlockers(blockers: MoveBlocker[]): string {
  return blockers.map((b) => BLOCKER_MESSAGES[b]).join("; ");
}

export const moveService = new MoveService();
