/**
 * Unit test for the `useSaveNote` mutation contract (`notes:save`).
 *
 * Environment constraints match `use-set-repo-tags.spec.ts`: vitest runs
 * `environment: "node"`, so this spec imports NOTHING from app code or UI
 * deps. It re-implements the mutation's two pieces of logic — the
 * `mutationFn` (dial the bridge with `{slug, content}`) and the `onSuccess`
 * (write the server's answer into the cache for that slug) — exactly as
 * `useSaveNote` wires them in `src/renderer/hooks/use-notes.ts`, and drives
 * them against a tiny fake query client.
 *
 * The interesting property, and the reason this test exists rather than the
 * notes tab being exercised by hand: the save must SEED THE CACHE, not
 * invalidate it. An invalidation would refetch, and a refetch landing
 * mid-typing resets the textarea under the user's caret — exactly the bug an
 * autosaving editor invites.
 *
 * KEEP IN LOCKSTEP with `useSaveNote`:
 *   - payload = { slug, content }
 *   - onSuccess setQueryData(queryKeys.notes.detail(slug), saved)
 *   - onSuccess does NOT invalidate anything
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors `@renderer/lib/query-client` queryKeys.notes.* (mutable arrays to
// satisfy the root tsconfig's type-check of tests/**).
const notesDetailKey = (slug: string): unknown[] => [
  "notes",
  "detail",
  slug,
];

interface NoteLite {
  slug: string;
  content: string;
  updatedAt: string | null;
}

interface SaveInput {
  slug: string;
  content: string;
}

/** Tiny fake of the bits of QueryClient the hook touches. */
class FakeQueryClient {
  seeded: Array<{ key: unknown[]; value: unknown }> = [];
  invalidated: unknown[][] = [];
  setQueryData(key: unknown[], value: unknown): void {
    this.seeded.push({ key, value });
  }
  invalidateQueries(opts: { queryKey: unknown[] }): void {
    this.invalidated.push(opts.queryKey);
  }
}

function getAtr() {
  return (globalThis as { window?: { atr?: unknown } }).window?.atr as
    | { notes: { save: (i: SaveInput) => Promise<NoteLite> } }
    | undefined;
}

/** The mutation's real logic, reproduced from `useSaveNote`. */
function runSaveNoteMutation(client: FakeQueryClient) {
  const mutationFn = async (input: SaveInput): Promise<NoteLite> => {
    const atr = getAtr();
    if (!atr) {
      throw new Error("Preload bridge unavailable — cannot save the note.");
    }
    return atr.notes.save(input);
  };
  const onSuccess = (saved: NoteLite) => {
    client.setQueryData(notesDetailKey(saved.slug), saved);
  };
  return async (input: SaveInput): Promise<NoteLite> => {
    const result = await mutationFn(input);
    onSuccess(result);
    return result;
  };
}

describe("useSaveNote mutation contract (notes:save)", () => {
  const save = vi.fn();

  beforeEach(() => {
    save.mockReset();
    (globalThis as { window?: unknown }).window = {
      atr: { notes: { save } },
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    vi.restoreAllMocks();
  });

  it("sends {slug, content} through the bridge and returns what was stored", async () => {
    const stored: NoteLite = {
      slug: "demo",
      content: "# hi",
      updatedAt: "2026-10-06T00:00:00.000Z",
    };
    save.mockResolvedValue(stored);

    const client = new FakeQueryClient();
    const mutate = runSaveNoteMutation(client);

    await expect(mutate({ slug: "demo", content: "# hi" })).resolves.toEqual(
      stored,
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ slug: "demo", content: "# hi" });
  });

  it("seeds the per-slug cache with the server's answer", async () => {
    const stored: NoteLite = {
      slug: "demo",
      content: "body",
      updatedAt: "2026-10-06T00:00:00.000Z",
    };
    save.mockResolvedValue(stored);

    const client = new FakeQueryClient();
    await runSaveNoteMutation(client)({ slug: "demo", content: "body" });

    expect(client.seeded).toEqual([
      { key: notesDetailKey("demo"), value: stored },
    ]);
  });

  it("clearing a note seeds an empty, timeless projection", async () => {
    const stored: NoteLite = { slug: "demo", content: "", updatedAt: null };
    save.mockResolvedValue(stored);

    const client = new FakeQueryClient();
    await runSaveNoteMutation(client)({ slug: "demo", content: "   " });

    expect(client.seeded).toEqual([
      { key: notesDetailKey("demo"), value: stored },
    ]);
  });

  it("never invalidates — an autosaving editor must not refetch over the caret", async () => {
    save.mockResolvedValue({ slug: "demo", content: "x", updatedAt: null });

    const client = new FakeQueryClient();
    await runSaveNoteMutation(client)({ slug: "demo", content: "x" });

    expect(client.invalidated).toHaveLength(0);
  });

  it("throws when the preload bridge is unavailable", async () => {
    delete (globalThis as { window?: unknown }).window;

    const client = new FakeQueryClient();
    await expect(
      runSaveNoteMutation(client)({ slug: "demo", content: "x" }),
    ).rejects.toThrow("Preload bridge unavailable");
    expect(client.seeded).toHaveLength(0);
  });
});
