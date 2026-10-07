/**
 * Unit test for `scripts/check-doc-versions.mjs`.
 *
 * The script exists because `README.md` claimed `v0.1.6` was the current release
 * for two releases after it stopped being true, so most of what is asserted here
 * is the *shape* of that mistake rather than a ban on version-shaped text. The
 * rule fires only on a `vX.Y.Z` that sits on a line pointing at the releases
 * repo, and this repository contains both of the things a blunter rule would
 * have wrongly rejected on the day it landed:
 *
 *   - `git tag v0.1.3 && git push origin v0.1.3` — an example command, in a fence;
 *   - `~/.nvm/versions/node/v22.22.3/bin/node` — a Node version, far from any
 *     release.
 *
 * So those two get their own tests, and the last one runs the check against this
 * repository itself: a guard nobody has seen pass on the real files is a guard
 * with two possible verdicts and no evidence for either.
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
const SCRIPT = path.join(ROOT, "scripts", "check-doc-versions.mjs");

interface Claim {
  file: string;
  line: number;
  version: string;
}

interface CheckDocVersionsModule {
  FRONT_DOOR: string[];
  RELEASES_REPO: string;
  withoutFences(markdown: string): string[];
  claimsIn(markdown: string, file: string): Claim[];
  assess(options?: { root?: string; files?: string[] }): {
    failures: string[];
    notes: string[];
  };
  run(options?: {
    root?: string;
    files?: string[];
    log?: (message: string) => void;
    error?: (message: string) => void;
  }): number;
}

let script: CheckDocVersionsModule;

beforeAll(async () => {
  script = (await import(pathToFileURL(SCRIPT).href)) as unknown as CheckDocVersionsModule;
});

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) cleanupTmp(dirs.pop());
});

/** A throwaway checkout holding the docs named, at the paths given. */
function fixture(files: Record<string, string>): string {
  const dir = makeTmpDir("atr-doc-versions");
  dirs.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return dir;
}

/** Run the check for its verdict, keeping its output out of the test log. */
function verdict(root: string, files?: string[]) {
  const said: string[] = [];
  const code = script.run({
    root,
    files,
    log: (message) => said.push(message),
    error: (message) => said.push(message),
  });
  return { code, said: said.join("\n") };
}

const RELEASE_LINE =
  "The current release is [`v0.1.6`](https://github.com/ivy00johns/alltherepos-releases/releases).";

describe("what counts as a claim", () => {
  test("a version on a line that points at the releases repo", () => {
    expect(script.claimsIn(RELEASE_LINE, "README.md")).toEqual([
      { file: "README.md", line: 1, version: "v0.1.6" },
    ]);
  });

  test("every version on such a line, not just the first", () => {
    const claims = script.claimsIn(
      `See [v0.1.7](https://github.com/ivy00johns/alltherepos-releases/releases/tag/v0.1.7) and v0.1.8.`,
      "README.md",
    );
    expect(claims.map((claim) => claim.version)).toEqual(["v0.1.7", "v0.1.7", "v0.1.8"]);
  });

  test("but not an example command inside a fence", () => {
    // The README documents how a release is cut. A rule that could not tell an
    // example from a claim would have failed on its own documentation.
    const readme = [
      "Cut a release:",
      "",
      "```bash",
      "git tag v0.1.3 && git push origin v0.1.3",
      "```",
      "",
    ].join("\n");

    expect(script.claimsIn(readme, "README.md")).toEqual([]);
    expect(script.withoutFences(readme)).toHaveLength(6);
  });

  test("and not a Node version, which is nowhere near a release", () => {
    const startHere =
      "Use `~/.nvm/versions/node/v22.22.3/bin/node`, or fix the dotfile (ATR-024).";
    expect(script.claimsIn(startHere, "START-HERE.md")).toEqual([]);
  });

  test("and not a version in prose about tooling, even next to the app's own", () => {
    // The anchor is the releases repo, not the word "release": a sentence about
    // what Node the build needs is not a claim about which build is current.
    const readme = "Node v22.22.3 or newer is required for the release tooling.";
    expect(script.claimsIn(readme, "README.md")).toEqual([]);
  });
});

describe("the verdict", () => {
  test("fails, and names the file, the line and the version", () => {
    const root = fixture({
      "README.md": `# AllTheRepos\n\n${RELEASE_LINE}\n`,
    });

    const { failures } = script.assess({ root, files: ["README.md"] });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("README.md:3");
    expect(failures[0]).toContain("v0.1.6");
    // And says what to do instead, because the fix is not obvious from the rule.
    expect(failures[0]).toContain("releases/latest");
  });

  test("passes a front door that links the feed instead", () => {
    const root = fixture({
      "README.md":
        "Downloads live in [the releases](https://github.com/ivy00johns/alltherepos-releases/releases/latest).\n",
    });

    const { code, said } = verdict(root, ["README.md"]);

    expect(code).toBe(0);
    expect(said).toContain("names no release version");
  });

  test("is a failure to run, not a verdict, when a guarded doc is missing", () => {
    const root = fixture({ "README.md": "# AllTheRepos\n" });

    const { code, said } = verdict(root, ["README.md", "START-HERE.md"]);

    expect(code).toBe(2);
    expect(said).toContain("could not run");
  });
});

describe("this repository", () => {
  test("the front door passes, and the guard watches the docs that exist", () => {
    // The live check: `README.md` and `START-HERE.md`, on the real files.
    expect(script.FRONT_DOOR.length).toBeGreaterThan(0);
    for (const file of script.FRONT_DOOR) {
      expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
    }

    expect(verdict(ROOT).code).toBe(0);
  });

  test("and it is anchored to the repo the feed is published to", () => {
    // The guard only fires on lines that mention the releases repo, so a rename
    // in `electron-builder.yml` would quietly disarm it. Same drift guard the
    // updater's own feed test applies to the app's constants.
    expect(fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8")).toContain(
      `repo: ${script.RELEASES_REPO}`,
    );
  });
});
