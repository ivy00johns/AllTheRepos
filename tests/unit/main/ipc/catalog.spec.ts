/**
 * Phase 1 Unit Test — main-process `catalog:*` IPC handlers.
 *
 * Strategy: import the pure `handle*` functions, mock the
 * `catalogService` and `searchService` modules with `vi.mock`, feed
 * the handler well-formed payloads, and assert:
 *   1. the service was called with the expected args (input parsing
 *      is delegated to Zod inside the handler — we trust that path
 *      because it's separately covered in schemas.spec.ts),
 *   2. the return value round-trips through the response Zod schema
 *      (regression net against service drift),
 *   3. malformed inputs reject before the service is called.
 *
 * No Electron runtime, no real DB, no real network. The handler
 * orchestrates Zod-in / service / Zod-out — we test exactly that
 * orchestration.
 *
 * Owner: qe-agent (Phase 1).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the service modules BEFORE importing the handler.
//
// vitest hoists `vi.mock` calls to the top of the file, so the factory
// runs before any `import` in the user-land module graph. The handler
// file in turn imports the services through the same paths these
// mocks intercept.
// ---------------------------------------------------------------------------

vi.mock("@main/services/catalog", () => ({
  catalogService: {
    list: vi.fn(),
    get: vi.fn(),
    rescan: vi.fn(),
    setTags: vi.fn(),
    deleteRepo: vi.fn(),
    listGroups: vi.fn(),
    createGroup: vi.fn(),
    renameGroup: vi.fn(),
    deleteGroup: vi.fn(),
    setGroupMembers: vi.fn(),
  },
}));

vi.mock("@main/services/search", () => ({
  searchService: {
    search: vi.fn(),
  },
}));

import { catalogService } from "@main/services/catalog";
import { searchService } from "@main/services/search";
import {
  handleCatalogList,
  handleCatalogGet,
  handleCatalogSearch,
  handleCatalogRescan,
  handleCatalogSetTags,
  handleCatalogDelete,
  handleCatalogSmartFilter,
} from "@main/ipc/catalog";

// ---------------------------------------------------------------------------
// Fixtures (canonical Repo / RepoDetail shapes the schemas expect)
// ---------------------------------------------------------------------------

const fixtureRepo = {
  id: 1,
  slug: "foo",
  name: "foo",
  fullPath: "/repos/foo",
  remoteUrl: null,
  defaultBranch: "main",
  currentBranch: "main",
  lastCommitHash: "abc123",
  lastCommitDate: "2026-05-13T00:00:00.000Z",
  lastCommitMsg: "init",
  isDirty: false,
  primaryLanguage: "TypeScript",
  languages: [{ name: "TypeScript", bytes: 100, color: "#3178c6" }],
  tags: [{ value: "test", source: "user" as const }],
  description: null,
  readmePreview: null,
  readmeHash: null,
  sizeBytes: null,
  lastScannedAt: "2026-05-13T00:00:00.000Z",
  lastOpenedAt: null,
  createdAt: "2026-05-13T00:00:00.000Z",
  updatedAt: "2026-05-13T00:00:00.000Z",
  source: "filesystem_scan" as const,
};

const fixtureDetail = {
  ...fixtureRepo,
  readmeContent: "# foo",
  groups: [{ id: 1, name: "Backend" }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// handleCatalogList
// ---------------------------------------------------------------------------

describe("handleCatalogList", () => {
  it("parses input, calls catalogService.list, returns Zod-validated result", async () => {
    vi.mocked(catalogService.list).mockResolvedValue({
      items: [fixtureRepo],
      total: 1,
      limit: 50,
      offset: 0,
    });

    const out = await handleCatalogList({ q: "foo", limit: 50 });

    expect(catalogService.list).toHaveBeenCalledTimes(1);
    expect(catalogService.list).toHaveBeenCalledWith(
      expect.objectContaining({ q: "foo", limit: 50 }),
    );
    expect(out).toEqual({
      items: [fixtureRepo],
      total: 1,
      limit: 50,
      offset: 0,
    });
  });

  it("accepts an empty input (all fields optional)", async () => {
    vi.mocked(catalogService.list).mockResolvedValue({
      items: [],
      total: 0,
      limit: 0,
      offset: 0,
    });

    const out = await handleCatalogList({});
    expect(out.items).toEqual([]);
    expect(out.total).toBe(0);
  });

  it("rejects a malformed payload before calling the service", async () => {
    await expect(handleCatalogList({ limit: -1 })).rejects.toThrow();
    expect(catalogService.list).not.toHaveBeenCalled();
  });

  it("rejects a payload with limit > 200", async () => {
    await expect(handleCatalogList({ limit: 201 })).rejects.toThrow();
    expect(catalogService.list).not.toHaveBeenCalled();
  });

  it("rejects when the service returns a malformed result", async () => {
    vi.mocked(catalogService.list).mockResolvedValue({
      items: [],
      // @ts-expect-error - intentionally bad
      total: "many",
      limit: 0,
      offset: 0,
    });
    await expect(handleCatalogList({})).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleCatalogGet
// ---------------------------------------------------------------------------

describe("handleCatalogGet", () => {
  it("returns the RepoDetail when found", async () => {
    vi.mocked(catalogService.get).mockResolvedValue(fixtureDetail);
    const out = await handleCatalogGet({ slug: "foo" });
    expect(catalogService.get).toHaveBeenCalledWith("foo");
    expect(out).toEqual(fixtureDetail);
  });

  it("returns null when the service signals not found", async () => {
    vi.mocked(catalogService.get).mockResolvedValue(null);
    const out = await handleCatalogGet({ slug: "missing" });
    expect(out).toBeNull();
  });

  it("rejects an empty slug before calling the service", async () => {
    await expect(handleCatalogGet({ slug: "" })).rejects.toThrow();
    expect(catalogService.get).not.toHaveBeenCalled();
  });

  it("rejects a missing slug", async () => {
    await expect(handleCatalogGet({})).rejects.toThrow();
    expect(catalogService.get).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleCatalogSearch
// ---------------------------------------------------------------------------

describe("handleCatalogSearch", () => {
  it("returns the search hits", async () => {
    vi.mocked(searchService.search).mockResolvedValue([
      { repo: fixtureRepo, score: 0.9, matchKind: "hybrid", snippet: "hit" },
    ]);
    const out = await handleCatalogSearch({ q: "rust", mode: "hybrid" });
    expect(searchService.search).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0].matchKind).toBe("hybrid");
  });

  it("rejects an empty q", async () => {
    await expect(handleCatalogSearch({ q: "" })).rejects.toThrow();
    expect(searchService.search).not.toHaveBeenCalled();
  });

  it("rejects an unknown mode", async () => {
    await expect(
      handleCatalogSearch({ q: "foo", mode: "magic" }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// handleCatalogRescan
// ---------------------------------------------------------------------------

describe("handleCatalogRescan", () => {
  it("delegates to catalogService.rescan and returns the Repo", async () => {
    vi.mocked(catalogService.rescan).mockResolvedValue(fixtureRepo);
    const out = await handleCatalogRescan({ slug: "foo" });
    expect(catalogService.rescan).toHaveBeenCalledWith("foo");
    expect(out.slug).toBe("foo");
  });

  it("rejects an empty slug", async () => {
    await expect(handleCatalogRescan({ slug: "" })).rejects.toThrow();
    expect(catalogService.rescan).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleCatalogSetTags
// ---------------------------------------------------------------------------

describe("handleCatalogSetTags", () => {
  it("forwards slug + tags to the service", async () => {
    vi.mocked(catalogService.setTags).mockResolvedValue(fixtureRepo);
    const out = await handleCatalogSetTags({
      slug: "foo",
      tags: ["a", "b"],
    });
    expect(catalogService.setTags).toHaveBeenCalledWith("foo", ["a", "b"]);
    expect(out.slug).toBe("foo");
  });

  it("rejects > 12 tags", async () => {
    const tags = Array.from({ length: 13 }, (_, i) => `t${i}`);
    await expect(handleCatalogSetTags({ slug: "foo", tags })).rejects.toThrow();
    expect(catalogService.setTags).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleCatalogDelete (ATR-028)
// ---------------------------------------------------------------------------

describe("handleCatalogDelete", () => {
  it("forwards the slug to the service and returns the delete result", async () => {
    vi.mocked(catalogService.deleteRepo).mockResolvedValue({
      slug: "foo",
      deleted: true,
    });
    const out = await handleCatalogDelete({ slug: "foo" });
    expect(catalogService.deleteRepo).toHaveBeenCalledWith("foo");
    expect(out).toEqual({ slug: "foo", deleted: true });
  });

  it("rejects an empty slug before touching the service", async () => {
    await expect(handleCatalogDelete({ slug: "" })).rejects.toThrow();
    expect(catalogService.deleteRepo).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleCatalogSmartFilter (Phase 1 stub — contract locked, returns [])
// ---------------------------------------------------------------------------

describe("handleCatalogSmartFilter", () => {
  it("returns an empty array (Phase 1 stub)", async () => {
    const out = await handleCatalogSmartFilter({ prompt: "rust async" });
    expect(out).toEqual([]);
  });

  it("rejects an empty prompt before stub returns", async () => {
    await expect(handleCatalogSmartFilter({ prompt: "" })).rejects.toThrow();
  });
});
