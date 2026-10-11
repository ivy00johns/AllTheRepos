/**
 * A browser tab reading the demo library has to say that is what it is doing.
 *
 * `lib/browser-bridge.ts` answers a tab's reads from the demo library when no
 * export exists, and two of those answers look exactly like real ones: an update
 * to a version that was never released, and a main-process pid of 0. The update
 * was read as real — that is the incident this marker exists for — so what is
 * asserted here is that the tab knows which library it is serving, that the
 * chrome is wired to it, and that the invented update says so where it is
 * offered.
 *
 * The export path is covered by the predicate rather than by a fixture: a valid
 * `ExportedCatalogSchema` payload is a large object built by
 * `scripts/export-catalog.mjs`, and `shouldMarkDemoData` is where the decision
 * lives. `demo-library.spec.ts` covers the data itself, and
 * `browser-bridge.spec.ts` covers the install guard; this file is about the
 * marker.
 */

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { shouldMarkDemoData } from "@renderer/components/layout/demo-data-badge";
import {
  installBrowserBridge,
  servedCatalogSource,
  subscribeToServedCatalogSource,
} from "@renderer/lib/browser-bridge";
import { DEMO_UPDATE } from "@renderer/lib/demo-library";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const globals = globalThis as { window?: { atr?: unknown } };

afterEach(() => {
  delete globals.window;
  vi.unstubAllGlobals();
});

describe("a tab reading the invented library", () => {
  it("is marked by the library it serves, not by the bridge being installed", () => {
    expect(shouldMarkDemoData("demo")).toBe(true);
    // An export is this machine's own catalog; marking that as invented would be
    // its own lie.
    expect(shouldMarkDemoData("export")).toBe(false);
    expect(shouldMarkDemoData(null)).toBe(false);
  });

  it("publishes the fallback it settled on, so the chrome can follow it", async () => {
    globals.window = {};
    // A fresh checkout has no export at `/__atr/catalog.json` — the case this
    // marker exists for.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));

    const seen: Array<string | null> = [];
    const unsubscribe = subscribeToServedCatalogSource((source) => seen.push(source));

    expect(installBrowserBridge()).toBe(true);
    // Not known at install time: the export is a fetch, and every read waits on
    // it so a tab cannot paint one library and swap it for another.
    expect(servedCatalogSource()).toBeNull();

    await vi.waitFor(() => expect(servedCatalogSource()).toBe("demo"));

    expect(seen).toEqual(["demo"]);
    expect(shouldMarkDemoData(servedCatalogSource())).toBe(true);
    unsubscribe();
  });

  it("says so where the update it invents is offered", () => {
    // The version looks exactly like a real one, which is the hazard: 0.1.8 is
    // this repository's own version and v0.1.8 is the newest release the feed
    // has, so a person reading "/settings" has no way to tell the two apart.
    expect(DEMO_UPDATE.newVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(DEMO_UPDATE.message).toMatch(/demo data/i);
    expect(DEMO_UPDATE.message).toMatch(/no such release/i);
  });

  it("is drawn in the chrome every route carries", () => {
    const topBar = fs.readFileSync(
      path.join(ROOT, "src", "renderer", "components", "layout", "top-bar.tsx"),
      "utf8",
    );

    expect(topBar).toContain("<DemoDataBadge");
  });
});
