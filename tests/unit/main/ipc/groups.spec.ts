/**
 * Phase 1 Unit Test — main-process `groups:*` IPC handlers.
 *
 * `groups:*` is backed by the same `catalogService` singleton (groups
 * live in the same SQLite DB as the catalog). We mock the service and
 * test the handler orchestration.
 *
 * Owner: qe-agent (Phase 1).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@main/services/catalog", () => ({
  catalogService: {
    listGroups: vi.fn(),
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    deleteGroup: vi.fn(),
    setGroupMembers: vi.fn(),
  },
}));

import { catalogService } from "@main/services/catalog";
import {
  handleGroupsList,
  handleGroupsCreate,
  handleGroupsRename,
  handleGroupsDelete,
  handleGroupsSetMembers,
} from "@main/ipc/groups";

const fixtureGroup = {
  id: 1,
  name: "Frontend",
  description: null,
  isSmart: false,
  smartFilter: null,
  parentGroupId: null,
  sortOrder: 0,
  repoCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleGroupsList", () => {
  it("returns an array of groups", async () => {
    vi.mocked(catalogService.listGroups).mockResolvedValue([fixtureGroup]);
    const out = await handleGroupsList({});
    expect(catalogService.listGroups).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Frontend");
  });

  it("rejects extra keys (strict input schema)", async () => {
    await expect(handleGroupsList({ q: "x" })).rejects.toThrow();
    expect(catalogService.listGroups).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a malformed group", async () => {
    vi.mocked(catalogService.listGroups).mockResolvedValue([
      // @ts-expect-error - intentionally bad
      { ...fixtureGroup, name: "" },
    ]);
    await expect(handleGroupsList({})).rejects.toThrow();
  });
});

describe("handleGroupsCreate", () => {
  it("creates a minimal manual group and returns it", async () => {
    vi.mocked(catalogService.createGroup).mockResolvedValue(fixtureGroup);
    const out = await handleGroupsCreate({ name: "Frontend" });
    expect(catalogService.createGroup).toHaveBeenCalledWith({
      name: "Frontend",
    });
    expect(out.name).toBe("Frontend");
  });

  it("creates a smart group with a nested filter", async () => {
    const smart = {
      ...fixtureGroup,
      id: 2,
      name: "Rust",
      isSmart: true,
      smartFilter: { language: "rust" },
    };
    vi.mocked(catalogService.createGroup).mockResolvedValue(smart);
    const out = await handleGroupsCreate({
      name: "Rust",
      isSmart: true,
      smartFilter: { language: "rust" },
    });
    expect(out.isSmart).toBe(true);
    expect(out.smartFilter).toEqual({ language: "rust" });
  });

  it("rejects an empty name", async () => {
    await expect(handleGroupsCreate({ name: "" })).rejects.toThrow();
    expect(catalogService.createGroup).not.toHaveBeenCalled();
  });
});

describe("handleGroupsRename", () => {
  it("forwards id + name to the service", async () => {
    vi.mocked(catalogService.renameGroup).mockResolvedValue({
      ...fixtureGroup,
      name: "Frontend (renamed)",
    });
    const out = await handleGroupsRename({ id: 1, name: "Frontend (renamed)" });
    expect(catalogService.renameGroup).toHaveBeenCalledWith(
      1,
      "Frontend (renamed)",
    );
    expect(out.name).toBe("Frontend (renamed)");
  });

  it("rejects an empty name", async () => {
    await expect(handleGroupsRename({ id: 1, name: "" })).rejects.toThrow();
    expect(catalogService.renameGroup).not.toHaveBeenCalled();
  });

  it("rejects a non-integer id", async () => {
    await expect(handleGroupsRename({ id: 1.5, name: "x" })).rejects.toThrow();
    expect(catalogService.renameGroup).not.toHaveBeenCalled();
  });
});

describe("handleGroupsDelete", () => {
  it("returns {deleted: true, id} on success", async () => {
    vi.mocked(catalogService.deleteGroup).mockResolvedValue({
      deleted: true,
      id: 1,
    });
    const out = await handleGroupsDelete({ id: 1 });
    expect(catalogService.deleteGroup).toHaveBeenCalledWith(1);
    expect(out).toEqual({ deleted: true, id: 1 });
  });

  it("rejects a missing id", async () => {
    await expect(handleGroupsDelete({})).rejects.toThrow();
    expect(catalogService.deleteGroup).not.toHaveBeenCalled();
  });
});

describe("handleGroupsSetMembers", () => {
  it("returns the new memberCount", async () => {
    vi.mocked(catalogService.setGroupMembers).mockResolvedValue({
      groupId: 1,
      memberCount: 2,
    });
    const out = await handleGroupsSetMembers({
      groupId: 1,
      slugs: ["a", "b"],
    });
    expect(catalogService.setGroupMembers).toHaveBeenCalledWith(1, ["a", "b"]);
    expect(out.memberCount).toBe(2);
  });

  it("accepts an empty slug list (clear membership)", async () => {
    vi.mocked(catalogService.setGroupMembers).mockResolvedValue({
      groupId: 1,
      memberCount: 0,
    });
    const out = await handleGroupsSetMembers({ groupId: 1, slugs: [] });
    expect(out.memberCount).toBe(0);
  });

  it("rejects an empty-string slug entry", async () => {
    await expect(
      handleGroupsSetMembers({ groupId: 1, slugs: [""] }),
    ).rejects.toThrow();
    expect(catalogService.setGroupMembers).not.toHaveBeenCalled();
  });
});
