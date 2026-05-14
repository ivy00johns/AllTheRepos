/**
 * Phase 3b Unit Test — per-repo `.claude/` state reader.
 *
 * Covers:
 *   - parseFrontmatter: valid YAML → data object; empty file → empty
 *     data; invalid YAML → empty data (no throw); no frontmatter
 *     delimiter → empty data.
 *   - mergeMcpServers: project + global merged with configuredIn tags;
 *     conflict (same name in both) → project wins; type detection
 *     (stdio / sse / http / unknown); null block tolerated.
 *   - safeReadJson: missing → null; malformed → null; valid → parsed.
 *   - loadSkills: walks .claude/skills/ for SKILL.md; falls back to
 *     dirname when frontmatter.name absent.
 *   - loadAgents: walks .claude/agents/*.md; falls back to basename;
 *     non-.md ignored.
 *   - repoHasClaude: true when .claude/ exists, true when registered
 *     even without .claude/, false otherwise.
 *
 * Owner: qe-agent (Phase 3b).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseFrontmatter,
  mergeMcpServers,
  safeReadJson,
  loadSkills,
  loadAgents,
  repoHasClaude,
} from "@main/claude/repo-claude";

// ---------------------------------------------------------------------------
// Temp filesystem
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-repo-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(rel: string, content: string): string {
  const fp = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, "utf8");
  return fp;
}

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe("parseFrontmatter", () => {
  it("extracts a valid YAML frontmatter block", () => {
    const out = parseFrontmatter(
      [
        "---",
        "name: my-skill",
        "description: does a thing",
        "tags:",
        "  - alpha",
        "  - beta",
        "---",
        "Body content here.",
      ].join("\n"),
    );
    expect(out.data.name).toBe("my-skill");
    expect(out.data.description).toBe("does a thing");
    expect(out.data.tags).toEqual(["alpha", "beta"]);
    expect(out.body).toContain("Body content here");
  });

  it("returns empty data for an empty source", () => {
    const out = parseFrontmatter("");
    expect(out.data).toEqual({});
  });

  it("returns empty data when there is no frontmatter delimiter", () => {
    const out = parseFrontmatter("# Just a heading\nNo YAML at the top.");
    expect(out.data).toEqual({});
    expect(out.body).toContain("Just a heading");
  });

  it("does not throw on invalid YAML — returns empty data", () => {
    const out = parseFrontmatter(
      [
        "---",
        "this is not: : valid yaml",
        "  - dangling",
        "  bare bad",
        "---",
        "body",
      ].join("\n"),
    );
    expect(out.data).toEqual({});
  });

  it("treats non-object frontmatter (e.g. plain string) as empty data", () => {
    const out = parseFrontmatter(
      ["---", '"just a string"', "---", "body"].join("\n"),
    );
    expect(out.data).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// safeReadJson
// ---------------------------------------------------------------------------

describe("safeReadJson", () => {
  it("returns null when the file does not exist", () => {
    expect(safeReadJson(path.join(tmpDir, "nope.json"))).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    const fp = writeFile("bad.json", "{this is not json");
    expect(safeReadJson(fp)).toBeNull();
  });

  it("returns the parsed object for a well-formed file", () => {
    const fp = writeFile("good.json", JSON.stringify({ a: 1, b: [2, 3] }));
    expect(safeReadJson(fp)).toEqual({ a: 1, b: [2, 3] });
  });
});

// ---------------------------------------------------------------------------
// mergeMcpServers
// ---------------------------------------------------------------------------

describe("mergeMcpServers", () => {
  it("merges project + global with correct configuredIn tags", () => {
    const project = {
      mcpServers: {
        "proj-a": { command: "node", args: ["x.js"] },
      },
    };
    const global = {
      mcpServers: {
        "glob-a": { command: "python", args: ["y.py"] },
      },
    };
    const merged = mergeMcpServers(project, global);
    expect(merged).toHaveLength(2);
    const projEntry = merged.find((m) => m.name === "proj-a")!;
    const globEntry = merged.find((m) => m.name === "glob-a")!;
    expect(projEntry.configuredIn).toBe("project");
    expect(globEntry.configuredIn).toBe("global");
    expect(projEntry.command).toBe("node");
    expect(projEntry.args).toEqual(["x.js"]);
  });

  it("project wins on name conflict — global entry is dropped", () => {
    const project = {
      mcpServers: { dup: { command: "node" } },
    };
    const global = {
      mcpServers: { dup: { command: "python" } },
    };
    const merged = mergeMcpServers(project, global);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.configuredIn).toBe("project");
    expect(merged[0]!.command).toBe("node");
  });

  it("places project entries before global entries", () => {
    const project = {
      mcpServers: {
        zproj: { command: "node" },
      },
    };
    const global = {
      mcpServers: {
        aglob: { command: "node" },
      },
    };
    const merged = mergeMcpServers(project, global);
    expect(merged.map((m) => m.name)).toEqual(["zproj", "aglob"]);
  });

  it("normalizes type: stdio / sse / http stay; unknown maps to unknown", () => {
    const merged = mergeMcpServers(
      {
        mcpServers: {
          a: { type: "stdio", command: "x" },
          b: { type: "sse", command: "x" },
          c: { type: "http", url: "https://x" },
          d: { type: "weird", command: "x" },
          e: { command: "x" },
        },
      },
      null,
    );
    expect(merged.find((m) => m.name === "a")!.type).toBe("stdio");
    expect(merged.find((m) => m.name === "b")!.type).toBe("sse");
    expect(merged.find((m) => m.name === "c")!.type).toBe("http");
    expect(merged.find((m) => m.name === "d")!.type).toBe("unknown");
    expect(merged.find((m) => m.name === "e")!.type).toBe("unknown");
  });

  it("tolerates a null project blob (only global entries)", () => {
    const merged = mergeMcpServers(null, {
      mcpServers: { only: { command: "node" } },
    });
    expect(merged).toEqual([
      {
        name: "only",
        type: "unknown",
        command: "node",
        args: null,
        configuredIn: "global",
        status: "configured",
      },
    ]);
  });

  it("returns [] when both blobs are null", () => {
    expect(mergeMcpServers(null, null)).toEqual([]);
  });

  it("ignores non-object blob shapes (e.g. array, string)", () => {
    expect(mergeMcpServers([], "not-an-object")).toEqual([]);
  });

  it("returns [] when mcpServers key is missing or non-object", () => {
    expect(mergeMcpServers({ irrelevant: true }, {})).toEqual([]);
    expect(mergeMcpServers({ mcpServers: "no" }, {})).toEqual([]);
  });

  it("filters non-string entries in args", () => {
    const merged = mergeMcpServers(
      {
        mcpServers: {
          srv: { command: "node", args: ["x", 42, "y", null] },
        },
      },
      null,
    );
    expect(merged[0]!.args).toEqual(["x", "y"]);
  });

  it("returns args=null when the value's args field is missing or non-array", () => {
    const merged = mergeMcpServers(
      {
        mcpServers: {
          a: { command: "node" },
          b: { command: "node", args: "not-an-array" },
        },
      },
      null,
    );
    expect(merged.find((m) => m.name === "a")!.args).toBeNull();
    expect(merged.find((m) => m.name === "b")!.args).toBeNull();
  });

  it("handles a null per-server value blob with an 'unavailable' status", () => {
    const merged = mergeMcpServers(
      {
        mcpServers: {
          dud: null,
          good: { command: "node" },
        },
      },
      null,
    );
    expect(merged.find((m) => m.name === "dud")).toEqual({
      name: "dud",
      type: "unknown",
      command: null,
      args: null,
      configuredIn: "project",
      status: "unavailable",
    });
    expect(merged.find((m) => m.name === "good")!.status).toBe("configured");
  });

  it("skips empty server names", () => {
    const merged = mergeMcpServers(
      {
        mcpServers: {
          "": { command: "node" },
          good: { command: "node" },
        },
      },
      null,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.name).toBe("good");
  });
});

// ---------------------------------------------------------------------------
// loadSkills
// ---------------------------------------------------------------------------

describe("loadSkills", () => {
  it("returns [] when .claude/skills/ does not exist", () => {
    expect(loadSkills(tmpDir)).toEqual([]);
  });

  it("loads one skill per SKILL.md and reads its frontmatter", () => {
    writeFile(
      ".claude/skills/foo/SKILL.md",
      [
        "---",
        "name: foo-skill",
        "description: foo helper",
        "---",
        "Body.",
      ].join("\n"),
    );
    writeFile(
      ".claude/skills/bar/SKILL.md",
      ["---", "description: a bar skill", "---", "Body."].join("\n"),
    );
    const out = loadSkills(tmpDir);
    expect(out).toHaveLength(2);
    const foo = out.find((s) => s.path.includes("foo/SKILL.md"))!;
    const bar = out.find((s) => s.path.includes("bar/SKILL.md"))!;
    expect(foo.name).toBe("foo-skill");
    expect(foo.description).toBe("foo helper");
    // bar has no name → falls back to directory name
    expect(bar.name).toBe("bar");
    expect(bar.description).toBe("a bar skill");
  });

  it("description defaults to empty string when frontmatter omits it", () => {
    writeFile(
      ".claude/skills/baz/SKILL.md",
      ["---", "name: baz", "---", "Body."].join("\n"),
    );
    const out = loadSkills(tmpDir);
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBe("");
  });

  it("ignores non-SKILL.md files in the skills directory", () => {
    writeFile(".claude/skills/something/SKILL.md", "---\nname: thing\n---\n");
    writeFile(".claude/skills/something/README.md", "noise");
    const out = loadSkills(tmpDir);
    expect(out).toHaveLength(1);
  });

  it("walks nested skill directories (depth > 1)", () => {
    writeFile(
      ".claude/skills/group/nested/SKILL.md",
      ["---", "name: nested", "---", "Body."].join("\n"),
    );
    const out = loadSkills(tmpDir);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("nested");
  });
});

// ---------------------------------------------------------------------------
// loadAgents
// ---------------------------------------------------------------------------

describe("loadAgents", () => {
  it("returns [] when .claude/agents/ does not exist", () => {
    expect(loadAgents(tmpDir)).toEqual([]);
  });

  it("loads one agent per .md file with frontmatter name + description", () => {
    writeFile(
      ".claude/agents/qa-agent.md",
      ["---", "name: qa", "description: quality engineer", "---", "Body."].join(
        "\n",
      ),
    );
    writeFile(
      ".claude/agents/backend.md",
      ["---", "description: api code", "---"].join("\n"),
    );
    const out = loadAgents(tmpDir);
    expect(out).toHaveLength(2);
    const qa = out.find((a) => a.path.endsWith("qa-agent.md"))!;
    const be = out.find((a) => a.path.endsWith("backend.md"))!;
    expect(qa.name).toBe("qa");
    expect(qa.description).toBe("quality engineer");
    expect(be.name).toBe("backend");
    expect(be.description).toBe("api code");
  });

  it("ignores non-.md files", () => {
    writeFile(".claude/agents/a.md", "---\nname: a\n---\n");
    writeFile(".claude/agents/b.txt", "irrelevant");
    writeFile(".claude/agents/c.json", "{}");
    const out = loadAgents(tmpDir);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("a");
  });

  it("is non-recursive — nested .md files are ignored", () => {
    writeFile(".claude/agents/sub/nested.md", "---\nname: nested\n---\n");
    writeFile(".claude/agents/top.md", "---\nname: top\n---\n");
    const out = loadAgents(tmpDir);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("top");
  });
});

// ---------------------------------------------------------------------------
// repoHasClaude
// ---------------------------------------------------------------------------

describe("repoHasClaude", () => {
  it("returns true when <repo>/.claude/ exists", () => {
    fs.mkdirSync(path.join(tmpDir, ".claude"), { recursive: true });
    expect(repoHasClaude(tmpDir, new Set())).toBe(true);
  });

  it("returns false when <repo>/.claude/ does not exist AND repo not in registry", () => {
    expect(repoHasClaude(tmpDir, new Set())).toBe(false);
  });

  it("returns true when the registry knows the repo, even without .claude/", () => {
    expect(repoHasClaude(tmpDir, new Set([tmpDir]))).toBe(true);
  });
});
