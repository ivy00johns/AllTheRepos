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
 * Usage:
 *   pnpm electron:pack && pnpm electron:pack-older   # the drilled command needs them
 *   node scripts/drill-refused-update-check.mjs
 *
 * Exit codes: 0 — the check failed, for the refusal reasons · 1 — it did not, and
 * every reason is printed · 2 — the drill could not run the command at all.
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
 * Did the check fail the way this drill demands, and only that way?
 *
 * Pure, so every way the drill can be fooled is unit-tested against a fixture.
 * `status` is the command's exit code; `output` is everything both of its streams
 * said.
 *
 * @returns {{ failures: string[], notes: string[] }}
 */
export function assessDrill({ status = null, output = "" } = {}) {
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
    failures.push(
      `no feed-reading test was reported as "${REASONS.notSkipped}" or "${REASONS.wrongReason}" — if the real GitHub refused every read in this run too, a neutered mock cannot be told apart from an exhausted address. Wait for the allowance and dispatch again; this run proves nothing either way.`,
    );
  }

  if (failures.length === 0) {
    notes.push(
      `the check exited 1, said "${REASONS.nothingRefused}", and said why a feed-reading test did not stop`,
    );
    notes.push("the refusal check's failure path is intact");
  }

  return { failures, notes };
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
} = {}) {
  log(
    `[refusal-drill] running ${COMMAND} with ${refuseGithub.SWITCH}=${refuseGithub.OFF} — GitHub is expected to answer normally, and the check is expected to fail for it`,
  );

  const { status, output } = await spawnCapturing("pnpm", [COMMAND], {
    cwd: root,
    env: { ...env, [refuseGithub.SWITCH]: refuseGithub.OFF },
  });

  if (status === null) {
    error(
      "[refusal-drill] could not run the check — is pnpm on this machine's PATH?",
    );
    return 2;
  }

  const { failures, notes } = assessDrill({ status, output });

  for (const note of notes) log(`  · ${note}`);

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
  run()
    .then((code) => process.exit(code))
    .catch((thrown) => {
      console.error(`[refusal-drill] ${thrown?.message ?? thrown}`);
      process.exit(2);
    });
}
