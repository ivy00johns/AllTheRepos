/**
 * Unit test for `scripts/source-release.mjs` — the signpost that keeps this
 * repository's Releases tab from being empty.
 *
 * The binaries go to a separate releases-only repository, which is correct and
 * deliberate; what it cost was a source repo whose Releases page showed nothing,
 * which reads as "there is no release yet". `v0.3.1` had been published and
 * verified for a day when that was still true. So a tag push writes a release
 * here too: no assets, and a body that says where the download is.
 *
 * That page is prose, so the test drives the part that can be wrong without a
 * GitHub — the body, and the argument handling around it — through the script's
 * real interface (argv, stdout, stderr, exit code), the way the workflow calls
 * it. The two write paths (`gh release create` / `gh release edit`) are decided
 * by `isMissingRelease`, which is exercised directly: mistaking an auth failure
 * for a 404 makes the script try to create what it may not create, and
 * mistaking a 404 for an error stops the first release of every version.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const REAL_SCRIPT = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "scripts",
  "source-release.mjs",
);

const NOTES = `### Added

- a signpost, so the Releases tab is not empty
`;

const created: string[] = [];

function makeNotes(): string {
  const dir = makeTmpDir("atr-source-release");
  created.push(dir);
  const file = path.join(dir, "notes.md");
  fs.writeFileSync(file, NOTES);
  return file;
}

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, [REAL_SCRIPT, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

afterEach(() => {
  while (created.length > 0) cleanupTmp(created.pop());
});

describe("the signpost's body", () => {
  function body(tag = "v1.2.3") {
    const result = run([
      "--tag",
      tag,
      "--repo",
      "ivy00johns/AllTheRepos",
      "--releases-repo",
      "ivy00johns/alltherepos-releases",
      "--notes-file",
      makeNotes(),
      "--dry-run",
    ]);
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  }

  test("leads with the download, at the tag it was published under", () => {
    const text = body();
    // The first heading a person sees on the page, and the one link they came for.
    expect(text.startsWith("## 📦 Download")).toBe(true);
    expect(text).toContain(
      "https://github.com/ivy00johns/alltherepos-releases/releases/tag/v1.2.3",
    );
    expect(text.indexOf("Download AllTheRepos 1.2.3")).toBeLessThan(
      text.indexOf("signpost rather than the release"),
    );
  });

  test("offers the redirecting link too, because that is the one to bookmark", () => {
    expect(body()).toContain(
      "https://github.com/ivy00johns/alltherepos-releases/releases/latest",
    );
  });

  test("says the source archives are not an installer", () => {
    // GitHub adds `Source code (zip)` and `(tar.gz)` to every release by itself,
    // and on a page whose only other rows are those two, they read as the
    // download. The reason someone lands here is that they were about to build.
    const text = body();
    expect(text).toContain("Source code (zip)");
    expect(text).toContain("not an installer");
    expect(text).toContain("Building them is not");
  });

  test("carries the changelog section the real release carries", () => {
    const text = body();
    const note = "a signpost, so the Releases tab is not empty";
    expect(text).toContain(note);
    // ... under the signpost, not instead of it.
    expect(text.indexOf(note)).toBeGreaterThan(text.indexOf("\n---\n"));
  });

  test("builds its links from the repo it is told, not from a constant", () => {
    // A second hard-coded copy of the releases repo name is the drift
    // `tests/unit/main/services/updater-feed.spec.ts` exists to catch.
    const text = run([
      "--tag",
      "v9.9.9",
      "--repo",
      "someone/fork",
      "--releases-repo",
      "someone/elsewhere",
      "--notes-file",
      makeNotes(),
      "--dry-run",
    ]).stdout;
    expect(text).toContain("https://github.com/someone/elsewhere/releases/tag/v9.9.9");
    expect(text).not.toContain("alltherepos-releases");
  });

  test("never names an asset to upload", () => {
    const script = fs.readFileSync(REAL_SCRIPT, "utf8");
    // No subcommand that attaches a file: this page points at the release, it
    // never becomes one.
    expect(script).not.toMatch(/"release",\s*"upload"/);
    expect(script).not.toContain("gh release upload");
  });
});

describe("its arguments", () => {
  test("refuses to run without a tag", () => {
    const result = run(["--repo", "a/b", "--releases-repo", "a/c"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--tag is required");
  });

  test("refuses to run without both repositories", () => {
    expect(
      run(["--tag", "v1.2.3", "--repo", "a/b"]).stderr,
    ).toContain("--releases-repo");
    expect(
      run(["--tag", "v1.2.3", "--releases-repo", "a/c"]).stderr,
    ).toContain("--repo");
  });

  test("treats a flag with no value as an error, not an empty value", () => {
    const result = run(["--tag", "--repo", "a/b", "--releases-repo", "a/c"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--tag needs a value");
  });

  test("reads the two repositories from the environment the workflow sets", () => {
    const result = run(
      ["--tag", "v1.2.3", "--notes-file", makeNotes(), "--dry-run"],
      {
        GITHUB_REPOSITORY: "env/source",
        RELEASES_REPO: "env/releases",
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("https://github.com/env/releases/releases/tag/v1.2.3");
  });
});

describe("deciding whether to create or edit", () => {
  test("a 404 on the tag means there is nothing there yet", async () => {
    const { isMissingRelease } = await import(
      pathToFileURL(REAL_SCRIPT).href
    );
    expect(isMissingRelease({ stderr: "gh: Not Found (HTTP 404)" })).toBe(true);
  });

  test("anything else is an error, not a missing release", async () => {
    // Mistaking this for a 404 turns "the token cannot write here" into "create a
    // release", and the error a person then reads is about the create.
    const { isMissingRelease } = await import(
      pathToFileURL(REAL_SCRIPT).href
    );
    expect(
      isMissingRelease({ stderr: "gh: Bad credentials (HTTP 401)" }),
    ).toBe(false);
    expect(
      isMissingRelease({ stderr: "gh: Resource not accessible by integration (HTTP 403)" }),
    ).toBe(false);
    expect(isMissingRelease({ stderr: "dial tcp: no such host" })).toBe(false);
  });
});
