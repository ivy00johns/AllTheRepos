/**
 * The update feed has one address, written down in three places (ATR-048).
 *
 * `electron-builder.yml` decides where `pnpm release` uploads and what
 * `app-update.yml` inside the bundle says; `services/updater.ts` overrides that
 * at run time with `setFeedURL`; `.github/workflows/release.yml` names the repo
 * again when it publishes the draft. A drift between them is invisible in
 * development — the app isn't packaged, so a check returns "running from
 * source" — and surfaces only as every install reporting "No releases
 * published yet" after a release that plainly did publish. So they are
 * compared here.
 *
 * Text-level on purpose: this asserts a fact about three files, not about a
 * YAML or TypeScript AST, and neither a YAML parser nor the TypeScript
 * compiler belongs in this test's dependency list.
 *
 * The same file also guards the *privacy* half of the design: the feed is
 * public, so the app must not ship or fetch a credential. A `GH_TOKEN` read or
 * a `gh` invocation reappearing in the updater would silently change what the
 * shipped app asks the user to do.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

/** The `publish:` block of electron-builder.yml: its key plus indented lines. */
function publishBlock(yaml: string): string {
  const start = yaml.indexOf("publish:");
  expect(start, "electron-builder.yml has no publish: block").toBeGreaterThan(
    -1,
  );

  const lines = yaml.slice(start).split("\n");
  const block = [lines[0]];
  for (const line of lines.slice(1)) {
    if (/^\S/.test(line)) break;
    block.push(line);
  }
  return block.join("\n");
}

function yamlValue(block: string, key: string): string {
  const match = new RegExp(`^\\s+${key}:\\s*(\\S+)\\s*$`, "m").exec(block);
  expect(match, `no ${key}: in the publish block`).not.toBeNull();
  return match![1];
}

const builderPublish = publishBlock(read("electron-builder.yml"));
const updater = read("src/main/services/updater.ts");
const workflow = read(".github/workflows/release.yml");

const feedOwner = /const FEED_OWNER = "([^"]+)"/.exec(updater)?.[1];
const feedRepo = /const FEED_REPO = "([^"]+)"/.exec(updater)?.[1];

describe("update feed target", () => {
  test("electron-builder publishes to the repo the app reads", () => {
    expect(feedOwner, "FEED_OWNER missing from updater.ts").toBeDefined();
    expect(feedRepo, "FEED_REPO missing from updater.ts").toBeDefined();
    expect(yamlValue(builderPublish, "owner")).toBe(feedOwner);
    expect(yamlValue(builderPublish, "repo")).toBe(feedRepo);
  });

  test("the release workflow publishes to that same repo", () => {
    const workflowRepo = /RELEASES_REPO:\s*(\S+)/.exec(workflow)?.[1];
    expect(workflowRepo, "release.yml sets no RELEASES_REPO").toBeDefined();
    expect(workflowRepo).toBe(`${feedOwner}/${feedRepo}`);
  });

  test("the feed is public, so neither file marks it private", () => {
    expect(builderPublish).not.toMatch(/private:\s*true/);
    expect(updater).not.toMatch(/private:\s*true/);
  });

  test("the app needs no credential to read the feed", () => {
    expect(updater).not.toMatch(/GH_TOKEN|GITHUB_TOKEN/);
    expect(updater).not.toMatch(/auth",\s*"token/);
  });
});
