/**
 * `playwright.electron.config.ts` decides which files are the Electron suite.
 *
 * That suite is the whole Electron gate — locally, and in the `e2e` job of CI on
 * both architectures — and it runs whatever the config's `testMatch` pattern
 * names. A spec that is not in that pattern is not a test that fails; it is a
 * file. Nothing about a green run over there says which of the two happened,
 * which is the shape of hole this repository keeps closing by hand
 * (`tests/unit/workflows/ci.spec.ts` does the same one level up, for the steps
 * CI runs).
 *
 * So the invariant is stated once: every `*.spec.ts` under `tests/e2e` is matched
 * by the pattern the config actually carries. Read out of the file and compiled,
 * rather than compared as text — the config's own prose names the specs as well,
 * so a substring check would pass on a comment.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const CONFIG = path.join(ROOT, "playwright.electron.config.ts");
const E2E_DIR = path.join(ROOT, "tests", "e2e");

/** The config with its comments stripped, so prose is never what matches. */
function withoutComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return (
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("/*") &&
        !trimmed.startsWith("*")
      );
    })
    .join("\n");
}

/**
 * The `testMatch` pattern as a live `RegExp` — the same object the runner
 * compiles, rather than a description of it.
 */
function testMatch(): RegExp {
  const code = withoutComments(fs.readFileSync(CONFIG, "utf8"));
  const at = code.indexOf("testMatch:");
  expect(
    at,
    "playwright.electron.config.ts no longer has a testMatch to read",
  ).toBeGreaterThan(-1);

  const open = code.indexOf("/", at);
  // The pattern carries no `/` of its own, so the next one closes the literal.
  // One appearing inside it makes this extractor wrong rather than quietly
  // forgiving, which is the right way round for an assertion to fail.
  const close = code.indexOf("/", open + 1);
  expect(close, "the testMatch is not a `/…/` literal").toBeGreaterThan(open);

  return new RegExp(code.slice(open + 1, close));
}

const SPECS = fs
  .readdirSync(E2E_DIR)
  .filter((name) => name.endsWith(".spec.ts"))
  .sort();

describe("the Electron suite's testMatch", () => {
  test("matches every spec under tests/e2e", () => {
    const unmatched = SPECS.filter((name) => !testMatch().test(name));

    expect(
      unmatched,
      `these specs sit in tests/e2e and are not in the config's testMatch, so ` +
        `\`pnpm test:electron-e2e\` never runs them — a green Electron job says ` +
        `nothing about them either way: ${unmatched.join(", ")}`,
    ).toEqual([]);
  });

  test("is a list of specs, rather than a pattern that takes everything", () => {
    // The control. `/.spec.ts$/` would satisfy the test above while making the
    // set implicit again, and would collect the next file dropped into the
    // directory whether or not anybody meant it to run.
    expect(SPECS.length, "tests/e2e holds no specs at all").toBeGreaterThan(0);
    expect(testMatch().test("something-nobody-registered.spec.ts")).toBe(false);
  });
});
