/**
 * The extension loads in a *packaged* layout — hermetically.
 *
 * A packaged build has the wrapper and not its library, because
 * electron-builder collects `dependencies` and the per-platform package is an
 * `optionalDependency`. So `sqlite-vec`'s own `getLoadablePath()` throws there,
 * and `services/vector-store.ts` falls back to `<resources>/vec0.<ext>` — the
 * place `scripts/pack-vector-extension.mjs` writes at build time.
 *
 * That fallback is the difference between a shipped app with semantic search and
 * one that quietly answers with keywords, and it is invisible to every test that
 * runs out of `node_modules` (which is all of them, including the Electron E2E
 * suite). So it is arranged here instead: the wrapper is mocked out of the way
 * exactly as packaging removes it, and the *real* `vec0.dylib` is copied into a
 * fake resources directory and loaded from there.
 *
 * `process.resourcesPath` is what Electron sets and plain Node does not, which
 * is why the fallback is guarded rather than assumed — the same guard that lets
 * this spec run under vitest.
 *
 * !!! REAL better-sqlite3 DB and REAL vec0 binary !!! Needs host-ABI natives.
 */

import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The wrapper is present but useless, which is what packaging produces. The rest
// of the module is kept so the spec can ask it for the *real* library path.
vi.mock("sqlite-vec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sqlite-vec")>();
  return {
    ...actual,
    getLoadablePath: () => {
      throw new Error(
        "Cannot find module 'sqlite-vec-darwin-arm64/vec0.dylib'",
      );
    },
    load: vi.fn(),
  };
});

import { closeDb } from "@main/db/client";
import {
  countEmbeddings,
  extensionCandidates,
  resetVectorStoreCache,
  upsertEmbedding,
  vectorSearch,
  vectorStoreStatus,
} from "@main/services/vector-store";

import { cleanupTmp, makeTmpDir } from "../../../helpers/tmp-dir";
import { isolateDataDir } from "../../../helpers/test-db.js";

let isolate: { dir: string; cleanup(): void };
let resourcesDir: string | null = null;
const previousResourcesPath = (process as { resourcesPath?: string }).resourcesPath;

/** The library file this platform ships, as the wrapper names it. */
function extensionFileName(): string {
  return process.platform === "win32"
    ? "vec0.dll"
    : process.platform === "darwin"
      ? "vec0.dylib"
      : "vec0.so";
}

beforeEach(() => {
  isolate = isolateDataDir({ seedSchema: true });
  closeDb();
  resetVectorStoreCache();
});

afterEach(() => {
  closeDb();
  resetVectorStoreCache();
  isolate.cleanup();
  cleanupTmp(resourcesDir);
  resourcesDir = null;
  if (previousResourcesPath === undefined) {
    delete (process as { resourcesPath?: string }).resourcesPath;
  } else {
    (process as { resourcesPath?: string }).resourcesPath = previousResourcesPath;
  }
});

describe("with the wrapper's own resolution broken, as packaging leaves it", () => {
  it("names the resources directory as the place to look", async () => {
    resourcesDir = makeTmpDir("atr-packaged-resources");
    (process as { resourcesPath?: string }).resourcesPath = resourcesDir;

    expect(extensionCandidates().at(-1)).toBe(
      path.join(resourcesDir, extensionFileName()),
    );
  });

  it("tries it before giving up, and the candidates are what the build writes", () => {
    // No `resourcesPath` at all (plain Node) and no wrapper answer: the list is
    // empty and the store reports why, rather than silently answering searches
    // with keywords and calling it a day.
    expect(extensionCandidates()).toEqual([]);
    expect(vectorStoreStatus()).toMatchObject({ available: false, version: null });
    expect(vectorStoreStatus().reason).toMatch(/vec0\./);
  });

  it("loads from the resources directory and answers a real query", async () => {
    const actual = await vi.importActual<typeof import("sqlite-vec")>("sqlite-vec");
    const realLibrary = actual.getLoadablePath();

    resourcesDir = makeTmpDir("atr-packaged-resources");
    const bundled = path.join(resourcesDir, extensionFileName());
    fs.copyFileSync(realLibrary, bundled);
    (process as { resourcesPath?: string }).resourcesPath = resourcesDir;

    // The store that was unavailable a moment ago is now the packaged app's:
    // found in resources, loaded, and queried.
    resetVectorStoreCache();
    expect(vectorStoreStatus()).toMatchObject({ available: true, reason: null });

    const at = new Array(768).fill(0);
    at[0] = 1;
    upsertEmbedding({
      repo_id: 3,
      slug: "demo-web",
      vector: at,
      content_hash: "h",
      updated_at: "2026-10-07T00:00:00.000Z",
    });
    expect(countEmbeddings()).toBe(1);
    expect(vectorSearch(at, 1).map((hit) => hit.slug)).toEqual(["demo-web"]);
  });
});
