#!/usr/bin/env node
/**
 * The first-launch instructions — written down once, rendered four ways.
 *
 * A downloaded build is ad-hoc signed and not notarised, so macOS refuses to open
 * it until it is allowed through System Settings. Those words have to reach four
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
 *   4. The one-time notice the app itself shows
 *      (`src/renderer/components/layout/adhoc-build-notice.tsx`), which is what
 *      explains the launch to somebody who is already inside the app and may
 *      never open the file again.
 *
 * Each of those used to carry its own copy of the same sentences, and all of them
 * were wrong in the same way: they named the right-click → Open override that
 * Apple removed in macOS 15. That is the shape of the failure this file exists to
 * make impossible — a fact repeated in four places is a fact updated in three of
 * them, and the copy that was missed is the one somebody reads while stuck.
 *
 * So the facts are exported and the renderers compose them. (1) is a file inside
 * the DMG and (4) is a generated TypeScript module, because the renderer cannot
 * import this one: it reads `node:fs` to check that file, and the renderer is a
 * Chromium bundle with no Node built-ins in it. `--check` fails when either of
 * them is not what this would write, which is what keeps them honest without
 * anybody having to remember.
 *
 * What is deliberately *not* here: the maintainer prose in `docs/RELEASING.md`,
 * which says related things for a different reader — the person cutting the
 * release rather than the person installing it — and folding it in would mean a
 * worse page. The advice check (`scripts/check-first-launch-advice.mjs`) covers
 * it instead, so it cannot drift into the wrong instruction.
 *
 * Usage:
 *   node scripts/first-launch.mjs --print read-me       # the DMG's file
 *   node scripts/first-launch.mjs --print release-note  # the notes paragraph
 *   node scripts/first-launch.mjs --print notice        # the in-app notice
 *   node scripts/first-launch.mjs --print warning       # what ad-hoc costs
 *   node scripts/first-launch.mjs --check               # are those files current?
 *   node scripts/first-launch.mjs --write               # rewrite them
 *
 * Exit codes: 0 — printed, or the files are current · 1 — a file has drifted ·
 * 2 — the script could not run (bad usage).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where the DMG's instructions live, relative to the repository root. */
export const READ_ME_FIRST = "resources/READ-ME-FIRST.txt";

/**
 * Where the in-app notice's words live once they leave this file.
 *
 * `src/shared/` because it is the one directory both TypeScript projects include
 * — the root `tsconfig.json` for the tests and `tsconfig.web.json` for the
 * renderer that shows it — and because a generated file nobody typechecks is a
 * generated file nobody notices.
 */
export const NOTICE_MODULE = "src/shared/adhoc-notice.ts";

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
 * What the signature costs besides the first launch, said once for every surface
 * that has to mention it.
 *
 * No capital and no full stop: the CI warning uses it as the tail of a log line
 * and the in-app notice uses it mid-sentence, and neither can afford a sentence
 * fragment that only fits where it was written.
 */
export const CANNOT_INSTALL_UPDATES = "the app cannot install its own updates";

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
    `${settingsPath()}, and ${CANNOT_INSTALL_UPDATES}.`
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

/** The in-app notice's heading, as it appears at the top of the window. */
export function noticeTitle() {
  return "macOS asked you to confirm the first launch — here is why";
}

/**
 * The in-app notice's body.
 *
 * The fourth surface, and the only one written for somebody who is already
 * inside the app: by the time it is read the launch has been allowed through, so
 * it explains what that was rather than telling anybody what to do. It composes
 * the same two facts as the surfaces above — the procedure, and what the
 * signature costs besides the dialog — and keeps sentences of its own, because a
 * person who has just clicked a confirmation needs an explanation and not a
 * numbered list they no longer have a use for.
 */
export function noticeBody() {
  return [
    "This build is ad-hoc signed and not notarised by Apple, so macOS refused",
    `it until you allowed it through ${settingsPath()}. The same fact is why`,
    `${CANNOT_INSTALL_UPDATES}: a notarised build removes both steps.`,
  ].join(" ");
}

/** Both halves of the notice, as `--print notice` prints them. */
export function noticeText() {
  return `${noticeTitle()}\n\n${noticeBody()}`;
}

/**
 * The notice as the renderer imports it.
 *
 * A generated TypeScript module rather than an import of this file, and that is
 * forced rather than chosen: this file reads `node:fs` to check the DMG's copy,
 * and a Chromium bundle cannot load that. So the words travel the way the DMG's
 * file does — written by `--write`, verified byte for byte by `--check` — which
 * is also what keeps the last hand-written copy of these sentences from coming
 * back the next time somebody edits the component.
 */
export function renderNoticeModule() {
  return [
    "/**",
    " * The in-app first-launch notice, as the app says it.",
    " *",
    " * Generated by `scripts/first-launch.mjs` — **do not edit this file.** That",
    " * script holds the facts every surface explaining a refused first launch is",
    " * rendered from, and this is the fourth of them: the `READ-ME-FIRST.txt`",
    " * inside the DMG, the paragraph the release notes carry, the `::warning::` a",
    " * certificate-less CI run prints, and the notice",
    " * `components/layout/adhoc-build-notice.tsx` shows once somebody is inside",
    " * the app.",
    " *",
    " * It is generated rather than imported because its source is a Node script —",
    " * it reads `node:fs` to compare the DMG's copy — and the renderer is a",
    " * Chromium bundle with no Node built-ins in it.",
    " *",
    " * `pnpm first-launch:write` rewrites it, and `pnpm first-launch:check` fails",
    " * when it has drifted, which is what stops it becoming a fifth hand-written",
    " * copy of the same sentences.",
    " */",
    "",
    `export const AD_HOC_NOTICE_TITLE = ${JSON.stringify(noticeTitle())};`,
    "",
    `export const AD_HOC_NOTICE_BODY = ${JSON.stringify(noticeBody())};`,
    "",
  ].join("\n");
}

/** The four things this file renders, by the name `--print` takes. */
export const PRINTS = Object.freeze({
  "read-me": renderReadMeFirst,
  "release-note": releaseNoteParagraph,
  notice: noticeText,
  warning: workflowWarning,
});

/**
 * The files this script renders, so no renderer escapes the check.
 *
 * Both are written by `--write` and compared by `--check`: adding a renderer
 * without adding it here would be a file nobody notices drifting, which is the
 * failure this whole script exists to make impossible.
 */
export const RENDERED_FILES = Object.freeze([
  { file: READ_ME_FIRST, render: renderReadMeFirst },
  { file: NOTICE_MODULE, render: renderNoticeModule },
]);

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
function checkRendered({ root = ROOT, file, expected }) {
  const target = path.join(root, file);
  let actual;
  try {
    actual = fs.readFileSync(target, "utf8");
  } catch {
    return { ok: false, file, target, reason: `${file} does not exist` };
  }
  if (actual !== expected) {
    return {
      ok: false,
      file,
      target,
      reason: `${file} is not what this file renders`,
      expected,
      actual,
    };
  }
  return { ok: true, file, target, reason: "matches" };
}

export function checkReadMeFirst({ root = ROOT } = {}) {
  return checkRendered({ root, file: READ_ME_FIRST, expected: renderReadMeFirst() });
}

/**
 * Every rendered file, in the order they are listed, drifted or not.
 *
 * All of them rather than the first: a run that stopped at the DMG's file would
 * leave the notice to be discovered on the next push, and one repair flag fixes
 * both anyway.
 */
export function checkRenderedFiles({ root = ROOT } = {}) {
  return RENDERED_FILES.map((entry) =>
    checkRendered({ root, file: entry.file, expected: entry.render() }),
  );
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
    for (const entry of RENDERED_FILES) {
      const target = path.join(ROOT, entry.file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.render());
      console.log(`[first-launch] wrote ${entry.file}`);
    }
    return;
  }

  if (args.includes("--check")) {
    const results = checkRenderedFiles();
    for (const result of results) {
      if (result.ok) {
        console.log(`[first-launch] OK — ${result.file} matches this file`);
        continue;
      }
      console.error(`[first-launch] ${result.reason}`);
      const difference = firstDifference(result.expected ?? "", result.actual ?? "");
      if (difference) {
        console.error(`  line ${difference.line}`);
        console.error(`    expected: ${difference.expected}`);
        console.error(`    found:    ${difference.actual}`);
      }
    }

    if (results.every((result) => result.ok)) return;

    console.error(
      "[first-launch] a surface rendered from this file has drifted from what it renders: " +
        "the instructions a person reads inside the DMG, or the words of the notice the app " +
        "shows once they are inside it. Run `node scripts/first-launch.mjs --write` to bring " +
        "them back in line.",
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
