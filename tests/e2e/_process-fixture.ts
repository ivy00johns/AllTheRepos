/**
 * Declare the process sweep for one E2E launch.
 *
 * The process panel is the one input to the app that is a claim about the
 * *host* rather than about this code: it sweeps `lsof` for listening sockets and
 * binds each one to a repo by its cwd. The top bar draws a count badge whenever
 * anything is listening, so a screenshot of the catalog taken while a dev server
 * of the developer's happened to be up carries a badge that the next run does
 * not draw — which is how the `darwin27` table baseline passed on a fresh runner
 * and flaked on the laptop it was regenerated from.
 *
 * A spec that needs a stable picture states the listeners its run sees, through
 * `ATR_PROCESS_FIXTURE` (`PROCESS_FIXTURE_ENV` in `src/main/services/process.ts`,
 * where the file's shape and its failure behaviour are documented). The variable
 * name is spelled out here rather than imported: a spec drives the built bundle
 * in `out/`, and reaching into `src/` for a constant would tie the suite to the
 * source tree's module layout.
 *
 * What this does not do is make the *sweep* hermetic for the whole suite. The
 * specs that prove detection — `process-flow.spec.ts` above all, which spawns a
 * real server and then kills it — are asserting exactly the machinery a fixture
 * replaces, so they keep the real sweep and filter its output by their own PID.
 * A fixture is for the specs whose subject is the screen.
 */

import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { TEMPLATE_PROFILE_ENV } from "./_launch-app";

/** The main-side variable this feeds. See `PROCESS_FIXTURE_ENV` there. */
export const PROCESS_FIXTURE_ENV = "ATR_PROCESS_FIXTURE";

/**
 * The sweep a launch is told to report. Everything is optional, and an omitted
 * field is empty rather than inherited: `listen` with no `ppid` is a listener
 * with no ancestry, which is a statement the app can act on, where an inherited
 * parent map would be the host leaking back in.
 */
export interface ProcessFixtureFile {
  /** What the `lsof` sweep would have printed. */
  listen?: Array<{
    pid: number;
    port: number;
    command?: string;
    host?: string;
  }>;
  /** The `pid -> ppid` map the parent walk reads. */
  ppid?: Record<string, number>;
  /** The `pid -> cwd` map the repo binding reads. */
  cwd?: Record<string, string>;
}

/** A fixture that declares no listeners: a sweep of it finds nothing. */
export const NO_LISTENERS: ProcessFixtureFile = { listen: [] };

/**
 * Write `fixture` where the app can read it, and return the environment that
 * points at it for `launchApp({ env })`.
 *
 * The file lands in the suite's own temp root whenever global setup has run —
 * the directory already holding the template profile and the seeded repos, which
 * teardown deletes — so a suite leaves nothing behind. Run outside Playwright
 * (no template advertised) it falls back to a fresh OS temp directory, where a
 * stray file costs the least.
 *
 * Each call writes its own file, so a spec can declare a different sweep for
 * each of its launches without them racing.
 */
export function processFixtureEnv(
  fixture: ProcessFixtureFile,
): Record<string, string> {
  const template = process.env[TEMPLATE_PROFILE_ENV];
  const root = template
    ? dirname(template)
    : mkdtempSync(join(tmpdir(), "atr-process-fixture-"));
  const file = join(root, `process-fixture-${randomUUID()}.json`);
  writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  return { [PROCESS_FIXTURE_ENV]: file };
}
