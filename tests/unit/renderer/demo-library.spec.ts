/**
 * Unit test for the demo library behind the browser bridge
 * (`src/renderer/lib/demo-library.ts`).
 *
 * The bridge is the only way to look at the app without Electron, so a silent
 * hole in its data is a route that cannot be reviewed at all — and it fails the
 * way this project has failed before: every IPC answer is validated against a
 * Zod schema on the way out, so a field the schema rejects does not break one
 * row, it breaks the whole read. The catalog then renders empty with nothing in
 * the console. `make-readme-shots.spec.ts` exists for exactly that reason; this
 * one checks the same things for the wider dataset, and adds the checks that
 * are specific to a bridge: that the four routes have something to show, and
 * that they agree about the slugs between them.
 *
 * Two halves:
 *
 *   1. Shape — everything the bridge hands out parses against the real schema.
 *   2. Coverage — each route has the state a person wants to look at, and the
 *      demo library still matches the 12 repos the screenshots are built from.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  ClaudeGlobalUsageResultSchema,
  ClaudeProjectsResultSchema,
  ClaudeRepoStateSchema,
  ClaudeSessionTranscriptResultSchema,
  DetectLauncherResultSchema,
  GraphResultSchema,
  GroupSchema,
  ListProcessesResultSchema,
  RepoDetailSchema,
  RepoSchema,
  SettingsSchema,
  TaskListResultSchema,
  UpdateStatusSchema,
} from "@shared/schemas";

import {
  DEMO_CLAUDE_PROJECTS,
  DEMO_ROOT,
  DEMO_GRAPH,
  DEMO_GROUPS,
  DEMO_LAUNCHER,
  DEMO_PROCESSES,
  DEMO_REPOS,
  DEMO_SETTINGS,
  DEMO_UPDATE,
  demoClaudeRepoState,
  demoDetail,
  demoGlobalUsage,
  demoRelations,
  demoTasks,
  demoTranscript,
} from "@renderer/lib/demo-library";

const SCRIPT = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "scripts",
  "make-readme-shots.mjs",
);

interface ScreenshotRow {
  name: string;
  fullPath: string;
  remoteUrl: string | null;
  lastCommitMsg: string;
  isDirty: number;
  primaryLanguage: string;
  languages: Array<{ name: string; bytes: number; color: string }>;
  tags: Array<{ value: string; source: string }>;
  description: string;
  sizeBytes: number;
}

let screenshotRows: ScreenshotRow[];

beforeAll(async () => {
  const shots = (await import(pathToFileURL(SCRIPT).href)) as unknown as {
    demoRows(root: string): ScreenshotRow[];
  };
  screenshotRows = shots.demoRows("/Users/example/Code");
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe("every row the bridge serves parses against its schema", () => {
  test("repos", () => {
    for (const repo of DEMO_REPOS) {
      const parsed = RepoSchema.safeParse(repo);
      expect(
        parsed.success,
        `${repo.name}: ${JSON.stringify(parsed.error?.issues ?? [])}`,
      ).toBe(true);
    }
  });

  test("repo details, README included", () => {
    for (const repo of DEMO_REPOS) {
      const detail = demoDetail(repo.slug);
      expect(detail, `${repo.name} has no detail`).not.toBeNull();
      const parsed = RepoDetailSchema.safeParse(detail);
      expect(
        parsed.success,
        `${repo.name}: ${JSON.stringify(parsed.error?.issues ?? [])}`,
      ).toBe(true);
      // The README is the reason the detail panel exists; an empty one is a
      // blank pane rather than a missing file.
      expect((detail?.readmeContent ?? "").length).toBeGreaterThan(0);
    }
  });

  test("groups", () => {
    for (const group of DEMO_GROUPS) {
      const parsed = GroupSchema.safeParse(group);
      expect(
        parsed.success,
        `${group.name}: ${JSON.stringify(parsed.error?.issues ?? [])}`,
      ).toBe(true);
    }
  });

  test("the graph", () => {
    const parsed = GraphResultSchema.safeParse(DEMO_GRAPH);
    expect(
      parsed.success,
      JSON.stringify(parsed.error?.issues ?? []),
    ).toBe(true);
  });

  test("Claude state for every repo, populated or not", () => {
    for (const repo of DEMO_REPOS) {
      const state = demoClaudeRepoState(repo.slug);
      const parsed = ClaudeRepoStateSchema.safeParse(state);
      expect(
        parsed.success,
        `${repo.name}: ${JSON.stringify(parsed.error?.issues ?? [])}`,
      ).toBe(true);
    }
  });

  test("Claude projects, and the global usage totals", () => {
    expect(
      ClaudeProjectsResultSchema.safeParse({ projects: DEMO_CLAUDE_PROJECTS })
        .success,
    ).toBe(true);
    for (const input of [{}, { from: "2026-09-01", to: "2026-09-30" }]) {
      const parsed = ClaudeGlobalUsageResultSchema.safeParse(
        demoGlobalUsage(input),
      );
      expect(
        parsed.success,
        `${JSON.stringify(input)}: ${JSON.stringify(parsed.error?.issues ?? [])}`,
      ).toBe(true);
    }
  });

  test("the process snapshot", () => {
    expect(ListProcessesResultSchema.safeParse(DEMO_PROCESSES).success).toBe(true);
  });

  test("settings, launcher detection and the update status", () => {
    const settings = SettingsSchema.safeParse(DEMO_SETTINGS);
    expect(
      settings.success,
      JSON.stringify(settings.error?.issues ?? []),
    ).toBe(true);
    expect(DetectLauncherResultSchema.safeParse(DEMO_LAUNCHER).success).toBe(true);
    // The old hand-rolled demo update was missing `signature` and `progress`,
    // which is what the settings page reads to decide whether to explain that
    // this build cannot update itself or to just offer the button.
    expect(UpdateStatusSchema.safeParse(DEMO_UPDATE).success).toBe(true);
    expect(DEMO_UPDATE.signature).toBeTruthy();
  });

  test("task lists, for a repo that has them and one that does not", () => {
    const withTasks = DEMO_REPOS[0];
    expect(withTasks).toBeDefined();
    const parsed = TaskListResultSchema.safeParse({
      tasks: demoTasks(withTasks?.slug ?? ""),
    });
    expect(parsed.success).toBe(true);
    expect(
      TaskListResultSchema.safeParse({ tasks: demoTasks("nothing-00000000") })
        .success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Consistency between the routes
// ---------------------------------------------------------------------------

describe("the routes agree with each other", () => {
  test("slugs are unique, so no card shadows another", () => {
    const slugs = DEMO_REPOS.map((repo) => repo.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("every process row points at a repo the catalog holds", () => {
    const slugs = new Set(DEMO_REPOS.map((repo) => repo.slug));
    for (const row of DEMO_PROCESSES.processes) {
      if (row.repoSlug === null) continue;
      expect(slugs.has(row.repoSlug), `port ${row.port}`).toBe(true);
    }
  });

  test("every map node is a catalog repo, and every edge a pair of them", () => {
    const slugs = new Set(DEMO_REPOS.map((repo) => repo.slug));
    for (const node of DEMO_GRAPH.nodes) expect(slugs.has(node.slug)).toBe(true);
    for (const edge of DEMO_GRAPH.edges) {
      expect(slugs.has(edge.source), edge.source).toBe(true);
      expect(slugs.has(edge.target), edge.target).toBe(true);
      expect(edge.source).not.toBe(edge.target);
    }
  });

  test("every Claude project names a repo the catalog holds, except one", () => {
    const slugs = new Set(DEMO_REPOS.map((repo) => repo.slug));
    for (const project of DEMO_CLAUDE_PROJECTS) {
      if (project.repoSlug === null) continue;
      expect(slugs.has(project.repoSlug), project.hash).toBe(true);
    }
    // The unmatched-project row is its own state — the table falls back to the
    // raw path for it — so one of them has to exist.
    expect(DEMO_CLAUDE_PROJECTS.some((p) => p.repoSlug === null)).toBe(true);
  });

  test("the processes page shows matched and unmatched rows, and a repo with two ports", () => {
    const rows = DEMO_PROCESSES.processes;
    expect(rows.some((row) => row.repoSlug === null)).toBe(true);
    const perRepo = new Map<string, number>();
    for (const row of rows) {
      if (!row.repoSlug) continue;
      perRepo.set(row.repoSlug, (perRepo.get(row.repoSlug) ?? 0) + 1);
    }
    // A lone chip would not show that chips stack.
    expect([...perRepo.values()].some((count) => count > 1)).toBe(true);
  });

  test("the settings rows have something to render", () => {
    expect(DEMO_SETTINGS.scanPaths.length).toBeGreaterThan(0);
    expect(DEMO_SETTINGS.identities.length).toBeGreaterThan(0);
    expect(DEMO_LAUNCHER.editors.some((e) => e.available)).toBe(true);
    expect(DEMO_LAUNCHER.terminals.some((t) => t.available)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The graph's own arithmetic
// ---------------------------------------------------------------------------

describe("the map is internally consistent", () => {
  test("cluster membership matches the nodes carrying that cluster id", () => {
    const clusterIds = new Set(DEMO_GRAPH.clusters.map((c) => c.id));
    for (const node of DEMO_GRAPH.nodes) {
      expect(clusterIds.has(node.cluster), node.name).toBe(true);
    }
    for (const cluster of DEMO_GRAPH.clusters) {
      const members = DEMO_GRAPH.nodes
        .filter((node) => node.cluster === cluster.id)
        .map((node) => node.slug)
        .sort();
      expect(members, cluster.label).toEqual([...cluster.slugs].sort());
      expect(cluster.size).toBe(cluster.slugs.length);
    }
  });

  test("folderSpread counts the folders, and strays are exactly the outside ones", () => {
    for (const cluster of DEMO_GRAPH.clusters) {
      expect(cluster.folderSpread, cluster.label).toBe(cluster.folders.length);
      const outside = cluster.slugs.filter((slug) => {
        const node = DEMO_GRAPH.nodes.find((n) => n.slug === slug);
        return node?.folder !== cluster.dominantFolder;
      });
      expect([...cluster.strays].sort(), cluster.label).toEqual(
        outside.sort(),
      );
    }
  });

  test("degree counts the edges touching each node", () => {
    for (const node of DEMO_GRAPH.nodes) {
      const touching = DEMO_GRAPH.edges.filter(
        (edge) => edge.source === node.slug || edge.target === node.slug,
      ).length;
      expect(node.degree, node.name).toBe(touching);
    }
  });

  test("weights are positive and grow with the number of signals", () => {
    for (const edge of DEMO_GRAPH.edges) {
      expect(edge.signals.length).toBeGreaterThan(0);
      expect(edge.weight).toBeGreaterThan(0);
      expect(edge.why.length).toBeGreaterThan(0);
    }
  });

  test("at least one cluster is scattered, so the inspector has an action", () => {
    // "Scattered" is the graph page's own filter: more than one member, living
    // in more than one folder. Without one of these the route's right-hand
    // column — the whole point of the screen — renders its empty state.
    const scattered = DEMO_GRAPH.clusters.filter(
      (cluster) => cluster.size >= 2 && cluster.folderSpread > 1,
    );
    expect(scattered.length).toBeGreaterThan(0);
    for (const cluster of scattered) expect(cluster.strays.length).toBeGreaterThan(0);
  });

  test("curated links exist on the map and in both detail panels", () => {
    const curatedEdges = DEMO_GRAPH.edges.filter(
      (edge) => (edge.curated ?? []).length > 0,
    );
    expect(curatedEdges.length).toBeGreaterThan(0);
    for (const edge of curatedEdges) {
      for (const end of [edge.source, edge.target]) {
        const relations = demoRelations(end);
        expect(
          relations.relations.length,
          `no relations for ${end}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  test("a relation is read from the end it is looked at from", () => {
    const curated = DEMO_GRAPH.edges
      .flatMap((edge) => edge.curated ?? [])
      .find((link) => link);
    expect(curated).toBeDefined();
    if (!curated) return;
    const outgoing = demoRelations(curated.from).relations;
    const incoming = demoRelations(curated.to).relations;
    expect(outgoing.some((r) => r.slug === curated.to && r.direction === "outgoing")).toBe(
      true,
    );
    expect(incoming.some((r) => r.slug === curated.from && r.direction === "incoming")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// The Claude views
// ---------------------------------------------------------------------------

describe("the Claude views have both states to show", () => {
  test("some repos have a CLAUDE.md and some are the empty state", () => {
    const states = DEMO_REPOS.map((repo) => demoClaudeRepoState(repo.slug));
    const populated = states.filter((state) => state.hasClaude);
    expect(populated.length).toBeGreaterThan(0);
    expect(states.some((state) => !state.hasClaude)).toBe(true);
    for (const state of populated) {
      expect(state.claudeMdPath).toBeTruthy();
      expect((state.claudeMdContent ?? "").length).toBeGreaterThan(0);
      expect(state.sessions.length).toBeGreaterThan(0);
      expect(state.totalTokens).toBeGreaterThan(0);
    }
  });

  test("a repo's Claude tokens are the sum of its sessions", () => {
    for (const repo of DEMO_REPOS) {
      const state = demoClaudeRepoState(repo.slug);
      const summed = state.sessions.reduce(
        (total, session) => total + session.tokenUsage.totalTokens,
        0,
      );
      expect(state.totalTokens, repo.name).toBe(summed);
    }
  });

  test("the per-project series is present, so the sparkline has data", () => {
    const usage = demoGlobalUsage({});
    expect(usage.byProject.length).toBeGreaterThan(0);
    for (const project of usage.byProject) {
      expect(project.byWeek?.length ?? 0).toBeGreaterThan(1);
    }
  });

  test("a narrowed range returns fewer days than the whole history", () => {
    const all = demoGlobalUsage({});
    const week = demoGlobalUsage({ from: all.byDay.at(-7)?.date ?? "" });
    expect(all.byDay.length).toBeGreaterThan(week.byDay.length);
    expect(week.byDay.length).toBeGreaterThan(0);
  });

  test("a transcript pages to a definite end", () => {
    const sessionId = demoClaudeRepoState(DEMO_REPOS[0]?.slug ?? "").sessions[0]?.id;
    expect(sessionId).toBeTruthy();
    let cursor = 0;
    let pages = 0;
    let events = 0;
    for (;;) {
      const page = demoTranscript(sessionId ?? "", cursor);
      const parsed = ClaudeSessionTranscriptResultSchema.safeParse(page);
      expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
      expect(page.events.length).toBeGreaterThan(0);
      events += page.events.length;
      pages += 1;
      if (page.nextCursor === null) {
        expect(page.hasMore).toBe(false);
        break;
      }
      cursor = page.nextCursor;
      expect(pages).toBeLessThan(10); // a non-advancing cursor must fail loudly
    }
    expect(pages).toBeGreaterThan(1); // "Load more" is exercisable
    expect(events).toBeGreaterThan(12);
  });
});

// ---------------------------------------------------------------------------
// The demo library is still the one the screenshots are built from
// ---------------------------------------------------------------------------

describe("the demo library matches the one behind the README screenshots", () => {
  test("the same repos, by name", () => {
    expect(DEMO_REPOS.map((repo) => repo.name).sort()).toEqual(
      screenshotRows.map((row) => row.name).sort(),
    );
  });

  test("each repo carries the same remote, language, tags, state and description", () => {
    for (const repo of DEMO_REPOS) {
      const row = screenshotRows.find((candidate) => candidate.name === repo.name);
      expect(row, `${repo.name} is missing from the screenshot library`).toBeDefined();
      if (!row) continue;
      expect(repo.remoteUrl).toBe(row.remoteUrl);
      expect(repo.primaryLanguage).toBe(row.primaryLanguage);
      expect(repo.isDirty).toBe(row.isDirty === 1);
      expect(repo.description).toBe(row.description);
      expect(repo.sizeBytes).toBe(row.sizeBytes);
      expect(repo.lastCommitMsg).toBe(row.lastCommitMsg);
      expect(repo.languages).toEqual(row.languages);
      expect(repo.tags).toEqual(row.tags);
    }
  });

  test("every repo sits under the demo root, in the folder the screenshots use", () => {
    // `sketchbook` and `old-experiment` sit at the top of the scan root rather
    // than in a group folder. That is the one deliberate difference: without a
    // repo directly under the root, the rail's "directly in this folder" row
    // has no top-level case to demonstrate. Everything else keeps its folder.
    const loose = new Set(["sketchbook", "old-experiment"]);
    for (const repo of DEMO_REPOS) {
      const row = screenshotRows.find((candidate) => candidate.name === repo.name);
      if (!row) continue;
      if (loose.has(repo.name)) {
        expect(repo.fullPath, repo.name).toBe(`${DEMO_ROOT}/${repo.name}`);
        continue;
      }
      const relative = row.fullPath.replace("/Users/example/Code/", "");
      expect(repo.fullPath, repo.name).toBe(`${DEMO_ROOT}/${relative}`);
    }
  });
});
