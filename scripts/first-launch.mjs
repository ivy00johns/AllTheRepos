#!/usr/bin/env node
/**
 * The first-launch instructions — written down once, rendered three ways.
 *
 * A downloaded build is ad-hoc signed and not notarised, so macOS refuses to open
 * it until it is allowed through System Settings. Those words have to reach three
 * different places, and they have to agree:
 *
 *   1. `resources/READ-ME-FIRST.txt` — inside the DMG. This is the only surface
 *      that exists *before* Gatekeeper has refused the launch, and it is the whole
 *      of the explanation for somebody who never gets past it: once the launch is
 *      refused there is nothing running that could explain anything.
 *   2. The paragraph the release notes attach, which is what a person reads
 *      before they download at all.
 *   3. The `::warning::` a certificate-less CI run prints, which is what tells a
 *      maintainer what kind of release they have just made.
 *
 * Each of those used to carry its own copy of the same sentences, and all three
 * were wrong in the same way: they named the right-click → Open override that
 * Apple removed in macOS 15. That is the shape of the failure this file exists to
 * make impossible — a fact repeated in three places is a fact updated in two of
 * them, and the copy that was missed is the one somebody reads while stuck.
 *
 * So the facts are exported and the renderers compose them. `--check` fails when
 * the file on disk is not what this would write, which is what keeps (1) honest
 * without anybody having to remember.
 *
 * What is deliberately *not* here: the in-app notice
 * (`src/renderer/components/layout/adhoc-build-notice.tsx`) and the maintainer
 * prose in `docs/RELEASING.md`. Both say related things for different readers —
 * the notice is an explanation of something that already happened, and RELEASING
 * is a maintainer's page — and folding either in would mean a build step or a
 * worse text. The advice check (`scripts/check-first-launch-advice.mjs`) covers
 * them instead, so they cannot drift into the wrong instruction.
 *
 * Usage:
 *   node scripts/first-launch.mjs --print read-me       # the DMG's file
 *   node scripts/first-launch.mjs --print release-note  # the notes paragraph
 *   node scripts/first-launch.mjs --print warning       # what ad-hoc costs
 *   node scripts/first-launch.mjs --check               # is the file current?
 *   node scripts/first-launch.mjs --write               # rewrite it
 *
 * Exit codes: 0 — printed, or the file is current · 1 — the file has drifted ·
 * 2 — the script could not run (bad usage).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where the DMG's instructions live, relative to the repository root. */
export const READ_ME_FIRST = "resources/READ-ME-FIRST.txt";

export const APP_NAME = "AllTheRepos";

/** Where the DMG puts the app, and where the instructions assume it is. */
export const INSTALL_PATH = `/Applications/${APP_NAME}.app`;

/**
 * Apple's procedure, in the order the menu reads it.
 *
 * Three parts rather than one string because the renders punctuate it
 * differently: the DMG's file stops at Privacy & Security and then names the
 * button on its own line, while the notes and the warning spell the whole path
 * out in one breath.
 */
export const SETTINGS_PATH = ["System Settings", "Privacy & Security", "Open Anyway"];

/** The Gatekeeper override this project used to document, and no longer may. */
export const REMOVED_SHORTCUT = { verb: "right-click", choose: "Open" };

/** The macOS release that took that override away. */
export const SHORTCUT_REMOVED_IN = "macOS 15";

/** What macOS says when it refuses, quoted in the file so it is recognisable. */
export const REFUSAL_QUOTE = `Apple could not verify "${APP_NAME}" is free of malware.`;

/** The other way through, for somebody who would rather not click dialogs. */
export const QUARANTINE_COMMAND = `xattr -dr com.apple.quarantine ${INSTALL_PATH}`;

/**
 * The arrow, per format.
 *
 * The plain-text file is read in a terminal and a text editor, so it stays ASCII
 * — a `→` there is one mojibake away from being noise in somebody's `cat`
 * output. Markdown is rendered by GitHub, so it gets the real arrow.
 */
/**
 * How an arrow is written.
 *
 * The DMG's file is read with `cat` and in text editors, so it stays ASCII — a
 * `→` there is one mojibake away from being noise. Anything GitHub renders gets
 * the real arrow.
 */
export const ARROW = Object.freeze({ plain: "->", rich: "→" });

/**
 * The removed shortcut, written for the place it appears.
 *
 * Exported so the advice check can quote the exact phrase it forbids rather than
 * spelling the instruction a second time and drifting from this one.
 */
export function removedShortcut(arrow = ARROW.rich) {
  const { verb, choose } = REMOVED_SHORTCUT;
  return arrow === ARROW.rich
    ? `${verb} ${arrow} **${choose}**`
    : `${verb} ${arrow} ${choose}`;
}

/**
 * `System Settings → Privacy & Security → Open Anyway`, mid-sentence.
 *
 * Emphasis is left to the caller: the release notes want it bold, and the CI
 * warning is a log line where `**` would show up as literal asterisks.
 */
export function settingsPath(arrow = ARROW.rich) {
  return SETTINGS_PATH.join(` ${arrow} `);
}

/**
 * The paragraph the release notes carry in place of their own copy.
 *
 * Only ever used on the ad-hoc path: a run that resolved a Developer ID says
 * there is no Gatekeeper warning instead, and `release.yml` branches on
 * `SIGNING` to decide which. See the notes step there.
 */
export function releaseNoteParagraph() {
  // The path is composed from its three parts here rather than through
  // `settingsPath()`, only so the line break can fall inside it: this paragraph
  // is read in a diff and in an editor as often as it is rendered, and an
  // 80-column wrap is worth the two extra interpolations.
  const [systemSettings, privacy, openAnyway] = SETTINGS_PATH;
  const joiner = ` ${ARROW.rich}`;
  return [
    "macOS will refuse the first launch, and that is expected: this build is ad-hoc",
    `signed and **not notarised**. The ${removedShortcut()} shortcut older macOS`,
    `accepted was removed in ${SHORTCUT_REMOVED_IN}, so the way through is **${systemSettings}${joiner}`,
    `${privacy}${joiner} ${openAnyway}** — after trying to open the app. The same`,
    "steps are in `READ-ME-FIRST.txt` inside the DMG. Every launch after that is an",
    "ordinary double-click.",
  ].join("\n");
}

/**
 * What an ad-hoc build costs, as the `::warning::` line.
 *
 * The consequence only. The workflow wraps it in the CI-specific frame — which
 * secret is missing, and what to do about it — because those are facts about a
 * repository's secrets rather than about macOS.
 */
export function workflowWarning() {
  return (
    `macOS will refuse the first launch until it is allowed once through ` +
    `${settingsPath()}, and the app cannot install its own updates.`
  );
}

/** A heading and the rule under it, in the plain-text file's own style. */
function underlined(heading) {
  return [heading, "-".repeat(heading.length)];
}

/**
 * The whole of `resources/READ-ME-FIRST.txt`.
 *
 * Built as lines rather than one long template literal so the wrapping is
 * explicit: this file is read in a terminal, where a paragraph on one very long
 * line is unreadable, and inside a DMG where nobody can reflow it.
 */
export function renderReadMeFirst() {
  const title = `${APP_NAME} — first launch, and why macOS stops you`;
  const [systemSettings, privacy, openAnyway] = SETTINGS_PATH;

  const lines = [
    title,
    "=".repeat(title.length),
    "",
    "This app is not notarised by Apple, so macOS refuses to open it the first time",
    `and asks you to confirm. The ${removedShortcut(ARROW.plain)} shortcut that older versions of`,
    `macOS accepted was removed in ${SHORTCUT_REMOVED_IN}, so this is the way through it now:`,
    "",
    `  1. Drag ${APP_NAME} into Applications, then open it and let macOS refuse.`,
    `     ("${REFUSAL_QUOTE}")`,
    "",
    `  2. Open ${systemSettings} ${ARROW.plain} ${privacy}.`,
    "",
    `  3. Scroll down to Security. Next to the line naming ${APP_NAME}, click`,
    `     ${openAnyway}.`,
    "",
    "  4. The warning appears once more, with an Open button. Confirm it.",
    "",
    "macOS remembers that as an exception for this app, so every launch after that is",
    "an ordinary double-click.",
    "",
    "If you would rather not click through a dialog, this does the same thing from",
    'Terminal — it clears the "downloaded from the internet" flag, which is what',
    "triggers the check:",
    "",
    `    ${QUARANTINE_COMMAND}`,
    "",
    "",
    ...underlined("Why this is necessary"),
    "",
    "The build is ad-hoc signed rather than signed with an Apple Developer ID",
    "certificate and notarised by Apple. Notarisation is precisely the thing that",
    "removes this step, and it is not something an app can do for itself — it needs a",
    "paid Apple Developer account, which this project does not have yet.",
    "",
    "The same fact is why the app checks for updates but does not install them.",
    `macOS only applies an update to a build it trusts, so ${APP_NAME} will tell you`,
    "when a newer release exists and open its download page; updating means",
    "downloading the new DMG. On a notarised build it downloads and installs the",
    "update itself, and this file stops being necessary.",
    "",
    "",
    ...underlined("This is not a broken download"),
    "",
    "The app *is* signed — an ad-hoc signature, which is what lets it run at all on",
    "Apple silicon — and `codesign --verify` passes on it. It simply is not",
    "notarised, which is a separate stamp from Apple that costs a membership. Nothing",
    "here indicates a corrupt or tampered file.",
  ];

  return `${lines.join("\n")}\n`;
}

/** The three things this file renders, by the name `--print` takes. */
export const PRINTS = Object.freeze({
  "read-me": renderReadMeFirst,
  "release-note": releaseNoteParagraph,
  warning: workflowWarning,
});

function fail(message, code = 2) {
  console.error(`[first-launch] ${message}`);
  process.exit(code);
}

/**
 * Whether the file on disk is what this would write.
 *
 * Exported for the tests and for the advice check, which reports drift as one of
 * the ways the story is inconsistent.
 */
export function checkReadMeFirst({ root = ROOT } = {}) {
  const target = path.join(root, READ_ME_FIRST);
  const expected = renderReadMeFirst();
  let actual;
  try {
    actual = fs.readFileSync(target, "utf8");
  } catch {
    return { ok: false, target, reason: `${READ_ME_FIRST} does not exist` };
  }
  if (actual !== expected) {
    return {
      ok: false,
      target,
      reason: `${READ_ME_FIRST} is not what this file renders`,
      expected,
      actual,
    };
  }
  return { ok: true, target, reason: "matches" };
}

/** First differing line, so the report points at the edit rather than the file. */
export function firstDifference(expected, actual) {
  const left = expected.split("\n");
  const right = actual.split("\n");
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) {
      return {
        line: index + 1,
        expected: left[index] ?? "<end of file>",
        actual: right[index] ?? "<end of file>",
      };
    }
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  const printIndex = args.indexOf("--print");
  const modes = Object.keys(PRINTS);

  if (printIndex !== -1) {
    const mode = args[printIndex + 1];
    if (!modes.includes(mode ?? "")) {
      fail(`--print takes one of: ${modes.join(", ")} (got "${mode ?? ""}")`);
    }
    // A newline only when the render did not end with one. `--print read-me`
    // has to be byte-identical to the file it describes, or redirecting it to
    // that file is a one-line diff nobody can explain.
    const body = PRINTS[mode]();
    process.stdout.write(body.endsWith("\n") ? body : `${body}\n`);
    return;
  }

  if (args.includes("--write")) {
    const target = path.join(ROOT, READ_ME_FIRST);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, renderReadMeFirst());
    console.log(`[first-launch] wrote ${READ_ME_FIRST}`);
    return;
  }

  if (args.includes("--check")) {
    const result = checkReadMeFirst();
    if (result.ok) {
      console.log(`[first-launch] OK — ${READ_ME_FIRST} matches this file`);
      return;
    }
    console.error(`[first-launch] ${result.reason}`);
    const difference = firstDifference(result.expected ?? "", result.actual ?? "");
    if (difference) {
      console.error(`  line ${difference.line}`);
      console.error(`    expected: ${difference.expected}`);
      console.error(`    found:    ${difference.actual}`);
    }
    console.error(
      "[first-launch] the instructions a person reads inside the DMG have drifted from " +
        "the ones the release notes and the CI warning render. Run " +
        "`node scripts/first-launch.mjs --write` to bring the file back in line.",
    );
    process.exit(1);
  }

  fail(
    "nothing to do. Use --print <" + modes.join("|") + ">, --check, or --write.",
  );
}

/**
 * True when this file is the program Node was asked to run.
 *
 * Compared through `fs.realpathSync`, not as strings: the same file has two paths
 * whenever a symlink is involved — on macOS `os.tmpdir()` hands back
 * `/var/folders/...` while the loader resolves it to `/private/var/...` — and a
 * string compare then quietly prints nothing at all, exiting 0 as though a
 * release note had been written.
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
    main();
  } catch (error) {
    console.error(`[first-launch] ${error?.message ?? error}`);
    process.exit(2);
  }
}
