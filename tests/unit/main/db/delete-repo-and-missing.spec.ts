/**
 * ATR-028 Integration Test (REAL DB) — stale-repo lifecycle, db layer.
 *
 * The failure this guards against (2026-07-11 audit, DS-2/DS-7): rows whose
 * `full_path` vanished from disk were undetectable (no flag) and permanent
 * (no delete path existed anywhere — the FTS DELETE trigger could never
 * fire and LanceDB vectors were orphaned forever).
 *
 * Covers the two db-layer primitives:
 *   - `rowToRepo` computes `missing` from the path's on-disk existence;
 *   - `deleteRepoBySlug` removes the row (FTS trigger + group-membership
 *     FK cascade included) and reports the deleted row's id so the service
 *     can clear the vector index.
 *
 * !!! REAL better-sqlite3 DB !!! Needs host-ABI natives.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isolateDataDir } from "../../../helpers/test-db.js";

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

async function boot() {
  const { closeDb, getDb, getSqlite } = await import("@main/db/client");
  closeDb();
  getDb();
  const queries = await import("@main/db/queries");
  return { sqlite: getSqlite(), ...queries };
}

describe("stale-repo lifecycle, db layer (ATR-028)", () => {
  beforeEach(() => {
    isolate = isolateDataDir();
  });

  afterEach(async () => {
    const { closeDb } = await import("@main/db/client");
    closeDb();
    isolate?.cleanup();
    isolate = null;
  });

  it("rowToRepo flags a repo whose path is gone as missing", async () => {
    const { upsertRepo, rowToRepo } = await boot();
    const deadPath = path.join(isolate!.dir, "gone", "ghost");
    const { row } = upsertRepo(
      makeInput({ slug: "ghost-aaaaaa", name: "ghost", fullPath: deadPath }),
    );
    expect(rowToRepo(row).missing).toBe(true);
  });

  it("rowToRepo flags a repo whose path exists as NOT missing", async () => {
    const { upsertRepo, rowToRepo } = await boot();
    const livePath = path.join(isolate!.dir, "alive");
    fs.mkdirSync(livePath, { recursive: true });
    const { row } = upsertRepo(
      makeInput({ slug: "alive-aaaaaa", name: "alive", fullPath: livePath }),
    );
    expect(rowToRepo(row).missing).toBe(false);
  });

  it("deleteRepoBySlug removes the row, its FTS entry, and its group memberships", async () => {
    const { sqlite, upsertRepo, deleteRepoBySlug } = await boot();
    const { row } = upsertRepo(
      makeInput({
        slug: "doomed-aaaaaa",
        name: "doomed",
        fullPath: path.join(isolate!.dir, "gone", "doomed"),
      }),
    );
    sqlite.prepare("INSERT INTO groups (name) VALUES ('g')").run();
    const groupId = (
      sqlite.prepare("SELECT id FROM groups WHERE name='g'").get() as {
        id: number;
      }
    ).id;
    sqlite
      .prepare("INSERT INTO repo_groups (repo_id, group_id) VALUES (?, ?)")
      .run(row.id, groupId);

    const deleted = deleteRepoBySlug("doomed-aaaaaa");
    expect(deleted).toEqual({ id: row.id });

    const repoCount = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM repos").get() as { n: number }
    ).n;
    expect(repoCount).toBe(0);
    const ftsCount = (
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM repos_fts WHERE slug = ?")
        .get("doomed-aaaaaa") as { n: number }
    ).n;
    expect(ftsCount).toBe(0);
    const membershipCount = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM repo_groups").get() as {
        n: number;
      }
    ).n;
    expect(membershipCount).toBe(0);
    // The group itself survives — only the membership goes.
    const groupCount = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM groups").get() as { n: number }
    ).n;
    expect(groupCount).toBe(1);
  });

  it("deleteRepoBySlug returns null for an unknown slug", async () => {
    const { deleteRepoBySlug } = await boot();
    expect(deleteRepoBySlug("never-existed")).toBeNull();
  });
});
