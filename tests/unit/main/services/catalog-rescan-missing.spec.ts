/**
 * Integration test (REAL DB, embedding and vector store mocked) —
 * `catalogService.rescan` on a repo whose folder no longer exists.
 *
 * Before the fix, rescan re-read the folder with simple-git and threw
 * "Cannot use simple-git on a directory that does not exist", so one moved or
 * deleted repo could not be refreshed at all. Now the stored row comes back
 * unchanged: it reads back as `missing`, keeps its tags, and gets no new scan
 * time, because nothing was scanned.
 *
 * !!! REAL better-sqlite3 DB !!! Needs host-ABI natives.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { isolateDataDir } from "../../../helpers/test-db.js";

vi.mock("@main/services/vector-store", () => ({
  deleteEmbedding: vi.fn(),
}));

vi.mock("@main/services/embedding", () => ({
  indexRepoEmbedding: vi.fn().mockResolvedValue(undefined),
}));

import type { UpsertRepoInput } from "@main/db/queries";

let isolate: { dir: string; cleanup(): void } | null = null;

function makeInput(overrides: Partial<UpsertRepoInput>): UpsertRepoInput {
  return {
    slug: "repo-000000",
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
    heuristicTags: [{ value: "node", source: "heuristic" }],
    description: "a repo",
    readmeContent: "# repo",
    readmeHash: "hash-1",
    sizeBytes: 100,
    ...overrides,
  };
}

describe("catalogService.rescan on a missing folder", () => {
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

  it("returns the stored row flagged missing, with tags and scan time unchanged", async () => {
    const { upsertRepo } = await import("@main/db/queries");
    const { catalogService } = await import("@main/services/catalog");

    const { row } = upsertRepo(
      makeInput({
        slug: "gone-aaaaaa",
        name: "gone",
        fullPath: path.join(isolate!.dir, "vanished", "gone"),
      }),
    );

    const result = await catalogService.rescan("gone-aaaaaa");

    expect(result.slug).toBe("gone-aaaaaa");
    expect(result.missing).toBe(true);
    expect(result.tags.map((t) => t.value)).toContain("node");
    expect(result.lastScannedAt).toBe(row.lastScannedAt);
  });

  it("still throws for a slug that does not exist", async () => {
    const { catalogService } = await import("@main/services/catalog");
    await expect(catalogService.rescan("never-existed")).rejects.toThrow(
      /repo not found/,
    );
  });
});
