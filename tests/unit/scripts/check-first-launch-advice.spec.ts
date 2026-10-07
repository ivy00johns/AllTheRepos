/**
 * Unit test for `scripts/check-first-launch-advice.mjs` — the check that fails CI
 * when anything a person can read still sends them through the Gatekeeper override
 * Apple removed.
 *
 * A heuristic is only worth having if both of its halves are pinned down: that it
 * fires on the mistake, and that it stays silent on everything else. The first
 * half is easy and this file does it with the text that actually shipped — kept
 * verbatim, wrapped exactly as it was, because the wrap is part of the bug. The
 * second half is the one that decides whether anyone keeps the check switched on,
 * so it is tested against the neighbouring sentences in this repository that look
 * like the mistake and are not: the tray's own right-click menu, which is a menu
 * bar feature and perfectly correct.
 *
 * The repository itself is asserted clean at the end, which is the same thing CI
 * runs. A fixture-only test would pass on a tree full of stale advice.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "check-first-launch-advice.mjs");

interface Hit {
  line: number;
  excerpt: string;
  paragraph: string;
}

interface AdviceModule {
  SCANNED_EXTENSIONS: string[];
  FINGERPRINT_WINDOW: number;
  MENU_CONTEXT: RegExp;
  NOT_ADVICE: RegExp[];
  isAdviceSurface(file: string): boolean;
  paragraphs(text: string): Array<{ line: number; text: string }>;
  findStaleAdvice(text: string): Hit[];
  renderedSurfaces(): Array<{ file: string; text: string }>;
  scannedFiles(root?: string): string[];
  scan(options?: { root?: string; files?: string[] }): Array<Hit & { file: string }>;
  run(options?: {
    root?: string;
    files?: string[];
    verbose?: boolean;
    log?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  }): number;
}

let advice: AdviceModule;

beforeAll(async () => {
  advice = (await import(
    pathToFileURL(SCRIPT).href
  )) as unknown as AdviceModule;
});

/**
 * The paragraph `release.yml` published for v0.1.6, verbatim — including its line
 * breaks, which are not cosmetic.
 *
 * This is the text the check exists to fail on. `right-click` and the `Open` that
 * makes it an instruction are a line apart, so a line-scoped rule would have
 * cleared it; and the sentence contains **not** notarised, so a rule that treated
 * any negation as a correction would have cleared it too. Both of those are
 * asserted below, because both were mistakes this check nearly shipped with.
 */
const SHIPPED = `Open the DMG, drag **AllTheRepos** into Applications, then right-click the app →
**Open** once. It is ad-hoc signed and **not notarised**, so the first launch has to
go through that menu; after that it opens normally.`;

/** The same paragraph, corrected — which is what replaced it. */
const CORRECTED = `macOS will refuse the first launch, and that is expected: this build is ad-hoc
signed and **not notarised**. The right-click → **Open** shortcut older macOS
accepted was removed in macOS 15, so the way through is
**System Settings → Privacy & Security → Open Anyway** — after trying to open the
app. Every launch after that is a normal double-click.`;

/**
 * Two real paragraphs from `src/main/system/tray.ts`.
 *
 * Neither is advice about Gatekeeper, both are correct as written, and both read
 * as an instruction to a rule that only looked at the words: the first offers an
 * `Open Spotlight` menu item, and the second's dispatch table "can run the bound
 * handler". A check that failed on these would be a check somebody switches off,
 * which is what the menu rule is calibrated against.
 */
const TRAY_HEADER = ` *   - LEFT-CLICK: ask the (backend-windows-owned) tray-popover to show
 *     next to the tray icon's bounds. The popover is the real UI — this
 *     module only orchestrates positioning.
 *   - RIGHT-CLICK: a small fallback \`Menu\` (Open Spotlight, Settings,
 *     Quit) for the case where the popover BrowserWindow isn't available
 *     yet (e.g. parallel-agent integration ordering at boot).`;

const TRAY_DISPATCH = `/**
 * Fire a \`menu:on:command\` event at the focused (or main) window. Used
 * by the right-click fallback menu so the renderer's dispatch table
 * can run the bound handler exactly as if the user had clicked the
 * native menu item.
 */`;

/** How many stale instructions one piece of text holds — the fixture above. */
function findStaleAdviceOf(text: string): number {
  return advice.findStaleAdvice(text).length;
}

function runCli(args: string[] = []) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("it fails on the advice that actually shipped", () => {
  test("the v0.1.6 release paragraph is caught", () => {
    const found = advice.findStaleAdvice(SHIPPED);
    expect(found).toHaveLength(1);
    expect(found[0].excerpt).toMatch(/right-click/i);
  });

  test("... even though the instruction and its verb are a line apart", () => {
    // The reason the rule runs on paragraphs. `right-click the app →` ends one
    // line and `**Open** once` begins the next, so on no single line does a
    // right-click have a launch verb after it — which is exactly what a
    // line-scoped rule would have looked for, and why it would have cleared this.
    for (const line of SHIPPED.split("\n")) {
      const match = /right[- ]click/i.exec(line);
      if (!match) continue;
      expect(line.slice(match.index + match[0].length)).not.toMatch(
        /\b(open|run|launch)\b/i,
      );
    }

    expect(advice.findStaleAdvice(SHIPPED)).toHaveLength(1);
  });

  test("... and it is not rescued by the word 'not' in the same sentence", () => {
    // A negation is in there — "ad-hoc signed and **not notarised**" — and a rule
    // that accepted any negation as a correction would have passed the very text
    // it was built to fail. `CORRECTED` therefore has no bare `not` in it.
    expect(SHIPPED).toContain("not notarised");
    expect(advice.findStaleAdvice(SHIPPED)).toHaveLength(1);
  });

  test("the same instruction is caught wherever it is written", () => {
    // Not a copy of the v0.1.6 wording: the point is the shape, not the string.
    const elsewhere = `Download the DMG from the release page, open it, and
then right-click AllTheRepos in Finder and choose Open to get past the warning.`;
    expect(advice.findStaleAdvice(elsewhere)).toHaveLength(1);
  });
});

describe("it stays silent on everything that is not that mistake", () => {
  test("the corrected paragraph clears", () => {
    expect(advice.findStaleAdvice(CORRECTED)).toHaveLength(0);
  });

  test("a tray menu's own right-click is not advice about Gatekeeper", () => {
    expect(advice.findStaleAdvice(TRAY_HEADER)).toHaveLength(0);
    expect(advice.findStaleAdvice(TRAY_DISPATCH)).toHaveLength(0);
  });

  test("... and an instruction needs no explanation around it to be caught", () => {
    // The first version of this rule only judged paragraphs that mentioned
    // Gatekeeper, the DMG or notarisation, and it quietly stopped seeing this —
    // which is the whole instruction, on its own, with nothing to hide behind.
    // A subject gate looked like it separated the tray menu from the advice; the
    // menu rule is what actually does.
    expect(
      advice.findStaleAdvice(
        "Then right-click the app and choose Open once to get past it.",
      ),
    ).toHaveLength(1);
  });

  test("... but the Dock is not carved out, because that was one real way in", () => {
    // Choosing Open from the app's Dock icon is the same removed override by
    // another route, so excluding `Dock` alongside `menu` would have left a hole
    // shaped exactly like the answer.
    expect(
      advice.findStaleAdvice(
        "To get past Gatekeeper, right-click the app in the Dock and choose Open.",
      ),
    ).toHaveLength(1);
  });

  test("a right-click that is not offered as a way to launch anything clears", () => {
    const dock = `The DMG is ad-hoc signed, so you may have to allow it. To pin the app,
right-click its Dock icon and choose Options.`;
    expect(advice.findStaleAdvice(dock)).toHaveLength(0);
  });

  test("a paragraph with no right-click in it at all clears", () => {
    expect(
      advice.findStaleAdvice(
        "The DMG's file and the release notes are rendered from one source.",
      ),
    ).toHaveLength(0);
  });

  test("a Gatekeeper paragraph that says the shortcut is gone clears", () => {
    // This is the sentence the whole repository is trying to write, and a check
    // that failed on it would forbid the correct answer.
    const names = [
      "The right-click → Open shortcut was removed in macOS 15.",
      "There is no longer a right-click shortcut to open the app.",
      "The right-click → **Open** step stopped working in macOS 15.",
      "Apple removed the right-click → Open override; it is gone.",
    ];
    for (const sentence of names) {
      const paragraph = `The DMG is ad-hoc signed and not notarised. ${sentence}`;
      expect(advice.findStaleAdvice(paragraph), sentence).toHaveLength(0);
    }
  });

  test("the two carve-outs are menu words, and only menu words", () => {
    expect(advice.FINGERPRINT_WINDOW).toBe(60);
    expect(advice.MENU_CONTEXT.test("a small fallback `Menu`")).toBe(true);
    expect(advice.MENU_CONTEXT.test("the tray icon's bounds")).toBe(true);
    // The Dock is deliberately not one of them — see the test above.
    expect(advice.MENU_CONTEXT.test("the app in the Dock")).toBe(false);
  });
});

describe("it reads what it says it reads", () => {
  test("paragraphs are the text between blank lines, with the line they start on", () => {
    const found = advice.paragraphs("one\ntwo\n\nthree\n\n\nfour\n");
    expect(found.map((paragraph) => paragraph.text)).toEqual([
      "one\ntwo",
      "three",
      "four",
    ]);
    // The line the paragraph *starts* on, so a report can point at it: three
    // blank lines between `three` and `four` still leave `four` on line 7.
    expect(found.map((paragraph) => paragraph.line)).toEqual([1, 4, 7]);
  });

  test("the surfaces a single source renders are scanned as well as the files", () => {
    const surfaces = advice.renderedSurfaces();
    const names = surfaces.map((surface) => surface.file).join("\n");
    // The freshness check cannot catch a bad edit *inside* the source — the files
    // on disk would still match what it renders — so the rendered text is scanned
    // too. If the sentence in `first-launch.mjs` ever becomes the old instruction,
    // this is what fails. All four surfaces, including the in-app notice, which
    // reaches the renderer through the generated `src/shared/adhoc-notice.ts`.
    expect(names).toContain("--print read-me");
    expect(names).toContain("--print release-note");
    expect(names).toContain("--print notice");
    expect(names).toContain("--print warning");
  });

  test("the scan covers the file types a reader meets words in", () => {
    expect(advice.SCANNED_EXTENSIONS).toContain(".md");
    expect(advice.SCANNED_EXTENSIONS).toContain(".txt");
    expect(advice.SCANNED_EXTENSIONS).toContain(".yml");
    expect(advice.SCANNED_EXTENSIONS).toContain(".tsx");

    const files = advice.scannedFiles(ROOT);
    expect(files).toContain("README.md");
    expect(files).toContain("docs/RELEASING.md");
    expect(files).toContain("resources/READ-ME-FIRST.txt");
    expect(files).toContain("src/renderer/components/layout/adhoc-build-notice.tsx");
    expect(files).toContain("src/shared/adhoc-notice.ts");
    expect(files).toContain(".github/workflows/release.yml");
    expect(files.some((file) => file.includes("node_modules"))).toBe(false);
  });

  test("the two files it does not read, and nothing else, are the exceptions", () => {
    const files = advice.scannedFiles(ROOT);

    // Not read: the fixtures, which quote the forbidden sentence on purpose, and
    // this check's own file, which has to quote it in order to forbid it. Without
    // both, the check fails on itself the moment it is committed — which is
    // precisely what it did on its first run.
    expect(files.some((file) => file.startsWith("tests/"))).toBe(false);
    expect(files).not.toContain("scripts/check-first-launch-advice.mjs");

    // Still read: everything a person could actually learn the procedure from —
    // including the generated notice module, because a file that is imported by
    // the app is a surface however it was written, and this is the check that
    // cannot be reached by regenerating it.
    expect(files).toContain("scripts/first-launch.mjs");
    expect(files).toContain("README.md");
    expect(files).toContain("docs/RELEASING.md");
    expect(files).toContain("resources/READ-ME-FIRST.txt");
    expect(files).toContain("src/renderer/components/layout/adhoc-build-notice.tsx");
    expect(files).toContain("src/shared/adhoc-notice.ts");

    expect(advice.isAdviceSurface("README.md")).toBe(true);
    expect(advice.isAdviceSurface("tests/unit/scripts/anything.spec.ts")).toBe(false);
    expect(advice.isAdviceSurface("scripts/first-launch.mjs")).toBe(true);
  });

  test("... and the fixture really does contain the sentence, so the exception is earned", () => {
    // If this ever stops being true the exception above is no longer justified, and
    // a carve-out nobody can justify is how a real instruction escapes one day.
    const spec = fs.readFileSync(__filename, "utf8");
    expect(spec).toContain("then right-click the app →");
    expect(findStaleAdviceOf(spec)).toBeGreaterThan(0);
  });
});

describe("this repository gives the advice nowhere", () => {
  test("nothing tracked, and nothing rendered, still offers the shortcut", () => {
    const found = advice.scan({ root: ROOT });
    expect(
      found.map((hit) => `${hit.file}:${hit.line} — ${hit.excerpt}`),
    ).toEqual([]);
  });

  test("the CLI gate exits 0 on this tree", () => {
    const result = runCli();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OK");
  });

  test("it exits 1, naming the file and the sentence, once one is introduced", () => {
    // Driven through `run` against a throwaway tree. This is the half that decides
    // whether a red run is actionable: a report saying "stale advice somewhere"
    // costs the reader more than the check saves them.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "atr-advice-"));
    try {
      fs.writeFileSync(path.join(root, "NOTES.md"), SHIPPED);
      const errors: string[] = [];
      const code = advice.run({
        root,
        files: ["NOTES.md"],
        log: () => {},
        error: (message: unknown) => {
          errors.push(String(message));
        },
      });

      expect(code).toBe(1);
      const report = errors.join("\n");
      expect(report).toContain("NOTES.md:1");
      expect(report).toContain("right-click");
      // ... and what to do instead, which is the part a reader actually needs.
      expect(report).toContain("Open Anyway");
      expect(report).toContain("first-launch.mjs");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("a corrected tree is silent, and a clean run is not a lucky one", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "atr-advice-"));
    try {
      fs.writeFileSync(path.join(root, "NOTES.md"), CORRECTED);
      const code = advice.run({
        root,
        files: ["NOTES.md"],
        log: () => {},
        error: () => {},
      });
      expect(code).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
