/**
 * Unit test — `GitService.resolveEditorUri` (`git:openInEditor`).
 *
 * The URI builder used to be a two-case switch — `vscode` and `cursor`,
 * `default: null` for everything else — so a user whose default editor was
 * Zed, Devin, IntelliJ … got an `{ opened: false }` result no matter what
 * they had chosen, even though the launcher's detection table knew about
 * their editor. It now dispatches through the launcher's scheme table, and
 * this suite pins that: every detected editor must resolve to the scheme
 * it registers, and the two "nothing to open" cases must stay `null`.
 *
 * Nothing here touches disk or Electron: the SQLite lookup, the settings
 * blob, the allowlist, `@main/db/queries` and `simple-git` are all mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({
  clipboard: { writeText: vi.fn() },
  shell: {
    showItemInFolder: vi.fn(),
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("simple-git", () => {
  const factory = () => ({});
  return { default: factory, simpleGit: factory };
});

vi.mock("@main/db/client", () => ({
  getSqlite: () => ({
    prepare: () => ({
      get: (slug: string) =>
        slug === "known-repo"
          ? { full_path: "/Users/me/Projects/foo bar" }
          : undefined,
      all: () => [],
    }),
  }),
}));

vi.mock("@main/db/queries", () => ({
  markRepoOpened: vi.fn(),
}));

vi.mock("@main/security/allowlist", () => ({
  openExternalAllowlisted: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@main/services/catalog", () => ({
  catalogService: { markOpened: vi.fn().mockResolvedValue(undefined) },
}));

const getSettingsMock = vi.fn();
vi.mock("@main/services/settings", () => ({
  getSettings: () => getSettingsMock(),
}));

import { gitService } from "@main/services/git";

const SLUG = "known-repo";
const REPO_PATH = "/Users/me/Projects/foo bar";

function savedEditor(editor: string): void {
  getSettingsMock.mockReturnValue({
    scanPaths: [],
    ollamaBaseUrl: "http://localhost:11434",
    ollamaEmbedModel: "nomic-embed-text",
    openaiEmbedModel: null,
    defaultEditor: editor,
    defaultTerminal: null,
    identities: [],
    schemaVersion: 1,
  });
}

beforeEach(() => {
  getSettingsMock.mockReset();
  savedEditor("vscode");
});

describe("resolveEditorUri — the saved default editor is respected", () => {
  it("resolves the default editor even when it is not vscode/cursor", async () => {
    // Devin is the real-machine case that surfaced this: it was detected,
    // offered in Settings, and then silently unbuildable.
    savedEditor("devin");
    await expect(gitService.resolveEditorUri({ slug: SLUG })).resolves.toEqual({
      uri: "devin://file/Users/me/Projects/foo%20bar",
    });
  });

  it("an explicit editor overrides the saved default", async () => {
    savedEditor("vscode");
    const out = await gitService.resolveEditorUri({
      slug: SLUG,
      editor: "zed",
    });
    expect(out.uri).toBe("zed://file/Users/me/Projects/foo%20bar");
  });

  it("prefers the explicit editor even when it equals the default", async () => {
    savedEditor("cursor");
    const out = await gitService.resolveEditorUri({
      slug: SLUG,
      editor: "cursor",
    });
    expect(out.uri).toBe("cursor://file/Users/me/Projects/foo%20bar");
  });
});

describe("resolveEditorUri — scheme shapes", () => {
  it("builds a file:// style URI for each file-scheme editor", async () => {
    for (const id of ["vscode", "cursor", "zed", "windsurf", "devin"] as const) {
      savedEditor(id);
      const out = await gitService.resolveEditorUri({ slug: SLUG });
      expect(out.uri).toBe(`${id}://file/Users/me/Projects/foo%20bar`);
    }
  });

  it("builds the encoded `file=` query for the JetBrains family", async () => {
    for (const id of ["idea", "webstorm", "pycharm", "rider", "goland", "clion", "rubymine"] as const) {
      savedEditor(id);
      const out = await gitService.resolveEditorUri({ slug: SLUG });
      expect(out.uri).toBe(
        `${id}://open?file=${encodeURIComponent(REPO_PATH)}`,
      );
    }
  });

  it("builds sublime's `subl://open?url=` URI", async () => {
    savedEditor("sublime");
    const out = await gitService.resolveEditorUri({ slug: SLUG });
    expect(out.uri).toBe(
      `subl://open?url=file://${encodeURIComponent(REPO_PATH)}`,
    );
  });
});

describe("resolveEditorUri — nothing to open", () => {
  it("returns null for the explicit \"none\" opt-out", async () => {
    savedEditor("none");
    await expect(gitService.resolveEditorUri({ slug: SLUG })).resolves.toEqual({
      uri: null,
    });
  });

  it("returns null for an editor that ships no URL scheme (Xcode)", async () => {
    // Xcode is launched via `open -a Xcode <path>` by the launcher, which is
    // why the scheme table reports null for it and this channel has nothing
    // to hand to `shell.openExternal`.
    savedEditor("xcode");
    await expect(gitService.resolveEditorUri({ slug: SLUG })).resolves.toEqual({
      uri: null,
    });
  });

  it("returns null when the repo slug is unknown", async () => {
    savedEditor("devin");
    await expect(gitService.resolveEditorUri({ slug: "nope" })).resolves.toEqual(
      { uri: null },
    );
  });
});
