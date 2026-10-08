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

import { afterEach, describe, expect, it } from "vitest";

import { PingResponseSchema } from "@shared/schemas";

import { installBrowserBridge } from "@renderer/lib/browser-bridge";

const globals = globalThis as { window?: { atr?: unknown } };

interface DemoBridge {
  catalog: { list(input: { limit?: number }): Promise<{ total: number }> };
  scan: { start(input: unknown): Promise<{ started: boolean }> };
  system: { ping(input: unknown): Promise<unknown> };
}

afterEach(() => {
  delete globals.window;
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

    // Writes are refused with a reason rather than quietly pretended.
    const scan = await bridge.scan.start({});
    expect(scan.started).toBe(false);
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
});
