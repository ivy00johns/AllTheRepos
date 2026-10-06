/**
 * `graph:*` IPC handlers.
 *
 * The read handlers are cheap lookups the catalog makes on every
 * selection; the write handlers are the panel's own path into
 * `repo_links`, and they are held to the same rules the MCP's tools are:
 * no self-links, no guessing which repo you meant, and no un-explained
 * assertion.
 *
 * Services are mocked the way `catalog.spec.ts` does it; the input/output
 * Zod wiring is exercised for real, so a service-shape drift surfaces here
 * as a parse failure rather than in the product.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@main/services/catalog", () => ({
  catalogService: { resolveRepoId: vi.fn() },
}));
vi.mock("@main/services/graph", () => ({
  graphService: { build: vi.fn() },
}));
vi.mock("@main/db/links", () => ({
  listRelations: vi.fn(),
  createLink: vi.fn(),
  removeLink: vi.fn(),
}));

import type { RepoLink, RepoRelation } from "@shared/types";

import { createLink, listRelations, removeLink } from "@main/db/links";
import {
  handleAssertRepoLink,
  handleRemoveRepoLink,
  handleRepoRelations,
} from "@main/ipc/graph";
import { catalogService } from "@main/services/catalog";

const RELATION: RepoRelation = {
  slug: "beta-aaaaaa",
  name: "beta",
  kind: "depends-on",
  direction: "outgoing",
  why: "shares ufuzzy",
  source: "mcp",
  createdAt: "2026-10-06T00:00:00.000Z",
};

const LINK: RepoLink = {
  id: 1,
  fromSlug: "alpha-aaaaaa",
  toSlug: "beta-aaaaaa",
  kind: "part-of",
  why: "lives under beta",
  source: "ui",
  createdAt: "2026-10-06T00:00:00.000Z",
};

describe("handleRepoRelations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the slug to an id and returns that repo's relations", async () => {
    vi.mocked(catalogService.resolveRepoId).mockResolvedValue(7);
    vi.mocked(listRelations).mockReturnValue([RELATION]);

    await expect(
      handleRepoRelations({ slug: "alpha-aaaaaa" }),
    ).resolves.toEqual({ relations: [RELATION] });
    expect(catalogService.resolveRepoId).toHaveBeenCalledWith("alpha-aaaaaa");
    expect(listRelations).toHaveBeenCalledWith(7);
  });

  it("returns nothing (and skips the link query) for a slug no longer in the catalog", async () => {
    vi.mocked(catalogService.resolveRepoId).mockResolvedValue(null);

    await expect(handleRepoRelations({ slug: "gone-zzzzzz" })).resolves.toEqual({
      relations: [],
    });
    expect(listRelations).not.toHaveBeenCalled();
  });

  it("rejects a malformed payload before touching the catalog", async () => {
    await expect(handleRepoRelations({})).rejects.toThrow();
    await expect(handleRepoRelations({ slug: "" })).rejects.toThrow();
    expect(catalogService.resolveRepoId).not.toHaveBeenCalled();
  });
});

describe("handleAssertRepoLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves both slugs and stamps the row as a ui assertion", async () => {
    vi.mocked(catalogService.resolveRepoId)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(9);
    vi.mocked(createLink).mockReturnValue(LINK);

    await expect(
      handleAssertRepoLink({
        fromSlug: "alpha-aaaaaa",
        toSlug: "beta-aaaaaa",
        kind: "part-of",
        why: "lives under beta",
      }),
    ).resolves.toEqual({ link: LINK });

    expect(createLink).toHaveBeenCalledWith({
      fromId: 7,
      toId: 9,
      kind: "part-of",
      why: "lives under beta",
      source: "ui",
    });
  });

  it("refuses to link a repo to itself without touching the catalog", async () => {
    await expect(
      handleAssertRepoLink({
        fromSlug: "alpha-aaaaaa",
        toSlug: "alpha-aaaaaa",
        kind: "related",
        why: "same thing twice",
      }),
    ).rejects.toThrow(/cannot link to itself/);
    expect(catalogService.resolveRepoId).not.toHaveBeenCalled();
    expect(createLink).not.toHaveBeenCalled();
  });

  it("names the missing end instead of writing a link to nowhere", async () => {
    vi.mocked(catalogService.resolveRepoId)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(null);

    await expect(
      handleAssertRepoLink({
        fromSlug: "alpha-aaaaaa",
        toSlug: "gone-zzzzzz",
        kind: "related",
        why: "some reason",
      }),
    ).rejects.toThrow(/No catalog entry matches the to repository/);
    expect(createLink).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only reason before resolving anything", async () => {
    await expect(
      handleAssertRepoLink({
        fromSlug: "alpha-aaaaaa",
        toSlug: "beta-aaaaaa",
        kind: "related",
        why: "   ",
      }),
    ).rejects.toThrow();
    expect(catalogService.resolveRepoId).not.toHaveBeenCalled();
  });
});

describe("handleRemoveRepoLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes the row addressed from the panel's own side", async () => {
    vi.mocked(catalogService.resolveRepoId)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(9);
    vi.mocked(removeLink).mockReturnValue(true);

    await expect(
      handleRemoveRepoLink({
        fromSlug: "alpha-aaaaaa",
        toSlug: "beta-aaaaaa",
        kind: "part-of",
      }),
    ).resolves.toEqual({ removed: true });
    expect(removeLink).toHaveBeenCalledWith(7, 9, "part-of");
  });

  it("reports removed: false when the row was already gone", async () => {
    vi.mocked(catalogService.resolveRepoId)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(9);
    vi.mocked(removeLink).mockReturnValue(false);

    await expect(
      handleRemoveRepoLink({
        fromSlug: "alpha-aaaaaa",
        toSlug: "beta-aaaaaa",
        kind: "part-of",
      }),
    ).resolves.toEqual({ removed: false });
  });

  it("treats a deleted endpoint as already-removed rather than an error", async () => {
    vi.mocked(catalogService.resolveRepoId)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(null);

    await expect(
      handleRemoveRepoLink({
        fromSlug: "alpha-aaaaaa",
        toSlug: "gone-zzzzzz",
        kind: "part-of",
      }),
    ).resolves.toEqual({ removed: false });
    expect(removeLink).not.toHaveBeenCalled();
  });

  it("rejects a malformed payload before touching the catalog", async () => {
    await expect(
      handleRemoveRepoLink({ fromSlug: "alpha-aaaaaa" }),
    ).rejects.toThrow();
    expect(catalogService.resolveRepoId).not.toHaveBeenCalled();
  });
});
