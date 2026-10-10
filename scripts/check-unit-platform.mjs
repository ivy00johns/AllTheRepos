#!/usr/bin/env node
/**
 * A spec that only passes on the machine it was written on is a spec that has
 * not been written yet.
 *
 * `tests/unit/scripts/point-sdkroot.spec.ts` passed fourteen of fourteen on the
 * Mac it was written on and eleven of fourteen on the Linux runner, because it
 * drove `run()` without a platform and `run()` defaults that to
 * `process.platform`. Nothing was wrong with the code under test: the *spec* had
 * quietly made an assertion about the machine, and the only place that showed
 * was a push whose other gates were green.
 *
 * So this runs the suite again with `process.platform` set to a platform the
 * host is not — Linux on a Mac, darwin on the runner — and reads the machine's
 * own answer instead of guessing at it. A spec whose assertions depend on the
 * host fails in that run, and the failure is the finding. Running it locally is
 * the point of it: the run a developer makes says what the Linux runner will
 * say, before the push rather than after.
 *
 * Two specs are exempt, and they are the honest kind. They load `sqlite-vec`,
 * whose per-platform npm package *is* the binary, so a faked platform asks for a
 * `.dylib` that is not installed beside the `.so` that is, and the store reports
 * itself unavailable — which is the correct answer to a question about a
 * platform nobody built for. They are named below with that reason, and the list
 * carries the rule the rest of this repository's suppressions carry: an
 * exemption that stops being needed fails the gate, because one that suppresses
 * nothing is a line the next reader has to re-derive and cannot.
 *
 * What it deliberately does not do is read the spec files. A grep for
 * `process.platform` would find the four specs that pin the platform on purpose
 * and miss the one that inherited it — which is how the failure above happened.
 * The platform is *run*, not searched for. It also does not fake `process.arch`:
 * a native module is compiled for the architecture it is loaded on, so a run
 * under a faked architecture would be answering a question about a binary
 * nobody has, rather than about the code.
 *
 * A failure in that run is not by itself a verdict, which is the one thing the
 * first version of this gate got wrong. Two specs that bind a real listening
 * socket and expect the sweep to find it — `process.spec.ts`'s listener
 * binding — failed on a machine whose load average was in the hundreds and
 * passed on the same machine minutes later, on the same platform, having
 * asserted nothing about the platform either time. A spec that fails because
 * the machine is busy is not a spec that asserts about the platform, and one
 * run cannot tell them apart. So the files that failed are asked once more: a
 * platform dependence fails deterministically, a flake mostly does not, and
 * whatever is cleared by the second run is named as a flake rather than passed
 * over in silence. The cost is bounded by the failures themselves — a suite
 * with none pays nothing, and the retry re-runs files, not the suite.
 *
 * Usage:
 *   node scripts/check-unit-platform.mjs
 *
 * Exit codes: 0 — every failing file in the faked run is a declared exemption,
 * and every declared exemption still failed · 1 — a spec failed that is not
 * exempt and failed again on the retry, or an exempt spec passed, and each one
 * is named with the reason it matters · 2 — there was nothing to check (no
 * report, or a report with no test files in it), which is reported rather than
 * passed.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The platform a run is pointed at, given the one it is actually on.
 *
 * Both directions are covered by one entry each: a Mac is pointed at Linux,
 * which is what the unit job runs on, and the runner is pointed at darwin,
 * which is what most of the suite was written on. A platform that is neither —
 * win32, or anything Node adds later — is pointed at darwin for the same
 * reason, since darwin is the one the specs are most likely to have assumed.
 */
export const OTHER_PLATFORM = {
  darwin: "linux",
  linux: "darwin",
  win32: "darwin",
};

/** Where the faked run leaves its report. Gitignored; written by this script. */
export const REPORT = ".vitest-other-platform.json";

/** The config that points the suite at {@link OTHER_PLATFORM}. */
export const CONFIG = "vitest.other-platform.config.ts";

/**
 * Specs that cannot run on a platform the host is not, and why.
 *
 * The bar for an entry is that the spec is about a *binary*, not about the
 * code: `sqlite-vec` resolves its extension by platform and ships the compiled
 * library as a per-platform npm package, so there is no arrangement of the
 * source under which the darwin extension loads on a Linux runner or the
 * reverse. Everything else — a menu that is macOS-only, a dock badge that
 * no-ops off darwin — pins `process.platform` itself and is covered by the
 * faked run like any other spec.
 */
export const SPECS_THAT_NEED_THE_HOST = [
  {
    file: "tests/unit/main/services/vector-store.spec.ts",
    why: "Drives the real sqlite-vec extension, which is a per-platform package: the darwin `vec0.dylib` is not installed on a Linux runner, so the store reports itself unavailable and every test that asserts it loaded fails.",
  },
  {
    file: "tests/unit/main/services/vector-store-packaged.spec.ts",
    why: "Walks the packaged extension path for the platform it is on. Under a faked platform it looks for the other platform's package inside the bundle, which is a question about a build nobody made.",
  },
];

/** A path from a vitest report, as the repository names it. */
function repositoryPath(name) {
  const relative = path.relative(ROOT, name);
  return relative.split(path.sep).join("/");
}

/**
 * Split a vitest JSON report into what this repository declared and what it did
 * not: the failing files nobody exempted, and the exemptions that held nothing
 * back.
 *
 * Exported because it is the whole judgement of the gate, and a judgement is
 * worth testing exhaustively. The report is Jest-shaped: `testResults` is one
 * entry per spec file, each with an `assertionResults` array.
 */
export function partition(report, exempt = SPECS_THAT_NEED_THE_HOST) {
  const declared = new Set(exempt.map((entry) => entry.file));
  const suites = Array.isArray(report?.testResults) ? report.testResults : [];

  const failed = new Set();
  let assertions = 0;
  for (const suite of suites) {
    const results = Array.isArray(suite?.assertionResults)
      ? suite.assertionResults
      : [];
    assertions += results.length;
    const anyFailed = results.some((result) => result?.status === "failed");
    if (suite?.status === "failed" || anyFailed) {
      failed.add(repositoryPath(String(suite?.name ?? "")));
    }
  }

  return {
    /** How many spec files the report described. */
    files: suites.length,
    /** How many individual tests ran, so "nothing to check" has a number. */
    assertions,
    /** Failing files, sorted, so two runs print the same thing. */
    failed: [...failed].sort(),
    /** Failing files this repository never declared. */
    unexpected: [...failed].filter((file) => !declared.has(file)).sort(),
    /** Declared exemptions that did not need to be. */
    unnecessary: [...declared].filter((file) => !failed.has(file)).sort(),
  };
}

/**
 * Run the suite on the other platform, leaving its report where we read it.
 *
 * With `files`, only those specs run — that is the retry, and running files
 * rather than the suite is what keeps it cheap enough to be unconditional.
 */
function runOnOtherPlatform(files = []) {
  const platform = OTHER_PLATFORM[process.platform] ?? "darwin";
  const vitest = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");

  process.stdout.write(
    files.length === 0
      ? `[unit-platform] running the suite as ${platform}, on a host that is ${process.platform}\n`
      : `[unit-platform] asking ${files.length} failing file(s) again as ${platform}, to tell a platform dependence from a machine under load\n`,
  );

  try {
    execFileSync(
      process.execPath,
      [
        vitest,
        "run",
        "--config",
        CONFIG,
        // `default` so the failures are legible in the job log, and `json` so
        // this script can count them. Same pair `test:report` uses.
        "--reporter=default",
        "--reporter=json",
        `--outputFile=${REPORT}`,
        // Positional filters last: everything before them is a flag, and a
        // spec file could otherwise be read as one.
        ...files,
      ],
      {
        cwd: ROOT,
        env: { ...process.env, ATR_UNIT_PLATFORM: platform },
        stdio: "inherit",
      },
    );
  } catch {
    // A non-zero exit is expected: an exempt spec is *supposed* to fail here,
    // and the report is what decides whether the failure was a declared one.
    // Exit status is checked through the report below, not through this call.
  }
}

/**
 * Which of the files that failed the first time failed the second time too.
 *
 * Exported and pure for the same reason {@link partition} is: this is the line
 * between "these assertions depend on the platform" and "this machine was
 * busy", and getting it wrong in either direction is worse than not asking.
 * Report a flake as a dependence and the gate is turned off; swallow a
 * dependence as a flake and the spec reaches a runner again.
 */
export function survivors(unexpected, retryFailed) {
  const again = new Set(retryFailed);
  return {
    /** Failing both times: the finding, named as such. */
    stillFailing: unexpected.filter((file) => again.has(file)),
    /** Failing once: named as a flake, not passed over. */
    cleared: unexpected.filter((file) => !again.has(file)),
  };
}

/**
 * The report from the last run, or the reason there is none.
 *
 * A report that cannot be read is "nothing was verified" rather than "nothing
 * failed": the run it describes is the entire evidence this gate has.
 */
function readReport() {
  const reportPath = path.join(ROOT, REPORT);
  if (!fs.existsSync(reportPath)) {
    return { ok: false, why: `no report at ${REPORT} — the suite did not run` };
  }

  try {
    return { ok: true, report: JSON.parse(fs.readFileSync(reportPath, "utf8")) };
  } catch (error) {
    return {
      ok: false,
      why: `${REPORT} is not readable as JSON (${error instanceof Error ? error.message : error})`,
    };
  }
}

/**
 * Ask the files that failed once again, and say which survived.
 *
 * A report that cannot be read on the retry leaves the first run's failures
 * standing, and says so: the retry exists to clear flakes, not to quiet a run
 * whose evidence went missing.
 */
function retryFailing(unexpected) {
  runOnOtherPlatform(unexpected);
  const retry = readReport();
  if (!retry.ok) {
    process.stderr.write(
      `[unit-platform] the retry left no readable report (${retry.why}), so the failures below stand unconfirmed and are reported as findings.\n`,
    );
    return { stillFailing: unexpected, cleared: [] };
  }
  return survivors(unexpected, partition(retry.report).failed);
}

function main() {
  runOnOtherPlatform();

  const first = readReport();
  if (!first.ok) {
    process.stderr.write(`[unit-platform] ${first.why}. Nothing was verified.\n`);
    return 2;
  }

  const firstRun = partition(first.report);

  if (firstRun.files === 0 || firstRun.assertions === 0) {
    process.stderr.write(
      `[unit-platform] the report describes ${firstRun.files} spec file(s) and ${firstRun.assertions} test(s), so there is nothing to check. Nothing was verified.\n`,
    );
    return 2;
  }

  // The retry, and it runs before anything is printed about the failures:
  // `survivors` says why a second run is what turns the first one into a
  // verdict. Bounded by the failures, so a suite with none pays nothing.
  const { stillFailing, cleared } = firstRun.unexpected.length
    ? retryFailing(firstRun.unexpected)
    : { stillFailing: [], cleared: [] };

  const { files, assertions, failed, unnecessary } = firstRun;
  const unexpected = stillFailing;

  process.stdout.write(
    `[unit-platform] ${files} spec files, ${assertions} tests, ${failed.length} failing file(s) on the other platform\n`,
  );

  // Named rather than dropped. A retry that quietly erased its own input would
  // be a gate whose reason for passing is invisible, and the next person to
  // read a green run could not tell a clean suite from a flaky one.
  if (cleared.length > 0) {
    process.stdout.write(
      `[unit-platform] ${cleared.length} failure(s) cleared on the second run, so they were this machine and not the platform:\n`,
    );
    for (const file of cleared) {
      process.stdout.write(`  ${file}\n`);
    }
  }

  let failedGate = false;

  if (unexpected.length > 0) {
    failedGate = true;
    process.stderr.write(
      `[unit-platform] these specs failed on the other platform twice, are not exempt, and so assert about the machine they run on:\n`,
    );
    for (const file of unexpected) {
      process.stderr.write(`  ${file}\n`);
    }
    process.stderr.write(
      `[unit-platform] inject the platform the case is about — the way tests/unit/main/system/menu.spec.ts pins it — rather than letting a module default to process.platform.\n`,
    );
  }

  if (unnecessary.length > 0) {
    failedGate = true;
    process.stderr.write(
      `[unit-platform] these exemptions suppressed nothing, so they no longer describe anything — either the spec was fixed or it moved:\n`,
    );
    for (const file of unnecessary) {
      process.stderr.write(`  ${file}\n`);
    }
    process.stderr.write(
      `[unit-platform] remove them from SPECS_THAT_NEED_THE_HOST in scripts/check-unit-platform.mjs.\n`,
    );
  }

  if (failedGate) return 1;

  process.stdout.write(
    `[unit-platform] every failure on ${OTHER_PLATFORM[process.platform] ?? "darwin"} is declared: ${SPECS_THAT_NEED_THE_HOST.length} exemption(s), all of them still needed.\n`,
  );
  return 0;
}

const isMain =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  process.exit(main());
}
