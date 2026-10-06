/**
 * Curated links inside the derived graph.
 *
 * The three behaviours pinned here are the ones that would silently
 * regress: a human assertion must outrank derived signals, must survive
 * the noise filter that drops weak derived edges, and must keep its
 * direction even though the layout treats edges as undirected.
 *
 * !!! REAL better-sqlite3 DB !!! Needs host-ABI natives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { isolateDataDir } from "../../../helpers/test-db.js";
import type { UpsertRepoInput } from "@main/db/queries";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/atr-curated-test" },
}));

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

async function makeRepo(name: string, deps?: string[]): Promise<number> {
  const { upsertRepo } = await import("@main/db/queries");
  const { getSqlite } = await import("@main/db/client");
  const fullPath = path.join(root, name);
  fs.mkdirSync(fullPath, { recursive: true });
  if (deps) {
    fs.writeFileSync(
      path.join(fullPath, "package.json"),
      JSON.stringify({
        name,
        dependencies: Object.fromEntries(deps.map((d) => [d, "1.0.0"])),
      }),
    );
  }
  upsertRepo(repoInput({ slug: `${name}-aaaaaa`, name, fullPath }));
  return (
    getSqlite()
      .prepare("SELECT id FROM repos WHERE full_path = ?")
      .get(fullPath) as { id: number }
  ).id;
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

describe("curated links in the graph", () => {
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

  it("draws an edge between repos with nothing else in common", async () => {
    const { createLink } = await import("@main/db/links");
    const { graphService } = await import("@main/services/graph");
    const a = await makeRepo("hive", ["only-hive"]);
    const b = await makeRepo("worker", ["only-worker"]);
    createLink({ fromId: b, toId: a, kind: "part-of", why: "worker of hive" });

    const graph = await graphService.build();
    const edge = edgeBetween(graph.edges, "hive-aaaaaa", "worker-aaaaaa");
    expect(edge).toBeDefined();
    expect(edge!.signals).toContain("curated");
  });

  it("outranks a derived edge between a different pair", async () => {
    const { createLink } = await import("@main/db/links");
    const { graphService } = await import("@main/services/graph");
    const hive = await makeRepo("hive", []);
    const worker = await makeRepo("worker", []);
    await makeRepo("shared-one", ["crewai"]);
    await makeRepo("shared-two", ["crewai"]);
    createLink({
      fromId: worker,
      toId: hive,
      kind: "part-of",
      why: "worker of hive",
    });

    const graph = await graphService.build();
    const curated = edgeBetween(graph.edges, "hive-aaaaaa", "worker-aaaaaa");
    const derived = edgeBetween(
      graph.edges,
      "shared-one-aaaaaa",
      "shared-two-aaaaaa",
    );
    expect(curated).toBeDefined();
    expect(derived).toBeDefined();
    expect(curated!.weight).toBeGreaterThan(derived!.weight);
  });

  it("preserves direction and reason as edge metadata", async () => {
    const { createLink } = await import("@main/db/links");
    const { graphService } = await import("@main/services/graph");
    const a = await makeRepo("hive", []);
    const b = await makeRepo("worker", []);
    createLink({ fromId: b, toId: a, kind: "part-of", why: "worker of hive" });

    const graph = await graphService.build();
    const edge = edgeBetween(graph.edges, "hive-aaaaaa", "worker-aaaaaa")!;
    expect(edge.curated).toEqual([
      {
        from: "worker-aaaaaa",
        to: "hive-aaaaaa",
        kind: "part-of",
        why: "worker of hive",
      },
    ]);
  });

  it("leaves the graph unchanged when there are no curated links", async () => {
    const { graphService } = await import("@main/services/graph");
    await makeRepo("a", ["crewai"]);
    await makeRepo("b", ["crewai"]);
    const graph = await graphService.build();
    expect(graph.edges.every((e) => !e.signals.includes("curated"))).toBe(true);
    expect(graph.edges.every((e) => e.curated === undefined)).toBe(true);
  });
});
