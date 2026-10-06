/**
 * Integration test — `scanRootService` against real directories and a
 * real SQLite catalog.
 *
 * Adding and removing scan roots reshapes the whole rail, and removing
 * one can drop catalog rows, so the rules are pinned here: what counts
 * as already-covered, what happens to repos found under a removed root,
 * and the guarantee that nothing is ever deleted from disk.
 *
 * !!! REAL better-sqlite3 DB !!! Needs host-ABI natives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { isolateDataDir } from "../../../helpers/test-db.js";
import type { UpsertRepoInput } from "@main/db/queries";

let userDataDir = "";
vi.mock("electron", () => ({
  app: { getPath: () => userDataDir },
}));

// The delete path clears vectors; keep Lance and the embedder out of it.
vi.mock("@main/services/lance", () => ({
  deleteEmbedding: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@main/services/embedding", () => ({
  indexRepoEmbedding: vi.fn().mockResolvedValue(undefined),
}));

let isolate: { dir: string; cleanup(): void } | null = null;
let repos = "";
let projects = "";

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

async function makeRepo(fullPath: string): Promise<string> {
  const { upsertRepo } = await import("@main/db/queries");
  fs.mkdirSync(path.join(fullPath, ".git"), { recursive: true });
  const slug = `${path.basename(fullPath)}-aaaaaa`;
  upsertRepo(repoInput({ slug, name: path.basename(fullPath), fullPath }));
  return slug;
}

async function repoCount(): Promise<number> {
  const { getSqlite } = await import("@main/db/client");
  return (
    getSqlite().prepare("SELECT COUNT(*) AS n FROM repos").get() as {
      n: number;
    }
  ).n;
}

describe("scanRootService", () => {
  beforeEach(async () => {
    isolate = isolateDataDir();
    userDataDir = isolate.dir;
    repos = path.join(isolate.dir, "Repos");
    projects = path.join(isolate.dir, "Projects");
    fs.mkdirSync(repos, { recursive: true });
    fs.mkdirSync(projects, { recursive: true });

    const { closeDb, getDb } = await import("@main/db/client");
    closeDb();
    getDb();

    const { updateSettings, resetSettingsCache } =
      await import("@main/services/settings");
    resetSettingsCache();
    updateSettings({ scanPaths: [repos] });
  });

  afterEach(async () => {
    const { closeDb } = await import("@main/db/client");
    closeDb();
    const { resetSettingsCache } = await import("@main/services/settings");
    resetSettingsCache();
    isolate?.cleanup();
    isolate = null;
  });

  it("adds a second root", async () => {
    const { scanRootService } = await import("@main/services/scan-roots");
    const result = await scanRootService.add(projects);
    expect(result.added).toBe(true);
    expect(result.settings.scanPaths).toEqual([repos, projects]);
  });

  it("refuses a path that isn't a directory", async () => {
    const { scanRootService } = await import("@main/services/scan-roots");
    const file = path.join(isolate!.dir, "a-file.txt");
    fs.writeFileSync(file, "x");
    expect((await scanRootService.add(file)).reason).toContain(
      "isn't a folder",
    );
    expect(
      (await scanRootService.add(path.join(isolate!.dir, "nope"))).reason,
    ).toContain("doesn't exist");
  });

  it("refuses an exact duplicate, ignoring a trailing slash", async () => {
    const { scanRootService } = await import("@main/services/scan-roots");
    const result = await scanRootService.add(`${repos}/`);
    expect(result.added).toBe(false);
    expect(result.reason).toContain("already being scanned");
  });

  it("refuses a folder already covered by an existing root", async () => {
    const { scanRootService } = await import("@main/services/scan-roots");
    const nested = path.join(repos, "ai");
    fs.mkdirSync(nested, { recursive: true });
    const result = await scanRootService.add(nested);
    expect(result.added).toBe(false);
    expect(result.reason).toContain("Already covered");
  });

  it("folds redundant children in when a parent is added", async () => {
    const { scanRootService } = await import("@main/services/scan-roots");
    // Adding the home dir makes both existing roots redundant — leaving
    // them would double-scan the same trees and split the rail.
    const result = await scanRootService.add(isolate!.dir);
    expect(result.added).toBe(true);
    expect(result.settings.scanPaths).toEqual([isolate!.dir]);
  });

  it("removes a root and forgets its repos when asked", async () => {
    const { scanRootService } = await import("@main/services/scan-roots");
    await scanRootService.add(projects);
    await makeRepo(path.join(repos, "keeper"));
    await makeRepo(path.join(projects, "goner"));
    expect(await repoCount()).toBe(2);

    const result = await scanRootService.remove(projects, true);

    expect(result.removed).toBe(true);
    expect(result.forgotten).toBe(1);
    expect(result.settings.scanPaths).toEqual([repos]);
    expect(await repoCount()).toBe(1);
    // Never touches disk — only the catalog row went away.
    expect(fs.existsSync(path.join(projects, "goner"))).toBe(true);
  });

  it("removes a root but keeps its repos when asked to", async () => {
    const { scanRootService } = await import("@main/services/scan-roots");
    await scanRootService.add(projects);
    await makeRepo(path.join(projects, "kept"));

    const result = await scanRootService.remove(projects, false);

    expect(result.removed).toBe(true);
    expect(result.forgotten).toBe(0);
    expect(await repoCount()).toBe(1);
  });

  it("only forgets repos under the removed root", async () => {
    const { scanRootService } = await import("@main/services/scan-roots");
    await scanRootService.add(projects);
    const keeper = await makeRepo(path.join(repos, "keeper"));
    await makeRepo(path.join(projects, "goner"));

    await scanRootService.remove(projects, true);

    const { getSqlite } = await import("@main/db/client");
    const rows = getSqlite().prepare("SELECT slug FROM repos").all() as Array<{
      slug: string;
    }>;
    expect(rows.map((r) => r.slug)).toEqual([keeper]);
  });

  it("does not let a shared path prefix drag in a sibling root", async () => {
    const { scanRootService } = await import("@main/services/scan-roots");
    const projectsX = `${projects}-x`;
    fs.mkdirSync(projectsX, { recursive: true });
    await scanRootService.add(projects);
    await scanRootService.add(projectsX);
    await makeRepo(path.join(projects, "inside"));
    const sibling = await makeRepo(path.join(projectsX, "sibling"));

    const result = await scanRootService.remove(projects, true);

    expect(result.forgotten).toBe(1);
    const { getSqlite } = await import("@main/db/client");
    const rows = getSqlite().prepare("SELECT slug FROM repos").all() as Array<{
      slug: string;
    }>;
    expect(rows.map((r) => r.slug)).toContain(sibling);
  });

  it("reports a removal of something that isn't a root", async () => {
    const { scanRootService } = await import("@main/services/scan-roots");
    const result = await scanRootService.remove(projects, true);
    expect(result.removed).toBe(false);
    expect(result.reason).toContain("isn't in your scan list");
  });

  it("counts what a removal would forget", async () => {
    const { scanRootService } = await import("@main/services/scan-roots");
    await makeRepo(path.join(repos, "one"));
    await makeRepo(path.join(repos, "two"));
    expect(scanRootService.countUnder(repos)).toBe(2);
    expect(scanRootService.countUnder(projects)).toBe(0);
  });
});
