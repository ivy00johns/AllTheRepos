/**
 * Integration test — `folderService` against a REAL temp filesystem and
 * a REAL SQLite catalog.
 *
 * This is the riskiest code in the app: one `fs.rename` can relocate
 * dozens of repos, and getting the bookkeeping wrong leaves the catalog
 * pointing at paths that no longer exist. So the filesystem is not
 * mocked — the test creates actual directories, actually renames them,
 * and asserts on what ended up on disk.
 *
 * Only the three collaborators that would drag in Electron internals or
 * spawn processes are stubbed: `electron`, the cover cache, and the
 * process scanner.
 *
 * !!! REAL better-sqlite3 DB !!! Needs host-ABI natives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { isolateDataDir } from "../../../helpers/test-db.js";
import type { UpsertRepoInput } from "@main/db/queries";

/**
 * `userData` has to resolve somewhere writable for the relocation
 * journal. It's re-pointed at the isolated data dir in `beforeEach`.
 */
let userDataDir = "";
vi.mock("electron", () => ({
  app: { getPath: () => userDataDir },
}));

vi.mock("@main/services/cover", () => ({
  invalidateCover: vi.fn(),
  coverService: { resolve: vi.fn() },
}));

/** No repo has a running process unless a test says so. */
const runningFor = new Set<string>();
vi.mock("@main/services/process", () => ({
  processService: {
    // The services take ONE snapshot per preflight rather than querying
    // per repo, so the stub mirrors that shape.
    list: async () => ({
      processes: [...runningFor].map((slug, i) => ({
        pid: 1000 + i,
        port: 3000 + i,
        repoSlug: slug,
      })),
      snapshotAt: 1,
    }),
    listForRepo: async (slug: string) => ({
      processes: runningFor.has(slug)
        ? [{ pid: 1, port: 3000, repoSlug: slug }]
        : [],
      snapshotAt: 1,
    }),
  },
}));

let isolate: { dir: string; cleanup(): void } | null = null;
let root = "";

function repoInput(overrides: Partial<UpsertRepoInput>): UpsertRepoInput {
  return {
    slug: "slug-000000",
    name: "repo",
    fullPath: "/nonexistent/repo",
    remoteUrl: null,
    defaultBranch: "main",
    currentBranch: "main",
    lastCommitHash: null,
    lastCommitDate: "2026-01-01T00:00:00.000Z",
    lastCommitMsg: "init",
    isDirty: false,
    primaryLanguage: "TypeScript",
    languages: [],
    heuristicTags: [],
    description: null,
    readmeContent: null,
    readmeHash: null,
    sizeBytes: 10,
    ...overrides,
  };
}

/** Create a repo on disk AND in the catalog, so the two agree. */
async function makeRepo(
  relative: string,
  opts: { dirty?: boolean } = {},
): Promise<string> {
  const { upsertRepo } = await import("@main/db/queries");
  const fullPath = path.join(root, relative);
  fs.mkdirSync(path.join(fullPath, ".git"), { recursive: true });
  const slug = `${path.basename(relative)}-aaaaaa`;
  upsertRepo(
    repoInput({
      slug,
      name: path.basename(relative),
      fullPath,
      isDirty: opts.dirty ?? false,
    }),
  );
  return slug;
}

async function storedPath(slug: string): Promise<string | null> {
  const { getSqlite } = await import("@main/db/client");
  const row = getSqlite()
    .prepare("SELECT full_path FROM repos WHERE slug = ?")
    .get(slug) as { full_path: string } | undefined;
  return row?.full_path ?? null;
}

describe("folderService", () => {
  beforeEach(async () => {
    isolate = isolateDataDir();
    userDataDir = isolate.dir;
    root = path.join(isolate.dir, "Repos");
    fs.mkdirSync(root, { recursive: true });
    runningFor.clear();

    const { closeDb, getDb } = await import("@main/db/client");
    closeDb();
    getDb();

    // Point the scan roots at the temp tree; without this every target
    // is "outside your scan folders".
    const { updateSettings, resetSettingsCache } =
      await import("@main/services/settings");
    resetSettingsCache();
    updateSettings({ scanPaths: [root] });
  });

  afterEach(async () => {
    const { closeDb } = await import("@main/db/client");
    closeDb();
    const { resetSettingsCache } = await import("@main/services/settings");
    resetSettingsCache();
    isolate?.cleanup();
    isolate = null;
  });

  it("renames a folder and re-points every repo beneath it", async () => {
    const { folderService } = await import("@main/services/folder");
    const a = await makeRepo("ai/agents/alpha");
    const b = await makeRepo("ai/agents/beta");

    const result = await folderService.rename(path.join(root, "ai"), "ml");

    expect(result.ok).toBe(true);
    expect(result.movedRepos).toBe(2);
    expect(fs.existsSync(path.join(root, "ml", "agents", "alpha"))).toBe(true);
    expect(fs.existsSync(path.join(root, "ai"))).toBe(false);
    expect(await storedPath(a)).toBe(path.join(root, "ml", "agents", "alpha"));
    expect(await storedPath(b)).toBe(path.join(root, "ml", "agents", "beta"));
  });

  it("moves a folder into another folder", async () => {
    const { folderService } = await import("@main/services/folder");
    const slug = await makeRepo("loose/thing");
    fs.mkdirSync(path.join(root, "archive"), { recursive: true });

    const result = await folderService.moveInto(
      path.join(root, "loose"),
      path.join(root, "archive"),
    );

    expect(result.ok).toBe(true);
    expect(await storedPath(slug)).toBe(path.join(root, "archive", "loose", "thing"));
  });

  it("refuses to move a folder containing a dirty repo, and touches nothing", async () => {
    const { folderService } = await import("@main/services/folder");
    const slug = await makeRepo("work/dirty-one", { dirty: true });

    const result = await folderService.rename(path.join(root, "work"), "job");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("uncommitted changes");
    // The whole point: a refused operation leaves disk and catalog alone.
    expect(fs.existsSync(path.join(root, "work"))).toBe(true);
    expect(fs.existsSync(path.join(root, "job"))).toBe(false);
    expect(await storedPath(slug)).toBe(path.join(root, "work", "dirty-one"));
  });

  it("refuses when a repo inside has a running process", async () => {
    const { folderService } = await import("@main/services/folder");
    const slug = await makeRepo("live/server");
    runningFor.add(slug);

    const result = await folderService.rename(path.join(root, "live"), "dead");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("running");
    expect(fs.existsSync(path.join(root, "live"))).toBe(true);
  });

  it("refuses to move a folder inside itself", async () => {
    const { folderService } = await import("@main/services/folder");
    await makeRepo("outer/inner/repo");

    const result = await folderService.moveInto(
      path.join(root, "outer"),
      path.join(root, "outer", "inner"),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("inside itself");
    expect(fs.existsSync(path.join(root, "outer", "inner", "repo"))).toBe(true);
  });

  it("refuses to move a configured scan root", async () => {
    const { folderService } = await import("@main/services/folder");
    const result = await folderService.rename(root, "Repositories");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("scan folder");
    expect(fs.existsSync(root)).toBe(true);
  });

  it("refuses a destination that already exists", async () => {
    const { folderService } = await import("@main/services/folder");
    await makeRepo("one/x");
    fs.mkdirSync(path.join(root, "two"), { recursive: true });

    const result = await folderService.rename(path.join(root, "one"), "two");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("already there");
  });

  it("refuses a target outside the scan roots", async () => {
    const { folderService } = await import("@main/services/folder");
    await makeRepo("inside/x");

    const result = await folderService.moveInto(
      path.join(root, "inside"),
      path.join(isolate!.dir, "elsewhere"),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside your scan folders");
  });

  it("rejects an invalid folder name before touching disk", async () => {
    const { folderService } = await import("@main/services/folder");
    await makeRepo("named/x");
    const result = await folderService.rename(path.join(root, "named"), "a/b");
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(root, "named"))).toBe(true);
  });

  it("does not treat a sibling with a shared prefix as being inside", async () => {
    const { folderService } = await import("@main/services/folder");
    // `ai` and `ai-tools` share a prefix; a naive startsWith would drag
    // `ai-tools`' repo along with a rename of `ai`.
    const inside = await makeRepo("ai/one");
    const sibling = await makeRepo("ai-tools/two");

    const result = await folderService.rename(path.join(root, "ai"), "ml");

    expect(result.ok).toBe(true);
    expect(result.movedRepos).toBe(1);
    expect(await storedPath(inside)).toBe(path.join(root, "ml", "one"));
    expect(await storedPath(sibling)).toBe(path.join(root, "ai-tools", "two"));
  });

  it("creates a folder and refuses a duplicate", async () => {
    const { folderService } = await import("@main/services/folder");
    const first = await folderService.create(root, "fresh");
    expect(first.ok).toBe(true);
    expect(fs.existsSync(path.join(root, "fresh"))).toBe(true);

    const second = await folderService.create(root, "fresh");
    expect(second.ok).toBe(false);
    expect(second.error).toContain("already there");
  });

  it("undoes a folder rename, restoring disk and catalog together", async () => {
    const { folderService } = await import("@main/services/folder");
    const { moveService } = await import("@main/services/move");
    const slug = await makeRepo("ai/agents/alpha");

    const renamed = await folderService.rename(path.join(root, "ai"), "ml");
    expect(renamed.ok).toBe(true);

    const undone = await moveService.undo();
    expect(undone.movedCount).toBe(1);
    expect(fs.existsSync(path.join(root, "ai", "agents", "alpha"))).toBe(true);
    expect(fs.existsSync(path.join(root, "ml"))).toBe(false);
    expect(await storedPath(slug)).toBe(path.join(root, "ai", "agents", "alpha"));
  });

  it("undoes a folder creation only while it is still empty", async () => {
    const { folderService } = await import("@main/services/folder");
    const { moveService } = await import("@main/services/move");

    await folderService.create(root, "scratch");
    // Undo must never delete work done after the thing being undone.
    fs.writeFileSync(path.join(root, "scratch", "notes.md"), "keep me");

    const undone = await moveService.undo();
    expect(undone.movedCount).toBe(0);
    expect(undone.entries[0]?.error).toContain("isn't empty");
    expect(fs.existsSync(path.join(root, "scratch", "notes.md"))).toBe(true);
  });

  it("reports the last batch so the UI can describe the undo", async () => {
    const { folderService } = await import("@main/services/folder");
    const { moveService } = await import("@main/services/move");
    await makeRepo("ai/one");

    await folderService.rename(path.join(root, "ai"), "ml");
    const last = await moveService.lastBatch();

    expect(last?.kind).toBe("folder");
    expect(last?.label).toBe("moved ml");
  });
});
