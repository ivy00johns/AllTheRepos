/**
 * Unit test for `scripts/refused-update-check.mjs` — the run that proves the
 * update check stops for the right reason when GitHub refuses to answer.
 *
 * The point of that script is that **a skip is not a pass**: the spec deliberately
 * turns a 403 into a skip, and a skip path nobody exercises is indistinguishable
 * from a guard that stopped guarding. So the value being tested here is the
 * verdict — every way a run can *look* fine without having proven anything has to
 * come out as a failure, with a message that says which way it was:
 *
 *   - the suite exited non-zero, or broke before the tests did;
 *   - the mock never installed, so the run read the real GitHub;
 *   - the mock installed and nothing was ever refused;
 *   - a feed-reading test failed, did not run, did not skip, or skipped for the
 *     ordinary reason a version comparison produces;
 *   - no `::warning::` was emitted, so the reduced coverage is invisible.
 *
 * Fixtures rather than a real run, for the reason `verify-dmg.mjs`'s spec gives:
 * the messages are the product, and they should be read and edited without
 * launching a five-minute Electron suite. What a fixture cannot prove — that the
 * plumbing reaches the real spec and the real mock — is proven by running the
 * command, and by the two assertions at the bottom that read the files this
 * script actually points at.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "refused-update-check.mjs");
const MOCK = path.join(ROOT, "scripts", "refuse-github.cjs");

interface Assessment {
  failures: string[];
  notes: string[];
}

interface Checker {
  MOCK: string;
  SPEC_FILE: string;
  REFUSAL_FILE: string;
  REFUSAL_WORDS: string;
  MUST_REFUSE: string[];
  testsIn(report: unknown): Array<{ title: string; path: string }>;
  assessRun(input?: {
    status?: number | null;
    report?: unknown;
    output?: string;
    mustRefuse?: string[];
  }): Assessment;
}

interface MockModule {
  INSTALLED: symbol;
  MARKER: string;
  REFUSED: string;
}

let checker: Checker;
let mock: MockModule;
let rescued: typeof globalThis.fetch;

beforeAll(async () => {
  // Importing the mock installs it, and vitest runs the whole suite in one forked
  // process — so `fetch` is captured first and put back at the end.
  rescued = globalThis.fetch;
  mock = (await import(pathToFileURL(MOCK).href)) as unknown as MockModule;
  checker = (await import(pathToFileURL(SCRIPT).href)) as unknown as Checker;
});

afterAll(() => {
  globalThis.fetch = rescued;
});

/** How Playwright reports one test: a status, and any skip it recorded. */
type Ending = "expected" | "skipped" | "unexpected";

function specOf(
  title: string,
  ending: Ending,
  options: { reason?: string; error?: string } = {},
) {
  return {
    title,
    // Always `true`, and that is exactly why the checker does not read it:
    // Playwright reports a skipped test as `ok: true`.
    ok: true,
    tests: [
      {
        status: ending,
        expectedStatus: ending === "expected" ? "passed" : ending,
        annotations:
          options.reason === undefined
            ? []
            : [{ type: "skip", description: options.reason }],
        results: [
          {
            status: ending === "expected" ? "passed" : ending,
            errors:
              options.error === undefined ? [] : [{ message: options.error }],
          },
        ],
      },
    ],
  };
}

/** The nesting Playwright writes: a file suite, a describe inside it, then specs. */
function reportOf(...groups: Array<{ title: string; specs: unknown[] }>) {
  return {
    config: {},
    stats: {},
    errors: [] as Array<{ message?: string }>,
    suites: groups.map((group) => ({
      title: "packaged-update-check.spec.ts",
      specs: [],
      suites: [{ title: group.title, specs: group.specs }],
    })),
  };
}

const FEED_TEST = "reaches the public feed anonymously and reports up to date";
const BEHIND_TEST = "offers the published release when the build is behind it";
const ARCHIVE_TEST = "downloads, matches its manifest, and unpacks to a signed bundle";
const ADHOC_TEST = "explains an ad-hoc first launch, and remembers once told";

/**
 * The reason a refusal skip carries, as the spec builds it.
 *
 * A function rather than a constant, along with {@link mockInstalled}: both read
 * the modules under test, and those are imported in `beforeAll` — a constant here
 * would be evaluated while this file is still being collected, before anything
 * has been imported at all.
 */
const refusalReason = () =>
  `${checker.REFUSAL_WORDS} (HTTP 403), so this says nothing about ivy00johns/alltherepos-releases's feed.`;

/** A skip for the reason this job exists to distinguish itself from. */
const VERSION_SKIP =
  "the packaged build is 0.1.6 but the feed's latest release is 0.1.7 — this branch needs the build that was released";

/** What a mock that was loaded into the worker prints, and that it refused one. */
const mockInstalled = () =>
  `${mock.MARKER}\n${mock.REFUSED}https://api.github.com/repos/ivy00johns/alltherepos-releases/releases/latest\n`;

/** What the checker receives, and what a fixture can therefore spoil. */
interface RunFixture {
  status: number | null;
  report: unknown;
  output: string;
}

function refusedRun(): RunFixture {
  return {
    status: 0,
    report: reportOf(
      {
        title: "the packaged app's update check",
        specs: [
          specOf(FEED_TEST, "skipped", { reason: refusalReason() }),
          specOf(ADHOC_TEST, "expected"),
          // The older bundle is what puts this one in front of the feed — see the
          // `MUST_REFUSE` test below for why `ci.yml` builds it.
          specOf(BEHIND_TEST, "skipped", { reason: refusalReason() }),
        ],
      },
      {
        title: "the archive the feed offers",
        specs: [specOf(ARCHIVE_TEST, "skipped", { reason: refusalReason() })],
      },
    ),
    output: `${mockInstalled()}::warning::${refusalReason()}\n`,
  };
}

/** The same run, with one thing spoiled. */
function spoiled(change: Partial<RunFixture>): RunFixture {
  return { ...refusedRun(), ...change };
}

describe("a run that covered the refusal path", () => {
  test("is a pass, and nothing else in it needs to have been asserted", () => {
    expect(checker.assessRun(refusedRun()).failures).toEqual([]);
  });

  test("names each feed-reading test that stopped, and how the run ended", () => {
    const { notes } = checker.assessRun(refusedRun());
    const said = notes.join("\n");

    expect(said).toContain(FEED_TEST);
    expect(said).toContain(ARCHIVE_TEST);
    expect(said).toContain("stopped because GitHub refused to answer");
    expect(said).toContain("4 tests: 1 passed, 3 skipped, 0 failed");
    expect(said).toContain("1 GitHub request answered with a 403");
  });
});

describe("a run that proves nothing is a failure", () => {
  test("when the suite exited non-zero, whatever the report says", () => {
    const { failures } = checker.assessRun(spoiled({ status: 1 }));
    expect(failures.join("\n")).toContain("the suite exited 1");
  });

  test("when the run broke before the tests did, and the reason is printed", () => {
    const report = {
      ...reportOf({
        title: "the packaged app's update check",
        specs: [specOf(FEED_TEST, "skipped", { reason: refusalReason() })],
      }),
      errors: [{ message: "[e2e setup] pnpm electron:rebuild exited 255" }],
    };

    const { failures } = checker.assessRun(spoiled({ report }));

    expect(failures.join("\n")).toContain("before the tests did");
    expect(failures.join("\n")).toContain("electron:rebuild exited 255");
  });

  test("when there is no report to read at all", () => {
    const { failures } = checker.assessRun(spoiled({ report: null }));
    expect(failures.join("\n")).toContain("no JSON report");
  });

  test("when the report carries no tests", () => {
    const { failures } = checker.assessRun(spoiled({ report: reportOf() }));
    expect(failures.join("\n")).toContain("reported no tests at all");
  });

  test("when the mock never installed — the run read the real GitHub", () => {
    // The failure this check exists for. Without this assertion the whole job
    // could quietly stop mocking anything and stay green.
    const { failures } = checker.assessRun(spoiled({ output: "" }));

    expect(failures.join("\n")).toContain("the refusal was never installed");
    expect(failures.join("\n")).toContain("no GitHub read was ever refused");
  });

  test("when the mock installed and refused nothing", () => {
    const { failures } = checker.assessRun(
      spoiled({ output: `::warning::${refusalReason()}\n${mock.MARKER}\n` }),
    );

    expect(failures.join("\n")).toContain("no GitHub read was ever refused");
  });

  test("when nothing said the coverage was reduced", () => {
    const { failures } = checker.assessRun(spoiled({ output: mockInstalled() }));

    expect(failures.join("\n")).toContain("no ::warning:: was emitted");
  });

  test("when a test in the suite failed, named with its own error", () => {
    const report = reportOf({
      title: "the packaged app's update check",
      specs: [
        specOf(FEED_TEST, "skipped", { reason: refusalReason() }),
        specOf(ADHOC_TEST, "unexpected", {
          error: "Error: expect(locator).toBeVisible() failed",
        }),
        specOf(ARCHIVE_TEST, "skipped", { reason: refusalReason() }),
      ],
    });

    const { failures } = checker.assessRun(spoiled({ report }));
    const said = failures.join("\n");

    expect(said).toContain(ADHOC_TEST);
    expect(said).toContain("ended as unexpected");
    expect(said).toContain("expect(locator).toBeVisible() failed");
  });

  test("when a feed-reading test did not run at all", () => {
    const report = reportOf({
      title: "the packaged app's update check",
      specs: [specOf(FEED_TEST, "skipped", { reason: refusalReason() })],
    });

    const { failures } = checker.assessRun(spoiled({ report }));

    expect(failures.join("\n")).toContain(`"${ARCHIVE_TEST}" did not run`);
  });

  test("when a feed-reading test ran to a verdict instead of stopping", () => {
    // The shape of a guard that was removed: the read is a 403, nothing catches
    // it, and the test asserts on a status it never received.
    const report = reportOf({
      title: "the packaged app's update check",
      specs: [
        specOf(FEED_TEST, "unexpected", { error: "Error: expect(received).toBe(200)" }),
        specOf(ARCHIVE_TEST, "skipped", { reason: refusalReason() }),
      ],
    });

    const { failures } = checker.assessRun(spoiled({ report }));

    expect(failures.join("\n")).toContain(`"${FEED_TEST}" was not skipped`);
  });

  test("when it skipped for the ordinary reason, which is not this one", () => {
    const report = reportOf(
      {
        title: "the packaged app's update check",
        specs: [specOf(FEED_TEST, "skipped", { reason: VERSION_SKIP })],
      },
      {
        title: "the archive the feed offers",
        specs: [specOf(ARCHIVE_TEST, "skipped", { reason: refusalReason() })],
      },
    );

    const { failures } = checker.assessRun(spoiled({ report }));
    const said = failures.join("\n");

    expect(said).toContain("skipped for another reason");
    // The reason is printed, so a reader can see it was the version comparison
    // and not the thing this job is about.
    expect(said).toContain("0.1.6");
  });

  test("and the whole unmocked run, as a laptop produces it, is a failure", () => {
    // The run this job exists to catch: no mock in the process, the feed answers
    // normally, the version comparison skips the first test, and the archive test
    // passes because the real release is intact. Green, and about nothing.
    const report = reportOf(
      {
        title: "the packaged app's update check",
        specs: [
          specOf(FEED_TEST, "skipped", { reason: VERSION_SKIP }),
          specOf(ADHOC_TEST, "expected"),
        ],
      },
      {
        title: "the archive the feed offers",
        specs: [specOf(ARCHIVE_TEST, "expected")],
      },
    );

    const { failures } = checker.assessRun({
      status: 0,
      report,
      output: "  2 skipped\n  2 passed (6m)\n",
    });
    const said = failures.join("\n");

    expect(failures.length).toBeGreaterThanOrEqual(3);
    expect(said).toContain("the refusal was never installed");
    expect(said).toContain("skipped for another reason");
    expect(said).toContain("no ::warning:: was emitted");
  });

  test("and every reason is reported, not just the first", () => {
    // A check that stopped at the first problem would report the least
    // interesting one and hide the rest.
    const { failures } = checker.assessRun({
      status: 1,
      report: null,
      output: "something else entirely",
    });

    expect(failures.length).toBeGreaterThanOrEqual(4);
  });
});

describe("what the script points at", () => {
  test("is the committed mock, and the spec the release pipeline runs", () => {
    expect(checker.MOCK).toBe(path.join(ROOT, "scripts", "refuse-github.cjs"));
    expect(fs.existsSync(checker.MOCK)).toBe(true);
    expect(fs.existsSync(checker.SPEC_FILE)).toBe(true);
  });

  test("the tests it requires are still the tests in that spec", () => {
    // Without this, a rename would leave the list matching nothing and the check
    // would fail every run for a reason that looks like a code problem — or, if
    // the names were only ever compared by prefix, quietly assert less.
    const spec = fs.readFileSync(checker.SPEC_FILE, "utf8");

    expect(checker.MUST_REFUSE.length).toBe(3);
    for (const title of checker.MUST_REFUSE) {
      expect(spec, title).toContain(`"${title}"`);
    }
  });

  test("the words it looks for come from the file the spec reads", () => {
    // The coupling this used to carry by hand: this script matched a sentence and
    // a unit test grepped the spec to check the sentence was still there. Both
    // now read `src/shared/github-refusal.json`, so there is nothing left to keep
    // in step.
    const shared = JSON.parse(fs.readFileSync(checker.REFUSAL_FILE, "utf8")) as {
      anonymousRead: string;
    };

    expect(checker.REFUSAL_WORDS).toBe(shared.anonymousRead);
    expect(fs.readFileSync(checker.SPEC_FILE, "utf8")).toContain(
      "src/shared/github-refusal",
    );
  });

  test("requires all three tests that read the feed, and says why two bundles are needed", () => {
    // The third one only reads the feed once it has found a build that is behind
    // it, so `ci.yml` builds `electron:pack-older` as well as `electron:pack`. If
    // that build were ever dropped, this list would demand a skip that cannot
    // happen — the job would go red, which is better than it going quiet.
    expect(checker.MUST_REFUSE).toEqual([FEED_TEST, BEHIND_TEST, ARCHIVE_TEST]);
  });

  test("and the spec is never told it is being mocked", () => {
    // Out of band on purpose: a spec that knew would be a second code path, taken
    // only where the mock is installed. It has to stay the file the release runs,
    // byte for byte.
    const spec = fs.readFileSync(checker.SPEC_FILE, "utf8");

    expect(spec).not.toContain("refuse-github");
    expect(spec).not.toContain("NODE_OPTIONS");
  });
});
