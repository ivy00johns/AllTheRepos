/**
 * Unit test for `scripts/release-notes.mjs` — the guard that stops a release
 * whose tag disagrees with `package.json`, and the extractor that turns a
 * changelog section into release notes (ATR-048/ATR-052).
 *
 * The cases shell out to a *copy* of the script inside a fixture tree rather
 * than importing it. The script resolves `package.json` and `CHANGELOG.md`
 * relative to its own location — which is what makes it safe to drop into a
 * workflow and, equally, what makes it impossible to point at a fixture. So
 * the fixture is built around the copy and the script is driven through its
 * real interface: argv, stdout, stderr, exit code. That is also exactly how
 * the release workflow calls it, so the test pins the interface CI depends on
 * rather than an internal function.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const REAL_SCRIPT = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "scripts",
  "release-notes.mjs",
);

const CHANGELOG = `# Changelog

## [Unreleased]

## [1.2.3] - 2026-01-01

### Added

- a thing worth noting

### Fixed

- a thing that was broken

[Unreleased]: https://example.com/compare/v1.2.3...HEAD
[1.2.3]: https://example.com/releases/tag/v1.2.3
`;

const created: string[] = [];

/** A throwaway repo whose only contents are what the script reads. */
function fixture(
  options: {
    version?: string;
    changelog?: string | null;
  } = {},
): string {
  const dir = makeTmpDir("atr-release-notes");
  created.push(dir);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.copyFileSync(REAL_SCRIPT, path.join(dir, "scripts", "release-notes.mjs"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: options.version ?? "1.2.3" }),
  );
  if (options.changelog !== null) {
    fs.writeFileSync(
      path.join(dir, "CHANGELOG.md"),
      options.changelog ?? CHANGELOG,
    );
  }
  return dir;
}

function run(dir: string, args: string[] = []) {
  const result = spawnSync(
    process.execPath,
    [path.join(dir, "scripts", "release-notes.mjs"), ...args],
    { encoding: "utf8" },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

afterEach(() => {
  while (created.length > 0) cleanupTmp(created.pop());
});

describe("release-notes", () => {
  test("prints the changelog section for a matching tag", () => {
    const result = run(fixture(), ["v1.2.3"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("### Added");
    expect(result.stdout).toContain("- a thing worth noting");
    expect(result.stdout).toContain("### Fixed");
    // The neighbouring section and the file's link definitions must not leak
    // into one release's notes.
    expect(result.stdout).not.toContain("[Unreleased]");
    expect(result.stdout).not.toContain("https://example.com");
  });

  test("defaults to the package.json version when no tag is given", () => {
    const result = run(fixture(), []);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("- a thing worth noting");
  });

  test("accepts a tag without the v prefix", () => {
    const result = run(fixture(), ["1.2.3"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("- a thing worth noting");
  });

  test("fails when the tag and package.json disagree", () => {
    const result = run(fixture({ version: "1.2.3" }), ["v2.0.0"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("v2.0.0");
    expect(result.stderr).toContain("1.2.3");
    // Nothing on stdout: a caller redirecting it must not get a half-file it
    // then attaches to a release.
    expect(result.stdout).toBe("");
  });

  test("fails when the tag is not a version", () => {
    const result = run(fixture(), ["vnext"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("semver");
  });

  test("fails when the changelog has no section for the version", () => {
    const changelog = `# Changelog\n\n## [1.2.2] - 2025-12-01\n\n### Added\n\n- older\n`;
    const result = run(fixture({ changelog }), ["v1.2.3"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("## [1.2.3]");
  });

  test("fails on an empty section", () => {
    const changelog = `# Changelog\n\n## [1.2.3]\n\n## [1.2.2] - 2025-12-01\n\n### Added\n\n- older\n`;
    const result = run(fixture({ changelog }), ["v1.2.3"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("empty");
  });

  test("fails when the changelog is missing entirely", () => {
    const result = run(fixture({ changelog: null }), ["v1.2.3"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CHANGELOG.md");
  });
});
