/**
 * Phase 3b Unit Test — `~/.claude.json` registry parser.
 *
 * Covers:
 *   - buildRegistry: REAL installed shape (path-keyed values with NO
 *     projectId/path) — hash derived by sanitizing the path key.
 *   - buildRegistry: legacy `projectId` shape (still honoured).
 *   - buildRegistry: legacy key-as-hash + value.path shape.
 *   - buildRegistry: JOIN of on-disk session-directory hashes (projects
 *     present on disk but absent from the config).
 *   - sanitizeRepoPath: `/` and `.` -> `-`.
 *   - Edge cases: missing `projects` key, null parsed, non-object,
 *     empty key skipped, repoPath maps both directions in forward/reverse.
 *   - loadClaudeRegistry: file missing → registry (possibly seeded by
 *     on-disk dirs), malformed JSON → same, valid file → builds via
 *     buildRegistry, on-disk session dirs JOINed.
 *   - claudeJsonPath / claudeProjectsRoot / claudeGlobalSettingsPath:
 *     anchor under os.homedir().
 *
 * Owner: qe-agent (Phase 3b); ATR-001 fix (Lane A).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildRegistry,
  loadClaudeRegistry,
  sanitizeRepoPath,
  claudeJsonPath,
  claudeProjectsRoot,
  claudeGlobalSettingsPath,
} from "@main/claude/registry";
import {
  realClaudeJson,
  REAL_PROJECT_PATHS,
  REAL_PROJECT_HASHES,
} from "./fixtures/real-claude-json";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

describe("claude path helpers", () => {
  it("claudeJsonPath() resolves to ~/.claude.json", () => {
    expect(claudeJsonPath()).toBe(path.join(os.homedir(), ".claude.json"));
  });

  it("claudeProjectsRoot() resolves to ~/.claude/projects", () => {
    expect(claudeProjectsRoot()).toBe(
      path.join(os.homedir(), ".claude", "projects"),
    );
  });

  it("claudeGlobalSettingsPath() resolves to ~/.claude/settings.json", () => {
    expect(claudeGlobalSettingsPath()).toBe(
      path.join(os.homedir(), ".claude", "settings.json"),
    );
  });
});

// ---------------------------------------------------------------------------
// buildRegistry — happy path
// ---------------------------------------------------------------------------

describe("buildRegistry — happy path", () => {
  it("builds forward + reverse maps from the documented shape", () => {
    const parsed = {
      projects: {
        "/Users/john/Projects/foo": { projectId: "hash-foo" },
        "/Users/john/Projects/bar": { projectId: "hash-bar" },
      },
    };
    const reg = buildRegistry(parsed);
    expect(reg.entries).toHaveLength(2);
    expect(reg.forward.get("/Users/john/Projects/foo")).toBe("hash-foo");
    expect(reg.forward.get("/Users/john/Projects/bar")).toBe("hash-bar");
    expect(reg.reverse.get("hash-foo")).toBe("/Users/john/Projects/foo");
    expect(reg.reverse.get("hash-bar")).toBe("/Users/john/Projects/bar");
  });

  it("falls back to key-as-hash + value.path when projectId is absent", () => {
    const parsed = {
      projects: {
        "weird-hash-key": { path: "/Users/john/Projects/legacy" },
      },
    };
    const reg = buildRegistry(parsed);
    expect(reg.entries).toEqual([
      { hash: "weird-hash-key", repoPath: "/Users/john/Projects/legacy" },
    ]);
    expect(reg.forward.get("/Users/john/Projects/legacy")).toBe(
      "weird-hash-key",
    );
    expect(reg.reverse.get("weird-hash-key")).toBe(
      "/Users/john/Projects/legacy",
    );
  });
});

// ---------------------------------------------------------------------------
// sanitizeRepoPath
// ---------------------------------------------------------------------------

describe("sanitizeRepoPath", () => {
  it("replaces every '/' and '.' with '-'", () => {
    expect(sanitizeRepoPath("/Users/john/Projects/foo")).toBe(
      "-Users-john-Projects-foo",
    );
  });

  it("collapses a dotfile dir into a double-dash", () => {
    // The leading '/' AND the '.' both become '-' -> "--hermes".
    expect(sanitizeRepoPath("/Users/john/.hermes")).toBe("-Users-john--hermes");
  });

  it("sanitizes nested dotted dirs (verified real-world shape)", () => {
    expect(sanitizeRepoPath("/Users/john/.claude-mem/observer-sessions")).toBe(
      "-Users-john--claude-mem-observer-sessions",
    );
  });
});

// ---------------------------------------------------------------------------
// buildRegistry — REAL installed shape (ATR-001 regression)
// ---------------------------------------------------------------------------

describe("buildRegistry — real ~/.claude.json shape", () => {
  it("builds a NON-EMPTY registry from path-keyed values with no projectId/path", () => {
    const reg = buildRegistry(realClaudeJson());
    expect(reg.entries.length).toBeGreaterThan(0);
    expect(reg.entries).toHaveLength(3);
  });

  it("derives each on-disk hash from the absolute path key", () => {
    const reg = buildRegistry(realClaudeJson());
    expect(reg.forward.get(REAL_PROJECT_PATHS.alltherepos)).toBe(
      REAL_PROJECT_HASHES.alltherepos,
    );
    expect(reg.forward.get(REAL_PROJECT_PATHS.hermes)).toBe(
      REAL_PROJECT_HASHES.hermes,
    );
    expect(reg.forward.get(REAL_PROJECT_PATHS.observer)).toBe(
      REAL_PROJECT_HASHES.observer,
    );
  });

  it("maps the derived hash back to the absolute path (reverse)", () => {
    const reg = buildRegistry(realClaudeJson());
    expect(reg.reverse.get(REAL_PROJECT_HASHES.alltherepos)).toBe(
      REAL_PROJECT_PATHS.alltherepos,
    );
    expect(reg.reverse.get(REAL_PROJECT_HASHES.hermes)).toBe(
      REAL_PROJECT_PATHS.hermes,
    );
  });
});

// ---------------------------------------------------------------------------
// buildRegistry — on-disk JOIN (options.onDiskHashes)
// ---------------------------------------------------------------------------

describe("buildRegistry — on-disk JOIN", () => {
  it("adds session-only hashes absent from the config", () => {
    const reg = buildRegistry(
      { projects: { [REAL_PROJECT_PATHS.hermes]: { allowedTools: [] } } },
      { onDiskHashes: [REAL_PROJECT_HASHES.hermes, "-Users-john--orphan"] },
    );
    expect(reg.entries).toHaveLength(2);
    // Config-backed project keeps its real path mapping.
    expect(reg.reverse.get(REAL_PROJECT_HASHES.hermes)).toBe(
      REAL_PROJECT_PATHS.hermes,
    );
    // Orphan dir indexed by hash (best-effort repoPath = hash).
    expect(reg.reverse.get("-Users-john--orphan")).toBe("-Users-john--orphan");
  });

  it("does not duplicate a hash already covered by the config", () => {
    const reg = buildRegistry(
      { projects: { [REAL_PROJECT_PATHS.hermes]: {} } },
      { onDiskHashes: [REAL_PROJECT_HASHES.hermes] },
    );
    expect(reg.entries).toHaveLength(1);
    expect(reg.reverse.get(REAL_PROJECT_HASHES.hermes)).toBe(
      REAL_PROJECT_PATHS.hermes,
    );
  });

  it("ignores empty/blank on-disk hash names", () => {
    const reg = buildRegistry(null, { onDiskHashes: ["", "-Users-john--a"] });
    expect(reg.entries).toHaveLength(1);
    expect(reg.entries[0]!.hash).toBe("-Users-john--a");
  });

  it("builds a registry from on-disk hashes alone when config is empty", () => {
    const reg = buildRegistry(null, {
      onDiskHashes: ["-Users-john--a", "-Users-john--b"],
    });
    expect(reg.entries).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// buildRegistry — edge cases
// ---------------------------------------------------------------------------

describe("buildRegistry — edge cases", () => {
  it("returns empty when parsed is null", () => {
    const reg = buildRegistry(null);
    expect(reg.entries).toEqual([]);
    expect(reg.forward.size).toBe(0);
    expect(reg.reverse.size).toBe(0);
  });

  it("returns empty when parsed is not an object", () => {
    expect(buildRegistry("not-an-object").entries).toEqual([]);
    expect(buildRegistry(42 as unknown).entries).toEqual([]);
  });

  it("returns empty when projects key is missing", () => {
    const reg = buildRegistry({ somethingElse: { foo: "bar" } });
    expect(reg.entries).toEqual([]);
  });

  it("returns empty when projects key is not an object", () => {
    const reg = buildRegistry({ projects: "no" });
    expect(reg.entries).toEqual([]);
  });

  it("keeps entries with no projectId/path by deriving the hash from the key", () => {
    // Real installed Claude Code emits NO projectId/path — the parser
    // MUST derive the hash from the absolute path key, not drop it.
    const reg = buildRegistry({
      projects: {
        "/Users/john/Projects/good": { projectId: "hash-good" },
        "/Users/john/Projects/bad": { irrelevant: true },
      },
    });
    expect(reg.entries).toHaveLength(2);
    // Legacy projectId still honoured.
    expect(reg.forward.get("/Users/john/Projects/good")).toBe("hash-good");
    // Real shape: hash derived from the path key.
    expect(reg.forward.get("/Users/john/Projects/bad")).toBe(
      "-Users-john-Projects-bad",
    );
  });

  it("skips entries whose key is an empty string", () => {
    const reg = buildRegistry({
      projects: {
        "": { projectId: "no-host" },
        "/Users/john/Projects/foo": { projectId: "hash-foo" },
      },
    });
    expect(reg.entries).toHaveLength(1);
    expect(reg.entries[0]!.repoPath).toBe("/Users/john/Projects/foo");
  });

  it("tolerates a null value blob by deriving the hash from the key", () => {
    // A null value still carries a valid path KEY, so the project is a
    // real project — hash is derived from the path.
    const reg = buildRegistry({
      projects: {
        "/Users/john/Projects/foo": null,
        "/Users/john/Projects/bar": { projectId: "hash-bar" },
      },
    });
    expect(reg.entries).toHaveLength(2);
    expect(reg.forward.get("/Users/john/Projects/foo")).toBe(
      "-Users-john-Projects-foo",
    );
    expect(reg.forward.get("/Users/john/Projects/bar")).toBe("hash-bar");
  });

  it("derives the hash from the key when projectId is non-string", () => {
    const reg = buildRegistry({
      projects: {
        "/Users/john/Projects/foo": { projectId: 42 },
      },
    });
    expect(reg.entries).toHaveLength(1);
    expect(reg.forward.get("/Users/john/Projects/foo")).toBe(
      "-Users-john-Projects-foo",
    );
  });

  it("returns empty when projects is an empty object", () => {
    const reg = buildRegistry({ projects: {} });
    expect(reg.entries).toEqual([]);
    expect(reg.forward.size).toBe(0);
    expect(reg.reverse.size).toBe(0);
  });

  it("dedupes config keys that sanitize to the same on-disk hash", () => {
    // Two distinct path keys can collapse to the same hash because both
    // '/' and '.' map to '-' (e.g. `/a.b` and `/a/b` -> `-a-b`). The
    // hash IS the on-disk session dir, so the registry must keep ONE
    // entry per hash; otherwise projectCount and the per-hash session
    // index would double-count. First writer wins.
    const reg = buildRegistry({
      projects: {
        "/Users/john/a.b": { projectId: undefined },
        "/Users/john/a/b": { projectId: undefined },
      },
    });
    // Both keys sanitize to `-Users-john-a-b`.
    expect(reg.reverse.size).toBe(1);
    expect(reg.entries).toHaveLength(1);
    expect(reg.entries.length).toBe(reg.reverse.size);
    expect(reg.reverse.get("-Users-john-a-b")).toBe("/Users/john/a.b");
  });
});

// ---------------------------------------------------------------------------
// loadClaudeRegistry — filesystem
// ---------------------------------------------------------------------------

describe("loadClaudeRegistry", () => {
  let tmpDir: string;
  // An empty (created, but no subdirs) projects root so the on-disk JOIN
  // contributes nothing and these assertions stay isolated from the
  // real `~/.claude/projects`.
  let emptyProjectsRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-registry-"));
    emptyProjectsRoot = path.join(tmpDir, "projects-empty");
    fs.mkdirSync(emptyProjectsRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty registry when the file is missing", () => {
    const reg = loadClaudeRegistry(
      path.join(tmpDir, "missing.json"),
      emptyProjectsRoot,
    );
    expect(reg.entries).toEqual([]);
    expect(reg.forward.size).toBe(0);
    expect(reg.reverse.size).toBe(0);
  });

  it("returns an empty registry when the file is malformed JSON", () => {
    const fp = path.join(tmpDir, "bad.json");
    fs.writeFileSync(fp, "{this is not json", "utf8");
    const reg = loadClaudeRegistry(fp, emptyProjectsRoot);
    expect(reg.entries).toEqual([]);
  });

  it("returns a populated registry for a well-formed file", () => {
    const fp = path.join(tmpDir, "good.json");
    fs.writeFileSync(
      fp,
      JSON.stringify({
        projects: {
          "/abs/path/one": { projectId: "h1" },
          "/abs/path/two": { projectId: "h2" },
        },
      }),
      "utf8",
    );
    const reg = loadClaudeRegistry(fp, emptyProjectsRoot);
    expect(reg.entries).toHaveLength(2);
    const hashes = reg.entries.map((e) => e.hash).sort();
    expect(hashes).toEqual(["h1", "h2"]);
  });

  it("returns an empty registry when the file is an empty string", () => {
    const fp = path.join(tmpDir, "empty.json");
    fs.writeFileSync(fp, "", "utf8");
    const reg = loadClaudeRegistry(fp, emptyProjectsRoot);
    expect(reg.entries).toEqual([]);
  });

  it("builds a NON-EMPTY registry from the REAL ~/.claude.json shape", () => {
    // Regression guard for ATR-001: the real wire format has no
    // projectId/path on any value. The old parser returned 0 entries.
    const fp = path.join(tmpDir, "real.json");
    fs.writeFileSync(fp, JSON.stringify(realClaudeJson()), "utf8");
    const reg = loadClaudeRegistry(fp, emptyProjectsRoot);
    expect(reg.entries.length).toBeGreaterThan(0);
    expect(reg.entries).toHaveLength(3);
    // A known path resolves to its on-disk hash.
    expect(reg.forward.get(REAL_PROJECT_PATHS.hermes)).toBe(
      REAL_PROJECT_HASHES.hermes,
    );
    expect(reg.reverse.get(REAL_PROJECT_HASHES.observer)).toBe(
      REAL_PROJECT_PATHS.observer,
    );
  });

  it("JOINs on-disk session dirs not present in the config file", () => {
    // Config knows ONE project; disk has that one plus a session-only
    // project. Both must surface so the watcher + usage pipeline see them.
    const fp = path.join(tmpDir, "partial.json");
    fs.writeFileSync(
      fp,
      JSON.stringify({
        projects: { [REAL_PROJECT_PATHS.hermes]: { allowedTools: [] } },
      }),
      "utf8",
    );
    const diskRoot = path.join(tmpDir, "projects-disk");
    fs.mkdirSync(path.join(diskRoot, REAL_PROJECT_HASHES.hermes), {
      recursive: true,
    });
    fs.mkdirSync(path.join(diskRoot, "-Users-johns-orphan-only"), {
      recursive: true,
    });
    // A stray file (not a dir) under the root must be ignored.
    fs.writeFileSync(path.join(diskRoot, "stray.txt"), "x", "utf8");

    const reg = loadClaudeRegistry(fp, diskRoot);
    // Config-backed project + session-only project = 2 entries.
    expect(reg.entries).toHaveLength(2);
    // Config project keeps its real repo path mapping.
    expect(reg.forward.get(REAL_PROJECT_PATHS.hermes)).toBe(
      REAL_PROJECT_HASHES.hermes,
    );
    // Session-only project is indexed by its hash (best-effort repoPath).
    expect(reg.reverse.has("-Users-johns-orphan-only")).toBe(true);
  });
});
