import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isolateDataDir } from "../helpers/test-db.js";
import { seedRepo, seedGroup, addRepoToGroup } from "../helpers/seed.js";
import type { Repo, Group, RepoDetail, RepoListResult } from "@/contracts/types";

/**
 * Integration: lib/db/queries.ts against a seeded temp DB.
 *
 * Uses dynamic import so a missing backend module surfaces as a clean test
 * failure (not a collection-time crash that aborts the whole suite).
 */

type QueriesModule = {
  listRepos: (q: {
    q?: string;
    language?: string | null;
    tags?: string[];
    groupId?: number | null;
    dirtyOnly?: boolean;
    sort?: string;
    order?: "asc" | "desc";
    limit?: number;
    offset?: number;
  }) => Promise<RepoListResult>;
  getRepoBySlug: (slug: string) => Promise<RepoDetail | null>;
  listGroups: () => Promise<Group[]>;
};

async function loadQueries(): Promise<QueriesModule> {
  return (await import("@/lib/db/queries")) as unknown as QueriesModule;
}

describe("db/queries — contracts/api.md backend library", () => {
  let isolate: { dir: string; cleanup(): void } | null = null;

  beforeEach(async () => {
    vi.resetModules();
    isolate = isolateDataDir();
    // Boot lib/db/client.ts so migrations + FTS triggers are applied.
    const { getDb } = await import("@/lib/db/client");
    getDb();
  });

  afterEach(() => {
    isolate?.cleanup();
    isolate = null;
  });

  it("listRepos({}) returns all seeded repos", async () => {
    const { getSqlite } = await import("@/lib/db/client");
    const sqlite = getSqlite();
    seedRepo(sqlite, {
      name: "alpha",
      fullPath: "/tmp/alpha",
      primaryLanguage: "TypeScript",
    });
    seedRepo(sqlite, {
      name: "beta",
      fullPath: "/tmp/beta",
      primaryLanguage: "Rust",
    });

    const { listRepos } = await loadQueries();
    const result = await listRepos({});
    expect(result.items.length).toBe(2);
    expect(result.total).toBe(2);
    const names = result.items.map((r: Repo) => r.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });

  it("listRepos({q}) filters via FTS", async () => {
    const { getSqlite } = await import("@/lib/db/client");
    const sqlite = getSqlite();
    seedRepo(sqlite, {
      name: "react-dashboard",
      fullPath: "/tmp/react-dashboard",
      description: "React dashboard with charts",
    });
    seedRepo(sqlite, {
      name: "rust-cli",
      fullPath: "/tmp/rust-cli",
      description: "Command line in Rust",
    });

    const { listRepos } = await loadQueries();
    const result = await listRepos({ q: "react" });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.items.some((r: Repo) => r.name === "react-dashboard")).toBe(
      true,
    );
    expect(result.items.every((r: Repo) => r.name !== "rust-cli")).toBe(true);
  });

  it("listRepos({language}) filters by primary language", async () => {
    const { getSqlite } = await import("@/lib/db/client");
    const sqlite = getSqlite();
    seedRepo(sqlite, {
      name: "ts-one",
      fullPath: "/tmp/ts-one",
      primaryLanguage: "TypeScript",
    });
    seedRepo(sqlite, {
      name: "py-one",
      fullPath: "/tmp/py-one",
      primaryLanguage: "Python",
    });

    const { listRepos } = await loadQueries();
    const result = await listRepos({ language: "TypeScript" });
    expect(result.items.length).toBe(1);
    expect(result.items[0].name).toBe("ts-one");
  });

  it("getRepoBySlug returns full detail with groups array", async () => {
    const { getSqlite } = await import("@/lib/db/client");
    const sqlite = getSqlite();
    const { slug, id } = seedRepo(sqlite, {
      name: "target",
      fullPath: "/tmp/target",
      readmeContent: "# target\nhello",
    });
    const gid = seedGroup(sqlite, { name: "Favorites" });
    addRepoToGroup(sqlite, id, gid);

    const { getRepoBySlug } = await loadQueries();
    const detail = await getRepoBySlug(slug);
    expect(detail).not.toBeNull();
    expect(detail!.slug).toBe(slug);
    expect(detail!.name).toBe("target");
    expect(Array.isArray(detail!.groups)).toBe(true);
    expect(detail!.groups.some((g) => g.id === gid && g.name === "Favorites")).toBe(
      true,
    );
    expect(typeof detail!.readmeContent === "string").toBe(true);
  });

  it("getRepoBySlug returns null for missing slug", async () => {
    const { getRepoBySlug } = await loadQueries();
    const detail = await getRepoBySlug("does-not-exist");
    expect(detail).toBeNull();
  });

  it("listGroups reflects group membership repoCount", async () => {
    const { getSqlite } = await import("@/lib/db/client");
    const sqlite = getSqlite();
    const { listGroups } = await loadQueries();

    const first = await listGroups();
    expect(first.length).toBe(0);

    const { id: r1 } = seedRepo(sqlite, {
      name: "a",
      fullPath: "/tmp/a",
    });
    const { id: r2 } = seedRepo(sqlite, {
      name: "b",
      fullPath: "/tmp/b",
    });
    const gid = seedGroup(sqlite, { name: "G1" });
    addRepoToGroup(sqlite, r1, gid);
    addRepoToGroup(sqlite, r2, gid);

    const after = await listGroups();
    const g = after.find((x) => x.id === gid);
    expect(g).toBeDefined();
    expect(g!.repoCount).toBe(2);
  });
});

