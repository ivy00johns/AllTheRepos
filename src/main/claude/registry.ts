/**
 * Claude project registry — `~/.claude.json` parser.
 *
 * `~/.claude.json` carries a `projects` object whose KEYS are absolute
 * repo paths (e.g. `/Users/john/Projects/foo`) and whose VALUES carry,
 * at minimum, a `projectId` field — the hash on disk under
 * `~/.claude/projects/<projectId>/`. Some Claude Code versions instead
 * embed the hash directly as the key of a sub-folder name; we tolerate
 * both shapes defensively.
 *
 * The mapping is read-only and rebuilt on `boot()` / `index()`. We
 * NEVER try to invert the hash algorithm — the file is the source of
 * truth (per `contracts/ipc.v3b.md` "Domain rules").
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * One project entry from `~/.claude.json`.
 *
 * Hash is the directory name under `~/.claude/projects/` that owns the
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
 * Best-effort read + parse of `~/.claude.json`. Returns an empty
 * registry when the file is missing, unreadable, or malformed — the
 * app MUST boot even when Claude Code isn't installed.
 */
export function loadClaudeRegistry(filePath?: string): ClaudeRegistry {
  const fp = filePath ?? claudeJsonPath();
  const empty: ClaudeRegistry = {
    forward: new Map(),
    reverse: new Map(),
    entries: [],
  };

  let raw: string;
  try {
    raw = fs.readFileSync(fp, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(`[claude] failed to read ${fp}:`, err);
    }
    return empty;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[claude] failed to parse ${fp}:`, err);
    return empty;
  }

  return buildRegistry(parsed);
}

/**
 * Build a registry from an already-parsed JSON blob. Exported for
 * unit tests; the wire format may evolve and this lets the parser be
 * exercised without touching the filesystem.
 */
export function buildRegistry(parsed: unknown): ClaudeRegistry {
  const empty: ClaudeRegistry = {
    forward: new Map(),
    reverse: new Map(),
    entries: [],
  };
  if (!parsed || typeof parsed !== "object") return empty;

  const root = parsed as { projects?: unknown };
  const projects = root.projects;
  if (!projects || typeof projects !== "object") return empty;

  const forward = new Map<string, string>();
  const reverse = new Map<string, string>();
  const entries: ClaudeProjectRegistryEntry[] = [];

  for (const [key, valueRaw] of Object.entries(
    projects as Record<string, unknown>,
  )) {
    if (typeof key !== "string" || key.length === 0) continue;
    const value =
      valueRaw && typeof valueRaw === "object"
        ? (valueRaw as Record<string, unknown>)
        : null;

    // Common shape: key = absolute repo path, value = { projectId: hash }.
    const projectId =
      value && typeof value.projectId === "string" ? value.projectId : null;

    // Fallback shape some Claude Code versions emit: the key itself is
    // a sanitized hash-ish form (e.g. "-Users-john-Projects-foo"). Per
    // the contract we don't invert the hash, but if `projectId` is
    // absent we treat the key as the hash AND attempt to recover the
    // repo path from a `path` field on the value blob.
    let hash: string | null = projectId;
    let repoPath: string | null = key;

    if (!hash) {
      // No projectId — try to read a `path` field from the value and
      // use the key as the hash.
      if (value && typeof value.path === "string") {
        repoPath = value.path;
        hash = key;
      } else {
        continue;
      }
    }

    if (!hash || !repoPath) continue;
    forward.set(repoPath, hash);
    reverse.set(hash, repoPath);
    entries.push({ hash, repoPath });
  }

  return { forward, reverse, entries };
}
