#!/usr/bin/env node
/**
 * The update check's rate-limit branch, exercised on purpose and asserted.
 *
 * `tests/e2e/packaged-update-check.spec.ts` stops with a reason — not a failure —
 * when GitHub declines to answer an anonymous read: a 403 says nothing about the
 * release, and a release run must not go red over somebody else's spent hour of
 * API allowance. That is the right bargain, and it leaves exactly one hole behind
 * it, which is this file's reason to exist: **a skip is not a pass.** The branch
 * that skips is a branch nothing exercises, and the guard could rot into a `catch`
 * that swallows every error without anything above it changing colour. The suite
 * would be green either way, with less and less behind the number.
 *
 * So this runs the real spec, against the real packaged bundle, with the one
 * thing in the world swapped: `scripts/refuse-github.cjs` is loaded into the
 * Playwright worker and answers every GitHub read with GitHub's own 403. Then it
 * asserts that the tests which read the feed stopped *for that reason* — and
 * anything else fails. A failure, a skip for a different reason, no skip at all,
 * no packaged bundle to launch, a mock that silently failed to install, a run
 * that exited non-zero for some other cause: all of them are a failure here.
 *
 * Three things it deliberately does not do:
 *
 *   - **It does not assert the happy path.** That is the release pipeline's job
 *     (`release.yml`), on a live feed, with the archive download and the signature
 *     check behind it. This is the other half of that run, and it belongs on every
 *     push rather than on a tag.
 *   - **It does not tell the spec it is being mocked.** The spec is byte for byte
 *     the file the release runs; the mock arrives through `NODE_OPTIONS`, out of
 *     band. A spec that knew would be a second code path, taken only here.
 *   - **It does not read the log for its verdict.** Playwright's JSON report
 *     records each test's own skip annotation, so the question "did this stop
 *     because GitHub refused?" is answered by the reason the test recorded, not by
 *     a line somebody grep'd out of a 400-line log. The log is still read, for the
 *     two things only it can say: that the mock was installed at all, and that it
 *     was actually asked something.
 *
 * Usage:
 *   pnpm electron:pack                  # the spec launches a packaged bundle
 *   pnpm test:packaged-update-refused
 *
 * Exit codes: 0 — every feed-reading test stopped because GitHub refused, and the
 * rest of the suite is clean · 1 — it did not, and every reason is printed · 2 —
 * the runner could not run the suite at all (no Playwright, no report).
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Imported for its two strings as much as for its behaviour, and importing it
// installs it in this process too — that is the file's whole contract. Harmless
// here (this script makes no requests of its own) and worth having: the marker
// and the refusal prefix are read from the one file that writes them rather than
// a second copy that could drift from it.
import refuseGithub from "./refuse-github.cjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The mock, by the path `--require` is handed. */
export const MOCK = path.join(ROOT, "scripts", "refuse-github.cjs");

/** The spec under test — read by the unit tests to pin the names below. */
export const SPEC_FILE = path.join(
  ROOT,
  "tests",
  "e2e",
  "packaged-update-check.spec.ts",
);

/**
 * The one definition of what a refusal is, shared with the spec and the app.
 *
 * Exported so the unit tests can read the same file this script read, rather
 * than restating its contents.
 */
export const REFUSAL_FILE = path.join(
  ROOT,
  "src",
  "shared",
  "github-refusal.json",
);

/**
 * The statuses and the words, read rather than copied — see the header for why
 * the definition is data and not a module.
 */
const REFUSAL = JSON.parse(fs.readFileSync(REFUSAL_FILE, "utf8"));

/** The config the suite actually runs under, and the filter that picks the spec. */
const CONFIG = "playwright.electron.config.ts";
const SPEC_FILTER = "packaged-update-check";

/** Where the `json` reporter writes, handed over through its own env var. */
const REPORT_ENV = "PLAYWRIGHT_JSON_OUTPUT_NAME";

/**
 * The words every refusal skip carries.
 *
 * Read from the shared definition, so this script and the spec it drives cannot
 * disagree about what a refusal sounds like: the spec builds its skip reason out
 * of the same file, and this is the phrase that reason has to contain. It used to
 * be a literal here, kept in step with the spec by a unit test that grepped it.
 */
export const REFUSAL_WORDS = REFUSAL.anonymousRead;

/**
 * The tests that must have stopped because of the refusal.
 *
 * All three read the feed through the spec's own `fetch`, which is the part the
 * mock replaces, so all three are guaranteed to meet the refusal — given the
 * bundles they need. That is why `ci.yml` builds two: the current bundle for the
 * first test, and `pnpm electron:pack-older`'s for the third, which reads the
 * feed only after it has found a bundle that is genuinely one version behind.
 * Leaving that second build out is not a saving: this list would then demand a
 * skip that never happens, and the check would fail every run — or, worse, be
 * softened until it asserted nothing.
 *
 * The unit test asserts each of these titles still exists in the spec, so renaming
 * one fails loudly instead of leaving this list matching nothing.
 */
export const FEED_TEST = "reaches the public feed anonymously and reports up to date";
export const BEHIND_TEST =
  "offers the published release when the build is behind it";
export const ARCHIVE_TEST =
  "downloads, matches its manifest, and unpacks to a signed bundle";
export const MUST_REFUSE = [FEED_TEST, BEHIND_TEST, ARCHIVE_TEST];

/**
 * The vocabulary of a failed run, named.
 *
 * `scripts/drill-refused-update-check.mjs` runs this check against a mock that
 * has been made to stop refusing, and it has to be sure the check failed *for
 * that reason* rather than for the half-dozen other things that can go wrong on
 * a runner. It matches these strings — and they are exported rather than copied
 * because a copy would be the one thing in the drill that could drift silently,
 * leaving it asserting something that no longer means anything.
 */
export const REASONS = {
  /** The mock was never loaded at all: the run read the real GitHub. */
  neverInstalled: "the refusal was never installed",
  /** The mock was loaded and nothing was refused through it. */
  nothingRefused: "no GitHub read was ever refused",
  /** A reduced run has to say so on the job, not only in a skip count. */
  noWarning: "no ::warning:: was emitted",
  /** A feed-reading test reached a verdict instead of stopping. */
  notSkipped: "was not skipped",
  /** It stopped, but for a reason that is not this refusal. */
  wrongReason: "skipped for another reason",
  /** It never ran — the filter missed it, or a bundle is missing. */
  didNotRun: "did not run",
  /** Playwright reported it as failed, timed out or interrupted. */
  endedAs: "ended as",
};

/**
 * Every test in a Playwright JSON report, flattened to what a verdict needs.
 *
 * `spec.ok` is not one of them, and that is not an oversight: Playwright reports
 * `ok: true` for a skipped test, so a check written against it cannot tell a
 * guard that held from a branch that never ran.
 */
export function testsIn(report) {
  const rows = [];

  const visit = (suite, trail) => {
    const where = suite.title ? [...trail, suite.title] : trail;

    for (const spec of suite.specs ?? []) {
      const cases = spec.tests ?? [];
      const statuses = cases.map((test) => test.status);

      rows.push({
        title: spec.title,
        path: [...where, spec.title].join(" › "),
        // Every case has to agree — there is one project here, so this is one
        // case, but two of them disagreeing is not a pass either.
        passed: statuses.length > 0 && statuses.every((one) => one === "expected"),
        skipped: statuses.length > 0 && statuses.every((one) => one === "skipped"),
        statuses: statuses.length > 0 ? statuses : ["no result"],
        reasons: cases.flatMap((test) =>
          (test.annotations ?? [])
            .filter((annotation) => annotation.type === "skip")
            .map((annotation) => annotation.description ?? ""),
        ),
        errors: cases
          .flatMap((test) => test.results ?? [])
          .flatMap((result) => result.errors ?? [])
          .map((error) => (error.message ?? "").trim())
          .filter((message) => message.length > 0),
      });
    }

    for (const child of suite.suites ?? []) visit(child, where);
  };

  for (const suite of report.suites ?? []) visit(suite, []);

  return rows;
}

/**
 * What is wrong with a run, if anything.
 *
 * Pure, so every way this check can be defeated is unit-tested against a fixture
 * instead of against a five-minute Electron run — and so the messages, which are
 * the whole value of a check like this, can be read and edited without launching
 * anything. `status` is the suite's exit code, `report` its JSON report or null,
 * `output` everything both of its streams said.
 *
 * @returns {{ failures: string[], notes: string[] }}
 */
export function assessRun({
  status = null,
  report = null,
  output = "",
  mustRefuse = MUST_REFUSE,
} = {}) {
  const failures = [];
  const notes = [];
  const rows = report === null ? [] : testsIn(report);

  if (status !== 0) {
    failures.push(
      `the suite exited ${status ?? "without a status"}${
        status === -1 ? " (killed by a signal)" : ""
      } — with GitHub refusing every read, nothing in it is allowed to fail`,
    );
  }

  if (report === null) {
    failures.push(
      "there is no JSON report, so there is nothing to say about which tests ran",
    );
  } else if ((report.errors ?? []).length > 0) {
    // The run itself broke — a global setup that threw, a worker that never
    // started — and Playwright files that apart from any test's result. Said
    // first, because it explains everything else on this list.
    failures.push(
      `the run itself failed before the tests did: ${
        (report.errors[0].message ?? "no message").trim().split("\n")[0]
      }`,
    );
  }

  if (report !== null && rows.length === 0) {
    failures.push(
      "the run reported no tests at all — the spec did not run, and a run that asserts nothing is not a pass",
    );
  }

  // The two things only the log can say. A mock that failed to install would
  // leave the suite reading the real feed: it might pass, it might skip for an
  // unrelated reason, and either way it would be reporting on something else.
  if (!output.includes(refuseGithub.MARKER)) {
    failures.push(
      `${REASONS.neverInstalled} — this run read the real GitHub, so it says nothing about being refused`,
    );
  }

  const served = output
    .split("\n")
    .filter((line) => line.startsWith(refuseGithub.REFUSED)).length;
  if (served === 0) {
    failures.push(
      `${REASONS.nothingRefused} — the requests never reached the mock`,
    );
  } else {
    notes.push(
      `${served} GitHub request${served === 1 ? "" : "s"} answered with a 403`,
    );
  }

  const warned = output
    .split("\n")
    .find((line) => line.startsWith("::warning::") && line.includes(REFUSAL_WORDS));
  if (warned === undefined) {
    failures.push(
      `${REASONS.noWarning} for the refusal — a reduced run has to say so on the job, not only in a skip count nobody reads`,
    );
  }

  const failed = rows.filter((row) => !row.passed && !row.skipped);
  for (const row of failed) {
    failures.push(
      `${row.path} ${REASONS.endedAs} ${row.statuses.join("/")}${
        row.errors.length > 0 ? `: ${row.errors[0].split("\n")[0]}` : ""
      }`,
    );
  }

  for (const title of mustRefuse) {
    const row = rows.find((entry) => entry.title.includes(title));

    if (row === undefined) {
      failures.push(
        `"${title}" ${REASONS.didNotRun} — the refusal path for it was not covered`,
      );
      continue;
    }

    if (!row.skipped) {
      failures.push(
        `"${title}" ${REASONS.notSkipped} (${row.statuses.join("/")}) — with GitHub refusing to answer, it has to stop with a reason rather than assert anything about the feed`,
      );
      continue;
    }

    const reason = row.reasons.find((one) => one.includes(REFUSAL_WORDS));
    if (reason === undefined) {
      failures.push(
        `"${title}" ${REASONS.wrongReason}${
          row.reasons.length > 0 ? ` — ${row.reasons.join("; ")}` : " (none recorded)"
        }, so the rate-limit path is still unexercised`,
      );
      continue;
    }

    notes.push(`${row.path} — stopped because GitHub refused to answer`);
  }

  const passed = rows.filter((row) => row.passed).length;
  const skipped = rows.filter((row) => row.skipped).length;
  if (rows.length > 0) {
    notes.push(
      `${rows.length} test${rows.length === 1 ? "" : "s"}: ${passed} passed, ${skipped} skipped, ${failed.length} failed`,
    );
  }

  return { failures, notes };
}

/**
 * Run a command, hand its output through as it arrives, and keep a copy.
 *
 * `stdio: "inherit"` gives the live log and nothing to assert on; capturing
 * everything and printing it at the end leaves a five-minute job silent until it
 * is over. This is the middle: every chunk goes straight out, and the whole thing
 * stays in hand for the verdict — which is why the log a person reads and the log
 * the assertions read are the same bytes.
 *
 * Exported because `scripts/drill-refused-update-check.mjs` runs this command
 * under a thrown switch and has to read its output the same way. One
 * implementation, so the drill cannot be looking at a different log than the one
 * this check prints.
 */
export function spawnCapturing(command, args, options) {
  return new Promise((done) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Kept as buffers and decoded once, at the end. Appending each chunk to a
    // string decodes it on its own, so a multi-byte character split across a
    // chunk boundary comes back as replacement characters on both sides of it —
    // and the one marker this run is asserted against carries an em dash.
    const seen = [];
    const keep = (stream, sink) => {
      stream.on("data", (chunk) => {
        seen.push(chunk);
        sink.write(chunk);
      });
    };
    keep(child.stdout, process.stdout);
    keep(child.stderr, process.stderr);

    const everything = () => Buffer.concat(seen).toString("utf8");

    // A process killed by a signal closes with a null code, and that is not the
    // same thing as failing to start — the caller distinguishes them by `null`.
    child.on("close", (code, signal) =>
      done({ status: code === null && signal !== null ? -1 : code, output: everything() }),
    );
    child.on("error", (thrown) => {
      done({ status: null, output: `${everything()}\n${thrown.message}` });
    });
  });
}

/**
 * Run the suite against the refusal, and say whether the guard held.
 *
 * @returns {Promise<number>} the exit code for this process.
 */
export async function run({
  root = ROOT,
  env = process.env,
  log = console.log,
  error = console.error,
} = {}) {
  if (!fs.existsSync(MOCK)) {
    error(`[refused-update-check] no mock at ${MOCK} — nothing to run the suite against`);
    return 2;
  }

  const place = fs.mkdtempSync(path.join(os.tmpdir(), "atr-refused-update-check-"));
  const reportPath = path.join(place, "report.json");

  try {
    const { status, output } = await spawnCapturing(
      "pnpm",
      [
        "exec",
        "playwright",
        "test",
        "--config",
        CONFIG,
        SPEC_FILTER,
        // Two reporters on purpose: `list` is the log a person watches — and the
        // only place the refusals, the app's own output and the `::warning::`
        // land — while `json` is what the verdict is read from.
        "--reporter=list,json",
      ],
      {
        cwd: root,
        env: {
          ...env,
          // Appended, not replaced: a `NODE_OPTIONS` somebody set — or another
          // preload — has to survive being run through this.
          NODE_OPTIONS: [env.NODE_OPTIONS, `--require=${MOCK}`]
            .filter(Boolean)
            .join(" "),
          // The spec is opt-in, and this is the opt-in.
          ATR_PACKAGED_UPDATE_E2E: "1",
          [REPORT_ENV]: reportPath,
        },
      },
    );

    if (status === null) {
      error(
        "[refused-update-check] could not run the suite — is Playwright installed (`pnpm install`)?",
      );
      return 2;
    }

    let report = null;
    if (fs.existsSync(reportPath)) {
      try {
        report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      } catch (thrown) {
        error(
          `[refused-update-check] the JSON report at ${reportPath} would not parse (${thrown.message})`,
        );
      }
    }

    const { failures, notes } = assessRun({ status, report, output });

    for (const note of notes) log(`  · ${note}`);

    if (failures.length > 0) {
      for (const failure of failures) error(`  ✗ ${failure}`);
      error(
        `[refused-update-check] FAILED — ${failures.length} problem(s) with the run against a refusal`,
      );
      return 1;
    }

    log(
      "[refused-update-check] OK — every test that reads the feed stopped because GitHub refused, said so with a ::warning::, and nothing else in the suite failed",
    );
    return 0;
  } finally {
    fs.rmSync(place, { recursive: true, force: true });
  }
}

/**
 * True when this file is the program Node was asked to run.
 *
 * Compared through `fs.realpathSync`, not as strings: on macOS `os.tmpdir()`
 * hands back `/var/folders/...` while the loader resolves it to
 * `/private/var/...`, and a string compare then quietly does nothing.
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
      console.error(`[refused-update-check] ${thrown?.message ?? thrown}`);
      process.exit(2);
    });
}
