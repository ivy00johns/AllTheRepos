#!/usr/bin/env node
/**
 * Fail when anything a person can read still sends them through the Gatekeeper
 * override Apple removed.
 *
 * The regression this exists for is not hypothetical and not old. Every surface
 * this project had for explaining a refused first launch — the file inside the
 * DMG, the release notes, the maintainer's page, the CI warning — told people to
 * right-click the app and choose **Open**. Apple removed that Finder
 * contextual-menu override in macOS 15, so for every release cut from a current
 * Mac the instructions had been wrong, and the person they were wrong for was
 * stuck at the one moment nothing in the app could help them: the app is not
 * running yet.
 *
 * Two of those surfaces are now rendered from a single source
 * (`scripts/first-launch.mjs`), which is what stops them disagreeing. This is the
 * other half: the surfaces that are still hand-written — `README.md`,
 * `docs/RELEASING.md`, the changelog, the in-app notice — plus the one source
 * itself, so a well-meaning edit to a hand-written page, or to the sentences the
 * renderers compose, fails here rather than on a stranger's desktop.
 *
 * ## What counts as stale, and why the rule is shaped this way
 *
 * A blanket ban on the words is wrong: this repository has to be *able* to say
 * the override is gone, and it says so in half a dozen places, because a reader
 * reaching for the reflex needs to be told why it does not work any more. So the
 * test is on the sentence rather than the word:
 *
 *   1. **The fingerprint.** A `right-click` that is followed closely by a verb
 *      meaning "start the app" — `open`, `run`, `launch` — is an *instruction*.
 *      A right-click of a tray menu is not: `Get recent repos from the tray
 *      right-click menu` names a menu, and no amount of re-reading makes it a
 *      way past Gatekeeper.
 *   2. **The menu.** A right-click that names a menu *is* a menu, and a menu is
 *      not a way past Gatekeeper — so `menu` or `tray` in the same window clears
 *      the paragraph. That is what keeps the rule off
 *      `src/main/system/tray.ts`, which documents a `RIGHT-CLICK` fallback
 *      `Menu` in its header and a fallback "so the renderer's dispatch table can
 *      run the bound handler": both are about a menu bar, both are correct, and a
 *      check that failed on them would be a check somebody switches off.
 *
 *      Nothing else is carved out, and `Dock` is the one worth naming: choosing
 *      **Open** from the app's Dock icon was one of the real ways this override
 *      was reached, so that phrasing is exactly what has to fail here. And no
 *      gate is put on the *subject* of the paragraph — an earlier version only
 *      judged paragraphs that mentioned Gatekeeper or the DMG, which quietly
 *      stopped it seeing `Then right-click the app and choose Open` written on its
 *      own. The menu test distinguishes the two cases precisely; a subject test
 *      only looked like it did.
 *   3. **The correction.** An instruction is only stale if the same paragraph
 *      does not also say the shortcut is gone — `removed`, `no longer`, `any more`,
 *      `stopped`, `gone`, and a few more. "Right-click the app, choose Open" is a
 *      failure; "the right-click → Open shortcut Apple removed in macOS 15 is no
 *      longer the way" is the sentence this whole repository is trying to write.
 *
 * All three tests run on the **paragraph**, not the line, and that is the detail that
 * matters. Markdown wraps at 80 columns, so the instruction and its correction can
 * land on different lines — and so can `right-click` and the `Open` that makes it
 * an instruction. A line-based rule would miss the exact text that shipped, and
 * would fail the corrected version of it. A paragraph is the unit a reader
 * actually reads.
 *
 * This is a heuristic and it is honest about that: it catches the shape of the
 * mistake, not every conceivable wording of it. What it does guarantee is the
 * thing worth guaranteeing — that it is silent on this repository as it stands,
 * and loud on the sentences that were wrong.
 *
 * Usage:
 *   node scripts/check-first-launch-advice.mjs
 *   node scripts/check-first-launch-advice.mjs --verbose   # list the paragraphs it cleared
 *
 * Exit codes: 0 — no stale advice · 1 — at least one paragraph still gives it ·
 * 2 — the check could not run.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { releaseNoteParagraph, renderReadMeFirst, workflowWarning } from "./first-launch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Where a reader meets this project's words.
 *
 * Extensions rather than a file list, so a new document is covered the day it is
 * written rather than the day somebody remembers to add it. Anything binary, or
 * anything generated into `out/`/`release/`, is not tracked and so never reaches
 * here at all.
 */
export const SCANNED_EXTENSIONS = [
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".ts",
  ".tsx",
  ".mjs",
  ".js",
];

/**
 * A right-click, and then — within this many characters, on the same paragraph —
 * one of the verbs below.
 *
 * Sixty is picked to sit between two real sentences in this repository: `the
 * right-click → **Open** shortcut` (a match, at five characters) and `the tray
 * right-click -> recent-repo flows ... the CODE for the open-repo step` (not one,
 * at eighty-five). Wider than that and a tray menu drags an unrelated `open` into
 * range; narrower and a natural sentence like `right-click the app and choose
 * Open` slips through.
 */
export const FINGERPRINT_WINDOW = 60;

/** The right-click itself. Case-insensitive: this reads prose. */
export const RIGHT_CLICK = /right[- ]click/gi;

/**
 * What turns a right-click into an instruction.
 *
 * Deliberately only the verbs that mean "start the app". `Choose` and `select`
 * are not here because they need an object this cannot see, and requiring the
 * object would miss `then right-click the app → **Open** once`, where the object
 * and the verb are a line break apart.
 */
export const LAUNCH_VERB = /\b(?:open|run|launch)\b/i;

/**
 * What a paragraph has to say for its right-click to be a correction rather than
 * a repeat of the mistake.
 *
 * No bare `not`, and that is not an oversight: the sentence this guard was built
 * to catch — *"It is ad-hoc signed and **not** notarised, so the first launch has
 * to go through that menu"* — contains one, and a rule that accepted it would
 * have passed the very text it exists to fail.
 */
export const CORRECTED =
  /\bremoved\b|\bno longer\b|\bany more\b|\bno more\b|\bstopped\b|\bobsolete\b|\bgone\b|\bdropped\b|\bno such\b/i;

/**
 * What makes a right-click a menu rather than an instruction.
 *
 * Deliberately *not* including `Dock`: choosing **Open** from the app's Dock icon
 * is one of the phrasings this check exists to fail on, so carving it out would
 * carve out the answer. The two words here are the ones that only ever introduce
 * the menu bar's own fallback menu.
 */
export const MENU_CONTEXT = /\bmenu\b|\btray\b/i;

/**
 * Paragraphs: the text between blank lines.
 *
 * Exported with the line each one starts on, because a report that names a
 * paragraph without saying where it is leaves the reader to search for it.
 */
export function paragraphs(text) {
  const found = [];
  const lines = text.split("\n");
  let start = null;
  let buffer = [];

  const flush = () => {
    if (buffer.length === 0) return;
    found.push({ line: start + 1, text: buffer.join("\n") });
    buffer = [];
    start = null;
  };

  lines.forEach((line, index) => {
    if (line.trim().length === 0) {
      flush();
      return;
    }
    if (start === null) start = index;
    buffer.push(line);
  });
  flush();

  return found;
}

/**
 * The stale instructions in one piece of text.
 *
 * Pure, and exported, because the rule above is the whole of this check and it is
 * worth asserting directly against the sentences that were wrong rather than only
 * against the repository that happens to contain them.
 *
 * @returns {Array<{ line: number, excerpt: string, paragraph: string }>}
 */
export function findStaleAdvice(text) {
  const found = [];

  for (const paragraph of paragraphs(text)) {
    // Flattened for the fingerprint test only: the window has to be able to see
    // past a line break, because that is exactly where the shipped mistake put
    // its `Open`.
    const flat = paragraph.text.replace(/\s+/g, " ");
    if (CORRECTED.test(flat)) continue;

    RIGHT_CLICK.lastIndex = 0;
    let match;
    while ((match = RIGHT_CLICK.exec(flat)) !== null) {
      const window = flat.slice(
        match.index + match[0].length,
        match.index + match[0].length + FINGERPRINT_WINDOW,
      );
      // A right-click that names a menu is the menu bar's, not Gatekeeper's.
      if (MENU_CONTEXT.test(window)) continue;
      if (!LAUNCH_VERB.test(window)) continue;
      found.push({
        line: paragraph.line,
        excerpt: `${match[0]}${window}`.trim(),
        paragraph: paragraph.text.trim(),
      });
    }
  }

  return found;
}

/** The tracked text files this reads, in git's order. */
export function scannedFiles(root = ROOT) {
  const output = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  return output
    .split("\0")
    .filter((file) => file.length > 0)
    .filter((file) => SCANNED_EXTENSIONS.some((extension) => file.endsWith(extension)))
    .filter((file) => !file.includes("node_modules/"));
}

/**
 * The surfaces a single source renders, read back as if they were files.
 *
 * The renderers compose the facts, so a bad edit to `scripts/first-launch.mjs`
 * would reach all three at once — and the file on disk would still match what it
 * renders, which is why the freshness check in `first-launch.mjs` cannot see it.
 * Scanning what it prints closes that hole.
 */
export function renderedSurfaces() {
  return [
    { file: "scripts/first-launch.mjs (--print read-me)", text: renderReadMeFirst() },
    { file: "scripts/first-launch.mjs (--print release-note)", text: releaseNoteParagraph() },
    { file: "scripts/first-launch.mjs (--print warning)", text: workflowWarning() },
  ];
}

/**
 * Every stale instruction in the repository, and in what it renders.
 *
 * @returns {Array<{ file: string, line: number, excerpt: string, paragraph: string }>}
 */
export function scan({ root = ROOT, files = scannedFiles(root) } = {}) {
  const found = [];

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      // A tracked file that cannot be read is a checkout problem, not a stale
      // instruction, and this is not the check that should fail on it.
      continue;
    }
    for (const hit of findStaleAdvice(text)) found.push({ file, ...hit });
  }

  for (const surface of renderedSurfaces()) {
    for (const hit of findStaleAdvice(surface.text)) {
      found.push({ file: surface.file, ...hit });
    }
  }

  return found;
}

export function run({ root = ROOT, files, verbose = false, log = console.log, error = console.error } = {}) {
  const list = files ?? scannedFiles(root);
  const found = scan({ root, files: list });

  if (found.length === 0) {
    if (verbose) {
      for (const file of list) log(`  · ${file}`);
    }
    log(
      `[check-first-launch-advice] OK — no instruction in ${list.length} files sends anyone ` +
        `through the right-click override macOS 15 removed`,
    );
    return 0;
  }

  error(
    "[check-first-launch-advice] these paragraphs still tell a person to right-click the app open:",
  );
  for (const hit of found) {
    error(`  ✗ ${hit.file}:${hit.line}\n      ${hit.excerpt}…`);
  }
  error(
    "[check-first-launch-advice] FAILED — Apple removed that Finder override in macOS 15, so it is " +
      "a step that does not exist. The procedure that works is System Settings → Privacy & " +
      "Security → Open Anyway, written once in `scripts/first-launch.mjs` and rendered from " +
      "there into the DMG's file, the release notes and the CI warning. Point this paragraph at " +
      "it, or say the right-click is gone if that is the point being made.",
  );
  return 1;
}

/**
 * True when this file is the program Node was asked to run.
 *
 * Compared through `fs.realpathSync`, not as strings: the same file has two paths
 * whenever a symlink is involved — on macOS `os.tmpdir()` hands back
 * `/var/folders/...` while the loader resolves it to `/private/var/...` — and a
 * string compare then quietly finds nothing to complain about, exiting 0 as
 * though every page had been read and cleared.
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
    process.exit(run({ verbose: process.argv.includes("--verbose") }));
  } catch (thrown) {
    console.error(`[check-first-launch-advice] ${thrown?.message ?? thrown}`);
    process.exit(2);
  }
}
