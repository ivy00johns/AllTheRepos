/**
 * The updater feed check has its own workflow so that it can run on a clock.
 *
 * That is the whole point of it being a separate file, and it is the property a
 * reader cannot see from `release.yml`: the check has to fire when *nothing in
 * this repository changed*. A feed rots on its own — the release deleted, its
 * assets re-uploaded under new names, the releases repo turned private — and
 * `release.yml` is tag-push and dispatch, so a schedule there would wake the
 * whole release workflow once a week to fire one job that needs nothing built.
 *
 * Three things are asserted here rather than left to the drill:
 *
 *   1. **The clock exists**, and it is weekly rather than hourly: this reads a
 *      repository that changes when somebody publishes, so a tighter loop would
 *      spend most of its runs discovering that nothing has happened.
 *   2. **A change to anything it reads triggers it too**, so a break in the
 *      script, the manifest parser it reuses, or the publish block that holds
 *      the feed's address is caught on the pull request rather than a week later.
 *   3. **It carries no credential**, anywhere — no `env:`, no `secrets.`, nothing
 *      with write access. A credentialed read would pass on the runner and fail
 *      for every install, which is the exact failure the check exists to catch.
 *
 * Text-level on purpose, like the release workflow's spec: neither a YAML parser
 * nor a shell belongs in an assertion about which keys a file carries, and this
 * repository has no YAML dependency.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (relative: string) =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

const workflow = read(".github/workflows/updater-feed.yml");
const releaseWorkflow = read(".github/workflows/release.yml");

/** The `on:` block, which ends where the top-level `permissions:` begins. */
const on = workflow.slice(
  workflow.indexOf("\non:"),
  workflow.indexOf("\npermissions:"),
);

/**
 * Prose stripped, for assertions about what the file *does*.
 *
 * Not a nicety: this file's own comments name `GH_TOKEN`, `secrets.` and
 * `pnpm install` in order to explain that they must not appear, so asserting on
 * the raw text would fail on the documentation of the rule rather than on the
 * rule. `release.spec.ts` strips comments for the same reason.
 */
function commands(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

const body = commands(workflow);

/** Everything it reads, and therefore everything that should trigger it. */
const INPUTS = [
  '"scripts/check-updater-feed.mjs"',
  '"scripts/verify-release.mjs"',
  '"scripts/release-config.mjs"',
  '"electron-builder.yml"',
  // The statuses that mean "GitHub declined to answer": the check reads them out
  // of the shared definition the app and the update check read too, so a change
  // to that rule changes what this check does.
  '"src/shared/github-refusal.json"',
  '".github/workflows/updater-feed.yml"',
];

describe("the updater feed workflow", () => {
  test("reads the live feed, and nothing else needs building for it", () => {
    expect(workflow).toContain("name: Updater feed");
    expect(body).toContain("node scripts/check-updater-feed.mjs");
    expect(body).toContain("runs-on: ubuntu-latest");
    // Nothing here builds or installs anything: the check reads a release that
    // already exists.
    expect(body).not.toContain("pnpm install");
    expect(body).not.toContain("electron:build");
  });

  test("runs on a clock as well as on a change", () => {
    for (const trigger of [
      "  push:",
      "  pull_request:",
      "  schedule:",
      "  workflow_dispatch:",
    ]) {
      expect(on, trigger).toContain(trigger);
    }
  });

  test("sweeps weekly, which is what the push trigger can never do", () => {
    // Mondays, 13:30 UTC. Half an hour behind the link check's own weekly sweep
    // on purpose, so the two do not start together.
    expect(on).toMatch(/- cron: "30 13 \* \* 1"/);
  });

  test("every input it reads also triggers it, in both push and PR", () => {
    // Otherwise a break in the parser or the publish block would be found by the
    // clock — up to a week later — instead of by the pull request that made it.
    for (const input of INPUTS) {
      const occurrences = on.split(input).length - 1;
      expect(occurrences, `${input} (push and pull_request)`).toBe(2);
    }
  });

  test("reports a rate limit instead of failing on somebody else's", () => {
    // Exit 2 is "could not run": an unauthenticated address gets 60 API requests
    // an hour and a runner shares its address with every other job on the
    // machine, so the allowance is routinely spent by somebody else. The check
    // itself contains one such request, and this step still went red on its very
    // first dispatch for that reason — which is how a gate stops being trusted.
    //
    // A warning, then, and only for 2. `exit "$status"` passes everything else
    // through: 1 is the feed being wrong, and 3 is this checker being wrong.
    expect(body).toContain('if [ "$status" = "2" ]');
    expect(body).toContain("::warning::");
    expect(body).toContain('exit "$status"');
    expect(body).not.toMatch(/status.*=.*"1"/);
  });

  test("carries no credential at all, because an install has none", () => {
    // The assertion that matters most, and the one a future edit is most likely
    // to break: adding `GH_TOKEN` here would make the check pass for whoever ran
    // it and fail for every app in the field.
    expect(body).not.toMatch(/GH_TOKEN|GITHUB_TOKEN|secrets\./);
    expect(body).not.toMatch(/^\s+env:/m);
  });

  test("cannot change anything, even if it wanted to", () => {
    expect(body).toContain("contents: read");
    expect(body).not.toContain("contents: write");
    expect(body).not.toMatch(/gh release|--publish/);
  });

  test("does not pile up a run per push while one is still going", () => {
    expect(body).toContain("concurrency:");
    expect(body).toContain("cancel-in-progress: true");
  });

  test("the release workflow no longer carries a copy of it", () => {
    // One home. `release.yml` is the wrong one: it cannot run on a clock without
    // waking the whole release pipeline, and a second copy would drift from the
    // one the schedule actually runs.
    expect(releaseWorkflow).not.toMatch(/^  feed:/m);
    expect(releaseWorkflow).not.toContain("check-updater-feed.mjs");
  });
});
