/**
 * Integration test — `graphService` against a real catalog and real
 * `package.json` files on disk.
 *
 * The graph's value rests entirely on which edges it does NOT draw. A
 * version that links every JavaScript project to every other looks
 * plausible, renders fine, and is useless — that exact failure happened
 * during development (one cluster swallowed 123 of 263 repos), so the
 * rules that prevent it are pinned here.
 *
 * !!! REAL better-sqlite3 DB !!! Needs host-ABI natives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { isolateDataDir } from "../../../helpers/test-db.js";
import type { UpsertRepoInput } from "@main/db/queries";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp/atr-graph-test" } }));

let isolate: { dir: string; cleanup(): void } | null = null;
let root = "";

function repoInput(overrides: Partial<UpsertRepoInput>): UpsertRepoInput {
  return {
    slug: "slug-000000",
    name: "repo",
    fullPath: "/nonexistent/repo",
    remoteUrl: null,
    defaultBranch: "main",
    currentBranch: "main",
    lastCommitHash: null,
    lastCommitDate: "2026-01-01T00:00:00.000Z",
    lastCommitMsg: "init",
    isDirty: false,
    primaryLanguage: "TypeScript",
    languages: [],
    heuristicTags: [],
    description: null,
    readmeContent: null,
    readmeHash: null,
    sizeBytes: 10,
    ...overrides,
  };
}

/** Create a repo on disk and in the catalog. */
async function makeRepo(
  relative: string,
  opts: {
    deps?: string[];
    remote?: string | null;
    readme?: string | null;
  } = {},
): Promise<string> {
  const { upsertRepo } = await import("@main/db/queries");
  const fullPath = path.join(root, relative);
  fs.mkdirSync(fullPath, { recursive: true });
  if (opts.deps) {
    fs.writeFileSync(
      path.join(fullPath, "package.json"),
      JSON.stringify({
        name: path.basename(relative),
        dependencies: Object.fromEntries(opts.deps.map((d) => [d, "1.0.0"])),
      }),
    );
  }
  const name = path.basename(relative);
  const slug = `${name}-aaaaaa`;
  upsertRepo(
    repoInput({
      slug,
      name,
      fullPath,
      remoteUrl: opts.remote ?? null,
      readmeContent: opts.readme ?? null,
    }),
  );
  return slug;
}

async function build() {
  const { graphService } = await import("@main/services/graph");
  return graphService.build();
}

function edgeBetween<T extends { source: string; target: string }>(
  edges: T[],
  a: string,
  b: string,
): T | undefined {
  return edges.find(
    (e) =>
      (e.source === a && e.target === b) || (e.source === b && e.target === a),
  );
}

describe("graphService", () => {
  beforeEach(async () => {
    isolate = isolateDataDir();
    root = path.join(isolate.dir, "Repos");
    fs.mkdirSync(root, { recursive: true });
    const { closeDb, getDb } = await import("@main/db/client");
    closeDb();
    getDb();
  });

  afterEach(async () => {
    const { closeDb } = await import("@main/db/client");
    closeDb();
    isolate?.cleanup();
    isolate = null;
  });

  it("links repos that share a distinctive library", async () => {
    const a = await makeRepo("a", { deps: ["crewai", "left-pad"] });
    const b = await makeRepo("b", { deps: ["crewai"] });
    await makeRepo("c", { deps: ["unrelated-thing"] });

    const graph = await build();
    const edge = edgeBetween(graph.edges, a, b);
    expect(edge).toBeDefined();
    expect(edge!.signals).toContain("dependency");
  });

  it("ignores a library that almost everything uses", async () => {
    // 10 repos, 9 share `typescript` — that's ambient, not kinship.
    const slugs: string[] = [];
    for (let i = 0; i < 9; i++) {
      slugs.push(await makeRepo(`ambient-${i}`, { deps: ["typescript"] }));
    }
    await makeRepo("lonely", { deps: ["nothing-else"] });

    const graph = await build();
    const depEdges = graph.edges.filter((e) =>
      e.signals.includes("dependency"),
    );
    // Every pair among the nine would be 36 edges if `typescript` counted.
    expect(depEdges).toHaveLength(0);
    void slugs;
  });

  it("does not let a dependency-heavy repo link to everything equally", async () => {
    // `fat` shares one rare dep with each of two repos, but carries a
    // pile of others. Without cosine normalisation its edges would
    // outweigh the focused pair that shares three.
    const fat = await makeRepo("fat", {
      deps: ["rare-one", "rare-two", "x1", "x2", "x3", "x4", "x5", "x6"],
    });
    const focusedA = await makeRepo("focused-a", {
      deps: ["shared-a", "shared-b", "shared-c"],
    });
    const focusedB = await makeRepo("focused-b", {
      deps: ["shared-a", "shared-b", "shared-c"],
    });
    const other = await makeRepo("other", { deps: ["rare-one"] });
    for (let i = 0; i < 6; i++) await makeRepo(`filler-${i}`, { deps: [] });

    const graph = await build();
    const focusedEdge = edgeBetween(graph.edges, focusedA, focusedB);
    const fatEdge = edgeBetween(graph.edges, fat, other);
    expect(focusedEdge).toBeDefined();
    expect(fatEdge).toBeDefined();
    expect(focusedEdge!.weight).toBeGreaterThan(fatEdge!.weight);
  });

  it("links a repo whose README points at another repo's GitHub page", async () => {
    const target = await makeRepo("target", {
      remote: "https://github.com/acme/target.git",
    });
    const source = await makeRepo("source", {
      readme: "Built on top of https://github.com/acme/target for the parser.",
    });

    const graph = await build();
    const edge = edgeBetween(graph.edges, source, target);
    expect(edge).toBeDefined();
    expect(edge!.signals).toContain("reference");
  });

  it("links repos sharing a name family but not generic words", async () => {
    const a = await makeRepo("pwnagotchi-tools");
    const b = await makeRepo("pwnagotchi-plugins");
    const c = await makeRepo("my-web-app");
    const d = await makeRepo("other-web-tool");

    const graph = await build();
    expect(edgeBetween(graph.edges, a, b)).toBeDefined();
    // "web" is a stopword; these should not be family.
    expect(edgeBetween(graph.edges, c, d)).toBeUndefined();
  });

  it("never draws an edge merely because two repos share a folder", async () => {
    // Same directory, nothing else in common. Co-location is the thing
    // the graph critiques — if it were an edge, the graph could only
    // ever agree with the folder tree.
    const a = await makeRepo("together/alpha", { deps: ["only-alpha"] });
    const b = await makeRepo("together/beta", { deps: ["only-beta"] });

    const graph = await build();
    expect(edgeBetween(graph.edges, a, b)).toBeUndefined();
  });

  it("reports how far a cluster is scattered, and which members are strays", async () => {
    // Three related repos; two in one folder, one exiled elsewhere.
    await makeRepo("home/one", { deps: ["shared-lib", "shared-two"] });
    await makeRepo("home/two", { deps: ["shared-lib", "shared-two"] });
    const stray = await makeRepo("elsewhere/three", {
      deps: ["shared-lib", "shared-two"],
    });
    for (let i = 0; i < 5; i++) await makeRepo(`filler-${i}`, { deps: [] });

    const graph = await build();
    const cluster = graph.clusters.find((c) => c.slugs.includes(stray));
    expect(cluster).toBeDefined();
    expect(cluster!.size).toBe(3);
    expect(cluster!.folderSpread).toBe(2);
    expect(cluster!.dominantFolder).toBe(path.join(root, "home"));
    expect(cluster!.strays).toEqual([stray]);
  });

  it("is deterministic — the same catalog yields the same clusters", async () => {
    // A map that reshuffles on every open destroys spatial memory.
    await makeRepo("a", { deps: ["p", "q"] });
    await makeRepo("b", { deps: ["p", "q"] });
    await makeRepo("c", { deps: ["r", "s"] });
    await makeRepo("d", { deps: ["r", "s"] });

    const first = await build();
    const second = await build();
    expect(second.nodes.map((n) => `${n.slug}:${n.cluster}`)).toEqual(
      first.nodes.map((n) => `${n.slug}:${n.cluster}`),
    );
  });

  it("handles an empty catalog and repos with nothing in common", async () => {
    expect((await build()).nodes).toEqual([]);
    await makeRepo("solo", { deps: [] });
    const graph = await build();
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toEqual([]);
    // A repo related to nothing isn't a cluster worth reporting.
    expect(graph.clusters).toEqual([]);
  });

  it("survives a repo whose package.json is unreadable", async () => {
    const broken = path.join(root, "broken");
    fs.mkdirSync(broken, { recursive: true });
    fs.writeFileSync(path.join(broken, "package.json"), "{ not json");
    const { upsertRepo } = await import("@main/db/queries");
    upsertRepo(
      repoInput({ slug: "broken-aaaaaa", name: "broken", fullPath: broken }),
    );
    await expect(build()).resolves.toBeDefined();
  });
});
