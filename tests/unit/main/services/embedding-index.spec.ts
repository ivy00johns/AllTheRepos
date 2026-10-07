/**
 * ATR-018 Unit Test — embedding write-path (`indexRepoEmbedding`) + helpers.
 *
 * Native-free: `./vector-store` (the sqlite-vec-backed store, which needs a
 * native SQLite extension and a migrated database) is mocked and the embedding
 * provider is driven via a stubbed global `fetch`, so this runs under host
 * Node with no Electron ABI and no live Ollama. (We drive the *real* `embed()`
 * through `fetch` rather than spying on the module export, because
 * `indexRepoEmbedding` calls `embed` via its lexical binding — an ESM
 * `vi.spyOn` on the module namespace would not intercept that internal call.)
 *
 * It asserts the contract:
 *   (a) a repo whose README content-hash differs from the stored one triggers
 *       `upsertEmbedding` with the right row shape;
 *   (b) an unchanged content-hash SKIPS the embed + upsert entirely;
 *   (c) `embed()` failing (Ollama DOWN — connection refused) does NOT throw out
 *       of `indexRepoEmbedding` and never calls `upsertEmbedding` — the scan can
 *       still complete and FTS is unaffected.
 *
 * Owner: Lane A.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mocks -----------------------------------------------------------------
// The vector store is the only native dependency of the write-path; mock it
// wholesale so no `.dylib` / Electron ABI is touched.
//
// Both functions are SYNCHRONOUS in the module under test. A promise-returning
// mock would quietly invert two of the cases below: the content-hash gate
// compares `prior === contentHash`, which no promise ever equals, so
// "skips when unchanged" would re-embed and still look green.
const upsertEmbedding = vi.fn<(row: unknown) => void>();
const getEmbeddingContentHash = vi.fn<(repoId: number) => string | null>();

vi.mock("@main/services/vector-store", () => ({
  upsertEmbedding: (row: unknown) => upsertEmbedding(row),
  getEmbeddingContentHash: (repoId: number) => getEmbeddingContentHash(repoId),
}));

// `getSettings` is read by `embed` to pick the Ollama base URL / model. Stub it
// so nothing reaches electron-store.
vi.mock("@main/services/settings", () => ({
  getSettings: () => ({
    scanPaths: [],
    ollamaBaseUrl: "http://localhost:11434",
    ollamaEmbedModel: "nomic-embed-text",
    openaiEmbedModel: null,
    defaultEditor: "none",
    schemaVersion: 1,
  }),
}));

import {
  buildEmbeddingText,
  readmeContentHash,
  embeddingContentHash,
  indexRepoEmbedding,
} from "@main/services/embedding";

const sampleRepo = {
  repoId: 42,
  slug: "acme-tool",
  name: "Acme Tool",
  description: "A handy tool",
  readmeContent: "# Acme Tool\n\nDoes acme things.",
};

const VECTOR = new Array(768).fill(0.1);

/** A fetch stub that returns a successful Ollama embeddings response. */
function fetchReturnsVector() {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ embedding: VECTOR }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

/** A fetch stub that simulates Ollama being DOWN (connection refused). */
function fetchConnectionRefused() {
  return vi.fn(async () => {
    throw new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:11434");
  });
}

describe("buildEmbeddingText", () => {
  it("joins name + description + readme with blank lines, trimmed", () => {
    expect(
      buildEmbeddingText({
        name: "  Acme  ",
        description: "desc",
        readmeContent: "readme body",
      }),
    ).toBe("Acme\n\ndesc\n\nreadme body");
  });

  it("drops empty/null fields", () => {
    expect(
      buildEmbeddingText({
        name: "Acme",
        description: null,
        readmeContent: null,
      }),
    ).toBe("Acme");
    expect(
      buildEmbeddingText({
        name: "Acme",
        description: "",
        readmeContent: "  ",
      }),
    ).toBe("Acme");
  });
});

describe("readmeContentHash", () => {
  it("hashes the readme; null and empty string collapse to the same hash", () => {
    expect(readmeContentHash(null)).toBe(readmeContentHash(""));
  });

  it("changes when the readme content changes", () => {
    expect(readmeContentHash("a")).not.toBe(readmeContentHash("b"));
  });

  it("is the sha256 of the readme (matches metadata.ts convention)", () => {
    // sha256("") — the canonical empty-string digest.
    expect(readmeContentHash(null)).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("embeddingContentHash", () => {
  it("is the sha256 of the full embedding text (name + description + readme)", () => {
    expect(embeddingContentHash(sampleRepo)).toBe(
      readmeContentHash(buildEmbeddingText(sampleRepo)),
    );
  });

  it("changes when the name OR description changes — not just the readme", () => {
    const base = embeddingContentHash(sampleRepo);
    expect(embeddingContentHash({ ...sampleRepo, name: "Renamed" })).not.toBe(
      base,
    );
    expect(
      embeddingContentHash({ ...sampleRepo, description: "new desc" }),
    ).not.toBe(base);
    expect(
      embeddingContentHash({ ...sampleRepo, readmeContent: "new readme" }),
    ).not.toBe(base);
  });
});

describe("indexRepoEmbedding", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    upsertEmbedding.mockReset().mockReturnValue(undefined);
    getEmbeddingContentHash.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("(a) embeds + upserts with the right shape when the readme hash changed", async () => {
    getEmbeddingContentHash.mockReturnValue(null); // no prior embedding
    const fetchSpy = fetchReturnsVector();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const outcome = await indexRepoEmbedding(sampleRepo);

    expect(outcome).toBe("embedded");
    // The embedding text (name + description + readme) was sent to Ollama.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    ) as { prompt: string };
    expect(body.prompt).toBe(buildEmbeddingText(sampleRepo));

    expect(upsertEmbedding).toHaveBeenCalledTimes(1);
    const row = upsertEmbedding.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      repo_id: 42,
      slug: "acme-tool",
      content_hash: embeddingContentHash(sampleRepo),
    });
    expect(Array.isArray(row.vector)).toBe(true);
    expect((row.vector as number[]).length).toBe(768);
    expect(typeof row.updated_at).toBe("string");
  });

  it("(a') re-embeds when a stored hash exists but differs", async () => {
    getEmbeddingContentHash.mockReturnValue("stale-hash-from-old-readme");
    globalThis.fetch = fetchReturnsVector() as unknown as typeof fetch;

    const outcome = await indexRepoEmbedding(sampleRepo);

    expect(outcome).toBe("embedded");
    expect(upsertEmbedding).toHaveBeenCalledTimes(1);
  });

  it("(b) skips embed + upsert when the stored hash is unchanged", async () => {
    getEmbeddingContentHash.mockReturnValue(embeddingContentHash(sampleRepo));
    const fetchSpy = fetchReturnsVector();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const outcome = await indexRepoEmbedding(sampleRepo);

    expect(outcome).toBe("skipped-unchanged");
    expect(fetchSpy).not.toHaveBeenCalled(); // never even hit the embed provider
    expect(upsertEmbedding).not.toHaveBeenCalled();
  });

  it("(c) does NOT throw and does NOT upsert when embed() fails (Ollama DOWN)", async () => {
    getEmbeddingContentHash.mockReturnValue(null);
    globalThis.fetch = fetchConnectionRefused() as unknown as typeof fetch;

    // Must resolve, not reject — the scan cannot be blocked/failed by this.
    const outcome = await indexRepoEmbedding(sampleRepo);

    expect(outcome).toBe("skipped-unavailable");
    expect(upsertEmbedding).not.toHaveBeenCalled();
  });

  it("still attempts a (re)embed when the content-hash gate read fails", async () => {
    // A failed gate read must be treated as 'not embedded', i.e. it must NOT
    // cause a silent skip — it falls through to embed + upsert.
    getEmbeddingContentHash.mockImplementation(() => {
      throw new Error("vector store read failed");
    });
    globalThis.fetch = fetchReturnsVector() as unknown as typeof fetch;

    const outcome = await indexRepoEmbedding(sampleRepo);

    expect(outcome).toBe("embedded");
    expect(upsertEmbedding).toHaveBeenCalledTimes(1);
  });

  it("returns 'skipped-unavailable' (and does not throw) when upsert fails", async () => {
    getEmbeddingContentHash.mockReturnValue(null);
    globalThis.fetch = fetchReturnsVector() as unknown as typeof fetch;
    upsertEmbedding.mockImplementation(() => {
      throw new Error("vector store write failed");
    });

    await expect(indexRepoEmbedding(sampleRepo)).resolves.toBe(
      "skipped-unavailable",
    );
  });
});
