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

/** A top-level section, `key:` through the next column-0 key. */
function section(name: string): string {
  const start = lines.findIndex((line) => line.startsWith(`${name}:`));
  expect(start, `ci.yml has no top-level "${name}:"`).toBeGreaterThan(-1);

  const block = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().length === 0) {
      block.push(line);
      continue;
    }
    if (!/^\s/.test(line)) break;
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

  test("asks the allowance before it pays for the packaging", () => {
    // The drill cannot conclude anything on a runner whose shared address has
    // spent its hour of GitHub reads — with the mock neutered, a real refusal and
    // a mock that stopped refusing are the same output. Asking first costs
    // seconds; finding out after two bundles costs the most expensive runner this
    // repository uses, to report a rate limit.
    const gate = drillCommands.indexOf(
      "node scripts/drill-refused-update-check.mjs --allowance-only",
    );
    const pack = drillCommands.indexOf("pnpm electron:pack");
    // The second mention, since the gate's command is a prefix of the drill's.
    const drilled = drillCommands.indexOf(
      "node scripts/drill-refused-update-check.mjs",
      gate + 1,
    );

    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(pack);
    expect(pack).toBeLessThan(drilled);
  });

  test("carries no credential either", () => {
    expect(drillCommands).not.toMatch(/secrets\.|TOKEN/);
  });

  test("offers a rehearsal for each verdict that cannot be waited for", () => {
    // Spent, moving and silent are machine states nobody can ask for, so the
    // blocked verdicts were covered by unit tests and nothing else — and a unit
    // test cannot see the annotation or the exit code the step turns red. The
    // dispatch input is how those reach a runner.
    expect(workflow).toMatch(/^  workflow_dispatch:\n    inputs:/m);
    expect(workflow).toMatch(/^ {6}drill:$/m);

    for (const state of ["spent", "moved", "unreadable", "available"]) {
      expect(workflow).toContain(`          - ${state}`);
    }
    // ... and `real`, which is what an ordinary dispatch gets.
    expect(workflow).toContain("          - real");
    expect(workflow).toMatch(/^ {8}default: real$/m);
  });

  test("rehearses through the environment, and never interpolates the input into a shell", () => {
    // The state is an input, and an input is text: quoted from the environment it
    // can only ever reach the script as one argument, which rejects a name it
    // does not know.
    expect(drill).toContain("DRILL_REHEARSAL: ${{ inputs.drill }}");
    expect(drillCommands).toContain('--rehearse "$DRILL_REHEARSAL"');
    expect(drill).not.toContain("--rehearse ${{ inputs.drill }}");
    expect(drill).toMatch(/if: inputs\.drill != 'real'/);
  });

  test("a rehearsal pays for no bundles, and the real drill pays for all of them", () => {
    // A rehearsal stages the check's output instead of running it, so the two
    // packages and the gate are exactly the cost it must not carry — and the real
    // drill must not lose them.
    for (const step of [
      "run: pnpm electron:pack",
      "run: pnpm electron:pack-older",
      "name: The refusal check, against a mock that refuses nothing",
      "name: Is there any anonymous allowance to conclude with?",
    ]) {
      expect(drill, step).toContain(`${step}\n        if: inputs.drill == 'real'`);
    }
  });
});

describe("the jobs that were already here", () => {
  test("runs the fast job on Linux, and keeps the app-launching jobs on macOS", () => {
    // The cheap runner is the point. Nothing in the fast job launches the app or
    // packages it, and the three native modules its suite loads all have a Linux
    // answer (`better-sqlite3` and `find-git-repositories` compile from source,
    // `sqlite-vec` publishes a Linux binary) — while macOS minutes bill at
    // ten times the Linux rate on a private repository. The jobs that *do* launch
    // a window cannot follow it there: the bundle is arm64 and the specs drive a
    // real app. Asserted here because the tempting tidy-up — every job back on
    // one runner — is exactly what this split exists to prevent.
    const check = commands(jobBlock("check"));

    expect(check).toContain("runs-on: ubuntu-latest");
    expect(check).not.toContain("macos");

    expect(refusalCommands).toContain("runs-on: macos-14");
    expect(jobBlock("drill")).toContain("runs-on: macos-14");
    expect(commands(jobBlock("e2e"))).toContain("runs-on: macos-14");
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

  test("verifies the badge, and does not try to push it onto a protected main", () => {
    // The step used to commit the refreshed SVG and push it to `main`. That is a
    // new commit, and a new commit has never passed the three required checks,
    // so protection rejected every such push (`GH006`, once per run that moved
    // the counts) and left main red over the badge. The run now fails when the
    // committed SVG disagrees with the totals it just produced, which is a gate
    // on the pull request that would have introduced the stale number.
    const check = commands(jobBlock("check"));

    expect(check).not.toContain("git push");
    expect(check).toContain("git diff --quiet -- docs/images/tests.svg");
    // Drawing it and checking it, in that order: the comparison is against the
    // badge this run produced, not one from an earlier tree.
    expect(check.indexOf("pnpm badges")).toBeLessThan(
      check.indexOf("git diff --quiet -- docs/images/tests.svg"),
    );
    // Nothing here writes to the repository any more, so nothing asks for that.
    expect(check).not.toContain("contents: write");
  });

  test("installs lsof, which the socket tests in the suite drive", () => {
    // The Ubuntu image does not carry `lsof`, and two tests in the unit suite
    // bind a real listening socket and expect the sweep to find it. Without the
    // install they stop with a reason rather than running (`process.spec.ts`
    // guards them), which would quietly take the binding path out of the only
    // runner that still covers it.
    expect(commands(jobBlock("check"))).toMatch(/apt-get install[^\n]*lsof/);
  });

  test("runs the cost guard, in the job that would notice a new macOS job", () => {
    // A budget nobody reads is not a guard. `scripts/check-ci-cost.mjs` holds
    // the macOS spend to what this repository declared, and this is the step
    // that makes it a gate rather than a comment. It runs on the fast job — a
    // guard that itself needed a Mac would be its own counterexample — and
    // `tests/unit/scripts/check-ci-cost.spec.ts` is where the budget, the
    // verdicts and the ways it can fail are covered.
    expect(commands(jobBlock("check"))).toContain("pnpm ci-cost:check");
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
 * The Electron suite runs once, on the architecture the app ships, and that is a
 * cost decision with a condition attached: `electron-builder.yml` publishes arm64
 * and nothing else, so a leg anywhere else builds and launches a product nobody
 * can download — while macOS minutes bill at ten times the Linux rate on a
 * private repository. The Intel leg that used to sit here was the most expensive
 * job in the file (188s against this one's 61s, because its image compiles both
 * natives from source), and it answered the question it existed for: the app does
 * run on x86_64, with the same tests passing there.
 *
 * Retiring it is the kind of change nothing goes red over — a second entry in the
 * matrix, or a job that leaves the architecture the product ships, would look
 * exactly like a working pipeline, and the only symptom would be a bill. So the
 * shape is pinned here, including the step that has to fail on the wrong machine.
 */
describe("the one leg the Electron suite runs on", () => {
  const e2e = jobBlock("e2e");
  const e2eCommands = commands(e2e);

  test("runs the developer's suite, on the architecture the app ships", () => {
    // One suite, one machine, one command — the developer's, unchanged. The
    // product is an arm64 bundle, so a runner where that bundle cannot run would
    // be testing a build nobody can install.
    expect(e2eCommands).toContain("pnpm test:electron-e2e");
    expect(e2eCommands).toContain("runs-on: macos-14");
    expect(e2eCommands).not.toContain("ubuntu-latest");
  });

  test("spends no macOS minutes on an architecture nothing ships", () => {
    // The Intel leg is gone on purpose: it built and launched a product nobody
    // can download, and it was the most expensive job here. The question it
    // answered is on record, with its options priced, in `docs/FUTURE.md` — so
    // bringing it back is a decision somebody has to make, and these assertions
    // are what stop it happening by accident.
    expect(e2eCommands).not.toContain("macos-15-intel");
    expect(e2eCommands).not.toContain("macos-13");
    expect(e2e).not.toContain("matrix");
    expect(e2e).not.toContain("fail-fast");
    // `upload-artifact@v4` refuses a second upload under a name already used in
    // the run, so the name stays unqualified while there is one leg to name.
    expect(e2e).toContain("name: playwright-traces");
    expect(e2e).not.toContain("playwright-traces-");
  });

  test("checks that it is the architecture the product ships, before launching anything", () => {
    // A runner label is not evidence, and a job that quietly ran where the
    // product is not would look exactly like one that works. So the leg asks the
    // machine, and asks the Electron binary the suite is about to launch.
    expect(e2e).toContain("Prove this is the architecture the app ships");
    expect(e2eCommands).toContain('if [ "$(uname -m)" != "arm64" ]; then');
    expect(e2eCommands).toContain('file -b "$ELECTRON"');
    expect(e2eCommands).toContain("*arm64*");
    // Before the suite, not after it: a leg that proved its architecture by
    // passing would be proving nothing.
    expect(e2eCommands.indexOf("Prove this")).toBeLessThan(
      e2eCommands.indexOf("pnpm test:electron-e2e"),
    );
  });
});

/**
 * Which run a new one replaces, which is a question with a failure mode that
 * looks nothing like a workflow problem.
 *
 * `github.ref` is `refs/heads/<branch>` for a push to that branch and for a
 * dispatch against it, so keying the group on the ref alone puts the two in one
 * group — and `gh workflow run ci.yml` then cancelled the push run it arrived
 * alongside. A cancelled run does not go away: its check runs stay attached to
 * the head commit as `CANCELLED`, and the merge box counts them against the
 * required checks. The pull request reads `BLOCKED` while all three required
 * checks are green on a newer run, re-running does not clear it (the cancelled
 * attempt is still on the commit), and the way out is re-cutting the commit to a
 * SHA with a clean slate.
 *
 * That is one incident, and it is why the event name is part of the key and why
 * a dispatch is the one event that never cancels. Both halves matter: the key
 * alone stops the dispatch taking the push's checks, and the policy alone would
 * still leave two dispatches cancelling each other onto the same commit.
 */
describe("the concurrency group", () => {
  const concurrency = section("concurrency");
  const group = /^\s+group: (.+)$/m.exec(concurrency)?.[1]?.trim();
  const cancel = /^\s+cancel-in-progress: (.+)$/m.exec(concurrency)?.[1]?.trim();

  test("keys on the event, so a push and a dispatch on one branch are two groups", () => {
    expect(group).toBeDefined();
    expect(group).toContain("github.event_name");
    // The ref still has to be in it: one branch's run must not replace another's.
    expect(group).toContain("github.ref");
  });

  test("supersedes an older run of the same event, and never a dispatch", () => {
    // A push brings a new commit, so the run it cancels was checking a SHA
    // nothing merges any more — that is where the saving is and it costs the
    // merge box nothing. A dispatch is a person asking about the commit that is
    // here now, so a second one waits its turn rather than leaving `CANCELLED`
    // checks on the commit the answer was wanted about.
    expect(cancel).toBe("${{ github.event_name != 'workflow_dispatch' }}");
  });
});

/**
 * The machine is checked before the code is, on the one runner that can do it
 * cheaply.
 *
 * A runner whose Node is outside `engines.node`, whose native modules are built
 * for the other runtime, or whose macOS SDK its own linker refuses takes the
 * unit suite down in a way that reads nothing like the cause: `Cannot find
 * module 'better-sqlite3'` repeated across thirty tests that have nothing to do
 * with the change under review, with the real line — `NODE_MODULE_VERSION 135`,
 * `tapi error: malformed file` — somewhere in the middle of it. `pnpm run doctor`
 * is that diagnosis as one step and one line, and this is what keeps it a step
 * rather than a script somebody remembers to run.
 *
 * Two spellings matter here and neither is cosmetic. The step is `pnpm run
 * doctor`, because pnpm's own `doctor` subcommand shadows the bare form and
 * would print nothing about this machine while exiting 0 — the same shadowing
 * `tests/unit/scripts/doctor.spec.ts` pins in `package.json`. And it belongs to
 * the *fast* job, not to either of the Mac jobs: the toolchain question is asked
 * of the machine that runs the unit suite, which is the Linux runner, and a
 * check that only ran where somebody already packages a Mac build would arrive
 * after the failures it exists to prevent.
 */
describe("the machine check, before the code check", () => {
  const checkCommands = commands(jobBlock("check"));

  test("runs the doctor on the fast job, spelled so it is not pnpm's own", () => {
    expect(checkCommands).toContain("pnpm run doctor");
    // The bare form is pnpm's command, so its absence is part of the assertion.
    expect(checkCommands).not.toMatch(/pnpm doctor(?![\.\w])/);
  });

  test("runs it before the suite it is diagnosing", () => {
    // A doctor that ran after the failure would still be one step and one line,
    // but it would be a footnote to a red suite rather than the answer to it.
    expect(checkCommands.indexOf("pnpm run doctor")).toBeLessThan(
      checkCommands.indexOf("pnpm badges"),
    );
  });

  test("costs the Mac jobs nothing, because they are not where it applies", () => {
    // It would work there, and it would compile a three-line addon to prove an
    // SDK. That is a question about the machine that packages the app, and it is
    // not the question this step was added to answer.
    expect(commands(jobBlock("e2e"))).not.toContain("pnpm run doctor");
    expect(refusalCommands).not.toContain("pnpm run doctor");
  });
});
