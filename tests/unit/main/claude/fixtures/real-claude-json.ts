/**
 * Fixture mirroring the REAL `~/.claude.json` wire format emitted by
 * installed Claude Code (verified on a live machine, 2026-05-31).
 *
 * The `projects` map is keyed by the project's ABSOLUTE filesystem path.
 * Each value carries config (`allowedTools`, `mcpServers`, `context`,
 * `ignorePatterns`, ...) but NONE of `projectId` / `path` — the two
 * fields the original parser required. The on-disk session directory
 * name is derived from the path key by replacing every `/` and `.`
 * with `-` (e.g. `/Users/johns/.hermes` -> `-Users-johns--hermes`).
 *
 * This is the exact shape that produced a 0/138 KEEP/SKIP outcome
 * against the old `buildRegistry` (see ATR-001 / ground-truth audit).
 */

/** A representative single project value blob (no projectId, no path). */
export interface RealClaudeProjectValue {
  allowedTools: string[];
  mcpServers: Record<string, unknown>;
  context: Record<string, unknown>;
  ignorePatterns?: string[];
  history?: unknown[];
}

function projectValue(): RealClaudeProjectValue {
  return {
    allowedTools: ["Bash", "Read", "Edit"],
    mcpServers: {},
    context: {},
    ignorePatterns: [],
    history: [],
  };
}

/**
 * The set of absolute-path keys we use across the registry tests. These
 * mirror real entries (a normal repo, a dotfile dir, a deeply-nested
 * dotted dir) so the `.`/`/` -> `-` sanitization is exercised.
 */
export const REAL_PROJECT_PATHS = {
  /** Normal repo: -> -Users-johns-Projects-AllTheRepos */
  alltherepos: "/Users/johns/Projects/AllTheRepos",
  /** Dotfile dir: '.hermes' -> double-dash. -> -Users-johns--hermes */
  hermes: "/Users/johns/.hermes",
  /** Nested + dotted dir. -> -Users-johns--claude-mem-observer-sessions */
  observer: "/Users/johns/.claude-mem/observer-sessions",
} as const;

/**
 * The on-disk `~/.claude/projects/<hash>` directory name for each path
 * above, per the verified sanitization convention.
 */
export const REAL_PROJECT_HASHES = {
  alltherepos: "-Users-johns-Projects-AllTheRepos",
  hermes: "-Users-johns--hermes",
  observer: "-Users-johns--claude-mem-observer-sessions",
} as const;

/**
 * A parsed `~/.claude.json` blob in the REAL shape (path-keyed values
 * with NO projectId/path). Use this to assert the registry is non-empty
 * and that path keys resolve to the correct on-disk hash.
 */
export function realClaudeJson(): {
  projects: Record<string, RealClaudeProjectValue>;
} {
  return {
    projects: {
      [REAL_PROJECT_PATHS.alltherepos]: projectValue(),
      [REAL_PROJECT_PATHS.hermes]: projectValue(),
      [REAL_PROJECT_PATHS.observer]: projectValue(),
    },
  };
}
