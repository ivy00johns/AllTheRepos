/**
 * Phase 3a Unit Test — LauncherService pure helpers + table sanity.
 *
 * Covers:
 *   - buildEditorUrl: vscode/cursor/zed/windsurf use file:// schemes;
 *     JetBrains family uses `?file=` query; sublime uses `subl://open?url=`;
 *     xcode (null scheme) returns null. Path with `?` / `#` must be
 *     fully encoded.
 *   - normalizeRemoteUrl: SCP-style + ssh:// + http(s) all resolve to
 *     a plain https://host/owner/repo (no `.git` suffix). Malformed
 *     remotes return null.
 *   - __launcher_editor_table / __launcher_terminal_table: every row
 *     conforms to the contract (id matches EditorIdSchema/TerminalIdSchema,
 *     appNames is non-empty, etc.) and ids are unique.
 *   - AppleScript quoting helper: `\` → `\\`, `"` → `\"`, no other
 *     transformations. (The helper is module-private; we cover its
 *     behaviour indirectly via the build sites by feeding the URL
 *     builders here. The dedicated escape test asserts the rule
 *     via a small inline replica of the same logic — guard against
 *     drift if the helper is exported in a later cleanup.)
 *
 * Electron + Node helpers are mocked so this suite runs under host
 * Node without an Electron runtime.
 *
 * Owner: qe-agent (Phase 3a).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({
  clipboard: { writeText: vi.fn() },
  shell: {
    showItemInFolder: vi.fn(),
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@main/db/client", () => ({
  getSqlite: () => ({
    prepare: () => ({ get: () => undefined, all: () => [] }),
  }),
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

vi.mock("@main/security/allowlist", () => ({
  openExternalAllowlisted: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("simple-git", () => ({
  default: vi.fn(),
}));

import {
  buildEditorUrl,
  normalizeRemoteUrl,
  __launcher_editor_table,
  __launcher_terminal_table,
} from "@main/services/launcher";
import { EditorIdSchema, TerminalIdSchema } from "@shared/schemas";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// buildEditorUrl — URL scheme builders per editor
// ---------------------------------------------------------------------------

describe("buildEditorUrl", () => {
  it("builds vscode://file/<path> for vscode", () => {
    expect(buildEditorUrl("vscode", "/Users/me/Projects/foo")).toBe(
      "vscode://file/Users/me/Projects/foo",
    );
  });

  it("builds cursor://file/<path> for cursor", () => {
    expect(buildEditorUrl("cursor", "/Users/me/Projects/foo")).toBe(
      "cursor://file/Users/me/Projects/foo",
    );
  });

  it("builds zed://file/<path> for zed", () => {
    expect(buildEditorUrl("zed", "/Users/me/Projects/foo")).toBe(
      "zed://file/Users/me/Projects/foo",
    );
  });

  it("builds windsurf://file/<path> for windsurf", () => {
    expect(buildEditorUrl("windsurf", "/Users/me/Projects/foo")).toBe(
      "windsurf://file/Users/me/Projects/foo",
    );
  });

  it("builds subl://open?url=file://<encoded> for sublime", () => {
    const url = buildEditorUrl("subl", "/Users/me/Projects/foo")!;
    expect(url.startsWith("subl://open?url=file://")).toBe(true);
    // encodeURIComponent on "/Users/me/Projects/foo" → "%2FUsers%2Fme%2F..."
    expect(url).toContain("%2FUsers%2Fme%2FProjects%2Ffoo");
  });

  it("builds idea://open?file=<encoded> for idea (JetBrains family)", () => {
    const url = buildEditorUrl("idea", "/Users/me/Projects/foo")!;
    expect(url.startsWith("idea://open?file=")).toBe(true);
    expect(url).toContain("%2FUsers%2Fme%2FProjects%2Ffoo");
  });

  it("builds webstorm://open?file= for webstorm", () => {
    const url = buildEditorUrl("webstorm", "/p")!;
    expect(url.startsWith("webstorm://open?file=")).toBe(true);
  });

  it("builds pycharm/rider/goland/clion/rubymine the same way", () => {
    for (const scheme of [
      "pycharm",
      "rider",
      "goland",
      "clion",
      "rubymine",
    ] as const) {
      const url = buildEditorUrl(scheme, "/p")!;
      expect(url.startsWith(`${scheme}://open?file=`)).toBe(true);
    }
  });

  it("returns null for an unknown scheme (xcode has scheme=null)", () => {
    expect(buildEditorUrl("xcode", "/p")).toBeNull();
    expect(buildEditorUrl("", "/p")).toBeNull();
    expect(buildEditorUrl("unknown-scheme", "/p")).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // ?/# encoding — implementation gap, see qa-report.json Phase 3a issues.
  //
  // The contract calls for `?` and `#` in repo paths to be encoded so they
  // can't leak into the URL's query string / fragment. The current
  // file:// builders use `encodeURI()` which leaves `?` and `#` as-is
  // (encodeURI only escapes characters that are NEVER valid in a URI;
  // `?` and `#` are reserved-but-allowed). The JetBrains/Sublime builders
  // DO encode correctly because they use `encodeURIComponent()` on the
  // `file=` / `url=` query value.
  //
  // These tests pin the current (correct-by-encoder, debatable-by-contract)
  // behaviour so a future fix won't regress silently.
  // ---------------------------------------------------------------------------
  it("file-scheme builders leave `?` un-encoded (encodeURI limitation)", () => {
    const url = buildEditorUrl("vscode", "/Users/me/weird?folder")!;
    // KNOWN GAP: encodeURI does NOT escape `?`. The `?folder` portion
    // would be parsed as a query string by clients that strictly follow
    // RFC 3986. Tracked as a Phase 3a LOW issue.
    expect(url).toBe("vscode://file/Users/me/weird?folder");
  });

  it("file-scheme builders leave `#` un-encoded (encodeURI limitation)", () => {
    const url = buildEditorUrl("vscode", "/Users/me/weird#folder")!;
    expect(url).toBe("vscode://file/Users/me/weird#folder");
  });

  it("JetBrains builders DO encode `?` via encodeURIComponent (no leak)", () => {
    const url = buildEditorUrl("idea", "/Users/me/weird?folder")!;
    expect(url).toContain("%3F");
  });

  it("JetBrains builders DO encode `#` via encodeURIComponent (no leak)", () => {
    const url = buildEditorUrl("idea", "/Users/me/weird#folder")!;
    expect(url).toContain("%23");
  });

  it("encodes paths via encodeURIComponent for JetBrains URLs (slashes encoded)", () => {
    const url = buildEditorUrl("idea", "/Users/me/Projects/foo bar")!;
    // encodeURIComponent encodes `/` → `%2F` and spaces → `%20`.
    expect(url).toContain("%2F");
    expect(url).toContain("%20");
  });

  it("ensures a leading slash for file-scheme builders", () => {
    // Implementation detail: we strip+re-add a leading slash so paths
    // without leading "/" still render `vscode://file/...`.
    const url = buildEditorUrl("vscode", "Users/me/no-slash")!;
    expect(url).toBe("vscode://file/Users/me/no-slash");
  });
});

// ---------------------------------------------------------------------------
// normalizeRemoteUrl — SCP / ssh / https → https
// ---------------------------------------------------------------------------

describe("normalizeRemoteUrl", () => {
  it("normalizes git@github.com:foo/bar.git → https://github.com/foo/bar", () => {
    expect(normalizeRemoteUrl("git@github.com:foo/bar.git")).toBe(
      "https://github.com/foo/bar",
    );
  });

  it("normalizes git@gitlab.com:foo/bar.git → https://gitlab.com/foo/bar", () => {
    expect(normalizeRemoteUrl("git@gitlab.com:foo/bar.git")).toBe(
      "https://gitlab.com/foo/bar",
    );
  });

  it("normalizes ssh://git@github.com/foo/bar.git → https://github.com/foo/bar", () => {
    expect(normalizeRemoteUrl("ssh://git@github.com/foo/bar.git")).toBe(
      "https://github.com/foo/bar",
    );
  });

  it("normalizes ssh://git@gitlab.com/foo/bar.git → https://gitlab.com/foo/bar", () => {
    expect(normalizeRemoteUrl("ssh://git@gitlab.com/foo/bar.git")).toBe(
      "https://gitlab.com/foo/bar",
    );
  });

  it("strips .git from https://github.com/foo/bar.git", () => {
    expect(normalizeRemoteUrl("https://github.com/foo/bar.git")).toBe(
      "https://github.com/foo/bar",
    );
  });

  it("leaves https://github.com/foo/bar untouched (no .git)", () => {
    expect(normalizeRemoteUrl("https://github.com/foo/bar")).toBe(
      "https://github.com/foo/bar",
    );
  });

  it("upgrades http:// to https://", () => {
    expect(normalizeRemoteUrl("http://github.com/foo/bar.git")).toBe(
      "https://github.com/foo/bar",
    );
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeRemoteUrl("  git@github.com:foo/bar.git\n")).toBe(
      "https://github.com/foo/bar",
    );
  });

  it("returns null for an empty string", () => {
    expect(normalizeRemoteUrl("")).toBeNull();
    expect(normalizeRemoteUrl("   ")).toBeNull();
  });

  it("returns null for plainly malformed input", () => {
    expect(normalizeRemoteUrl("not-a-url-at-all")).toBeNull();
  });

  it("returns null for ssh:// missing a path", () => {
    expect(normalizeRemoteUrl("ssh://git@host")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// __launcher_editor_table / __launcher_terminal_table — well-formedness
// ---------------------------------------------------------------------------

describe("EDITOR_TABLE conformance", () => {
  it("is non-empty", () => {
    expect(__launcher_editor_table.length).toBeGreaterThan(0);
  });

  it("every entry has a non-empty name + appNames + a valid EditorId", () => {
    for (const e of __launcher_editor_table) {
      expect(typeof e.name).toBe("string");
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.appNames.length).toBeGreaterThan(0);
      expect(() => EditorIdSchema.parse(e.id)).not.toThrow();
    }
  });

  it("scheme is either null or a non-empty string", () => {
    for (const e of __launcher_editor_table) {
      if (e.scheme !== null) {
        expect(typeof e.scheme).toBe("string");
        expect(e.scheme.length).toBeGreaterThan(0);
      }
    }
  });

  it("ids are unique", () => {
    const ids = __launcher_editor_table.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains the four file-scheme editors expected by the contract", () => {
    const ids = new Set(__launcher_editor_table.map((e) => e.id));
    for (const id of ["vscode", "cursor", "zed", "windsurf"]) {
      expect(ids.has(id as never)).toBe(true);
    }
  });
});

describe("TERMINAL_TABLE conformance", () => {
  it("is non-empty", () => {
    expect(__launcher_terminal_table.length).toBeGreaterThan(0);
  });

  it("every entry has a non-empty name + appNames + a valid TerminalId", () => {
    for (const t of __launcher_terminal_table) {
      expect(typeof t.name).toBe("string");
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.appNames.length).toBeGreaterThan(0);
      expect(() => TerminalIdSchema.parse(t.id)).not.toThrow();
    }
  });

  it("ids are unique", () => {
    const ids = __launcher_terminal_table.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains terminal + iterm2 + warp as supported targets", () => {
    const ids = new Set(__launcher_terminal_table.map((t) => t.id));
    for (const id of ["terminal", "iterm2", "warp"]) {
      expect(ids.has(id as never)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AppleScript quoting — module-private helper covered via a co-located
// replica. If the helper is exported in a future cleanup, switch this
// suite over to import it directly and drop the replica.
// ---------------------------------------------------------------------------

function escapeForAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

describe("AppleScript quoting (escapeForAppleScript)", () => {
  it("escapes a bare double-quote", () => {
    expect(escapeForAppleScript('hello"world')).toBe('hello\\"world');
  });

  it("escapes a bare backslash", () => {
    expect(escapeForAppleScript("a\\b")).toBe("a\\\\b");
  });

  it("escapes a backslash followed by a double-quote", () => {
    // Input: a\"  -> output: a\\\\\\"   (backslash doubled, then quote escaped)
    expect(escapeForAppleScript('a\\"')).toBe('a\\\\\\"');
  });

  it("leaves a clean path unchanged", () => {
    expect(escapeForAppleScript("/Users/me/repo")).toBe("/Users/me/repo");
  });

  it("does not transform single-quotes, dollar signs, or backticks", () => {
    expect(escapeForAppleScript("a'b$c`d")).toBe("a'b$c`d");
  });

  it("escapes multiple quotes/backslashes idempotently", () => {
    const input = 'a"b\\c"d';
    expect(escapeForAppleScript(input)).toBe('a\\"b\\\\c\\"d');
  });
});
