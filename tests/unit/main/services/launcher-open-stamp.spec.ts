/**
 * ATR-030 Unit Test — every launcher open verb stamps `last_opened_at`.
 *
 * The failure this guards against (2026-07-11 audit, DS-4): only
 * `git:openInEditor` stamped `last_opened_at`, so opens driven through the
 * launcher service (repo-card buttons, Cmd-K, native menu, tray) never
 * updated it and "recently opened" sorted mostly-null values.
 *
 * Contract: on a SUCCESSFUL open (editor/terminal/Finder/remote) the service
 * calls `markRepoOpened(slug)`; a failed open does not stamp; and a stamp
 * failure must never turn a successful open into an error.
 *
 * Native-free: electron, db client/queries, settings, allowlist, and
 * simple-git are all mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({
  clipboard: { writeText: vi.fn() },
  shell: {
    showItemInFolder: vi.fn(),
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}));

const markRepoOpened = vi.fn();
vi.mock("@main/db/queries", () => ({
  markRepoOpened: (slug: string) => markRepoOpened(slug),
}));

vi.mock("@main/db/client", () => ({
  getSqlite: () => ({
    prepare: () => ({
      get: (slug: string) =>
        slug === "known-repo" ? { full_path: "/tmp/known-repo" } : undefined,
      all: () => [],
    }),
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

vi.mock("simple-git", () => {
  const factory = () => ({
    remote: async () => "git@github.com:user/acme.git\n",
  });
  return { default: factory, simpleGit: factory };
});

import { launcherService } from "@main/services/launcher";

beforeEach(() => {
  markRepoOpened.mockReset();
});

describe("launcher open verbs stamp last_opened_at (ATR-030)", () => {
  it("openInFinder success stamps the slug", async () => {
    const result = await launcherService.openInFinder({ slug: "known-repo" });
    expect(result.ok).toBe(true);
    expect(markRepoOpened).toHaveBeenCalledTimes(1);
    expect(markRepoOpened).toHaveBeenCalledWith("known-repo");
  });

  it("openRemote success stamps the slug", async () => {
    const result = await launcherService.openRemote({ slug: "known-repo" });
    expect(result.ok).toBe(true);
    expect(markRepoOpened).toHaveBeenCalledWith("known-repo");
  });

  it("a failed open (unknown repo) does NOT stamp", async () => {
    const result = await launcherService.openInFinder({ slug: "nope" });
    expect(result.ok).toBe(false);
    expect(markRepoOpened).not.toHaveBeenCalled();
  });

  it("a stamp failure never breaks a successful open", async () => {
    markRepoOpened.mockImplementation(() => {
      throw new Error("db locked");
    });
    const result = await launcherService.openInFinder({ slug: "known-repo" });
    expect(result.ok).toBe(true);
  });
});
