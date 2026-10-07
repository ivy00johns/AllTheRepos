/**
 * Unit test for `scripts/check-schedule-health.mjs`.
 *
 * A scheduled workflow is the one gate that fails by not happening: no red run,
 * no error, no notification — just a run that never appears. This script is what
 * asks, and these tests are what says it asks correctly:
 *
 *   1. **Which workflows it is about** — read from this checkout, not from a list
 *      somebody maintains. A workflow deleted from GitHub while its file is still
 *      here is a gate that stopped, which is why "GitHub has no such workflow" is
 *      a failure rather than nothing to check.
 *   2. **The windows** — a weekly sweep is allowed a day of slack, and a gate that
 *      is younger than its own window is not reported as silent, because its
 *      first sweep may simply not have come round yet.
 *   3. **The exit codes** — the difference between "a gate has gone quiet" (1),
 *      "GitHub could not be read" (2) and "this digest cannot look at all" (3) is
 *      the whole point of a digest: only the first and last are worth waking
 *      somebody for, and the middle one is somebody else's rate limit.
 *
 * The network is injected, so no test touches GitHub. The real read is proven on
 * demand: `.github/workflows/schedule-health.yml` runs this script weekly, and on
 * a dispatch by hand.
 *
 * The script is imported by URL (a `.mjs` CLI with no declarations).
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPTS = path.join(ROOT, "scripts");

const REPO = "owner/name";
const TOKEN = "test-token";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A Monday afternoon, so "weekly" arithmetic is not done on a boundary. */
const NOW = Date.UTC(2026, 9, 12, 15, 0, 0);

interface Gate {
  file: string;
  name: string;
  cron: string;
  cadence: string;
  periodMs: number;
}

interface Listed {
  path: string;
  name: string;
  state: string;
  created_at: string;
}

interface Run {
  created_at: string;
  conclusion?: string | null;
  status?: string | null;
}

interface HealthModule {
  scheduledWorkflows(root?: string): Gate[];
  periodOf(cron: string): { cadence: string; periodMs: number };
  windowFor(periodMs: number): number;
  auditGate(input: {
    gate: Gate;
    workflow?: Listed | null;
    run?: Run | null;
    now?: number;
  }): { ok: boolean; line: string };
  couldNotRead(status: number): number;
  runScheduleHealth(options?: Record<string, unknown>): Promise<number>;
}

let health: HealthModule;

beforeAll(async () => {
  health = (await import(
    pathToFileURL(path.join(SCRIPTS, "check-schedule-health.mjs")).href
  )) as HealthModule;
});

/** A workflow file to read, in a throwaway tree. */
function fixtureRoot(files: Record<string, string>): string {
  const root = makeTmpDir("atr-schedule");
  const dir = path.join(root, ".github", "workflows");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), text);
  }
  roots.push(root);
  return root;
}

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) cleanupTmp(root);
});

/** Lines a caller would have printed, collected instead. */
function collector(): { lines: string[]; write: (line: unknown) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(String(line)) };
}

interface Route {
  match: (url: string) => boolean;
  status?: number;
  body?: unknown;
}

/** A `fetch` that answers from a table, and records what it was asked for. */
function stubFetch(routes: Route[]): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (url: unknown) => {
    calls.push(String(url));
    const route = routes.find((candidate) => candidate.match(String(url)));
    if (!route) throw new Error(`no stub for ${url}`);
    return {
      status: route.status ?? 200,
      json: async () => route.body ?? {},
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const workflowsRoute = (workflows: Listed[]): Route => ({
  match: (url) => url.includes("/actions/workflows?"),
  body: { workflows },
});

const runsRoute = (gate: Gate, run: Run | null, status = 200): Route => ({
  match: (url) => url.includes(`/actions/workflows/${path.basename(gate.file)}/runs`),
  status,
  body: { workflow_runs: run === null ? [] : [run] },
});

/** The listing GitHub would return for this repository's own gates. */
function listingFor(
  gates: Gate[],
  overrides: Record<string, Partial<Listed>> = {},
): Listed[] {
  return gates.map((gate) => ({
    path: gate.file,
    name: gate.name,
    state: "active",
    created_at: new Date(NOW - 30 * DAY_MS).toISOString(),
    ...overrides[gate.file],
  }));
}

describe("which workflows the digest is about", () => {
  test("reads every workflow here that declares a schedule, and only those", () => {
    const files = [...new Set(health.scheduledWorkflows(ROOT).map((gate) => gate.file))];

    expect(files).toContain(".github/workflows/release.yml");
    expect(files).toContain(".github/workflows/updater-feed.yml");
    expect(files).toContain(".github/workflows/doc-links.yml");
    // Itself included, deliberately: a digest whose own clock nobody checks is
    // the same silence one step further out.
    expect(files).toContain(".github/workflows/schedule-health.yml");
    // ci.yml has no clock, so it is not reported on.
    expect(files).not.toContain(".github/workflows/ci.yml");
  });

  test("every cron in this repository is one the checker understands", () => {
    // The repository's own crons, against the parser: a schedule edited into a
    // shape the checker cannot read has to be a loud failure, and this is where
    // that is found — on the pull request, not on a Monday.
    for (const gate of health.scheduledWorkflows(ROOT)) {
      expect(() => health.periodOf(gate.cron), gate.file).not.toThrow();
      expect(gate.cadence, gate.file).toBe("weekly");
    }
  });

  test("ignores a schedule that is not a trigger", () => {
    const root = fixtureRoot({
      "notes.yml": [
        "name: Notes",
        "jobs:",
        "  build:",
        "    steps:",
        "      # schedule: not this",
        "      - run: echo schedule: and this neither",
        "",
      ].join("\n"),
    });
    expect(health.scheduledWorkflows(root)).toEqual([]);
  });

  test("refuses a schedule it cannot read rather than skipping the gate", () => {
    // A gate quietly dropped from the digest is the failure mode, not a nicety:
    // the point of the check is that nothing goes unreported.
    const root = fixtureRoot({
      "odd.yml": "name: Odd\non:\n  schedule:\n    - cron: \"0 0 1 * *\"\n",
      "empty.yml": "name: Empty\non:\n  schedule:\n",
    });
    expect(() => health.scheduledWorkflows(root)).toThrow(/day-of-month|no readable cron/);
  });

  test("counts a schedule declared more than once", () => {
    const root = fixtureRoot({
      "twice.yml": [
        "name: Twice",
        "on:",
        "  schedule:",
        "    - cron: \"0 9 * * 1\"",
        "    - cron: \"0 15 * * 5\"",
        "",
      ].join("\n"),
    });
    expect(health.scheduledWorkflows(root)).toHaveLength(2);
  });
});

describe("how long a gate may go quiet", () => {
  test("gives a weekly sweep a day of slack", () => {
    expect(health.windowFor(7 * DAY_MS)).toBe(8 * DAY_MS);
  });

  test("scales down to the cadence", () => {
    // A seventh of the period, floored at half an hour: a daily sweep gets a few
    // hours, an hourly one gets half an hour. GitHub delays scheduled runs under
    // load, so a window of exactly one period would report jitter as rot.
    expect(health.windowFor(DAY_MS)).toBeGreaterThan(DAY_MS + HOUR_MS);
    expect(health.windowFor(DAY_MS)).toBeLessThan(DAY_MS + 8 * HOUR_MS);
    expect(health.windowFor(HOUR_MS)).toBe(HOUR_MS + 30 * MINUTE_MS);
  });

  test("reads the three cron shapes this repository could use", () => {
    expect(health.periodOf("30 13 * * 1")).toEqual({
      cadence: "weekly",
      periodMs: 7 * DAY_MS,
    });
    expect(health.periodOf("0 9 * * *")).toEqual({
      cadence: "daily",
      periodMs: DAY_MS,
    });
    expect(health.periodOf("15 * * * *")).toEqual({
      cadence: "hourly",
      periodMs: HOUR_MS,
    });
  });

  test("refuses the shapes it has no window for", () => {
    for (const cron of [
      "0 9 * *",
      "0 9 1 * *",
      "0 9 * 3 *",
      "0 9 * * 1-5",
      "0 9 * * 1,3",
      "* * * * *",
    ]) {
      expect(() => health.periodOf(cron), cron).toThrow();
    }
  });

  test("sorts a status into 'a verdict' or 'somebody else's problem'", () => {
    // 401/403/404 are this digest being unable to look — a token without
    // `actions: read`, a wrong repo name — and that is the silence it exists to
    // catch. Everything else is the world being unavailable.
    expect(health.couldNotRead(401)).toBe(3);
    expect(health.couldNotRead(403)).toBe(3);
    expect(health.couldNotRead(404)).toBe(3);
    expect(health.couldNotRead(429)).toBe(2);
    expect(health.couldNotRead(500)).toBe(2);
    expect(health.couldNotRead(503)).toBe(2);
  });
});

describe("one gate's verdict", () => {
  const gate: Gate = {
    file: ".github/workflows/example.yml",
    name: "Example",
    cron: "0 9 * * 1",
    cadence: "weekly",
    periodMs: 7 * DAY_MS,
  };
  const listed: Listed = {
    path: gate.file,
    name: gate.name,
    state: "active",
    created_at: new Date(NOW - 30 * DAY_MS).toISOString(),
  };
  const ran = (daysAgo: number): Run => ({
    created_at: new Date(NOW - daysAgo * DAY_MS).toISOString(),
    conclusion: "success",
  });

  test("a run inside the window is what passing looks like", () => {
    const verdict = health.auditGate({ gate, workflow: listed, run: ran(6), now: NOW });
    expect(verdict.ok).toBe(true);
    expect(verdict.line).toContain("✓");
    expect(verdict.line).toContain("success");
  });

  test("a run older than the window is the clock going quiet", () => {
    const verdict = health.auditGate({ gate, workflow: listed, run: ran(9), now: NOW });
    expect(verdict.ok).toBe(false);
    expect(verdict.line).toContain("gone quiet");
    expect(verdict.line).toContain("9 days");
  });

  test("a disabled workflow fails even if it ran a moment ago", () => {
    const verdict = health.auditGate({
      gate,
      workflow: { ...listed, state: "disabled_manually" },
      run: ran(1),
      now: NOW,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.line).toContain("disabled_manually");
  });

  test("a file GitHub has no workflow for fails, branch registrations included", () => {
    // A `schedule:` on anything but the default branch never fires, and GitHub's
    // workflow list is the only place that difference is visible.
    const verdict = health.auditGate({ gate, workflow: null, run: null, now: NOW });
    expect(verdict.ok).toBe(false);
    expect(verdict.line).toContain("no workflow for it");
  });

  test("a young workflow that has never run is not yet a failure", () => {
    const verdict = health.auditGate({
      gate,
      workflow: { ...listed, created_at: new Date(NOW - 2 * DAY_MS).toISOString() },
      run: null,
      now: NOW,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.line).toContain("nothing due yet");
  });

  test("an old workflow that has never run is exactly the failure", () => {
    const verdict = health.auditGate({ gate, workflow: listed, run: null, now: NOW });
    expect(verdict.ok).toBe(false);
    expect(verdict.line).toContain("never produced a scheduled run");
  });
});

describe("the digest's exit code", () => {
  // Read here rather than at collection time: the module is imported in
  // `beforeAll`, and a describe body runs before that.
  let gates: Gate[];
  beforeAll(() => {
    gates = health.scheduledWorkflows(ROOT);
  });

  async function run(routes: Route[], overrides: Record<string, unknown> = {}) {
    const log = collector();
    const error = collector();
    const { fetchImpl, calls } = stubFetch(routes);
    const code = await health.runScheduleHealth({
      repo: REPO,
      token: TOKEN,
      root: ROOT,
      now: NOW,
      fetchImpl,
      log: log.write,
      error: error.write,
      ...overrides,
    });
    return { code, log: log.lines.join("\n"), error: error.lines.join("\n"), calls };
  }

  test("passes when every gate is enabled and has run inside its window", async () => {
    const { code, log } = await run([
      workflowsRoute(listingFor(gates)),
      ...gates.map((gate) =>
        runsRoute(gate, {
          created_at: new Date(NOW - 2 * DAY_MS).toISOString(),
          conclusion: "success",
        }),
      ),
    ]);

    expect(code).toBe(0);
    for (const gate of gates) expect(log).toContain(gate.file);
  });

  test("reads each gate's runs through its own file name", async () => {
    const { calls } = await run([
      workflowsRoute(listingFor(gates)),
      ...gates.map((gate) => runsRoute(gate, null)),
    ]);

    for (const gate of gates) {
      expect(
        calls.some((call) => call.includes(`/actions/workflows/${path.basename(gate.file)}/runs`)),
        gate.file,
      ).toBe(true);
    }
    // ... and asks only for scheduled runs, which is the question.
    expect(calls.every((call) => !call.includes("/runs") || call.includes("event=schedule"))).toBe(
      true,
    );
  });

  test("fails when one gate has gone quiet, naming it", async () => {
    const quiet = gates[0];
    const { code, error } = await run([
      workflowsRoute(listingFor(gates)),
      ...gates.map((gate) =>
        runsRoute(gate, {
          created_at: new Date(
            NOW - (gate === quiet ? 12 * DAY_MS : 2 * DAY_MS),
          ).toISOString(),
          conclusion: "success",
        }),
      ),
    ]);

    expect(code).toBe(1);
    expect(error).toContain(quiet.file);
  });

  test("fails when a gate is disabled, whatever its last run says", async () => {
    const { code } = await run([
      workflowsRoute(listingFor(gates, { [gates[0].file]: { state: "disabled_inactivity" } })),
      ...gates.map((gate) =>
        runsRoute(gate, {
          created_at: new Date(NOW - DAY_MS).toISOString(),
          conclusion: "success",
        }),
      ),
    ]);

    expect(code).toBe(1);
  });

  test("fails when GitHub has no workflow for a file that declares a schedule", async () => {
    const listed = listingFor(gates).slice(1);
    const { code } = await run([
      workflowsRoute(listed),
      ...gates.slice(1).map((gate) =>
        runsRoute(gate, {
          created_at: new Date(NOW - DAY_MS).toISOString(),
          conclusion: "success",
        }),
      ),
    ]);

    expect(code).toBe(1);
  });

  test("does not call an unreadable gate a verdict", async () => {
    const { code } = await run([
      workflowsRoute(listingFor(gates)),
      runsRoute(gates[0], null, 500),
      ...gates.slice(1).map((gate) =>
        runsRoute(gate, {
          created_at: new Date(NOW - DAY_MS).toISOString(),
          conclusion: "success",
        }),
      ),
    ]);

    expect(code).toBe(2);
  });

  test("a verdict outranks a gate it could not read", async () => {
    // Both things happened; the one worth waking somebody for is the verdict.
    const { code } = await run([
      workflowsRoute(listingFor(gates)),
      runsRoute(gates[0], null, 500),
      ...gates.slice(1).map((gate) =>
        runsRoute(gate, {
          created_at: new Date(NOW - 30 * DAY_MS).toISOString(),
          conclusion: "success",
        }),
      ),
    ]);

    expect(code).toBe(1);
  });

  test("cannot look at all without a token", async () => {
    const { code, error } = await run([], { token: "" });
    expect(code).toBe(3);
    expect(error).toContain("actions: read");
  });

  test("cannot look at all without a repository", async () => {
    const { code } = await run([], { repo: "" });
    expect(code).toBe(3);
  });

  test("cannot look at all when the token cannot read Actions", async () => {
    const { code, error } = await run([{ match: () => true, status: 403 }]);
    expect(code).toBe(3);
    expect(error).toContain("actions: read");
  });

  test("does not call a rate limit or an outage a verdict", async () => {
    for (const status of [429, 500, 503]) {
      const { code } = await run([{ match: () => true, status }]);
      expect(code, `HTTP ${status}`).toBe(2);
    }
  });

  test("says so when GitHub cannot be reached at all", async () => {
    const log = collector();
    const error = collector();
    const code = await health.runScheduleHealth({
      repo: REPO,
      token: TOKEN,
      root: ROOT,
      now: NOW,
      fetchImpl: (async () => {
        throw new Error("ENOTFOUND api.github.com");
      }) as unknown as typeof fetch,
      log: log.write,
      error: error.write,
    });

    expect(code).toBe(2);
    expect(error.lines.join("\n")).toContain("ENOTFOUND");
  });

  test("has nothing to do in a checkout with no scheduled workflow", async () => {
    const { code, error } = await run([], {
      root: fixtureRoot({ "plain.yml": "name: Plain\non:\n  push:\n" }),
    });
    expect(code).toBe(3);
    expect(error).toContain("no workflow in this checkout declares a schedule");
  });
});
