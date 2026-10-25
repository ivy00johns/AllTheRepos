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

interface Allowance {
  remaining: number;
  limit: number;
  resetAt: Date;
}

interface Assessment {
  failures: string[];
  notes: string[];
  blocked: string | null;
}

interface Drill {
  ALLOWANCE_ONLY: string;
  COMMAND: string;
  RATE_LIMIT_URL: string;
  probeAllowance(input?: {
    checkAllowance?: () => Promise<Allowance | null>;
    log?: (line: string) => void;
    error?: (line: string) => void;
  }): Promise<number>;
  assessDrill(input?: {
    status?: number | null;
    output?: string;
    allowance?: Allowance | null;
    before?: Allowance | null;
  }): Assessment;
  githubAllowance(input?: {
    fetchImpl?: typeof globalThis.fetch;
  }): Promise<Allowance | null>;
  run(input?: {
    root?: string;
    env?: NodeJS.ProcessEnv;
    log?: (line: string) => void;
    error?: (line: string) => void;
    checkAllowance?: () => Promise<Allowance | null>;
    spawn?: (
      cmd: string,
      args: string[],
      options: { cwd?: string; env?: NodeJS.ProcessEnv },
    ) => Promise<{ status: number | null; output: string }>;
  }): Promise<number>;
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
  install(
    target?: { fetch?: typeof globalThis.fetch },
    options?: { refuse?: boolean },
  ): typeof globalThis.fetch;
  underneath(target?: { fetch?: typeof globalThis.fetch }): typeof globalThis.fetch;
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

    const { failures, blocked } = drill.assessDrill({ status: 1, output });
    const said = blocked ?? "";

    expect(failures).toEqual([]);
    expect(said).toContain("was not implicated");
    expect(said).toContain("exhausted");
    expect(said.toLowerCase()).toContain("dispatch again");
  });

  test("and every reason is reported, not just the first", () => {
    const { failures } = drill.assessDrill({ status: 0, output: "" });

    expect(failures.length).toBeGreaterThanOrEqual(4);
  });
});

describe("the runner's allowance, which decides who is at fault", () => {
  /** The output that cannot be told apart: the mock was neutered and nothing ran. */
  function ambiguousOutput(): string {
    return [
      mock.MARKER,
      `  ✗ ${runner.REASONS.nothingRefused} — the requests never reached the mock`,
    ].join("\n");
  }

  const spent = {
    remaining: 0,
    limit: 60,
    resetAt: new Date("2026-10-24T23:12:00Z"),
  };
  const available = {
    remaining: 42,
    limit: 60,
    resetAt: new Date("2026-10-24T23:12:00Z"),
  };

  test("a spent allowance turns the verdict into BLOCKED, not a broken check", () => {
    // This is the run that used to report the same failure as a check that
    // stopped guarding. It cannot prove anything, and it must say which.
    const { failures, blocked } = drill.assessDrill({
      status: 1,
      output: ambiguousOutput(),
      allowance: spent,
    });

    expect(failures).toEqual([]);
    expect(blocked).toContain("allowance is spent");
    expect(blocked).toContain("was not implicated");
    expect(blocked).toContain("Dispatch again after the reset");
  });

  test("an allowance available at both ends of the run sends the reader to the check", () => {
    const { failures, blocked } = drill.assessDrill({
      status: 1,
      output: ambiguousOutput(),
      before: available,
      allowance: available,
    });

    expect(blocked).toBeNull();
    expect(failures.join("\n")).toContain("allowance was available");
    expect(failures.join("\n")).toContain("needs reading");
  });

  test("a spent allowance does not excuse a second problem", () => {
    // A run that also passed the thing it exists to fail is a broken drill no
    // matter how tired the address is.
    const { failures, blocked } = drill.assessDrill({
      status: 0,
      output: ambiguousOutput(),
      allowance: spent,
    });

    expect(blocked).toBeNull();
    expect(failures.join("\n")).toContain("PASSED");
  });

  test("an unreadable allowance keeps the ambiguity rather than guessing", () => {
    const { failures, blocked } = drill.assessDrill({
      status: 1,
      output: ambiguousOutput(),
      allowance: null,
    });

    // Nothing was learned about the address, so nothing can be said about the
    // check: BLOCKED, and the sentence says so instead of reading like a verdict.
    expect(failures).toEqual([]);
    expect(blocked).toContain("could not be read");
    expect(blocked).toContain("was not implicated");
  });

  test("half an answer is not an answer", () => {
    // A reading at one end only says what one address had left at one moment. It
    // cannot show that the address the app's read used was the same one, so it
    // does not clear the check either.
    const { failures, blocked } = drill.assessDrill({
      status: 1,
      output: ambiguousOutput(),
      before: null,
      allowance: available,
    });

    expect(failures).toEqual([]);
    expect(blocked).toContain("could not be read");
  });

  test("a run whose address changed cannot be attributed to the check", () => {
    // The reported shape: `59 of 60, resets at 02:34:16` before the drill and
    // `60 of 60, resets at 02:35:58` after it. Two windows, two addresses — and
    // the reading after the run is about neither of the ones the app's read may
    // have left from. Blaming the check on the strength of it is the failure this
    // whole distinction exists to prevent.
    const earlier = {
      remaining: 59,
      limit: 60,
      resetAt: new Date("2026-10-24T23:34:16Z"),
    };
    const later = {
      remaining: 60,
      limit: 60,
      resetAt: new Date("2026-10-24T23:35:58Z"),
    };

    const { failures, blocked } = drill.assessDrill({
      status: 1,
      output: ambiguousOutput(),
      before: earlier,
      allowance: later,
    });

    const said = blocked ?? "";
    expect(failures).toEqual([]);
    expect(said).toContain("egress address changed");
    expect(said).toContain("was not implicated");
    expect(said).toContain("59 of 60");
    expect(said).toContain("60 of 60");
    // The one thing it must not say: that this is the check's own failure path.
    expect(said).not.toContain("needs reading");
    expect(said).not.toContain("the check's own failure path");
  });

  test("and it still does not excuse a second problem", () => {
    const { failures, blocked } = drill.assessDrill({
      status: 0,
      output: ambiguousOutput(),
      before: { remaining: 59, limit: 60, resetAt: new Date("2026-10-24T23:34:16Z") },
      allowance: { remaining: 60, limit: 60, resetAt: new Date("2026-10-24T23:35:58Z") },
    });

    expect(blocked).toBeNull();
    expect(failures.join("\n")).toContain("PASSED");
    expect(failures.join("\n")).toContain("address changed");
  });

  test("asks GitHub at the endpoint that does not spend what it reports", async () => {
    const asked: string[] = [];
    const reset = Math.floor(Date.parse("2026-10-24T23:12:00Z") / 1000);
    const allowance = await drill.githubAllowance({
      fetchImpl: (async (url: string) => {
        asked.push(String(url));
        return new Response(
          JSON.stringify({
            resources: { core: { remaining: 7, limit: 60, reset } },
          }),
          { status: 200 },
        );
      }) as unknown as typeof globalThis.fetch,
    });

    expect(asked).toEqual([drill.RATE_LIMIT_URL]);
    expect(drill.RATE_LIMIT_URL).toBe("https://api.github.com/rate_limit");
    expect(allowance?.remaining).toBe(7);
    expect(allowance?.limit).toBe(60);
    expect(allowance?.resetAt.toISOString()).toBe("2026-10-24T23:12:00.000Z");
  });

  test("asks through the mock rather than being answered by it", () => {
    // Importing the mock installs it in this process too, so the obvious
    // `globalThis.fetch` here is the thing that answers GitHub with a 403. The
    // allowance question has to reach the fetch underneath it, or a healthy
    // runner would report its allowance as unreadable — the one answer this
    // whole distinction exists to avoid guessing at.
    expect(mock.underneath()).not.toBe(globalThis.fetch);

    const real = (async () => new Response("{}")) as unknown as typeof globalThis.fetch;
    const stand = { fetch: real };
    mock.install(stand, { refuse: true });

    expect(stand.fetch).not.toBe(real);
    expect(mock.underneath(stand)).toBe(real);
  });

  test("answers null rather than a number when it cannot ask", async () => {
    // An unknown allowance must not read as either answer: a guess here would
    // either excuse a broken check or blame a working one.
    const answers: Array<() => Promise<Response>> = [
      async () => new Response("nope", { status: 500 }),
      async () => new Response(JSON.stringify({ resources: {} }), { status: 200 }),
      async () => {
        throw new Error("offline");
      },
    ];

    for (const answer of answers) {
      const allowance = await drill.githubAllowance({
        fetchImpl: answer as unknown as typeof globalThis.fetch,
      });
      expect(allowance).toBeNull();
    }
  });
});

describe("the gate that runs before anything is built", () => {
  test("passes when there is allowance to conclude with", async () => {
    const lines: string[] = [];
    const status = await drill.probeAllowance({
      checkAllowance: async () => ({
        remaining: 42,
        limit: 60,
        resetAt: new Date("2026-10-24T23:12:00Z"),
      }),
      log: (line) => lines.push(line),
      error: () => {},
    });

    expect(status).toBe(0);
    expect(lines.join("\n")).toContain("42 of 60");
  });

  test("stops with BLOCKED, not with a failure, when the allowance is spent", async () => {
    const lines: string[] = [];
    const status = await drill.probeAllowance({
      checkAllowance: async () => ({
        remaining: 0,
        limit: 60,
        resetAt: new Date("2026-10-24T23:12:00Z"),
      }),
      log: () => {},
      error: (line) => lines.push(line),
    });

    expect(status).toBe(3);
    const said = lines.join("\n");
    expect(said).toContain("BLOCKED");
    expect(said).toContain("not implicated");
    expect(said).toContain("were not built");
    expect(said).not.toContain("FAILED");
  });

  test("does not block on a question it could not ask", async () => {
    // Offline is not evidence of a spent allowance. The run goes ahead because
    // it may still be informative, and says afterwards what it could not tell.
    const lines: string[] = [];
    const status = await drill.probeAllowance({
      checkAllowance: async () => null,
      log: (line) => lines.push(line),
      error: () => {},
    });

    expect(status).toBe(0);
    expect(lines.join("\n")).toContain("could not be read");
  });
});

describe("what a blocked drill does", () => {
  test("stops before it builds anything, and says so", async () => {
    // Two packages and a suite are minutes of the most expensive runner here.
    // Finding out the address is spent afterwards is paying for a rate limit.
    let spawned = false;
    const lines: string[] = [];

    const status = await drill.run({
      checkAllowance: async () => ({
        remaining: 0,
        limit: 60,
        resetAt: new Date("2026-10-24T23:12:00Z"),
      }),
      spawn: async () => {
        spawned = true;
        return { status: 1, output: "" };
      },
      log: () => {},
      error: (line) => lines.push(line),
    });

    expect(status).toBe(3);
    expect(spawned).toBe(false);
    expect(lines.join("\n")).toContain("BLOCKED");
    expect(lines.join("\n")).toContain("not implicated");
  });

  test("reports BLOCKED when the address changes under it, and says which reading it distrusted", async () => {
    // The runner's egress rotated mid-run, so the only honest verdict is that
    // this machine was not one address for long enough to ask.
    const allowances = [
      { remaining: 59, limit: 60, resetAt: new Date("2026-10-24T23:34:16Z") },
      { remaining: 60, limit: 60, resetAt: new Date("2026-10-24T23:35:58Z") },
    ];
    const lines: string[] = [];
    const errors: string[] = [];

    const status = await drill.run({
      checkAllowance: async () => allowances.shift() ?? null,
      spawn: async () => ({
        status: 1,
        output: [
          mock.MARKER,
          `  ✗ ${runner.REASONS.nothingRefused} — the requests never reached the mock`,
        ].join("\n"),
      }),
      log: (line) => lines.push(line),
      error: (line) => errors.push(line),
    });

    expect(status).toBe(3);
    expect(errors.join("\n")).toContain("BLOCKED");
    expect(errors.join("\n")).not.toContain("FAILED");
    // Both readings are logged, and the log is where the rotation is visible.
    expect(lines.join("\n")).toContain("59 of 60");
    expect(lines.join("\n")).toContain("address changed while the drill ran");
  });

  test("reports BLOCKED, not FAILED, when the allowance ran out during the run", async () => {
    const allowances = [
      { remaining: 3, limit: 60, resetAt: new Date("2026-10-24T23:12:00Z") },
      { remaining: 0, limit: 60, resetAt: new Date("2026-10-24T23:12:00Z") },
    ];
    const lines: string[] = [];

    const status = await drill.run({
      checkAllowance: async () => allowances.shift() ?? null,
      spawn: async () => ({
        status: 1,
        output: [
          mock.MARKER,
          `  ✗ ${runner.REASONS.nothingRefused} — the requests never reached the mock`,
        ].join("\n"),
      }),
      log: () => {},
      error: (line) => lines.push(line),
    });

    expect(status).toBe(3);
    const said = lines.join("\n");
    expect(said).toContain("BLOCKED");
    expect(said).not.toContain("FAILED");
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
