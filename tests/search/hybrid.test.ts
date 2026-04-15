import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isolateDataDir } from "../helpers/test-db.js";
import { seedRepo } from "../helpers/seed.js";
import type { SearchHit } from "@/contracts/types";

/**
 * Hybrid FTS + vector search. Backend wires:
 *   - lib/embed/client.ts  → embed(text)
 *   - lib/search/lance.ts  → vectorSearch(vec, limit)
 *   - lib/search/query.ts  → hybridSearch(q)
 *
 * We mock the two boundary modules so tests are fully offline.
 */

type HybridModule = {
  hybridSearch: (q: {
    query: string;
    filters?: unknown;
    limit?: number;
  }) => Promise<SearchHit[]>;
};

async function loadHybrid(): Promise<HybridModule> {
  return (await import("@/lib/search/query")) as unknown as HybridModule;
}

describe("search/hybrid — contracts/api.md hybridSearch()", () => {
  let isolate: { dir: string; cleanup(): void } | null = null;

  beforeEach(async () => {
    vi.resetModules();
    isolate = isolateDataDir();
    const { getDb } = await import("@/lib/db/client");
    getDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("@/lib/embed/client");
    vi.doUnmock("@/lib/search/lance");
    isolate?.cleanup();
    isolate = null;
  });

  it("FTS-only path works when embed throws (EMBED_UNAVAILABLE)", async () => {
    class EmbedUnavailableError extends Error {}
    vi.doMock("@/lib/embed/client", () => ({
      embed: vi.fn().mockRejectedValue(new EmbedUnavailableError("ollama down")),
      EmbedUnavailableError,
    }));
    vi.doMock("@/lib/search/lance", () => ({
      vectorSearch: vi.fn().mockResolvedValue([]),
    }));

    const { getSqlite } = await import("@/lib/db/client");
    const sqlite = getSqlite();
    seedRepo(sqlite, {
      name: "react-app",
      fullPath: "/tmp/r1",
      description: "react dashboard",
    });

    const { hybridSearch } = await loadHybrid();
    const hits = await hybridSearch({ query: "react" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.repo.name === "react-app")).toBe(true);
  });

  it("vector-only path surfaces hits when FTS is empty", async () => {
    const slugOnly = "vectoronly-12345678";
    class EmbedUnavailableError extends Error {}
    vi.doMock("@/lib/embed/client", () => ({
      embed: vi.fn().mockResolvedValue(new Array(768).fill(0.01)),
      EmbedUnavailableError,
    }));
    vi.doMock("@/lib/search/lance", () => ({
      vectorSearch: vi
        .fn()
        .mockResolvedValue([{ slug: slugOnly, score: 0.9 }]),
    }));

    const { getSqlite } = await import("@/lib/db/client");
    const sqlite = getSqlite();
    seedRepo(sqlite, {
      slug: slugOnly,
      name: "vectoronly",
      fullPath: "/tmp/vectoronly",
      description: "irrelevant soup",
    });

    const { hybridSearch } = await loadHybrid();
    const hits = await hybridSearch({
      query: "some-totally-unrelated-string-zzxxxyyy",
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.repo.slug === slugOnly)).toBe(true);
  });

  it("hybrid ranking — repo present in both FTS and vector is ranked at top", async () => {
    const bothSlug = "react-both-11111111";
    const vectorOnly = "vector-only-22222222";
    const ftsOnly = "fts-only-33333333";
    class EmbedUnavailableError extends Error {}
    vi.doMock("@/lib/embed/client", () => ({
      embed: vi.fn().mockResolvedValue(new Array(768).fill(0.02)),
      EmbedUnavailableError,
    }));
    vi.doMock("@/lib/search/lance", () => ({
      vectorSearch: vi.fn().mockResolvedValue([
        { slug: bothSlug, score: 0.8 },
        { slug: vectorOnly, score: 0.7 },
      ]),
    }));

    const { getSqlite } = await import("@/lib/db/client");
    const sqlite = getSqlite();
    seedRepo(sqlite, {
      slug: bothSlug,
      name: "react-both",
      fullPath: "/tmp/both",
      description: "react app",
    });
    seedRepo(sqlite, {
      slug: vectorOnly,
      name: "vonly",
      fullPath: "/tmp/vonly",
      description: "no keyword match",
    });
    seedRepo(sqlite, {
      slug: ftsOnly,
      name: "react-fts",
      fullPath: "/tmp/fts",
      description: "react sibling",
    });

    const { hybridSearch } = await loadHybrid();
    const hits = await hybridSearch({ query: "react" });
    const idxBoth = hits.findIndex((h) => h.repo.slug === bothSlug);
    expect(idxBoth).toBeGreaterThanOrEqual(0);
    for (const h of hits) {
      if (h.repo.slug === bothSlug) continue;
      expect.soft(h.score).toBeLessThanOrEqual(hits[idxBoth].score);
    }
  });
});
