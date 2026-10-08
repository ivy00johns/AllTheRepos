/**
 * The vector store against a real database and the real `sqlite-vec` binary —
 * every assertion here is an actual `vec0` query, not a mock's opinion.
 *
 * This is the layer LanceDB never had a test at. The old wrapper was mocked
 * wherever it was used (`embedding-index.spec.ts`, `catalog-delete.spec.ts`),
 * which was the right call for testing *callers* and left the store itself —
 * the schema, the upsert, the KNN, the content-hash read — unverified by
 * anything. A store that silently stopped storing would have passed the whole
 * suite; `tests/e2e/semantic-search.spec.ts` is the end-to-end answer to that,
 * and this is the fast, precise one.
 *
 * The three things worth pinning, because each is a way the store can be wrong
 * while looking right:
 *
 *   - the content-hash read is what the *write* path gates on, so a store that
 *     reads back `null` forever means every scan re-embeds every repo, and one
 *     that reads back the wrong value means a changed README never re-embeds;
 *   - `vec0` has no upsert — a second write for the same repo must replace the
 *     row rather than throw or duplicate it;
 *   - `vec0` enforces the declared width, and the write must fail *before* the
 *     existing row is lost. Both halves of that are asserted below.
 *
 * !!! REAL better-sqlite3 DB !!! Needs host-ABI natives.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb } from "@main/db/client";
import {
  countEmbeddings,
  deleteEmbedding,
  EMBEDDING_DIM,
  getEmbeddingContentHash,
  resetVectorStoreCache,
  upsertEmbedding,
  vectorSearch,
  vectorStoreStatus,
} from "@main/services/vector-store";

import { isolateDataDir } from "../../../helpers/test-db.js";

/** A one-hot unit vector: index `i` set, everything else zero. */
function oneHot(i: number, width = EMBEDDING_DIM): number[] {
  const v = new Array<number>(width).fill(0);
  v[i] = 1;
  return v;
}

let isolate: { dir: string; cleanup(): void };

beforeEach(() => {
  isolate = isolateDataDir({ seedSchema: true });
  // Both caches key off the data directory: the SQLite handle, and the vector
  // store's memoised "did the extension load" verdict.
  closeDb();
  resetVectorStoreCache();
});

afterEach(() => {
  closeDb();
  resetVectorStoreCache();
  isolate.cleanup();
});

describe("the store loads", () => {
  it("reports the extension's own version, on this machine", () => {
    const status = vectorStoreStatus();
    expect(
      status,
      `the sqlite-vec extension did not load: ${status.reason}. Run ` +
        "`pnpm rebuild better-sqlite3 find-git-repositories` if the natives " +
        "are on the other ABI — this spec needs host-ABI natives.",
    ).toMatchObject({ available: true, reason: null });
    expect(status.version).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it("starts empty", () => {
    expect(countEmbeddings()).toBe(0);
  });
});

describe("writing and reading one embedding", () => {
  const row = {
    repo_id: 7,
    slug: "demo-web",
    vector: oneHot(0),
    content_hash: "hash-one",
    updated_at: "2026-10-07T00:00:00.000Z",
  };

  it("reads back the content hash the write path gates on", () => {
    expect(getEmbeddingContentHash(7)).toBeNull();
    upsertEmbedding(row);
    expect(getEmbeddingContentHash(7)).toBe("hash-one");
    expect(countEmbeddings()).toBe(1);
  });

  it("replaces rather than duplicating when the same repo is embedded again", () => {
    // `vec0` has no upsert: the second write for one repo used to be a UNIQUE
    // constraint violation, which the wrapper answers with delete-then-insert.
    // If that ever regressed to a plain insert this would throw, and if it
    // regressed to an insert-after-failed-delete it would be two rows.
    upsertEmbedding(row);
    upsertEmbedding({ ...row, vector: oneHot(1), content_hash: "hash-two" });

    expect(countEmbeddings()).toBe(1);
    expect(getEmbeddingContentHash(7)).toBe("hash-two");
  });

  it("returns nearest neighbours with the nearest first, and a 1.0 score for an exact match", () => {
    upsertEmbedding(row);
    upsertEmbedding({ ...row, repo_id: 8, slug: "demo-cli", vector: oneHot(1) });

    const hits = vectorSearch(oneHot(0), 10);
    expect(hits.map((h) => h.slug)).toEqual(["demo-web", "demo-cli"]);
    // Distance 0 for the vector itself → 1 / (1 + 0). The score is the store's
    // own distance put through a monotonic map, which is all the RRF merge
    // needs: the *order* is what the store decided.
    expect(hits[0].score).toBe(1);
    expect(hits[1].score).toBeLessThan(1);
  });

  it("honours the candidate limit", () => {
    upsertEmbedding(row);
    upsertEmbedding({ ...row, repo_id: 8, slug: "demo-cli", vector: oneHot(1) });
    expect(vectorSearch(oneHot(0), 1)).toHaveLength(1);
  });

  it("drops a repo's vector on delete", () => {
    upsertEmbedding(row);
    deleteEmbedding(7);
    expect(getEmbeddingContentHash(7)).toBeNull();
    expect(countEmbeddings()).toBe(0);
  });

  it("accepts a delete for a repo that has no vector", () => {
    expect(() => deleteEmbedding(999)).not.toThrow();
  });
});

describe("the width is enforced, and a bad write cannot destroy a good row", () => {
  it("rejects a vector that is not 768 wide", () => {
    expect(() =>
      upsertEmbedding({
        repo_id: 1,
        slug: "wrong-width",
        vector: oneHot(0, 3),
        content_hash: "h",
        updated_at: "2026-10-07T00:00:00.000Z",
      }),
    ).toThrow(/768/);
  });

  it("keeps the previous vector when the new one is the wrong width", () => {
    // The upsert is delete-then-insert, so this is the failure mode that
    // matters: an unguarded insert would have removed the old row and left
    // nothing behind — a repo that silently fell out of semantic search on the
    // next scan. The two statements are in one transaction for exactly this.
    upsertEmbedding({
      repo_id: 1,
      slug: "demo-web",
      vector: oneHot(0),
      content_hash: "good",
      updated_at: "2026-10-07T00:00:00.000Z",
    });

    expect(() =>
      upsertEmbedding({
        repo_id: 1,
        slug: "demo-web",
        vector: oneHot(0, 3),
        content_hash: "bad",
        updated_at: "2026-10-07T00:00:00.000Z",
      }),
    ).toThrow();

    expect(getEmbeddingContentHash(1)).toBe("good");
    expect(countEmbeddings()).toBe(1);
  });

  it("returns no hits for a query vector of the wrong width, rather than throwing", () => {
    upsertEmbedding({
      repo_id: 1,
      slug: "demo-web",
      vector: oneHot(0),
      content_hash: "h",
      updated_at: "2026-10-07T00:00:00.000Z",
    });
    expect(vectorSearch(oneHot(0, 3), 10)).toEqual([]);
  });
});
