/**
 * `hybridSearch` reports which halves of the pipeline produced its results.
 *
 * This is the field the catalog renders as a notice, and it exists because the
 * previous behaviour was indistinguishable from success: with no vector store or
 * no embedding provider, search returned a *smaller, differently ranked* result
 * set with `matchKind: "fts"` and nothing anywhere said why. A user could not
 * tell a misconfigured Ollama URL from a machine that was simply offline, and
 * neither could a developer reading a green test run.
 *
 * So the four outcomes are pinned here, each with the thing that distinguishes it
 * from the others:
 *
 *   - no vector store           → `reason: "no-embedding-provider"` must NOT fire,
 *                                 and the provider must not be called at all;
 *   - no provider               → the store was available and the call was made;
 *   - the caller asked for FTS  → `reason: "requested"`, which is a choice, and
 *                                 the one case a UI should stay quiet about;
 *   - both halves ran           → `{ state: "vectors" }`, and the merge really
 *                                 merged (a slug seen by both carries both RRF
 *                                 terms, which is what `matchKind: "hybrid"` means).
 *
 * `mode` is honoured as well: it used to be accepted and dropped, so a caller
 * asking for keyword-only search silently got the vector path too.
 *
 * !!! REAL better-sqlite3 DB !!! Needs host-ABI natives. The vector store is
 * mocked (this is about the search service's decisions), but the FTS half is the
 * real FTS5 index in a real database, because "the keywords still work" is half
 * of what is being asserted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const vectorStoreStatus = vi.fn();
const vectorSearch = vi.fn<
  (vec: number[], limit: number) => Array<{ slug: string; score: number }>
>(() => []);

vi.mock("@main/services/vector-store", () => ({
  vectorStoreStatus: () => vectorStoreStatus(),
  vectorSearch: (vec: number[], limit: number) => vectorSearch(vec, limit),
  getEmbeddingContentHash: () => null,
  upsertEmbedding: vi.fn(),
  deleteEmbedding: vi.fn(),
  countEmbeddings: () => 0,
  resetVectorStoreCache: vi.fn(),
}));

// `embed()` is the only thing stubbed out of the embedding service: the real
// `EmbedUnavailableError` has to survive, because `search.ts` branches on
// `instanceof` and a mock that replaced the class would make every provider
// failure look like an unknown one.
vi.mock("@main/services/settings", () => ({
  getSettings: () => ({
    ollamaBaseUrl: "http://127.0.0.1:1",
    ollamaEmbedModel: "nomic-embed-text",
    openaiEmbedModel: null,
  }),
}));

vi.mock("@main/services/embedding", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@main/services/embedding")>();
  return { ...actual, embed: vi.fn() };
});

import { getSqlite, closeDb } from "@main/db/client";
import { embed, EmbedUnavailableError } from "@main/services/embedding";
import { hybridSearch } from "@main/services/search";

import { isolateDataDir } from "../../../helpers/test-db.js";

let isolate: { dir: string; cleanup(): void };

/**
 * Two repos, and the difference between them is the point.
 *
 * `demo-web` is findable by the keyword `demo` (its name and description carry
 * it). `demo-cli` is not: `slug` is `UNINDEXED` in the FTS5 table, so a vector
 * hit for a repo the keyword search never saw is exactly how a vector-only
 * result is arranged. Both are in the catalog, because a slug the catalog does
 * not know is dropped before it can become a hit — which is also worth knowing
 * before writing an expectation like this one.
 */
function seedRepo(): void {
  const insert = getSqlite().prepare(
    "INSERT INTO repos (slug, name, full_path, description, primary_language) " +
      "VALUES (?, ?, ?, ?, ?)",
  );
  insert.run(
    "demo-web",
    "Demo Web",
    "/repos/demo-web",
    "a web thing",
    "TypeScript",
  );
  insert.run(
    "demo-cli",
    "CLI Tool",
    "/repos/demo-cli",
    "command line utilities",
    "Rust",
  );
}

beforeEach(() => {
  isolate = isolateDataDir({ seedSchema: true });
  closeDb();
  seedRepo();
  vectorStoreStatus.mockReset().mockReturnValue({
    available: true,
    version: "v0.1.9",
    reason: null,
  });
  vectorSearch.mockReset().mockReturnValue([]);
  vi.mocked(embed).mockReset().mockResolvedValue(new Array(768).fill(0.1));
});

afterEach(() => {
  closeDb();
  isolate.cleanup();
});

describe("with no vector store at all", () => {
  beforeEach(() => {
    vectorStoreStatus.mockReturnValue({
      available: false,
      version: null,
      reason: "cannot find module 'sqlite-vec-darwin-x64'",
    });
  });

  it("answers with keywords and names the store as the reason", async () => {
    const result = await hybridSearch({ query: "demo" });

    expect(result.hits.map((hit) => hit.repo.slug)).toEqual(["demo-web"]);
    expect(result.hits[0].matchKind).toBe("fts");
    expect(result.semantic).toEqual({
      state: "off",
      reason: "no-vector-store",
      detail: "cannot find module 'sqlite-vec-darwin-x64'",
    });
  });

  it("does not ask the provider for anything", async () => {
    await hybridSearch({ query: "demo" });
    expect(embed).not.toHaveBeenCalled();
  });
});

describe("with a vector store but no embedding provider", () => {
  beforeEach(() => {
    vi.mocked(embed).mockRejectedValue(
      new EmbedUnavailableError("Ollama unreachable at http://127.0.0.1:1"),
    );
  });

  it("says the provider is the reason, not the store", async () => {
    const result = await hybridSearch({ query: "demo" });

    expect(result.hits.map((hit) => hit.repo.slug)).toEqual(["demo-web"]);
    expect(result.semantic).toEqual({
      state: "off",
      reason: "no-embedding-provider",
      detail: "Ollama unreachable at http://127.0.0.1:1",
    });
  });
});

describe("when the caller asks for keywords only", () => {
  it("reports a choice rather than a failure, and skips the vector path", async () => {
    const result = await hybridSearch({ query: "demo" }, "fts");

    expect(result.hits.map((hit) => hit.repo.slug)).toEqual(["demo-web"]);
    expect(result.semantic).toEqual({
      state: "off",
      reason: "requested",
      detail: null,
    });
    expect(embed).not.toHaveBeenCalled();
    expect(vectorSearch).not.toHaveBeenCalled();
  });
});

describe("when both halves run", () => {
  it("reports the vector store as consulted", async () => {
    const result = await hybridSearch({ query: "demo" });

    expect(result.semantic).toEqual({ state: "vectors" });
    expect(embed).toHaveBeenCalledWith("demo");
    expect(vectorSearch).toHaveBeenCalled();
  });

  it("merges a slug both halves found, and keeps a vector-only slug", async () => {
    vectorSearch.mockReturnValue([
      { slug: "demo-web", score: 1 },
      { slug: "demo-cli", score: 0.5 },
    ]);
    const result = await hybridSearch({ query: "demo" });

    const bySlug = new Map(result.hits.map((hit) => [hit.repo.slug, hit]));
    // Seen by FTS and by the vector store: two RRF terms, `hybrid`.
    expect(bySlug.get("demo-web")?.matchKind).toBe("hybrid");
    // Only the store found it, but it has to be in the result at all — a merge
    // that dropped the vector side is the failure this whole feature is one
    // `catch` away from.
    expect(bySlug.get("demo-cli")?.matchKind).toBe("vector");
    expect(bySlug.get("demo-web")!.score).toBeGreaterThan(
      bySlug.get("demo-cli")!.score,
    );
  });

  it("still reports the vector store as consulted when no vector matched", async () => {
    vectorSearch.mockReturnValue([]);
    const result = await hybridSearch({ query: "demo" });

    // "usable" is not "used": an empty store is a working store, and a UI that
    // cried "semantic search is off" for every query on a fresh catalog would be
    // wrong about the machine.
    expect(result.semantic).toEqual({ state: "vectors" });
    expect(result.hits.map((hit) => hit.repo.slug)).toEqual(["demo-web"]);
  });

  it("returns vector-only results for `mode: \"vector\"`", async () => {
    vectorSearch.mockReturnValue([{ slug: "demo-web", score: 1 }]);
    const result = await hybridSearch({ query: "nothing-matches-this" }, "vector");

    expect(result.hits.map((hit) => hit.repo.slug)).toEqual(["demo-web"]);
    expect(result.hits[0].matchKind).toBe("vector");
    expect(result.semantic).toEqual({ state: "vectors" });
  });

  it("says what it tried when neither half found anything", async () => {
    const result = await hybridSearch({ query: "no-such-repo" });
    expect(result.hits).toEqual([]);
    expect(result.semantic).toEqual({ state: "vectors" });
  });
});
