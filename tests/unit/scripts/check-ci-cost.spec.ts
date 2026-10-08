/**
 * Unit test for `scripts/check-ci-cost.mjs`.
 *
 * The script exists because the CI bill is a property of `.github/workflows/` and
 * nothing connected it to anything: macOS runner minutes bill at ten times the
 * Linux rate on a private repository, so a job that moves to a Mac — or a matrix
 * that gains a second leg, which is that job's bill again on every run — is a
 * spending decision, and decisions need somewhere to be written down and
 * something that reads them back.
 *
 * Most of what is asserted here is the shape of the mistake rather than the
 * mistake itself:
 *
 *   - a *new* macOS job somewhere in the workflow directory, which is how the
 *     second leg of the Electron matrix arrived;
 *   - a job that was asked for by hand and quietly lost the `if:` that kept it
 *     that way, so it starts on every push;
 *   - a runner label that is a rate — and, for the Intel images, a rate paid for
 *     a build that is never released;
 *   - a budget entry left behind by a job that no longer exists, because an
 *     allowlist nobody prunes is one the next reader learns to skip.
 *
 * One test is deliberately about a parsing trap that bit this script while it was
 * being written: the `m` flag on the regexes that read a section's lines. Without
 * it `^` matches only the section's own key, every workflow reads as having no
 * triggers, the per-push jobs look conditional, and the check passes while the
 * thing it guards is unguarded. That is the failure mode of every guard whose
 * subject is "has nothing changed", so it is pinned rather than remembered.
 *
 * The script is imported by URL (a `.mjs` CLI with no declarations) and driven
 * through its entry point with the root injected, which is how the other script
 * specs here run theirs — no child process, and the messages a person would read
 * come back as strings.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "check-ci-cost.mjs");

interface BudgetEntry {
  workflow: string;
  job: string;
  runner: string;
  when: "push" | "tag" | "dispatch";
  legs?: number;
  why: string;
}

interface ObservedJob {
  workflow: string;
  job: string;
  runners: string[];
  matrix: boolean;
  conditional: boolean;
  everyPush: boolean;
}

interface CheckCiCostModule {
  WORKFLOW_DIR: string;
  MACOS_BUDGET: BudgetEntry[];
  PER_PUSH_LIMIT: number;
  ALLOWED_RUNNERS: string[];
  RETIRED_RUNNERS: Record<string, string>;
  topSection(text: string, name: string): string | null;
  workflowJobs(text: string): Array<{ job: string; block: string }>;
  workflowTriggers(text: string): { everyPush: boolean; kinds: string[] };
  jobFacts(block: string): { runners: string[]; conditional: boolean; matrix: boolean };
  auditWorkflows(root?: string): ObservedJob[] | null;
  assess(
    observed: ObservedJob[],
    options?: {
      budget?: BudgetEntry[];
      limit?: number;
      allowed?: string[];
      retired?: Record<string, string>;
    },
  ): { failures: string[]; notes: string[] };
  run(options?: {
    root?: string;
    budget?: BudgetEntry[];
    limit?: number;
    allowed?: string[];
    retired?: Record<string, string>;
    log?: (message: string) => void;
    error?: (message: string) => void;
  }): number;
}

let script: CheckCiCostModule;

beforeAll(async () => {
  script = (await import(pathToFileURL(SCRIPT).href)) as unknown as CheckCiCostModule;
});

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) cleanupTmp(roots.pop());
});

/** A throwaway repository holding just the workflows a case needs. */
function fixture(files: Record<string, string>): string {
  const dir = makeTmpDir("atr-ci-cost");
  roots.push(dir);
  const dirname = path.join(dir, script.WORKFLOW_DIR);
  fs.mkdirSync(dirname, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dirname, name), text);
  }
  return dir;
}

/** Collects what a run printed, so a verdict can be read off the output too. */
function collector(): { lines: string[]; write: (message: string) => void } {
  const lines: string[] = [];
  return { lines, write: (message: string) => lines.push(message) };
}

const PUSH_WORKFLOW = `name: CI

on:
  push:
  pull_request:

jobs:
  fast:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm typecheck
  slow:
    runs-on: macos-14
    steps:
      - run: pnpm test:electron-e2e
`;

const TAGGED_WORKFLOW = `name: Release

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:

jobs:
  release:
    runs-on: macos-14
    steps:
      - run: pnpm electron:build
`;

const ON_DEMAND_WORKFLOW = `name: CI

on:
  push:

jobs:
  drill:
    if: github.event_name == 'workflow_dispatch'
    runs-on: macos-14
    steps:
      - run: node scripts/drill.mjs
`;

const TWO_LEG_WORKFLOW = `name: CI

on:
  push:

jobs:
  e2e:
    name: electron e2e (\${{ matrix.arch }})
    strategy:
      fail-fast: false
      matrix:
        include:
          - runner: macos-14
            arch: arm64
          - runner: macos-15-intel
            arch: x64
    runs-on: \${{ matrix.runner }}
    steps:
      - run: pnpm test:electron-e2e
`;

const observed = (over: Partial<ObservedJob> = {}): ObservedJob => ({
  workflow: "ci.yml",
  job: "slow",
  runners: ["macos-14"],
  matrix: false,
  conditional: false,
  everyPush: true,
  ...over,
});

/**
 * One budget entry, for the cases about a single job.
 *
 * The cases below pass their own budget rather than `MACOS_BUDGET`, on purpose:
 * with the real one every other entry is a job the fixture does not have, so the
 * verdict fills up with "no job of that name" and the failure under test is lost
 * in the noise. The real budget is asserted where it belongs, against ROOT.
 */
const entry = (over: Partial<BudgetEntry> = {}): BudgetEntry => ({
  workflow: "ci.yml",
  job: "slow",
  runner: "macos-14",
  when: "push",
  why: "the fixture's own job, on the machine a fixture cannot avoid",
  ...over,
});

describe("reading when a workflow starts", () => {
  test("reads a bare push as every push, and a tags-only one as not", () => {
    // The trap: a section is one string with newlines in it, so a `^` without
    // the `m` flag matches only the section's own key. That is an answer of
    // "no triggers" for every workflow, which makes the check agree with a
    // pipeline that runs a Mac on every push.
    expect(script.workflowTriggers(PUSH_WORKFLOW)).toMatchObject({ everyPush: true });
    expect(script.workflowTriggers(TAGGED_WORKFLOW)).toMatchObject({ everyPush: false });
    expect(script.workflowTriggers(TAGGED_WORKFLOW).kinds).toContain("tag push");
    expect(script.workflowTriggers(PUSH_WORKFLOW).kinds).toContain("pull request");
  });

  test("reads the jobs out of a workflow, and only the jobs", () => {
    const jobs = script.workflowJobs(PUSH_WORKFLOW);

    expect(jobs.map((job) => job.job)).toEqual(["fast", "slow"]);
    // The block has to stop at the next job, or the runner of one job would be
    // read as the runner of another and a Linux job could look like a Mac.
    expect(script.jobFacts(jobs[0].block).runners).toEqual([]);
    expect(script.jobFacts(jobs[1].block).runners).toEqual(["macos-14"]);
  });

  test("does not mistake a step's own if for the job's condition", () => {
    const workflow = `name: CI

on:
  push:

jobs:
  e2e:
    runs-on: macos-14
    steps:
      - run: pnpm test:electron-e2e
      - name: Upload traces
        if: failure()
        uses: actions/upload-artifact@v4
`;

    const dir = fixture({ "ci.yml": workflow });
    const job = only(script.auditWorkflows(dir) ?? []);

    // The step's `if:` is indented under the step. Read as the job's, it would
    // make a job that starts on every push look like one that does not — which
    // is the cheap way to pass this check by accident.
    expect(job.conditional).toBe(false);
    expect(job.everyPush).toBe(true);
  });

  test("leaves a job that carries its own condition off the per-push count", () => {
    const dir = fixture({ "ci.yml": ON_DEMAND_WORKFLOW });
    const job = only(script.auditWorkflows(dir) ?? []);

    expect(job.conditional).toBe(true);
    expect(job.everyPush).toBe(false);
  });
});

describe("what a job costs", () => {
  test("sees a matrix leg as a second machine, on every run", () => {
    const dir = fixture({ "ci.yml": TWO_LEG_WORKFLOW });
    const job = only(script.auditWorkflows(dir) ?? []);

    // Two distinct labels, either of which can start: the job's bill, twice.
    expect(job.runners).toEqual(["macos-14", "macos-15-intel"]);
    expect(job.matrix).toBe(true);
  });

  test("counts only the runners a job names, not the ones in other files", () => {
    const dir = fixture({ "ci.yml": PUSH_WORKFLOW, "release.yml": TAGGED_WORKFLOW });
    const observed = script.auditWorkflows(dir) ?? [];

    expect(observed.map((job) => `${job.workflow}/${job.job}`)).toEqual([
      "ci.yml/fast",
      "ci.yml/slow",
      "release.yml/release",
    ]);
    expect(observed.filter((job) => job.runners.length > 0)).toHaveLength(2);
    expect(observed.find((job) => job.job === "release")?.everyPush).toBe(false);
  });
});

describe("the verdict", () => {
  test("passes a job the budget declares", () => {
    const { failures } = script.assess([observed()], { budget: [entry()] });

    expect(failures).toEqual([]);
  });

  test("fails a macOS job the budget does not name", () => {
    const { failures } = script.assess([observed({ job: "brand-new" })], { budget: [] });
    const said = failures.join("\n");

    expect(failures).toHaveLength(1);
    expect(said).toContain("ci.yml/brand-new");
    // The message has to say what to do about it, not just that it happened.
    expect(said).toContain("ubuntu-latest");
    expect(said).toContain("MACOS_BUDGET");
  });

  test("fails a declared job that grew a second leg", () => {
    const { failures } = script.assess(
      [observed({ runners: ["macos-14", "macos-15-intel"], matrix: true })],
      { budget: [entry()] },
    );
    const said = failures.join("\n");

    expect(said).toContain("2 macOS runners");
    expect(said).toContain("macos-15-intel");
    // ... and the reason that label is refused is in the same message.
    expect(said).toContain("2026-10-08");
  });

  test("fails a runner label this repository has retired", () => {
    // Declared, so this is the branch that reads a job's own runner: the reason
    // the label is refused has to travel with the failure.
    const { failures } = script.assess(
      [observed({ runners: ["macos-13"] })],
      { budget: [entry({ runner: "macos-13" })] },
    );

    expect(failures.join("\n")).toContain("2025-12-04");
  });

  test("names a retired label's reason even on a job nobody declared", () => {
    // The other half of the same rule: somebody adding a Mac usually copies a
    // label they have seen in this repository, and the retired ones are exactly
    // the ones that still look available.
    const { failures } = script.assess(
      [observed({ job: "brand-new", runners: ["macos-15-intel"], matrix: false })],
      { budget: [] },
    );

    expect(failures.join("\n")).toContain("2026-10-08");
  });

  test("fails a job that was asked for by hand and now starts on every push", () => {
    const budget = [
      { workflow: "ci.yml", job: "drill", runner: "macos-14", when: "dispatch" as const, why: "on demand" },
    ];
    const { failures, notes } = script.assess(
      [observed({ job: "drill", everyPush: true })],
      { budget, limit: 5 },
    );

    expect(failures).toHaveLength(1);
    expect(failures.join("\n")).toContain("starts on every push");
    // Each such job is also counted against the limit, which is the number that
    // actually spends the allowance — so the note reports it rather than hiding it.
    expect(notes.join("\n")).toContain("1 of 5 allowed macOS job(s) on every push");
  });

  test("fails a budget entry whose job no longer exists", () => {
    const budget = [
      { workflow: "ci.yml", job: "gone", runner: "macos-14", when: "push" as const, why: "removed since" },
    ];
    const { failures } = script.assess([observed()], { budget });

    expect(failures.join("\n")).toContain("no job of that name runs on a Mac");
  });

  test("fails a third macOS job on every push, and says which ones they are", () => {
    const { failures } = script.assess(
      [
        observed({ job: "e2e" }),
        observed({ job: "refusal" }),
        observed({ job: "one-more" }),
      ],
      {
        budget: [
          { workflow: "ci.yml", job: "e2e", runner: "macos-14", when: "push" as const, why: "the app" },
          { workflow: "ci.yml", job: "refusal", runner: "macos-14", when: "push" as const, why: "the app" },
          { workflow: "ci.yml", job: "one-more", runner: "macos-14", when: "push" as const, why: "declared, and over the limit" },
        ],
      },
    );
    const said = failures.join("\n");

    expect(said).toContain("3 macOS job(s) start on every push");
    expect(said).toContain("ci.yml/one-more");
    expect(said).toContain("allows 2");
  });

  test("notes rather than fails when a job gets cheaper than the budget says", () => {
    // The check exists to catch widening. A job that stopped running on every
    // push is a saving, and failing it would teach people to route around this.
    const { failures, notes } = script.assess([
      observed({ job: "drill", conditional: true, everyPush: false }),
    ], {
      budget: [
        { workflow: "ci.yml", job: "drill", runner: "macos-14", when: "push" as const, why: "used to be per-push" },
      ],
    });

    expect(failures).toEqual([]);
    expect(notes.join("\n")).toContain("no longer starts on every push");
  });
});

describe("the run, and the way it fails when it cannot look", () => {
  test("a repository with no workflows is a could-not-run, not a pass", () => {
    const dir = makeTmpDir("atr-ci-cost-empty");
    roots.push(dir);
    const out = collector();
    const errors = collector();

    expect(
      script.run({ root: dir, log: out.write, error: errors.write }),
      "an absent workflow directory means the check examined nothing",
    ).toBe(2);
    expect(errors.lines.join("\n")).toContain("could not run");
  });

  test("a workflow directory it cannot read a job out of is a could-not-run", () => {
    const dir = fixture({ "ci.yml": "# a workflow file with nothing in it\n" });
    const errors = collector();

    expect(script.run({ root: dir, log: collector().write, error: errors.write })).toBe(2);
    expect(errors.lines.join("\n")).toContain("no job this checker could read");
  });

  test("names each failure and returns 1 when the budget and the workflows disagree", () => {
    const dir = fixture({ "ci.yml": TWO_LEG_WORKFLOW, "release.yml": TAGGED_WORKFLOW });
    const out = collector();
    const errors = collector();

    expect(script.run({ root: dir, log: out.write, error: errors.write })).toBe(1);
    expect(errors.lines.join("\n")).toContain("[check-ci-cost] FAILED");
    expect(errors.lines.join("\n")).toContain("ci.yml/e2e");
    // The verdict is data as well as a transcript, and the summary a person
    // reads first is printed either way.
    expect(out.lines.join("\n")).toContain("macOS job(s) on every push");
  });
});

/**
 * The same run the CI step does, against this repository.
 *
 * The check is only worth its step if it is green here and would not be if
 * somebody added a Mac to a workflow — which the fixture cases above are for.
 * What this block adds is that the budget in the script and the workflows in the
 * tree are the same story, including the number of jobs that start on their own.
 */
describe("this repository", () => {
  test("every macOS job in the tree is one the budget declares", () => {
    const jobs = script.auditWorkflows(ROOT) ?? [];
    const declared = new Set(script.MACOS_BUDGET.map((entry) => `${entry.workflow}/${entry.job}`));

    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs.filter((candidate) => candidate.runners.length > 0)) {
      expect(declared.has(`${job.workflow}/${job.job}`), `${job.workflow}/${job.job} is undeclared`).toBe(true);
    }
  });

  test("every budget entry still describes a job that exists", () => {
    const jobs = script.auditWorkflows(ROOT) ?? [];
    const found = new Set(jobs.map((job) => `${job.workflow}/${job.job}`));

    for (const entry of script.MACOS_BUDGET) {
      expect(found.has(`${entry.workflow}/${entry.job}`), `${entry.workflow}/${entry.job} is stale`).toBe(true);
    }
  });

  test("declares only runners it would allow, and a reason for each", () => {
    for (const entry of script.MACOS_BUDGET) {
      expect(script.ALLOWED_RUNNERS).toContain(entry.runner);
      // A budget without its reason is a list; the reason is the part that stops
      // the next person re-deciding it.
      expect(entry.why.length).toBeGreaterThan(40);
    }
  });

  test("spends its allowed number of macOS jobs on every push, and no more", () => {
    const jobs = script.auditWorkflows(ROOT) ?? [];
    // macOS only: every job in a push-triggered workflow starts on a push, and
    // the `check` job starting on every push is the point rather than a cost.
    const perPush = jobs.filter((job) => job.runners.length > 0 && job.everyPush);

    expect(perPush.length).toBeLessThanOrEqual(script.PER_PUSH_LIMIT);
    // Named, so a change is visible in this test rather than only in a diff.
    expect(perPush.map((job) => `${job.workflow}/${job.job}`).sort()).toEqual([
      "ci.yml/e2e",
      "ci.yml/refusal",
    ]);
  });

  test("passes here, with the summary a person reads", () => {
    const out = collector();

    expect(script.run({ root: ROOT, log: out.write, error: collector().write })).toBe(0);
    expect(out.lines.join("\n")).toContain("[check-ci-cost] OK");
    expect(out.lines.join("\n")).toContain("2 of 2 allowed macOS job(s) on every push");
  });
});

/** The one observation a case expects, with the count asserted rather than assumed. */
function only(jobs: ObservedJob[]): ObservedJob {
  expect(jobs).toHaveLength(1);
  return jobs[0] as ObservedJob;
}
