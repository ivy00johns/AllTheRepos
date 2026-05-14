/**
 * ClaudeService — read-only Claude Code state aggregator (Phase 3b).
 *
 * Owns:
 *   - `~/.claude.json` registry (`repoPath <-> projectHash`).
 *   - Per-project `~/.claude/projects/<hash>/*.jsonl` session index.
 *   - Chokidar watcher debouncing session add/change/unlink into
 *     `claude:on:update` events.
 *   - Per-repo `.claude/` state cache (30s TTL, invalidated on
 *     update for the matching project hash).
 *   - Token-usage rollups (delegated to `usage.rollupUsage`).
 *
 * Mutating affordances (`launch`, `openClaudeMd`) delegate to
 * `launcherService`. ClaudeService NEVER spawns Claude Code itself.
 *
 * Boot is idempotent: a second call closes the prior watcher and
 * rebuilds the index. The app MUST boot successfully even when
 * Claude Code isn't installed (no `~/.claude.json`).
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

import type {
  ClaudeGlobalUsageInput,
  ClaudeGlobalUsageResult,
  ClaudeIndexResult,
  ClaudeLaunchInput,
  ClaudeLaunchResult,
  ClaudeOpenClaudeMdInput,
  ClaudeOpenClaudeMdResult,
  ClaudeProject,
  ClaudeProjectsResult,
  ClaudeRepoState,
  ClaudeRepoStateInput,
  ClaudeSession,
  ClaudeSessionTranscriptInput,
  ClaudeSessionTranscriptResult,
  ClaudeUpdateEvent,
  DetectLauncherResult,
} from "@shared/types";

import { getSqlite } from "@main/db/client";
import { openExternalAllowlisted } from "@main/security/allowlist";
import { getSettings } from "@main/services/settings";

import {
  claudeGlobalSettingsPath,
  claudeProjectsRoot,
  loadClaudeRegistry,
  type ClaudeRegistry,
} from "@main/claude/registry";
import {
  loadAgents,
  loadSkills,
  mergeMcpServers,
  repoHasClaude,
  safeReadJson,
} from "@main/claude/repo-claude";
import {
  parseSessionMetadata,
  readTranscriptChunk,
} from "@main/claude/transcript";
import { rollupUsage } from "@main/claude/usage";
import { startWatcher, type WatcherHandle } from "@main/claude/watcher";

import { launcherService } from "./launcher";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cap on the inline CLAUDE.md content embedded in `claude:repoState`. */
const CLAUDE_MD_MAX_BYTES = 256 * 1024;

/** TTL for the per-slug `claude:repoState` cache. */
const REPO_STATE_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Per-slug `repoState` cache entry. */
interface RepoStateCacheEntry {
  expiresAt: number;
  value: ClaudeRepoState;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class ClaudeService {
  /** Public event channel — `update` payload is `ClaudeUpdateEvent`. */
  readonly events: EventEmitter = new EventEmitter();

  private registry: ClaudeRegistry = {
    forward: new Map(),
    reverse: new Map(),
    entries: [],
  };

  /** projectHash -> [session, ...] */
  private sessionsByHash: Map<string, ClaudeSession[]> = new Map();

  /** sessionId -> absolute file path (for `sessionTranscript`). */
  private sessionPathById: Map<string, string> = new Map();

  /** Cached `ClaudeProject[]` (cheap; rebuilt on index). */
  private projectsCache: ClaudeProject[] = [];

  /** Per-slug `repoState` TTL cache. */
  private repoStateCache: Map<string, RepoStateCacheEntry> = new Map();

  private watcher: WatcherHandle | null = null;

  // -------------------------------------------------------------------------
  // Boot / index
  // -------------------------------------------------------------------------

  /**
   * Build / rebuild the registry + session index, then (re)start the
   * chokidar watcher. Idempotent: a second call closes the prior
   * watcher first.
   */
  async boot(): Promise<void> {
    await this.rebuild();
    await this.restartWatcher();
  }

  /**
   * Force a full re-walk WITHOUT restarting the watcher. Wired to the
   * `claude:index` IPC channel.
   */
  async index(): Promise<ClaudeIndexResult> {
    const startedAt = Date.now();
    const summary = await this.rebuild();
    return {
      projectCount: summary.projectCount,
      sessionCount: summary.sessionCount,
      totalTokens: summary.totalTokens,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Returns the cached `ClaudeProject[]` shape (with `repoSlug`
   * resolved via the SQLite catalog).
   */
  projects(): ClaudeProjectsResult {
    return { projects: this.projectsCache };
  }

  // -------------------------------------------------------------------------
  // repoState
  // -------------------------------------------------------------------------

  async repoState(input: ClaudeRepoStateInput): Promise<ClaudeRepoState> {
    const { slug } = input;
    const now = Date.now();
    const cached = this.repoStateCache.get(slug);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const repoPath = repoPathBySlug(slug);
    if (!repoPath) {
      throw new Error(`claude:repoState: repo not found (slug=${slug})`);
    }

    const registeredPaths = new Set(this.registry.forward.keys());
    const hasClaude = repoHasClaude(repoPath, registeredPaths);

    const claudeMdPathCandidate = path.join(repoPath, "CLAUDE.md");
    const claudeMdPath = safeFileExists(claudeMdPathCandidate)
      ? claudeMdPathCandidate
      : null;
    const claudeMdContent = claudeMdPath ? readCappedFile(claudeMdPath) : null;

    const settingsPathCandidate = path.join(
      repoPath,
      ".claude",
      "settings.json",
    );
    const settingsPath = safeFileExists(settingsPathCandidate)
      ? settingsPathCandidate
      : null;

    const skills = loadSkills(repoPath);
    const agents = loadAgents(repoPath);

    const projectMcp = safeReadJson(path.join(repoPath, ".mcp.json"));
    const globalMcp = safeReadJson(claudeGlobalSettingsPath());
    const mcpServers = mergeMcpServers(projectMcp, globalMcp);

    // Sessions: look up the matching project hash via reverse map.
    const projectHash = this.registry.forward.get(repoPath) ?? null;
    const sessions = projectHash
      ? (this.sessionsByHash.get(projectHash) ?? [])
      : [];
    let totalTokens = 0;
    for (const s of sessions) totalTokens += s.tokenUsage.totalTokens;

    const value: ClaudeRepoState = {
      hasClaude,
      claudeMdPath,
      claudeMdContent,
      settingsPath,
      generatedAt: now,
      skills,
      agents,
      mcpServers,
      sessions,
      totalTokens,
    };

    this.repoStateCache.set(slug, {
      expiresAt: now + REPO_STATE_TTL_MS,
      value,
    });
    return value;
  }

  // -------------------------------------------------------------------------
  // sessionTranscript
  // -------------------------------------------------------------------------

  async sessionTranscript(
    input: ClaudeSessionTranscriptInput,
  ): Promise<ClaudeSessionTranscriptResult> {
    const filePath = this.sessionPathById.get(input.sessionId);
    if (!filePath) {
      return { events: [], nextCursor: null, hasMore: false };
    }
    const chunk = await readTranscriptChunk(
      filePath,
      input.cursor ?? 0,
      input.maxBytes,
    );
    return {
      events: chunk.events,
      nextCursor: chunk.nextCursor,
      hasMore: chunk.hasMore,
    };
  }

  // -------------------------------------------------------------------------
  // globalUsage
  // -------------------------------------------------------------------------

  globalUsage(input: ClaudeGlobalUsageInput): ClaudeGlobalUsageResult {
    const flat: ClaudeSession[] = [];
    for (const arr of this.sessionsByHash.values()) {
      for (const s of arr) flat.push(s);
    }
    return rollupUsage({
      sessions: flat,
      registry: this.registry,
      from: input.from,
      to: input.to,
      slugByPath: (p) => slugByRepoPath(p),
    });
  }

  // -------------------------------------------------------------------------
  // launch
  // -------------------------------------------------------------------------

  async launch(input: ClaudeLaunchInput): Promise<ClaudeLaunchResult> {
    const command = buildLaunchCommand(input);
    return launcherService.openInTerminal({
      slug: input.slug,
      command,
    });
  }

  // -------------------------------------------------------------------------
  // openClaudeMd
  // -------------------------------------------------------------------------

  async openClaudeMd(
    input: ClaudeOpenClaudeMdInput,
  ): Promise<ClaudeOpenClaudeMdResult> {
    const { slug } = input;
    const repoPath = repoPathBySlug(slug);
    if (!repoPath) {
      return { ok: false, reason: "repo not found" };
    }
    const claudeMdPath = path.join(repoPath, "CLAUDE.md");
    if (!safeFileExists(claudeMdPath)) {
      return { ok: false, reason: "CLAUDE.md not found" };
    }

    // Resolve the user's default editor + its URL scheme via the
    // launcher detection cache. Build a file-target URL when the
    // scheme supports it (vscode/cursor/zed/windsurf use
    // `<scheme>://file/<abs>`; JetBrains family uses
    // `<scheme>://open?file=<abs>`; Sublime uses `subl://open?url=…`).
    // Fall back to opening the repo directory when the scheme can't
    // carry a file target (Xcode, missing scheme).
    const detection = launcherService.detect();
    const settings = getSettings() as ReturnType<typeof getSettings> & {
      defaultEditor?: unknown;
    };
    const preferred =
      typeof settings.defaultEditor === "string"
        ? settings.defaultEditor
        : null;
    const editor =
      pickEditor(detection, preferred) ?? pickEditor(detection, null);

    if (editor && editor.scheme) {
      const url = buildEditorFileUrl(editor.scheme, claudeMdPath);
      if (url) {
        const launch = await openExternalAllowlisted(url);
        if (launch.ok) return { ok: true };
        // Fall through to launcher delegation on allowlist/openExternal
        // failure — better to open the repo than nothing.
      }
    }

    // Editor doesn't support a file target (Xcode etc.) or the scheme
    // dispatch failed — open the repo directory via the launcher and
    // surface the limitation in the reason field.
    const fallback = await launcherService.openInEditor({ slug });
    if (fallback.ok) {
      return {
        ok: true,
        reason: "editor doesn't support file targets — opened repo",
      };
    }
    return fallback;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Walk `~/.claude.json` + every known project's session directory and
   * rebuild the registry, session-by-hash map, session-path-by-id map,
   * and projects cache. Wipes the repoState TTL cache (a re-index
   * invalidates everything because the repo-path mapping could have
   * shifted).
   */
  private async rebuild(): Promise<{
    projectCount: number;
    sessionCount: number;
    totalTokens: number;
  }> {
    this.registry = loadClaudeRegistry();
    this.sessionsByHash = new Map();
    this.sessionPathById = new Map();
    this.projectsCache = [];
    this.repoStateCache.clear();

    let totalSessions = 0;
    let totalTokens = 0;

    for (const entry of this.registry.entries) {
      const sessions = await this.indexProjectSessions(entry.hash);
      this.sessionsByHash.set(entry.hash, sessions);

      let projectTokens = 0;
      let lastActivityAt: string | null = null;
      for (const s of sessions) {
        projectTokens += s.tokenUsage.totalTokens;
        if (
          s.lastActivityAt &&
          (lastActivityAt === null || s.lastActivityAt > lastActivityAt)
        ) {
          lastActivityAt = s.lastActivityAt;
        }
      }
      totalSessions += sessions.length;
      totalTokens += projectTokens;

      this.projectsCache.push({
        hash: entry.hash,
        repoPath: entry.repoPath,
        repoSlug: slugByRepoPath(entry.repoPath),
        sessionCount: sessions.length,
        lastActivityAt,
        totalTokens: projectTokens,
      });
    }

    return {
      projectCount: this.registry.entries.length,
      sessionCount: totalSessions,
      totalTokens,
    };
  }

  /**
   * Walk one project hash directory and parse every JSONL file's
   * metadata. Returns the sessions list (also wires
   * `sessionPathById` so `sessionTranscript` can resolve later).
   */
  private async indexProjectSessions(hash: string): Promise<ClaudeSession[]> {
    const dir = path.join(claudeProjectsRoot(), hash);
    if (!safeIsDirectory(dir)) return [];

    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[claude] failed to list ${dir}:`, err);
      return [];
    }

    const sessions: ClaudeSession[] = [];
    for (const dirent of dirents) {
      if (!dirent.isFile()) continue;
      if (!dirent.name.toLowerCase().endsWith(".jsonl")) continue;
      const filePath = path.join(dir, dirent.name);
      const sessionId = path.basename(dirent.name, ".jsonl");
      let sizeBytes = 0;
      try {
        sizeBytes = fs.statSync(filePath).size;
      } catch {
        sizeBytes = 0;
      }
      const metadata = await parseSessionMetadata(filePath);
      sessions.push({
        id: sessionId,
        projectHash: hash,
        startedAt: metadata.startedAt,
        lastActivityAt: metadata.lastActivityAt,
        messageCount: metadata.messageCount,
        tokenUsage: metadata.tokenUsage,
        filePath,
        sizeBytes,
      });
      this.sessionPathById.set(sessionId, filePath);
    }

    // Sort by lastActivityAt desc so renderers can show "most recent"
    // first without re-sorting.
    sessions.sort((a, b) => {
      const aT = a.lastActivityAt ?? "";
      const bT = b.lastActivityAt ?? "";
      return bT.localeCompare(aT);
    });
    return sessions;
  }

  /**
   * Re-parse one project hash after a chokidar event. Updates the
   * session cache, projects cache, and clears the matching slug's
   * repoState TTL cache. Errors are logged and swallowed.
   */
  private async refreshProject(hash: string): Promise<void> {
    if (!this.registry.reverse.has(hash)) return;
    try {
      const sessions = await this.indexProjectSessions(hash);
      this.sessionsByHash.set(hash, sessions);

      let projectTokens = 0;
      let lastActivityAt: string | null = null;
      for (const s of sessions) {
        projectTokens += s.tokenUsage.totalTokens;
        if (
          s.lastActivityAt &&
          (lastActivityAt === null || s.lastActivityAt > lastActivityAt)
        ) {
          lastActivityAt = s.lastActivityAt;
        }
      }

      const repoPath = this.registry.reverse.get(hash) ?? "";
      const idx = this.projectsCache.findIndex((p) => p.hash === hash);
      const replacement: ClaudeProject = {
        hash,
        repoPath,
        repoSlug: slugByRepoPath(repoPath),
        sessionCount: sessions.length,
        lastActivityAt,
        totalTokens: projectTokens,
      };
      if (idx >= 0) {
        this.projectsCache[idx] = replacement;
      } else {
        this.projectsCache.push(replacement);
      }

      // Invalidate the slug's repoState cache if any.
      const slug = repoPath ? slugByRepoPath(repoPath) : null;
      if (slug) this.repoStateCache.delete(slug);
    } catch (err) {
      console.warn(`[claude] refreshProject(${hash}) failed:`, err);
    }
  }

  /** Idempotent watcher restart. Safe to call again on `boot()`. */
  private async restartWatcher(): Promise<void> {
    if (this.watcher) {
      try {
        await this.watcher.close();
      } catch (err) {
        console.warn("[claude] watcher close failed during restart:", err);
      }
      this.watcher = null;
    }

    const root = claudeProjectsRoot();
    if (!safeIsDirectory(root)) {
      // No projects dir yet — chokidar would error. Leave watcher null;
      // a future `index()` call after the user installs Claude Code
      // will give the next `boot()` something to watch.
      return;
    }

    this.watcher = startWatcher(root, (payload: ClaudeUpdateEvent) => {
      void this.refreshProject(payload.projectHash).finally(() => {
        try {
          this.events.emit("update", payload);
        } catch (err) {
          console.warn("[claude] events.emit('update') threw:", err);
        }
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve absolute repo path from slug via SQLite. Mirrors git.ts. */
function repoPathBySlug(slug: string): string | null {
  const sqlite = getSqlite();
  const row = sqlite
    .prepare("SELECT full_path FROM repos WHERE slug = ?")
    .get(slug) as { full_path: string } | undefined;
  return row?.full_path ?? null;
}

/**
 * Reverse lookup: absolute repo path -> slug (or null when the path
 * isn't a known catalog repo). Used to enrich `ClaudeProject.repoSlug`
 * and `byProject[i].repoSlug`.
 */
function slugByRepoPath(repoPath: string): string | null {
  try {
    const sqlite = getSqlite();
    const row = sqlite
      .prepare("SELECT slug FROM repos WHERE full_path = ?")
      .get(repoPath) as { slug: string } | undefined;
    return row?.slug ?? null;
  } catch {
    return null;
  }
}

function safeFileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function safeIsDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readCappedFile(filePath: string): string | null {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > CLAUDE_MD_MAX_BYTES) {
      const buf = Buffer.alloc(CLAUDE_MD_MAX_BYTES);
      const fd = fs.openSync(filePath, "r");
      try {
        fs.readSync(fd, buf, 0, CLAUDE_MD_MAX_BYTES, 0);
      } finally {
        fs.closeSync(fd);
      }
      return (
        buf.toString("utf8") +
        `\n\n[truncated — file is ${stats.size} bytes, capped at ${CLAUDE_MD_MAX_BYTES}]`
      );
    }
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.warn(`[claude] readCappedFile failed for ${filePath}:`, err);
    return null;
  }
}

/**
 * Build the `claude` CLI command line for `LAUNCH`. The session id is
 * Zod-validated at the IPC layer (a string from a trusted source);
 * `starterPrompt` is shell-quoted with `'\''` escape and single-quote
 * wrapping.
 *
 * Exposed as a test seam (QE imports this directly).
 */
export function buildLaunchCommand(input: ClaudeLaunchInput): string {
  const parts: string[] = ["claude"];
  if (input.resumeSessionId && input.resumeSessionId.length > 0) {
    parts.push("--resume", input.resumeSessionId);
  }
  if (input.starterPrompt && input.starterPrompt.length > 0) {
    parts.push("--prompt", shellSingleQuote(input.starterPrompt));
  }
  return parts.join(" ");
}

function shellSingleQuote(s: string): string {
  // Replace single-quotes with the sequence `'\''` and wrap the
  // whole thing in single quotes. Standard POSIX shell escape.
  return `'${s.replaceAll("'", "'\\''")}'`;
}

interface PickedEditor {
  id: string;
  scheme: string | null;
}

/**
 * Pick the editor entry that should host `openClaudeMd` — preferred
 * first, then the launcher's resolved default, then the first
 * available editor. Returns null when no editor is installed.
 */
function pickEditor(
  detection: DetectLauncherResult,
  preferred: string | null,
): PickedEditor | null {
  const findById = (id: string): PickedEditor | null => {
    const entry = detection.editors.find((e) => e.id === id && e.available);
    if (!entry) return null;
    return { id: entry.id, scheme: entry.scheme };
  };
  if (preferred) {
    const match = findById(preferred);
    if (match) return match;
  }
  if (detection.defaults.editor) {
    const match = findById(detection.defaults.editor);
    if (match) return match;
  }
  const fallback = detection.editors.find((e) => e.available);
  if (!fallback) return null;
  return { id: fallback.id, scheme: fallback.scheme };
}

/**
 * Build a file-target URL for the given editor scheme. Mirrors
 * launcher.ts's `buildEditorUrl` but for a single file path (not a
 * directory). Returns null for schemes that can't carry a file
 * target — the caller should fall back to opening the repo.
 */
function buildEditorFileUrl(
  scheme: string,
  absolutePath: string,
): string | null {
  const encodedPath = encodeURI(absolutePath);
  const encodedFileParam = encodeURIComponent(absolutePath);
  const ensureLeadingSlash = (s: string): string =>
    s.startsWith("/") ? s : `/${s}`;
  switch (scheme) {
    case "vscode":
    case "cursor":
    case "zed":
    case "windsurf":
      return `${scheme}://file${ensureLeadingSlash(encodedPath)}`;
    case "subl":
      return `subl://open?url=file://${encodedFileParam}`;
    case "idea":
    case "webstorm":
    case "pycharm":
    case "rider":
    case "goland":
    case "clion":
    case "rubymine":
      return `${scheme}://open?file=${encodedFileParam}`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const claudeService: ClaudeService = new ClaudeService();

// Test seams — exported individually so QE can exercise the helpers
// without instantiating the full service.
export {
  buildEditorFileUrl as __claude_build_editor_file_url,
  shellSingleQuote as __claude_shell_single_quote,
};

// Re-export pure helpers from the `@main/claude/*` sub-modules so QE
// can import a single test surface (`@main/services/claude`) for
// everything covered by the contract's "before reporting done"
// checklist: `parseSessionMetadata`, `parseFrontmatter`,
// `mergeMcpServers`, `rollupUsage`, `buildLaunchCommand`.
export { parseSessionMetadata } from "@main/claude/transcript";
export { parseFrontmatter, mergeMcpServers } from "@main/claude/repo-claude";
export { rollupUsage } from "@main/claude/usage";
