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
  test("runs the fast job on Linux, and keeps the app-launching jobs on macOS", () => {
    // The cheap runner is the point. Nothing in the fast job launches the app or
    // packages it, and the three native modules its suite loads all have a Linux
    // answer (`better-sqlite3` and `find-git-repositories` compile from source,
    // `@lancedb/lancedb` publishes a Linux binary) — while macOS minutes bill at
    // ten times the Linux rate on a private repository. The jobs that *do* launch
    // a window cannot follow it there: the bundle is arm64 and the specs drive a
    // real app. Asserted here because the tempting tidy-up — every job back on
    // one runner — is exactly what this split exists to prevent.
    const check = commands(jobBlock("check"));

    expect(check).toContain("runs-on: ubuntu-latest");
    expect(check).not.toContain("macos");

    expect(refusalCommands).toContain("runs-on: macos-14");
    expect(jobBlock("drill")).toContain("runs-on: macos-14");
    expect(jobBlock("e2e")).toContain("runs-on: ${{ matrix.runner }}");
  });

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

  test("installs lsof, which the socket tests in the suite drive", () => {
    // The Ubuntu image does not carry `lsof`, and two tests in the unit suite
    // bind a real listening socket and expect the sweep to find it. Without the
    // install they stop with a reason rather than running (`process.spec.ts`
    // guards them), which would quietly take the binding path out of the only
    // runner that still covers it.
    expect(commands(jobBlock("check"))).toMatch(/apt-get install[^\n]*lsof/);
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

/**
 * The Electron suite runs on two machines now, and only one of them is a build
 * anybody can download: `electron-builder.yml` publishes arm64 and nothing else,
 * so the Intel leg tests no product. It exists for the question this repository
 * has never been able to answer — **does the app run on x86_64 at all?**
 * `pnpm platforms:check` can report that `@lancedb/lancedb` ships no darwin-x64
 * binary; nothing can report what the app does about it, because the vector
 * store fails soft on purpose, semantic search degrades to FTS, and the suite
 * stays green either way.
 *
 * Which makes this the kind of coverage that can be deleted without anything
 * going red — drop the second entry from the matrix, or leave a leg's premise
 * resting on a runner label that was retired last year, and the job still
 * passes. These are the assertions that hold it in place.
 */
describe("the Intel leg of the Electron suite", () => {
  const e2e = jobBlock("e2e");
  const e2eCommands = commands(e2e);

  test("runs the same suite, on the other architecture a Mac comes in", () => {
    // One suite, two legs, one command — the developer's, unchanged.
    expect(e2eCommands).toContain("pnpm test:electron-e2e");
    expect(e2eCommands).toContain("runs-on: ${{ matrix.runner }}");
    expect(e2eCommands).toContain("arch: arm64");
    expect(e2eCommands).toContain("arch: x64");
    expect(e2eCommands).not.toContain("runs-on: macos-14");
  });

  test("asks for an Intel runner label that still exists", () => {
    // `macos-13` is the label this leg was first asked for by name, and GitHub
    // retired the macOS 13 images on 2025-12-04: a job asking for one now waits
    // for a machine that will never be handed to it. `macos-15-intel` is the
    // x86_64 image that replaced it, and the last one GitHub intends to offer.
    expect(e2eCommands).toContain("runner: macos-15-intel");
    expect(e2eCommands).not.toContain("macos-13");
  });

  test("checks that it is the architecture it claims, before launching anything", () => {
    // A label is not evidence — `macos-14` and `macos-15-intel` differ by one
    // word — and a second leg that quietly ran on arm64 again would look exactly
    // like one that works. So the leg asks the machine, and asks the Electron
    // binary the suite is about to launch.
    expect(e2e).toContain("Prove this leg is the architecture it is named for");
    expect(e2eCommands).toContain(
      'if [ "$(uname -m)" != "${{ matrix.machine }}" ]; then',
    );
    expect(e2eCommands).toContain('file -b "$ELECTRON"');
    expect(e2eCommands).toContain("machine: arm64");
    expect(e2eCommands).toContain("machine: x86_64");
    // Before the suite, not after it: a leg that proved its architecture by
    // passing would be proving nothing.
    expect(e2eCommands.indexOf("Prove this leg")).toBeLessThan(
      e2eCommands.indexOf("pnpm test:electron-e2e"),
    );
  });

  test("lets the arm64 result survive an Intel-only break", () => {
    // The two legs fail for unrelated reasons. `fail-fast` defaults to true, and
    // an Intel break that cancelled the arm64 run would take down the one result
    // anybody can act on.
    expect(e2e).toContain("fail-fast: false");
  });

  test("keeps the two legs' failure artifacts apart", () => {
    // `upload-artifact@v4` refuses a second upload under a name already used in
    // the run, so a shared name turns two red legs into one red leg and one
    // error about the artifact.
    expect(e2e).toContain("name: playwright-traces-${{ matrix.arch }}");
  });
});
