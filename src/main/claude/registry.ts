/**
 * Claude project registry — `~/.claude.json` parser.
 *
 * `~/.claude.json` carries a `projects` object whose KEYS are absolute
 * repo paths (e.g. `/Users/john/Projects/foo`). The VALUE blob holds
 * per-project config (`allowedTools`, `mcpServers`, `context`,
 * `ignorePatterns`, ...) and — critically — does NOT carry the on-disk
 * session-directory hash. Installed Claude Code derives that directory
 * name DETERMINISTICALLY from the path: every `/` and `.` in the
 * absolute path is replaced with `-`. So:
 *
 *     /Users/john/Projects/foo         -> -Users-john-Projects-foo
 *     /Users/john/.hermes              -> -Users-john--hermes
 *     /Users/john/.claude-mem/sessions -> -Users-john--claude-mem-sessions
 *
 * Sessions for a project live at `~/.claude/projects/<hash>/*.jsonl`.
 *
 * This module is the source of truth for the project ↔ hash mapping. It
 * builds the registry by:
 *   1. deriving the hash from each `~/.claude.json` path key, AND
 *   2. enumerating the on-disk `~/.claude/projects/*` directories so
 *      session-only projects (present on disk but absent from the config,
 *      and vice-versa) are still indexed.
 * The two sources are JOINed by hash. The mapping is read-only and
 * rebuilt on `boot()` / `index()`.
 *
 * Backward compatibility: if a project value DOES carry a string
 * `projectId` (older wire format) we honour it as the hash; if it
 * carries a `path` field we honour that as the repo path. The real
 * installed format has neither, so the path-key sanitization is the
 * primary path.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * One project entry from `~/.claude.json` / on-disk session dirs.
 *
 * `hash` is the directory name under `~/.claude/projects/` that owns the
 * session JSONL files for this project. `repoPath` is the absolute
 * filesystem path of the repo on the user's machine.
 */
export interface ClaudeProjectRegistryEntry {
  hash: string;
  repoPath: string;
}

export interface ClaudeRegistry {
  /** `repoPath` -> `hash` (forward map). */
  forward: Map<string, string>;
  /** `hash` -> `repoPath` (reverse map). */
  reverse: Map<string, string>;
  /** Full registry list, useful for iteration. */
  entries: ClaudeProjectRegistryEntry[];
}

/** Options for {@link buildRegistry}. */
export interface BuildRegistryOptions {
  /**
   * Directory names found under `~/.claude/projects/` (the on-disk
   * session hashes). Supplied by {@link loadClaudeRegistry}; injectable
   * in tests so the builder stays filesystem-free. Any hash here that is
   * not already covered by a `~/.claude.json` entry is added as a
   * session-only project (best-effort `repoPath`).
   */
  onDiskHashes?: readonly string[];
}

/**
 * Canonical path to the user's Claude Code config file.
 *
 * Exported so unit tests can swap in a fixture file at boot.
 */
export function claudeJsonPath(): string {
  return path.join(os.homedir(), ".claude.json");
}

/** Canonical root for per-project session directories. */
export function claudeProjectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/** Canonical path to the user's global Claude Code settings file. */
export function claudeGlobalSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

/**
 * Sanitize an absolute repo path into the on-disk session-directory
 * hash, matching Claude Code's convention: replace every `/` and `.`
 * with `-`.
 *
 *     /Users/john/.hermes -> -Users-john--hermes
 *
 * Exported for tests and for the service's reverse lookups.
 */
export function sanitizeRepoPath(repoPath: string): string {
  return repoPath.replace(/[/.]/g, "-");
}

/**
 * Best-effort read + parse of `~/.claude.json`. Returns an empty
 * registry when the file is missing, unreadable, or malformed — the
 * app MUST boot even when Claude Code isn't installed. The on-disk
 * `~/.claude/projects/*` directories are enumerated and JOINed so that
 * session-only projects are indexed even when the config is absent.
 *
 * @param filePath     Override for `~/.claude.json` (tests inject a fixture).
 * @param projectsRoot Override for `~/.claude/projects` (tests isolate from
 *                     the real home directory).
 */
export function loadClaudeRegistry(
  filePath?: string,
  projectsRoot?: string,
): ClaudeRegistry {
  const fp = filePath ?? claudeJsonPath();
  const onDiskHashes = readOnDiskHashes(projectsRoot ?? claudeProjectsRoot());

  let raw: string;
  try {
    raw = fs.readFileSync(fp, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(`[claude] failed to read ${fp}:`, err);
    }
    // No config — still surface on-disk session projects.
    return buildRegistry(null, { onDiskHashes });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[claude] failed to parse ${fp}:`, err);
    return buildRegistry(null, { onDiskHashes });
  }

  return buildRegistry(parsed, { onDiskHashes });
}

/**
 * Enumerate the `<root>/*` directory names (the on-disk session hashes).
 * Returns `[]` when the root is missing/unreadable (Claude Code not
 * installed, or no sessions yet).
 */
function readOnDiskHashes(root: string): string[] {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(`[claude] failed to read ${root}:`, err);
    }
    return [];
  }
  return dirents.filter((d) => d.isDirectory()).map((d) => d.name);
}

/**
 * Build a registry from an already-parsed JSON blob (and, optionally,
 * the set of on-disk session-directory hashes). Exported for unit tests;
 * keeping the parse logic filesystem-free lets it be exercised without
 * touching the disk.
 *
 * Resolution order for each `projects` entry:
 *   1. `value.projectId` (string)  -> explicit hash  [legacy shape]
 *   2. `value.path`      (string)  -> explicit repoPath, key is the hash
 *                                     [legacy shape]
 *   3. otherwise the KEY is the absolute repo path and the hash is
 *      `sanitizeRepoPath(key)`     [real installed shape]
 *
 * Any `onDiskHashes` not already represented are appended as
 * session-only projects (best-effort `repoPath = hash`).
 */
export function buildRegistry(
  parsed: unknown,
  options: BuildRegistryOptions = {},
): ClaudeRegistry {
  const forward = new Map<string, string>();
  const reverse = new Map<string, string>();
  const entries: ClaudeProjectRegistryEntry[] = [];

  const add = (hash: string, repoPath: string): void => {
    if (!hash || !repoPath) return;
    // Dedupe by hash: a hash is the on-disk session directory, so one
    // entry per hash. Two distinct path keys can sanitize to the same
    // hash (e.g. `/a.b` and `/a/b` both -> `-a-b`); first writer wins.
    // Keeping `entries` 1:1 with `reverse` is the invariant the service
    // relies on (`projectCount === entries.length`, one `sessionsByHash`
    // bucket per project).
    if (reverse.has(hash)) return;
    if (!forward.has(repoPath)) forward.set(repoPath, hash);
    reverse.set(hash, repoPath);
    entries.push({ hash, repoPath });
  };

  const root =
    parsed && typeof parsed === "object"
      ? (parsed as { projects?: unknown })
      : null;
  const projects = root?.projects;

  if (projects && typeof projects === "object") {
    for (const [key, valueRaw] of Object.entries(
      projects as Record<string, unknown>,
    )) {
      if (typeof key !== "string" || key.length === 0) continue;
      const value =
        valueRaw && typeof valueRaw === "object"
          ? (valueRaw as Record<string, unknown>)
          : null;

      // 1. Legacy: explicit projectId on the value blob => hash.
      const projectId =
        value && typeof value.projectId === "string" ? value.projectId : null;
      if (projectId) {
        // Legacy projectId shape: key is the repo path unless an explicit
        // `path` overrides it.
        const repoPath =
          value && typeof value.path === "string" ? value.path : key;
        add(projectId, repoPath);
        continue;
      }

      // 2. Legacy: explicit `path` on the value blob => key is the hash.
      if (value && typeof value.path === "string") {
        add(key, value.path);
        continue;
      }

      // 3. Real installed shape: key is the absolute repo path; derive
      //    the on-disk hash by sanitizing it.
      add(sanitizeRepoPath(key), key);
    }
  }

  // JOIN on-disk session dirs: index projects that exist on disk but are
  // absent from (or not matched by) the config so the watcher + usage
  // pipeline see them too. We cannot invert the hash to a real path, so
  // the hash itself is used as a best-effort repoPath.
  for (const hash of options.onDiskHashes ?? []) {
    if (typeof hash !== "string" || hash.length === 0) continue;
    if (reverse.has(hash)) continue;
    add(hash, hash);
  }

  return { forward, reverse, entries };
}
