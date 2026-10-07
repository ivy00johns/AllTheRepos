/**
 * Unit test for `scripts/drill-refused-update-check.mjs` — the run that proves
 * the refusal check can still fail.
 *
 * `pnpm test:packaged-update-refused` is a gate that spends a macOS runner on
 * asserting a *skip*: when GitHub refuses to answer, the update check stops
 * instead of failing. The regression worth worrying about is not that the gate
 * goes red — it is that it stays green while quietly asserting less, because the
 * mock stopped refusing. Nothing in a passing run says otherwise.
 *
 * So the drill throws the switch that makes the mock refuse nothing, runs the
 * real command, and demands a failure. What is tested here is that it accepts
 * only the right failure: a check that *passed* is a failed drill, and so is one
 * that failed because a bundle was missing, because the log was never reached, or
 * because the real GitHub was rate-limiting too — in which case the two states
 * are indistinguishable and the honest answer is "try again later" rather than a
 * green tick.
 *
 * Fixtures rather than a five-minute Electron run, for the reason the other
 * scripts' specs give: the messages are the product, and the plumbing that
 * reaches the real command is proven by running it.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const DRILL = path.join(ROOT, "scripts", "drill-refused-update-check.mjs");
const RUNNER = path.join(ROOT, "scripts", "refused-update-check.mjs");
const MOCK = path.join(ROOT, "scripts", "refuse-github.cjs");

const read = (relative: string) =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

interface Assessment {
  failures: string[];
  notes: string[];
}

interface Drill {
  COMMAND: string;
  assessDrill(input?: { status?: number | null; output?: string }): Assessment;
}

interface Runner {
  ARCHIVE_TEST: string;
  MUST_REFUSE: string[];
  REASONS: Record<string, string>;
}

interface MockModule {
  MARKER: string;
  OFF: string;
  SWITCH: string;
}

let drill: Drill;
let runner: Runner;
let mock: MockModule;
let rescued: typeof globalThis.fetch;

beforeAll(async () => {
  // Importing the mock installs it, and vitest runs the whole suite in one
  // forked process — so `fetch` is captured first and put back at the end.
  rescued = globalThis.fetch;
  mock = (await import(pathToFileURL(MOCK).href)) as unknown as MockModule;
  runner = (await import(pathToFileURL(RUNNER).href)) as unknown as Runner;
  drill = (await import(pathToFileURL(DRILL).href)) as unknown as Drill;
});

afterAll(() => {
  globalThis.fetch = rescued;
});

/** What the check prints when it has failed the right way. */
function caughtOutput(): string {
  return [
    mock.MARKER,
    `  ✗ ${runner.REASONS.nothingRefused} — the requests never reached the mock`,
    `  ✗ "${runner.ARCHIVE_TEST}" ${runner.REASONS.notSkipped} (expected) — with GitHub refusing to answer, it has to stop with a reason rather than assert anything about the feed`,
    "[refused-update-check] FAILED — 4 problem(s) with the run against a refusal",
  ].join("\n");
}

function caught(): { status: number; output: string } {
  return { status: 1, output: caughtOutput() };
}

describe("a mock that has stopped refusing", () => {
  test("is caught: the check fails, and says why", () => {
    const { failures, notes } = drill.assessDrill(caught());

    expect(failures).toEqual([]);
    expect(notes.join("\n")).toContain("failure path is intact");
  });

  test("and the drill's own reason is named, from the check's vocabulary", () => {
    // Imported, not copied: a second copy of these strings in the drill would be
    // the one thing in it that could drift while still looking green.
    const said = drill.assessDrill(caught()).notes.join("\n");
    expect(said).toContain(runner.REASONS.nothingRefused);
  });
});

describe("anything else the drill could be fooled by", () => {
  test("a check that PASSED the run it was supposed to fail", () => {
    const { failures } = drill.assessDrill({
      status: 0,
      output: caughtOutput(),
    });

    expect(failures.join("\n")).toContain("PASSED");
    expect(failures.join("\n")).toContain("not guarding anything");
  });

  test("a check that could not run at all", () => {
    for (const status of [2, 130, null]) {
      const { failures } = drill.assessDrill({ status, output: caughtOutput() });

      expect(failures.join("\n"), String(status)).toContain("exited");
    }
  });

  test("a mock that was never installed, switch or no switch", () => {
    // Distinguishable from the drilled state on purpose: the switched-off mock
    // still prints its marker, so a run without it did not exercise the mock at
    // all — and a drill that accepted that would prove nothing about the mock.
    const { failures } = drill.assessDrill({
      status: 1,
      output: caughtOutput().replace(mock.MARKER, ""),
    });

    expect(failures.join("\n")).toContain("never installed");
  });

  test("a failure that had nothing to do with a refusal", () => {
    // A dead bundle, a full disk, a broken screenshot: the check fails, and the
    // drill would be asserting nothing if it took that for a pass.
    const { failures } = drill.assessDrill({
      status: 1,
      output: caughtOutput().replace(runner.REASONS.nothingRefused, "something else entirely"),
    });

    expect(failures.join("\n")).toContain(runner.REASONS.nothingRefused);
  });

  test("a real GitHub that refused too, so nothing can be told apart", () => {
    // The neutered mock and an exhausted address look the same from here: both
    // leave the spec skipping for the refusal, and the check failing only because
    // the mock's own refusal lines are missing. The drill says so, and says what
    // to do about it, rather than reporting a tick it cannot justify.
    const output = [
      mock.MARKER,
      `  ✗ ${runner.REASONS.nothingRefused} — the requests never reached the mock`,
    ].join("\n");

    const { failures } = drill.assessDrill({ status: 1, output });
    const said = failures.join("\n");

    expect(said).toContain(runner.REASONS.notSkipped);
    expect(said).toContain("exhausted");
    expect(said).toContain("dispatch again");
  });

  test("and every reason is reported, not just the first", () => {
    const { failures } = drill.assessDrill({ status: 0, output: "" });

    expect(failures.length).toBeGreaterThanOrEqual(4);
  });
});

describe("what the drill drills", () => {
  test("is the command CI runs, not a second way to run the spec", () => {
    // The whole claim of a drill is that its subject is the real thing. If this
    // named its own playwright invocation, it would be proving something about a
    // command nobody runs.
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts[drill.COMMAND]).toBe("node scripts/refused-update-check.mjs");
  });

  test("and the switch it throws is the one the mock reads", () => {
    const source = read("scripts/drill-refused-update-check.mjs");

    expect(mock.SWITCH).toBe("ATR_REFUSE_GITHUB");
    expect(mock.OFF).toBe("off");
    // Named from the mock rather than typed here, for the same anti-drift reason
    // as the reasons above.
    expect(source).toContain("refuseGithub.SWITCH");
    expect(source).not.toContain('"ATR_REFUSE_GITHUB"');
  });

  test("and the mock still refuses something when it is not thrown", () => {
    // The switch is only a drill if the default is the opposite of it.
    expect(read("scripts/refuse-github.cjs")).toContain(
      "refuse = process.env[SWITCH] !== OFF",
    );
  });
});
