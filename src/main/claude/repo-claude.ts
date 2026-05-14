/**
 * Per-repo `.claude/` state reader.
 *
 * Reads the three relevant artifacts a repo can ship:
 *   1. `.claude/skills/<name>/SKILL.md` — gray-matter frontmatter.
 *   2. `.claude/agents/<slug>.md`       — gray-matter frontmatter.
 *   3. `.mcp.json`                      — per-project MCP servers.
 *
 * Plus the global counterpart for MCP:
 *   `~/.claude/settings.json` — `mcpServers` block (merged with
 *   `configuredIn: "global"`).
 *
 * All file access is best-effort. Any unreadable / malformed file
 * degrades to "empty" rather than throwing, so a slightly-broken
 * `.claude/` directory still surfaces what we CAN read.
 *
 * Frontmatter is parsed via gray-matter (see `package.json`
 * dependencies). The `name` / `description` defaults match the
 * `contracts/ipc.v3b.md` "Domain rules" — directory name for
 * skills, file basename for agents.
 */

import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

import type { ClaudeAgent, ClaudeMcpServer, ClaudeSkill } from "@shared/types";

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

/**
 * Parse the YAML frontmatter at the head of a Markdown file. Returns
 * `{ data: {}, body: source }` on any error so callers stay happy.
 *
 * Exposed as a test seam (QE imports this directly).
 */
export function parseFrontmatter(source: string): ParsedFrontmatter {
  try {
    const parsed = matter(source);
    const data =
      parsed.data &&
      typeof parsed.data === "object" &&
      !Array.isArray(parsed.data)
        ? (parsed.data as Record<string, unknown>)
        : {};
    return { data, body: parsed.content ?? "" };
  } catch {
    return { data: {}, body: source };
  }
}

// ---------------------------------------------------------------------------
// Skill / agent loaders
// ---------------------------------------------------------------------------

/**
 * Return every skill defined under `<repoPath>/.claude/skills/`.
 * One skill per directory containing a `SKILL.md` file.
 *
 * Best-effort — non-existent directory yields `[]`; per-file errors
 * are logged and skipped so one broken skill doesn't blank the rest.
 */
export function loadSkills(repoPath: string): ClaudeSkill[] {
  const skillsRoot = path.join(repoPath, ".claude", "skills");
  if (!safeIsDirectory(skillsRoot)) return [];
  const out: ClaudeSkill[] = [];

  for (const filePath of walkForSkillMd(skillsRoot)) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const { data } = parseFrontmatter(raw);
      const dirName = path.basename(path.dirname(filePath));
      const fmName = typeof data.name === "string" ? data.name : null;
      const fmDescription =
        typeof data.description === "string" ? data.description : "";
      out.push({
        name: fmName && fmName.length > 0 ? fmName : dirName,
        description: fmDescription,
        path: filePath,
        frontmatter: data,
      });
    } catch (err) {
      console.warn(`[claude] failed to read skill ${filePath}:`, err);
    }
  }

  return out;
}

/**
 * Return every agent defined under `<repoPath>/.claude/agents/`.
 * One agent per `*.md` file (non-recursive — agents live in a flat
 * directory by convention).
 */
export function loadAgents(repoPath: string): ClaudeAgent[] {
  const agentsRoot = path.join(repoPath, ".claude", "agents");
  if (!safeIsDirectory(agentsRoot)) return [];
  const out: ClaudeAgent[] = [];

  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(agentsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const dirent of dirents) {
    if (!dirent.isFile()) continue;
    if (!dirent.name.toLowerCase().endsWith(".md")) continue;
    const filePath = path.join(agentsRoot, dirent.name);
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const { data } = parseFrontmatter(raw);
      const basename = path.basename(dirent.name, path.extname(dirent.name));
      const fmName = typeof data.name === "string" ? data.name : null;
      const fmDescription =
        typeof data.description === "string" ? data.description : "";
      out.push({
        name: fmName && fmName.length > 0 ? fmName : basename,
        description: fmDescription,
        path: filePath,
        frontmatter: data,
      });
    } catch (err) {
      console.warn(`[claude] failed to read agent ${filePath}:`, err);
    }
  }

  return out;
}

function walkForSkillMd(root: string): string[] {
  const results: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir == null) break;
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        stack.push(full);
      } else if (dirent.isFile() && dirent.name === "SKILL.md") {
        results.push(full);
      }
    }
  }
  return results;
}

function safeIsDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// MCP server merger
// ---------------------------------------------------------------------------

/**
 * Merge project-local `.mcp.json` and global
 * `~/.claude/settings.json` MCP server definitions into a single
 * list with `configuredIn` source tags.
 *
 * Project-local entries appear first (and survive a name collision
 * with the global one — project trumps global per Claude Code's
 * resolution order).
 *
 * Exposed as a test seam.
 */
export function mergeMcpServers(
  projectJson: unknown,
  globalSettingsJson: unknown,
): ClaudeMcpServer[] {
  const project = extractMcpServers(projectJson, "project");
  const global = extractMcpServers(globalSettingsJson, "global");
  const seen = new Set<string>(project.map((s) => s.name));
  const out: ClaudeMcpServer[] = [...project];
  for (const entry of global) {
    if (seen.has(entry.name)) continue;
    out.push(entry);
  }
  return out;
}

function extractMcpServers(
  source: unknown,
  configuredIn: "project" | "global",
): ClaudeMcpServer[] {
  if (!source || typeof source !== "object") return [];
  const root = source as Record<string, unknown>;
  const block = root.mcpServers;
  if (!block || typeof block !== "object") return [];

  const out: ClaudeMcpServer[] = [];
  for (const [name, valueRaw] of Object.entries(
    block as Record<string, unknown>,
  )) {
    if (typeof name !== "string" || name.length === 0) continue;
    if (!valueRaw || typeof valueRaw !== "object") {
      out.push({
        name,
        type: "unknown",
        command: null,
        args: null,
        configuredIn,
        status: "unavailable",
      });
      continue;
    }
    const value = valueRaw as Record<string, unknown>;
    const type = normalizeMcpType(value.type);
    const command = typeof value.command === "string" ? value.command : null;
    const argsRaw = value.args;
    const args = Array.isArray(argsRaw)
      ? argsRaw.filter((x): x is string => typeof x === "string")
      : null;
    out.push({
      name,
      type,
      command,
      args,
      configuredIn,
      status: "configured",
    });
  }
  return out;
}

function normalizeMcpType(raw: unknown): ClaudeMcpServer["type"] {
  if (raw === "stdio" || raw === "sse" || raw === "http") return raw;
  return "unknown";
}

/**
 * Read + JSON.parse a file, returning `null` on any failure (missing
 * file, malformed JSON, permission denied). Used to load the
 * project-local `.mcp.json` and the global `~/.claude/settings.json`.
 */
export function safeReadJson(filePath: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[claude] failed to parse ${filePath}:`, err);
    return null;
  }
}

/**
 * Return `true` if either `<repoPath>/.claude` exists OR the supplied
 * registry map already knows about this repoPath. Used to decide
 * `hasClaude` in `claude:repoState`.
 */
export function repoHasClaude(
  repoPath: string,
  registeredPaths: ReadonlySet<string>,
): boolean {
  if (registeredPaths.has(repoPath)) return true;
  return safeIsDirectory(path.join(repoPath, ".claude"));
}
