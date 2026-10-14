/**
 * `notes:*` IPC handlers.
 *
 * The renderer holds a slug; the note is stored against the catalog row id.
 * These tests pin that translation, the "absent note is empty, not an error"
 * rule on the read path, and the "a write that cannot name its target fails
 * loudly" rule on the write path. The service and catalog are mocked the way
 * `graph.spec.ts` does it; input/output Zod wiring is exercised for real.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@main/services/catalog", () => ({
  catalogService: { resolveRepoId: vi.fn() },
}));
vi.mock("@main/services/notes", () => ({
  readNote: vi.fn(),
  writeNote: vi.fn(),
}));

import { handleNotesGet, handleNotesSave } from "@main/ipc/notes";
import { catalogService } from "@main/services/catalog";
import { readNote, writeNote } from "@main/services/notes";

describe("handleNotesGet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the slug and returns that repo's stored note", async () => {
    vi.mocked(catalogService.resolveRepoId).mockResolvedValue(7);
    vi.mocked(readNote).mockReturnValue({
      content: "# hi",
      updatedAt: "2026-10-06T00:00:00.000Z",
    });

    await expect(handleNotesGet({ slug: "alpha-aaaaaa" })).resolves.toEqual({
      slug: "alpha-aaaaaa",
      content: "# hi",
      updatedAt: "2026-10-06T00:00:00.000Z",
    });
    expect(catalogService.resolveRepoId).toHaveBeenCalledWith("alpha-aaaaaa");
    expect(readNote).toHaveBeenCalledWith(7);
  });

  it("returns a blank note (without reading disk) for an unknown slug", async () => {
    vi.mocked(catalogService.resolveRepoId).mockResolvedValue(null);

    await expect(handleNotesGet({ slug: "gone-zzzzzz" })).resolves.toEqual({
      slug: "gone-zzzzzz",
      content: "",
      updatedAt: null,
    });
    expect(readNote).not.toHaveBeenCalled();
  });

  it("rejects a malformed payload before touching the catalog", async () => {
    await expect(handleNotesGet({})).rejects.toThrow();
    await expect(handleNotesGet({ slug: "" })).rejects.toThrow();
    expect(catalogService.resolveRepoId).not.toHaveBeenCalled();
  });
});

describe("handleNotesSave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes against the resolved row id and echoes what was stored", async () => {
    vi.mocked(catalogService.resolveRepoId).mockResolvedValue(9);
    vi.mocked(writeNote).mockReturnValue({
      content: "body",
      updatedAt: "2026-10-06T00:00:00.000Z",
    });

    await expect(
      handleNotesSave({ slug: "beta-aaaaaa", content: "body" }),
    ).resolves.toEqual({
      slug: "beta-aaaaaa",
      content: "body",
      updatedAt: "2026-10-06T00:00:00.000Z",
    });
    expect(writeNote).toHaveBeenCalledWith(9, "body");
  });

  it("fails loudly for a slug no longer in the catalog", async () => {
    vi.mocked(catalogService.resolveRepoId).mockResolvedValue(null);

    await expect(
      handleNotesSave({ slug: "gone-zzzzzz", content: "x" }),
    ).rejects.toThrow(/No catalog entry matches/);
    expect(writeNote).not.toHaveBeenCalled();
  });

  it("rejects a body beyond the size ceiling before touching the catalog", async () => {
    await expect(
      handleNotesSave({ slug: "alpha-aaaaaa", content: "x".repeat(262_145) }),
    ).rejects.toThrow();
    expect(catalogService.resolveRepoId).not.toHaveBeenCalled();
  });
});
