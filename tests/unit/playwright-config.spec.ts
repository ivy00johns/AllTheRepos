/**
 * Every Playwright config at the repo root decides which files that job runs.
 *
 * `playwright.electron.config.ts` is the main gate — locally, and in the `e2e`
 * job of CI on both architectures — and it runs whatever its `testMatch`
 * pattern names. The exploratory walkthroughs have their own configs beside it
 * (`playwright.walkthrough.config.ts`, `playwright.real.config.ts`), because
 * they drive a long, deliberate pass over a private profile rather than the
 * seeded template the gate uses.
 *
 * A spec named by no config's `testMatch` is not a test that fails; it is a
 * file. Nothing about a green run says which of the two happened, which is the
 * shape of hole this repository keeps closing by hand
 * (`tests/unit/workflows/ci.spec.ts` does the same one level up, for the steps
 * CI runs).
 *
 * So the invariant is stated once: every `*.spec.ts` under `tests/e2e` is
 * matched by the `testMatch` of at least one `playwright*.config.ts` at the repo
 * root — the gate, or one of the walkthrough configs. Patterns are read out of
 * the files and compiled, rather than compared as text: the configs' own prose
 * names the specs as well, so a substring check would pass on a comment.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const E2E_DIR = path.join(ROOT, "tests", "e2e");

/** Every Playwright config the repo root carries, so a new one is included. */
const CONFIGS = fs
  .readdirSync(ROOT)
  .filter((name) => /^playwright.*\.config\.ts$/.test(name))
  .sort();

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
 * One config's `testMatch` as a live `RegExp` — the same object the runner
 * compiles, rather than a description of it.
 */
function testMatchOf(configFile: string): RegExp {
  const file = path.join(ROOT, configFile);
  const code = withoutComments(fs.readFileSync(file, "utf8"));
  const at = code.indexOf("testMatch:");
  expect(
    at,
    `${configFile} no longer has a testMatch to read`,
  ).toBeGreaterThan(-1);

  const open = code.indexOf("/", at);
  // The pattern carries no `/` of its own, so the next one closes the literal.
  // One appearing inside it makes this extractor wrong rather than quietly
  // forgiving, which is the right way round for an assertion to fail.
  const close = code.indexOf("/", open + 1);
  expect(
    close,
    `the testMatch in ${configFile} is not a slash-delimited literal`,
  ).toBeGreaterThan(open);

  return new RegExp(code.slice(open + 1, close));
}

const SPECS = fs
  .readdirSync(E2E_DIR)
  .filter((name) => name.endsWith(".spec.ts"))
  .sort();

describe("the Playwright configs' testMatch", () => {
  test("at least one config names every spec under tests/e2e", () => {
    expect(CONFIGS.length, "the repo root holds no Playwright configs").toBeGreaterThan(0);
    const patterns = CONFIGS.map((file) => ({ file, match: testMatchOf(file) }));

    const unmatched = SPECS.filter(
      (name) => !patterns.some(({ match }) => match.test(name)),
    );

    expect(
      unmatched,
      `these specs sit in tests/e2e and no Playwright config's testMatch names ` +
        `them, so nothing runs them — a green job says nothing about them either ` +
        `way: ${unmatched.join(", ")}`,
    ).toEqual([]);
  });

  test("each is a list of specs, rather than a pattern that takes everything", () => {
    // The control. `/.spec.ts$/` would satisfy the test above while making the
    // set implicit again, and would collect the next file dropped into the
    // directory whether or not anybody meant it to run.
    expect(SPECS.length, "tests/e2e holds no specs at all").toBeGreaterThan(0);
    for (const file of CONFIGS) {
      expect(
        testMatchOf(file).test("something-nobody-registered.spec.ts"),
        `${file}'s testMatch matches anything — it is not a list of specs`,
      ).toBe(false);
    }
  });
});
