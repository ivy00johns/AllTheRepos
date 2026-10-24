/**
 * Integration test (REAL DB, embedding/vector modules mocked) —
 * `catalogService.updateGroupFilter`.
 *
 * Rewriting a saved filter is a write to `groups.smart_filter_json`, and the
 * only thing that proves it is a read back out through the same service the rail
 * uses. A handler test with a mocked service would pass while the JSON never
 * round-tripped, and the rule the user corrected would keep matching the old set
 * of repos.
 *
 * The refusal is the other half: a manual group stores its membership in
 * `repo_groups`, and `isSmart` is what decides whether a filter is consulted. A
 * filter written onto a hand-picked list would sit in the database looking live
 * and never be evaluated, so the service rejects it rather than storing it.
 *
 * !!! REAL better-sqlite3 DB !!! Needs host-ABI natives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isolateDataDir } from "../../../helpers/test-db.js";

vi.mock("@main/services/vector-store", () => ({
  deleteEmbedding: vi.fn(),
}));
vi.mock("@main/services/embedding", () => ({
  indexRepoEmbedding: vi.fn().mockResolvedValue(undefined),
}));

let isolate: { dir: string; cleanup(): void } | null = null;

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

describe("catalogService.updateGroupFilter", () => {
  it("replaces the rule and reads it back from the database", async () => {
    const { catalogService } = await import("@main/services/catalog");

    const created = await catalogService.createGroup({
      name: "Dirty",
      isSmart: true,
      smartFilter: { dirtyOnly: true },
    });

    const updated = await catalogService.updateGroupFilter(created.id, {
      language: "Rust",
      tagsInclude: ["cli"],
    });
    expect(updated.smartFilter).toEqual({
      language: "Rust",
      tagsInclude: ["cli"],
    });

    // The returned row is not the proof — the next `groups:list` is what the
    // rail and the catalog actually read.
    const listed = (await catalogService.listGroups()).find(
      (group) => group.id === created.id,
    );
    expect(listed?.smartFilter).toEqual({
      language: "Rust",
      tagsInclude: ["cli"],
    });
    expect(listed?.isSmart).toBe(true);
  });

  it("keeps the group's name and id", async () => {
    const { catalogService } = await import("@main/services/catalog");
    const created = await catalogService.createGroup({
      name: "Tagged",
      isSmart: true,
      smartFilter: { tagsInclude: ["focus"] },
    });

    const updated = await catalogService.updateGroupFilter(created.id, {
      tagsInclude: ["focus", "client"],
    });
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("Tagged");
  });

  it("refuses a manual group and leaves it untouched", async () => {
    const { catalogService } = await import("@main/services/catalog");
    const created = await catalogService.createGroup({ name: "Hand picked" });

    await expect(
      catalogService.updateGroupFilter(created.id, { dirtyOnly: true }),
    ).rejects.toThrow(/not a saved filter/);

    const listed = (await catalogService.listGroups()).find(
      (group) => group.id === created.id,
    );
    expect(listed?.isSmart).toBe(false);
    expect(listed?.smartFilter).toBeNull();
  });

  it("rejects an unknown id", async () => {
    const { catalogService } = await import("@main/services/catalog");
    await expect(
      catalogService.updateGroupFilter(9_999_999, { dirtyOnly: true }),
    ).rejects.toThrow(/not found/);
  });
});
