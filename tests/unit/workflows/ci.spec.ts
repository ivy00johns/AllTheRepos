/**
 * `ci.yml` runs three things, and the third of them is the one a reader cannot
 * tell from the outside whether it did anything at all.
 *
 * `refusal` runs the packaged update check against a GitHub that refuses to
 * answer, because the spec turns that refusal into a *skip* — a 403 says nothing
 * about the release — and a skip path nobody exercises cannot be told apart from
 * a guard that stopped guarding. The job passes only when the tests that read the
 * feed stopped for that reason; a run that skipped for the ordinary reason, or
 * that never reached the mock, is a failure.
 *
 * That whole verdict lives in `scripts/refused-update-check.mjs` (with unit tests
 * covering every way it can be defeated), and this file asserts the wiring that
 * puts it on every push: that the job exists and is unconditional, that it
 * packages the app the spec launches, that it runs the script rather than a
 * second copy of the mock selected inline, and that it carries no credential —
 * the check under test is an *anonymous* read, so a token here would make it pass
 * on the runner and mean nothing for an install.
 *
 * Text-level on purpose, like the release workflow's spec: neither a YAML parser
 * nor a shell belongs in an assertion about which keys a job carries, and this
 * repository has no YAML dependency.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const workflow = fs.readFileSync(
  path.join(ROOT, ".github/workflows/ci.yml"),
  "utf8",
);

const lines = workflow.split("\n");

/** The lines of one job, from `  <name>:` to the next job. */
function jobBlock(name: string): string {
  const start = lines.findIndex((line) => line === `  ${name}:`);
  expect(start, `ci.yml has no job named "${name}"`).toBeGreaterThan(-1);

  const block = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().length === 0) {
      block.push(line);
      continue;
    }
    if (line.search(/\S/) <= 2) break;
    block.push(line);
  }
  return block.join("\n");
}

/** Prose stripped, for assertions about what a job *does*. */
function commands(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

const refusal = jobBlock("refusal");
const refusalCommands = commands(refusal);

const CHECK_STEP = "The update check, against a GitHub that refuses to answer";

describe("the job that runs the update check against a refusal", () => {
  test("exists, is unconditional, and runs on a machine that can launch the app", () => {
    expect(workflow).toContain("  refusal:");
    expect(refusal).toContain("name: packaged update check, refused");
    // A packaged Electron app needs macOS, and the bundle it launches is arm64.
    expect(refusalCommands).toContain("runs-on: macos-14");
    // No `if:` at all: this is a gate, and a gate that runs when somebody
    // remembers to ask for it is what CI was adopted to stop having.
    expect(refusal).not.toMatch(/^\s+if:/m);
  });

  test("packages the app the spec launches, before it runs the check", () => {
    // The spec skips itself without a packaged bundle — and a skip is exactly
    // what the step below refuses to accept, which is the point: a missing
    // package has to fail the job rather than quietly reduce it.
    const pack = refusalCommands.indexOf("pnpm electron:pack");
    const check = refusalCommands.indexOf("pnpm test:packaged-update-refused");

    expect(pack).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(pack);
  });

  test("installs the dependencies the runner and the suite both need", () => {
    expect(refusalCommands).toContain("pnpm install --frozen-lockfile");
  });

  test("runs the script, and not a second copy of the mock spelled out here", () => {
    // One home for the refusal, and it is the tested one. Selecting the mock in
    // the workflow — a `--require`, an env var — would put the half that decides
    // whether the run proved anything outside the unit tests that cover it.
    expect(refusalCommands).toContain(`run: pnpm test:packaged-update-refused`);
    expect(refusal).toMatch(new RegExp(`- name: ${CHECK_STEP}`));

    expect(refusalCommands).not.toContain("refuse-github");
    expect(refusalCommands).not.toContain("--require");
    expect(refusalCommands).not.toContain("NODE_OPTIONS");
    expect(refusalCommands).not.toContain("playwright test");
  });

  test("carries no credential, because the read under test is anonymous", () => {
    // The spec deletes `GH_TOKEN`, `GITHUB_TOKEN` and `RELEASES_TOKEN` out of the
    // environment it launches the app with, so a token here would not even reach
    // it — and a check that quietly stopped being anonymous is the failure this
    // whole feature exists to catch.
    expect(refusalCommands).not.toMatch(/secrets\.|GH_TOKEN|GITHUB_TOKEN|RELEASES_TOKEN/);
  });

  test("is about the refusal path, not a second run of the e2e suite", () => {
    expect(refusalCommands).not.toContain("test:electron-e2e");
    expect(jobBlock("e2e")).toContain("pnpm test:electron-e2e");
  });

  test("builds both bundles, because one of the three tests needs one behind the feed", () => {
    // The current build serves the first test; the second reads the feed only
    // after it has found a build that is genuinely older, which is what
    // `electron:pack-older` makes. Both are asserted by the check, so dropping
    // either build fails the job — the point being that a missing bundle can
    // never look like a smaller, greener run.
    const pack = refusalCommands.indexOf("pnpm electron:pack");
    const older = refusalCommands.indexOf("pnpm electron:pack-older");
    const check = refusalCommands.indexOf("pnpm test:packaged-update-refused");

    expect(pack).toBeGreaterThan(-1);
    expect(older).toBeGreaterThan(pack);
    expect(check).toBeGreaterThan(older);
  });
});

/**
 * The refusal job can only be trusted if its failure path is exercised too, and
 * the regression it has to survive is the quiet one: the mock loads, refuses
 * nothing, and every test goes green for its ordinary reasons.
 */
describe("the drill that proves the refusal check can fail", () => {
  const drill = jobBlock("drill");
  const drillCommands = commands(drill);

  test("exists, and only runs when somebody asks for it", () => {
    expect(workflow).toContain("  drill:");
    expect(drill).toMatch(/if: github\.event_name == 'workflow_dispatch'/);
    // ... and a dispatch is a thing this workflow can be asked for at all.
    expect(workflow).toMatch(/^  workflow_dispatch:$/m);
  });

  test("asserts the check fails, rather than asserting it passes twice", () => {
    // The drilled command is the job above's, unchanged; what is new is the
    // verdict, and that lives in a script with unit tests for every way it could
    // be fooled. The switch is thrown inside that script, not here.
    expect(drillCommands).toContain("node scripts/drill-refused-update-check.mjs");
    expect(drillCommands).not.toContain("playwright");
    expect(drillCommands).not.toContain("ATR_REFUSE_GITHUB");
  });

  test("needs the same two bundles the drilled command needs", () => {
    expect(drillCommands).toContain("pnpm electron:pack");
    expect(drillCommands).toContain("pnpm electron:pack-older");
  });

  test("carries no credential either", () => {
    expect(drillCommands).not.toMatch(/secrets\.|TOKEN/);
  });
});

describe("the jobs that were already here", () => {
  test("the fast job still runs the gates on every push and pull request", () => {
    const check = commands(jobBlock("check"));

    expect(check).toContain("pnpm typecheck");
    // ATR-054's linter, in the job that needs no build for it.
    expect(check).toContain("pnpm lint");
    expect(check).toContain("pnpm first-launch:check");
    expect(check).toContain("pnpm badges");
    expect(workflow).toMatch(/^on:\n\s+push:/m);
    expect(workflow).toContain("pull_request:");
  });

  test("the comment that said there was no linter is gone", () => {
    // It read "there is no linter in the repo today, so the workflow does not
    // pretend to run one", which was true and is not any more — a stale excuse is
    // worse than no comment, because it teaches the next reader to skip the file.
    expect(workflow).not.toContain("there is no linter in the repo today");
    expect(workflow).toContain("eslint.config.mjs");
  });

  test("the jobs that build for Electron are still not the job that runs vitest", () => {
    // Both of the slow jobs flip the natives to Electron's ABI — the suite through
    // `test:electron-e2e`, and the refusal through `electron:pack` — and the unit
    // suite cannot run in that state. That is why none of them is a step in
    // `check`, and it is the property a future edit is most likely to break while
    // tidying the workflow up.
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(pkg.scripts["test:electron-e2e"]).toContain("ensure-native-abi.mjs electron");
    expect(pkg.scripts["electron:pack"]).toContain("electron:rebuild");
    expect(jobBlock("e2e")).toContain("pnpm test:electron-e2e");
    expect(refusalCommands).toContain("pnpm electron:pack");
    expect(commands(jobBlock("check"))).not.toMatch(
      /electron:rebuild|electron:pack|electron:build/,
    );
  });
});
