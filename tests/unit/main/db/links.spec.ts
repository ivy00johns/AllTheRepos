/**
 * `repo_links` — schema behaviour.
 *
 * !!! REAL better-sqlite3 DB !!! Needs host-ABI natives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

import { isolateDataDir } from "../../../helpers/test-db.js";
import type { UpsertRepoInput } from "@main/db/queries";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp/atr-links-test" } }));

let isolate: { dir: string; cleanup(): void } | null = null;

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

/** Insert a repo, return its numeric id. */
async function makeRepo(name: string, fullPath: string): Promise<number> {
  const { upsertRepo } = await import("@main/db/queries");
  const { getSqlite } = await import("@main/db/client");
  upsertRepo(repoInput({ slug: `${name}-aaaaaa`, name, fullPath }));
  const row = getSqlite()
    .prepare("SELECT id FROM repos WHERE full_path = ?")
    .get(fullPath) as { id: number };
  return row.id;
}

describe("repo_links schema", () => {
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

  it("creates the table with the expected columns", async () => {
    const { getSqlite } = await import("@main/db/client");
    const columns = getSqlite()
      .prepare("PRAGMA table_info(repo_links)")
      .all() as Array<{ name: string }>;
    expect(columns.map((c) => c.name).sort()).toEqual([
      "created_at",
      "from_repo_id",
      "id",
      "kind",
      "source",
      "to_repo_id",
      "why",
    ]);
  });

  it("is idempotent — re-opening the DB does not error or duplicate", async () => {
    const { closeDb, getDb, getSqlite } = await import("@main/db/client");
    closeDb();
    getDb();
    const tables = getSqlite()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='repo_links'",
      )
      .all();
    expect(tables).toHaveLength(1);
  });

  it("rejects a duplicate (from, to, kind)", async () => {
    const { getSqlite } = await import("@main/db/client");
    const a = await makeRepo("alpha", path.join(isolate!.dir, "alpha"));
    const b = await makeRepo("beta", path.join(isolate!.dir, "beta"));
    const insert = getSqlite().prepare(
      "INSERT INTO repo_links (from_repo_id, to_repo_id, kind, why, source) VALUES (?, ?, ?, ?, 'mcp')",
    );
    insert.run(a, b, "part-of", "first");
    expect(() => insert.run(a, b, "part-of", "again")).toThrow();
  });

  it("cascades — deleting a repo removes its links", async () => {
    const { getSqlite } = await import("@main/db/client");
    const a = await makeRepo("alpha", path.join(isolate!.dir, "alpha"));
    const b = await makeRepo("beta", path.join(isolate!.dir, "beta"));
    getSqlite()
      .prepare(
        "INSERT INTO repo_links (from_repo_id, to_repo_id, kind, why, source) VALUES (?, ?, 'part-of', 'x', 'mcp')",
      )
      .run(a, b);
    getSqlite().prepare("DELETE FROM repos WHERE id = ?").run(b);
    const left = getSqlite().prepare("SELECT * FROM repo_links").all();
    expect(left).toEqual([]);
  });
});

/**
 * Insert a repo with an explicit slug. `slug` is UNIQUE on `repos`, so the
 * `${name}-aaaaaa` convention in {@link makeRepo} cannot express two repos
 * that share a folder name — which is exactly the ambiguity case below.
 */
async function makeRepoWithSlug(
  slug: string,
  name: string,
  fullPath: string,
): Promise<number> {
  const { upsertRepo } = await import("@main/db/queries");
  const { getSqlite } = await import("@main/db/client");
  upsertRepo(repoInput({ slug, name, fullPath }));
  const row = getSqlite()
    .prepare("SELECT id FROM repos WHERE full_path = ?")
    .get(fullPath) as { id: number };
  return row.id;
}

describe("link queries", () => {
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

  it("resolves a repo by exact path", async () => {
    const { resolveRepo } = await import("@main/db/links");
    const p = path.join(isolate!.dir, "alpha");
    const id = await makeRepo("alpha", p);
    const got = resolveRepo(p);
    expect(got).toMatchObject({ ok: true, id, name: "alpha" });
  });

  it("resolves a repo by unique basename", async () => {
    const { resolveRepo } = await import("@main/db/links");
    const id = await makeRepo("alpha", path.join(isolate!.dir, "one/alpha"));
    expect(resolveRepo("alpha")).toMatchObject({ ok: true, id });
  });

  it("refuses an ambiguous basename and names the candidates", async () => {
    const { resolveRepo } = await import("@main/db/links");
    await makeRepoWithSlug(
      "alpha-aaaaaa",
      "alpha",
      path.join(isolate!.dir, "one/alpha"),
    );
    await makeRepoWithSlug(
      "alpha-bbbbbb",
      "alpha",
      path.join(isolate!.dir, "two/alpha"),
    );
    const got = resolveRepo("alpha");
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.reason).toBe("ambiguous");
      expect(got.candidates).toHaveLength(2);
    }
  });

  it("reports not-found rather than guessing", async () => {
    const { resolveRepo } = await import("@main/db/links");
    expect(resolveRepo("nothing-here")).toMatchObject({
      ok: false,
      reason: "not-found",
    });
  });

  it("creates a link and lists it back", async () => {
    const { createLink, listLinks } = await import("@main/db/links");
    const a = await makeRepo("alpha", path.join(isolate!.dir, "alpha"));
    const b = await makeRepo("beta", path.join(isolate!.dir, "beta"));
    createLink({ fromId: a, toId: b, kind: "part-of", why: "worker of beta" });
    const links = listLinks();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      fromSlug: "alpha-aaaaaa",
      toSlug: "beta-aaaaaa",
      kind: "part-of",
      why: "worker of beta",
      source: "mcp",
    });
  });

  it("is idempotent — re-linking updates the reason instead of throwing", async () => {
    const { createLink, listLinks } = await import("@main/db/links");
    const a = await makeRepo("alpha", path.join(isolate!.dir, "alpha"));
    const b = await makeRepo("beta", path.join(isolate!.dir, "beta"));
    createLink({ fromId: a, toId: b, kind: "part-of", why: "first" });
    createLink({ fromId: a, toId: b, kind: "part-of", why: "second" });
    const links = listLinks();
    expect(links).toHaveLength(1);
    expect(links[0].why).toBe("second");
  });

  it("removes a link and reports whether anything was removed", async () => {
    const { createLink, removeLink, listLinks } = await import(
      "@main/db/links"
    );
    const a = await makeRepo("alpha", path.join(isolate!.dir, "alpha"));
    const b = await makeRepo("beta", path.join(isolate!.dir, "beta"));
    createLink({ fromId: a, toId: b, kind: "related", why: "x" });
    expect(removeLink(a, b, "related")).toBe(true);
    expect(removeLink(a, b, "related")).toBe(false);
    expect(listLinks()).toEqual([]);
  });

  it("filters by repo, in either direction", async () => {
    const { createLink, listLinks } = await import("@main/db/links");
    const a = await makeRepo("alpha", path.join(isolate!.dir, "alpha"));
    const b = await makeRepo("beta", path.join(isolate!.dir, "beta"));
    const c = await makeRepo("gamma", path.join(isolate!.dir, "gamma"));
    createLink({ fromId: a, toId: b, kind: "part-of", why: "x" });
    createLink({ fromId: c, toId: a, kind: "related", why: "y" });
    expect(listLinks(a)).toHaveLength(2);
    expect(listLinks(b)).toHaveLength(1);
  });

  it("keeps a link when the repo moves — the whole reason we key on id", async () => {
    const { upsertRepo } = await import("@main/db/queries");
    const { createLink, listLinks } = await import("@main/db/links");
    const { getSqlite } = await import("@main/db/client");

    // A repo with a remote, so the catalog can rebind it after the move.
    // `oldPath` is never created on disk — `findMovedGhost` only rebinds a
    // row whose own path is gone, otherwise it is a second clone.
    const oldPath = path.join(isolate!.dir, "before/hive");
    upsertRepo(
      repoInput({
        slug: "hive-aaaaaa",
        name: "hive",
        fullPath: oldPath,
        remoteUrl: "https://github.com/acme/hive.git",
      }),
    );
    const b = await makeRepo("worker", path.join(isolate!.dir, "worker"));
    const hiveId = (
      getSqlite()
        .prepare("SELECT id FROM repos WHERE full_path = ?")
        .get(oldPath) as { id: number }
    ).id;
    createLink({ fromId: b, toId: hiveId, kind: "part-of", why: "worker" });

    // Same remote, new path — the catalog rebinds onto the same row. The
    // scanner offers a fresh path-hashed slug hint, which the rebind
    // deliberately discards (see upsert-moved-repo.spec.ts).
    const newPath = path.join(isolate!.dir, "after/hive");
    const moved = upsertRepo(
      repoInput({
        slug: "hive-bbbbbb",
        name: "hive",
        fullPath: newPath,
        remoteUrl: "https://github.com/acme/hive.git",
      }),
    );
    expect(moved.created).toBe(false);
    expect(moved.row.id).toBe(hiveId);

    // The link survived the move and still points at the same row, which is
    // now living at the new path.
    const links = listLinks(b);
    expect(links).toHaveLength(1);
    const target = getSqlite()
      .prepare("SELECT to_repo_id FROM repo_links WHERE id = ?")
      .get(links[0].id) as { to_repo_id: number };
    expect(target.to_repo_id).toBe(hiveId);
    const row = getSqlite()
      .prepare("SELECT full_path FROM repos WHERE id = ?")
      .get(hiveId) as { full_path: string };
    expect(row.full_path).toBe(newPath);
  });
});
