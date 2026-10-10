/**
 * Directory tree derivation.
 *
 * The folders a developer sorts their repos into are hand-curated
 * taxonomy — `ai-tools-and-frameworks/agent-frameworks`, `work-tricentis`,
 * `_archive/duplicates`. That structure is the single richest organising
 * signal on the machine, and the old catalog threw all of it away in
 * favour of a flat grid.
 *
 * This module rebuilds the tree from `Repo.fullPath` alone. No new
 * backend data, no rescan — the paths were always there.
 *
 * PURE module: no DOM, no Node, no IPC.
 */

import type { Repo } from "@shared/types";

export interface TreeNode {
  /** Absolute directory path. */
  path: string;
  /** Final path segment — what's shown in the rail. */
  name: string;
  /** Depth below the display root (root itself is 0). */
  depth: number;
  /** Child directories, sorted. */
  children: TreeNode[];
  /** Repos living directly in this directory. */
  repos: Repo[];
  /** Repos in this directory and every descendant. */
  totalRepos: number;
  /** Dirty repos in this subtree — surfaced as a rail badge. */
  dirtyCount: number;
  /** Repos in this subtree whose path no longer exists on disk. */
  missingCount: number;
  /** True for a node that IS a configured scan root. */
  isScanRoot?: boolean;
  /**
   * True for a synthesized root holding repos that live outside every
   * configured scan root — surfaced rather than hidden, because a repo
   * the scanner will never revisit is worth knowing about.
   */
  isOutsideScanRoots?: boolean;
}

/**
 * Longest common directory prefix of every repo path.
 *
 * Everything above it is chrome (`/Users/johns`) that would waste two
 * levels of indentation on every single row.
 */
export function commonRoot(paths: readonly string[]): string {
  if (paths.length === 0) return "";
  const split = paths.map((p) => p.split("/"));
  // The repo directory itself is never part of the shared root, so drop
  // the last segment before comparing.
  const dirs = split.map((s) => s.slice(0, -1));
  const first = dirs[0] ?? [];
  let end = first.length;
  for (const segments of dirs) {
    let i = 0;
    while (i < end && i < segments.length && segments[i] === first[i]) i++;
    end = i;
  }
  return first.slice(0, end).join("/");
}

function makeNode(path: string, depth: number): TreeNode {
  const name = path.split("/").filter(Boolean).pop() ?? path;
  return {
    path,
    name,
    depth,
    children: [],
    repos: [],
    totalRepos: 0,
    dirtyCount: 0,
    missingCount: 0,
  };
}

/**
 * Build the directory tree for a set of repos, anchored at an EXPLICIT
 * root.
 *
 * Taking the root as a parameter (rather than deriving it) is what lets
 * the rail stay anchored on the configured scan paths: the shape of the
 * tree then depends on your settings, not on which repos happen to be
 * catalogued right now.
 *
 * Repos outside `rootPath` are still placed, using their absolute path
 * relative to the root — callers are expected to have partitioned them
 * already (see `buildRepoForest`).
 */
export function buildTreeAt(
  repos: readonly Repo[],
  rootPath: string,
): TreeNode {
  const root = makeNode(rootPath, 0);
  const byPath = new Map<string, TreeNode>([[root.path, root]]);

  for (const repo of repos) {
    const dir = repo.fullPath.slice(0, repo.fullPath.lastIndexOf("/"));
    // Walk from the root down, creating intermediate nodes on the way.
    const relative = dir.startsWith(root.path)
      ? dir.slice(root.path.length)
      : dir;
    const segments = relative.split("/").filter(Boolean);

    let current = root;
    let path = root.path;
    for (const segment of segments) {
      path = `${path}/${segment}`;
      let next = byPath.get(path);
      if (!next) {
        next = makeNode(path, current.depth + 1);
        byPath.set(path, next);
        current.children.push(next);
      }
      current = next;
    }
    current.repos.push(repo);
  }

  // Roll subtree totals up in one post-order pass.
  const rollUp = (node: TreeNode): void => {
    let total = node.repos.length;
    let dirty = node.repos.filter((r) => r.isDirty).length;
    let missing = node.repos.filter((r) => r.missing).length;
    for (const child of node.children) {
      rollUp(child);
      total += child.totalRepos;
      dirty += child.dirtyCount;
      missing += child.missingCount;
    }
    node.totalRepos = total;
    node.dirtyCount = dirty;
    node.missingCount = missing;
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.repos.sort((a, b) => a.name.localeCompare(b.name));
  };
  rollUp(root);

  return root;
}

/**
 * Build the tree anchored at the common ancestor of the given repos.
 *
 * Retained for callers that have no scan-root context (the stray bucket
 * in `buildRepoForest`, and the settings-less fallback).
 */
export function buildRepoTree(repos: readonly Repo[]): TreeNode {
  return buildTreeAt(repos, commonRoot(repos.map((r) => r.fullPath)));
}

/** Depth-first walk yielding every node below (and including) `node`. */
export function* walkTree(node: TreeNode): Generator<TreeNode> {
  yield node;
  for (const child of node.children) yield* walkTree(child);
}

/**
 * True when `path` is `ancestor` or lives beneath it. Used for both the
 * "show everything under this folder" filter and for auto-expanding the
 * rail to reveal the selected repo.
 */
export function isUnder(path: string, ancestor: string): boolean {
  if (path === ancestor) return true;
  return path.startsWith(ancestor.endsWith("/") ? ancestor : `${ancestor}/`);
}

/**
 * True when `path` sits *directly* inside `dir` — one level, not deeper.
 *
 * `isUnder` answers "is this inside the folder"; this answers "is this in
 * the folder itself". The rail's "directly in this folder" row needs the
 * second question: selecting the folder shows the whole subtree, and this
 * is what lets the row narrow the catalog to the repos sitting at its top
 * level alone.
 */
export function isDirectlyIn(path: string, dir: string): boolean {
  const parent = path.slice(0, path.lastIndexOf("/"));
  return parent === dir.replace(/\/+$/, "");
}

/** Every ancestor path of `path` up to and including `root`. */
export function ancestorsOf(path: string, root: string): string[] {
  const out: string[] = [];
  let current = path;
  while (current.length > root.length && current.startsWith(root)) {
    current = current.slice(0, current.lastIndexOf("/"));
    if (!current) break;
    out.push(current);
  }
  return out;
}

/**
 * Path with the common root replaced by `~/…`-style shorthand, for
 * showing a repo's location without eating half the card width.
 */
export function displayPath(fullPath: string, home?: string): string {
  const h = home ?? "";
  if (h && fullPath.startsWith(h)) return `~${fullPath.slice(h.length)}`;
  return fullPath;
}

/**
 * Directories that read as "put away, not active work". Surfaced so the
 * catalog can de-emphasise them by default instead of letting 27 archived
 * duplicates dominate the first screen.
 */
const ARCHIVE_SEGMENTS = new Set([
  "_archive",
  "archive",
  "archived",
  "_old",
  "old",
  "backup",
  "backups",
  "duplicates",
  "trash",
]);

export function isArchivedPath(fullPath: string): boolean {
  return fullPath
    .split("/")
    .some((segment) => ARCHIVE_SEGMENTS.has(segment.toLowerCase()));
}


// ---------------------------------------------------------------------------
// Scan-root forest
// ---------------------------------------------------------------------------

/**
 * Shorten an absolute path for display: `/Users/johns/Repos` → `~/Repos`.
 *
 * The home directory is inferred from the path itself rather than read
 * from the OS, because the renderer has no Node APIs. Only the standard
 * macOS/Linux home layouts are recognised; anything else is left alone.
 */
export function tildify(absolutePath: string): string {
  const home = /^(\/Users\/[^/]+|\/home\/[^/]+)(?=\/|$)/.exec(absolutePath);
  if (!home) return absolutePath;
  return `~${absolutePath.slice(home[0].length)}` || "~";
}

export interface RepoForest {
  /** One node per configured scan root, plus any out-of-root strays. */
  roots: TreeNode[];
  totalRepos: number;
}

/**
 * Build one tree per configured scan root.
 *
 * This replaces rooting the tree at the common ancestor of catalogued
 * repos, which had two problems on a real machine:
 *
 *   1. A configured scan root holding no repos yet was INVISIBLE — you
 *      couldn't see the directory you'd told the app to watch.
 *   2. The root shifted as the catalog changed. With repos in only one
 *      of two scan roots the ancestor was that root; the moment a repo
 *      appeared in the second, the ancestor became the shared parent and
 *      every folder in the rail gained a level of nesting.
 *
 * Anchoring on the configured roots makes the rail a stable picture of
 * "the directories we are scanning", which is what it's for.
 *
 * `scanPaths` may be empty (fresh install, settings not loaded yet); in
 * that case this falls back to the common-ancestor behaviour so the rail
 * still shows something useful.
 */
export function buildRepoForest(
  repos: readonly Repo[],
  scanPaths: readonly string[],
): RepoForest {
  const normalizedRoots = [
    ...new Set(
      scanPaths
        .map((p) => p.trim().replace(/\/+$/, ""))
        .filter((p) => p.length > 0),
    ),
  ];

  if (normalizedRoots.length === 0) {
    const fallback = buildRepoTree(repos);
    fallback.isScanRoot = true;
    return {
      roots: fallback.children.length > 0 || fallback.repos.length > 0
        ? [fallback]
        : [],
      totalRepos: fallback.totalRepos,
    };
  }

  // Longest root first: with nested scan roots (`~/Repos` and
  // `~/Repos/work`) a repo must be attributed to the most specific one.
  const ordered = [...normalizedRoots].sort((a, b) => b.length - a.length);

  const byRoot = new Map<string, Repo[]>(
    normalizedRoots.map((root) => [root, []]),
  );
  const strays: Repo[] = [];

  for (const repo of repos) {
    const owner = ordered.find((root) => isUnder(repo.fullPath, root));
    if (owner) byRoot.get(owner)!.push(repo);
    else strays.push(repo);
  }

  const roots: TreeNode[] = normalizedRoots.map((root) => {
    const node = buildTreeAt(byRoot.get(root) ?? [], root);
    node.isScanRoot = true;
    return node;
  });

  if (strays.length > 0) {
    const strayRoot = buildRepoTree(strays);
    strayRoot.isOutsideScanRoots = true;
    roots.push(strayRoot);
  }

  return {
    roots,
    totalRepos: roots.reduce((sum, node) => sum + node.totalRepos, 0),
  };
}

/** The scan root (or stray root) a repo belongs to, for relative labels. */
export function owningRoot(
  fullPath: string,
  scanPaths: readonly string[],
): string | null {
  const ordered = [...scanPaths]
    .map((p) => p.replace(/\/+$/, ""))
    .sort((a, b) => b.length - a.length);
  return ordered.find((root) => root && isUnder(fullPath, root)) ?? null;
}
