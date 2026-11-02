/**
 * Deploy targets: what a repo's Cloudflare config says it serves, and how a URL
 * someone pasted maps back to those words.
 *
 * The case behind this: `randomtoolbox.some-account.workers.dev` is served from a
 * repo called PlainNamedRepo, and the only file linking the two is
 * `wrangler.jsonc`. The config never holds the account label (`some-account`), so
 * a URL has to be reduced to the Worker's name before it can match anything.
 *
 * Pure: no filesystem, no DB, no Electron.
 */

import { describe, expect, it } from "vitest";

import {
  deployLookupExpr,
  parseWranglerConfig,
} from "@main/services/deploy-targets";

describe("parseWranglerConfig: JSONC", () => {
  it("reads the name past comments and trailing commas", () => {
    const text = `{
      // the worker
      "$schema": "node_modules/wrangler/config-schema.json", /* not a // comment */
      "name": "randomtoolbox",
      "assets": { "directory": "public", },
    }`;
    expect(parseWranglerConfig("wrangler.jsonc", text)).toEqual([
      "randomtoolbox",
    ]);
  });

  it("does not treat // inside a string as a comment", () => {
    const text = `{ "name": "a", "route": "https://example.com/*" }`;
    expect(parseWranglerConfig("wrangler.json", text)).toEqual([
      "a",
      "example.com",
    ]);
  });

  it("reads routes as strings and as objects, and reduces them to hosts", () => {
    const text = JSON.stringify({
      name: "site",
      routes: [
        "*.one.example/*",
        { pattern: "two.example/api/*", zone_name: "two.example" },
        { pattern: "three.example", custom_domain: true },
      ],
    });
    expect(parseWranglerConfig("wrangler.json", text)).toEqual([
      "site",
      "one.example",
      "two.example",
      "three.example",
    ]);
  });

  it("derives an environment's Worker name the way wrangler does", () => {
    const text = JSON.stringify({
      name: "site",
      env: {
        staging: {},
        prod: { name: "site-live", route: "live.example/*" },
      },
    });
    expect(parseWranglerConfig("wrangler.json", text)).toEqual([
      "site",
      "site-staging",
      "site-live",
      "live.example",
    ]);
  });

  it("ignores a binding's name", () => {
    const text = JSON.stringify({
      name: "shelfcheck",
      d1_databases: [{ binding: "DB", name: "not-the-worker" }],
    });
    expect(parseWranglerConfig("wrangler.json", text)).toEqual(["shelfcheck"]);
  });

  it("returns nothing for a file it cannot parse", () => {
    expect(parseWranglerConfig("wrangler.json", "{ nope")).toEqual([]);
  });
});

describe("parseWranglerConfig: TOML", () => {
  it("reads a top-level name and ignores names under other tables", () => {
    const text = `
# name = "commented-out"
name = "braedon-barnhill" # trailing comment
pages_build_output_dir = "./dist"

[[d1_databases]]
binding = "DB"
name = "not-the-worker"

[vars]
name = "also-not-the-worker"
`;
    expect(parseWranglerConfig("wrangler.toml", text)).toEqual([
      "braedon-barnhill",
    ]);
  });

  it("reads a [[routes]] table", () => {
    const text = `
name = "telemetry"

[[routes]]
pattern = "telemetry.intrect.io"
custom_domain = true
`;
    expect(parseWranglerConfig("wrangler.toml", text)).toEqual([
      "telemetry",
      "telemetry.intrect.io",
    ]);
  });

  it("reads a routes array that spans lines, in both spellings", () => {
    const text = `
name = "router"
routes = [
  { pattern = "facts.example.org/*", zone_name = "example.org" },
  "bare.example.org/*"
]
`;
    expect(parseWranglerConfig("wrangler.toml", text)).toEqual([
      "router",
      "facts.example.org",
      "bare.example.org",
    ]);
  });

  it("reads a single route and environment tables", () => {
    const text = `
name = "site"
route = "main.example/*"

[env.staging]
route = { pattern = "staging.example/*", zone_name = "staging.example" }

[env.staging.vars]
name = "not-the-worker"

[env.prod]
name = "site-live"
`;
    expect(parseWranglerConfig("wrangler.toml", text)).toEqual([
      "site",
      "main.example",
      "site-staging",
      "staging.example",
      "site-live",
    ]);
  });
});

describe("deployLookupExpr", () => {
  it("reduces a workers.dev URL to the Worker's name", () => {
    expect(
      deployLookupExpr("https://randomtoolbox.some-account.workers.dev"),
    ).toBe('deploy_text : "randomtoolbox"');
  });

  it("accepts it with no scheme and with a path", () => {
    expect(
      deployLookupExpr("randomtoolbox.some-account.workers.dev/js/app.js?x=1"),
    ).toBe('deploy_text : "randomtoolbox"');
  });

  it("reduces a pages.dev URL, including a preview deployment", () => {
    expect(deployLookupExpr("https://site.pages.dev")).toBe(
      'deploy_text : "site"',
    );
    expect(deployLookupExpr("https://abc123.site.pages.dev/x")).toBe(
      'deploy_text : "site"',
    );
  });

  it("looks a custom domain up with and without www", () => {
    expect(deployLookupExpr("https://www.example.com/about")).toBe(
      'deploy_text : ("www.example.com" OR "example.com")',
    );
    expect(deployLookupExpr("https://example.com")).toBe(
      'deploy_text : "example.com"',
    );
  });

  it("is lower-cased", () => {
    expect(deployLookupExpr("HTTPS://Site.Pages.Dev")).toBe(
      'deploy_text : "site"',
    );
  });

  it.each([
    "randomtoolbox",
    "random toolbox",
    "https://two words.example",
    "ftp://example.com",
    "",
    '"; DROP TABLE repos; --.com',
  ])("is not a lookup: %s", (query) => {
    expect(deployLookupExpr(query)).toBeNull();
  });
});
