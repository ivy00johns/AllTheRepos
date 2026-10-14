/**
 * Integration test (REAL DB) — `catalog:setFavorite` pins and unpins a repo.
 *
 * The renderer's star button calls this handler. The handler parses its input
 * and its result with zod schemas, so this runs the real path end to end: the
 * DB write, the row read-back, and the schema check on the returned Repo.
 *
 * !!! REAL better-sqlite3 DB !!! Needs host-ABI natives.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isolateDataDir } from "../../../helpers/test-db.js";

let isolate: { dir: string; cleanup(): void } | null = null;

describe("catalog:setFavorite handler", () => {
  beforeEach(async () => {
    isolate = isolateDataDir();
    const { closeDb, getDb } = await import("@main/db/client");
    closeDb();
    getDb();
  });

  afterEach(async () => {
    const { closeDb } = await import("@main/db/client");
    closeDb();
    isolate?.cleanup();
    isolate = null;
  });

  it("pins and unpins a repo, returning the updated row", async () => {
    const { upsertRepo } = await import("@main/db/queries");
    const { handleCatalogSetFavorite } = await import("@main/ipc/catalog");

    upsertRepo({
      slug: "star-aaaaaa",
      name: "star",
      fullPath: "/nonexistent/star",
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
      description: "a repo",
      readmeContent: "# repo",
      readmeHash: "hash-1",
      sizeBytes: 100,
    });

    const pinned = await handleCatalogSetFavorite({
      slug: "star-aaaaaa",
      favorite: true,
    });
    expect(pinned).not.toBeNull();
    expect(pinned?.isFavorite).toBe(true);
    expect(pinned?.favoritedAt).not.toBeNull();

    const unpinned = await handleCatalogSetFavorite({
      slug: "star-aaaaaa",
      favorite: false,
    });
    expect(unpinned?.isFavorite).toBe(false);
    expect(unpinned?.favoritedAt).toBeNull();
  });

  it("returns null for an unknown slug", async () => {
    const { handleCatalogSetFavorite } = await import("@main/ipc/catalog");
    const result = await handleCatalogSetFavorite({
      slug: "never-existed",
      favorite: true,
    });
    expect(result).toBeNull();
  });
});
