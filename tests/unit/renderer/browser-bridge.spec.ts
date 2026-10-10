/**
 * Unit test for the browser bridge's install guard.
 *
 * `src/renderer/lib/browser-bridge.ts` pulls in the demo library and the
 * language palette, both plain modules with no DOM or Electron dependency, so
 * unlike most renderer modules it loads under vitest's `environment: "node"`
 * and a fake `window` is all it needs. The demo data itself is checked in
 * `demo-library.spec.ts`; this file is about the guard.
 *
 * What matters here is the guard, not the demo data: the bridge must install
 * ONLY when no preload bridge is present. Electron always mounts the real one,
 * so a mistake in this check would have the app answer from demo data while
 * claiming to read the user's disk.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { PingResponseSchema, SyncResultSchema } from "@shared/schemas";

import { installBrowserBridge } from "@renderer/lib/browser-bridge";

const globals = globalThis as { window?: { atr?: unknown } };

interface DemoBridge {
  catalog: { list(input: { limit?: number }): Promise<{ total: number }> };
  scan: { start(input: unknown): Promise<unknown> };
  system: { ping(input: unknown): Promise<unknown> };
}

/** The parts of the bridge the persistence test drives, widened past `total`. */
interface WritableBridge {
  catalog: {
    list(input: { limit?: number }): Promise<{ items: Array<{ slug: string; isFavorite: boolean }> }>;
    setFavorite(input: { slug: string; favorite: boolean }): Promise<unknown>;
  };
}

afterEach(() => {
  delete globals.window;
  vi.unstubAllGlobals();
});

describe("installBrowserBridge", () => {
  it("installs a demo bridge when no preload bridge is present", async () => {
    globals.window = {};

    expect(installBrowserBridge()).toBe(true);
    const bridge = globals.window.atr as DemoBridge;
    expect(bridge).toBeTruthy();

    // Reads come from the demo catalog, so the UI has something to render.
    const list = await bridge.catalog.list({ limit: 10 });
    expect(list.total).toBeGreaterThan(0);

    // Writes are refused with a reason rather than quietly pretended. A scan
    // has no result shape that can say "not started" (`StartScanResult` is
    // `{ jobId, status: "running", startedAt }`), so it refuses by throwing —
    // the reason travels as the error message instead of a made-up result.
    await expect(bridge.scan.start({})).rejects.toThrow(/browser bridge/i);
  });

  it("answers the debug route's ping with the fields that route renders", async () => {
    globals.window = {};
    installBrowserBridge();
    const bridge = globals.window.atr as DemoBridge;

    // `/debug` prints `pong`, `mainProcessPid` and `receivedAt`; a bridge that
    // answers with a bare `{ ok: true }` leaves three blank rows on screen.
    const ping = await bridge.system.ping({ nonce: "test" });
    expect(PingResponseSchema.safeParse(ping).success).toBe(true);
  });

  it("answers a git sync with a SyncResult the caller can actually walk", async () => {
    globals.window = {};
    installBrowserBridge();
    const bridge = globals.window.atr as unknown as {
      git: { fetch(input: { slugs: string[] }): Promise<unknown> };
    };

    // The toolbar's notice counts `result.entries`, so the shape is the contract.
    // `{ results: [] }` walked `undefined` and left "Fetching 5…" on screen after
    // an uncaught rejection, because the failure never reached the strip.
    const result = await bridge.git.fetch({ slugs: ["a", "b"] });
    expect(SyncResultSchema.safeParse(result).success).toBe(true);
    expect((result as { entries: unknown[] }).entries).toHaveLength(2);

    // A tab cannot reach a remote, so nothing may claim it did.
    const parsed = SyncResultSchema.parse(result);
    expect(parsed.updated).toBe(0);
    expect(parsed.entries.every((entry) => entry.outcome === "failed")).toBe(true);
    expect(parsed.entries.every((entry) => entry.message !== null)).toBe(true);
  });

  /**
   * The saved view a reviewer leaves behind by filtering the catalog to nothing:
   * `favoritesOnly` from the rail, the workspace filter, and a search.
   */
  const seedSavedView = () =>
    new Map<string, string>([
      ["atr:catalog-view:v1", JSON.stringify({ state: { favoritesOnly: true }, version: 1 })],
      ["atr:ui:v1", JSON.stringify({ state: { activeFilter: { q: "zzz" } }, version: 1 })],
    ]);

  /** A `localStorage` stand-in, so the writes below land somewhere readable. */
  const stubStorage = (saved: Map<string, string>) =>
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      },
      removeItem: (key: string) => {
        saved.delete(key);
      },
    });

  /*
   * The view stores are imported *after* the stubs and after
   * `vi.resetModules()`, because each captures `localStorage` as it is created —
   * the pinned-fixture pattern `browser-bridge-contract.spec.ts` uses, and for
   * the same reason: this suite runs every file in one process, so a module
   * singleton and a stubbed global are shared with whichever file ran first.
   */
  it("forgets the saved catalog view on ?reset-edits, not only the edits", async () => {
    const saved = seedSavedView();
    stubStorage(saved);
    vi.stubGlobal("location", { search: "?reset-edits=1" });
    vi.resetModules();
    const { installBrowserBridge: install } = await import("@renderer/lib/browser-bridge");
    const { PERSIST_KEY: catalogViewKey, useCatalogView } = await import(
      "@renderer/stores/catalog-view"
    );
    const { PERSIST_KEY: uiKey, useUiStore } = await import("@renderer/stores/ui");
    globals.window = {};

    // The open tab's own state first: these stores hydrate while `stores/*` is
    // imported, so by the time the bridge installs, removing the key is too late
    // for the filters already in memory — which is why both halves are asserted.
    expect(useCatalogView.getState().favoritesOnly).toBe(true);
    expect(useUiStore.getState().activeFilter.q).toBe("zzz");

    expect(install()).toBe(true);

    expect(saved.has(catalogViewKey)).toBe(false);
    expect(saved.has(uiKey)).toBe(false);
    expect(useCatalogView.getState().favoritesOnly).toBe(false);
    expect(useCatalogView.getState().ownershipFilter).toEqual([]);
    expect(useUiStore.getState().activeFilter.q).toBe("");
  });

  it("leaves the saved view alone when the URL does not ask for a reset", async () => {
    const saved = seedSavedView();
    stubStorage(saved);
    vi.stubGlobal("location", { search: "" });
    vi.resetModules();
    const { installBrowserBridge: install } = await import("@renderer/lib/browser-bridge");
    const { useCatalogView } = await import("@renderer/stores/catalog-view");
    globals.window = {};

    expect(install()).toBe(true);

    // Reset is a thing a URL asks for; it is not what everyone gets.
    expect(useCatalogView.getState().favoritesOnly).toBe(true);
    expect(saved.has("atr:catalog-view:v1")).toBe(true);
  });

  it("leaves a real preload bridge untouched", () => {
    const real = { catalog: { list: () => undefined } };
    globals.window = { atr: real };

    expect(installBrowserBridge()).toBe(false);
    expect(globals.window.atr).toBe(real);
  });

  it("does nothing with no window at all", () => {
    delete globals.window;
    expect(installBrowserBridge()).toBe(false);
  });

  it("keeps a catalog write in localStorage, so it survives a reload", async () => {
    const saved = new Map<string, string>();
    stubStorage(saved);
    /*
     * Imported after the stub, like the two view tests above and for the same
     * reason: the demo store captures `localStorage` when the module is created,
     * so an instance from before the stub writes into whatever the runtime
     * provides instead (Node 25 has a global `localStorage`; Node 22, which CI
     * runs, does not). Without this the assertion below read the host.
     */
    vi.resetModules();
    const { installBrowserBridge: install } = await import("@renderer/lib/browser-bridge");
    globals.window = {};
    expect(install()).toBe(true);

    const bridge = globals.window.atr as unknown as WritableBridge;
    // Read the slug off the catalog rather than guessing it from a repo name.
    const catalog = await bridge.catalog.list({});
    const repo = catalog.items.find((row) => !row.isFavorite);
    if (!repo) throw new Error("Every demo repo is already a favourite");
    await bridge.catalog.setFavorite({ slug: repo.slug, favorite: true });

    // The record is keyed per library, so the proof is the key as well as the write.
    expect([...saved.keys()].some((key) => key.startsWith("atr.browser-bridge.edits."))).toBe(
      true,
    );
  });
});
