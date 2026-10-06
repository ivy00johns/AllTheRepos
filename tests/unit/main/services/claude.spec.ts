/**
 * Phase 3b Unit Test — ClaudeService test seams (pure helpers).
 *
 * Covers:
 *   - buildLaunchCommand: plain "claude" / --resume / --prompt with
 *     shell-quoted starter prompt; missing optional fields omitted.
 *   - __claude_shell_single_quote: replaces single-quotes with the
 *     POSIX `'\''` escape sequence and wraps the whole thing in
 *     single quotes.
 *   - __claude_build_editor_file_url: vscode/cursor/zed/windsurf/devin
 *     produce `<scheme>://file<path>` (URL-encoded); JetBrains family
 *     uses `<scheme>://open?file=<encoded>`; sublime uses
 *     `subl://open?url=file://<encoded>`; xcode / unknown → null.
 *
 * Heavy deps (electron, db, services) are mocked so the module loads
 * under host Node.
 *
 * Owner: qe-agent (Phase 3b).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isFocused: () => true, on: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  shell: { showItemInFolder: vi.fn(), openExternal: vi.fn() },
  clipboard: { writeText: vi.fn() },
}));

vi.mock("@main/db/client", () => ({
  getSqlite: () => ({
    prepare: () => ({ get: () => undefined, all: () => [] }),
  }),
}));

vi.mock("@main/security/allowlist", () => ({
  openExternalAllowlisted: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@main/services/settings", () => ({
  getSettings: () => ({
    scanPaths: [],
    ollamaBaseUrl: "http://localhost:11434",
    ollamaEmbedModel: "nomic-embed-text",
    openaiEmbedModel: null,
    defaultEditor: "none",
    schemaVersion: 1,
  }),
}));

vi.mock("@main/services/launcher", () => ({
  launcherService: {
    boot: vi.fn(),
    detect: vi.fn(() => ({
      editors: [],
      terminals: [],
      defaults: { editor: null, terminal: null },
    })),
    openInEditor: vi.fn(),
    openInTerminal: vi.fn(),
    openInFinder: vi.fn(),
    openRemote: vi.fn(),
    copyPath: vi.fn(),
  },
}));

vi.mock("chokidar", () => ({
  default: { watch: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })) },
}));

import {
  buildLaunchCommand,
  __claude_build_editor_file_url,
  __claude_shell_single_quote,
} from "@main/services/claude";

// ---------------------------------------------------------------------------
// buildLaunchCommand
// ---------------------------------------------------------------------------

describe("buildLaunchCommand", () => {
  it("emits just `claude` when no resumeSessionId or starterPrompt", () => {
    expect(buildLaunchCommand({ slug: "foo" })).toBe("claude");
  });

  it("emits --resume <id> when resumeSessionId is provided", () => {
    expect(
      buildLaunchCommand({ slug: "foo", resumeSessionId: "sess-123" }),
    ).toBe("claude --resume sess-123");
  });

  it("omits --resume when resumeSessionId is empty", () => {
    expect(buildLaunchCommand({ slug: "foo", resumeSessionId: "" })).toBe(
      "claude",
    );
  });

  it("emits --prompt <quoted> when starterPrompt is provided", () => {
    expect(
      buildLaunchCommand({ slug: "foo", starterPrompt: "hello world" }),
    ).toBe("claude --prompt 'hello world'");
  });

  it("shell-quotes a starterPrompt containing single quotes", () => {
    expect(buildLaunchCommand({ slug: "foo", starterPrompt: "it's me" })).toBe(
      "claude --prompt 'it'\\''s me'",
    );
  });

  it("combines --resume and --prompt in order", () => {
    expect(
      buildLaunchCommand({
        slug: "foo",
        resumeSessionId: "abc",
        starterPrompt: "go",
      }),
    ).toBe("claude --resume abc --prompt 'go'");
  });

  it("omits --prompt when starterPrompt is an empty string", () => {
    expect(buildLaunchCommand({ slug: "foo", starterPrompt: "" })).toBe(
      "claude",
    );
  });
});

// ---------------------------------------------------------------------------
// __claude_shell_single_quote
// ---------------------------------------------------------------------------

describe("__claude_shell_single_quote", () => {
  it("wraps a plain string in single quotes", () => {
    expect(__claude_shell_single_quote("hello")).toBe("'hello'");
  });

  it("escapes embedded single quotes via the `'\\''` sequence", () => {
    expect(__claude_shell_single_quote("it's me")).toBe("'it'\\''s me'");
  });

  it("does not escape double quotes, backslashes, or shell metacharacters", () => {
    expect(__claude_shell_single_quote('a"b\\c$d')).toBe("'a\"b\\c$d'");
  });

  it("returns just the empty single-quoted string for empty input", () => {
    expect(__claude_shell_single_quote("")).toBe("''");
  });

  it("handles a string of only quotes", () => {
    expect(__claude_shell_single_quote("''")).toBe("''\\'''\\'''");
  });
});

// ---------------------------------------------------------------------------
// __claude_build_editor_file_url
// ---------------------------------------------------------------------------

describe("__claude_build_editor_file_url", () => {
  it("vscode/cursor/zed/windsurf/devin use <scheme>://file<encodedPath>", () => {
    for (const scheme of ["vscode", "cursor", "zed", "windsurf", "devin"]) {
      const url = __claude_build_editor_file_url(
        scheme,
        "/Users/me/Projects/foo/CLAUDE.md",
      );
      expect(url).toBe(`${scheme}://file/Users/me/Projects/foo/CLAUDE.md`);
    }
  });

  it("adds a leading slash to file URLs when the path doesn't start with one", () => {
    const url = __claude_build_editor_file_url("vscode", "Users/me/no-slash");
    expect(url).toBe("vscode://file/Users/me/no-slash");
  });

  it("encodes spaces in file:// schemes via encodeURI", () => {
    const url = __claude_build_editor_file_url(
      "vscode",
      "/Users/me/My Projects/foo.md",
    );
    expect(url).toBe("vscode://file/Users/me/My%20Projects/foo.md");
  });

  it("subl returns subl://open?url=file://<encodedFileParam>", () => {
    const url = __claude_build_editor_file_url(
      "subl",
      "/Users/me/Projects/foo/CLAUDE.md",
    );
    expect(url).toBe(
      "subl://open?url=file://%2FUsers%2Fme%2FProjects%2Ffoo%2FCLAUDE.md",
    );
  });

  it("JetBrains family uses <scheme>://open?file=<encoded>", () => {
    for (const scheme of [
      "idea",
      "webstorm",
      "pycharm",
      "rider",
      "goland",
      "clion",
      "rubymine",
    ]) {
      const url = __claude_build_editor_file_url(
        scheme,
        "/Users/me/Projects/foo/CLAUDE.md",
      );
      expect(url).toBe(
        `${scheme}://open?file=%2FUsers%2Fme%2FProjects%2Ffoo%2FCLAUDE.md`,
      );
    }
  });

  it("encodes ? and # in the file param for JetBrains/Sublime (encodeURIComponent)", () => {
    const url = __claude_build_editor_file_url(
      "idea",
      "/Users/me/path?has#chars/CLAUDE.md",
    );
    expect(url).toContain("%3F"); // ?
    expect(url).toContain("%23"); // #
  });

  it("returns null for unknown / xcode-style schemes", () => {
    expect(__claude_build_editor_file_url("xcode", "/a/b.md")).toBeNull();
    expect(__claude_build_editor_file_url("notreal", "/a/b.md")).toBeNull();
    expect(__claude_build_editor_file_url("", "/a/b.md")).toBeNull();
  });
});
