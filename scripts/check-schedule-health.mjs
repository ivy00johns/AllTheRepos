#!/usr/bin/env node
/**
 * Report whether every workflow that declares a clock has actually run on it.
 *
 * A scheduled workflow is the one kind of gate that fails by *not* happening.
 * Nothing goes red, no log fills with errors, and no notification is sent — the
 * run simply never appears. The ways it can stop are all quiet ones: GitHub
 * disables a workflow after 60 days without repository activity, someone
 * disables one by hand while debugging, a cron is edited into a shape GitHub
 * reads differently, the file is renamed, or a `schedule:` is added on a branch,
 * where it never fires at all. The last one is not hypothetical here — this
 * repository learned that a workflow has to be on the default branch before a
 * tag can start it.
 *
 * So this asks GitHub the only question that settles it: for every workflow in
 * this checkout that declares a `schedule`, when did it last produce a run with
 * `event=schedule`, and is it still enabled? A gate that is not `active`, or that
 * has gone longer than its own cadence plus a window without a scheduled run, is
 * reported and fails the job.
 *
 * The two exceptions, both of which would otherwise be false alarms:
 *
 *   - **A workflow that has never run on its clock and is younger than that
 *     window.** `updater-feed.yml` was added on a Tuesday; its first sweep is the
 *     following Monday, and nothing is wrong until then.
 *   - **A gate that could not be read at all** — a rate limit, a network
 *     failure, a 5xx. That is not a verdict on the gate, so it is reported and
 *     does not fail the run, the same bargain the link check and the feed check
 *     strike.
 *
 * What it *cannot* catch is every clock stopping at once: this digest is itself a
 * scheduled workflow, so if the whole set goes quiet it goes quiet with them. It
 * answers the question that has an owner — one gate has stopped while the
 * repository is alive and being pushed to.
 *
 * Usage:
 *   node scripts/check-schedule-health.mjs
 *   node scripts/check-schedule-health.mjs --repo owner/name
 *
 * Exit codes, and the first is the one to read carefully:
 *
 *   0 — every scheduled gate has run on its clock, and is enabled.
 *   1 — at least one has not. A verdict, and the whole reason this exists.
 *   2 — GitHub could not be read (rate limit, network, 5xx). Reported; the
 *       workflow does not fail on it, because that is not a gate going quiet.
 *   3 — the digest cannot do its job at all: no token, no repository, a token
 *       that cannot read Actions, or a cron in a shape this checker does not
 *       understand. That one fails loudly, because a digest that cannot look is
 *       exactly the silence it was written to catch.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WORKFLOW_DIR = path.join(".github", "workflows");

const API_ROOT = "https://api.github.com";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Every workflow in this checkout that declares a `schedule`, with its cadence.
 *
 * Read from the files rather than from GitHub because the files are the source of
 * truth for what *should* be running: a workflow deleted from GitHub but still in
 * the tree is a gate that stopped, and GitHub alone cannot tell you about it.
 * Which is also why `auditGate` treats "GitHub has no workflow for this file" as
 * a failure rather than as nothing to check.
 *
 * A `schedule:` with no cron line at all, or a cron in a shape this checker does
 * not understand, throws: the checker being unable to read a gate is a fault in
 * the checker, and silently skipping it would be the failure mode this file is
 * about.
 *
 * @param {string} [root] repository root, for tests.
 * @returns {Array<{file: string, name: string, cron: string, cadence: string, periodMs: number}>}
 */
export function scheduledWorkflows(root = ROOT) {
  const dir = path.join(root, WORKFLOW_DIR);
  const gates = [];

  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;

    const text = fs.readFileSync(path.join(dir, entry), "utf8");
    // Top level, exactly two spaces in: a `schedule:` nested in a job or named in
    // a comment is not a trigger.
    if (!/^  schedule:$/m.test(text)) continue;

    // A literal `/`, not `path.join`: the same string is compared against the
    // path GitHub reports (`.github/workflows/…`), which is always a URL.
    const file = `.github/workflows/${entry}`;
    const name = /^name:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? entry;
    const crons = [
      ...text.matchAll(/^\s*-\s*cron:\s*["']?([^"'\n]+)["']?\s*$/gm),
    ].map((match) => match[1].trim());

    if (crons.length === 0) {
      throw new Error(`${file} declares a schedule with no readable cron line`);
    }

    for (const cron of crons) {
      const { cadence, periodMs } = periodOf(cron);
      gates.push({ file, name, cron, cadence, periodMs });
    }
  }

  return gates;
}

/**
 * How often one cron line fires, for the three shapes this repository writes.
 *
 * Only the shapes are read, not the times: what the digest needs from a cron is
 * how long it should be between sweeps, because everything it asserts is about
 * whether one happened at all. A cron it cannot read — a range, a list, a step,
 * an hour-and-day-of-month it has no window for — throws rather than being
 * approximated, since a wrong window here would be a red run about nothing.
 *
 * @returns {{cadence: string, periodMs: number}}
 */
export function periodOf(cron) {
  const fields = (cron ?? "").trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`"${cron}" is not a five-field cron line`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

  if (month !== "*" || dayOfMonth !== "*") {
    throw new Error(
      `"${cron}" schedules by month or day-of-month, which this checker has no window for`,
    );
  }

  if (dayOfWeek !== "*") {
    if (!/^\d$/.test(dayOfWeek)) {
      throw new Error(
        `"${cron}" names more than one day of week ("${dayOfWeek}"), which this checker has no window for`,
      );
    }
    return { cadence: "weekly", periodMs: 7 * DAY_MS };
  }

  if (hour !== "*") {
    if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour)) {
      throw new Error(`"${cron}" is not a plain daily time`);
    }
    return { cadence: "daily", periodMs: DAY_MS };
  }

  if (/^\d{1,2}$/.test(minute)) return { cadence: "hourly", periodMs: HOUR_MS };

  throw new Error(`"${cron}" fires more often than hourly, which this checker has no window for`);
}

/**
 * How long past its own cadence a gate may go before the gap is worth reporting.
 *
 * A seventh of the period, floored at half an hour: a weekly sweep gets a day,
 * a daily one gets a few hours, an hourly one gets half an hour. GitHub runs
 * scheduled workflows on a best-effort basis and delays them under load, so a
 * window of exactly one period would report normal jitter as rot.
 */
export function windowFor(periodMs) {
  return periodMs + Math.max(Math.round(periodMs / 7), 30 * 60_000);
}

/** "3 days" / "5 hours" / "12 minutes", for a span of milliseconds. */
function ago(ms) {
  if (ms < HOUR_MS) return `${Math.max(1, Math.round(ms / 60_000))} minutes`;
  if (ms < DAY_MS) return `${Math.round(ms / HOUR_MS)} hours`;
  return `${Math.round(ms / DAY_MS)} days`;
}

/**
 * What to say about one gate.
 *
 * Pure, so every branch below is unit-tested against a fixture rather than
 * against a workflow somebody has to break first.
 *
 * @returns {{ok: boolean, line: string}}
 */
export function auditGate({ gate, workflow = null, run = null, now = Date.now() }) {
  const prefix = `${gate.file}`;

  if (workflow === null) {
    return {
      ok: false,
      line: `✗ ${prefix} — ${gate.name} declares a schedule, but GitHub has no workflow for it on the default branch (a schedule anywhere else never fires)`,
    };
  }

  if (workflow.state !== "active") {
    return {
      ok: false,
      line: `✗ ${prefix} — GitHub has it "${workflow.state}": nothing on its ${gate.cadence} clock will run again until somebody re-enables it`,
    };
  }

  const windowMs = windowFor(gate.periodMs);
  const last = run?.created_at ? Date.parse(run.created_at) : null;

  if (last !== null && now - last <= windowMs) {
    const outcome = run.conclusion ?? run.status ?? "unknown";
    return {
      ok: true,
      line: `✓ ${prefix} — ${gate.cadence} clock, last scheduled run ${ago(now - last)} ago (${outcome})`,
    };
  }

  if (last === null) {
    const createdAt = workflow.created_at ? Date.parse(workflow.created_at) : null;
    if (createdAt !== null && now - createdAt <= windowMs) {
      return {
        ok: true,
        line: `· ${prefix} — ${gate.cadence} clock, nothing due yet: the workflow is younger than the window one sweep of it needs`,
      };
    }
    return {
      ok: false,
      line: `✗ ${prefix} — it declares a ${gate.cadence} schedule and has never produced a scheduled run`,
    };
  }

  return {
    ok: false,
    line: `✗ ${prefix} — its ${gate.cadence} clock has gone quiet: the last scheduled run was ${ago(now - last)} ago`,
  };
}

/** One authenticated read of the GitHub API. */
async function api(pathname, { fetchImpl, token }) {
  const response = await fetchImpl(`${API_ROOT}${pathname}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "alltherepos-schedule-health",
      authorization: `Bearer ${token}`,
    },
  });
  if (response.status !== 200) return { status: response.status, body: null };
  return { status: 200, body: await response.json() };
}

/**
 * What a non-200 from GitHub means for this run.
 *
 * A refusal is not always somebody else's: without `actions: read` the token
 * answers 403 for every read here, and that is the digest being unable to look
 * — which is the failure it exists to catch, not a reason to stay quiet. So the
 * distinction is drawn on the credential, and everything else — a rate limit, a
 * 5xx, a lost network — is the world being unavailable.
 */
export function couldNotRead(status) {
  if (status === 401 || status === 403 || status === 404) return 3;
  return 2;
}

/**
 * The whole digest, with the network injected so it can be driven from a fixture.
 *
 * @returns {Promise<number>} the process exit code this run deserves
 */
export async function runScheduleHealth({
  repo = process.env.GITHUB_REPOSITORY ?? "",
  token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "",
  root = ROOT,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  log = console.log,
  error = console.error,
} = {}) {
  if (!repo) {
    error(
      "[check-schedule-health] no repo to read — pass --repo or set GITHUB_REPOSITORY",
    );
    return 3;
  }
  if (!token) {
    error(
      "[check-schedule-health] no token, so this run cannot look at the Actions API at all. The workflow has to hand one over (`GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` with `actions: read`); a digest that cannot look is the silence it exists to catch.",
    );
    return 3;
  }

  let gates;
  try {
    gates = scheduledWorkflows(root);
  } catch (thrown) {
    error(`[check-schedule-health] cannot read the scheduled gates: ${thrown?.message ?? thrown}`);
    return 3;
  }

  if (gates.length === 0) {
    error(
      "[check-schedule-health] no workflow in this checkout declares a schedule — if that is true, nothing here has a clock to check, and this digest has nothing to do.",
    );
    return 3;
  }

  log(
    `[check-schedule-health] ${gates.length} scheduled gate(s) in ${repo}: ${[...new Set(gates.map((gate) => gate.file))].join(", ")}`,
  );

  let listed;
  try {
    listed = await api(`/repos/${repo}/actions/workflows?per_page=100`, {
      fetchImpl,
      token,
    });
  } catch (thrown) {
    error(`[check-schedule-health] could not reach GitHub: ${thrown?.message ?? thrown}`);
    return 2;
  }
  if (listed.status !== 200) {
    const code = couldNotRead(listed.status);
    error(
      code === 3
        ? `[check-schedule-health] GitHub answered ${listed.status} for ${repo}'s workflows — a wrong repository name, or a token without "actions: read", which is this digest being unable to look.`
        : `[check-schedule-health] GitHub answered ${listed.status} — cannot read the workflows at all. Try again later; this says nothing about the gates.`,
    );
    return code;
  }

  const byPath = new Map(
    (listed.body?.workflows ?? []).map((workflow) => [`/${workflow.path}`, workflow]),
  );

  let failures = 0;
  let unreadable = 0;

  for (const gate of gates) {
    const workflow = byPath.get(`/${gate.file}`) ?? null;
    let run = null;

    if (workflow !== null) {
      let runs;
      try {
        runs = await api(
          `/repos/${repo}/actions/workflows/${path.basename(gate.file)}/runs?event=schedule&per_page=1`,
          { fetchImpl, token },
        );
      } catch (thrown) {
        error(
          `[check-schedule-health] could not reach GitHub for ${gate.file}: ${thrown?.message ?? thrown}`,
        );
        return 2;
      }
      if (runs.status !== 200) {
        // Not a verdict on the gate: say so, and let a failure elsewhere decide
        // the exit code.
        unreadable += 1;
        log(
          `? ${gate.file} — its runs could not be read (HTTP ${runs.status}); not a verdict on whether it ran`,
        );
        continue;
      }
      run = runs.body?.workflow_runs?.[0] ?? null;
    }

    const verdict = auditGate({ gate, workflow, run, now });
    // A gate that has gone quiet is a failure, so it is printed as one — the
    // difference is what somebody reading a red run's log sees first.
    if (verdict.ok) log(verdict.line);
    else {
      error(verdict.line);
      failures += 1;
    }
  }

  if (failures > 0) {
    error(
      `[check-schedule-health] FAILED — ${failures} scheduled gate(s) are not running on their clock. A schedule that stopped is invisible until somebody looks; that is what this digest is for.`,
    );
    return 1;
  }

  if (unreadable > 0) {
    error(
      `[check-schedule-health] ${unreadable} gate(s) could not be read — the rest are running on their clocks, but this run cannot say the same about those.`,
    );
    return 2;
  }

  log(
    "[check-schedule-health] OK — every scheduled gate is enabled and has run within its own window.",
  );
  return 0;
}

function flagValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
}

/**
 * True when this file is the program Node was asked to run.
 *
 * Compared through `fs.realpathSync`, not as strings: the same file has two
 * paths whenever a symlink is involved — on macOS `os.tmpdir()` hands back
 * `/var/folders/...` while the loader resolves it to `/private/var/...` — and a
 * string compare then quietly does nothing at all, exiting 0 as if every gate
 * had been checked.
 */
function isMainModule() {
  if (typeof process.argv[1] !== "string") return false;
  try {
    return (
      fs.realpathSync(fileURLToPath(import.meta.url)) ===
      fs.realpathSync(process.argv[1])
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const args = process.argv.slice(2);
  runScheduleHealth({ repo: flagValue(args, "--repo") ?? undefined })
    .then((code) => process.exit(code))
    .catch((thrown) => {
      // Not 2: reaching here means the digest threw, which is a fault in the
      // digest rather than a rate limit or a gate that has gone quiet.
      console.error(`[check-schedule-health] ${thrown?.message ?? thrown}`);
      process.exit(3);
    });
}
