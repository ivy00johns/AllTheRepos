/**
 * Unit test for `scripts/check-shipped-copy.mjs`.
 *
 * The script exists because a rendered sentence has no gate under it. Two screens
 * shipped development copy — `/debug` explaining itself as the reason a Playwright
 * spec still passes, and the tray popover's dev-server placeholder reading
 * "(Phase 3 will populate this list)" — and both were found by a person reading
 * the app rather than by anything in CI. Nothing was broken: a diff that moves a
 * card between routes does not re-read the card's prose, and neither does an
 * assertion about the ping round-trip that keeps it passing.
 *
 * Most of what is asserted here is the *boundary* rather than the ban, because the
 * ban is the easy half. A checker that fails on the header comment of `App.tsx`
 * would be rewritten into silence within a week, and one that fails on
 * `lib/demo-library.ts` — whose invented catalog contains an MCP server named
 * `playwright` and a task running `vitest run` — would be turned off by the next
 * person who touched demo data. So the cases below pin what is *not* read (a
 * comment, a string in a `.ts` file) as carefully as what is (JSX text, a string
 * literal in a JSX attribute, a string literal child), and one case pins the
 * reported position against the source text, because a failure that cannot be
 * found is a failure somebody deletes the sentence to silence.
 *
 * The last case runs the checker over this repository's own screens. It is the
 * only one here that can be red for a reason outside this file, and it is the one
 * that makes the rest mean something: a boundary asserted only against fixtures
 * is a boundary that holds nowhere. It also asserts that the walk *read* a real
 * number of strings, because a gate that passes by reading nothing passes for the
 * wrong reason — which is the failure mode `check-unit-platform.mjs` was rewritten
 * to avoid.
 *
 * The script is imported by URL (a `.mjs` CLI with no declarations) and driven
 * through its entry point with the root injected, which is how the other script
 * specs here run theirs — no child process, and the messages a person would read
 * come back as strings.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "check-shipped-copy.mjs");

interface LexiconEntry {
  id: string;
  pattern: RegExp;
  why: string;
}

interface RenderedString {
  text: string;
  start: number;
}

interface Violation {
  file: string;
  line: number;
  column: number;
  term: string;
  matched: string;
  why: string;
  text: string;
}

interface Observed {
  files: number;
  strings: number;
  violations: Violation[];
}

interface ShippedCopyModule {
  RENDERER_DIR: string;
  COPY_VOCABULARY: LexiconEntry[];
  renderedCopy(text: string, fileName?: string): RenderedString[];
  auditCopy(root?: string, vocabulary?: LexiconEntry[]): Observed | null;
  assess(observed: Observed | null): { failures: string[]; notes: string[] };
  run(options?: {
    root?: string;
    vocabulary?: LexiconEntry[];
    log?: (message: string) => void;
    error?: (message: string) => void;
  }): number;
}

let script: ShippedCopyModule;

beforeAll(async () => {
  script = (await import(pathToFileURL(SCRIPT).href)) as unknown as ShippedCopyModule;
});

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) cleanupTmp(roots.pop());
});

/** A throwaway repository holding just the screens a case needs. */
function fixture(files: Record<string, string>): string {
  const dir = makeTmpDir("atr-shipped-copy");
  roots.push(dir);

  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(dir, "src", "renderer", name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }

  return dir;
}

/** Run the checker with its output captured, the way CI reads it. */
function drive(root: string): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = script.run({
    root,
    log: (message) => out.push(message),
    error: (message) => err.push(message),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

const CLEAN_SCREEN = `export function Card() {
  return <p>Nothing here yet.</p>;
}
`;

describe("what a screen may say, and what it must not", () => {
  test("reads the positions a person can read, and no others", () => {
    const text = `/**
 * A comment may name Playwright, Phase 0 and ATR-074: it is written for whoever
 * maintains this file, and the reasoning about the tooling belongs here.
 */
const TITLE = "vitest"; // data: unreachable from the screen below

export function Card() {
  return (
    <div title="Phase 1">
      <p>Hello</p>
      {"E2E"}
    </div>
  );
}
`;

    const rendered = script.renderedCopy(text).map((entry) => entry.text.trim());

    expect(rendered).toContain("Hello");
    expect(rendered).toContain("Phase 1");
    expect(rendered).toContain("E2E");
    // The comment, the module-level constant and the attribute *name* are not copy.
    expect(rendered.some((entry) => entry.includes("Playwright"))).toBe(false);
    expect(rendered).not.toContain("vitest");
  });

  test("fails the sentence that made this gate exist", () => {
    const root = fixture({
      "routes/debug.tsx": `export function DebugPage() {
  return (
    <p>
      This route exists so the Phase 0 Playwright E2E keeps passing as Phase 1
      lands.
    </p>
  );
}
`,
    });

    const { code, err } = drive(root);

    expect(code).toBe(1);
    expect(err).toContain("routes/debug.tsx");
    expect(err).toContain("test-runner");
    expect(err).toContain("internal-phase");
  });

  test("fails the placeholder that narrated its own phase", () => {
    const root = fixture({
      "components/tray.tsx": `export function Tray() {
  return (
    <div>
      <header>Running dev servers</header>
      <p>(Phase 3 will populate this list)</p>
    </div>
  );
}
`,
    });

    const { code, err } = drive(root);

    expect(code).toBe(1);
    expect(err).toContain("internal-phase");
    // The header stays: "dev servers" is the feature, not the tooling around it.
    expect(err).not.toContain("dev-server");
  });

  test("does not read a comment, where the reasoning belongs", () => {
    const root = fixture({
      "components/card.tsx": `/**
 * Phase 0's card. The Playwright spec in \`tests/e2e/launch.spec.ts\` asserts it,
 * and ATR-074 moved the door — see the palette action below.
 */
export function Card() {
  return <p>Nothing here yet.</p>;
}
`,
    });

    expect(drive(root).code).toBe(0);
  });

  test("does not read a .ts file, because that is data as often as it is copy", () => {
    const root = fixture({
      "lib/demo-library.ts": `export const servers = [
  { name: "playwright", args: ["@playwright/mcp"] },
];
export const task = "vitest run";
`,
      "components/card.tsx": CLEAN_SCREEN,
    });

    const observed = script.auditCopy(root);

    expect(observed?.violations).toEqual([]);
    expect(observed?.files).toBe(1);
  });

  test("reports a position that actually points at the word", () => {
    const text = `export function Card() {
  return (
    <div>
      <p>Fine</p>
      <p title="vitest run">Also fine</p>
    </div>
  );
}
`;
    const root = fixture({ "components/card.tsx": text });

    const observed = script.auditCopy(root);
    const violation = observed?.violations[0];

    expect(violation?.term).toBe("test-runner");
    expect(violation?.matched).toBe("vitest");

    // Line and column, checked against the file rather than against themselves:
    // the slice they name has to be the matched word.
    // `violation.file` is reported relative to the root, which is what a reader in CI sees.
    const onDisk = fs.readFileSync(path.join(root, violation!.file), "utf8");
    const line = onDisk.split("\n")[violation!.line - 1];
    expect(line.slice(violation!.column - 1, violation!.column - 1 + violation!.matched.length)).toBe(
      "vitest",
    );
  });

  test("catches a rule in a JSX attribute and in a literal child, not only in text", () => {
    const root = fixture({
      "components/card.tsx": `export function Card() {
  return (
    <span aria-label="TODO">{'ATR-061'}</span>
  );
}
`,
    });

    const { code, err } = drive(root);

    expect(code).toBe(1);
    expect(err).toContain("unfinished-marker");
    expect(err).toContain("ticket-id");
  });
});

describe("a pass that means something", () => {
  test("a screen with none of the vocabulary passes, and says what it read", () => {
    const root = fixture({ "components/card.tsx": CLEAN_SCREEN });

    const { code, out, err } = drive(root);

    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain("1 screen(s)");
  });

  test("reading nothing is not a pass", () => {
    // No `src/renderer` at all.
    expect(drive(makeTmpDir("atr-shipped-copy")).code).toBe(2);

    // The directory exists and holds nothing this checker can read.
    const empty = fixture({ "README.md": "no screens here\n" });
    const { code, err } = drive(empty);

    expect(code).toBe(2);
    expect(err).toContain("holds no .tsx");
  });

  test("the vocabulary is a table somebody can restate", () => {
    // A ban with no reason is a ban the next person works around, so every entry
    // carries one, and the id is what a failure names.
    expect(script.COPY_VOCABULARY.length).toBeGreaterThan(3);

    for (const entry of script.COPY_VOCABULARY) {
      expect(entry.id).toMatch(/^[a-z][a-z-]*$/);
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });

  test("the verdict names each rule it matched, and the count", () => {
    const root = fixture({
      "components/card.tsx": `export function Card() {
  return <p>Phase 2 work is tracked as ATR-061.</p>;
}
`,
    });

    const { notes } = script.assess(script.auditCopy(root));

    expect(notes.join("\n")).toContain("internal-phase 1");
    expect(notes.join("\n")).toContain("ticket-id 1");
  });

  test("this repository's own screens pass, header comments and demo data included", () => {
    const observed = script.auditCopy(ROOT);

    expect(observed).not.toBeNull();
    expect(observed?.violations).toEqual([]);
    // And it read a real corpus: a boundary asserted against fixtures alone holds
    // nowhere, and a walk that finds nothing passes for the wrong reason.
    expect(observed?.files).toBeGreaterThan(50);
    expect(observed?.strings).toBeGreaterThan(1000);
  });
});
