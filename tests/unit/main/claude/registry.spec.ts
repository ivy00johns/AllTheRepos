/**
 * Phase 3b Unit Test — `~/.claude.json` registry parser.
 *
 * Covers:
 *   - buildRegistry: happy path (projects object with `projectId` per entry).
 *   - buildRegistry: fallback shape where the key IS the hash + value has
 *     a `path` field.
 *   - Edge cases: missing `projects` key, null parsed, non-object,
 *     missing projectId AND missing path → entry dropped, empty key
 *     skipped, repoPath maps both directions in forward/reverse maps.
 *   - loadClaudeRegistry: file missing → empty registry, malformed JSON
 *     → empty registry, valid file → builds via buildRegistry.
 *   - claudeJsonPath / claudeProjectsRoot / claudeGlobalSettingsPath:
 *     anchor under os.homedir().
 *
 * Owner: qe-agent (Phase 3b).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildRegistry,
  loadClaudeRegistry,
  claudeJsonPath,
  claudeProjectsRoot,
  claudeGlobalSettingsPath,
} from "@main/claude/registry";

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
// buildRegistry
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

  it("skips entries with missing projectId AND no path field", () => {
    const reg = buildRegistry({
      projects: {
        "/Users/john/Projects/good": { projectId: "hash-good" },
        "/Users/john/Projects/bad": { irrelevant: true },
      },
    });
    expect(reg.entries).toHaveLength(1);
    expect(reg.entries[0]!.hash).toBe("hash-good");
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

  it("tolerates a null value blob (skipped silently)", () => {
    const reg = buildRegistry({
      projects: {
        "/Users/john/Projects/foo": null,
        "/Users/john/Projects/bar": { projectId: "hash-bar" },
      },
    });
    expect(reg.entries).toHaveLength(1);
    expect(reg.entries[0]!.hash).toBe("hash-bar");
  });

  it("ignores non-string projectId values", () => {
    const reg = buildRegistry({
      projects: {
        "/Users/john/Projects/foo": { projectId: 42 },
      },
    });
    expect(reg.entries).toEqual([]);
  });

  it("returns empty when projects is an empty object", () => {
    const reg = buildRegistry({ projects: {} });
    expect(reg.entries).toEqual([]);
    expect(reg.forward.size).toBe(0);
    expect(reg.reverse.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// loadClaudeRegistry — filesystem
// ---------------------------------------------------------------------------

describe("loadClaudeRegistry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-registry-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty registry when the file is missing", () => {
    const reg = loadClaudeRegistry(path.join(tmpDir, "missing.json"));
    expect(reg.entries).toEqual([]);
    expect(reg.forward.size).toBe(0);
    expect(reg.reverse.size).toBe(0);
  });

  it("returns an empty registry when the file is malformed JSON", () => {
    const fp = path.join(tmpDir, "bad.json");
    fs.writeFileSync(fp, "{this is not json", "utf8");
    const reg = loadClaudeRegistry(fp);
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
    const reg = loadClaudeRegistry(fp);
    expect(reg.entries).toHaveLength(2);
    const hashes = reg.entries.map((e) => e.hash).sort();
    expect(hashes).toEqual(["h1", "h2"]);
  });

  it("returns an empty registry when the file is an empty string", () => {
    const fp = path.join(tmpDir, "empty.json");
    fs.writeFileSync(fp, "", "utf8");
    const reg = loadClaudeRegistry(fp);
    expect(reg.entries).toEqual([]);
  });
});
