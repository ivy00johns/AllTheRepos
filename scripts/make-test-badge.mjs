#!/usr/bin/env node
/**
 * Write the README's test-count badge from a real test run.
 *
 * The badge it replaces was a shields.io URL with the count typed into it:
 * `img.shields.io/badge/tests-1%2C067%20passing-success.svg`. Nothing keeps a
 * number in a URL honest, and this one went stale twice — once when the suite
 * grew to 1,139 and again to 1,189, both times noticed only because somebody
 * was editing the README for another reason. A number that only a human can
 * update is a number that is wrong most of the time.
 *
 * So the badge is an SVG in the repository now, generated from the JSON report
 * of a test run, and CI regenerates it on every push to `main` and commits the
 * result when the counts move. That is the whole point: the count cannot drift,
 * because the only thing that writes it is the suite it describes.
 *
 * The report is Vitest's `--reporter=json`, which is Jest-compatible —
 * `numTotalTests`, `numFailedTests` and `success`. The badge reports the total
 * and how many passed, and turns red the moment anything fails, so a red badge
 * on the README means a red suite rather than a forgotten edit.
 *
 * `docs/images/` is where the other generated README art lives
 * (`scripts/make-readme-shots.mjs` writes the screenshots there), and the
 * README references both by relative path, which is what renders in a private
 * repository — a shields.io badge is fetched by shields' own servers, which
 * cannot read a private repo, but a file in the repo renders for anyone with
 * access to it.
 *
 * Usage:
 *   pnpm test:report                       # writes .vitest-results.json
 *   node scripts/make-test-badge.mjs       # -> docs/images/tests.svg
 *   node scripts/make-test-badge.mjs --check   # fail if the badge is stale
 *
 * `--report <path>`, `--out <path>` and `--check` exist for tests and for a
 * CI job that wants to verify without writing.
 *
 * Exit codes: 0 — written, or already current · 1 — no usable report, or
 * `--check` found the file out of date.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Vitest's JSON report, written next to the tree it describes. */
export const REPORT_PATH = ".vitest-results.json";

/** Where the README expects to find it, relative to the repository root. */
export const BADGE_PATH = "docs/images/tests.svg";

const LABEL = "tests";
const GREEN = "#4c1";
const RED = "#e05d44";
const GREY = "#555";

/**
 * The counts the badge is made of.
 *
 * Reads the Jest-compatible fields Vitest writes. A report with no `numTotalTests`
 * is not a test report — running the reporter against a path with no tests, or
 * handing this a coverage summary, must not render "0 passing" and quietly
 * publish a badge that says the suite is empty.
 *
 * @returns {{ tests: number, failed: number, success: boolean }}
 */
export function badgeFacts(report) {
  const tests = Number(report?.numTotalTests);
  if (!Number.isFinite(tests)) {
    throw new Error(
      "the report has no numTotalTests — is it Vitest's --reporter=json output?",
    );
  }
  const failed = Number(report?.numFailedTests ?? 0);
  return { tests, failed, success: report?.success !== false && failed === 0 };
}

/** `1189` -> `1,189`. The README's other badges read that way. */
function withCommas(count) {
  return count.toLocaleString("en-US");
}

/** Exported for the test that pins it: the badge text lands in attributes too. */
export function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Rough advance width of `text` at 11px, in the sans-serif stack below.
 *
 * Not a font metric — a badge is a picture with two words in it, and shipping a
 * text-measuring dependency for that would be absurd. It over-estimates digits
 * slightly, which is the safe direction: the failure mode of an under-estimate
 * is a clipped count, and a clipped count is exactly the bug this file exists to
 * stop. `a 6-digit count is wider than a 3-digit one` is pinned by a test.
 */
function textWidth(text) {
  return text.length * 6.6;
}

/** A badge box: the text, plus 5px of padding on each side (shields' shape). */
function boxWidth(text) {
  return Math.ceil(textWidth(text) + 10);
}

/**
 * The badge as a self-contained SVG, in the flat style of the shields badges
 * beside it: grey label, coloured value, 20px tall, rounded outer corners, and
 * a soft shadow under the text (drawn as a second copy offset by a pixel, which
 * is how shields does it without a filter).
 */
export function renderBadge({ tests, failed }) {
  const passing = failed === 0;
  const message = passing ? `${withCommas(tests)} passing` : `${withCommas(failed)} failing`;
  const color = passing ? GREEN : RED;

  const labelWidth = boxWidth(LABEL);
  const valueWidth = boxWidth(message);
  const total = labelWidth + valueWidth;
  const labelCentre = labelWidth / 2;
  const valueCentre = labelWidth + valueWidth / 2;
  const label = escapeXml(LABEL);
  const value = escapeXml(message);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${total}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="${GREY}"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelCentre}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelCentre}" y="14">${label}</text>
    <text x="${valueCentre}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${valueCentre}" y="14">${value}</text>
  </g>
</svg>
`;
}

/**
 * Read the report, render the badge, and write it (or check it).
 *
 * @returns {{ ok: boolean, current: boolean, tests: number, failed: number,
 *             badgePath: string, message: string }}
 */
export function writeBadge({
  reportPath = path.join(ROOT, REPORT_PATH),
  badgePath = path.join(ROOT, BADGE_PATH),
  check = false,
} = {}) {
  if (!fs.existsSync(reportPath)) {
    throw new Error(
      `no report at ${reportPath} — run \`pnpm test:report\` first (it is what writes it)`,
    );
  }

  const facts = badgeFacts(JSON.parse(fs.readFileSync(reportPath, "utf8")));
  const svg = renderBadge(facts);
  const message = facts.success
    ? `${withCommas(facts.tests)} passing`
    : `${withCommas(facts.failed)} failing`;

  const existing = fs.existsSync(badgePath)
    ? fs.readFileSync(badgePath, "utf8")
    : null;
  const current = existing === svg;

  if (check && !current) {
    return {
      ok: false,
      current: false,
      ...facts,
      badgePath,
      message: `${badgePath} is out of date — run \`pnpm badges\` and commit the result`,
    };
  }

  if (!check && !current) {
    fs.mkdirSync(path.dirname(badgePath), { recursive: true });
    fs.writeFileSync(badgePath, svg);
  }

  return { ok: true, current, ...facts, badgePath, message };
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
 * string compare then quietly does nothing at all, exiting 0 as if the badge had
 * been written.
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
  const positional = args.find((arg) => !arg.startsWith("--") && arg.endsWith(".json"));
  const reportFlag = flagValue(args, "--report");
  const outFlag = flagValue(args, "--out");
  const check = args.includes("--check");

  try {
    const result = writeBadge({
      reportPath: path.resolve(ROOT, reportFlag ?? positional ?? REPORT_PATH),
      badgePath: path.resolve(ROOT, outFlag ?? BADGE_PATH),
      check,
    });

    if (!result.ok) {
      console.error(`[make-test-badge] ${result.message}`);
      process.exit(1);
    }
    if (check) {
      console.log(`[make-test-badge] ${result.badgePath} is current (${result.message})`);
    } else {
      console.log(
        `[make-test-badge] tests ${result.message} -> ${path.relative(ROOT, result.badgePath)}`,
      );
    }
  } catch (error) {
    console.error(`[make-test-badge] ${error?.message ?? error}`);
    process.exit(1);
  }
}
