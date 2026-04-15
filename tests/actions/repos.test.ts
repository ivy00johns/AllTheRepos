import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isolateDataDir } from "../helpers/test-db.js";
import { seedRepo } from "../helpers/seed.js";
import type { ActionResult, Repo } from "@/contracts/types";

/**
 * Server actions from app/actions/repos.ts:
 *   rescanRepo(slug): ActionResult<Repo>
 *   setRepoTags(slug, tags: string[]): ActionResult<Repo>
 *
 * The rescan path talks to git; we mock simple-git so this is a unit test
 * not an integration test.
 */

type ReposActions = {
  rescanRepo: (slug: string) => Promise<ActionResult<Repo>>;
  setRepoTags: (
    slug: string,
    tags: string[],
  ) => Promise<ActionResult<Repo>>;
};

async function loadActions(): Promise<ReposActions> {
  return (await import("@/app/actions/repos")) as unknown as ReposActions;
}

describe("actions/repos — contracts/api.md server actions", () => {
  let isolate: { dir: string; cleanup(): void } | null = null;

  beforeEach(async () => {
    vi.resetModules();
    isolate = isolateDataDir();
    const { getDb } = await import("@/lib/db/client");
    getDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    isolate?.cleanup();
    isolate = null;
  });

  it("rescanRepo updates last_scanned_at", async () => {
    const { getSqlite } = await import("@/lib/db/client");
    const sqlite = getSqlite();

    // Give it an on-disk path git can stat; fullPath doesn't need to be real
    // if simple-git is mocked, but the scanner may still check existsSync.
    const { slug } = seedRepo(sqlite, {
      name: "rescan-me",
      fullPath: process.cwd(),
      primaryLanguage: "TypeScript",
    });

    // Null out last_scanned_at so we can detect the update.
    sqlite
      .prepare("UPDATE repos SET last_scanned_at = NULL WHERE slug = ?")
      .run(slug);

    const { rescanRepo } = await loadActions();
    const result = await rescanRepo(slug);
    expect(result.ok).toBe(true);

    const after = sqlite
      .prepare("SELECT last_scanned_at FROM repos WHERE slug = ?")
      .get(slug) as { last_scanned_at: string | null };
    expect(after.last_scanned_at).not.toBeNull();
  });

  it("setRepoTags persists user tags and they survive a rescan", async () => {
    const { getSqlite } = await import("@/lib/db/client");
    const sqlite = getSqlite();
    const { slug } = seedRepo(sqlite, {
      name: "tags-target",
      fullPath: process.cwd(),
      tags: [{ value: "framework", source: "heuristic" }],
    });

    const { setRepoTags, rescanRepo } = await loadActions();
    const setResult = await setRepoTags(slug, ["mine", "important"]);
    expect(setResult.ok).toBe(true);

    const raw = sqlite
      .prepare("SELECT tags_json FROM repos WHERE slug = ?")
      .get(slug) as { tags_json: string };
    const tags = JSON.parse(raw.tags_json) as Array<{
      value: string;
      source: string;
    }>;
    const userTags = tags.filter((t) => t.source === "user").map((t) => t.value);
    expect(userTags).toContain("mine");
    expect(userTags).toContain("important");

    // Re-scan should not wipe user tags.
    const rescanResult = await rescanRepo(slug);
    expect(rescanResult.ok).toBe(true);

    const raw2 = sqlite
      .prepare("SELECT tags_json FROM repos WHERE slug = ?")
      .get(slug) as { tags_json: string };
    const tags2 = JSON.parse(raw2.tags_json) as Array<{
      value: string;
      source: string;
    }>;
    const userTags2 = tags2
      .filter((t) => t.source === "user")
      .map((t) => t.value);
    expect(userTags2).toContain("mine");
    expect(userTags2).toContain("important");
  });
});
