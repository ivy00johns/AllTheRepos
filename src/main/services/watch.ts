/**
 * Live filesystem watching for the scan roots.
 *
 * The catalog used to be a snapshot: accurate at the moment you last ran
 * a scan and quietly wrong afterwards. This service keeps it current by
 * noticing repos appearing, moving and disappearing under a scan root.
 *
 * ## Why `fs.watch` and not chokidar
 *
 * chokidar dropped its `fsevents` backend in v4, so on macOS it now opens
 * one kqueue watch per directory. Measured against this machine's two
 * scan roots that came to ~12,600 directories and died with `EMFILE`
 * before it finished starting. Node's own `fs.watch` with
 * `recursive: true` is backed by FSEvents on macOS and by
 * `ReadDirectoryChangesW` on Windows: ONE handle covers an entire tree at
 * any depth, with no directory walk and no per-directory descriptors.
 *
 * The trade is that the events are raw — a `rename` means "something
 * appeared or vanished here", without saying which. That suits us: the
 * reconcile pass has to look at the path anyway to decide what it is.
 *
 * ## Keeping the event volume sane
 *
 * A recursive watch reports everything, including an `npm install`
 * unpacking 40,000 files. Three cheap string filters run before anything
 * touches the disk:
 *
 *   1. Known heavy directories (`node_modules`, `dist`, `.venv`, …).
 *   2. Everything below a `.git` directory — but not `.git` itself, which
 *      is how we learn a plain folder became a repo.
 *   3. Everything inside a repo we already know about. Once a repo is
 *      catalogued, its churn is invisible to us.
 *
 * Whatever survives is coalesced over a settle window, so a `git clone`
 * produces one reconcile rather than hundreds.
 *
 * ## What it will and won't do
 *
 * A repo that disappears is reported, never deleted. `Repo.missing` is
 * computed at read time, so a vanished repo already renders as missing;
 * auto-deleting the row would throw away tags and group memberships the
 * moment an external drive unmounted. Removal stays a deliberate act.
 */

import fs from "node:fs";
import path from "node:path";

import type { CatalogChangeEvent } from "@shared/types";

import { getSqlite } from "@main/db/client";
import { indexRepoAtPath, isRepoDir } from "@main/services/indexer";
import { getSettings } from "@main/services/settings";

/**
 * Directories that never hold a repo we want and always hold a great
 * many files. Rejecting these is most of what keeps this cheap.
 */
const PRUNED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "venv",
  ".venv",
  "__pycache__",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  "coverage",
  "Pods",
  "DerivedData",
  ".gradle",
  ".terraform",
  "site-packages",
]);

/**
 * How long to wait for the filesystem to settle before reconciling.
 *
 * A `git clone` produces a burst of events; reconciling on each would
 * index the same repo a dozen times mid-checkout. Long enough to
 * coalesce a clone, short enough to feel immediate.
 */
const SETTLE_MS = 1200;

/**
 * How deep below a scan root a repo may be and still be noticed.
 *
 * Not a performance guard any more — a recursive watch costs the same at
 * any depth — but a sanity bound so a stray deep tree can't make every
 * event do filesystem work.
 */
const MAX_DEPTH = 8;

export type CatalogChangeListener = (event: CatalogChangeEvent) => void;

interface KnownRepo {
  slug: string;
  fullPath: string;
}

function knownRepos(): KnownRepo[] {
  try {
    return getSqlite()
      .prepare("SELECT slug, full_path AS fullPath FROM repos")
      .all() as KnownRepo[];
  } catch {
    // The DB isn't open yet (very early boot) — treat as "nothing known".
    return [];
  }
}

function isInside(child: string, parent: string): boolean {
  const withSep = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child === parent || child.startsWith(withSep);
}

/**
 * Should this path be ignored outright?
 *
 * Runs on every raw filesystem event, so it is pure string work — no
 * `stat`, no allocation beyond the split. Exported and pure so its rules
 * can be pinned by tests: a regression here doesn't break anything
 * visibly, it just quietly makes the app do disk work for every file an
 * `npm install` writes.
 */
export function shouldIgnorePath(
  candidate: string,
  root: string,
  knownRepoPaths: ReadonlySet<string>,
): boolean {
  if (candidate === root) return true;
  if (!isInside(candidate, root)) return true;

  const relative = candidate.slice(root.length + 1);
  if (!relative) return true;

  const segments = relative.split(path.sep);
  if (segments.length > MAX_DEPTH) return true;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (PRUNED_DIRS.has(segment)) return true;
    // `.git` appearing is how a folder announces it became a repo, so
    // keep the marker itself and discard everything beneath it.
    if (segment === ".git") return i < segments.length - 1;
  }

  // Inside a repo we already track: that subtree is where essentially
  // all filesystem churn lives, and none of it can tell us anything new.
  for (const known of knownRepoPaths) {
    if (candidate.length > known.length && isInside(candidate, known)) {
      return true;
    }
  }
  return false;
}

/**
 * The repo directory a path is talking about: `<repo>/.git` and `<repo>`
 * both mean the same repo, and the OS may report either first.
 */
export function candidateRepoPath(candidate: string): string {
  return path.basename(candidate) === ".git"
    ? path.dirname(candidate)
    : candidate;
}

class RepoWatchService {
  private watchers: fs.FSWatcher[] = [];
  private listeners = new Set<CatalogChangeListener>();
  private pending = new Set<string>();
  private settleTimer: NodeJS.Timeout | null = null;
  /** Repo roots currently in the catalog — the subtree-pruning set. */
  private knownPaths = new Set<string>();
  private running = false;
  private suppressDepth = 0;

  onChange(listener: CatalogChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: CatalogChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[watch] listener threw", error);
      }
    }
  }

  /**
   * Run `fn` without reacting to the filesystem events it causes.
   *
   * The app's own moves already update the catalog synchronously, so
   * re-indexing what they touched is redundant work and a flicker in the
   * UI. Events are dropped rather than queued: whatever the operation
   * did, the catalog already knows.
   */
  async suppressed<T>(fn: () => Promise<T>): Promise<T> {
    this.suppressDepth++;
    try {
      return await fn();
    } finally {
      // Outlast the settle window so late events from the operation are
      // dropped too, not just those landing while it ran.
      setTimeout(() => {
        this.suppressDepth = Math.max(0, this.suppressDepth - 1);
      }, SETTLE_MS).unref?.();
    }
  }

  private refreshKnownPaths(): void {
    this.knownPaths = new Set(knownRepos().map((repo) => repo.fullPath));
  }

  /**
   * Scan roots, resolved through `realpath`.
   *
   * The catalog stores canonicalised paths (see `canonicalPath` in the
   * metadata service). On macOS `/var` and `/tmp` are symlinks into
   * `/private`, so watching an unresolved root yields event paths that
   * could never match a catalog row — vanished repos would go unnoticed
   * and new ones would be indexed under a second, parallel path.
   */
  private resolvedRoots(): string[] {
    return getSettings()
      .scanPaths.filter(Boolean)
      .map((root: string) => {
        const resolved = path.resolve(root).replace(/\/+$/, "");
        try {
          return fs.realpathSync(resolved);
        } catch {
          // Doesn't exist yet — watch the literal path so it starts
          // working if the folder appears later.
          return resolved;
        }
      });
  }

  /** Open watchers for the configured scan roots. Idempotent. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.refreshKnownPaths();

    for (const root of this.resolvedRoots()) {
      try {
        const watcher = fs.watch(
          root,
          { recursive: true },
          (_eventType, filename) => {
            // `filename` is null on some platforms for some events, and
            // there's nothing actionable without it.
            if (!filename) return;
            this.queue(path.join(root, filename.toString()), root);
          },
        );
        watcher.on("error", (error) => {
          console.error("[watch] watcher error", root, error);
        });
        this.watchers.push(watcher);
      } catch (error) {
        // A missing root, a platform without recursive watch, or a
        // permissions problem must never stop the app booting — the
        // manual scan still works.
        console.error("[watch] could not watch", root, error);
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        /* already closed */
      }
    }
    this.watchers = [];
    this.pending.clear();
  }

  /** Rebuild watchers — call after the scan roots change. */
  async restart(): Promise<void> {
    await this.stop();
    this.start();
  }

  private queue(fullPath: string, root: string): void {
    if (this.suppressDepth > 0) return;
    if (shouldIgnorePath(fullPath, root, this.knownPaths)) return;

    this.pending.add(candidateRepoPath(fullPath));

    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      void this.reconcile();
    }, SETTLE_MS);
    this.settleTimer.unref?.();
  }

  /**
   * Turn a batch of raw events into catalog changes.
   *
   * Deliberately forgiving: a path that isn't a repo, or that vanished
   * again before we looked, is simply skipped. Directories come and go
   * constantly during a checkout.
   */
  private async reconcile(): Promise<void> {
    const candidates = [...this.pending];
    this.pending.clear();
    if (candidates.length === 0) return;

    const before = new Set(this.knownPaths);
    const known = knownRepos();

    const added: string[] = [];
    const updated: string[] = [];
    const vanished: string[] = [];

    for (const candidate of candidates) {
      if (isRepoDir(candidate)) {
        const repo = await indexRepoAtPath(candidate);
        if (!repo) continue;
        if (before.has(repo.fullPath)) updated.push(repo.slug);
        else added.push(repo.slug);
        continue;
      }

      // Not a repo any more. Anything we know about at or below this path
      // is gone — reported, never deleted. See the file header.
      if (fs.existsSync(candidate)) continue;
      for (const repo of known) {
        if (isInside(repo.fullPath, candidate)) vanished.push(repo.slug);
      }
    }

    this.refreshKnownPaths();

    if (added.length === 0 && updated.length === 0 && vanished.length === 0) {
      return;
    }

    this.emit({
      added,
      updated,
      // A repo that moved shows up as both indexed and vanished; its new
      // location is the truth, so don't also report it as gone.
      vanished: [...new Set(vanished)].filter(
        (slug) => !added.includes(slug) && !updated.includes(slug),
      ),
      at: new Date().toISOString(),
    });
  }
}

export const repoWatchService = new RepoWatchService();
