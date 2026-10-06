/**
 * Folder restructuring — create, rename and move directories on disk.
 *
 * Moving a repo relocates one project. Moving a FOLDER can relocate
 * forty, so the safety model is the same as `move.ts` but applied to
 * every repo in the subtree: if any one of them is dirty or has a
 * process running, the whole operation is blocked and says which.
 * Partially restructuring a tree is worse than not restructuring it.
 *
 * The mechanics differ from a repo move in one important way: this is
 * ONE `fs.rename` of the directory, not N renames. Everything inside —
 * repos, loose files, nested folders — travels with it atomically. What
 * fans out is the bookkeeping: every catalog row beneath the folder has
 * to be re-pointed at its new path afterwards.
 *
 * Every operation is journaled into the shared relocation log, so undo
 * works exactly as it does for repo moves.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { checkFolderName } from "@shared/folder-name";

import { getSqlite } from "@main/db/client";
import { invalidateCover } from "@main/services/cover";
import { processService } from "@main/services/process";
import { getSettings } from "@main/services/settings";
import { appendBatch, type RepoMoveRecord } from "./relocation-journal";

/** Why a folder operation is refused. */
export type FolderBlocker =
  | "missing"
  | "not-a-directory"
  | "invalid-name"
  | "destination-exists"
  | "target-outside-roots"
  | "target-inside-source"
  | "same-location"
  | "is-scan-root"
  | "dirty-repos"
  | "running-processes";

export interface AffectedRepo {
  slug: string;
  name: string;
  fromPath: string;
  toPath: string;
  isDirty: boolean;
  hasProcess: boolean;
}

export interface FolderCheckResult {
  fromPath: string;
  toPath: string;
  /** Repos that would be relocated by the rename. */
  affected: AffectedRepo[];
  blockers: FolderBlocker[];
  ok: boolean;
}

export interface FolderOpResult {
  ok: boolean;
  fromPath: string;
  toPath: string;
  movedRepos: number;
  batchId: string | null;
  error: string | null;
}

const BLOCKER_MESSAGES: Record<FolderBlocker, string> = {
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

export function describeFolderBlockers(blockers: FolderBlocker[]): string {
  return blockers.map((b) => BLOCKER_MESSAGES[b]).join("; ");
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

function scanRoots(): string[] {
  return getSettings()
    .scanPaths.filter(Boolean)
    .map((root: string) => path.resolve(root).replace(/\/+$/, ""));
}

interface RepoRow {
  slug: string;
  name: string;
  full_path: string;
  is_dirty: number;
}

/**
 * Every catalog row living beneath `dir`.
 *
 * Matched with a `LIKE` on the path prefix rather than by loading the
 * whole table; the trailing slash is what stops `~/Repos/ai` from also
 * claiming `~/Repos/ai-tools`.
 */
function reposUnder(dir: string): RepoRow[] {
  const sqlite = getSqlite();
  const prefix = `${dir.replace(/\/+$/, "")}/`;
  return sqlite
    .prepare(
      "SELECT slug, name, full_path, is_dirty FROM repos WHERE full_path LIKE ? ESCAPE '\\' ORDER BY full_path",
    )
    .all(`${prefix.replace(/[\\%_]/g, "\\$&")}%`) as RepoRow[];
}

/** Re-point one catalog row after its containing folder moved. */
function updateStoredPath(slug: string, toPath: string): void {
  getSqlite()
    .prepare("UPDATE repos SET full_path = ?, updated_at = ? WHERE slug = ?")
    .run(toPath, new Date().toISOString(), slug);
}

class FolderService {
  /**
   * Preflight a folder rename or move. Reads only.
   *
   * `toPath` is computed by the caller-facing wrappers so this one
   * function backs both operations — a rename is just a move whose
   * destination parent happens to be the current one.
   */
  async check(fromRaw: string, toRaw: string): Promise<FolderCheckResult> {
    const fromPath = path.resolve(fromRaw).replace(/\/+$/, "");
    const toPath = path.resolve(toRaw).replace(/\/+$/, "");
    const blockers: FolderBlocker[] = [];

    const nameCheck = checkFolderName(path.basename(toPath));
    if (!nameCheck.ok) blockers.push("invalid-name");

    try {
      const stat = await fs.stat(fromPath);
      if (!stat.isDirectory()) blockers.push("not-a-directory");
    } catch {
      blockers.push("missing");
    }

    const roots = scanRoots();
    if (roots.includes(fromPath)) blockers.push("is-scan-root");
    if (!roots.some((root) => isInside(toPath, root))) {
      blockers.push("target-outside-roots");
    }
    if (fromPath === toPath) blockers.push("same-location");
    // `isInside` is true for equality too, which `same-location` already
    // covers — only a STRICT descendant is the self-nesting case.
    if (toPath !== fromPath && isInside(toPath, fromPath)) {
      blockers.push("target-inside-source");
    }
    if (fromPath !== toPath && (await pathExists(toPath))) {
      blockers.push("destination-exists");
    }

    const rows = reposUnder(fromPath);
    const affected: AffectedRepo[] = [];
    let anyDirty = false;
    let anyRunning = false;

    // ONE process snapshot for the whole subtree. Asking per repo made
    // the preflight scale with folder size — on a folder of fifteen
    // repos the dialog sat on "Checking…" long enough to look hung.
    const snapshot = await processService.list();
    const busySlugs = new Set(
      snapshot.processes
        .map((p) => p.repoSlug)
        .filter((slug): slug is string => Boolean(slug)),
    );

    for (const row of rows) {
      const hasProcess = busySlugs.has(row.slug);
      const isDirty = Boolean(row.is_dirty);
      if (isDirty) anyDirty = true;
      if (hasProcess) anyRunning = true;
      affected.push({
        slug: row.slug,
        name: row.name,
        fromPath: row.full_path,
        toPath: toPath + row.full_path.slice(fromPath.length),
        isDirty,
        hasProcess,
      });
    }

    if (anyDirty) blockers.push("dirty-repos");
    if (anyRunning) blockers.push("running-processes");

    return { fromPath, toPath, affected, blockers, ok: blockers.length === 0 };
  }

  /** Rename a folder in place. */
  async rename(fromRaw: string, newName: string): Promise<FolderOpResult> {
    const fromPath = path.resolve(fromRaw).replace(/\/+$/, "");
    const nameCheck = checkFolderName(newName);
    if (!nameCheck.ok) {
      return {
        ok: false,
        fromPath,
        toPath: fromPath,
        movedRepos: 0,
        batchId: null,
        error: nameCheck.message,
      };
    }
    return this.relocate(
      fromPath,
      path.join(path.dirname(fromPath), nameCheck.normalized),
    );
  }

  /** Move a folder into a different parent, keeping its name. */
  async moveInto(fromRaw: string, parentRaw: string): Promise<FolderOpResult> {
    const fromPath = path.resolve(fromRaw).replace(/\/+$/, "");
    const parent = path.resolve(parentRaw).replace(/\/+$/, "");
    return this.relocate(fromPath, path.join(parent, path.basename(fromPath)));
  }

  /**
   * The shared execution path for rename and move.
   *
   * Re-runs the preflight rather than trusting the one the UI showed:
   * a dev server can start, or a file can change, between the dialog
   * opening and the button being pressed.
   */
  private async relocate(
    fromPath: string,
    toPath: string,
  ): Promise<FolderOpResult> {
    const preflight = await this.check(fromPath, toPath);
    if (!preflight.ok) {
      return {
        ok: false,
        fromPath,
        toPath,
        movedRepos: 0,
        batchId: null,
        error: describeFolderBlockers(preflight.blockers),
      };
    }

    try {
      await fs.mkdir(path.dirname(toPath), { recursive: true });
      await fs.rename(fromPath, toPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {
        ok: false,
        fromPath,
        toPath,
        movedRepos: 0,
        batchId: null,
        error:
          code === "EXDEV"
            ? "Source and destination are on different volumes — move it in Finder instead."
            : `Move failed: ${(error as Error).message}`,
      };
    }

    // The rename already happened, so the bookkeeping below must not be
    // allowed to fail the operation — a re-point that throws would leave
    // the catalog stale, which a rescan fixes, whereas reporting failure
    // after a successful rename would be a lie.
    const moves: RepoMoveRecord[] = preflight.affected.map((repo) => ({
      slug: repo.slug,
      fromPath: repo.fromPath,
      toPath: repo.toPath,
    }));
    for (const move of moves) {
      try {
        updateStoredPath(move.slug, move.toPath);
        invalidateCover(move.slug);
      } catch (error) {
        console.error("[folder] failed to re-point catalog row", error);
      }
    }

    const batchId = await appendBatch({
      kind: "folder",
      folder: { fromPath, toPath },
      moves,
    });

    return {
      ok: true,
      fromPath,
      toPath,
      movedRepos: moves.length,
      batchId,
      error: null,
    };
  }

  /**
   * Create an empty folder.
   *
   * Journaled like everything else so undo is uniform, but the undo is
   * conservative: it only removes the directory if it's still empty, so
   * an undo pressed after you've filled it can't delete your work.
   */
  async create(parentRaw: string, name: string): Promise<FolderOpResult> {
    const parent = path.resolve(parentRaw).replace(/\/+$/, "");
    const nameCheck = checkFolderName(name);
    if (!nameCheck.ok) {
      return {
        ok: false,
        fromPath: parent,
        toPath: parent,
        movedRepos: 0,
        batchId: null,
        error: nameCheck.message,
      };
    }

    const toPath = path.join(parent, nameCheck.normalized);
    const roots = scanRoots();
    if (!roots.some((root) => isInside(toPath, root))) {
      return {
        ok: false,
        fromPath: parent,
        toPath,
        movedRepos: 0,
        batchId: null,
        error: BLOCKER_MESSAGES["target-outside-roots"],
      };
    }
    if (await pathExists(toPath)) {
      return {
        ok: false,
        fromPath: parent,
        toPath,
        movedRepos: 0,
        batchId: null,
        error: BLOCKER_MESSAGES["destination-exists"],
      };
    }

    try {
      await fs.mkdir(toPath, { recursive: false });
    } catch (error) {
      return {
        ok: false,
        fromPath: parent,
        toPath,
        movedRepos: 0,
        batchId: null,
        error: `Couldn't create the folder: ${(error as Error).message}`,
      };
    }

    const batchId = await appendBatch({
      kind: "create",
      folder: { fromPath: parent, toPath },
      moves: [],
    });

    return {
      ok: true,
      fromPath: parent,
      toPath,
      movedRepos: 0,
      batchId,
      error: null,
    };
  }
}

export const folderService = new FolderService();
