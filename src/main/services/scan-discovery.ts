/**
 * Repository discovery for a scan: which repositories live under these roots.
 *
 * Why this is not just a call to `find-git-repositories`:
 *
 * The native walker stops at the first `.git` it meets — it detects the
 * directory, records it, and does **not** queue that directory's children
 * (`node_modules/find-git-repositories/cpp/src/FindGitRepos.cpp`, the
 * `if (!isGitRepo) foundPaths.splice(...)` at the end of the loop). That is
 * right for a folder full of projects, and wrong for the one case where the
 * scan root is itself a repository: pointing the app at `~/Repos` after an
 * accidental `git init` there indexed exactly one repository, showed a green
 * "done · 1 repos", and hid every project underneath it (ATR-033, audit SC-1).
 *
 * The fix is the audit's first suggestion, pre-expand the root: when the root
 * carries a `.git` directory, search each of its child directories on its own.
 * Those children are outside the root's `.git`, so the walker descends into
 * them normally, and a root that is not a repository is still one walk.
 *
 * What this does not do: a repository found *inside* another repository is
 * still a leaf, because the walker prunes there too. Pre-expanding every
 * repository would walk the contents of every `node_modules` in the catalog
 * to find a shape that is rare outside vendored checkouts, which is why that
 * half of SC-1 is not taken here.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { canonicalPath } from "./metadata";

/**
 * The shape of `find-git-repositories` this module needs.
 *
 * Injected rather than required so the discovery rules can be tested against
 * the real walker (and against a fake one) without loading a worker thread.
 */
export type FindGitRepos = (
  rootPath: string,
  progress?: (paths: string[]) => void,
) => Promise<string[]>;

export interface DiscoverOptions {
  /** Scan roots exactly as configured. Resolved and de-duplicated here. */
  roots: string[];
  /** Roots to skip, compared after `canonicalPath`. */
  ignorePaths?: string[];
  findGitRepos: FindGitRepos;
  /** Consulted between roots, between children, and between results. */
  isCancelled?: () => boolean;
  /** A root that could not be searched. The scan continues with the others. */
  onError?: (root: string, error: unknown) => void;
}

/** Repo roots (not `.git` paths), canonical, in discovery order. */
export async function discoverRepoRoots({
  roots,
  ignorePaths = [],
  findGitRepos,
  isCancelled,
  onError,
}: DiscoverOptions): Promise<string[]> {
  const ignoreSet = new Set(ignorePaths.map((p) => canonicalPath(p)));
  const discovered: string[] = [];
  const seen = new Set<string>();

  /** `find-git-repositories` answers with `.git` paths; the catalog wants roots. */
  function record(gitDirs: string[]): void {
    for (const gitDir of gitDirs) {
      if (isCancelled?.()) return;
      const repoRoot = canonicalPath(
        gitDir.endsWith("/.git") || gitDir.endsWith(path.sep + ".git")
          ? gitDir.slice(0, -5)
          : gitDir,
      );
      if (seen.has(repoRoot) || ignoreSet.has(repoRoot)) continue;
      seen.add(repoRoot);
      discovered.push(repoRoot);
    }
  }

  for (const raw of roots) {
    if (isCancelled?.()) break;
    if (!raw || typeof raw !== "string") continue;

    const root = canonicalPath(raw);
    if (ignoreSet.has(root)) continue;

    try {
      record(await findGitRepos(root, () => {}));

      // A scan root that is itself a repository is the one shape the walker
      // cannot see past. Ask about each child instead: the root's own `.git`
      // no longer stands between the walker and the projects below it.
      if (await isRepositoryRoot(root)) {
        for (const child of await childDirectories(root)) {
          if (isCancelled?.()) break;
          if (ignoreSet.has(child)) continue;
          record(await findGitRepos(child, () => {}));
        }
      }
    } catch (error) {
      onError?.(root, error);
    }
  }

  return discovered;
}

/** Is `dir` a repository, as opposed to a folder that merely contains some? */
async function isRepositoryRoot(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(dir, ".git"));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Direct child directories, without `.git` and without following symlinks —
 * the same entries the native walker would queue at this level.
 */
async function childDirectories(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name !== ".git")
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}
