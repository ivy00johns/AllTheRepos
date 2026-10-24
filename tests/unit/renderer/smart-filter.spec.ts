/**
 * Unit tests for the smart-group predicate.
 *
 * One function, two callers: the catalog's filter pass (which repos a saved
 * filter shows) and the rail's count (the number beside its name). They were
 * written against this predicate rather than each keeping a copy, so what is
 * pinned here is the single answer both get.
 *
 * The two cases worth naming: a `null` filter matches the whole catalog rather
 * than nothing, and `sinceDays` refuses a repo whose activity is unknown. Both
 * are readings a reasonable implementation could get backwards, and both are
 * visible to a user as a saved filter that is silently empty or silently full.
 */

import { describe, expect, it } from "vitest";

import type { Repo, SmartFilter } from "@shared/types";

import {
  describeSmartFilter,
  filterIncludesArchived,
  languagesInCatalog,
  matchesSmartFilter,
} from "@renderer/lib/smart-filter";

function repo(over: Partial<Repo> = {}): Repo {
  return {
    id: 1,
    slug: "alpha",
    name: "Alpha",
    fullPath: "/repos/alpha",
    remoteUrl: null,
    defaultBranch: null,
    currentBranch: null,
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
    ...over,
  };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("matchesSmartFilter", () => {
  it("matches everything when the filter is null", () => {
    // A group with no filter is unconstrained, not empty — the reading the
    // catalog's member filter has always used.
    expect(matchesSmartFilter(repo(), null)).toBe(true);
    expect(matchesSmartFilter(repo(), undefined)).toBe(true);
  });

  it("matches everything when the filter is an empty object", () => {
    expect(matchesSmartFilter(repo(), {})).toBe(true);
  });

  it("compares language exactly", () => {
    const filter: SmartFilter = { language: "TypeScript" };
    expect(matchesSmartFilter(repo({ primaryLanguage: "TypeScript" }), filter)).toBe(
      true,
    );
    expect(matchesSmartFilter(repo({ primaryLanguage: "Rust" }), filter)).toBe(false);
    // A repo with no detected language cannot claim to be one.
    expect(matchesSmartFilter(repo({ primaryLanguage: null }), filter)).toBe(false);
  });

  it("requires every included tag, not just one", () => {
    const filter: SmartFilter = { tagsInclude: ["cli", "rust"] };
    const both = repo({
      tags: [
        { value: "cli", source: "user" },
        { value: "rust", source: "heuristic" },
      ],
    });
    const one = repo({ tags: [{ value: "cli", source: "user" }] });
    expect(matchesSmartFilter(both, filter)).toBe(true);
    expect(matchesSmartFilter(one, filter)).toBe(false);
  });

  it("excludes a repo carrying any excluded tag", () => {
    const filter: SmartFilter = { tagsExclude: ["archived"] };
    expect(
      matchesSmartFilter(
        repo({ tags: [{ value: "archived", source: "user" }] }),
        filter,
      ),
    ).toBe(false);
    expect(
      matchesSmartFilter(repo({ tags: [{ value: "cli", source: "user" }] }), filter),
    ).toBe(true);
  });

  it("keeps repos touched within the window and drops older ones", () => {
    const filter: SmartFilter = { sinceDays: 30 };
    expect(
      matchesSmartFilter(repo({ lastCommitDate: daysAgo(3) }), filter),
    ).toBe(true);
    // Recency is the most recent of commit and open, not the commit alone.
    expect(
      matchesSmartFilter(
        repo({ lastCommitDate: daysAgo(400), lastOpenedAt: daysAgo(1) }),
        filter,
      ),
    ).toBe(true);
    expect(
      matchesSmartFilter(repo({ lastCommitDate: daysAgo(90) }), filter),
    ).toBe(false);
  });

  it("drops a repo with no known activity from a recency filter", () => {
    // "Never committed" cannot be inside "last 30 days" — and treating an
    // unknown date as recent would fill the filter with every unscanned repo.
    expect(
      matchesSmartFilter(repo({ lastCommitDate: null, lastOpenedAt: null }), {
        sinceDays: 30,
      }),
    ).toBe(false);
  });

  it("keeps a repo touched exactly on the boundary", () => {
    // `activityOf` floors to whole days, so 30 days ago is day 30, which the
    // filter's `> sinceDays` test admits.
    expect(
      matchesSmartFilter(repo({ lastCommitDate: daysAgo(30) }), { sinceDays: 30 }),
    ).toBe(true);
  });

  it("filters on uncommitted changes", () => {
    expect(matchesSmartFilter(repo({ isDirty: true }), { dirtyOnly: true })).toBe(
      true,
    );
    expect(matchesSmartFilter(repo({ isDirty: false }), { dirtyOnly: true })).toBe(
      false,
    );
    // `dirtyOnly: false` is a stated condition, but it must not exclude the
    // clean repos it describes.
    expect(matchesSmartFilter(repo({ isDirty: false }), { dirtyOnly: false })).toBe(
      true,
    );
  });

  it("filters on pinned, and an unticked box restricts nothing", () => {
    expect(matchesSmartFilter(repo({ isFavorite: true }), { favoritesOnly: true })).toBe(
      true,
    );
    expect(matchesSmartFilter(repo(), { favoritesOnly: true })).toBe(false);
    expect(matchesSmartFilter(repo(), { favoritesOnly: false })).toBe(true);
  });

  it("treats hasRemote as a stated yes/no, including local-only", () => {
    const withRemote = repo({ remoteUrl: "https://example.com/a.git" });
    expect(matchesSmartFilter(withRemote, { hasRemote: true })).toBe(true);
    expect(matchesSmartFilter(repo(), { hasRemote: true })).toBe(false);
    expect(matchesSmartFilter(repo(), { hasRemote: false })).toBe(true);
    expect(matchesSmartFilter(withRemote, { hasRemote: false })).toBe(false);
  });

  it("combines conditions conjunctively", () => {
    const filter: SmartFilter = {
      language: "TypeScript",
      tagsInclude: ["cli"],
      dirtyOnly: true,
    };
    const match = repo({
      primaryLanguage: "TypeScript",
      isDirty: true,
      tags: [{ value: "cli", source: "user" }],
    });
    expect(matchesSmartFilter(match, filter)).toBe(true);
    expect(matchesSmartFilter({ ...match, isDirty: false }, filter)).toBe(false);
    expect(matchesSmartFilter({ ...match, primaryLanguage: "Go" }, filter)).toBe(
      false,
    );
  });
});

/**
 * The banner's explanation of a filter.
 *
 * These read the same stored filter the predicate does, so the check with the
 * most weight is the one that says every condition either shows up or is
 * provably absent: a summary that quietly drops `tagsExclude` would put a
 * narrower grid under an explanation that does not account for it.
 */
describe("describeSmartFilter", () => {
  it("says nothing for a filter that constrains nothing", () => {
    // An empty result is rendered as "Every repo". Returning a phrase like
    // "no conditions" would read as a filter that matches nothing.
    expect(describeSmartFilter(null)).toEqual([]);
    expect(describeSmartFilter(undefined)).toEqual([]);
    expect(describeSmartFilter({})).toEqual([]);
  });

  it("describes every stored condition, in narrowing order", () => {
    expect(
      describeSmartFilter({
        language: "TypeScript",
        tagsInclude: ["cli", "rust"],
        tagsExclude: ["archived"],
        sinceDays: 30,
        dirtyOnly: true,
        favoritesOnly: true,
        includeArchived: true,
        hasRemote: true,
      }),
    ).toEqual([
      "written in TypeScript",
      "tagged cli, rust",
      "not tagged archived",
      "touched in the last 30 days",
      "uncommitted changes",
      "pinned repos",
      "archived folders included",
      "has a remote",
    ]);
  });

  it("says 'day' in the singular", () => {
    expect(describeSmartFilter({ sinceDays: 1 })).toEqual([
      "touched in the last 1 day",
    ]);
  });

  it("distinguishes no remote from any remote", () => {
    expect(describeSmartFilter({ hasRemote: false })).toEqual(["no remote"]);
    expect(describeSmartFilter({ hasRemote: true })).toEqual(["has a remote"]);
  });

  it("leaves out conditions that are absent rather than unset-but-present", () => {
    // `dirtyOnly: false` is not a narrowing condition, so it must not be
    // printed as if it were one.
    expect(describeSmartFilter({ dirtyOnly: false })).toEqual([]);
    expect(describeSmartFilter({ favoritesOnly: false })).toEqual([]);
    expect(describeSmartFilter({ includeArchived: false })).toEqual([]);
    expect(describeSmartFilter({ tagsInclude: [] })).toEqual([]);
  });
});

/**
 * `includeArchived` is the one condition the predicate does not evaluate.
 *
 * The catalog hides archived folders before a group is consulted, so a group
 * that wants them has to lift that exclusion — which happens at the exclusion,
 * not inside `matchesSmartFilter`. What is pinned here is that the helper the
 * callers use says so, and that the predicate does not start rejecting archived
 * repos on its own (that would make "include" mean "only").
 */
describe("filterIncludesArchived", () => {
  it("is true only when the filter says so", () => {
    expect(filterIncludesArchived({ includeArchived: true })).toBe(true);
    expect(filterIncludesArchived({ includeArchived: false })).toBe(false);
    expect(filterIncludesArchived({})).toBe(false);
    expect(filterIncludesArchived(null)).toBe(false);
  });

  it("does not narrow the predicate", () => {
    const archived = repo({ fullPath: "/repos/_archive/old-thing" });
    expect(matchesSmartFilter(archived, { includeArchived: true })).toBe(true);
    expect(matchesSmartFilter(repo(), { includeArchived: true })).toBe(true);
  });
});

describe("languagesInCatalog", () => {
  it("lists the languages present, once each, sorted", () => {
    expect(
      languagesInCatalog([
        repo({ slug: "a", primaryLanguage: "Rust" }),
        repo({ slug: "b", primaryLanguage: "TypeScript" }),
        repo({ slug: "c", primaryLanguage: "Rust" }),
        repo({ slug: "d", primaryLanguage: null }),
      ]),
    ).toEqual(["Rust", "TypeScript"]);
  });

  it("offers nothing for an empty catalog", () => {
    expect(languagesInCatalog([])).toEqual([]);
  });
});
