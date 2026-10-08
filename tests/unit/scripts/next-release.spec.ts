/**
 * Unit test for `scripts/next-release.mjs` (ATR-052).
 *
 * Two halves, because the script has two halves:
 *
 *   1. **The decisions** — commit classification, the level that follows from
 *      it, the version maths, and the changelog section (including the merge
 *      with hand-written `[Unreleased]` bullets). Pure functions, so every
 *      rule is stated here once.
 *   2. **The CLI** — driven against real repositories built in temp
 *      directories, because the interesting behaviours *are* facts about git
 *      and the working tree: the default is a plan and changes nothing, `--write`
 *      bumps the two files, and `--tag` commits and tags. A mocked git would
 *      test the mock.
 *
 * The script is imported by URL (a `.mjs` CLI with no declarations), and the
 * fixtures hold *copies* of it plus `release-config.mjs` — the script resolves
 * its repository root from its own location, which is what makes it safe to
 * run from anywhere and what makes a fixture the only way to test it.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { cleanupTmp, makeTmpDir } from "../../helpers/tmp-dir";

const SCRIPTS = path.resolve(__dirname, "..", "..", "..", "scripts");

interface Section {
  heading: string;
  bullets: string[];
}
interface CommitInput {
  hash?: string;
  subject: string;
  body?: string;
}

interface NextReleaseModule {
  parseCommit(subject: string): {
    type: string | null;
    scope: string | null;
    breaking: boolean;
    description: string;
  };
  decideLevel(commits: CommitInput[]): "major" | "minor" | "patch" | null;
  bumpVersion(version: string, level: string): string;
  sectionsFromCommits(commits: CommitInput[]): Section[];
  parseSections(body: string): Section[];
  mergeSections(derived: Section[], handWritten: Section[]): Section[];
  renderVersionSection(input: {
    version: string;
    date: string;
    sections: Section[];
  }): string;
  applyToChangelog(
    changelog: string,
    input: {
      version: string;
      date: string;
      sections: Section[];
      compareRepo: string | null;
      releasesRepo: string;
    },
  ): { changelog: string; linkRefs: boolean };
}

let release: NextReleaseModule;

beforeAll(async () => {
  release = (await import(
    pathToFileURL(path.join(SCRIPTS, "next-release.mjs")).href
  )) as NextReleaseModule;
});

const CHANGELOG_FIXTURE = `# Changelog

## [Unreleased]

### Changed

- a hand-written note

## [0.1.0] - 2026-01-01

### Added

- the first thing

[Unreleased]: https://github.com/acme/fixture/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/acme/fixture/releases/tag/v0.1.0
`;

const BUILDER_FIXTURE = `appId: com.acme.fixture
publish:
  provider: github
  owner: acme
  repo: fixture-releases
  releaseType: release
mac:
  target:
    - dmg
`;

// --- the decisions ---------------------------------------------------------

describe("commit classification", () => {
  test("reads type, scope and the breaking marker", () => {
    expect(release.parseCommit("feat(api)!: drop v1")).toEqual({
      type: "feat",
      scope: "api",
      breaking: true,
      description: "drop v1",
    });
  });

  test("keeps a non-conventional subject instead of dropping it", () => {
    expect(release.parseCommit("Tidy up the release scripts")).toEqual({
      type: null,
      scope: null,
      breaking: false,
      description: "Tidy up the release scripts",
    });
  });
});

describe("level", () => {
  test("breaking beats everything", () => {
    expect(
      release.decideLevel([
        { subject: "feat: add a thing" },
        { subject: "fix!: change the contract" },
      ]),
    ).toBe("major");
  });

  test("a BREAKING CHANGE trailer counts too", () => {
    expect(
      release.decideLevel([
        { subject: "fix: change the contract", body: "BREAKING CHANGE: yes" },
      ]),
    ).toBe("major");
  });

  test("a feature is a minor, anything else a patch", () => {
    expect(release.decideLevel([{ subject: "feat: add a thing" }])).toBe(
      "minor",
    );
    expect(release.decideLevel([{ subject: "fix: repair a thing" }])).toBe(
      "patch",
    );
    expect(release.decideLevel([{ subject: "Tidy the scripts" }])).toBe(
      "patch",
    );
  });

  test("no commits means no release", () => {
    expect(release.decideLevel([])).toBeNull();
  });
});

describe("version maths", () => {
  test("bumps the part the level names and zeroes what follows", () => {
    expect(release.bumpVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(release.bumpVersion("0.1.0", "minor")).toBe("0.2.0");
    expect(release.bumpVersion("0.1.0", "major")).toBe("1.0.0");
    expect(release.bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  });

  test("refuses a version that is not a version, or a level it does not know", () => {
    expect(() => release.bumpVersion("next", "minor")).toThrow(/not a version/);
    expect(() => release.bumpVersion("1.0.0", "huge")).toThrow(/unknown level/);
  });
});

describe("changelog sections", () => {
  test("routes commits to Added / Fixed / Changed and names breaking changes", () => {
    const sections = release.sectionsFromCommits([
      { hash: "aaa1111", subject: "feat: add folders" },
      { hash: "bbb2222", subject: "fix(panel): stop the footer eating clicks" },
      { hash: "ccc3333", subject: "docs: explain the feed" },
      { hash: "ddd4444", subject: "feat(api)!: drop v1", body: "" },
    ]);

    const added = sections.find((s) => s.heading === "Added");
    const fixed = sections.find((s) => s.heading === "Fixed");
    const changed = sections.find((s) => s.heading === "Changed");
    const breaking = sections.find((s) => s.heading === "Breaking changes");

    expect(added?.bullets).toEqual(["add folders", "api: drop v1"]);
    expect(fixed?.bullets).toEqual([
      "panel: stop the footer eating clicks",
    ]);
    expect(changed?.bullets).toEqual(["explain the feed"]);
    expect(breaking?.bullets).toEqual(["api: drop v1 (ddd4444)"]);
  });

  test("keeps a hand-written bullet that wraps onto following lines", () => {
    // Truncating at the first line loses most of the sentence, and the whole
    // point of merging is that nothing written by hand goes missing.
    const sections = release.parseSections(
      "\n### Added\n\n- a long one, which\n  continues here\n\n- and a short one\n",
    );

    expect(sections).toEqual([
      {
        heading: "Added",
        bullets: ["a long one, which\n  continues here", "and a short one"],
      },
    ]);
  });

  test("renders a wrapped bullet as markdown, continuation lines and all", () => {
    const text = release.renderVersionSection({
      version: "0.2.0",
      date: "2026-10-06",
      sections: [{ heading: "Added", bullets: ["first line\n  continued"] }],
    });

    expect(text).toBe(
      "## [0.2.0] - 2026-10-06\n\n### Added\n\n- first line\n  continued\n",
    );
  });

  test("merges hand-written bullets into the matching heading, keeping the rest", () => {
    const merged = release.mergeSections(
      [
        { heading: "Added", bullets: ["add folders"] },
        { heading: "Breaking changes", bullets: ["api: drop v1"] },
      ],
      [
        { heading: "Changed", bullets: ["a hand-written note"] },
        { heading: "Notes", bullets: ["a deployment note"] },
      ],
    );

    expect(merged.map((s) => s.heading)).toEqual([
      "Added",
      "Changed",
      "Notes",
      "Breaking changes",
    ]);
    expect(merged.find((s) => s.heading === "Changed")?.bullets).toEqual([
      "a hand-written note",
    ]);
  });

  test("renders a Keep a Changelog section", () => {
    const text = release.renderVersionSection({
      version: "0.2.0",
      date: "2026-10-06",
      sections: [{ heading: "Added", bullets: ["add folders"] }],
    });

    expect(text).toBe(
      "## [0.2.0] - 2026-10-06\n\n### Added\n\n- add folders\n",
    );
  });
});

describe("applyToChangelog", () => {
  test("inserts the section under [Unreleased] and moves the link references", () => {
    const { changelog, linkRefs } = release.applyToChangelog(CHANGELOG_FIXTURE, {
      version: "0.2.0",
      date: "2026-10-06",
      sections: release.mergeSections(
        [{ heading: "Added", bullets: ["add folders"] }],
        release.parseSections("\n### Changed\n\n- a hand-written note\n"),
      ),
      compareRepo: "https://github.com/acme/fixture",
      releasesRepo: "acme/fixture-releases",
    });

    expect(linkRefs).toBe(true);
    // Newest section sits directly under [Unreleased].
    expect(changelog).toMatch(
      /## \[Unreleased\]\n\n## \[0\.2\.0\] - 2026-10-06\n\n### Added\n\n- add folders/,
    );
    expect(changelog).toContain("- a hand-written note");
    expect(changelog).toContain(
      "[Unreleased]: https://github.com/acme/fixture/compare/v0.2.0...HEAD",
    );
    // Version links point at the releases repo, and older ones are corrected.
    expect(changelog).toContain(
      "[0.2.0]: https://github.com/acme/fixture-releases/releases/tag/v0.2.0",
    );
    expect(changelog).toContain(
      "[0.1.0]: https://github.com/acme/fixture-releases/releases/tag/v0.1.0",
    );
    expect(changelog).not.toContain("github.com/acme/fixture/releases/tag");
  });

  test("keeps a link that is not a release this repo moved away from", () => {
    // The shape a never-published version has: no release page, so it points at
    // the source repo's own compare by hand.
    const unpublished = CHANGELOG_FIXTURE.replace(
      "[0.1.0]: https://github.com/acme/fixture/releases/tag/v0.1.0",
      "[0.1.0]: https://github.com/acme/fixture/compare/v0.0.9...abc1234",
    );
    const { changelog } = release.applyToChangelog(unpublished, {
      version: "0.2.0",
      date: "2026-10-06",
      sections: [{ heading: "Added", bullets: ["add folders"] }],
      compareRepo: "https://github.com/acme/fixture",
      releasesRepo: "acme/fixture-releases",
    });

    // Rewriting it at the releases repo would point it at a tag nobody ever
    // published — the dangling link this guard exists to stop coming back.
    expect(changelog).toContain(
      "[0.1.0]: https://github.com/acme/fixture/compare/v0.0.9...abc1234",
    );
    expect(changelog).not.toContain(
      "[0.1.0]: https://github.com/acme/fixture-releases",
    );
  });

  test("leaves the references alone when there is no remote to point at", () => {
    const { changelog, linkRefs } = release.applyToChangelog(CHANGELOG_FIXTURE, {
      version: "0.2.0",
      date: "2026-10-06",
      sections: [{ heading: "Added", bullets: ["add folders"] }],
      compareRepo: null,
      releasesRepo: "acme/fixture-releases",
    });

    expect(linkRefs).toBe(false);
    expect(changelog).toContain("[Unreleased]: https://github.com/acme/fixture/compare/v0.1.0...HEAD");
    expect(changelog).toContain("## [0.2.0] - 2026-10-06");
  });
});

// --- the CLI ---------------------------------------------------------------

const fixtures: string[] = [];

afterEach(() => {
  while (fixtures.length > 0) cleanupTmp(fixtures.pop());
});

function git(cwd: string, args: string[]): string {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.email=e2e@example.com",
      "-c",
      "user.name=E2E",
      // Signing is the developer's setting, not the fixture's, for the same
      // reason the identity above is: a global `commit.gpgsign = true` (an SSH
      // agent, 1Password here) sends every wiring commit through an agent that
      // has nothing to do with this test, and a prompt it cannot answer fails
      // the fixture instead of the script. `next-release.mjs` disables signing
      // for its own commit and tag for the same reason (ATR-025); what the
      // scaffold does is not what is under test, so it must not depend on a
      // machine that can sign.
      "-c",
      "commit.gpgsign=false",
      "-c",
      "tag.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );
  expect(result.status, `git ${args.join(" ")}: ${result.stderr}`).toBe(0);
  return result.stdout ?? "";
}

/**
 * A throwaway repository holding the script, a package.json, a changelog, a
 * publish block and the commits a release would be derived from.
 */
function fixture(options: {
  commits?: string[];
  tagged?: string | null;
  remote?: boolean;
}): string {
  const dir = makeTmpDir("atr-next-release");
  fixtures.push(dir);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  for (const script of ["next-release.mjs", "release-config.mjs"]) {
    fs.copyFileSync(path.join(SCRIPTS, script), path.join(dir, "scripts", script));
  }
  fs.writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name: "fixture", version: "0.1.0" }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), CHANGELOG_FIXTURE);
  fs.writeFileSync(path.join(dir, "electron-builder.yml"), BUILDER_FIXTURE);

  git(dir, ["init", "-q"]);
  // The fixture carries its own identity, because `--write --tag` makes the
  // script commit and git refuses to invent an author without one. That is a
  // fact about the machine, not about the script: the throwaway repo used to
  // borrow whatever `~/.gitconfig` the developer had, and every runner that
  // has none failed the one test that covers the commit.
  git(dir, ["config", "user.email", "e2e@example.com"]);
  git(dir, ["config", "user.name", "E2E"]);
  if (options.remote !== false) {
    git(dir, [
      "remote",
      "add",
      "origin",
      "git@github.com:acme/fixture.git",
    ]);
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "chore: scaffold"]);
  if (options.tagged) git(dir, ["tag", options.tagged]);
  for (const subject of options.commits ?? []) {
    git(dir, ["commit", "-q", "--allow-empty", "-m", subject]);
  }
  return dir;
}

function run(dir: string, args: string[] = []) {
  const result = spawnSync(
    process.execPath,
    [path.join(dir, "scripts", "next-release.mjs"), ...args],
    { cwd: dir, encoding: "utf8" },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function versionOf(dir: string): string {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
    .version;
}

describe("next-release CLI", () => {
  test("plans by default and changes nothing", () => {
    const dir = fixture({ tagged: "v0.1.0", commits: ["feat: add folders"] });
    const result = run(dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("v0.1.0 -> v0.2.0");
    expect(result.stdout).toContain("## [0.2.0]");
    expect(result.stdout).toContain("plan only");
    expect(versionOf(dir)).toBe("0.1.0");
    expect(fs.readFileSync(path.join(dir, "CHANGELOG.md"), "utf8")).toBe(
      CHANGELOG_FIXTURE,
    );
  });

  test("--write bumps the version and writes the section, keeping hand-written notes", () => {
    const dir = fixture({ tagged: "v0.1.0", commits: ["feat: add folders"] });
    const result = run(dir, ["--write"]);

    expect(result.status).toBe(0);
    expect(versionOf(dir)).toBe("0.2.0");

    const changelog = fs.readFileSync(path.join(dir, "CHANGELOG.md"), "utf8");
    expect(changelog).toMatch(/## \[Unreleased\]\n\n## \[0\.2\.0\]/);
    expect(changelog).toContain("- add folders");
    expect(changelog).toContain("- a hand-written note");
    expect(changelog).toContain(
      "[Unreleased]: https://github.com/acme/fixture/compare/v0.2.0...HEAD",
    );
  });

  test("--write --tag commits the bump and tags it, and pushes nothing", () => {
    const dir = fixture({ tagged: "v0.1.0", commits: ["fix: repair a thing"] });
    const result = run(dir, ["--write", "--tag"]);

    expect(result.status).toBe(0);
    expect(versionOf(dir)).toBe("0.1.1");
    expect(git(dir, ["tag", "-l"]).trim().split("\n")).toContain("v0.1.1");
    expect(git(dir, ["log", "-1", "--format=%s"]).trim()).toBe(
      "chore: release v0.1.1",
    );
    expect(result.stdout).toContain("nothing pushed");
  });

  test("--tag without --write is refused, and --push without --tag too", () => {
    const dir = fixture({ tagged: "v0.1.0", commits: ["feat: add folders"] });

    expect(run(dir, ["--tag"]).status).toBe(2);
    expect(run(dir, ["--push"]).status).toBe(2);
    expect(versionOf(dir)).toBe("0.1.0");
  });

  test("says so when there is nothing to release", () => {
    const dir = fixture({ tagged: "v0.1.0" });
    const result = run(dir);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("nothing to release");
  });

  test("refuses to guess a version when nothing has ever been tagged", () => {
    // Counting the whole history would fold work that already shipped into the
    // next version and drop the section describing it, so it stops instead.
    const dir = fixture({ tagged: null, commits: ["feat: add folders"] });
    const result = run(dir);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nothing is tagged");
    expect(result.stderr).toContain("git tag v0.1.0");
    expect(versionOf(dir)).toBe("0.1.0");
  });

  test("counts from an explicit baseline when there is no tag", () => {
    const dir = fixture({ tagged: null, commits: ["feat: add folders"] });
    const result = run(dir, ["--from", "HEAD~1"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("HEAD~1 -> v0.2.0");
  });

  test("--level overrides the guess, for a release with only docs commits", () => {
    const dir = fixture({ tagged: "v0.1.0", commits: ["docs: explain things"] });

    expect(run(dir).stdout).toContain("v0.1.0 -> v0.1.1");
    const forced = run(dir, ["--level", "minor"]);
    expect(forced.stdout).toContain("v0.1.0 -> v0.2.0");
    expect(forced.stdout).toContain("(forced)");
  });

  test("a fixture with no remote still bumps, and warns about the links", () => {
    const dir = fixture({
      tagged: "v0.1.0",
      commits: ["feat: add folders"],
      remote: false,
    });
    const result = run(dir, ["--write"]);

    expect(result.status).toBe(0);
    expect(versionOf(dir)).toBe("0.2.0");
    expect(result.stderr).toContain("no origin remote");
  });
});
