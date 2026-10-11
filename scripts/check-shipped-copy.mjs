#!/usr/bin/env node
/**
 * An installed screen is not the place to explain the tooling around it.
 *
 * Two shipped surfaces said otherwise, and nothing noticed. `/debug` opened with
 * "This route exists so the Phase 0 Playwright E2E keeps passing as Phase 1
 * lands" — an answer to a question only this repository has — and the tray
 * popover's running-dev-servers placeholder read "(Phase 3 will populate this
 * list)", scaffolding narrating itself to whoever clicked the menu-bar icon.
 * Neither was wrong when it was written, and neither was caught by anything: no
 * gate reads a rendered sentence, and a review of a diff that moves a card
 * between routes does not re-read the card's prose.
 *
 * So this reads the copy that reaches a screen. It parses every `.tsx` under
 * `src/renderer` with the TypeScript parser the project already builds with, and
 * looks at the positions a person can actually read: JSX text, a string literal
 * in a JSX attribute, and a string literal child (`{"..."}`).
 *
 * What it deliberately does not read is the two places the vocabulary below is
 * *correct*:
 *
 *   - a comment, which is where the reasoning about a phase or a test runner
 *     belongs — `App.tsx` explains in its header why the ping card moved, and
 *     that sentence should stay;
 *   - a string in a `.ts` file, because that is data as often as it is copy.
 *     `src/renderer/lib/demo-library.ts` holds an MCP server whose name is
 *     literally `playwright` and a task whose command is `vitest run`; a gate
 *     that fails on the demo library's invented catalog is a gate somebody turns
 *     off, and a gate somebody turns off is worse than no gate.
 *
 * The boundary is the AST position, not the file, and holding it is what makes
 * this a gate rather than a review. It also means the fix for a failure is
 * usually a rewrite of the sentence and only rarely a deletion of a fact: the
 * reason a screen exists can nearly always be said in terms of the person
 * looking at it.
 *
 * Usage:
 *   node scripts/check-shipped-copy.mjs
 *
 * Exit codes: 0 — every rendered string is free of the vocabulary below · 1 —
 * one is not, and each is named with its file, line and the reason that word
 * does not belong on a screen · 2 — there was nothing to check (no
 * `src/renderer`, or no `.tsx` in it), which is reported rather than passed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Where the screens are drawn. */
export const RENDERER_DIR = path.join("src", "renderer");

/** Directories a screen is never drawn from. */
const SKIPPED_DIRS = new Set(["node_modules", "dist", "out"]);

/**
 * The vocabulary a shipped screen must not carry, each with the reason it cannot.
 *
 * `id` is what a failure names, so a reader learns which rule caught it without
 * parsing a regex, and every entry has a `why` because a ban nobody can restate
 * is a ban the next person works around.
 */
export const COPY_VOCABULARY = [
  {
    id: "test-runner",
    pattern: /\b(playwright|vitest|jest|cypress|selenium|webdriver)\b/i,
    why: "names whichever runner asserts this screen; the person reading it is not running one",
  },
  {
    id: "component-workbench",
    pattern: /\bstorybook\b/i,
    why: "names the workbench a component is previewed in, not the screen it draws",
  },
  {
    id: "test-tier",
    pattern: /\b(E2E|end-to-end test)\b/i,
    why: "names a tier of the test suite",
  },
  {
    id: "internal-phase",
    pattern: /\bphase\s+[0-9]+\b/i,
    why: "a delivery phase from this repository's plan, which says nothing to someone using the app",
  },
  {
    id: "ticket-id",
    pattern: /\bATR-[0-9]+\b/,
    why: "a tracker id, and the issue it points at is not readable from here",
  },
  {
    id: "smoke-test",
    pattern: /\bsmoke test\b/i,
    why: "names the shape of a check rather than what the screen does",
  },
  {
    id: "unfinished-marker",
    pattern: /\b(TODO|FIXME|XXX|WIP|TBD)\b/i,
    why: "a note to the author, left where a user reads",
  },
];

/**
 * Parse one file and return its rendered strings.
 *
 * `start` is the offset of the string's first character in the file, not of its
 * delimiter, so a match index can be added to it and handed straight to
 * `getLineAndCharacterOfPosition`.
 */
function readScreen(text, fileName) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const strings = [];

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      // Whitespace between elements is not copy, and reporting it would bury the
      // one line that is.
      if (node.text.trim().length > 0) {
        strings.push({ text: node.text, start: node.getStart(source) });
      }
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) {
        strings.push({
          text: node.initializer.text,
          start: node.initializer.getStart(source) + 1,
        });
      }
    } else if (
      ts.isJsxExpression(node) &&
      node.expression &&
      ts.isStringLiteralLike(node.expression) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      strings.push({
        text: node.expression.text,
        start: node.expression.getStart(source) + 1,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return { source, strings };
}

/**
 * Every string a person can read in `text`, with the offset it starts at.
 *
 * Exported for the specs: the offsets are half the value, because a failure that
 * cannot say *where* is a failure the next reader has to hunt for.
 */
export function renderedCopy(text, fileName = "screen.tsx") {
  return readScreen(text, fileName).strings;
}

/** Every `.tsx` under `src/renderer`, or `null` when that directory is absent. */
function screens(root) {
  const dir = path.join(root, RENDERER_DIR);
  if (!fs.existsSync(dir)) return null;

  const files = [];
  const walk = (current) => {
    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(full);
      } else if (entry.name.endsWith(".tsx")) {
        files.push(full);
      }
    }
  };

  walk(dir);
  return files;
}

/**
 * The rendered strings that carry vocabulary they should not, in file order.
 *
 * `null` means there was nothing to read — a missing `src/renderer` — which the
 * caller reports rather than passing.
 */
export function auditCopy(root = ROOT, vocabulary = COPY_VOCABULARY) {
  const files = screens(root);
  if (files === null) return null;

  const violations = [];
  let strings = 0;

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const parsed = readScreen(text, file);
    strings += parsed.strings.length;

    for (const { text: rendered, start } of parsed.strings) {
      for (const entry of vocabulary) {
        // A fresh global copy per string, because `lastIndex` on a shared regex
        // makes the second file read differently from the first.
        const pattern = new RegExp(
          entry.pattern.source,
          `${entry.pattern.flags.replace(/g/g, "")}g`,
        );
        for (let match = pattern.exec(rendered); match !== null; match = pattern.exec(rendered)) {
          const at = parsed.source.getLineAndCharacterOfPosition(start + match.index);
          violations.push({
            file: path.relative(root, file).split(path.sep).join("/"),
            line: at.line + 1,
            column: at.character + 1,
            term: entry.id,
            matched: match[0],
            why: entry.why,
            text: rendered.replace(/\s+/g, " ").trim(),
          });
        }
      }
    }
  }

  return { files: files.length, strings, violations };
}

/** The verdict, as the lines a person reads. */
export function assess(observed) {
  if (observed === null) return { failures: [], notes: [] };

  const { files, strings, violations } = observed;

  const byTerm = new Map();
  for (const violation of violations) {
    byTerm.set(violation.term, (byTerm.get(violation.term) ?? 0) + 1);
  }

  const failures = violations.map(
    (violation) =>
      `${violation.file}:${violation.line}:${violation.column} — "${violation.matched}" ` +
      `(${violation.term}) ${violation.why}\n      in: ${violation.text}`,
  );

  const notes = [`${files} screen(s) read, ${strings} rendered string(s)`];

  if (violations.length > 0) {
    notes.push(
      `by rule: ${[...byTerm].map(([term, count]) => `${term} ${count}`).join(", ")}`,
    );
  }

  return { failures, notes };
}

export function run({
  root = ROOT,
  vocabulary = COPY_VOCABULARY,
  log = console.log,
  error = console.error,
} = {}) {
  const observed = auditCopy(root, vocabulary);

  if (observed === null) {
    error(
      `[check-shipped-copy] could not run — no ${RENDERER_DIR} at ${root}, so nothing renders and a pass here would mean nothing`,
    );
    return 2;
  }
  if (observed.files === 0) {
    error(
      `[check-shipped-copy] could not run — ${RENDERER_DIR} holds no .tsx, so nothing renders and a pass here would mean nothing`,
    );
    return 2;
  }

  const { failures, notes } = assess(observed);

  for (const note of notes) log(`  · ${note}`);

  if (failures.length > 0) {
    for (const failure of failures) error(`  ✗ ${failure}`);
    error(
      `[check-shipped-copy] FAILED — ${failures.length} rendered string(s) name the tooling around this screen rather than the screen. ` +
        "Reword the sentence for the person reading it; the reasoning it carries is welcome in a comment, which this check does not read.",
    );
    return 1;
  }

  log(
    `[check-shipped-copy] OK — ${observed.strings} rendered string(s) across ${observed.files} screen(s); none names a runner, a workbench, a phase, a ticket, a check or a marker left for the author`,
  );
  return 0;
}

/**
 * True when this file is the program Node was asked to run.
 *
 * Compared through `fs.realpathSync`, not as strings: on macOS `os.tmpdir()`
 * hands back `/var/folders/...` while the loader resolves it to `/private/var/...`,
 * and a string compare then quietly does nothing at all.
 */
function isMainModule() {
  if (typeof process.argv[1] !== "string") return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    process.exit(run());
  } catch (thrown) {
    console.error(`[check-shipped-copy] ${thrown?.message ?? thrown}`);
    process.exit(2);
  }
}
