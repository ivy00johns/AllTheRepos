/**
 * The dev-time catalog export's serving half.
 *
 * `scripts/export-catalog.mjs` writes the catalog to a gitignored file and the
 * dev server hands it to the browser bridge at `/__atr/catalog.json`, which is
 * what lets a browser tab render the library this machine actually holds. Both
 * ends of that are easy to break silently: a route that stops being registered
 * (a missing middleware reads as a 404, which the bridge treats as "no export"
 * and quietly falls back) or a 404 that says nothing about how to produce the
 * file. So the route is driven here rather than only through a running server,
 * and the config is checked for carrying it.
 *
 * The plugin takes its file as an argument for exactly this reason: the path a
 * developer's export lives at must not be touched by a test.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "vitest";

import viteConfig, { exportedCatalogPlugin } from "../../../electron.vite.config";

const dir = mkdtempSync(join(tmpdir(), "atr-export-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

/**
 * Mount the middleware the way Vite does, and answer one request.
 *
 * `configureServer` is called with a server whose middleware registry is a
 * recorder, so the assertion is about what the plugin registered and what it
 * wrote — not about Vite's internals.
 */
function request(file: string): FakeResponse {
  const registered: Array<{ path: string; handler: (req: unknown, res: FakeResponse) => void }> =
    [];
  (exportedCatalogPlugin(file).configureServer as (server: unknown) => void)({
    middlewares: {
      use: (path: string, handler: (req: unknown, res: FakeResponse) => void) =>
        registered.push({ path, handler }),
    },
  });

  const route = registered[0];
  if (!route) throw new Error("the plugin registered no middleware");

  const response: FakeResponse = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) {
      response.headers[name] = value;
    },
    end(body) {
      if (body !== undefined) response.body = body;
    },
  };
  route.handler({ url: route.path }, response);
  return response;
}

describe("the exported catalog route", () => {
  test("serves the file as content, with no caching", () => {
    const file = join(dir, "catalog.json");
    writeFileSync(file, '{"format":1,"marker":"served"}', "utf8");

    const response = request(file);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/json");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(response.body)).toEqual({ format: 1, marker: "served" });
  });

  test("a missing export is a 404 that names the command that writes one", () => {
    const response = request(join(dir, "not-exported.json"));
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain("node scripts/export-catalog.mjs");
    // The path it looked in, so the answer is not "somewhere else".
    expect(response.body).toContain("not-exported.json");
  });
});

describe("the renderer config", () => {
  test("carries the route, dev only", () => {
    const renderer = viteConfig.renderer;
    if (!renderer || !renderer.plugins) {
      throw new Error("the renderer config should export its plugins");
    }
    const plugins = (renderer.plugins as unknown[]).flat(Infinity) as Array<{
      name?: string;
      apply?: string;
    }>;
    const found = plugins.find((plugin) => plugin.name === "atr-exported-catalog");
    expect(found, "the bridge reads this route in every browser-tab review").toBeDefined();
    // `serve` only: a build has no dev server, and the bridge is absent there.
    expect(found?.apply).toBe("serve");
  });
});
