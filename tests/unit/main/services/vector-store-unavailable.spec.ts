/**
 * What the app does when the vector store will not load.
 *
 * The extension is the one piece of this feature that depends on the machine
 * rather than on the code: a `vec0.dylib` that is not published for the
 * architecture, is not unpacked out of the asar, or is refused by the loader.
 * Every branch of `vector-store.ts` has to survive that, because the caller is a
 * scan (which must still leave an FTS index behind) and a search (which must
 * still answer).
 *
 * It is mocked here on purpose, and it is mocked *at the module boundary*: the
 * end-to-end suite runs against the real extension and could not arrange this
 * state without breaking the machine it is testing, and the alternative —
 * deleting the `dylib` for the duration of a test — is the kind of thing that
 * passes locally and fails in CI for reasons nobody can see.
 *
 * The last case is the one worth keeping: a failed load must be remembered. The
 * caller on the other side of this is a debounced search box, so "try again on
 * every keystroke" is not a neutral choice — it is a failed `dlopen` per
 * keystroke, forever.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getLoadablePath = vi.fn(() => {
  throw new Error("cannot find module 'sqlite-vec-darwin-x64'");
});

vi.mock("sqlite-vec", () => ({
  getLoadablePath: () => getLoadablePath(),
  load: vi.fn(),
}));

import { closeDb } from "@main/db/client";
import {
  countEmbeddings,
  deleteEmbedding,
  getEmbeddingContentHash,
  resetVectorStoreCache,
  upsertEmbedding,
  vectorSearch,
  vectorStoreStatus,
} from "@main/services/vector-store";

import { isolateDataDir } from "../../../helpers/test-db.js";

let isolate: { dir: string; cleanup(): void };

beforeEach(() => {
  // A real data directory, so the failure under test is the extension rather
  // than a missing database — the status is asserted against the message below.
  isolate = isolateDataDir({ seedSchema: true });
  closeDb();
  resetVectorStoreCache();
  getLoadablePath.mockClear();
});

afterEach(() => {
  closeDb();
  resetVectorStoreCache();
  isolate.cleanup();
});

describe("when the extension cannot be loaded", () => {
  it("says so, with the loader's own message in it", () => {
    const status = vectorStoreStatus();
    expect(status).toMatchObject({ available: false, version: null });
    // The wrapper's message is the one that names the missing package, and it
    // has to survive the fallback search: "the vector store is unavailable" on
    // its own is not something a person can act on, and the difference between
    // a missing per-platform package and a missing resources copy is the whole
    // diagnosis.
    expect(status.reason).toContain("cannot find module 'sqlite-vec-darwin-x64'");
    expect(status.reason).toContain("vec0.dylib");
  });

  it("still answers a search — by reporting no hits rather than throwing", () => {
    expect(vectorSearch(new Array(768).fill(0), 10)).toEqual([]);
  });

  it("reads no content hash, so a scan re-embeds rather than skipping forever", () => {
    expect(getEmbeddingContentHash(1)).toBeNull();
  });

  it("counts nothing", () => {
    expect(countEmbeddings()).toBe(0);
  });

  it("refuses a write, which the write path already swallows", () => {
    expect(() =>
      upsertEmbedding({
        repo_id: 1,
        slug: "demo-web",
        vector: new Array(768).fill(0),
        content_hash: "h",
        updated_at: "2026-10-07T00:00:00.000Z",
      }),
    ).toThrow(/unavailable/);
  });

  it("treats a delete as a no-op", () => {
    expect(() => deleteEmbedding(1)).not.toThrow();
  });

  it("does not retry the load on every call", () => {
    vectorStoreStatus();
    vectorSearch(new Array(768).fill(0), 5);
    getEmbeddingContentHash(1);
    countEmbeddings();
    expect(getLoadablePath).toHaveBeenCalledTimes(1);
  });

  it("retries after a reset, which is how a caller can force a re-check", () => {
    vectorStoreStatus();
    resetVectorStoreCache();
    vectorStoreStatus();
    expect(getLoadablePath).toHaveBeenCalledTimes(2);
  });
});
