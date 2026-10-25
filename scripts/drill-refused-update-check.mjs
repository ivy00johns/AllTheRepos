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
 * ## One machine, several addresses
 *
 * A hosted runner does not leave from one address for the length of a job. The
 * pool is shared, the allowance is per address, and a run was seen reading
 * `59 of 60, resets at 02:34:16` before the drill and `60 of 60, resets at
 * 02:35:58` after it: two windows, two addresses, one run. A single reading is
 * therefore not evidence about the address the app's read left from, and
 * trusting it would put the drill back where it started — blaming the check for
 * an exhausted address nobody saw.
 *
 * So neither reading is used on its own. The two have to describe the same
 * window (the same reset, which is the only handle on identity GitHub offers)
 * before the drill will say the allowance was available; a changed window is a
 * changed address, and a run whose address changed is reported as unable to
 * attribute, in the same breath as a spent allowance and an unreadable one. None
 * of the three proves anything either way, and none of them implicates the
 * check — which is the whole point of separate exit codes.
 *
 * ## Rehearsing the verdicts that cannot be waited for
 *
 * Every branch above needs a machine in a particular state, and the ones that
 * matter most — spent, changing, silent — are the states nobody can ask for. That
 * left them covered by unit tests and by nothing else, and a unit test cannot see
 * what reaches the run page: the `::error::` annotation, the exit code the step
 * turns red, or the sentence printed beside it.
 *
 * `--rehearse spent|moved|unreadable|available` stages one of those states: the
 * readings are what that machine would have reported, and the check's output is
 * the ambiguous shape it would have printed. Everything from `assessDrill` down
 * is the code CI runs, so the annotation and the exit code are the real ones. The
 * first line says REHEARSAL, and the readings are labelled `staged` in the log,
 * because a run that measured nothing must not read as a run that measured this
 * machine.
 *
 * Usage:
 *   pnpm electron:pack && pnpm electron:pack-older   # the drilled command needs them
 *   node scripts/drill-refused-update-check.mjs
 *   node scripts/drill-refused-update-check.mjs --allowance-only   # the gate alone
 *   node scripts/drill-refused-update-check.mjs --rehearse moved   # one verdict, staged
 *
 * `--allowance-only` asks the one question and exits: `0` when there is allowance
 * to conclude with, `3` when there is not. `ci.yml` runs it as the first step of
 * the drill job, because that job rebuilds both bundles and a spent allowance
 * cannot say anything about them — the gate costs seconds, the packaging costs
 * minutes.
 *
 * Exit codes: 0 — the check failed, for the refusal reasons · 1 — it did not, and
 * every reason is printed · 2 — the drill could not run the command at all ·
 * 3 — the drill is BLOCKED and could not conclude: the allowance is spent, the
 * address changed under it, or the allowance could not be read, so a neutered
 * mock cannot be told apart from a real refusal. Nothing was proved either way,
 * and the check was not shown to be broken.
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
 * Whether two readings describe the same allowance window, and so one address.
 *
 * The reset time is the only handle on identity GitHub offers: `/rate_limit` does
 * not say which address answered, and each address's window began when its own
 * first request arrived, so two addresses practically never share a reset second.
 * A window that rolled on one address looks the same as a change of address, and
 * that is deliberate: the answer is only ever used to *decline* to attribute. The
 * cost of being wrong in that direction is a red run that says it could not tell;
 * in the other direction it is a working check reported as broken.
 */
function sameWindow(first, second) {
  return (
    first != null &&
    second != null &&
    first.resetAt.getTime() === second.resetAt.getTime()
  );
}

/**
 * What the two readings, taken either side of the run, say about the address the
 * app's read actually left from.
 *
 * `spent` when either end saw nothing left: an exhausted address existing at any
 * point in the run is enough to explain an ambiguous result, so it is not made to
 * depend on the other reading. `available` only when both ends describe the same
 * window — the single case in which the drill is entitled to conclude that a real
 * refusal was not the explanation. `moved` and `unreadable` both mean the address
 * cannot be pinned, which is a verdict about the run rather than about the check.
 */
function allowanceEvidence({ before = null, after = null } = {}) {
  const spent = [before, after].find(
    (reading) => reading != null && reading.remaining === 0,
  );
  if (spent != null) return { kind: "spent", reading: spent };
  if (before == null || after == null) return { kind: "unreadable" };
  if (!sameWindow(before, after)) return { kind: "moved", before, after };
  return { kind: "available", reading: after };
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
 * The BLOCKED verdict for a run whose address changed while it ran.
 *
 * Distinct from {@link blockedSentence} because the two are repaired differently
 * — one waits for a reset, the other just dispatches again — and because a run
 * that read `59 of 60` at both ends would otherwise be indistinguishable from one
 * that was refused by an address the probe never saw.
 */
function movedSentence(before, after) {
  return (
    `this machine's egress address changed during the run — the allowance read ` +
    `${describeAllowance(before)} before it, and ${describeAllowance(after)} ` +
    `after it — so the reading taken afterwards is about a different address ` +
    `than the one the app's read left from, and an exhausted address cannot be ` +
    `ruled out. The refusal check was not implicated — nothing here proves ` +
    `anything either way. Dispatch again: the next run may hold one address ` +
    `throughout.`
  );
}

/** The BLOCKED verdict for a run that never got an answer about the allowance. */
function unreadableSentence() {
  return (
    `this machine's anonymous GitHub allowance could not be read at both ends ` +
    `of the run, so a neutered mock cannot be told apart from an exhausted ` +
    `address. The refusal check was not implicated — nothing here proves ` +
    `anything either way. Dispatch again when the endpoint answers.`
  );
}

/**
 * What the environment clauses say when something else is also wrong.
 *
 * The run fails either way, so this does not change the verdict — it names which
 * of the two repairs is which, because "the address is spent" and "the guard
 * stopped guarding" want different answers and a reader should not have to work
 * out from a stack which one they have.
 */
function environmentClause(evidence) {
  switch (evidence.kind) {
    case "spent":
      return `the allowance was spent too (${describeAllowance(evidence.reading)}), but something else is also wrong here, so the environment does not explain this run.`;
    case "moved":
      return `the egress address changed during the run (${describeAllowance(evidence.before)} before it, ${describeAllowance(evidence.after)} after it), so the allowance cannot be attributed — but something else is also wrong here.`;
    case "available":
      return `the allowance was available in this run (${describeAllowance(evidence.reading)}), so a real refusal is not the explanation — this is the check's own failure path, and it needs reading.`;
    default:
      return `the allowance could not be read either, so a neutered mock cannot be told apart from an exhausted address — but something else is also wrong here.`;
  }
}

/**
 * Did the check fail the way this drill demands, and only that way?
 *
 * Pure, so every way the drill can be fooled is unit-tested against a fixture.
 * `status` is the command's exit code; `output` is everything both of its streams
 * said; `before` and `allowance` are the two readings {@link githubAllowance}
 * took either side of the run, and together they decide whether the one
 * ambiguous outcome is the runner's fault or the check's. Both are needed: one
 * reading says what some address had left, and only agreement between the two
 * says it was the address this run used.
 *
 * @returns {{ failures: string[], notes: string[], blocked: string | null }}
 */
export function assessDrill({
  status = null,
  output = "",
  allowance = null,
  before = null,
} = {}) {
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
    const evidence = allowanceEvidence({ before, after: allowance });

    if (failures.length === 0) {
      // Nothing else is wrong, so the two possible worlds are a mock that
      // refused nothing and an address that refused for real — and the allowance
      // is the only thing that separates them. `blocked` rather than a failure,
      // so the verdict reads as an environment that could not answer instead of
      // a guard that stopped guarding.
      if (evidence.kind === "spent") {
        return {
          failures,
          notes,
          blocked: `${blockedSentence(evidence.reading)} Dispatch again after the reset.`,
        };
      }
      if (evidence.kind === "moved") {
        return {
          failures,
          notes,
          blocked: movedSentence(evidence.before, evidence.after),
        };
      }
      if (evidence.kind === "unreadable") {
        // Both ends of the run are needed to attribute anything, so half an
        // answer is the same standing as none: it cannot clear the check.
        return { failures, notes, blocked: unreadableSentence() };
      }

      failures.push(
        ambiguity +
          `the allowance was available in this run (${describeAllowance(evidence.reading)}), read on the same window before and after it, so a real refusal is not the explanation — this is the check's own failure path, and it needs reading.`,
      );
    } else {
      // Something else is already wrong, so the run fails either way; the
      // environment is named anyway, because "spent" and "the check broke" are
      // different repairs and a reader should not have to guess which.
      failures.push(ambiguity + environmentClause(evidence));
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
  // True for {@link rehearse}: the readings and the check's output are staged, so
  // the ordinary lines below say so rather than claiming to have measured a
  // machine. The verdict is printed by the same code either way — the annotation
  // and the exit code are the part a rehearsal exists to exercise.
  staged = false,
} = {}) {
  const measured = staged
    ? "[refusal-drill] staged allowance"
    : "[refusal-drill] this machine's allowance";

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
    log(`${measured}: ${describeAllowance(before)}`);
  }

  log(
    staged
      ? `[refusal-drill] not running ${COMMAND} — the check's output is staged for this rehearsal, so the verdict below is the one a run would give, and says nothing about this machine`
      : `[refusal-drill] running ${COMMAND} with ${refuseGithub.SWITCH}=${refuseGithub.OFF} — GitHub is expected to answer normally, and the check is expected to fail for it`,
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
  // the one after it, not the one before. Which address answered is a different
  // question, and the one this reading cannot answer on its own — see
  // `allowanceEvidence`.
  const after = await checkAllowance();
  const evidence = allowanceEvidence({ before, after });

  log(
    after == null
      ? `${measured} after the run could not be read — if the result is ambiguous, the verdict says what that leaves unresolved`
      : `${measured} after the run: ${describeAllowance(after)}` +
          (evidence.kind === "moved"
            ? " — a different window from the one before it, so the egress address changed while the drill ran"
            : ""),
  );

  const { failures, notes, blocked } = assessDrill({
    status,
    output,
    allowance: after,
    before,
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

/** The flag that stages a verdict instead of measuring the machine. */
export const REHEARSE = "--rehearse";

/**
 * The states a rehearsal can put the drill in, one per verdict that cannot be
 * waited for.
 *
 * They are named after what the machine would have to be doing — spent, moving,
 * silent, or healthy — rather than after the exit code, because the reader of a
 * red run needs to know which world it was in. `available` is here because the
 * FAILED verdict needs exercising too: it is the one that names the check, and a
 * sentence nobody has ever seen printed is a sentence nobody has proofread.
 */
export const REHEARSAL_STATES = ["spent", "moved", "unreadable", "available"];

const HOUR_MS = 3_600_000;

/**
 * The readings a state pretends to have taken, or `null` for an unknown state.
 *
 * `spent` is spent *before* the check would run, so it exercises the gate's early
 * stop and needs no bundles. The other three are pairs that only decide anything
 * afterwards, so they exercise the post-run verdict — which is the half that had
 * no way of being reached on a healthy runner at all.
 *
 * The windows are derived from the clock rather than fixed, because a reset in
 * the past reads as nonsense in a log even when the reading is staged.
 */
export function rehearsalReadings(state, now = Date.now()) {
  const nextWindow = (Math.floor(now / HOUR_MS) + 1) * HOUR_MS;
  const reading = (remaining, resetAt) => ({
    remaining,
    limit: 60,
    resetAt: new Date(resetAt),
  });

  switch (state) {
    case "spent":
      // Nothing left at either end: the gate stops before anything is built.
      return [reading(0, nextWindow), reading(0, nextWindow)];
    case "moved":
      // Two windows, both with allowance left — the shape the runner actually
      // produced, and the one that cannot be attributed to either address.
      return [reading(59, nextWindow), reading(60, nextWindow + HOUR_MS)];
    case "unreadable":
      return [null, null];
    case "available":
      // One window, allowance at both ends: the only state that names the check.
      return [reading(42, nextWindow), reading(42, nextWindow)];
    default:
      return null;
  }
}

/**
 * The output the check prints when the mock refused nothing.
 *
 * Built from the real marker and the real reason, like the unit tests do: a
 * fixture spelled here could drift from the strings the check emits and quietly
 * stage a state that never happens.
 */
function ambiguousOutput() {
  return [
    refuseGithub.MARKER,
    `  ✗ ${REASONS.nothingRefused} — the requests never reached the mock`,
  ].join("\n");
}

/**
 * Stage one of the blocked verdicts, end to end, on whatever machine this is.
 *
 * The verdicts that matter cannot be waited for: one needs an address with
 * nothing left, one an address that changes mid-run, one an endpoint that stops
 * answering. Waiting for them is how the blocked branches came to be covered by
 * unit tests and by nothing else — and the things a unit test cannot check are
 * the ones that reach the run page: the `::error::` annotation, the exit code the
 * step turns into a red job, and the sentence next to it.
 *
 * So this replaces the two things the drill cannot arrange — the readings, and a
 * check whose output is the ambiguous shape — and keeps everything from
 * `assessDrill` down, which is the code that decides. The run says in its first
 * line that it is a rehearsal and proves nothing about this machine; what it does
 * prove is that the rest of the line arrives as intended.
 *
 * @returns {Promise<number>} the exit code this state really produces.
 */
export async function rehearse(
  state,
  { log = console.log, error = console.error } = {},
) {
  const readings = rehearsalReadings(state);
  if (readings == null) {
    error(
      `[refusal-drill] there is no "${state}" rehearsal — the states are ${REHEARSAL_STATES.join(", ")}`,
    );
    return 2;
  }

  const [before, after] = readings;
  let asked = 0;

  log(
    `::notice::[refusal-drill] REHEARSAL (${state}) — the allowance readings and the ` +
      `check's output are staged, so this exercises the verdict, its annotation and ` +
      `its exit code, and proves nothing about this machine.`,
  );

  return run({
    staged: true,
    // The first ask is the gate, the second is the reading that decides the
    // verdict; a rehearsal has one of each to give.
    checkAllowance: async () => (asked++ === 0 ? before : after),
    spawn: async () => ({ status: 1, output: ambiguousOutput() }),
    log,
    error,
  });
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

/**
 * The rehearsal named on the command line: a state, `""` when the flag carries
 * none, or `null` when the flag was not given at all.
 *
 * A missing value is not the same as an absent flag — one is a rehearsal nobody
 * named, which is an error worth saying out loud, and the other is an ordinary
 * run.
 */
export function rehearsalFrom(argv) {
  const at = argv.indexOf(REHEARSE);
  if (at === -1) return null;
  const value = argv[at + 1];
  return value == null || value.startsWith("--") ? "" : value;
}

if (isMainModule()) {
  const rehearsal = rehearsalFrom(process.argv);
  let main = run;
  if (rehearsal != null) main = () => rehearse(rehearsal);
  else if (process.argv.includes(ALLOWANCE_ONLY)) main = probeAllowance;

  main()
    .then((code) => process.exit(code))
    .catch((thrown) => {
      console.error(`[refusal-drill] ${thrown?.message ?? thrown}`);
      process.exit(2);
    });
}
