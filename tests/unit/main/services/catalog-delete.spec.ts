/**
 * ATR-028 Integration Test (REAL DB, Lance mocked) — `catalogService.deleteRepo`.
 *
 * The service-level contract: deleting a repo removes the catalog row AND
 * clears its LanceDB vector (the audit found `deleteEmbedding` had zero
 * callers, so ghost vectors kept matching in semantic search forever).
 * A vector-cleanup failure must not fail the delete — the row is the
 * source of truth; the vector is best-effort enrichment.
 *
 * !!! REAL better-sqlite3 DB !!! Needs host-ABI natives.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { isolateDataDir } from "../../../helpers/test-db.js";

const deleteEmbedding = vi.fn().mockResolvedValue(undefined);
vi.mock("@main/services/lance", () => ({
  deleteEmbedding: (repoId: number) => deleteEmbedding(repoId),
}));

// The embedding write-path (used by catalog.rescan, not by deleteRepo) pulls
// in fetch/Ollama machinery — stub it so importing the service stays cheap.
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
    heuristicTags: [],
    description: "a repo",
    readmeContent: "# repo",
    readmeHash: "hash-1",
    sizeBytes: 100,
    ...overrides,
  };
}

describe("catalogService.deleteRepo (ATR-028)", () => {
  beforeEach(async () => {
    isolate = isolateDataDir();
    const { closeDb, getDb } = await import("@main/db/client");
    closeDb();
    getDb();
    deleteEmbedding.mockClear();
  });

  afterEach(async () => {
    const { closeDb } = await import("@main/db/client");
    closeDb();
    isolate?.cleanup();
    isolate = null;
  });

  it("deletes the row and clears the vector index", async () => {
    const { upsertRepo } = await import("@main/db/queries");
    const { getSqlite } = await import("@main/db/client");
    const { catalogService } = await import("@main/services/catalog");

    const { row } = upsertRepo(
      makeInput({
        slug: "doomed-aaaaaa",
        name: "doomed",
        fullPath: path.join(isolate!.dir, "gone", "doomed"),
      }),
    );

    const result = await catalogService.deleteRepo("doomed-aaaaaa");
    expect(result).toEqual({ slug: "doomed-aaaaaa", deleted: true });

    const n = (
      getSqlite().prepare("SELECT COUNT(*) AS n FROM repos").get() as {
        n: number;
      }
    ).n;
    expect(n).toBe(0);
    expect(deleteEmbedding).toHaveBeenCalledWith(row.id);
  });

  it("returns deleted:false for an unknown slug and touches nothing", async () => {
    const { catalogService } = await import("@main/services/catalog");
    const result = await catalogService.deleteRepo("never-existed");
    expect(result).toEqual({ slug: "never-existed", deleted: false });
    expect(deleteEmbedding).not.toHaveBeenCalled();
  });

  it("still deletes the row when vector cleanup rejects", async () => {
    deleteEmbedding.mockRejectedValueOnce(new Error("lance down"));
    const { upsertRepo } = await import("@main/db/queries");
    const { getSqlite } = await import("@main/db/client");
    const { catalogService } = await import("@main/services/catalog");

    upsertRepo(
      makeInput({
        slug: "doomed-bbbbbb",
        name: "doomed",
        fullPath: path.join(isolate!.dir, "gone", "doomed-b"),
      }),
    );

    const result = await catalogService.deleteRepo("doomed-bbbbbb");
    expect(result).toEqual({ slug: "doomed-bbbbbb", deleted: true });
    const n = (
      getSqlite().prepare("SELECT COUNT(*) AS n FROM repos").get() as {
        n: number;
      }
    ).n;
    expect(n).toBe(0);
  });
});
