/**
 * Unit tests for the catalog's derivation layer.
 *
 * These four modules turn data the catalog already had into the three
 * things the UI is built around — what a project IS, whether it's yours,
 * how stale it is, and where it lives. They are pure (no DOM, no IPC),
 * so they're imported directly rather than re-implemented in the spec.
 *
 * The description cases are drawn from real README shapes that broke the
 * old catalog: centred HTML hero blocks, shields.io badge walls, and
 * translation-switcher rows.
 */

import { describe, expect, it } from "vitest";

import type { Repo } from "@shared/types";

import { activityOf, lastTouched } from "@renderer/lib/activity";
import { generatedCover, initialsFor } from "@renderer/lib/cover";
import { cleanDescription, isChromeDescription } from "@renderer/lib/describe";
import {
  inferIdentities,
  ownershipOf,
  parseRemote,
} from "@renderer/lib/ownership";
import {
  buildRepoForest,
  buildRepoTree,
  commonRoot,
  isArchivedPath,
  isUnder,
  owningRoot,
  tildify,
} from "@renderer/lib/repo-tree";

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 1,
    slug: "example",
    name: "example",
    fullPath: "/Users/j/Repos/example",
    remoteUrl: null,
    defaultBranch: "main",
    currentBranch: "main",
    lastCommitHash: null,
    lastCommitDate: null,
    lastCommitMsg: null,
    isDirty: false,
    primaryLanguage: null,
    languages: [],
    tags: [],
    description: null,
    readmePreview: null,
    readmeHash: null,
    sizeBytes: null,
    lastScannedAt: null,
    lastOpenedAt: null,
    isFavorite: false,
    favoritedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "filesystem_scan",
    ...overrides,
  };
}

describe("cleanDescription", () => {
  it("strips a centred HTML hero block and finds the real sentence", () => {
    const readme = `<p align="center">
  <a href="https://example.com"><img src="logo.png" width="200"></a>
</p>
<h1 align="center">Paperclip</h1>

Paperclip runs your business while you sleep, handling invoices end to end.`;
    expect(cleanDescription(null, readme)).toBe(
      "Paperclip runs your business while you sleep, handling invoices end to end.",
    );
  });

  it("drops a badge wall rather than reading the alt text as prose", () => {
    const readme = `[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![codecov](https://codecov.io/gh/x/y/badge.svg)](https://codecov.io/gh/x/y)

A local-first hub for the repositories on your machine.`;
    expect(cleanDescription(readme)).toBe(
      "A local-first hub for the repositories on your machine.",
    );
  });

  it("skips a translation-switcher row", () => {
    const readme = `English | [中文](./README_zh.md) | [日本語](./README_ja.md) | [Français](./README_fr.md)

Deer Flow is a community-driven deep research framework.`;
    expect(cleanDescription(readme)).toBe(
      "Deer Flow is a community-driven deep research framework.",
    );
  });

  it("keeps prose that merely ends in a bare URL", () => {
    const source =
      "A set of LangChain Tutorials from my youtube playlist https://youtube.com/x";
    expect(cleanDescription(source)).toBe(
      "A set of LangChain Tutorials from my youtube playlist",
    );
  });

  it("returns null when a source genuinely has no prose", () => {
    expect(cleanDescription('<div align="center">')).toBeNull();
    expect(cleanDescription(null, null)).toBeNull();
    expect(cleanDescription("   ")).toBeNull();
  });

  it("prefers the stored description when it is already clean", () => {
    expect(
      cleanDescription(
        "An AI agent with advanced tool-calling capabilities.",
        "# Ignored heading\n\nSome other text entirely here.",
      ),
    ).toBe("An AI agent with advanced tool-calling capabilities.");
  });

  it("falls back to the README only when the description is chrome", () => {
    expect(isChromeDescription('<p align="center"> <a href')).toBe(true);
    expect(isChromeDescription("A perfectly ordinary description here.")).toBe(
      false,
    );
    expect(
      cleanDescription(
        '<p align="center"> <a href="x">',
        "The real explanation of what this project actually does.",
      ),
    ).toBe("The real explanation of what this project actually does.");
  });
});

describe("parseRemote", () => {
  it("parses https, scp-style and ssh remotes alike", () => {
    expect(parseRemote("https://github.com/ivy00johns/The-Hive.git")).toEqual({
      owner: "ivy00johns",
      host: "github.com",
      repo: "The-Hive",
    });
    expect(parseRemote("git@github.com:openai/whisper.git")).toEqual({
      owner: "openai",
      host: "github.com",
      repo: "whisper",
    });
    expect(parseRemote("ssh://git@gitlab.com/group/sub/proj.git")).toEqual({
      owner: "group",
      host: "gitlab.com",
      repo: "proj",
    });
  });

  it("returns null for missing or unparseable remotes", () => {
    expect(parseRemote(null)).toBeNull();
    expect(parseRemote("")).toBeNull();
    expect(parseRemote("not-a-url")).toBeNull();
  });
});

describe("ownershipOf", () => {
  const identities = ["ivy00johns"];

  it("classifies your own remotes as mine, case-insensitively", () => {
    const info = ownershipOf(
      { remoteUrl: "https://github.com/IVY00Johns/x.git" },
      identities,
    );
    expect(info.kind).toBe("mine");
    expect(info.label).toBe("Mine");
  });

  it("classifies someone else's remote as external and names the owner", () => {
    const info = ownershipOf(
      { remoteUrl: "https://github.com/anthropics/x.git" },
      identities,
    );
    expect(info.kind).toBe("external");
    expect(info.label).toBe("anthropics");
  });

  it("treats a repo with no remote as local-only, not as someone else's", () => {
    expect(ownershipOf({ remoteUrl: null }, identities).kind).toBe("local");
  });
});

describe("inferIdentities", () => {
  it("picks the dominant remote owner on a personal machine", () => {
    const repos = [
      ...Array.from({ length: 6 }, (_, i) =>
        repo({
          slug: `mine-${i}`,
          remoteUrl: `https://github.com/ivy00johns/p${i}.git`,
        }),
      ),
      repo({ slug: "a", remoteUrl: "https://github.com/openai/a.git" }),
      repo({ slug: "b", remoteUrl: "https://github.com/anthropics/b.git" }),
    ];
    expect(inferIdentities(repos)).toEqual(["ivy00johns"]);
  });

  it("declines to guess when no owner clearly leads", () => {
    const repos = [
      repo({ slug: "a", remoteUrl: "https://github.com/one/a.git" }),
      repo({ slug: "b", remoteUrl: "https://github.com/two/b.git" }),
      repo({ slug: "c", remoteUrl: "https://github.com/three/c.git" }),
      repo({ slug: "d", remoteUrl: "https://github.com/four/d.git" }),
    ];
    expect(inferIdentities(repos)).toEqual([]);
  });

  it("declines on too small a sample rather than guessing from one repo", () => {
    expect(
      inferIdentities([
        repo({ remoteUrl: "https://github.com/someone/only.git" }),
      ]),
    ).toEqual([]);
  });
});

describe("activityOf", () => {
  const now = Date.parse("2026-08-23T00:00:00.000Z");
  const daysAgo = (days: number) =>
    new Date(now - days * 86_400_000).toISOString();

  it("buckets by age, freshest first", () => {
    expect(activityOf(daysAgo(1), now).level).toBe("active");
    expect(activityOf(daysAgo(20), now).level).toBe("warm");
    expect(activityOf(daysAgo(60), now).level).toBe("cooling");
    expect(activityOf(daysAgo(200), now).level).toBe("idle");
    expect(activityOf(daysAgo(900), now).level).toBe("dormant");
  });

  it("treats a missing or invalid timestamp as unknown, not as ancient", () => {
    expect(activityOf(null, now).level).toBe("unknown");
    expect(activityOf(null, now).days).toBeNull();
    expect(activityOf("not-a-date", now).level).toBe("unknown");
  });

  it("produces heat that falls monotonically with age", () => {
    const fresh = activityOf(daysAgo(1), now).heat;
    const mid = activityOf(daysAgo(90), now).heat;
    const old = activityOf(daysAgo(900), now).heat;
    expect(fresh).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(old);
    expect(old).toBeGreaterThanOrEqual(0);
    expect(fresh).toBeLessThanOrEqual(1);
  });

  it("lastTouched prefers whichever of commit/open is more recent", () => {
    expect(
      lastTouched({
        lastCommitDate: "2026-01-01T00:00:00.000Z",
        lastOpenedAt: "2026-06-01T00:00:00.000Z",
      }),
    ).toBe("2026-06-01T00:00:00.000Z");
    expect(
      lastTouched({ lastCommitDate: null, lastOpenedAt: null }),
    ).toBeNull();
  });
});

describe("buildRepoTree", () => {
  const repos = [
    repo({ slug: "a", fullPath: "/Users/j/Repos/ai/agents/a" }),
    repo({ slug: "b", fullPath: "/Users/j/Repos/ai/agents/b", isDirty: true }),
    repo({ slug: "c", fullPath: "/Users/j/Repos/ai/local/c" }),
    repo({ slug: "d", fullPath: "/Users/j/Repos/work/d" }),
  ];

  it("finds the common root and excludes the repo directory itself", () => {
    expect(commonRoot(repos.map((r) => r.fullPath))).toBe("/Users/j/Repos");
  });

  it("nests directories and rolls counts up the tree", () => {
    const tree = buildRepoTree(repos);
    expect(tree.totalRepos).toBe(4);

    const ai = tree.children.find((c) => c.name === "ai");
    expect(ai?.totalRepos).toBe(3);
    expect(ai?.dirtyCount).toBe(1);
    expect(ai?.children.map((c) => c.name)).toEqual(["agents", "local"]);

    const agents = ai?.children.find((c) => c.name === "agents");
    expect(agents?.repos.map((r) => r.slug)).toEqual(["a", "b"]);
  });

  it("handles an empty catalog without throwing", () => {
    const tree = buildRepoTree([]);
    expect(tree.totalRepos).toBe(0);
    expect(tree.children).toEqual([]);
  });

  it("isUnder matches a directory and its descendants but not siblings", () => {
    expect(isUnder("/a/b/c", "/a/b")).toBe(true);
    expect(isUnder("/a/b", "/a/b")).toBe(true);
    // `/a/bc` must not be treated as living under `/a/b`.
    expect(isUnder("/a/bc", "/a/b")).toBe(false);
  });

  it("recognises put-away folders anywhere in the path", () => {
    expect(isArchivedPath("/Users/j/Repos/_archive/duplicates/x")).toBe(true);
    expect(isArchivedPath("/Users/j/Repos/ai/agents/x")).toBe(false);
  });
});

describe("generatedCover", () => {
  it("is deterministic for a given slug", () => {
    expect(generatedCover("my-repo", "My Repo")).toEqual(
      generatedCover("my-repo", "My Repo"),
    );
  });

  it("separates adjacent slugs into different hues", () => {
    // A naive char-sum hash puts `app-v1` and `app-v2` next to each
    // other; the whole point of the cover is that they don't collide.
    const a = generatedCover("app-v1", "app-v1");
    const b = generatedCover("app-v2", "app-v2");
    const distance = Math.min(
      Math.abs(a.hue - b.hue),
      360 - Math.abs(a.hue - b.hue),
    );
    expect(distance).toBeGreaterThan(20);
  });

  it("never lands on a hue reserved for a status colour", () => {
    for (let i = 0; i < 400; i++) {
      const { hue } = generatedCover(`repo-${i}`, `repo ${i}`);
      const normalized = ((hue % 360) + 360) % 360;
      expect(normalized).toBeGreaterThan(50);
      expect(normalized < 100 || normalized > 160).toBe(true);
    }
  });

  it("derives initials from word boundaries, not the first two letters", () => {
    expect(initialsFor("the-hive-ecosystem")).toBe("TH");
    expect(initialsFor("QuantDinger")).toBe("QD");
    expect(initialsFor("sherlock")).toBe("SH");
    expect(initialsFor("x")).toBe("X");
  });
});

describe("buildRepoForest", () => {
  const SCAN_PATHS = ["/Users/j/Repos", "/Users/j/Projects"];
  const repos = [
    repo({ slug: "a", fullPath: "/Users/j/Repos/ai/a" }),
    repo({ slug: "b", fullPath: "/Users/j/Repos/ai/b", isDirty: true }),
    repo({ slug: "c", fullPath: "/Users/j/Repos/work/c" }),
  ];

  it("shows a configured scan root that contains no repos", () => {
    // The bug this guards: a root you told the app to watch was invisible
    // until something was found in it, so "empty" and "not configured"
    // looked identical.
    const forest = buildRepoForest(repos, SCAN_PATHS);
    expect(forest.roots.map((r) => r.path)).toEqual(SCAN_PATHS);
    const projects = forest.roots.find((r) => r.path.endsWith("/Projects"));
    expect(projects?.totalRepos).toBe(0);
    expect(projects?.isScanRoot).toBe(true);
  });

  it("keeps the tree shape stable when a second root gains its first repo", () => {
    const before = buildRepoForest(repos, SCAN_PATHS);
    const after = buildRepoForest(
      [...repos, repo({ slug: "d", fullPath: "/Users/j/Projects/d" })],
      SCAN_PATHS,
    );
    const namesUnderRepos = (f: ReturnType<typeof buildRepoForest>) =>
      f.roots[0].children.map((c) => c.name);
    // Previously the common ancestor slid up to /Users/j and every folder
    // gained a level of nesting the moment this happened.
    expect(namesUnderRepos(after)).toEqual(namesUnderRepos(before));
    expect(after.roots[1].totalRepos).toBe(1);
  });

  it("attributes a repo to the most specific of nested scan roots", () => {
    const forest = buildRepoForest(
      [repo({ slug: "w", fullPath: "/Users/j/Repos/work/w" })],
      ["/Users/j/Repos", "/Users/j/Repos/work"],
    );
    const specific = forest.roots.find((r) => r.path.endsWith("/work"));
    const general = forest.roots.find((r) => r.path === "/Users/j/Repos");
    expect(specific?.totalRepos).toBe(1);
    expect(general?.totalRepos).toBe(0);
  });

  it("surfaces repos living outside every scan root", () => {
    const forest = buildRepoForest(
      [...repos, repo({ slug: "stray", fullPath: "/tmp/scratch/stray" })],
      SCAN_PATHS,
    );
    const stray = forest.roots.find((r) => r.isOutsideScanRoots);
    expect(stray?.totalRepos).toBe(1);
  });

  it("falls back to the common ancestor when no roots are configured", () => {
    const forest = buildRepoForest(repos, []);
    expect(forest.roots).toHaveLength(1);
    expect(forest.roots[0].path).toBe("/Users/j/Repos");
    expect(forest.totalRepos).toBe(3);
  });

  it("rolls dirty counts up to the scan root", () => {
    const forest = buildRepoForest(repos, SCAN_PATHS);
    expect(forest.roots[0].dirtyCount).toBe(1);
  });

  it("tolerates trailing slashes and duplicates in scan paths", () => {
    const forest = buildRepoForest(repos, [
      "/Users/j/Repos/",
      "/Users/j/Repos",
    ]);
    expect(forest.roots).toHaveLength(1);
    expect(forest.roots[0].totalRepos).toBe(3);
  });

  it("owningRoot picks the most specific match", () => {
    expect(owningRoot("/Users/j/Repos/work/c", SCAN_PATHS)).toBe(
      "/Users/j/Repos",
    );
    expect(
      owningRoot("/Users/j/Repos/work/c", ["/Users/j/Repos", "/Users/j/Repos/work"]),
    ).toBe("/Users/j/Repos/work");
    expect(owningRoot("/tmp/x", SCAN_PATHS)).toBeNull();
  });

  it("tildify shortens a home path and leaves others alone", () => {
    expect(tildify("/Users/johns/Repos")).toBe("~/Repos");
    expect(tildify("/home/johns/Repos/ai")).toBe("~/Repos/ai");
    expect(tildify("/opt/code")).toBe("/opt/code");
  });
});
