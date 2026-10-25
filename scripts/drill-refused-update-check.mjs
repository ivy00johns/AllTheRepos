#!/usr/bin/env node
/**
 * Prove the refusal check can still fail.
 *
 * `pnpm test:packaged-update-refused` (see `scripts/refused-update-check.mjs`)
 * asserts that the packaged update check stops, with a reason, when GitHub
 * refuses to answer — and it does that by making GitHub refuse. Which means the
 * one thing nothing notices is the check **stopping noticing**: the mock loads, refuses
 * nothing, every test goes green for its ordinary reasons, and the gate is
 * decorative. The numbers barely move. The release run that follows is the one
 * that finds out, at the worst possible moment.
 *
 * So this runs the same command with the switch thrown —
 * `ATR_REFUSE_GITHUB=off`, which installs the mock and refuses nothing — and
 * asserts the check comes back **failed**, naming the refusal. Anything else is a
 * failed drill: a check that passed, a check that failed for some other reason
 * (no bundle, no disk, a runner whose cache broke), or a run that never reached
 * the mock because it was not installed at all.
 *
 * The command is not re-derived here. It is the same `pnpm test:packaged-update-
 * refused` that CI runs on every push, with one environment variable added, so
 * what this proves about is what actually guards the repository.
 *
 * ## The one failure that is not about the check
 *
 * With the mock neutered, the app's own read goes out to the real GitHub — so on
 * a runner whose shared address has spent its 60 anonymous requests, that read
 * is refused for real and the spec skips for exactly the reason the mock would
 * have produced. The two states are byte-identical in the capture, and no amount
 * of reading the output separates them.
 *
 * What does separate them is GitHub's own answer about the allowance:
 * `/rate_limit` reports the remaining count and **does not spend it**, so asking
 * is free. The drill asks before it starts (an address with nothing left cannot
 * conclude anything, so the two bundles are not built and the suite is not run)
 * and again afterwards, and when the allowance is spent it says `BLOCKED`, names
 * the reset time, and says the refusal check was not implicated. That is a
 * different sentence from `FAILED — the refusal check's failure path`, and a
 * different exit code, so a red drill is readable without the log.
 *
 * Usage:
 *   pnpm electron:pack && pnpm electron:pack-older   # the drilled command needs them
 *   node scripts/drill-refused-update-check.mjs
 *   node scripts/drill-refused-update-check.mjs --allowance-only   # the gate alone
 *
 * `--allowance-only` asks the one question and exits: `0` when there is allowance
 * to conclude with, `3` when there is not. `ci.yml` runs it as the first step of
 * the drill job, because that job rebuilds both bundles and a spent allowance
 * cannot say anything about them — the gate costs seconds, the packaging costs
 * minutes.
 *
 * Exit codes: 0 — the check failed, for the refusal reasons · 1 — it did not, and
 * every reason is printed · 2 — the drill could not run the command at all ·
 * 3 — the drill is BLOCKED: this machine's anonymous GitHub allowance is spent,
 * so a neutered mock cannot be told apart from a real refusal. Nothing was
 * proved either way, and the check was not shown to be broken.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import refuseGithub from "./refuse-github.cjs";
import {
  MUST_REFUSE,
  REASONS,
  spawnCapturing,
} from "./refused-update-check.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The command under the drill — the same script CI runs, spelled the same way. */
export const COMMAND = "test:packaged-update-refused";

/**
 * Where GitHub reports this address's anonymous allowance.
 *
 * `/rate_limit` is the one endpoint that answers without spending what it
 * reports, which is the whole reason it can be asked here: a probe that cost a
 * request would be measuring itself.
 */
export const RATE_LIMIT_URL = "https://api.github.com/rate_limit";

/**
 * Ask GitHub how much anonymous allowance this machine has left.
 *
 * `null` when the question could not be answered — offline, a DNS failure, a
 * proxy, a body without a `core` block — and an unknown allowance must not be
 * read as either answer: the drill keeps its ambiguity and says so.
 *
 * @returns {Promise<{ remaining: number, limit: number, resetAt: Date } | null>}
 */
export async function githubAllowance({
  // The fetch *underneath* the mock, not the one in place: importing
  // `refuse-github.cjs` installs it in this process too, and it answers every
  // GitHub read with the 403 it exists to serve — which would make this question
  // unanswerable in exactly the circumstances it is asked in.
  fetchImpl = refuseGithub.underneath(),
  timeoutMs = 10_000,
} = {}) {
  try {
    const response = await fetchImpl(RATE_LIMIT_URL, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "alltherepos-refusal-drill",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const core = body?.resources?.core;
    if (core == null || typeof core.remaining !== "number") return null;
    return {
      remaining: core.remaining,
      limit: core.limit,
      resetAt: new Date(core.reset * 1000),
    };
  } catch {
    return null;
  }
}

/** How the allowance reads in a message, or that it could not be read. */
function describeAllowance(allowance) {
  if (allowance == null) return "the allowance could not be read";
  return `${allowance.remaining} of ${allowance.limit} anonymous requests left, resets at ${allowance.resetAt.toISOString()}`;
}

/**
 * The BLOCKED verdict, in one place.
 *
 * The gate, the run and the drill's own assessment report the same thing, and a
 * second copy of this would be the one sentence that could drift between them —
 * leaving CI's early warning describing something subtly different from what the
 * run says it found.
 */
function blockedSentence(allowance) {
  return (
    `this machine's anonymous GitHub allowance is spent ` +
    `(${describeAllowance(allowance)}), so the app's own read is refused for ` +
    `real and a neutered mock cannot be told apart from an exhausted address. ` +
    `The refusal check was not implicated — nothing here proves anything either ` +
    `way.`
  );
}

/**
 * Did the check fail the way this drill demands, and only that way?
 *
 * Pure, so every way the drill can be fooled is unit-tested against a fixture.
 * `status` is the command's exit code; `output` is everything both of its streams
 * said; `allowance` is what {@link githubAllowance} last saw, and decides whether
 * the one ambiguous outcome is the runner's fault or the check's.
 *
 * @returns {{ failures: string[], notes: string[], blocked: string | null }}
 */
export function assessDrill({ status = null, output = "", allowance = null } = {}) {
  const failures = [];
  const notes = [];

  if (status === 0) {
    failures.push(
      "the refusal check PASSED a run in which GitHub was never refused — the guard it exists for is not guarding anything, and this is the failure the drill exists to catch",
    );
  } else if (status !== 1) {
    failures.push(
      `the refusal check exited ${status ?? "without a status"} — the drill needs its own "the guard did not hold" (1); anything else is a different failure being mistaken for this one`,
    );
  }

  if (!output.includes(refuseGithub.MARKER)) {
    failures.push(
      `the mock never installed, even with ${refuseGithub.SWITCH}=${refuseGithub.OFF} — so this run did not exercise the mock at all`,
    );
  }

  if (!output.includes(REASONS.nothingRefused)) {
    failures.push(
      `the check failed without saying "${REASONS.nothingRefused}" — something else failed it, which is not what this drill proves`,
    );
  }

  // The difference between "the mock stopped refusing" and "the suite never got
  // anywhere": a feed-reading test has to have been reported as having run to a
  // verdict, or as having stopped for a reason that is not the refusal. In the
  // caught state the mock refuses nothing, so the ordinary answer comes back and
  // the test asserts on it — which is exactly the shape of the regression.
  const noticed =
    MUST_REFUSE.some((title) => output.includes(title)) &&
    (output.includes(REASONS.notSkipped) || output.includes(REASONS.wrongReason));

  if (!noticed) {
    const ambiguity =
      `no feed-reading test was reported as "${REASONS.notSkipped}" or "${REASONS.wrongReason}" — `;
    const spent = allowance != null && allowance.remaining === 0;

    if (spent && failures.length === 0) {
      // Spent, and nothing else is wrong: the neutered mock and an exhausted
      // address are the same shape, and the one thing this run must not do is
      // blame the check for it. `blocked` rather than a failure, so the verdict
      // reads as an environment that could not answer instead of a guard that
      // stopped guarding.
      return {
        failures,
        notes,
        blocked: `${blockedSentence(allowance)} Dispatch again after the reset.`,
      };
    }

    if (allowance != null) {
      // Known either way, so say which: the reader should not go looking at rate
      // limits that were never the problem, nor read a spent allowance as a
      // verdict on the check.
      failures.push(
        ambiguity +
          (spent
            ? `the allowance was spent too (${describeAllowance(allowance)}), but something else is also wrong here, so this is not only the environment.`
            : `the allowance was available in this run (${describeAllowance(allowance)}), so a real refusal is not the explanation — this is the check's own failure path, and it needs reading.`),
      );
    } else {
      failures.push(
        ambiguity +
          `the allowance could not be read either, so a neutered mock cannot be told apart from an exhausted address. Wait for the allowance and dispatch again; this run proves nothing either way.`,
      );
    }
  }

  if (failures.length === 0) {
    notes.push(
      `the check exited 1, said "${REASONS.nothingRefused}", and said why a feed-reading test did not stop`,
    );
    notes.push("the refusal check's failure path is intact");
  }

  return { failures, notes, blocked: null };
}

/**
 * Run the drilled command, and say whether it failed correctly.
 *
 * @returns {Promise<number>} the exit code for this process.
 */
export async function run({
  root = ROOT,
  env = process.env,
  log = console.log,
  error = console.error,
  checkAllowance = githubAllowance,
  spawn = spawnCapturing,
} = {}) {
  // Asked before anything is built. An address with nothing left cannot
  // conclude anything, and learning that after two packages and a suite spends
  // the most expensive runner this repository owns to prove a rate limit.
  const before = await checkAllowance();
  if (before != null && before.remaining === 0) {
    error(
      `::error::[refusal-drill] BLOCKED — ${blockedSentence(before)} Nothing was run. Dispatch again after the reset.`,
    );
    return 3;
  }
  if (before != null) {
    log(`[refusal-drill] this machine's allowance: ${describeAllowance(before)}`);
  }

  log(
    `[refusal-drill] running ${COMMAND} with ${refuseGithub.SWITCH}=${refuseGithub.OFF} — GitHub is expected to answer normally, and the check is expected to fail for it`,
  );

  const { status, output } = await spawn("pnpm", [COMMAND], {
    cwd: root,
    env: { ...env, [refuseGithub.SWITCH]: refuseGithub.OFF },
  });

  if (status === null) {
    error(
      "[refusal-drill] could not run the check — is pnpm on this machine's PATH?",
    );
    return 2;
  }

  // Asked again: the run itself read the feed, so the count that decides this is
  // the one after it, not the one before.
  const after = await checkAllowance();
  const { failures, notes, blocked } = assessDrill({
    status,
    output,
    allowance: after,
  });

  for (const note of notes) log(`  · ${note}`);

  if (blocked != null) {
    error(`::error::[refusal-drill] BLOCKED — ${blocked}`);
    return 3;
  }

  if (failures.length > 0) {
    for (const failure of failures) error(`  ✗ ${failure}`);
    error(
      `[refusal-drill] FAILED — ${failures.length} problem(s) with the refusal check's failure path`,
    );
    return 1;
  }

  log(
    "[refusal-drill] OK — with the mock refusing nothing, the check failed and said so; the guard behind it is still load-bearing",
  );
  return 0;
}

/** The flag that asks for {@link probeAllowance} instead of the whole drill. */
export const ALLOWANCE_ONLY = "--allowance-only";

/**
 * Ask the allowance question on its own, before anything is built.
 *
 * This is the drill's first step in CI, where the two bundles it needs are
 * built by the job that runs it. A spent allowance cannot conclude anything, and
 * saying so in ten seconds is the difference between a red job that says
 * BLOCKED and a red job that spent fifteen minutes building two packages to say
 * it — at the price of the runner this repository can least afford.
 *
 * @returns {Promise<number>} 0 when there is allowance to conclude with, 3 when
 * there is not. An unreadable allowance is not a blocker: the run goes ahead and
 * says, afterwards, that it could not tell the two outcomes apart.
 */
export async function probeAllowance({
  checkAllowance = githubAllowance,
  log = console.log,
  error = console.error,
} = {}) {
  const allowance = await checkAllowance();

  if (allowance != null && allowance.remaining === 0) {
    error(
      `::error::[refusal-drill] BLOCKED — ${blockedSentence(allowance)} The two ` +
        `bundles were not built and the suite was not run. Dispatch again after ` +
        `the reset.`,
    );
    return 3;
  }

  log(
    allowance != null
      ? `[refusal-drill] this machine's allowance: ${describeAllowance(allowance)} — the drill can conclude something`
      : "[refusal-drill] this machine's allowance could not be read — the drill will run, and if the result is ambiguous it will say so rather than pick a side",
  );
  return 0;
}

/**
 * True when this file is the program Node was asked to run.
 *
 * Compared through `fs.realpathSync`, not as strings: on macOS `os.tmpdir()`
 * hands back `/var/folders/...` while the loader resolves it to
 * `/private/var/...`, and a string compare then quietly does nothing at all.
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
  const main = process.argv.includes(ALLOWANCE_ONLY) ? probeAllowance : run;

  main()
    .then((code) => process.exit(code))
    .catch((thrown) => {
      console.error(`[refusal-drill] ${thrown?.message ?? thrown}`);
      process.exit(2);
    });
}
