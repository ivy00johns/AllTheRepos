/**
 * ATR-027 Integration Test (REAL DB) — `upsertRepo` rebinds a MOVED repo
 * instead of duplicating it.
 *
 * The failure this guards against (2026-07-11 audit, DS-1): `upsertRepo`
 * matched only on `full_path`, so moving a project folder on disk produced a
 * brand-new row (new path-hashed slug) while the old row lived on as a ghost
 * holding the user's tags, group memberships, and `last_opened_at`.
 *
 * The rebind rule: when no row matches the incoming `full_path`, look for a
 * row with the same stable identity — same `remote_url`, or for remote-less
 * repos the same `name` + `last_commit_hash` — **whose own path no longer
 * exists on disk**, and update that row in place (new `full_path`, fresh scan
 * metadata, slug/user-tags/groups/open-history preserved). A row whose path
 * still exists is a second clone, never a move — no rebind.
 *
 * !!! REAL better-sqlite3 DB !!! Needs the host-ABI natives
 * (`pnpm rebuild better-sqlite3 find-git-repositories` after `electron:dev`).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isolateDataDir } from "../../../helpers/test-db.js";

import type { UpsertRepoInput } from "@main/db/queries";

let isolate: { dir: string; cleanup(): void } | null = null;

/** Build a full UpsertRepoInput with sane defaults. */
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
    languages: [{ name: "TypeScript", bytes: 100, color: "#3178c6" }],
    heuristicTags: [{ value: "node", source: "heuristic" }],
    description: "a repo",
    readmeContent: "# repo",
    readmeHash: "hash-1",
    sizeBytes: 100,
    ...overrides,
  };
}

async function boot() {
  const { closeDb, getDb } = await import("@main/db/client");
  closeDb();
  getDb();
  const { getSqlite } = await import("@main/db/client");
  const { upsertRepo } = await import("@main/db/queries");
  return { sqlite: getSqlite(), upsertRepo };
}

describe("upsertRepo — moved-repo rebind (ATR-027)", () => {
  beforeEach(() => {
    isolate = isolateDataDir();
  });

  afterEach(async () => {
    const { closeDb } = await import("@main/db/client");
    closeDb();
    isolate?.cleanup();
    isolate = null;
  });

  it("rebinds a moved repo by remote_url: same row, new path, tags/groups/last-opened kept", async () => {
    const { sqlite, upsertRepo } = await boot();
    const oldPath = path.join(isolate!.dir, "old-home", "acme"); // never created on disk
    const newPath = path.join(isolate!.dir, "new-home", "acme");
    const remote = "git@github.com:user/acme.git";

    const { row: ghost, created } = upsertRepo(
      makeInput({
        slug: "acme-aaaaaa",
        name: "acme",
        fullPath: oldPath,
        remoteUrl: remote,
      }),
    );
    expect(created).toBe(true);

    // Simulate user curation on the original row: a user tag, a group
    // membership, and an open-history stamp.
    sqlite
      .prepare(
        "UPDATE repos SET tags_json = ?, last_opened_at = ? WHERE id = ?",
      )
      .run(
        JSON.stringify([
          { value: "client-work", source: "user" },
          { value: "node", source: "heuristic" },
        ]),
        "2026-07-01T12:00:00.000Z",
        ghost.id,
      );
    sqlite.prepare("INSERT INTO groups (name) VALUES ('freelance')").run();
    const groupId = (
      sqlite.prepare("SELECT id FROM groups WHERE name='freelance'").get() as {
        id: number;
      }
    ).id;
    sqlite
      .prepare("INSERT INTO repo_groups (repo_id, group_id) VALUES (?, ?)")
      .run(ghost.id, groupId);

    // The move: a rescan discovers the repo at its new path. The scanner
    // would hand over a NEW path-hashed slug hint; rebind must ignore it.
    const result = upsertRepo(
      makeInput({
        slug: "acme-bbbbbb",
        name: "acme",
        fullPath: newPath,
        remoteUrl: remote,
        readmeHash: "hash-2",
      }),
    );

    expect(result.created).toBe(false);
    expect(result.row.id).toBe(ghost.id);

    const rows = sqlite
      .prepare(
        "SELECT id, slug, full_path, tags_json, last_opened_at FROM repos",
      )
      .all() as Array<{
      id: number;
      slug: string;
      full_path: string;
      tags_json: string;
      last_opened_at: string | null;
    }>;
    expect(rows.length).toBe(1); // no duplicate row
    expect(rows[0].full_path).toBe(newPath); // rebound in place
    expect(rows[0].slug).toBe("acme-aaaaaa"); // original slug kept (routes/deep links stay valid)
    expect(rows[0].last_opened_at).toBe("2026-07-01T12:00:00.000Z");
    const tags = JSON.parse(rows[0].tags_json) as Array<{
      value: string;
      source: string;
    }>;
    expect(
      tags.some((t) => t.value === "client-work" && t.source === "user"),
    ).toBe(true);

    // Group membership rides along on the same repo id.
    const memberships = sqlite
      .prepare("SELECT repo_id FROM repo_groups WHERE group_id = ?")
      .all(groupId) as Array<{ repo_id: number }>;
    expect(memberships).toEqual([{ repo_id: ghost.id }]);

    // FTS stays consistent: exactly one indexed row for the slug.
    const fts = sqlite
      .prepare("SELECT COUNT(*) AS n FROM repos_fts WHERE slug = ?")
      .get("acme-aaaaaa") as { n: number };
    expect(fts.n).toBe(1);
  });

  it("does NOT rebind when the old path still exists on disk (second clone of the same remote)", async () => {
    const { sqlite, upsertRepo } = await boot();
    const clonePath = path.join(isolate!.dir, "clone-one");
    fs.mkdirSync(clonePath, { recursive: true }); // the first clone is alive on disk
    const remote = "git@github.com:user/acme.git";

    upsertRepo(
      makeInput({
        slug: "acme-aaaaaa",
        name: "acme",
        fullPath: clonePath,
        remoteUrl: remote,
      }),
    );
    const result = upsertRepo(
      makeInput({
        slug: "acme-cccccc",
        name: "acme",
        fullPath: path.join(isolate!.dir, "clone-two"),
        remoteUrl: remote,
      }),
    );

    expect(result.created).toBe(true);
    const n = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM repos").get() as { n: number }
    ).n;
    expect(n).toBe(2); // two live clones = two catalog rows
  });

  it("rebinds a remote-less repo by name + last_commit_hash when its old path is gone", async () => {
    const { sqlite, upsertRepo } = await boot();
    const oldPath = path.join(isolate!.dir, "old", "scratch"); // never created
    const newPath = path.join(isolate!.dir, "new", "scratch");

    const { row: ghost } = upsertRepo(
      makeInput({
        slug: "scratch-aaaaaa",
        name: "scratch",
        fullPath: oldPath,
        lastCommitHash: "deadbeef",
      }),
    );

    const result = upsertRepo(
      makeInput({
        slug: "scratch-dddddd",
        name: "scratch",
        fullPath: newPath,
        lastCommitHash: "deadbeef",
      }),
    );

    expect(result.created).toBe(false);
    expect(result.row.id).toBe(ghost.id);
    const n = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM repos").get() as { n: number }
    ).n;
    expect(n).toBe(1);
  });

  it("does NOT rebind a remote-less repo when the commit hash differs (different project, same name)", async () => {
    const { sqlite, upsertRepo } = await boot();

    upsertRepo(
      makeInput({
        slug: "scratch-aaaaaa",
        name: "scratch",
        fullPath: path.join(isolate!.dir, "old", "scratch"),
        lastCommitHash: "deadbeef",
      }),
    );
    const result = upsertRepo(
      makeInput({
        slug: "scratch-eeeeee",
        name: "scratch",
        fullPath: path.join(isolate!.dir, "elsewhere", "scratch"),
        lastCommitHash: "0ddba11",
      }),
    );

    expect(result.created).toBe(true);
    const n = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM repos").get() as { n: number }
    ).n;
    expect(n).toBe(2);
  });

  it("prefers the ghost with the matching folder name when two ghosts share a remote", async () => {
    const { sqlite, upsertRepo } = await boot();
    const remote = "git@github.com:user/acme.git";

    // Two clones of one remote were cataloged while alive, then both paths
    // vanished. Seed the second row with raw SQL — seeding it through
    // upsertRepo would itself rebind the first ghost (that's the feature).
    upsertRepo(
      makeInput({
        slug: "acme-old-aaaaaa",
        name: "acme-old",
        fullPath: path.join(isolate!.dir, "gone", "acme-old"),
        remoteUrl: remote,
      }),
    );
    sqlite
      .prepare(
        `INSERT INTO repos (slug, name, full_path, remote_url, languages_json, tags_json)
         VALUES (?, ?, ?, ?, '[]', '[]')`,
      )
      .run(
        "acme-bbbbbb",
        "acme",
        path.join(isolate!.dir, "gone", "acme"),
        remote,
      );
    const matchingGhost = sqlite
      .prepare("SELECT id FROM repos WHERE slug = 'acme-bbbbbb'")
      .get() as { id: number };

    const result = upsertRepo(
      makeInput({
        slug: "acme-ffffff",
        name: "acme",
        fullPath: path.join(isolate!.dir, "landed", "acme"),
        remoteUrl: remote,
      }),
    );

    expect(result.created).toBe(false);
    expect(result.row.id).toBe(matchingGhost.id);
    const n = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM repos").get() as { n: number }
    ).n;
    expect(n).toBe(2);
  });
});
