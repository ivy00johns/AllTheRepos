/**
 * Unit tests for the near-miss derivation behind an empty search.
 *
 * `nearMisses` is imported directly rather than re-implemented: it is pure (no
 * DOM, no store, no search call), so the spec can hold the real ranking to
 * account instead of a copy of it that drifts.
 *
 * Two properties matter, and they pull against each other. A near miss has to
 * find the repo behind a one-word typo — that is the whole point of offering it
 * instead of telling the reader to retype the query. And it has to stay quiet
 * when there is nothing close, because a suggestion list that always has three
 * entries is worse than no list: it teaches the reader that the feature lies.
 */

import { describe, expect, it } from "vitest";

import type { Repo } from "@shared/types";

import { nearMisses } from "@renderer/lib/near-miss";

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
  } as Repo;
}

const library = repo({
  id: 1,
  slug: "demo-library-1111",
  name: "Demo Library",
  fullPath: "/Users/j/Repos/demo-library",
  primaryLanguage: "TypeScript",
  description: "Seeded by the suite: Demo Library",
});
const cli = repo({
  id: 2,
  slug: "demo-cli-2222",
  name: "Demo CLI",
  fullPath: "/Users/j/Repos/demo-cli",
  primaryLanguage: "Go",
});
const web = repo({
  id: 3,
  slug: "demo-web-3333",
  name: "Demo Web",
  fullPath: "/Users/j/Repos/demo-web",
  primaryLanguage: "TypeScript",
});

describe("nearMisses", () => {
  it("says nothing when there is no query to miss", () => {
    expect(nearMisses("", [library, cli, web])).toEqual([]);
    expect(nearMisses("   ", [library, cli, web])).toEqual([]);
    expect(nearMisses("---", [library, cli, web])).toEqual([]);
  });

  it("finds the repo behind a one-word typo", () => {
    // The case the feature exists for: one letter out, and the search — which
    // matches by prefix — returned nothing at all.
    const misses = nearMisses("demo liberary", [library, cli, web]);
    expect(misses.map((miss) => miss.repo.slug)).toEqual(["demo-library-1111"]);
    expect(misses[0].matchedOn).toBe("demo");
    expect(misses[0].field).toBe("name");
  });

  it("ranks by how much of the query the repo accounts for", () => {
    // Every repo here matches "demo"; only one matches the word that was
    // mistyped. A score off one of two words is half a match, not a near miss.
    const misses = nearMisses("demo librar", [cli, web, library]);
    expect(misses[0].repo.slug).toBe("demo-library-1111");
    // The half matches do not clear the floor, so they are not offered.
    expect(misses.map((miss) => miss.repo.slug)).not.toContain("demo-cli-2222");
  });

  it("says nothing when nothing is close", () => {
    // Every repo here carries a word that "repo" could latch onto. None of
    // them accounts for a quarter of the query, let alone most of it.
    const repos = [
      repo({ name: "Repos Tools", fullPath: "/Users/j/Repos/zzz/tools" }),
      repo({ name: "Such Likeness", description: "no such pattern" }),
      library,
      cli,
      web,
    ];
    expect(nearMisses("zzz-no-such-repo", repos)).toEqual([]);
  });

  it("reads a query typed as one word against a name that is two", () => {
    // "vibe os" is one term away from VibeOS in each direction; judged word by
    // word it looks like half a match, so the joined form is what saves it.
    const vibeos = repo({ name: "VibeOS", fullPath: "/Users/j/Repos/vibeos" });
    const misses = nearMisses("vibe oss", [vibeos, cli]);
    expect(misses.map((miss) => miss.repo.slug)).toEqual([vibeos.slug]);
  });

  it("puts a mistyped name above a repo that merely shares a shorter word", () => {
    // The ordering this exists for. "liberary" is "library" with one letter
    // wrong; "Liber" is the first five letters of the query and nothing else.
    // Sharing a prefix the reader never meant to type is not better evidence
    // than the whole word spelled wrong, whichever way round the query is
    // typed — so both the two-word and the one-word query have to rank the
    // mistyped name first.
    const liber = repo({
      id: 6,
      name: "Demo Liber",
      slug: "demo-liber-6666",
      fullPath: "/Users/j/Repos/demo-liber",
    });

    const twoWords = nearMisses("demo liberary", [liber, library]);
    expect(twoWords.map((miss) => miss.repo.slug)).toEqual([
      "demo-library-1111",
      "demo-liber-6666",
    ]);

    const oneWord = nearMisses("liberary", [liber, library]);
    expect(oneWord.map((miss) => miss.repo.slug)).toEqual([
      "demo-library-1111",
      "demo-liber-6666",
    ]);
    // Sharing five of the eight letters still earns a place on the list — it is
    // just not the first one.
    expect(oneWord[1].field).toBe("name");
  });

  it("grades how much of the query a shared word accounts for", () => {
    // "kubernetse" is a transposition of "kubernetes" — two letters out, which
    // is the weakest a typo can be and still be a typo. "Kuber" shares five of
    // the ten letters, "Kube" four: one is worth offering, the other is not,
    // and both sit below the mistyped whole word — the four-letter one used to
    // come first, because a shared prefix scored 0.9 whatever its length.
    const kuber = repo({
      id: 7,
      name: "Kuber",
      slug: "kuber-7777",
      fullPath: "/Users/j/Repos/kuber",
    });
    const kube = repo({
      id: 8,
      name: "Kube",
      slug: "kube-8888",
      fullPath: "/Users/j/Repos/kube",
    });
    const helper = repo({
      id: 9,
      name: "Kubernetes Helper",
      slug: "k8s-helper",
      fullPath: "/Users/j/Repos/kubernetes-helper",
    });

    const misses = nearMisses("kubernetse", [kube, kuber, helper]);
    expect(misses.map((miss) => miss.repo.slug)).toEqual([
      "k8s-helper",
      "kuber-7777",
    ]);
    // The two kinds sit in bands that cannot cross: every typo is at or above
    // 0.8, and every partial overlap below it.
    expect(misses[0].score).toBeGreaterThanOrEqual(0.8);
    expect(misses[1].score).toBeLessThan(0.8);
  });

  it("prefers the name over a word buried in the description", () => {
    const inName = repo({
      id: 4,
      name: "Kubernetes Helper",
      slug: "k8s-helper",
      fullPath: "/Users/j/Repos/k8s-helper",
    });
    const inDescription = repo({
      id: 5,
      name: "Ops Toolkit",
      slug: "ops-toolkit",
      fullPath: "/Users/j/Repos/ops-toolkit",
      description: "wraps kubernetse for us",
    });
    const misses = nearMisses("kubernetse", [inDescription, inName]);
    expect(misses.map((miss) => miss.repo.slug)).toEqual([
      "k8s-helper",
      "ops-toolkit",
    ]);
    expect(misses[0].field).toBe("name");
    expect(misses[1].field).toBe("description");
  });

  it("offers no more than it was asked for", () => {
    const repos = ["Alpha One", "Alpha Two", "Alpha Three", "Alpha Four"].map(
      (name, index) =>
        repo({
          id: 10 + index,
          name,
          slug: `alpha-${index}`,
          fullPath: `/Users/j/Repos/alpha-${index}`,
        }),
    );
    expect(nearMisses("alpha", repos, { limit: 2 })).toHaveLength(2);
    expect(nearMisses("alpha", repos, { limit: 0 })).toEqual([]);
  });

  it("keeps its list still between renders", () => {
    // Equal scores must not reshuffle: the suggestion under the cursor would
    // change identity mid-click.
    const repos = ["Alpha Two", "Alpha One"].map((name, index) =>
      repo({
        id: 20 + index,
        name,
        slug: `alpha-${index}`,
        fullPath: `/Users/j/Repos/alpha-${index}`,
      }),
    );
    const first = nearMisses("alpha", repos).map((miss) => miss.repo.name);
    const second = nearMisses("alpha", [...repos].reverse()).map(
      (miss) => miss.repo.name,
    );
    expect(first).toEqual(["Alpha One", "Alpha Two"]);
    expect(second).toEqual(first);
  });

  it("finds nothing in an empty catalog", () => {
    expect(nearMisses("demo liberary", [])).toEqual([]);
  });
});
