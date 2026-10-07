/**
 * The schedule-health digest has one job — asking whether the other clocks are
 * still ticking — and three things a reader cannot see by reading it once.
 *
 * **It has to be able to look.** Reading runs of *other* workflows needs
 * `actions: read` on the token, and the script exits 3 rather than shrugging when
 * it cannot look; without the permission the digest would be a green run that
 * reported nothing, which is the exact silence it exists to catch.
 *
 * **It has to look after they have had their turn.** The other three sweeps run
 * at 13:30 and 14:00 UTC on Mondays; this one runs at 15:00, so a gate that
 * missed its own clock that morning is already visible as a gap rather than
 * being reported a week late.
 *
 * **It has to stay a report about this repository.** The gates are read out of
 * the workflow files, not from a list in here or in the script, so a schedule
 * added to a new file is covered the day it lands and one that is deleted stops
 * being reported on. A hardcoded set would drift from the files it claims to
 * describe, which for a digest means reporting on clocks that no longer exist and
 * staying quiet about the ones that do.
 *
 * Text-level on purpose, like the other workflow specs: neither a YAML parser nor
 * a shell belongs in an assertion about which keys a file carries, and this
 * repository has no YAML dependency.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const WORKFLOWS = path.join(ROOT, ".github", "workflows");

const read = (file: string) => fs.readFileSync(path.join(WORKFLOWS, file), "utf8");

const workflow = read("schedule-health.yml");

/** The `on:` block, which ends where the top-level `permissions:` begins. */
const on = workflow.slice(
  workflow.indexOf("\non:"),
  workflow.indexOf("\npermissions:"),
);

/**
 * Prose stripped, for assertions about what the file *does*.
 *
 * Not a nicety: this file's own comments and step name explain what it must not
 * contain, so asserting on the raw text would fail on the documentation of the
 * rule rather than on the rule.
 */
function commands(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

const body = commands(workflow);

/** The scheduled gates this digest is meant to be reporting on. */
const OTHERS = ["release.yml", "doc-links.yml", "updater-feed.yml"];

/** Where a weekly cron falls in the week, in minutes. */
function weekMinute(cron: string, file: string): number {
  const fields = cron.split(/\s+/);
  expect(fields, `${file} is no longer a weekly cron`).toHaveLength(5);
  const [minute, hour, , , day] = fields;
  expect(`${hour} ${minute} ${day}`, file).toMatch(/^\d{1,2} \d{1,2} \d$/);
  return Number(day) * 24 * 60 + Number(hour) * 60 + Number(minute);
}

function cronsIn(file: string): string[] {
  return [...read(file).matchAll(/^\s*-\s*cron:\s*["']?([^"'\n]+)["']?\s*$/gm)].map((match) =>
    match[1].trim(),
  );
}

describe("the schedule-health digest", () => {
  test("is a workflow with a clock of its own", () => {
    expect(workflow).toContain("name: Schedule health");
    for (const trigger of [
      "  push:",
      "  pull_request:",
      "  schedule:",
      "  workflow_dispatch:",
    ]) {
      expect(on, trigger).toContain(trigger);
    }
    expect(on).toMatch(/- cron: "0 15 \* \* 1"/);
  });

  test("looks after the sweeps it is reporting on have had their turn", () => {
    // Otherwise a Monday-morning gap would not be visible until the *following*
    // Monday, and the digest would be reporting on a week it cannot see.
    const digest = weekMinute(cronsIn("schedule-health.yml")[0], "schedule-health.yml");
    for (const file of OTHERS) {
      for (const cron of cronsIn(file)) {
        expect(digest, `${file}'s ${cron}`).toBeGreaterThan(weekMinute(cron, file));
      }
    }
  });

  test("runs when the gates it reads, or the checker, change", () => {
    // The schedules live in the workflow files, so every one of them is an input.
    for (const input of ['".github/workflows/**"', '"scripts/check-schedule-health.mjs"']) {
      const occurrences = on.split(input).length - 1;
      expect(occurrences, `${input} (push and pull_request)`).toBe(2);
    }
  });

  test("asks for the one permission it needs, and no writes", () => {
    // `actions: read` is what makes reading another workflow's runs possible; a
    // digest with write scopes would be a report nobody asked to be able to act.
    expect(body).toContain("actions: read");
    expect(body).toContain("contents: read");
    expect(body).not.toMatch(/contents: write|actions: write|pull-requests: write/);
  });

  test("hands the script a token, because without one it cannot look", () => {
    expect(body).toContain("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
    expect(body).toContain("node scripts/check-schedule-health.mjs");
    // Nothing to install: the checker imports nothing but Node and this checkout.
    expect(body).not.toContain("pnpm install");
  });

  test("publishes the digest, so a green run says something too", () => {
    expect(body).toContain('"$GITHUB_STEP_SUMMARY"');
  });

  test("reports a rate limit instead of failing on somebody else's", () => {
    // 2 is "could not read GitHub", which says nothing about the gates — the same
    // bargain the link check and the feed check strike with a bot wall.
    expect(body).toContain('if [ "$status" = "2" ]');
    expect(body).toContain("::warning::");
    expect(body).toContain('exit "$status"');
    // 1 is a gate that has gone quiet and 3 is this digest being unable to look;
    // neither may be swallowed on the way through.
    expect(body).not.toMatch(/status.*=.*"1"/);
    expect(body).not.toMatch(/status.*=.*"3"/);
  });

  test("does not carry its own list of the gates", () => {
    // The files are the source of truth: a schedule added tomorrow is covered
    // without editing this digest, and one deleted stops being reported on.
    for (const file of [...OTHERS, "ci.yml"]) {
      expect(body, file).not.toContain(file);
    }
  });

  test("does not pile up a run per push while one is still going", () => {
    expect(body).toContain("concurrency:");
    expect(body).toContain("cancel-in-progress: true");
  });
});
