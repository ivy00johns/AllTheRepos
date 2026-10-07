#!/usr/bin/env node
/**
 * The front door must not name a release version.
 *
 * `README.md` said *"The current release is `v0.1.6`"* for two releases after
 * that stopped being true, and nothing noticed — `pnpm links:check` verifies
 * that a link **resolves**, and `.../alltherepos-releases/releases` resolved
 * perfectly the whole time. It pointed at the list of releases, next to prose
 * that named a version which had already been superseded twice. A wrong version
 * number is worse than no version number: no number sends a reader to the feed,
 * a stale one sends them to a download they will then have to second-guess.
 *
 * Two things make the number unnecessary, and both of them update themselves:
 *
 *   - `.../releases/latest` **redirects** to the newest release, so it is a link
 *     that cannot go stale no matter how many versions ship;
 *   - the release badge is drawn by shields.io from the feed, so the number in
 *     the header is read from the same place the updater reads.
 *
 * So the rule this enforces is the shape of the mistake rather than a ban on
 * version-shaped text: **a `vX.Y.Z` on a line that also points at the releases
 * repo**. That is exactly a claim about which release is current, and this
 * repository contains the two cases that must not be caught by a blunter rule:
 *
 *   - `git tag v0.1.3 && git push origin v0.1.3` in the README's Releasing block
 *     is an *example command*, not a claim — hence fenced code is skipped;
 *   - `~/.nvm/versions/node/v22.22.3/bin/node` in `START-HERE.md` is a **Node**
 *     version, and it is nowhere near the releases repo, so anchoring the search
 *     to that repo's name leaves it alone. (A rule of "no `vX.Y.Z` anywhere"
 *     would have failed on the day it landed.)
 *
 * `CHANGELOG.md` is deliberately not in scope. It is a history of released
 * versions and every one of its footnotes names one; a changelog that could not
 * say `v0.1.7` would not be a changelog.
 *
 * Usage:
 *   node scripts/check-doc-versions.mjs
 *
 * Exit codes: 0 — no front door claims a version · 1 — one does, and every claim
 * is printed · 2 — a guarded file is missing, so there was nothing to check.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The docs a person reads to decide whether to download — the ones that speak in
 * the present tense about what is current.
 *
 * Kept as an explicit list rather than "every `.md`", because the ledger
 * (`docs/REMAINING-WORK.md`) and the plans date their claims on purpose ("true of
 * the world as of 2026-10-06") and a version in a dated sentence is a citation,
 * not a claim that rots.
 */
export const FRONT_DOOR = ["README.md", "START-HERE.md"];

/** The repo releases are published to — the anchor a version claim hangs off. */
export const RELEASES_REPO = "alltherepos-releases";

/** A released version, as this project writes one: `v0.1.8`. */
const VERSION = /\bv\d+\.\d+\.\d+\b/g;

/**
 * Drop fenced code blocks, keeping one entry per line so line numbers survive.
 *
 * Fences are the README's example commands — `git tag v0.1.3` is illustrating
 * the procedure, and flagging it would be the check rejecting its own
 * documentation of how a release is cut.
 */
export function withoutFences(markdown) {
  let fenced = false;
  return markdown.split("\n").map((line) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return "";
    }
    return fenced ? "" : line;
  });
}

/**
 * Every version this document claims is current.
 *
 * @returns {Array<{file: string, line: number, version: string}>}
 */
export function claimsIn(markdown, file) {
  const claims = [];

  withoutFences(markdown).forEach((line, index) => {
    if (!line.includes(RELEASES_REPO)) return;
    for (const match of line.matchAll(VERSION)) {
      claims.push({ file, line: index + 1, version: match[0] });
    }
  });

  return claims;
}

/**
 * What is wrong with the front door, if anything.
 *
 * Pure, so the two near-misses above are unit-tested against fixtures rather than
 * trusted to survive the next edit of this regex.
 *
 * @returns {{ failures: string[], notes: string[] }}
 */
export function assess({ root = ROOT, files = FRONT_DOOR } = {}) {
  const failures = [];
  const notes = [];

  for (const file of files) {
    const at = path.join(root, file);
    if (!fs.existsSync(at)) {
      failures.push(
        `${file} is not there — the front door moved, and this check is now looking at nothing`,
      );
      continue;
    }

    const claims = claimsIn(fs.readFileSync(at, "utf8"), file);

    for (const claim of claims) {
      failures.push(
        `${claim.file}:${claim.line} names ${claim.version} on a line pointing at ${RELEASES_REPO} — link \`.../releases/latest\` instead, which redirects, and leave the number to the feed and the badge, which are read from it`,
      );
    }

    if (claims.length === 0) notes.push(`${file} — names no release version`);
  }

  return { failures, notes };
}

/**
 * Check the front door, and say what a reader would be told.
 *
 * @returns {number} the exit code for this process.
 */
export function run({ root = ROOT, files = FRONT_DOOR, log = console.log, error = console.error } = {}) {
  const { failures, notes } = assess({ root, files });

  // A missing file is not a claim, and it means the check examined less than it
  // says it did — that is "could not run", not "found something".
  const missing = files.filter((file) => !fs.existsSync(path.join(root, file)));
  if (missing.length > 0) {
    for (const failure of failures) error(`  ✗ ${failure}`);
    error(`[check-doc-versions] could not run — ${missing.length} guarded file(s) missing`);
    return 2;
  }

  for (const note of notes) log(`  · ${note}`);

  if (failures.length > 0) {
    for (const failure of failures) error(`  ✗ ${failure}`);
    error(
      `[check-doc-versions] FAILED — ${failures.length} version claim(s) in the front door`,
    );
    return 1;
  }

  log(
    `[check-doc-versions] OK — ${files.length} front-door doc(s) point at the feed without naming a version`,
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
  try {
    process.exit(run());
  } catch (thrown) {
    console.error(`[check-doc-versions] ${thrown?.message ?? thrown}`);
    process.exit(2);
  }
}
